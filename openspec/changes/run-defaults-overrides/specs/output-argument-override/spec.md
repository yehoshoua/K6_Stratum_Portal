## ADDED Requirements

### Requirement: Use default output arguments unless overridden
The system SHALL apply the configured default output arguments to TestRun, CronJob, and Job executions unless the user explicitly overrides them.

#### Scenario: Use defaults without override
- **WHEN** a user creates a run without enabling the override option
- **THEN** the system uses the default output arguments for the run

### Requirement: Allow explicit override of output arguments
The system SHALL allow users to provide custom output arguments that override the default output arguments.

#### Scenario: Override default output arguments
- **WHEN** a user enables the override option and supplies a custom output argument
- **THEN** the system uses the custom output argument instead of the default

### Requirement: Update override label text
The system SHALL label the override option as “Overwrite default argument” for TestRun, CronJob, and Job creation.

#### Scenario: Display override label
- **WHEN** the run creation modal renders
- **THEN** the output argument override option is labeled “Overwrite default argument”
