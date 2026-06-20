## 1. Backend run defaults support

- [x] 1.1 Extend `/api/settings/defaults` to load/save `run_default_env_vars` as JSON with safe defaults
- [x] 1.2 Inject default environment variables into runner container specs when creating TestRun/CronJob/Job

## 2. Frontend data model + API wiring

- [x] 2.1 Extend `RunDefaults` type and API serialization to include environment defaults
- [x] 2.2 Update default initialization to handle missing or empty env lists

## 3. Settings UI refresh

- [x] 3.1 Replace Run Defaults UI with list rows for output args, base image, and environment key/value pairs
- [x] 3.2 Add add/remove controls for env rows and clear guidance for ECR image resolution

## 4. Run creation overrides

- [x] 4.1 Rename output toggle label to “Overwrite default argument” and use defaults when unchecked
- [x] 4.2 Apply default environment variables to run creation payload/specs

## 5. Copy + verification

- [x] 5.1 Update i18n strings in EN/FR/HE/ZH for new labels and descriptions
- [ ] 5.2 Smoke test: save defaults, create runs with/without override, confirm env injection

## 6. CRD kind + editing adjustments

- [x] 6.1 Create TestRun CRDs (k6.io/v1alpha1) and add run kind selection in UI
- [x] 6.2 Allow CronJob/Job editing via upsert and add edit button
