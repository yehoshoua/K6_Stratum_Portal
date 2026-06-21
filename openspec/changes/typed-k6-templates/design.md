## Context

Today `k6_templates` is a single flat model used everywhere: Settings, CRDs page (TestRun deploy), and Schedules page (CronJob/Job deploy). Every template exposes parallelism even though native `batch/v1` CronJobs and Jobs do not use k6 operator parallelism. Scheduling exists in two parallel paths:

```
CURRENT STATE
═══════════════════════════════════════════════════════════════

  Settings: K6Template (one shape)
         │
         ├──────────────────┬─────────────────────┐
         ▼                  ▼                     ▼
   CRDs page           Schedules page      scheduler.go
   TestRun CRD         CronJob / Job       test_schedules
   (parallelism ✓)     (parallelism ✗      → TestRun CRD
                        but shown in UI ✓)   (parallelism ✓)
```

The user wants three explicit template types with clear field boundaries:

| Field / behavior        | cronjob | job | testrun |
|-------------------------|---------|-----|---------|
| Parallelism             | ✗       | ✗   | ✓       |
| Inline ConfigMap create | ✓       | ✓   | ✓       |
| Portal-managed schedule | ✗       | ✗   | ✓ (optional) |
| Native K8s CronJob      | ✓       | ✗   | ✗       |
| One-off Job             | ✗       | ✓   | ✗       |
| k6.io TestRun           | ✗       | ✗   | ✓       |

## Goals / Non-Goals

**Goals:**

- Add `template_type` discriminator (`cronjob` | `job` | `testrun`) to DB, API, and UI
- Type-specific Settings forms and consumer filtering
- Preserve ConfigMap inline-or-reference behavior for all types
- Allow optional portal-managed schedule only on `testrun` templates
- Migrate existing templates to `testrun` without data loss

**Non-Goals:**

- Replacing native K8s CronJob scheduling on the Schedules page (that remains `cronjob` templates)
- Changing TestRun naming convention or scheduler leader-election model
- Merging `test_schedules` table into templates in this change (see Decision 3)
- SLA threshold behavior changes

## Decisions

### 1. Type enum and validation at API boundary

Add `template_type` to `database.K6Template` and validate in `handleCreateTemplate` / `handleUpdateTemplate`:

- `testrun`: `parallelism >= 1` required; schedule fields optional
- `cronjob` / `job`: `parallelism` must be 0 or omitted (stored as 0); schedule fields rejected

**Alternative considered:** infer type from deploy context only (no DB field). Rejected — Settings must show type before deploy and filter pickers.

### 2. ConfigMap provisioning stays in deploy paths

Reuse existing `applyConfigMap` pattern from `scheduler.go` and `server.go` deploy handler:

- If `script_content` non-empty → upsert ConfigMap (`script_name`, `script_file`)
- Else → use existing `script_name` reference

All three types share this logic; extract a small helper if duplication grows.

### 3. TestRun schedule: columns on template + scheduler extension

Embed optional schedule on `testrun` templates with new columns:

- `schedule_enabled` (bool)
- `schedule_cron_expression` (string)
- `schedule_active` (bool)
- `schedule_cluster_id` (string, required when schedule enabled)
- `schedule_namespace` (string, required when schedule enabled)

Extend `scheduler.go` poll loop to also evaluate enabled `testrun` templates (in addition to existing `test_schedules` rows for backward compatibility).

**Alternative considered:** only use `test_schedules` and link via `template_id`. Kept for existing data; new embedded schedule is template-native per user request.

**Alternative considered:** K8s CronJob for TestRun schedules. Rejected — user explicitly wants portal-internal management creating TestRun CRDs.

### 4. CronJob / Job cron expression stays on Schedules page

`cronjob` templates do NOT store cron expressions. Users pick a `cronjob` template on Schedules and provide `cron_expression` at schedule creation (current behavior).

`job` templates are Run Now only — no cron fields anywhere.

### 5. UI type selector drives conditional fields

Settings template modal:

```
┌─────────────────────────────────────┐
│ Type: [ CronJob ▼ | Job | TestRun ] │
├─────────────────────────────────────┤
│ name, script, resources, image      │  ← all types
│ parallelism                         │  ← testrun only
│ schedule (cron, cluster, ns, active)│  ← testrun only, collapsible
└─────────────────────────────────────┘
```

Consumer filtering:

- `crds/page.tsx` → `templates.filter(t => t.template_type === 'testrun')`
- `schedules/page.tsx` cron flow → `template_type === 'cronjob'`
- `schedules/page.tsx` run now → `template_type === 'job'`

### 6. Migration: default existing rows to `testrun`

On `createTables` / migration step:

```sql
UPDATE k6_templates SET template_type = 'testrun' WHERE template_type IS NULL OR template_type = '';
```

Preserves parallelism and scheduler compatibility for all legacy templates.

## Risks / Trade-offs

- **[Risk] Two schedule mechanisms** (`test_schedules` rows vs template-embedded schedule) → Document in UI: CronJob schedules on Schedules page; TestRun recurring runs via template schedule in Settings or legacy test_schedules API. Consider converging in a follow-up.
- **[Risk] Template schedule needs cluster/namespace** → Require those fields when `schedule_enabled`; validate on save.
- **[Risk] Breaking API clients** → `template_type` required on create; migration handles reads. Document in changelog.
- **[Trade-off] Job type overlaps CronJob** → Both lack parallelism; separated for UX clarity (scheduled vs immediate).

## Migration Plan

1. Deploy backend with schema migration (`template_type` + schedule columns, backfill `testrun`)
2. Deploy frontend with type selector and filtered pickers
3. Verify existing templates appear as `testrun` with unchanged deploy behavior
4. Rollback: revert code; new columns are additive and nullable-safe

## Open Questions

- Should template-embedded TestRun schedules appear on the Schedules page UI, or only in Settings? **Proposal:** Settings-only for v1; Schedules page remains CronJob/Job.
- Should we deprecate `test_schedules` API in favor of template-embedded schedules? **Proposal:** keep both for now; restrict new `test_schedules` to `testrun` template IDs only.
