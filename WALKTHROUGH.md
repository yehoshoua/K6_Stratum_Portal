# Walkthrough - K6 Observability & Native Scheduling

We have successfully migrated the portal scheduler to native Kubernetes `Job` and `CronJob` execution, implemented active schedule toggle controls (Pause/Resume), and replaced native browser alerts with custom centered confirmation dialogs.

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

---

## 🔍 Verification & Running Checks

### 1. Build Verification
- **Go Backend (`backend/`)**: Compiles and builds cleanly with no errors:
  ```bash
  go build -v ./...
  ```
- **Next.js Frontend (`frontend/`)**: Bundles successfully with all TypeScript types passing:
  ```bash
  npm run build
  ```

### 2. Docker Compose Integration
- Configured Caddy proxy paths to route requests to the frontend and backend services.
- To run the entire environment locally:
  ```bash
  docker-compose up --build
  ```
  - Portal Frontend will be accessible at: `https://localhost` (or `http://localhost`).
