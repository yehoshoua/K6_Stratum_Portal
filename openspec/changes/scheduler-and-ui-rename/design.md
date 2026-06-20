## Context

K6 Stratos has an in-process Go cron scheduler (`github.com/robfig/cron/v3`) that ticks every 30 seconds and creates K6 `TestRun` CRDs when cron expressions match. Schedules are stored in `test_schedules` (SQLite/PostgreSQL) and managed via the Schedules page. The sidebar uses translation keys from `PreferencesContext.tsx` with 4 languages (EN, FR, HE, ZH).

Current gaps:
- The sidebar labels "K6 Operator CRDs" and "Schedules" are unclear — users work with TestRuns, CronJobs, and Jobs
- Schedules have no edit functionality — the DB `SaveSchedule()` method already supports UPDATE when `ID > 0`, but no API endpoint or UI exposes it
- Cron expressions accept any valid format, but the TestRun naming convention `{name}_{YYYY_MM_DD_HH_MM}` implies round-hour alignment for clarity

## Goals / Non-Goals

**Goals:**
- Rename "K6 Operator CRDs" → "K6s TestRun CRDs" and "Schedules" → "CronJob / Job" in sidebar + page titles across all 4 languages
- Add an Edit button per CronJob card that opens an edit modal with pre-filled fields
- Add `PUT /api/settings/schedules/{id}` backend route calling existing `SaveSchedule()`
- Enforce round-hour cron validation (minute field must be `0`) in the frontend form

**Non-Goals:**
- Changing the internal scheduling engine (Go cron ticker stays as-is)
- Changing the TestRun naming format (`{name}_{YYYY_MM_DD_HH_MM}` is kept)
- Backend cron expression validation (frontend-only enforcement to keep it simple)
- Editing the name of already-deployed K8s resources
- Changes to the CRDs page relaunch mechanism

## Decisions

### 1. Edit via modal, not inline

**Decision:** Edit opens a modal dialog pre-filled with the schedule's current values (same layout as the create form).

**Rationale:** The create form is in a left-column card. Reusing the same form layout in a modal avoids layout confusion (user isn't editing in the create form). Modal pattern is already used elsewhere in the app (confirmation dialogs).

**Alternative considered:** Inline editing (click field to edit). Rejected — too many fields to edit inline cleanly.

### 2. Frontend-only cron validation

**Decision:** Validate the minute field of the cron expression equals `0` in the frontend before submit. Show a user-friendly error message.

**Rationale:** The backend already validates that cron has 5 fields (server.go). Adding round-hour validation server-side would be a breaking change for existing schedules and the API. Frontend-only keeps it advisory and non-breaking.

**Alternative considered:** Backend validation with a bypass flag. Rejected — over-engineering for a UX preference.

### 3. Reuse existing `SaveSchedule()` DB method

**Decision:** The new `PUT /api/settings/schedules/{id}` handler reads the schedule from request body, sets `sched.ID` from the URL, and calls `db.SaveSchedule()`.

**Rationale:** `SaveSchedule()` already does `UPDATE ... WHERE id = ?` when `s.ID > 0`. Zero code change in the database layer.

### 4. Translation key names unchanged

**Decision:** Keep the existing translation keys `crdControl` and `schedules` — only change their string values.

**Rationale:** Renaming keys would touch every file that calls `t('crdControl')` or `t('schedules')`. Changing values is safer and simpler.

## Risks / Trade-offs

- **Existing schedules with non-round-hour cron** → Frontend validation only applies on create/edit. Existing schedules keep their cron expressions. No data migration needed.
- **Translation consistency** → Need to update all 4 language blocks atomically. Missing one language would create an inconsistent UI.
- **Edit endpoint RBAC** → Must enforce editor/admin role check consistent with create/delete handlers.
