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
*   **Viewer:** Can retrieve state and observe clusters, active tests, and reports.
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
| `REPORT_SERVICE_URL` | Endpoint of the report archiving service inside the cluster network. | `http://k6-stratum-portal-report-service.k6-bedrock-dashboard.svc.cluster.local:8081` | `http://report-service:8081` |

### 2. Frontend Next.js Proxy (`frontend/`)

| Variable | Description | Default Value | Example |
|---|---|---|---|
| `PORT` | The port the Next.js frontend will bind to. | `3000` | `3000` |
| `BACKEND_URL` | Main backend API endpoint. | `http://localhost:8080` | `http://backend:8080` |
| `REPORT_SERVICE_URL` | S3 Report service endpoint. | `http://localhost:8081` | `http://report-service:8081` |

### 3. S3 HTML Report Archiving Service (`report-service/`)

| Variable | Description | Default Value | Example |
|---|---|---|---|
| `PORT` | The port the report service binds to. | `8081` | `8081` |
| `AWS_ACCESS_KEY_ID` | Access Key ID for S3 bucket authentication. | *Required* | `my-s3-access-key` |
| `AWS_SECRET_ACCESS_KEY`| Secret Access Key for S3 bucket authentication. | *Required* | `my-s3-secret-key` |
| `AWS_REGION` | AWS region where the bucket resides. | `us-east-1` | `us-west-2` |
| `AWS_BUCKET_NAME` | Name of the bucket to archive HTML reports. | `k6-reports` | `my-company-k6-reports` |
| `AWS_S3_ENDPOINT` | Optional custom endpoint URL (used for local development using MinIO). | *None (AWS default)* | `http://minio:9000` |

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

### 5. S3 HTML Report Archiving
*   `POST /api/reports/upload` - Upload an HTML dashboard report. Expects `multipart/form-data` with fields `file` (HTML), `cluster_id`, `namespace`, `template_id`, and `run_name`.
*   `GET /api/reports` - List all archived HTML reports grouped by cluster. Parses keys from S3 directly without requiring database state.
*   `GET /api/reports/view/{key}` - Retrieve and stream the raw HTML report directly from S3 (with proper Content-Security-Policy setup to allow interactive charting).

---

## 🏗️ Kubernetes Sidecar Architecture

When running K6 tests natively via Jobs or CronJobs, the portal injects an S3 uploader sidecar to archive HTML results:

```
[ Job / CronJob Pod ]
  ├─► [ k6-runner Container ]
  │     └─► Executes K6 test script
  │     └─► Exports HTML Dashboard to /report/report.html (via shared emptyDir volume)
  │
  └─► [ uploader Sidecar Container (curlimages/curl) ]
        └─► Polls for /report/report.html
        └─► Performs HTTP POST upload to report-service with metadata tags
        └─► Exits cleanly, allowing Pod completion
```

---

## 🛠️ curl Integration Examples

### Example 1: Toggle (Pause/Resume) a Scheduled CronJob
Pause or resume execution of a scheduled task by toggling its active state. The backend automatically suspends the CronJob in Kubernetes (`spec.suspend` = `true` / `false`):

```bash
curl -X POST "http://localhost:8080/api/settings/schedules/42/toggle" \
  -H "Authorization: Bearer stratum_tok_e917d5e1f98bc492823..."
```

### Example 2: List Archived K6 Reports (Viewer Role)
Retrieve a list of all HTML reports archived on S3:

```bash
curl -X GET "http://localhost:8080/api/reports" \
  -H "Authorization: Bearer stratum_tok_e917d5e1f98bc492823..."
```

### Example 3: Stream an HTML Report (Viewer Role)
Serve the raw HTML report from S3 directly (substitute the report `key` from the list endpoint):

```bash
curl -X GET "http://localhost:8080/api/reports/view/reports/cluster-1/default/my-template/load-run_1718500000.html" \
  -H "Authorization: Bearer stratum_tok_e917d5e1f98bc492823..."
```

### Example 4: Manually Upload a K6 HTML Report
If running a K6 test script locally or via a separate pipeline, you can archive it directly into the portal's S3 storage using a multipart post:

```bash
curl -X POST "http://localhost:8080/api/reports/upload" \
  -H "Authorization: Bearer stratum_tok_e917d5e1f98bc492823..." \
  -F "file=@/path/to/my-report.html" \
  -F "cluster_id=my-eks-cluster" \
  -F "namespace=load-testing" \
  -F "template_id=standard-api-test" \
  -F "run_name=ci-manual-run"
```
