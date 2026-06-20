## Context

Run defaults are currently stored as simple toggles with free-text inputs for output arguments and custom image. There is no environment default support, and image paths are not explicitly tied to the destination EKS account/region. The CRD run modal uses these defaults to pre-check checkboxes and pre-fill text inputs. We need a clearer defaults surface that acts as the baseline for all runs, while still allowing explicit overrides.

## Goals / Non-Goals

**Goals:**
- Represent Run Defaults as a structured list: output option, image default, and environment defaults.
- Apply output defaults to all TestRun/CronJob/Job runs unless explicitly overridden.
- Store environment defaults and apply them to runs automatically.
- Resolve runner images against the target cluster AWS account ID and region during execution.
- Update UI labels and translations for the new override behavior.

**Non-Goals:**
- Introduce per-run environment overrides in this change.
- Redesign the scheduling or template flows beyond consuming the defaults.
- Alter the scheduler behavior beyond existing image resolution logic.

## Decisions

1. **Keep default storage in settings with a new env key**
   - Add a new settings entry `run_default_env_vars` (JSON array of `{ key, value }`).
   - Reuse existing settings keys for output args and image (no schema migration).
   - Rationale: avoids breaking existing defaults and keeps persistence centralized.
   - Alternative: new table for defaults. Rejected due to higher migration cost.

2. **Defaults as baseline, explicit override in run modal**
   - Default output arguments are applied when `run_default_use_output` is true.
   - The run modal checkbox is renamed to “Overwrite default argument”.
   - When unchecked, the run uses the default output args without user input.
   - Rationale: aligns with the new language and reduces ambiguity for users.
   - Alternative: remove the toggle entirely. Rejected because teams may need per-run custom arguments.

3. **Image resolution stays backend-driven**
   - Store a base image path in settings (e.g., `rem-helm-images/rem-apps/xk6:latest`).
   - Backend `resolveClusterImage` composes the ECR registry using cluster AWS account + region.
   - Rationale: guarantees correctness across clusters and avoids exposing AWS details in the UI.
   - Alternative: resolve in frontend for preview. Defer unless users need previewing.

4. **Environment defaults applied automatically**
   - Settings define a list of env key/value pairs.
   - Backend injects them into the runner container env when creating TestRun/CronJob/Job.
   - Rationale: defaults should be consistent without per-run manual input.

## Risks / Trade-offs

- **Env defaults may contain sensitive values** → Encourage using non-secret defaults and keep a future option for secrets integration.
- **No per-run env overrides** → Document as a non-goal; can be added later if needed.
- **Defaults require `use_output` to be enabled** → Keep UI clear about when defaults are active.

