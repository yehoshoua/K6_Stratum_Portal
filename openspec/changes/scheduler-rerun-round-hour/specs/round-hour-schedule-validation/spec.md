## ADDED Requirements

### Requirement: Schedule cron expressions must start on a round hour
The system SHALL accept schedule cron expressions only when the minute field is exactly `0`.

#### Scenario: Valid round-hour cron on create
- **WHEN** a user creates a schedule with cron expression `0 11 * * *`
- **THEN** the system SHALL accept the schedule

#### Scenario: Invalid non-round-hour cron on create
- **WHEN** a user creates a schedule with cron expression `30 11 * * *`
- **THEN** the system SHALL reject the request and report that schedules must start at a round hour

#### Scenario: Valid round-hour cron on edit
- **WHEN** a user edits a schedule and sets cron expression `0 */2 * * *`
- **THEN** the system SHALL accept the update

#### Scenario: Invalid non-round-hour cron on edit
- **WHEN** a user edits a schedule and sets cron expression `15 8 * * 1-5`
- **THEN** the system SHALL reject the update and report that schedules must start at a round hour

### Requirement: Existing schedules remain visible
The system SHALL continue to list existing schedules even if their cron expressions are not round-hour.

#### Scenario: Listing schedules with legacy cron expressions
- **WHEN** a schedule exists with cron expression `*/30 * * * *`
- **THEN** the schedule list SHALL display it without error
