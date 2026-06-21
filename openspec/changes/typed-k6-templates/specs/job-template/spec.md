## ADDED Requirements

### Requirement: Job template deploys one-off Kubernetes Job

A template with `template_type` = `job` SHALL be deployable as a single `batch/v1` Job for immediate execution ("Run Now" on the Schedules page). The Job MUST NOT include TestRun parallelism.

#### Scenario: Run Now from job template

- **WHEN** a user clicks Run Now with a `job` template selected on the Schedules page
- **THEN** the cluster receives a `batch/v1` Job (not a CronJob or TestRun)

#### Scenario: Job template excluded from TestRun deploy

- **WHEN** a user opens the Add Test form on the CRDs page
- **THEN** `job` templates do not appear in the template dropdown

### Requirement: Job template supports ConfigMap provisioning

When deploying a `job` template with inline `script_content`, the system SHALL create or update a ConfigMap in the target namespace before creating the Job. When `script_content` is empty, the system SHALL reference `script_name` as an existing ConfigMap.

#### Scenario: Inline script creates ConfigMap for Job

- **WHEN** a `job` template with `script_content` is deployed via Run Now
- **THEN** a ConfigMap is applied and the Job container references the script ConfigMap

### Requirement: Job template has no parallelism or schedule fields

`job` templates MUST NOT accept `parallelism`, `schedule_enabled`, or `schedule_cron_expression`. The Settings form and API MUST reject these fields for `job` type.

#### Scenario: Job template rejects parallelism

- **WHEN** a client saves a `job` template with `parallelism` > 1
- **THEN** the API returns HTTP 400

### Requirement: Job template carries resource and runner settings

Job templates SHALL apply `cpu_limit`, `mem_limit`, and optional `runner_image` to the Job container, consistent with current batch workload deploy behavior.

#### Scenario: Resource limits on Job

- **WHEN** a `job` template with resource limits is deployed via Run Now
- **THEN** the Job pod spec includes the configured CPU and memory limits
