# Walkthrough - K6 Observability, Native Scheduling & S3 Reporting System

We have successfully migrated the portal scheduler to native Kubernetes `Job` and `CronJob` execution, implemented active schedule toggle controls (Pause/Resume), replaced native browser alerts with custom centered confirmation dialogs, and built a stateless S3-compatible HTML report archiving and embedded viewer subsystem.

---

## 🛠️ Actions Accomplished & Architecture

### 1. Native Kubernetes Job & CronJob Scheduling
- **Native Scheduling**: Replaced the custom SQLite scheduler loop.
  - If "Run on a Schedule" is checked in the form, the backend deploys a native Kubernetes `CronJob` (`batch/v1`).
  - If unchecked, it deploys a native Kubernetes `Job` (`batch/v1`) immediately.
- **Resource Limits & Parallelism**: Parsed CPU limit, memory limit, and parallelism values from K6 templates and passed them directly to the Kubernetes Job/CronJob spec.
- **Automatic Cleanup**: Updated the delete schedule handler to automatically delete corresponding Jobs and CronJobs on EKS.

### 2. Pause/Resume Toggling
- **Spec Suspend Sync**: Implemented schedule toggling. Toggling active state on the UI list updates the database and immediately calls Kubernetes client-go to set `spec.suspend = !active` on the corresponding `CronJob` resource.
- **Initial State**: CronJob creation now initializes `spec.suspend` according to the active status checkbox at creation time.

### 3. Custom Centered Confirmation Dialogs
- **Premium Design**: Replaced raw browser-native `confirm()` popups. Built a custom centered modal that uses the dashboard's glassmorphism style, dark color scheme, and purple-to-pink gradient accents.

### 4. S3 HTML Report Archiving Service (`report-service/`)
- **Stateless Design**: Created a stateless Go microservice (`report-service`) that handles all HTML report storage using S3 (AWS or MinIO). 
  - Lists and groups reports by parsing the S3 key structure `reports/{cluster_id}/{namespace}/{template_id}/{run_name}_{timestamp}.html` without needing any SQL database storage.
- **Sidecar Job Archiver**: Injected an uploader container running `curlimages/curl` into spawned Jobs. The `k6-runner` container writes the HTML report to a shared `emptyDir` volume using `--out web-dashboard=export=/report/report.html`. The sidecar polls for the file and uploads it with metadata to the S3 bucket.
- **Embedded UI Viewer**: Built a premium `/reports` page in Next.js showing runs grouped by cluster. Integrates a custom modal that embeds the HTML dashboard in an iframe with toggleable fullscreen.

---

## 🛠️ Frontend Proxy Routing Upgrade
- **[NEW] [proxy.ts](file:///Users/yehoshouad/tmp/perso/k6-stratum-portal/frontend/src/proxy.ts)**: Configured Next.js's new `proxy` file convention (`src/proxy.ts`) to route `/api/reports/*` requests to the `REPORT_SERVICE_URL` and all other `/api/*` requests to `BACKEND_URL`. 
- **Dynamic Resolution**: Because `proxy.ts` executes dynamically for each request at runtime (Edge runtime level), it evaluates variables such as `BACKEND_URL` and `REPORT_SERVICE_URL` dynamically, preventing Next.js build-time caching which would freeze values to local fallbacks.

---

## 🔍 Verification & Running Checks

### 1. Build Verification
- **Go Backend (`backend/`)**: Compiles and builds cleanly with no errors:
  ```bash
  go build -v ./...
  ```
- **Go Report Service (`report-service/`)**: Compiles cleanly:
  ```bash
  go build -v .
  ```
- **Next.js Frontend (`frontend/`)**: Bundles successfully with all TypeScript types passing:
  ```bash
  npm run build
  ```

### 2. Docker Compose Integration
- Added local `minio` and `report-service` containers to `docker-compose.yaml`.
- Configured Caddy proxy paths to route `/api/reports` and `/api/reports/*` to the S3 uploader service.
- To run the entire environment locally:
  ```bash
  docker-compose up --build
  ```
  - Portal Frontend will be accessible at: `https://localhost` (or `http://localhost`).
  - MinIO Storage Console will be accessible at: `http://localhost:9001` (User: `minioadmin`, Pass: `minioadmin`).
