## 1. Database schema

- [x] 1.1 Add `template_type` column to `k6_templates` (TEXT, NOT NULL default `testrun`)
- [x] 1.2 Add schedule columns: `schedule_enabled`, `schedule_cron_expression`, `schedule_active`, `schedule_cluster_id`, `schedule_namespace`
- [x] 1.3 Backfill existing rows: `UPDATE k6_templates SET template_type = 'testrun' WHERE template_type IS NULL OR template_type = ''`
- [x] 1.4 Extend `database.K6Template` struct and `SaveTemplate` / `GetTemplates` / `GetTemplate` scan columns

## 2. Backend API validation

- [x] 2.1 Add `template_type` to create/update request bodies in `handleCreateTemplate` and `handleUpdateTemplate`
- [x] 2.2 Validate `template_type` is one of `cronjob`, `job`, `testrun`
- [x] 2.3 Enforce parallelism rules: required >= 1 for `testrun`; reject > 0 for `cronjob` and `job`
- [x] 2.4 Enforce schedule fields only on `testrun`; require cluster/namespace/cron when `schedule_enabled`
- [x] 2.5 Apply round-hour validation on `schedule_cron_expression` when schedule enabled

## 3. Deploy path alignment

- [x] 3.1 Filter or reject deploy requests where `resource_kind` mismatches template `template_type`
- [x] 3.2 Ensure CronJob deploy path ignores template parallelism
- [x] 3.3 Ensure Job deploy path ignores template parallelism
- [x] 3.4 Ensure TestRun deploy path uses template parallelism and ConfigMap helper
- [x] 3.5 Extract shared ConfigMap upsert helper used by deploy and scheduler paths

## 4. Scheduler extension

- [x] 4.1 Add `GetScheduledTemplates()` or equivalent query for `testrun` templates with `schedule_enabled = true`
- [x] 4.2 Extend scheduler poll loop to fire embedded template schedules (reuse `runScheduleTestRun` logic with template-derived cluster/namespace)
- [x] 4.3 Restrict `test_schedules` create/update to reference only `testrun` template IDs

## 5. Frontend types and API

- [x] 5.1 Extend `K6Template` interface with `template_type` and optional schedule fields
- [x] 5.2 Update `createTemplate` / `updateTemplate` payloads in `api.ts`

## 6. Settings UI

- [x] 6.1 Add template type selector to create/edit modal
- [x] 6.2 Show/hide parallelism field based on type (`testrun` only)
- [x] 6.3 Show/hide schedule section based on type (`testrun` only): cron, cluster, namespace, active toggle
- [x] 6.4 Add type badge to template list rows
- [x] 6.5 Add i18n strings for type labels and schedule fields (en, fr, he, zh)

## 7. Consumer page filtering

- [x] 7.1 CRDs page: filter template picker to `testrun` only
- [x] 7.2 Schedules page: filter cron create/edit to `cronjob` templates
- [x] 7.3 Schedules page: filter Run Now to `job` templates
- [x] 7.4 Remove parallelism from `buildCrdPayload` for cronjob/job paths

## 8. Verification

- [ ] 8.1 Manual test: create each template type in Settings with expected fields
- [ ] 8.2 Manual test: deploy TestRun from CRDs using `testrun` template
- [ ] 8.3 Manual test: create CronJob schedule using `cronjob` template
- [ ] 8.4 Manual test: Run Now using `job` template
- [ ] 8.5 Manual test: enable schedule on `testrun` template and confirm scheduler creates TestRun CRD
