---
name: k6-bedrock-dashboard
description: >-
  Manage, build, test, and troubleshoot the K6 Bedrock Dashboard observability and performance testing application.
---

# K6 Bedrock Dashboard Management

## Overview
This skill contains instructions and best practices for managing, building, running, and troubleshooting the K6 Bedrock Dashboard platform. The application is a monorepo consisting of:
1. A **Go Backend API** (`/backend`) that decrypts EKS configs using AES-256-GCM, connects to Amazon EKS clusters via the `client-go` dynamic client, manages `k6s.k6.io` custom resources, and queries metrics from InfluxDB.
2. A **Next.js Frontend Dashboard** (`/frontend`) styled with Tailwind CSS v4, supporting multiple themes (Light, Dark, Accessibility, System), multiple languages (EN, FR, HE, ZH), and dynamic namespace managers.

## Quick Start

### 1. Running the Go Backend
Ensure Go 1.22+ is installed, then build and run the backend:
```bash
cd backend
go run ./cmd/api/main.go
```
By default, the server listens on port `8080`. To override settings, configure environment variables:
* `PORT`: Port to listen on (default: `8080`)
* `ENCRYPTION_KEY`: A 32-byte hexadecimal string used for AES-GCM credential encryption.
* `JWT_SECRET`: Secret key for signing login session tokens.

### 2. Running the Next.js Frontend
Install dependencies and run the Next.js dev server:
```bash
cd frontend
npm install
npm run dev
```
The dashboard will be available at `http://localhost:3000`.

---

## Operations & Troubleshooting

### EKS Cluster Credentials and Connection Errors
* **Region Parsing:** The backend automatically extracts the AWS region (e.g. `us-east-1`) from the EKS API Server endpoint URL. Ensure the API URL format matches standard EKS patterns.
* **Kubernetes Version Discovery:** The backend fetches EKS server version information dynamically using Discovery APIs. If the server is unreachable, it falls back to `v1.35.0-eks`.
* **RBAC Restrictions:** If the Service Account Token does not have cluster-wide permission to list namespaces, the dropdown will display only `["default"]`. The operator can use the `+ Custom Namespace...` option to manually input and select any namespace they wish to query.
* **K6 CRD Missing Error:** If you get a "Failed to fetch K6 CRDs" error in the UI, check if the K6 Operator Custom Resource Definition (`k6s.k6.io`) is installed on the EKS cluster. Install it using helm or kubectl:
  ```bash
  kubectl apply -f https://raw.githubusercontent.com/grafana/k6-operator/main/bundle.yaml
  ```

### InfluxDB Integration
* **Passwordless Connectivity:** If the InfluxDB instance does not require authentication, leave the token empty in the settings form. The backend will query the database without auth headers.
* **Panic Recovery:** A panic when updating InfluxDB configurations has been fixed by introducing nil pointer guards. If the connection fails, empty tables are returned successfully instead of crashing the server.

### Multilingual & RTL Support
* Hebrew (`he`) uses right-to-left layout direction. The application dynamically mirrors the column placement using the HTML `dir="rtl"` attribute injected by `LayoutWrapper`.
