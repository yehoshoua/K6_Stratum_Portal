# K6 Stratos

> **A premium, self-hosted observability & control plane for [k6 Operator](https://github.com/grafana/k6-operator) load tests running on Kubernetes.**

K6 Stratos is a full-stack web application that gives your team a single pane of glass to **launch, monitor, schedule, and relaunch** distributed k6 load tests across any number of EKS/Kubernetes clusters — without ever touching `kubectl`.

---

## 🗺️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Browser                             │
│                    https://localhost:3000                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS
                     ┌──────▼──────┐
                     │   Caddy     │  TLS termination + reverse proxy
                     │  (port 443) │  /api/* → backend:8080
                     └──────┬──────┘  /*     → frontend:3000
                            │
          ┌─────────────────┼─────────────────┐
          │                                   │
   ┌──────▼──────┐                   ┌────────▼────────┐
   │  Next.js    │                   │   Go Backend    │
   │  Frontend   │  ←── REST API ──→ │   (port 8080)   │
   │  (port 3000)│                   │                 │
   └─────────────┘                   └────────┬────────┘
                                              │
                              ┌───────────────┼──────────────┐
                              │               │              │
                       ┌──────▼──────┐ ┌──────▼──────┐ ┌───▼───────┐
                       │   SQLite /  │ │  Kubernetes │ │  InfluxDB │
                       │  PostgreSQL │ │  API Server │ │  (metrics)│
                       │   Database  │ │  (k8s API)  │ └───────────┘
                       └─────────────┘ └─────────────┘
```

### Component Summary

| Component | Technology | Role |
|---|---|---|
| **Frontend** | Next.js 14 (App Router) | Premium glassmorphism dark-mode UI |
| **Backend** | Go (`net/http`) | REST API, k8s client-go, JWT auth, DB layer |
| **Database** | SQLite (default) or PostgreSQL | Config, templates, users, schedules, settings |
| **Proxy** | Caddy 2 | TLS termination, path-based reverse proxy |
| **k6 Operator** | `k6.io/v1alpha1 TestRun` CRD | Actual load test execution on Kubernetes |
| **Metrics** | InfluxDB + Grafana / Mimir | Time-series storage and visualization |

---

## ✨ Features

### 🖥️ Dashboard
- Real-time overview of all active `TestRun` CRDs across registered clusters
- Live pod log streaming with a slide-in console drawer
- Per-test **Relaunch** button — re-runs a finished test with the same spec
- Status badges: initializing, running, finished, error

### 🧪 K6 Operator CRDs (Test Control)
- List, deploy, delete `k6.io/v1alpha1 TestRun` resources
- **All Namespaces** view with namespace badges per row
- Script: write inline JS or reference an existing **ConfigMap**
- Custom resource limits per run: CPU, memory, parallelism (runner count)
- Optional **custom k6 runner image** (ECR or any OCI registry)
- Optional **`--out` argument injection** (e.g. InfluxDB or Prometheus output)
- Bold resource names in confirmation dialogs for all destructive actions

### 📁 ConfigMap Management
- List, create, edit, and delete Kubernetes ConfigMaps containing k6 scripts
- In-browser script editor per file key, saved live back to the cluster

### 🗓️ Schedules
- Schedule test templates as native Kubernetes **CronJobs** (`batch/v1`)
- Immediate one-off **Job** execution via "Run Now"
- **Pause / Resume** toggle — syncs `spec.suspend` on the CronJob in real time
- Filter by cluster and namespace
- Delete a schedule → automatically deletes the CronJob from the cluster

### ⚙️ Settings

#### 🏗️ Cluster Management
- Register multiple Kubernetes clusters (token, kubeconfig, or in-cluster)
- Per-cluster namespace whitelist with automatic discovery

#### 🎛️ Run Defaults *(global team defaults)*
- Set default **Output Argument** string (pre-filled InfluxDB/Prometheus `--out` flag)
- Set default **Custom Image** values (AWS Account ID, Region, Image URL)
- Toggle whether each default is pre-enabled in the Add Test form
- Persisted in the database — shared across the entire team
- Overridable per-run without changing the saved defaults

#### 📝 K6 Run Templates
- Reusable run configurations: name, script/ConfigMap, CPU/memory/parallelism
- Load a template in the Add Test form to instantly pre-fill all fields

#### 📊 InfluxDB Servers
- Register multiple InfluxDB v1/v2 servers
- Set one as **Active** to receive metrics from all runs

#### 👥 User Management
- Local accounts with role assignment (`viewer`, `editor`, `administrator`)
- bcrypt-hashed passwords

#### 🔑 API Tokens
- Long-lived `stratum_tok_` tokens for CI/CD, webhooks, and automation
- Per-token role and optional expiry date
- Plain token shown only once at generation time

#### 🔒 SSO / OIDC
- Optional OpenID Connect integration
- Admin and Editor group mapping from OIDC claims

#### 🎨 Theme & Colour Palettes
- Light / Dark mode, multiple built-in palettes
- Create and save custom palettes with a colour picker

#### 🌐 Multilingual UI
- **English**, **French**, **Hebrew**, **Chinese** — switch without reload

---

## 🔐 Authentication & RBAC

### Authentication Methods

| Method | Format | Use Case |
|---|---|---|
| Session JWT | `eyJ...` (in `localStorage`) | Interactive browser login |
| API Token | `stratum_tok_<hash>` | CI/CD, webhooks, automation |

### Bearer Token Header

```http
Authorization: Bearer <your_token_here>
```

### Role Matrix

| Permission | Viewer | Editor | Administrator |
|---|:---:|:---:|:---:|
| List clusters / namespaces | ✅ | ✅ | ✅ |
| View TestRuns / ConfigMaps | ✅ | ✅ | ✅ |
| View schedules / templates | ✅ | ✅ | ✅ |
| View run defaults | ✅ | ✅ | ✅ |
| Deploy / delete TestRuns | ❌ | ✅ | ✅ |
| Relaunch TestRuns | ❌ | ✅ | ✅ |
| Edit / create ConfigMaps | ❌ | ✅ | ✅ |
| Create / update templates | ❌ | ✅ | ✅ |
| Pause / resume schedules | ❌ | ✅ | ✅ |
| Save run defaults | ❌ | ✅ | ✅ |
| Manage clusters | ❌ | ❌ | ✅ |
| Manage users | ❌ | ❌ | ✅ |
| Manage InfluxDB servers | ❌ | ❌ | ✅ |
| Manage API tokens | ❌ | ❌ | ✅ |
| Configure SSO | ❌ | ❌ | ✅ |

---

## ⚙️ Environment Variables

### Backend (`backend/`)

| Variable | Description | Default | Example |
|---|---|---|---|
| `PORT` | HTTP API server port | `8080` | `8080` |
| `DB_TYPE` | Database driver (`sqlite` or `postgres`) | `sqlite` | `postgres` |
| `DATABASE_URL` | PostgreSQL DSN or SQLite path | — | `postgres://user:pass@localhost/db` |
| `DATABASE_PATH` | SQLite file path (fallback) | `~/.k6-bedrock-dashboard/dashboard.db` | `/data/dashboard.db` |
| `ENCRYPTION_KEY` | Base64 32-byte AES-256-GCM key (cluster credentials at rest) | *auto-generated* | `dGhpcy1pcy1hLTMyLWJ5dGUtZGV2ZWxvcG1lbnQta2V5MSE=` |
| `JWT_SECRET` | HMAC secret for signing JWTs | *default key* | `my-secure-jwt-secret` |

### Frontend (`frontend/`)

| Variable | Description | Default | Example |
|---|---|---|---|
| `PORT` | Next.js server port | `3000` | `3000` |
| `BACKEND_URL` | Backend base URL (server-side proxy target) | `http://localhost:8080` | `http://backend:8080` |

---

## 🚀 Deployment

### Option 1 — Docker Compose (Local / Single Node)

```bash
git clone https://github.com/your-org/k6-stratum-portal.git
cd k6-stratum-portal

docker-compose up --build
```

Portal available at **`https://localhost`** (self-signed TLS via Caddy `tls internal`).

Default credentials: **`admin` / `admin`** — change immediately via Settings → Users.

| Service | Container | Exposed Port |
|---|---|---|
| Go Backend API | `k6-stratum-portal-backend` | `8080` |
| Next.js Frontend | `k6-stratum-portal-frontend` | `3000` |
| Caddy Proxy | `k6-stratum-portal-proxy` | `80`, `443` |

SQLite data is persisted at `~/.k6-bedrock-dashboard/dashboard.db` on the host machine.

---

### Option 2 — Kubernetes (Production)

```bash
# 1. Create secrets
kubectl create secret generic dashboard-secrets \
  --namespace k6-stratum-portal \
  --from-literal=jwt-secret='<strong-random-secret>' \
  --from-literal=encryption-key='<base64-32byte-key>'

# 2. Apply all manifests
kubectl apply -f k8s-deployment.yaml
```

**Resources created:**

| Resource | Kind | Description |
|---|---|---|
| `k6-stratum-portal` | Namespace | Isolation namespace |
| `k6-stratum-portal-sa` | ServiceAccount | Pod identity |
| `k6-stratum-portal-role` | ClusterRole | k6 CRDs, ConfigMaps, Namespaces, Jobs, CronJobs |
| `k6-stratum-portal-role-binding` | ClusterRoleBinding | Binds role to SA |
| `k6-portal-sqlite-pvc` | PersistentVolumeClaim | 1 Gi for SQLite |
| `k6-stratum-portal-backend` | Deployment | Go backend (Recreate strategy for SQLite) |
| `k6-stratum-portal-frontend` | Deployment | Next.js frontend |
| `k6-stratum-portal-ingress` | Ingress | NGINX ingress with TLS |

> **PostgreSQL in production:** set `DB_TYPE=postgres` and `DATABASE_URL` for HA. The SQLite PVC is not needed.

---

## 📡 Complete API Reference

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | None | Login — returns JWT token |
| `GET` | `/api/auth/me` | Any | Current user session & role |
| `GET` | `/api/auth/sso/status` | None | OIDC SSO enabled status |
| `GET` | `/api/auth/sso/url` | None | OIDC authorization URL |
| `POST` | `/api/auth/sso/callback` | None | Exchange OIDC code for portal JWT |

### Cluster Management

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/k8s/clusters` | Viewer | List all registered clusters |
| `POST` | `/api/k8s/clusters` | Admin | Register a new cluster |
| `PUT` | `/api/k8s/clusters/{id}` | Admin | Update cluster config |
| `DELETE` | `/api/k8s/clusters/{id}` | Admin | Unregister a cluster |
| `GET` | `/api/k8s/clusters/{id}/namespaces` | Viewer | List namespaces on a cluster |

### K6 TestRun CRDs

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/k8s/clusters/{id}/crds?namespace={ns}` | Viewer | List TestRuns (use `namespace=all` for all) |
| `POST` | `/api/k8s/clusters/{id}/crds?namespace={ns}` | Editor | Deploy a new TestRun |
| `DELETE` | `/api/k8s/clusters/{id}/crds/{name}?namespace={ns}` | Editor | Delete a TestRun |
| `POST` | `/api/k8s/clusters/{id}/crds/{name}/relaunch?namespace={ns}` | Editor | Relaunch a finished TestRun |

### ConfigMaps

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/k8s/clusters/{id}/configmaps?namespace={ns}` | Viewer | List ConfigMaps |
| `GET` | `/api/k8s/clusters/{id}/configmaps/{name}?namespace={ns}` | Viewer | Get ConfigMap data |
| `POST` | `/api/k8s/clusters/{id}/configmaps?namespace={ns}` | Editor | Create a ConfigMap |
| `PUT` | `/api/k8s/clusters/{id}/configmaps/{name}?namespace={ns}` | Editor | Update ConfigMap |
| `DELETE` | `/api/k8s/clusters/{id}/configmaps/{name}?namespace={ns}` | Editor | Delete a ConfigMap |

### Pod Logs

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/k8s/clusters/{id}/pods?namespace={ns}` | Viewer | List pods in a namespace |
| `GET` | `/api/k8s/clusters/{id}/pods/{pod}/logs?namespace={ns}` | Viewer | Fetch pod logs |

### Schedules (CronJobs)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/settings/schedules` | Viewer | List all schedules |
| `POST` | `/api/settings/schedules` | Editor | Create schedule → deploys a CronJob |
| `POST` | `/api/settings/schedules/{id}/run` | Editor | Run immediately as a one-off Job |
| `POST` | `/api/settings/schedules/{id}/toggle` | Editor | Pause / Resume (`spec.suspend`) |
| `DELETE` | `/api/settings/schedules/{id}` | Editor | Delete schedule + CronJob from cluster |

### Run Templates

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/settings/templates` | Viewer | List all templates |
| `POST` | `/api/settings/templates` | Editor | Create a template |
| `PUT` | `/api/settings/templates/{id}` | Editor | Update a template |
| `DELETE` | `/api/settings/templates/{id}` | Editor | Delete a template |

### Run Defaults

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/settings/defaults` | Viewer | Get global run defaults |
| `POST` | `/api/settings/defaults` | Editor | Save global run defaults |

**Payload schema:**
```json
{
  "output_args": "--out influxdb=http://grafana-hub-influxdb.grafana-hub.svc.cluster.local:8086/k6s",
  "use_output": "true",
  "use_image": "false",
  "aws_account": "123456789012",
  "aws_region": "us-east-1",
  "image_url": "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-k6:latest"
}
```

### InfluxDB Servers

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/settings/influxdb/servers` | Viewer | List all InfluxDB servers |
| `POST` | `/api/settings/influxdb/servers` | Admin | Register a server |
| `PUT` | `/api/settings/influxdb/servers/{id}` | Admin | Update a server |
| `DELETE` | `/api/settings/influxdb/servers/{id}` | Admin | Delete a server |
| `POST` | `/api/settings/influxdb/servers/{id}/activate` | Viewer | Set as active |
| `POST` | `/api/settings/influxdb/test` | Admin | Test connectivity |

### Users & Tokens

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/settings/users` | Admin | List local users |
| `POST` | `/api/settings/users` | Admin | Create a user |
| `DELETE` | `/api/settings/users/{username}` | Admin | Delete a user |
| `GET` | `/api/settings/tokens` | Admin | List API tokens (hashes only) |
| `POST` | `/api/settings/tokens` | Admin | Generate an API token |
| `DELETE` | `/api/settings/tokens/{hash}` | Admin | Revoke an API token |

### SSO & Metrics

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/settings/sso` | Admin | Get OIDC SSO config |
| `POST` | `/api/settings/sso` | Admin | Save OIDC SSO config |
| `GET` | `/api/influx/runs` | Viewer | List past test run summaries |
| `GET` | `/api/influx/runs/{run_id}/metrics` | Viewer | Get aggregated metrics |
| `GET` | `/api/influx/runs/{run_id}/stream` | Viewer | Live-stream metrics (SSE) |
| `GET` | `/api/influx/alerts` | Viewer | List SLA threshold alerts |

---

## 🛠️ curl Examples

### 1 — Login and capture token
```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r .token)
```

### 2 — Deploy an immediate TestRun
```bash
curl -s -X POST "http://localhost:8080/api/k8s/clusters/<cluster_id>/crds?namespace=default" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "smoke-test-run",
    "parallelism": 2,
    "scriptName": "my-script-configmap",
    "scriptFile": "test.js",
    "cpuLimit": "500m",
    "memLimit": "512Mi",
    "useArguments": true,
    "argumentsText": "--out influxdb=http://influxdb:8086/k6s"
  }'
```

### 3 — Relaunch a finished test
```bash
curl -s -X POST \
  "http://localhost:8080/api/k8s/clusters/<cluster_id>/crds/smoke-test-run/relaunch?namespace=default" \
  -H "Authorization: Bearer $TOKEN"
```

### 4 — Create a schedule (runs every hour)
```bash
curl -s -X POST http://localhost:8080/api/settings/schedules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hourly-smoke",
    "cluster_id": "<cluster_id>",
    "namespace": "default",
    "template_id": "<template_id>",
    "cron_expression": "0 * * * *",
    "active": true
  }'
```

### 5 — Pause / Resume a CronJob schedule
```bash
curl -s -X POST http://localhost:8080/api/settings/schedules/42/toggle \
  -H "Authorization: Bearer stratum_tok_e917d5e1f98bc492823..."
```

### 6 — Push run defaults (team onboarding)
```bash
curl -s -X POST http://localhost:8080/api/settings/defaults \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "output_args": "--out influxdb=http://grafana-hub-influxdb.grafana-hub.svc.cluster.local:8086/k6s",
    "use_output": "true",
    "use_image": "true",
    "aws_account": "107435627496",
    "aws_region": "us-east-1",
    "image_url": "107435627496.dkr.ecr.us-east-1.amazonaws.com/rem-apps/xk6:v1.1"
  }'
```

### 7 — Generate a CI/CD API token (90-day expiry)
```bash
curl -s -X POST http://localhost:8080/api/settings/tokens \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"github-actions","role":"editor","expires_days":90}'
# Response: {"token":"stratum_tok_...","name":"github-actions","role":"editor"}
```

---

## 📂 Project Structure

```
k6-stratum-portal/
├── backend/
│   ├── internal/
│   │   ├── auth/           # JWT, bcrypt, API token validation
│   │   ├── config/         # Environment variable loading
│   │   ├── database/       # SQLite / PostgreSQL data layer
│   │   ├── influx/         # InfluxDB v1/v2 client
│   │   ├── k8s/            # Kubernetes client-go wrappers
│   │   └── server/         # HTTP handlers, routing, middleware
│   └── main.go
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── crds/       # TestRun + ConfigMap control page
│       │   ├── metrics/    # InfluxDB metrics explorer
│       │   ├── schedules/  # Schedule management
│       │   ├── settings/   # Full settings panel
│       │   └── login/      # Auth page
│       ├── components/     # Sidebar, PreferencesContext, shared UI
│       └── services/api.ts # Fully typed REST client
├── Caddyfile               # Reverse proxy + TLS config
├── docker-compose.yaml     # Local deployment stack
└── k8s-deployment.yaml     # Production Kubernetes manifests
```

---

## 🔧 Local Development

### Prerequisites
- Go 1.22+  |  Node.js 20+  |  Docker & Docker Compose

### Run without Docker

```bash
# Terminal 1 — Backend
cd backend && go run ./...

# Terminal 2 — Frontend
cd frontend && npm install && npm run dev
```

Backend at `http://localhost:8080` · Frontend at `http://localhost:3000`

### Build & type-check

```bash
cd backend  && go build ./...
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

---

## 🔒 Security Notes

- **Change `admin`/`admin`** immediately after first launch (Settings → Users)
- **Rotate `JWT_SECRET` and `ENCRYPTION_KEY`** — use cryptographically random values of ≥ 32 bytes
- **API Tokens** are SHA-256 hashed before storage; the plain token is shown only once
- Cluster credentials (kubeconfig tokens) are encrypted at rest with **AES-256-GCM**
- Caddy enforces **HTTPS** for all traffic in production

---

## 📄 License

Apache License 2.0 — see [LICENSE](./LICENSE) for details.
