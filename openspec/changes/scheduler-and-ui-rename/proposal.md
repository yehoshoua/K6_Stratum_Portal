## Why

The Schedules and CRDs sections need improved naming clarity and missing functionality:

1. **Confusing labels** — "K6 Operator CRDs" is technical jargon; "Schedules" is too generic. Users think in terms of "TestRuns", "CronJobs" and "Jobs".
2. **No schedule editing** — Users must delete and recreate a schedule to change any field (cron expression, cluster, template, etc.). An Edit button is needed.
3. **Re-execution naming** — Scheduled and relaunched TestRuns already use `{name}_{YYYY_MM_DD_HH_MM}` naming. The cron expression constraint (schedules must start at a round hour like `0 11 * * *`) needs frontend enforcement to align with the naming convention that only captures hour-level granularity.

## What Changes

- **Rename sidebar section** "K6 Operator CRDs" → "K6s TestRun CRDs" across all 4 languages (EN, FR, HE, ZH)
- **Rename sidebar section** "Schedules" → "CronJob / Job" across all 4 languages
- **Update page titles** to match the new sidebar labels
- **Add Edit button** to each CronJob card on the schedules page — opens a pre-filled form/modal to update name, cluster, namespace, template, cron expression, and active status
- **Add backend PUT endpoint** `PUT /api/settings/schedules/{id}` calling the existing `SaveSchedule()` DB method (which already supports UPDATE when `ID > 0`)
- **Enforce round-hour cron constraint** — frontend validation that the minute field of the cron expression must be `0` (e.g., `0 11 * * *` is valid, `30 11 * * *` is rejected)
- **Confirm existing TestRun naming format** `{original-name}_{yyyy_mm_dd_hh_mm}` is preserved across scheduled runs and relaunches

## Capabilities

### New Capabilities
- `schedule-edit`: Edit existing CronJob schedules (name, cluster, namespace, template, cron expression, active status) via a new Edit button and backend endpoint
- `round-hour-cron-validation`: Frontend validation enforcing that scheduled tests must start at a round hour (minute field = 0)

### Modified Capabilities
_(no existing specs to modify — specs directory is empty)_

## Impact

- **Frontend files:**
  - `frontend/src/components/PreferencesContext.tsx` — update `crdControl` and `schedules` translation strings in all 4 language blocks
  - `frontend/src/i18n/strings.ts` — update schedule-related strings, add new edit-related strings
  - `frontend/src/app/schedules/page.tsx` — add Edit button, edit modal/form, round-hour validation
  - `frontend/src/services/api.ts` — add `updateSchedule()` method
- **Backend files:**
  - `backend/internal/server/server.go` — add `PUT /api/settings/schedules/{id}` route and handler
  - `backend/internal/database/database.go` — no changes needed (`SaveSchedule` already supports update)
- **No breaking changes** — all existing API endpoints and behavior remain unchanged
- **No database migration** — existing `test_schedules` schema is sufficient
