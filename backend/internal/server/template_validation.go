package server

import (
	"fmt"
	"strings"

	"k6-bedrock-dashboard/backend/internal/database"
)

func validateK6Template(t *database.K6Template) error {
	if t == nil {
		return fmt.Errorf("template is required")
	}
	if strings.TrimSpace(t.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if strings.TrimSpace(t.ScriptName) == "" {
		return fmt.Errorf("script_name is required")
	}
	if strings.TrimSpace(t.ScriptFile) == "" {
		return fmt.Errorf("script_file is required")
	}
	if strings.TrimSpace(t.ScriptContent) == "" && strings.TrimSpace(t.ScriptName) == "" {
		return fmt.Errorf("script_content or script_name is required")
	}
	if strings.TrimSpace(t.CPULimit) == "" || strings.TrimSpace(t.MemLimit) == "" {
		return fmt.Errorf("cpu_limit and mem_limit are required")
	}

	templateType := strings.ToLower(strings.TrimSpace(t.TemplateType))
	if templateType == "" {
		templateType = database.TemplateTypeTestRun
		t.TemplateType = templateType
	}
	switch templateType {
	case database.TemplateTypeCronJob, database.TemplateTypeJob, database.TemplateTypeTestRun:
	default:
		return fmt.Errorf("template_type must be cronjob, job, or testrun")
	}

	switch templateType {
	case database.TemplateTypeTestRun:
		if t.Parallelism < 1 {
			return fmt.Errorf("parallelism must be at least 1 for testrun templates")
		}
		if t.ScheduleEnabled {
			if strings.TrimSpace(t.ScheduleCronExpression) == "" {
				return fmt.Errorf("schedule_cron_expression is required when schedule is enabled")
			}
			if len(strings.Fields(t.ScheduleCronExpression)) != 5 {
				return fmt.Errorf("invalid cron expression (must be exactly 5 fields)")
			}
			if !isRoundHourCron(t.ScheduleCronExpression) {
				return fmt.Errorf("schedules must start at a round hour (minute field must be 0)")
			}
			if strings.TrimSpace(t.ScheduleClusterID) == "" {
				return fmt.Errorf("schedule_cluster_id is required when schedule is enabled")
			}
			if strings.TrimSpace(t.ScheduleNamespace) == "" {
				return fmt.Errorf("schedule_namespace is required when schedule is enabled")
			}
		} else {
			t.ScheduleCronExpression = ""
			t.ScheduleClusterID = ""
			t.ScheduleNamespace = ""
			t.ScheduleActive = false
		}
	case database.TemplateTypeCronJob, database.TemplateTypeJob:
		if t.Parallelism > 0 {
			return fmt.Errorf("parallelism is not supported for %s templates", templateType)
		}
		t.Parallelism = 0
		t.ScheduleEnabled = false
		t.ScheduleCronExpression = ""
		t.ScheduleActive = false
		t.ScheduleClusterID = ""
		t.ScheduleNamespace = ""
	}

	return nil
}

func validateTestRunTemplateReference(db *database.DB, templateID string) error {
	if db == nil || strings.TrimSpace(templateID) == "" {
		return fmt.Errorf("template_id is required")
	}
	template, err := db.GetTemplate(templateID)
	if err != nil {
		return fmt.Errorf("failed to load template: %w", err)
	}
	if template == nil {
		return fmt.Errorf("template not found")
	}
	templateType := strings.ToLower(strings.TrimSpace(template.TemplateType))
	if templateType == "" {
		templateType = database.TemplateTypeTestRun
	}
	if templateType != database.TemplateTypeTestRun {
		return fmt.Errorf("only testrun templates can be used for portal-managed schedules")
	}
	return nil
}
