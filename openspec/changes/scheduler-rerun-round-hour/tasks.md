## 1. Scheduler Rerun Naming

- [x] 1.1 Update the timestamp format used by `buildTestRunNames` to `yyyy-mm-dd-hh-mm`
- [x] 1.2 Update the suffix regex and any related helpers that parse run names
- [ ] 1.3 Verify scheduler-triggered TestRuns use the schedule name plus the new suffix

## 2. Round-Hour Validation (Backend)

- [x] 2.1 Add a round-hour cron validation helper (minute field must be `0`)
- [x] 2.2 Enforce validation in the schedule create handler
- [x] 2.3 Add or update the schedule update endpoint to validate and save edits

## 3. Round-Hour Validation (Frontend)

- [x] 3.1 Add client-side round-hour validation and error messaging for schedule create
- [ ] 3.2 Apply the same validation to schedule edits (when available via UI/API)

## 4. Verification

- [ ] 4.1 Validate scheduled rerun names follow `name_yyyy-mm-dd-hh-mm` format
- [ ] 4.2 Confirm round-hour cron expressions are accepted and non-round-hour ones rejected
