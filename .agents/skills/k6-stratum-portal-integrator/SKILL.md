---
name: k6-stratum-portal-integrator
description: >-
  Guide for integrating secure API token authorization, role-based access control, load test relaunch pipelines, and multilingual settings modals within the K6 Stratum dashboard.
---

# K6 Stratum Portal Integrator

## Overview
This skill provides architectural guidelines and step-by-step workflows for implementing secure API token mechanisms, role-based access control (RBAC), and Kubernetes test execution pipelines.

## Dependencies
None.

## Quick Start
To authenticate client integrations, generate an API token starting with `stratum_tok_`, hash it using SHA-256 in the database, and configure server middleware to validate the `Authorization: Bearer <token>` header.

## Workflow
### 1. Database Table Creation (SQLite)
Create the `api_tokens` table during database initialization:
```sql
CREATE TABLE IF NOT EXISTS api_tokens (
    token_hash TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    expires_at DATETIME
);
```

### 2. Token Security Hashing
When generating tokens, follow these guidelines:
- Prefix raw tokens with `stratum_tok_` for identification.
- Hash raw tokens using SHA-256 and store the resulting hex representation.
- Display the raw token to the user exactly once at generation time.

### 3. Middleware Authorization Check
Configure backend auth middleware to support custom API tokens:
1. Extract token from `Authorization: Bearer <token>`.
2. Check prefix: if it begins with `stratum_tok_`, query `api_tokens` using the SHA-256 hash.
3. Validate expiration: if `expires_at` is set and has passed, return 401 Unauthorized.
4. Set identity headers: inject `X-User-Name: "api-token:" + tok.Name` and `X-User-Role: tok.Role`.
5. If it does not start with `stratum_tok_`, fall back to standard JWT token verification.

### 4. Role-Based Access Control (RBAC) Delineation
Restrict endpoints as follows:
- **Viewer:** Blocked from modifying templates or executing test runs (returns 403 Forbidden).
- **Editor:** Can configure run templates, deploy new tests, and relaunch tests. Blocked from platform settings.
- **Administrator:** Full permissions over K8s clusters, users, SSO configurations, and API token definitions.

### 5. Load Test Relaunch Endpoint
Implement a relaunch flow for load tests:
1. Fetch the existing K6 custom resource.
2. Clean the configuration (stripping `resourceVersion`, `uid`, `creationTimestamp`, and `status`).
3. Delete the resource, wait 1.5 seconds, and re-create it.

## Common Mistakes
- **Leaking Raw Tokens:** Storing raw API tokens in the database instead of their SHA-256 hashes.
- **Time Window Mismatch:** Querying InfluxDB without absolute start and end query bounds, leading to mismatched charts.
- **Missing RBAC Wrappers:** Allowing Viewer roles to execute test relaunches or create run templates.
