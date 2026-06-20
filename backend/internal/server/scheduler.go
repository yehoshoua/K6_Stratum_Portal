package server

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"

	"k6-bedrock-dashboard/backend/internal/database"
)

const (
	testRunDateFormat       = "2006-01-02-15-04"
	maxDNSLabelLength       = 63
	testRunDateSuffixLength = 16
	maxBaseNameLength       = maxDNSLabelLength - 1 - testRunDateSuffixLength
	scheduleTickInterval    = 30 * time.Second
	scheduleRunTimeout      = 45 * time.Second
	scheduleRetryAttempts   = 3
	scheduleRetryBaseDelay  = 500 * time.Millisecond
)

var testRunSuffixRegex = regexp.MustCompile(`[-_][0-9]{4}(?:-|_)[0-9]{2}(?:-|_)[0-9]{2}(?:-|_)[0-9]{2}(?:-|_)[0-9]{2}$`)

type scheduleState struct {
	cronExpr string
	schedule cron.Schedule
	nextRun  time.Time
}

func (s *Server) startScheduleRunner() {
	if s.db == nil {
		return
	}

	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	states := map[int]*scheduleState{}
	ticker := time.NewTicker(scheduleTickInterval)

	s.processSchedules(parser, states)

	go func() {
		for range ticker.C {
			s.processSchedules(parser, states)
		}
	}()
}

func (s *Server) processSchedules(parser cron.Parser, states map[int]*scheduleState) {
	if s.db == nil {
		return
	}

	schedules, err := s.db.GetSchedules()
	if err != nil {
		log.Printf("scheduler: failed to list schedules: %v", err)
		return
	}

	now := time.Now()
	activeIDs := make(map[int]struct{}, len(schedules))
	for _, sched := range schedules {
		activeIDs[sched.ID] = struct{}{}

		if sched.CronExpression == "" || !sched.Active {
			delete(states, sched.ID)
			continue
		}

		state, ok := states[sched.ID]
		if !ok || state.cronExpr != sched.CronExpression {
			parsed, parseErr := parser.Parse(sched.CronExpression)
			if parseErr != nil {
				log.Printf("scheduler: invalid cron for schedule %d: %v", sched.ID, parseErr)
				delete(states, sched.ID)
				continue
			}
			state = &scheduleState{
				cronExpr: sched.CronExpression,
				schedule: parsed,
				nextRun:  parsed.Next(now),
			}
			states[sched.ID] = state
		}

		if !state.nextRun.IsZero() && !state.nextRun.After(now) {
			ctx, cancel := context.WithTimeout(context.Background(), scheduleRunTimeout)
			if err := s.runScheduleTestRun(ctx, sched, "cron"); err != nil {
				log.Printf("scheduler: failed to run schedule %d: %v", sched.ID, err)
			}
			cancel()
			state.nextRun = state.schedule.Next(now.Add(time.Second))
		}
	}

	for id := range states {
		if _, ok := activeIDs[id]; !ok {
			delete(states, id)
		}
	}
}

func (s *Server) runScheduleTestRun(ctx context.Context, sched *database.TestSchedule, runSource string) error {
	if sched == nil {
		return fmt.Errorf("schedule is required")
	}
	if s.db == nil {
		return fmt.Errorf("database not initialized")
	}

	ctx, cancel := context.WithTimeout(ctx, scheduleRunTimeout)
	defer cancel()

	client, isMock, err := s.getClusterClient(sched.ClusterID)
	if err != nil {
		return fmt.Errorf("failed to get cluster client: %w", err)
	}
	if isMock {
		return nil
	}

	template, err := s.db.GetTemplate(sched.TemplateID)
	if err != nil || template == nil {
		return fmt.Errorf("template not found")
	}

	clusterConfig := s.getClusterConfig(sched.ClusterID)

	if sched.Namespace == "" {
		sched.Namespace = "default"
	}

	baseName := sanitizeDNSLabel(sched.Name, maxBaseNameLength)
	if baseName == "" {
		baseName = "testrun"
	}
	resourceName, displayName := buildTestRunNames(baseName, time.Now().UTC())

	configMapName := "cm-" + baseName
	scriptFile := template.ScriptFile
	if scriptFile == "" {
		scriptFile = "script.js"
	}

	if template.ScriptContent != "" {
		cm := &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      configMapName,
				Namespace: sched.Namespace,
				Labels: map[string]string{
					"k6s": "enabled",
				},
			},
			Data: map[string]string{
				scriptFile: template.ScriptContent,
			},
		}
		cmClient := client.Clientset.CoreV1().ConfigMaps(sched.Namespace)
		if err := applyConfigMap(ctx, cmClient, cm); err != nil {
			return err
		}
	} else if template.ScriptName != "" {
		configMapName = template.ScriptName
	} else {
		return fmt.Errorf("template script content or script name is required")
	}

	parallelismVal := int32(template.Parallelism)
	if parallelismVal <= 0 {
		parallelismVal = 1
	}

	spec := map[string]interface{}{
		"parallelism": parallelismVal,
		"script": map[string]interface{}{
			"configMap": map[string]interface{}{
				"name": configMapName,
				"file": scriptFile,
			},
		},
	}

	runnerSpec := map[string]interface{}{}
	if template.CPULimit != "" || template.MemLimit != "" {
		limits := map[string]interface{}{}
		if template.CPULimit != "" {
			limits["cpu"] = template.CPULimit
		}
		if template.MemLimit != "" {
			limits["memory"] = template.MemLimit
		}
		runnerSpec["resources"] = map[string]interface{}{
			"limits": limits,
		}
	}
	runnerImage := resolveClusterImage(strings.TrimSpace(template.RunnerImage), clusterConfig)
	if runnerImage != "" {
		runnerSpec["image"] = runnerImage
	}
	if len(runnerSpec) > 0 {
		spec["runner"] = runnerSpec
	}

	labels := map[string]string{
		"k6s":             "enabled",
		"k6s-schedule-id": strconv.Itoa(sched.ID),
	}
	if runSource != "" {
		labels["k6s-run-source"] = runSource
	}

	annotations := map[string]string{
		"k6s/run-name": displayName,
	}

	obj := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "k6.io/v1alpha1",
			"kind":       "TestRun",
			"metadata": map[string]interface{}{
				"name":        resourceName,
				"namespace":   sched.Namespace,
				"labels":      labels,
				"annotations": annotations,
			},
			"spec": spec,
		},
	}

	if err := withRetry(ctx, scheduleRetryAttempts, scheduleRetryBaseDelay, func() error {
		_, err := client.CreateK6CustomResource(ctx, sched.Namespace, obj)
		return err
	}); err != nil {
		return fmt.Errorf("failed to create TestRun: %w", err)
	}

	return nil
}

func applyConfigMap(ctx context.Context, cmClient corev1client.ConfigMapInterface, cm *corev1.ConfigMap) error {
	return withRetry(ctx, scheduleRetryAttempts, scheduleRetryBaseDelay, func() error {
		existing, err := cmClient.Get(ctx, cm.Name, metav1.GetOptions{})
		if err != nil {
			if apierrors.IsNotFound(err) {
				_, err = cmClient.Create(ctx, cm, metav1.CreateOptions{})
				if apierrors.IsAlreadyExists(err) {
					existing, err = cmClient.Get(ctx, cm.Name, metav1.GetOptions{})
					if err != nil {
						return err
					}
				} else {
					return err
				}
			} else {
				return err
			}
		}
		if existing != nil {
			cmCopy := cm.DeepCopy()
			cmCopy.ResourceVersion = existing.ResourceVersion
			_, err = cmClient.Update(ctx, cmCopy, metav1.UpdateOptions{})
			return err
		}
		return nil
	})
}

func withRetry(ctx context.Context, attempts int, baseDelay time.Duration, fn func() error) error {
	var lastErr error
	delay := baseDelay
	for i := 0; i < attempts; i++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := fn(); err != nil {
			lastErr = err
			if !isRetryable(err) || i == attempts-1 {
				return err
			}
			jitter := time.Duration(rand.Intn(200)) * time.Millisecond
			timer := time.NewTimer(delay + jitter)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
			delay *= 2
			continue
		}
		return nil
	}
	return lastErr
}

func isRetryable(err error) bool {
	if err == nil {
		return false
	}
	if apierrors.IsTooManyRequests(err) || apierrors.IsTimeout(err) || apierrors.IsServerTimeout(err) || apierrors.IsInternalError(err) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return netErr.Timeout() || netErr.Temporary()
	}
	return false
}

func (s *Server) getClusterConfig(id string) *database.ClusterConfig {
	if s.db == nil || id == "" {
		return nil
	}
	clusters, err := s.db.GetClusters()
	if err != nil {
		return nil
	}
	for _, c := range clusters {
		if c.ID == id {
			copy := *c
			s.enrichClusterMetadata(context.Background(), &copy, true)
			return &copy
		}
	}
	return nil
}

func resolveClusterImage(image string, clusterConfig *database.ClusterConfig) string {
	if image == "" {
		return image
	}

	trimmed := strings.TrimSpace(strings.TrimPrefix(image, "/"))
	if clusterConfig == nil || clusterConfig.AWSAccountID == "" || clusterConfig.Region == "" {
		return trimmed
	}

	domain := defaultEcrDomain(clusterConfig.Region)
	hasDomainPlaceholder := strings.Contains(trimmed, "AWS_DOMAIN")
	trimmed = strings.ReplaceAll(trimmed, "AWS_ACCOUNT_ID", clusterConfig.AWSAccountID)
	trimmed = strings.ReplaceAll(trimmed, "AWS_REGION", clusterConfig.Region)
	trimmed = strings.ReplaceAll(trimmed, "AWS_DOMAIN", domain)

	if hasDomainPlaceholder {
		trimmed = ensureDomainSeparator(trimmed, domain)
	}

	targetRegistry := fmt.Sprintf("%s.dkr.ecr.%s.%s", clusterConfig.AWSAccountID, clusterConfig.Region, domain)
	targetPrefix := targetRegistry + "/"
	if strings.HasPrefix(trimmed, targetPrefix) {
		return trimmed
	}

	parts := strings.Split(trimmed, "/")
	if len(parts) > 1 && (strings.Contains(parts[0], ".") || strings.Contains(parts[0], ":") || parts[0] == "localhost") {
		trimmed = strings.Join(parts[1:], "/")
	}

	if trimmed == "" {
		return ""
	}
	return targetPrefix + trimmed
}

func defaultEcrDomain(region string) string {
	if strings.HasPrefix(region, "cn-") {
		return "amazonaws.com.cn"
	}
	return "amazonaws.com"
}

func ensureDomainSeparator(image, domain string) string {
	idx := strings.Index(image, domain)
	if idx == -1 {
		return image
	}
	nextIndex := idx + len(domain)
	if nextIndex >= len(image) {
		return image + "/"
	}
	next := image[nextIndex]
	if next != '/' && next != ':' {
		return image[:nextIndex] + "/" + image[nextIndex:]
	}
	return image
}

func buildTestRunNames(base string, ts time.Time) (string, string) {
	suffix := ts.UTC().Format(testRunDateFormat)
	baseName := sanitizeDNSLabel(base, maxBaseNameLength)
	if baseName == "" {
		baseName = "testrun"
	}
	displayName := fmt.Sprintf("%s_%s", baseName, suffix)
	resourceName := sanitizeDNSLabel(displayName, maxDNSLabelLength)
	return resourceName, displayName
}

func stripTestRunDateSuffix(name string) string {
	return testRunSuffixRegex.ReplaceAllString(name, "")
}

func sanitizeDNSLabel(input string, maxLen int) string {
	if maxLen <= 0 {
		return ""
	}

	lower := strings.ToLower(input)
	lower = strings.ReplaceAll(lower, " ", "-")
	lower = strings.ReplaceAll(lower, "_", "-")

	var cleaned []rune
	for _, r := range lower {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			cleaned = append(cleaned, r)
		}
	}

	result := strings.Trim(string(cleaned), "-")
	if len(result) > maxLen {
		result = strings.Trim(result[:maxLen], "-")
	}
	return result
}
