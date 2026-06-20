## ADDED Requirements

### Requirement: Scheduler reruns use original name with timestamp
The system SHALL create scheduler-triggered TestRuns whose display name is the schedule name plus a timestamp suffix in the format `yyyy-mm-dd-hh-mm`.

#### Scenario: Scheduler run names follow the required format
- **WHEN** a schedule named `load-test` runs at `2026-06-18 11:00` UTC
- **THEN** the TestRun display name SHALL be `load-test_2026-06-18-11-00`

#### Scenario: Schedule names are normalized for resource names
- **WHEN** a schedule named `Smoke Test` runs at `2026-06-18 11:00` UTC
- **THEN** the TestRun resource name SHALL be derived from `smoke-test_2026-06-18-11-00` using DNS-safe normalization

### Requirement: Timestamp format uses UTC with zero padding
The system SHALL format scheduler rerun timestamps using UTC time with zero-padded fields (`yyyy-mm-dd-hh-mm`).

#### Scenario: Single-digit fields are zero-padded
- **WHEN** a schedule runs at `2026-06-02 03:05` UTC
- **THEN** the TestRun display name SHALL include the suffix `2026-06-02-03-05`
