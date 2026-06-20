## ADDED Requirements

### Requirement: Round-hour cron expression enforcement
The system SHALL validate that cron expressions for scheduled tests have their minute field set to `0`, ensuring all scheduled runs start at a round hour.

#### Scenario: Valid round-hour cron expression on create
- **WHEN** a user creates a new schedule with cron expression `0 11 * * *`
- **THEN** the form SHALL accept the expression and submit successfully

#### Scenario: Invalid non-round-hour cron expression on create
- **WHEN** a user creates a new schedule with cron expression `30 11 * * *`
- **THEN** the form SHALL display an error message indicating that schedules must start at a round hour (minute field must be `0`)
- **AND** the form SHALL NOT submit the request

#### Scenario: Valid round-hour cron expression on edit
- **WHEN** a user edits an existing schedule and sets cron expression `0 */2 * * *`
- **THEN** the form SHALL accept the expression and submit successfully

#### Scenario: Invalid non-round-hour cron expression on edit
- **WHEN** a user edits an existing schedule and sets cron expression `15 8 * * 1-5`
- **THEN** the form SHALL display an error message indicating that schedules must start at a round hour
- **AND** the form SHALL NOT submit the request

#### Scenario: Existing schedules with non-round-hour cron are unaffected
- **WHEN** a schedule with cron expression `*/30 * * * *` already exists in the database
- **THEN** the schedule SHALL continue to function normally
- **AND** the CronJob list SHALL display it without error

### Requirement: UI section renaming
The system SHALL display updated section names in the sidebar navigation and page titles across all supported languages.

#### Scenario: Sidebar displays "K6s TestRun CRDs" instead of "K6 Operator CRDs"
- **WHEN** a user views the sidebar in English
- **THEN** the CRDs section link SHALL display "K6s TestRun CRDs"

#### Scenario: Sidebar displays "CronJob / Job" instead of "Schedules"
- **WHEN** a user views the sidebar in English
- **THEN** the Schedules section link SHALL display "CronJob / Job"

#### Scenario: Renamed sections in French
- **WHEN** a user switches the language to French
- **THEN** the CRDs section SHALL display "CRDs K6s TestRun"
- **AND** the Schedules section SHALL display "CronJob / Job"

#### Scenario: Renamed sections in Hebrew
- **WHEN** a user switches the language to Hebrew
- **THEN** the CRDs section SHALL display "K6s TestRun CRDs"
- **AND** the Schedules section SHALL display "CronJob / Job"

#### Scenario: Renamed sections in Chinese
- **WHEN** a user switches the language to Chinese
- **THEN** the CRDs section SHALL display "K6s TestRun CRDs"
- **AND** the Schedules section SHALL display "CronJob / Job"

#### Scenario: Page title matches sidebar label
- **WHEN** a user navigates to the CRDs page
- **THEN** the page heading SHALL display the same label as the sidebar link
- **AND** the same rule SHALL apply to the CronJob / Job page
