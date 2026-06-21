## ADDED Requirements

### Requirement: CronJob template deploys native Kubernetes CronJob

A template with `template_type` = `cronjob` SHALL be deployable as a `batch/v1` CronJob. The resulting CronJob MUST NOT set k6 TestRun parallelism in the template spec (CronJob JobTemplate uses single-pod k6 execution as today).

#### Scenario: Deploy CronJob from template

- **WHEN** a user deploys a `cronjob` template with a valid cron expression on the Schedules page
- **THEN** the cluster receives a `batch/v1` CronJob with `spec.schedule` set to the provided expression

#### Scenario: CronJob template excluded from TestRun deploy

- **WHEN** a user attempts to deploy a `cronjob` template from the CRDs (TestRun) page
- **THEN** the template is not available in the picker

### Requirement: CronJob template supports ConfigMap provisioning

When deploying a `cronjob` template with inline `script_content`, the system SHALL create or update a ConfigMap in the target namespace before creating the CronJob. When `script_content` is empty, the system SHALL reference `script_name` as an existing ConfigMap.

#### Scenario: Inline script creates ConfigMap

- **WHEN** a `cronjob` template with `script_content` is deployed
- **THEN** a ConfigMap named per `script_name` is applied in the target namespace and the CronJob Job spec references it

#### Scenario: Existing ConfigMap reference

- **WHEN** a `cronjob` template without `script_content` is deployed
- **THEN** no ConfigMap is created and the CronJob references the existing `script_name` ConfigMap

### Requirement: CronJob template carries resource and runner settings

CronJob templates SHALL apply `cpu_limit`, `mem_limit`, and optional `runner_image` to the Job template container resources and image, consistent with current batch workload deploy behavior.

#### Scenario: Resource limits applied

- **WHEN** a `cronjob` template with `cpu_limit` and `mem_limit` is deployed
- **THEN** the CronJob Job template container includes those limits

### Requirement: CronJob schedule is supplied at deploy time

The cron expression for a `cronjob` template is NOT stored on the template itself. Users MUST provide `cron_expression` when creating or editing a schedule on the Schedules page.

#### Scenario: Schedule on deploy not on template

- **WHEN** a user saves a `cronjob` template in Settings
- **THEN** no cron expression field is stored on the template record
