## ADDED Requirements

### Requirement: TestRun template deploys k6.io TestRun CRD

A template with `template_type` = `testrun` SHALL be deployable as a `k6.io/v1alpha1` TestRun. The TestRun spec MUST include `parallelism`, script ConfigMap reference, and optional runner resources/image.

#### Scenario: Deploy TestRun from template

- **WHEN** a user deploys a `testrun` template from the CRDs page
- **THEN** the cluster receives a `k6.io/v1alpha1` TestRun with `spec.parallelism` matching the template

#### Scenario: TestRun template excluded from CronJob schedule picker

- **WHEN** a user creates a CronJob on the Schedules page
- **THEN** `testrun` templates do not appear in the template dropdown

### Requirement: TestRun template requires parallelism

`testrun` templates MUST have `parallelism` >= 1. This field SHALL be required in the Settings form and API.

#### Scenario: Valid parallelism

- **WHEN** a `testrun` template is saved with `parallelism` = 4
- **THEN** the template is persisted and deploy uses parallelism 4

### Requirement: TestRun template supports ConfigMap provisioning

When deploying a `testrun` template with inline `script_content`, the system SHALL create or update a ConfigMap in the target namespace before creating the TestRun. When `script_content` is empty, the system SHALL reference `script_name` as an existing ConfigMap.

#### Scenario: Inline script creates ConfigMap for TestRun

- **WHEN** a `testrun` template with `script_content` is deployed
- **THEN** a ConfigMap is applied and the TestRun `spec.script.configMap` references it

### Requirement: TestRun template may embed a portal-managed schedule

A `testrun` template MAY optionally include `schedule_enabled`, `schedule_cron_expression`, and `schedule_active` fields. When `schedule_enabled` is true, the portal backend scheduler SHALL create TestRun CRDs on the cron schedule (same mechanism as `test_schedules` today), managed inside the portal — not as a native Kubernetes CronJob.

#### Scenario: Enable schedule on TestRun template

- **WHEN** a user saves a `testrun` template with `schedule_enabled` true and `schedule_cron_expression` = `0 11 * * *`
- **THEN** the portal persists the schedule metadata on the template and the scheduler creates TestRuns at the specified times

#### Scenario: Disable embedded schedule

- **WHEN** a user sets `schedule_enabled` false on a `testrun` template
- **THEN** the portal stops creating scheduled TestRuns for that template and does not require a cron expression

#### Scenario: Round-hour schedule validation

- **WHEN** a user enables a schedule with a cron expression whose minute field is not `0`
- **THEN** the API or frontend rejects the save with a validation error (aligned with round-hour scheduling rules)

### Requirement: Scheduled TestRun naming

TestRuns created by the portal scheduler from a `testrun` template SHALL use the existing `{base-name}_{yyyy_mm_dd_hh_mm}` naming convention and `k6s/run-name` annotation.

#### Scenario: Scheduled run name format

- **WHEN** the scheduler fires a `testrun` template named `api-load` at 2026-06-21 11:00 UTC
- **THEN** the created TestRun resource name follows `api-load_2026_06_21_11_00` (sanitized for DNS)
