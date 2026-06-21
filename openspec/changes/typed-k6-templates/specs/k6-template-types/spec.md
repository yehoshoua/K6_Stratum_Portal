## ADDED Requirements

### Requirement: Every template has a type discriminator

The system SHALL store a required `template_type` on each K6 template. Allowed values are `cronjob`, `job`, and `testrun`. The API MUST reject create/update requests with missing or unknown `template_type`.

#### Scenario: Create template without type

- **WHEN** a client POSTs a new template without `template_type`
- **THEN** the API returns HTTP 400 with an error indicating `template_type` is required

#### Scenario: Create template with valid type

- **WHEN** a client POSTs a new template with `template_type` set to `cronjob`, `job`, or `testrun`
- **THEN** the API persists the template and returns it including `template_type`

### Requirement: Shared template fields across all types

All template types SHALL support: `name`, `script_name`, `script_file`, `script_content` (optional when referencing existing ConfigMap), `cpu_limit`, `mem_limit`, and `runner_image` (optional). Templates MUST require either non-empty `script_content` or a non-empty `script_name` referencing an existing ConfigMap.

#### Scenario: Inline script content

- **WHEN** a template is saved with non-empty `script_content`
- **THEN** deploy flows MAY create or update a ConfigMap using `script_name` and `script_file`

#### Scenario: Reference existing ConfigMap

- **WHEN** a template is saved with empty `script_content` and non-empty `script_name`
- **THEN** deploy flows MUST reference the existing ConfigMap by name without requiring inline content

### Requirement: Parallelism is type-restricted

The system MUST accept `parallelism` only on `testrun` templates. Create and update handlers MUST reject `parallelism` greater than 0 on `cronjob` and `job` templates.

#### Scenario: CronJob template with parallelism

- **WHEN** a client saves a `cronjob` template with `parallelism` > 1
- **THEN** the API returns HTTP 400

#### Scenario: TestRun template requires parallelism

- **WHEN** a client saves a `testrun` template with `parallelism` < 1
- **THEN** the API returns HTTP 400

### Requirement: Settings UI shows type-specific forms

The Settings K6 Templates section SHALL provide a type selector when creating or editing a template. Fields not applicable to the selected type MUST be hidden or disabled (e.g., parallelism hidden for `cronjob` and `job`; schedule fields shown only for `testrun`).

#### Scenario: Switch type in create modal

- **WHEN** a user selects `cronjob` in the template type selector
- **THEN** the parallelism input is not shown

#### Scenario: Template list shows type badge

- **WHEN** a user views the template list in Settings
- **THEN** each row displays a badge for `cronjob`, `job`, or `testrun`

### Requirement: Consumers filter templates by compatible type

The CRDs page SHALL offer only `testrun` templates in its template picker. The Schedules page SHALL offer `cronjob` templates when scheduling and `job` templates when running immediately.

#### Scenario: CRDs page template picker

- **WHEN** a user opens the Add Test form on the CRDs page
- **THEN** only templates with `template_type` = `testrun` appear in the template dropdown

#### Scenario: Schedules page cron template picker

- **WHEN** a user creates a CronJob schedule
- **THEN** only templates with `template_type` = `cronjob` appear in the template dropdown

### Requirement: Legacy templates are migrated

Existing rows in `k6_templates` without `template_type` SHALL be migrated to `testrun` with their existing `parallelism` preserved.

#### Scenario: Database migration on startup

- **WHEN** the backend starts after upgrade
- **THEN** all templates with null or empty `template_type` are set to `testrun`
