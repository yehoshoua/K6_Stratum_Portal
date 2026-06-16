# K6 Stratum Portal - API Reference & Integration Guide

Welcome to the **K6 Stratum Portal API** documentation. This guide details the available HTTP REST API endpoints, how to authenticate via session JWTs or custom API tokens, role-based authorization structures, environment variables, and actionable usage examples with `curl`.

---

## 🔐 Authentication & Roles

The K6 Stratum Portal supports two authentication methods:
1. **SSO / Local Login JWT:** Issued upon successful interactive login, typically stored in browsers.
2. **API Tokens (`stratum_tok_`):** Long-lived tokens generated from the Settings panel for automation, webhooks, and CI/CD pipelines.

### Bearer Token Header
To access secured endpoints, include the token in your HTTP requests using the standard `Authorization` header:
```http
Authorization: Bearer <your_token_here>
```

### Role-Based Access Control (RBAC)
Endpoints are annotated with required privileges:
*   **Viewer:** Can retrieve state and observe clusters and active tests.
*   **Editor:** Inherits Viewer permissions. Can save and update **K6 Run Templates**, deploy new test runs (Jobs/CronJobs), modify ConfigMaps, pause/resume schedules, and trigger **Relaunches** of load tests.
*   **Administrator:** Complete platform ownership. Can manage K8s Cluster connections, Users, OIDC SSO Settings, InfluxDB Server Connections, and CRUD **API Tokens**.

---

## ⚙️ Environment Variables

The portal components are configured using the following environment variables:

### 1. Main Backend API Service (`backend/`)

| Variable | Description | Default Value | Example |
|---|---|---|---|
| `PORT` | The port the HTTP API server will bind and listen to. | `8080` | `8080` |
| `DB_TYPE` | Database driver to use. Supported values are `sqlite` or `postgres`. | `sqlite` | `postgres` |
| `DATABASE_URL` | DSN connection string for PostgreSQL or path/connection string for SQLite. | *SQLite file path default* | `postgres://user:pass@localhost:5432/db?sslmode=disable` |
| `DATABASE_PATH` | Path to the local SQLite database file. (Backwards-compatibility, fallback if `DATABASE_URL` is empty). | `~/.k6-bedrock-dashboard/dashboard.db` | `/var/data/dashboard.db` |
| `ENCRYPTION_KEY` | Base64 encoded 32-byte key used for AES-256-GCM encryption of cluster credentials at rest. | *Auto-generated key* | `dGhpcy1pcy1hLTMyLWJ5dGUtZGV2ZWxvcG1lbnQta2V5MSE=` |
| `JWT_SECRET` | Secret key used to sign and verify user JWT sessions. | *Default signing key* | `my-secure-jwt-signing-secret` |

### 2. Frontend Next.js Proxy (`frontend/`)

| Variable | Description | Default Value | Example |
|---|---|---|---|
| `PORT` | The port the Next.js frontend will bind to. | `3000` | `3000` |
| `BACKEND_URL` | Main backend API endpoint. | `http://localhost:8080` | `http://backend:8080` |

---

## 📡 API Endpoints Reference

### 1. Authentication Endpoints
*   `POST /api/auth/login` - Authenticate using local credentials (username/password).
*   `GET /api/auth/me` - Retrieve current user session and role.

### 2. K8s Clusters Configurations
*   `GET /api/k8s/clusters` - List all registered clusters.
*   `POST /api/k8s/clusters` - Register a cluster (Admin only).
*   `DELETE /api/k8s/clusters/{id}` - Unregister a cluster (Admin only).

### 3. K6 Run Templates
*   `GET /api/settings/templates` - List all templates.
*   `POST /api/settings/templates` - Create a new load testing configuration template (Editor/Admin only).

### 4. Load Test Execution & Scheduling (Jobs & CronJobs)
*   `GET /api/k8s/clusters/{cluster_id}/crds?namespace={namespace}` - List running test instances on EKS.
*   `POST /api/k8s/clusters/{cluster_id}/crds?namespace={namespace}` - Deploy an immediate Job or schedule a CronJob run (Editor/Admin only).
*   `POST /api/settings/schedules/{id}/run` - Manually trigger execution of a scheduled CronJob template immediately as a native Job (Editor/Admin only).
*   `POST /api/settings/schedules/{id}/toggle` - Toggle active status of a scheduled CronJob (Pause / Resume) (Editor/Admin only).
*   `DELETE /api/settings/schedules/{id}` - Delete schedule config and delete the CronJob resource on the cluster (Editor/Admin only).

---

## 🛠️ curl Integration Examples

### Example 1: Toggle (Pause/Resume) a Scheduled CronJob
Pause or resume execution of a scheduled task by toggling its active state. The backend automatically suspends the CronJob in Kubernetes (`spec.suspend` = `true` / `false`):

```bash
curl -X POST "http://localhost:8080/api/settings/schedules/42/toggle" \
  -H "Authorization: Bearer stratum_tok_e917d5e1f98bc492823..."
```
