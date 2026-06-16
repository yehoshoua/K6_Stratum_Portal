package influx

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	influxdb2 "github.com/influxdata/influxdb-client-go/v2"
)

type MetricsService struct {
	client   influxdb2.Client
	version  string // "v1" or "v2"
	url      string
	org      string
	bucket   string // Act as database name in v1
	username string
	password string
	method   string // HTTP method for v1 queries: "GET" or "POST"
}

func NewMetricsService(version, serverURL, token, org, bucket, username, password, method string) *MetricsService {
	if method == "" {
		method = "POST"
	}
	if version == "" {
		version = "v2"
	}

	var client influxdb2.Client
	if version == "v2" && serverURL != "" {
		client = influxdb2.NewClient(serverURL, token)
	}

	return &MetricsService{
		client:   client,
		version:  version,
		url:      serverURL,
		org:      org,
		bucket:   bucket,
		username: username,
		password: password,
		method:   method,
	}
}

// Close closes the underlying InfluxDB client connection
func (s *MetricsService) Close() {
	if s.client != nil {
		s.client.Close()
	}
}

// TestMetricPoint holds a formatted datapoint for frontend graphing
type TestMetricPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Metric    string    `json:"metric"`
	Value     float64   `json:"value"`
}

// TestRunSummary represents a summary of a K6 test run compiled from InfluxDB
type TestRunSummary struct {
	TestRunID string    `json:"test_run_id"`
	StartTime time.Time `json:"start_time"`
	Duration  float64   `json:"duration_seconds"`
	MaxVUs    float64   `json:"max_vus"`
	AvgReqDur float64   `json:"avg_req_duration_ms"`
	Cluster   string    `json:"cluster"`
	Namespace string    `json:"namespace"`
}

// Ping checks if the InfluxDB server is reachable
func (s *MetricsService) Ping(ctx context.Context) error {
	if s.version == "v1" {
		return VerifyInfluxDBConnection(s.url, s.version, "", s.username, s.password, "GET")
	}

	if s.client == nil {
		return fmt.Errorf("influxdb client is not initialized")
	}
	ok, err := s.client.Ping(ctx)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("influxdb ping returned false")
	}
	return nil
}

// VerifyInfluxDBConnection pings /ping (v1) or /health (v2) to verify InfluxDB reachability
func VerifyInfluxDBConnection(serverURL, version, token, username, password, method string) error {
	if serverURL == "" {
		return fmt.Errorf("server URL is required")
	}

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	targetURL := serverURL
	u, err := url.Parse(serverURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	if version == "v1" {
		u.Path = "/ping"
	} else {
		u.Path = "/health"
	}
	targetURL = u.String()

	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create health check request: %w", err)
	}

	if version == "v2" && token != "" {
		req.Header.Set("Authorization", "Token "+token)
	} else if username != "" || password != "" {
		req.SetBasicAuth(username, password)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect to InfluxDB: %w", err)
	}
	defer resp.Body.Close()

	if version == "v1" {
		// v1 /ping returns 204 No Content, but sometimes returns 200 OK depending on reverse proxy
		if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
			return fmt.Errorf("received status code %d from /ping", resp.StatusCode)
		}
	} else {
		// v2 /health returns 200 OK
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("received status code %d from /health", resp.StatusCode)
		}
	}

	return nil
}

// QueryK6Metrics retrieves time-series aggregates of K6 metrics for a specific test run
func (s *MetricsService) QueryK6Metrics(ctx context.Context, testRunID string, metricName string, durationRange string, startTime string, stopTime string, cluster string, namespace string) ([]TestMetricPoint, error) {
	if s.url == "" {
		return []TestMetricPoint{}, nil
	}

	if s.version == "v1" {
		return s.queryV1Metrics(ctx, testRunID, metricName, durationRange, startTime, stopTime, cluster, namespace)
	}

	if s.client == nil {
		return []TestMetricPoint{}, nil
	}

	queryAPI := s.client.QueryAPI(s.org)

	var rangeClause string
	if startTime != "" && stopTime != "" {
		rangeClause = fmt.Sprintf("range(start: time(v: \"%s\"), stop: time(v: \"%s\"))", startTime, stopTime)
	} else {
		rangeClause = fmt.Sprintf("range(start: -%s)", durationRange)
	}

	var clusterFilter string
	if cluster != "" {
		clusterFilter = fmt.Sprintf(`|> filter(fn: (r) => r["cluster"] == "%s")`, cluster)
	}
	var namespaceFilter string
	if namespace != "" {
		namespaceFilter = fmt.Sprintf(`|> filter(fn: (r) => r["namespace"] == "%s")`, namespace)
	}

	// Flux query parameterized to prevent injection
	fluxQuery := fmt.Sprintf(`
		from(bucket: "%s")
			|> %s
			|> filter(fn: (r) => r["_measurement"] == "%s")
			|> filter(fn: (r) => r["test_run_id"] == "%s" or r["testrun"] == "%s" or r["scenario"] == "%s" or r["job_name"] == "%s")
			%s
			%s
			|> filter(fn: (r) => r["_field"] == "value")
			|> aggregateWindow(every: 5s, fn: mean, createEmpty: false)
			|> yield(name: "mean")
	`, s.bucket, rangeClause, metricName, testRunID, testRunID, testRunID, testRunID, clusterFilter, namespaceFilter)

	result, err := queryAPI.Query(ctx, fluxQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to query InfluxDB: %w", err)
	}
	defer result.Close()

	points := make([]TestMetricPoint, 0)
	for result.Next() {
		val, ok := result.Record().Value().(float64)
		if !ok {
			// fallback/casting if integer
			if intVal, okInt := result.Record().Value().(int64); okInt {
				val = float64(intVal)
			} else {
				continue
			}
		}

		points = append(points, TestMetricPoint{
			Timestamp: result.Record().Time(),
			Metric:    result.Record().Measurement(),
			Value:     val,
		})
	}

	if result.Err() != nil {
		return nil, fmt.Errorf("error during query iteration: %w", result.Err())
	}

	return points, nil
}

func (s *MetricsService) queryV1Metrics(ctx context.Context, testRunID string, metricName string, durationRange string, startTime string, stopTime string, cluster string, namespace string) ([]TestMetricPoint, error) {
	// Map metrics duration syntax
	var timeFilter string
	if startTime != "" && stopTime != "" {
		timeFilter = fmt.Sprintf("time >= '%s' AND time <= '%s'", startTime, stopTime)
	} else {
		timeFilter = fmt.Sprintf("time > now() - %s", durationRange)
	}

	var tagFilters string
	if cluster != "" {
		tagFilters += fmt.Sprintf(" AND cluster = '%s'", cluster)
	}
	if namespace != "" {
		tagFilters += fmt.Sprintf(" AND namespace = '%s'", namespace)
	}

	q := fmt.Sprintf(`SELECT mean(value) FROM "%s" WHERE (test_run_id = '%s' OR testrun = '%s' OR scenario = '%s' OR job_name = '%s')%s AND %s GROUP BY time(5s) fill(none)`, metricName, testRunID, testRunID, testRunID, testRunID, tagFilters, timeFilter)

	u, err := url.Parse(s.url)
	if err != nil {
		return nil, err
	}
	u.Path = "/query"

	params := url.Values{}
	params.Set("db", s.bucket)
	params.Set("q", q)
	u.RawQuery = params.Encode()

	req, err := http.NewRequestWithContext(ctx, s.method, u.String(), nil)
	if err != nil {
		return nil, err
	}

	if s.username != "" || s.password != "" {
		req.SetBasicAuth(s.username, s.password)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("influxdb query failed with status %d", resp.StatusCode)
	}

	var result struct {
		Results []struct {
			Series []struct {
				Name    string          `json:"name"`
				Columns []string        `json:"columns"`
				Values  [][]interface{} `json:"values"`
			} `json:"series"`
		} `json:"results"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	var points []TestMetricPoint
	if len(result.Results) > 0 && len(result.Results[0].Series) > 0 {
		series := result.Results[0].Series[0]
		timeIdx, valIdx := -1, -1
		for idx, col := range series.Columns {
			if col == "time" {
				timeIdx = idx
			} else if col == "mean" || col == "value" {
				valIdx = idx
			}
		}

		if timeIdx != -1 && valIdx != -1 {
			for _, row := range series.Values {
				if len(row) <= valIdx || len(row) <= timeIdx {
					continue
				}
				timeStr, okTime := row[timeIdx].(string)
				if !okTime {
					continue
				}
				t, err := time.Parse(time.RFC3339, timeStr)
				if err != nil {
					t, err = time.Parse("2006-01-02T15:04:05Z", timeStr)
					if err != nil {
						continue
					}
				}

				var val float64
				switch v := row[valIdx].(type) {
				case float64:
					val = v
				case float32:
					val = float64(v)
				case int64:
					val = float64(v)
				case int:
					val = float64(v)
				default:
					continue
				}

				points = append(points, TestMetricPoint{
					Timestamp: t,
					Metric:    metricName,
					Value:     val,
				})
			}
		}
	}

	return points, nil
}

// ListTestRuns aggregates K6 metadata to return list of recorded performance test runs
func (s *MetricsService) ListTestRuns(ctx context.Context) ([]TestRunSummary, error) {
	if s.url == "" {
		return []TestRunSummary{}, nil
	}

	if s.version == "v1" {
		return s.listV1TestRuns(ctx)
	}

	if s.client == nil {
		return []TestRunSummary{}, nil
	}

	queryAPI := s.client.QueryAPI(s.org)

	fluxQuery := fmt.Sprintf(`
		from(bucket: "%s")
			|> range(start: -30d)
			|> filter(fn: (r) => r["_measurement"] == "vus" or r["_measurement"] == "http_req_duration")
			|> group(columns: ["test_run_id", "testrun", "scenario", "job_name", "_measurement", "cluster", "namespace"])
			|> mean()
	`, s.bucket)

	result, err := queryAPI.Query(ctx, fluxQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to query InfluxDB: %w", err)
	}
	defer result.Close()

	runsMap := make(map[string]*TestRunSummary)
	for result.Next() {
		record := result.Record()
		runIDObj := record.ValueByKey("test_run_id")
		if runIDObj == nil {
			runIDObj = record.ValueByKey("testrun")
		}
		if runIDObj == nil {
			runIDObj = record.ValueByKey("scenario")
		}
		if runIDObj == nil {
			runIDObj = record.ValueByKey("job_name")
		}
		if runIDObj == nil {
			continue
		}
		runID := fmt.Sprintf("%v", runIDObj)
		if runID == "" {
			continue
		}

		var clusterVal, namespaceVal string
		if cObj := record.ValueByKey("cluster"); cObj != nil {
			clusterVal = fmt.Sprintf("%v", cObj)
		}
		if nsObj := record.ValueByKey("namespace"); nsObj != nil {
			namespaceVal = fmt.Sprintf("%v", nsObj)
		}

		key := fmt.Sprintf("%s|%s|%s", runID, clusterVal, namespaceVal)
		summary, ok := runsMap[key]
		if !ok {
			summary = &TestRunSummary{
				TestRunID: runID,
				StartTime: record.Time(),
				Cluster:   clusterVal,
				Namespace: namespaceVal,
			}
			runsMap[key] = summary
		}

		val, _ := record.Value().(float64)
		if record.Measurement() == "vus" {
			summary.MaxVUs = val
		} else if record.Measurement() == "http_req_duration" {
			summary.AvgReqDur = val
		}
	}

	var runs []TestRunSummary
	for _, summary := range runsMap {
		runs = append(runs, *summary)
	}

	if len(runs) == 0 {
		return []TestRunSummary{}, nil
	}

	return runs, nil
}

func (s *MetricsService) listV1TestRuns(ctx context.Context) ([]TestRunSummary, error) {
	q := `SELECT first(value) FROM "vus" WHERE time > now() - 30d GROUP BY test_run_id, testrun, scenario, job_name, cluster, namespace; ` +
		`SELECT last(value) FROM "vus" WHERE time > now() - 30d GROUP BY test_run_id, testrun, scenario, job_name, cluster, namespace; ` +
		`SELECT max(value) FROM "vus" WHERE time > now() - 30d GROUP BY test_run_id, testrun, scenario, job_name, cluster, namespace; ` +
		`SELECT mean(value) FROM "http_req_duration" WHERE time > now() - 30d GROUP BY test_run_id, testrun, scenario, job_name, cluster, namespace`

	u, err := url.Parse(s.url)
	if err != nil {
		return nil, err
	}
	u.Path = "/query"

	params := url.Values{}
	params.Set("db", s.bucket)
	params.Set("q", q)
	u.RawQuery = params.Encode()

	req, err := http.NewRequestWithContext(ctx, s.method, u.String(), nil)
	if err != nil {
		return nil, err
	}

	if s.username != "" || s.password != "" {
		req.SetBasicAuth(s.username, s.password)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("influxdb list runs failed with status %d", resp.StatusCode)
	}

	var result struct {
		Results []struct {
			Series []struct {
				Name    string            `json:"name"`
				Tags    map[string]string `json:"tags"`
				Columns []string          `json:"columns"`
				Values  [][]interface{}   `json:"values"`
			} `json:"series"`
		} `json:"results"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	runsMap := make(map[string]*TestRunSummary)

	extractRunID := func(tags map[string]string) string {
		if runID := tags["test_run_id"]; runID != "" {
			return runID
		}
		if runID := tags["testrun"]; runID != "" {
			return runID
		}
		if runID := tags["scenario"]; runID != "" {
			return runID
		}
		if runID := tags["job_name"]; runID != "" {
			return runID
		}
		return ""
	}

	extractClusterNamespace := func(tags map[string]string) (string, string) {
		return tags["cluster"], tags["namespace"]
	}

	parseTime := func(val interface{}) (time.Time, bool) {
		if str, ok := val.(string); ok {
			if t, err := time.Parse(time.RFC3339, str); err == nil {
				return t, true
			}
		}
		return time.Time{}, false
	}

	parseFloat := func(val interface{}) (float64, bool) {
		switch v := val.(type) {
		case float64:
			return v, true
		case float32:
			return float64(v), true
		case int64:
			return float64(v), true
		case int:
			return float64(v), true
		case json.Number:
			if f, err := v.Float64(); err == nil {
				return f, true
			}
		}
		return 0, false
	}

	// 1. Process statement 0: Start times
	if len(result.Results) > 0 && len(result.Results[0].Series) > 0 {
		for _, series := range result.Results[0].Series {
			runID := extractRunID(series.Tags)
			if runID == "" || len(series.Values) == 0 {
				continue
			}
			cluster, namespace := extractClusterNamespace(series.Tags)
			key := fmt.Sprintf("%s|%s|%s", runID, cluster, namespace)
			timeIdx := -1
			for idx, col := range series.Columns {
				if col == "time" {
					timeIdx = idx
					break
				}
			}
			if timeIdx != -1 && len(series.Values[0]) > timeIdx {
				if startTime, ok := parseTime(series.Values[0][timeIdx]); ok {
					runsMap[key] = &TestRunSummary{
						TestRunID: runID,
						StartTime: startTime,
						Cluster:   cluster,
						Namespace: namespace,
					}
				}
			}
		}
	}

	// 2. Process statement 1: Stop times and calculate duration
	if len(result.Results) > 1 && len(result.Results[1].Series) > 0 {
		for _, series := range result.Results[1].Series {
			runID := extractRunID(series.Tags)
			cluster, namespace := extractClusterNamespace(series.Tags)
			key := fmt.Sprintf("%s|%s|%s", runID, cluster, namespace)
			summary, exists := runsMap[key]
			if !exists || len(series.Values) == 0 {
				continue
			}
			timeIdx := -1
			for idx, col := range series.Columns {
				if col == "time" {
					timeIdx = idx
					break
				}
			}
			if timeIdx != -1 && len(series.Values[0]) > timeIdx {
				if stopTime, ok := parseTime(series.Values[0][timeIdx]); ok {
					diff := stopTime.Sub(summary.StartTime).Seconds()
					if diff < 0 {
						diff = 0
					}
					summary.Duration = diff
				}
			}
		}
	}

	// 3. Process statement 2: Max VUs
	if len(result.Results) > 2 && len(result.Results[2].Series) > 0 {
		for _, series := range result.Results[2].Series {
			runID := extractRunID(series.Tags)
			cluster, namespace := extractClusterNamespace(series.Tags)
			key := fmt.Sprintf("%s|%s|%s", runID, cluster, namespace)
			summary, exists := runsMap[key]
			if !exists || len(series.Values) == 0 {
				continue
			}
			valIdx := -1
			for idx, col := range series.Columns {
				if col == "max" {
					valIdx = idx
					break
				}
			}
			if valIdx != -1 && len(series.Values[0]) > valIdx {
				if maxVUs, ok := parseFloat(series.Values[0][valIdx]); ok {
					summary.MaxVUs = maxVUs
				}
			}
		}
	}

	// 4. Process statement 3: Average Latency
	if len(result.Results) > 3 && len(result.Results[3].Series) > 0 {
		for _, series := range result.Results[3].Series {
			runID := extractRunID(series.Tags)
			cluster, namespace := extractClusterNamespace(series.Tags)
			key := fmt.Sprintf("%s|%s|%s", runID, cluster, namespace)
			summary, exists := runsMap[key]
			if !exists || len(series.Values) == 0 {
				continue
			}
			valIdx := -1
			for idx, col := range series.Columns {
				if col == "mean" {
					valIdx = idx
					break
				}
			}
			if valIdx != -1 && len(series.Values[0]) > valIdx {
				if avgReq, ok := parseFloat(series.Values[0][valIdx]); ok {
					summary.AvgReqDur = avgReq
				}
			}
		}
	}

	var summaries []TestRunSummary
	for _, summary := range runsMap {
		summaries = append(summaries, *summary)
	}

	return summaries, nil
}
