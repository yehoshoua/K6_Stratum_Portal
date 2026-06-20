## Context

The repository and UI still refer to the product using legacy branding across interface strings, generated reports, and documentation. The change is a cross-cutting rename that should update all visible references while keeping behavior unchanged.

## Goals / Non-Goals

**Goals:**
- Replace all user-facing legacy product name occurrences with "K6 Stratos".
- Ensure report/export titles and documentation use the new name.
- Keep the rename consistent across all supported UI languages.

**Non-Goals:**
- Changing repository folder names or package identifiers.
- Modifying API contracts, database schema, or runtime behavior.

## Decisions

1. **String replacement via audited inventory.**  
   Use a targeted sweep of UI strings, report templates, and docs to replace the product name, verifying each location rather than applying blind global replacements.  
   *Alternative:* Global search-and-replace. Rejected to avoid unintended changes in code identifiers or external references.

2. **Keep internal identifiers unchanged.**  
   Only user-facing text changes; internal IDs or package names remain as-is to avoid breaking dependencies.  
   *Alternative:* Rename package/module identifiers. Rejected due to unnecessary risk for a branding change.

## Risks / Trade-offs

- **Missed occurrences** → Mitigation: use a repo-wide search for legacy product name text before finalizing.
- **Non-English translations diverge** → Mitigation: update all locale dictionaries consistently.
