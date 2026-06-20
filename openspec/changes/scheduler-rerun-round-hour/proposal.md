## Why

Scheduled K6s reruns should be predictable and clearly traceable to their source test. Today, users cannot rely on consistent naming for scheduler-triggered reruns, and schedules can start at arbitrary minutes, which reduces the readability of run histories. This change makes scheduled reruns explicitly preserve the original test name plus a timestamp, and constrains schedules to start at round hours for clarity.

## What Changes

- Scheduled reruns will always use the original test name with a `yyyy-mm-dd-hh-mm` suffix.
- An internal scheduler will re-execute tests based on stored schedules using this naming format.
- Schedule creation and edits will enforce a round-hour constraint (minute field must be `0`).

## Capabilities

### New Capabilities
- `scheduled-rerun-naming`: Scheduler-triggered reruns preserve the original test name and append a `yyyy-mm-dd-hh-mm` timestamp.
- `round-hour-schedule-validation`: Schedule cron expressions must start at a round hour (minute field `0`).

### Modified Capabilities
- (none)

## Impact

- Backend scheduler and test-run creation logic.
- Schedule create/update validation in the frontend (and possibly backend API).
- User-visible run names in the UI and any downstream reporting that relies on naming.
