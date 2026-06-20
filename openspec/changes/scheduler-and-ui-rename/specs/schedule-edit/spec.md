## ADDED Requirements

### Requirement: Edit existing schedule
The system SHALL allow users with editor or administrator role to edit an existing CronJob schedule. The editable fields are: name, cluster, namespace, template, cron expression, and active status.

#### Scenario: Edit button visible for non-viewer users
- **WHEN** a user with editor or administrator role views the CronJob list
- **THEN** each CronJob card SHALL display an Edit button (pencil icon) alongside Run, Toggle, and Delete buttons

#### Scenario: Edit button hidden for viewers
- **WHEN** a user with viewer role views the CronJob list
- **THEN** no Edit button SHALL be displayed

#### Scenario: Opening the edit modal
- **WHEN** the user clicks the Edit button on a CronJob card
- **THEN** a modal dialog SHALL open with all fields pre-filled with the schedule's current values (name, cluster, namespace, template, cron expression, active status)

#### Scenario: Saving edits successfully
- **WHEN** the user modifies fields in the edit modal and clicks Save
- **THEN** the system SHALL send a `PUT /api/settings/schedules/{id}` request with the updated fields
- **AND** on success, the CronJob list SHALL refresh to reflect the changes
- **AND** a success toast/message SHALL be displayed

#### Scenario: Saving edits with validation error
- **WHEN** the user submits the edit form with missing required fields
- **THEN** the system SHALL display an error message and NOT submit the request

#### Scenario: Backend update endpoint
- **WHEN** the backend receives `PUT /api/settings/schedules/{id}` with a valid JSON body
- **THEN** the backend SHALL update the schedule in the database using the existing `SaveSchedule()` method
- **AND** the backend SHALL enforce editor or administrator role via middleware
- **AND** the backend SHALL return the updated schedule as JSON

#### Scenario: Cancelling the edit
- **WHEN** the user clicks Cancel or closes the edit modal
- **THEN** no changes SHALL be persisted and the modal SHALL close
