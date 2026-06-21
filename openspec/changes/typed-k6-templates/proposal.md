## Why

K6 run templates today are a single undifferentiated shape: every template carries parallelism, script fields, and resource limits regardless of how it will be deployed. CronJobs, one-off Jobs, and k6.io TestRuns have different Kubernetes contracts and different portal behaviors (only TestRuns use parallelism; only TestRun templates can carry a portal-managed schedule). Splitting templates into three explicit types prevents misconfiguration, simplifies forms, and aligns Settings templates with the workloads they actually produce.

## What Changes

- Introduce a required `template_type` field on K6 templates: `cronjob`, `job`, or `testrun`
- **CronJob template** — script/ConfigMap, CPU/memory, runner image, cron expression at deploy time; **no parallelism** field
- **Job template** — same as CronJob minus schedule; used for immediate one-off `batch/v1` Job runs; **no parallelism**
- **TestRun template** — script/ConfigMap, CPU/memory, runner image, **parallelism**; optional **portal-managed schedule** (cron stored and executed by the backend scheduler, creating TestRun CRDs — not a native K8s CronJob)
- **ConfigMap creation** — all three types MAY inline `script_content` and create/update a ConfigMap at deploy time, or reference an existing ConfigMap by name
- Settings UI: type selector drives which fields appear; template lists show type badges; consumers (CRDs page, Schedules page) filter templates by compatible type
- **BREAKING**: existing templates without `template_type` are migrated to `testrun` (current default behavior preserves parallelism and scheduler usage)

## Capabilities

### New Capabilities

- `k6-template-types`: Core typed template model — `template_type` discriminator, shared fields, API validation, DB migration, Settings list/create/edit UX
- `cronjob-template`: CronJob-type template requirements — deploy to `batch/v1` CronJob, no parallelism, ConfigMap inline or reference
- `testrun-template`: TestRun-type template requirements — deploy to `k6.io/v1alpha1` TestRun, parallelism required, optional portal-managed schedule, ConfigMap inline or reference
- `job-template`: Job-type template requirements — deploy to `batch/v1` Job (run-now), no parallelism, ConfigMap inline or reference

### Modified Capabilities

_(no existing main specs — `openspec/specs/` is empty)_

## Impact

- **Database**: `k6_templates` gains `template_type` column; optional `schedule_cron` + `schedule_active` columns for TestRun templates with embedded portal schedule (or link to existing `test_schedules` — see design)
- **Backend**: `database.K6Template`, template CRUD handlers, deploy paths in `server.go` (`resource_kind` branching), `scheduler.go` (only `testrun` templates with schedules)
- **Frontend**: `K6Template` interface, Settings template modal, CRDs page template picker (testrun only), Schedules page template picker (cronjob/job only), i18n strings (en/fr/he/zh)
- **Related in-flight changes**: overlaps conceptually with `scheduler-and-ui-rename` and `scheduler-rerun-round-hour` — schedule fields on TestRun templates should reuse round-hour validation where applicable
