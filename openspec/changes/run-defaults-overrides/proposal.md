## Why

Run defaults are currently toggle-driven and do not cover environment variables or cluster-aware image resolution. Teams need a clearer default setup that (1) always applies standard output arguments unless explicitly overridden, (2) resolves runner images against the target EKS account/region, and (3) provides reusable environment key/value defaults.

## What Changes

- Replace the Run Defaults UI with a structured list covering output arguments, runner image defaults, and environment variables.
- Store default environment variables in settings and apply them to new TestRun/CronJob/Job executions.
- Treat output arguments as the default baseline and allow an explicit per-run override.
- Resolve runner image paths against the destination cluster AWS account ID and region for ECR.
- Rename the TestRun/CronJob/Job checkbox label from “Add output arguments” to “Overwrite default argument.”
- Update i18n strings for all affected UI labels.

## Capabilities

### New Capabilities
- `run-defaults-list`: Manage output argument defaults, base runner image defaults (cluster-resolved), and environment variable defaults in Settings.
- `output-argument-override`: Allow TestRun/CronJob/Job creation to override the default output arguments explicitly.

### Modified Capabilities
- (none)

## Impact

- Frontend: `settings` run defaults UI, CRD creation modal, shared RunDefaults handling, and i18n strings.
- Backend: Run defaults settings payload (including env defaults), settings storage keys, and image resolution/preview support.
- Data: new settings key(s) for environment defaults and potentially base image defaults.
