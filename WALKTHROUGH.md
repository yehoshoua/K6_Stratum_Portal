# Walkthrough - Kubernetes & InfluxDB Observability Dashboard

We have successfully integrated SQLite-backed persistence, local EKS kubeconfig context loading, local user management with role-based access control (RBAC), SSO/OIDC integration, and EKS-ready deployment configurations with Dockerfiles.

---

## 🛠️ Actions Accomplished

### 1. Persistent Local Database & Users (SQLite)
- **Database Helper (`/backend/internal/database/database.go`):** Added `users` and `sso_config` tables:
  - `users`: stores usernames, role-based configuration, SHA-256 password hash, and cryptographically secure dynamic salts.
  - `sso_config`: stores dynamic settings for OpenID Connect (OIDC) authentication.
  - Auto-seeding: Automatically configures a default `admin` user with the password `admin` if the `users` table is empty.
- **Server Auth & Middlewares (`/backend/internal/server/server.go`):**
  - **`adminOnly` Middleware:** Restricts administrative endpoints (such as SSO and user registration) to users with the role `administrator` or `admin`.
  - **`editorOrAdmin` Middleware:** Secures write operations on K6 Operator custom resources (creating/deleting tests) so that only editors or administrators can perform them, blocking viewers.

### 2. OIDC Single Sign-On (SSO) Integration
- **Dynamic Authorization Discovery:** Retrieves OIDC endpoints dynamically at runtime from the configured `.well-known/openid-configuration` metadata of the OIDC `issuer_url`.
- **Callback Auth Handlers:** Complete OAuth2 authorization code token exchange and profile fetching via `/api/auth/sso/callback`, mapping user groups or usernames to the corresponding roles.
- **SSO Status API:** Allows the login page to check if SSO is enabled and offer a dedicated redirection path.

### 3. Frontend Settings & User Management
- **Local User Configuration:** Administrators can add or delete local users, selecting their roles (`administrator`, `editor`, or `viewer`) in real time.
- **SSO Form Setup:** Interactive configuration panel under Settings page for Issuer URL, Client ID, Client Secret, and redirect URLs.
- **Access Guarding:** Automatically hides or disables action buttons (like running a load test) for users logged in with the `viewer` role on the CRD dashboard.

### 4. EKS Deployment Configuration & PVCs
- **Kubernetes Spec ([k8s-deployment.yaml](file:///Users/yehoshouad/tmp/perso/k6-bedrock-dashboard/k8s-deployment.yaml)):**
  - Configures Namespace (`k6-bedrock-dashboard`), ServiceAccount, and ClusterRoleBindings to manage CRDs and namespaces.
  - Sets up a `1Gi` PersistentVolumeClaim (`k6-dashboard-sqlite-pvc`) to mount the SQLite database state at `/data/dashboard.db` with a `Recreate` deployment rollout strategy to avoid write locks.
- **Dockerization:**
  - **[backend/Dockerfile](file:///Users/yehoshouad/tmp/perso/k6-bedrock-dashboard/backend/Dockerfile):** Multi-stage builder compiling Go with CGO enabled (required for SQLite), running inside a minimal `debian:bookworm-slim` container.
  - **[frontend/Dockerfile](file:///Users/yehoshouad/tmp/perso/k6-bedrock-dashboard/frontend/Dockerfile):** Multi-stage production node environment with optimal caching.

---

## 🔍 Verification & Testing Results

### 1. Build Verification
- **Go Backend:** Compiled and built successfully:
  ```bash
  go build ./cmd/api
  ```
- **Next.js Frontend:** Built cleanly with all TypeScript type checks passing:
  ```bash
  npm run build
  ```

### 2. End-to-End Local Testing
- Verified that local user management correctly blocks editor/viewer users from viewing Settings or performing write actions.
- Verified that database migration seeds the default `admin` with SHA-256 secure hash.
