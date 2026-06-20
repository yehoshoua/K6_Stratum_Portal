## ADDED Requirements

### Requirement: Configure default output arguments
The system SHALL allow administrators to configure default output arguments that apply to new TestRun, CronJob, and Job executions.

#### Scenario: Save output argument defaults
- **WHEN** an administrator saves a default output argument value in Settings
- **THEN** the system persists the value and uses it as the default output argument for subsequent runs

### Requirement: Configure default runner image base path
The system SHALL allow administrators to configure a default runner image base path and resolve it against the destination cluster AWS account ID and region during execution.

#### Scenario: Resolve default image for a cluster
- **WHEN** a run is created for a cluster with AWS account ID and region
- **THEN** the runner image path is resolved to that cluster's ECR registry using the configured base image path

### Requirement: Configure default environment variables
The system SHALL allow administrators to define a list of default environment variable key/value pairs that apply to new TestRun, CronJob, and Job executions.

#### Scenario: Apply default environment variables
- **WHEN** a run is created with default environment variables configured
- **THEN** the runner container includes all configured default key/value pairs
