const BASE_URL = '/api';

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 401 && typeof window !== 'undefined') {
    if (!url.includes('/auth/login') && !url.includes('/auth/sso')) {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      localStorage.removeItem('role');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
  }
  return res;
}

function getHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface ClusterConfig {
  id: string;
  name: string;
  api_server_url: string;
  auth_type: string;
  ca_cert_base64?: string;
  created_at: string;
  kubernetes_version?: string;
  region?: string;
  aws_account_id?: string;
  namespaces?: string;
  k6_operator_installed?: boolean;
}

export interface InfluxServerConfig {
  id: string;
  name: string;
  version: string;
  url: string;
  token?: string;
  org?: string;
  bucket: string;
  username?: string;
  password?: string;
  method?: string;
  is_active: boolean;
  created_at: string;
  env_defined?: boolean;
}

export type K6TemplateType = 'cronjob' | 'job' | 'testrun';

export interface K6Template {
  id: string;
  name: string;
  template_type: K6TemplateType;
  parallelism: number;
  script_name: string;
  script_file: string;
  runner_image?: string;
  cpu_limit: string;
  mem_limit: string;
  script_content: string;
  created_at: string;
  sla_thresholds?: string;
  schedule_enabled?: boolean;
  schedule_cron_expression?: string;
  schedule_active?: boolean;
  schedule_cluster_id?: string;
  schedule_namespace?: string;
}

export interface EcrCheck {
  exists: boolean;
  repository: string;
  registry: string;
  image: string;
  message?: string;
}

export interface TestSchedule {
  id?: number;
  name: string;
  cluster_id: string;
  namespace: string;
  template_id: string;
  cron_expression: string;
  active: boolean;
  created_at?: string;
}

export type CreateScheduleInput = Omit<TestSchedule, 'id' | 'created_at'> & {
  enforce_round_hour?: boolean;
};

export interface K6Report {
  key: string;
  cluster_id: string;
  namespace: string;
  template_id: string;
  run_name: string;
  timestamp: number;
}

export interface TestAlert {
  id: number;
  test_run_id: string;
  metric: string;
  threshold: string;
  value: number;
  timestamp: string;
}

export interface User {
  username: string;
  role: string;
  created_at: string;
}

export interface SSOConfig {
  name: string;
  enabled: boolean;
  issuer_url: string;
  client_id: string;
  client_secret?: string;
  redirect_uri: string;
  admin_groups?: string;
  editor_groups?: string;
}

export interface APIToken {
  token_hash: string;
  name: string;
  role: string;
  created_at: string;
  expires_at?: string;
  token?: string;
}

export interface RunDefaults {
  output_args: string;
  use_output: boolean;
  use_image: boolean;
  image_url: string;
  env_vars: { key: string; value: string }[];
}


export interface K6CRD {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp: string;
  };
  spec: any;
  status?: {
    stage: string;
    active?: boolean;
    suspended?: boolean;
  };
}

export interface BatchWorkload extends K6CRD {
  cluster_id: string;
}

export interface K8sPod {
  name: string;
  status: string;
}

export interface TestRunSummary {
  test_run_id: string;
  start_time: string;
  duration_seconds: number;
  max_vus: number;
  avg_req_duration_ms: number;
  cluster?: string;
  namespace?: string;
}

export interface TelemetryPoint {
  timestamp: string;
  metric: string;
  value: number;
}

export const api = {
  // Auth
  async login(username: string, password: string) {
    const res = await apiFetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(err.error || 'Login failed');
    }
    const data = await res.json();
    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
    localStorage.setItem('role', data.role);
    return data;
  },

  async loginSSO(user: string, email: string) {
    const res = await apiFetch(`${BASE_URL}/auth/sso`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, email }),
    });
    if (!res.ok) throw new Error('SSO login failed');
    const data = await res.json();
    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
    localStorage.setItem('role', data.role);
    return data;
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
  },

  async getMe() {
    const res = await apiFetch(`${BASE_URL}/auth/me`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Not authenticated');
    return res.json();
  },

  // Clusters
  async getClusters(): Promise<ClusterConfig[]> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch clusters');
    return res.json();
  },

  async registerCluster(cluster: Omit<ClusterConfig, 'id' | 'created_at'> & { raw_secret: string }): Promise<ClusterConfig> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(cluster),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to register cluster' }));
      throw new Error(err.error || 'Failed to register cluster');
    }
    return res.json();
  },

  async updateCluster(id: string, cluster: Omit<ClusterConfig, 'id' | 'created_at'> & { raw_secret?: string }): Promise<ClusterConfig> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(cluster),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update cluster' }));
      throw new Error(err.error || 'Failed to update cluster');
    }
    return res.json();
  },

  async deleteCluster(id: string): Promise<void> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete cluster');
  },

  async getNamespaces(clusterId: string): Promise<string[]> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/namespaces`, { headers: getHeaders() });
    if (!res.ok) return ['default'];
    return res.json();
  },

  async checkEcrRepo(clusterId: string, image: string): Promise<EcrCheck> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/ecr/check?image=${encodeURIComponent(image)}`, { headers: getHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to check ECR repository' }));
      throw new Error(err.error || 'Failed to check ECR repository');
    }
    return res.json();
  },

  async getConfigMap(clusterId: string, name: string, namespace = 'default'): Promise<{ name: string; namespace?: string; data: Record<string, string> }> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/configmaps/${name}?namespace=${namespace}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch ConfigMap');
    return res.json();
  },

  async listConfigMaps(clusterId: string, namespace = 'default'): Promise<{ name: string; namespace?: string; data: Record<string, string> }[]> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/configmaps?namespace=${namespace}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to list ConfigMaps');
    return res.json();
  },

  async deleteConfigMap(clusterId: string, name: string, namespace = 'default'): Promise<void> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/configmaps/${name}?namespace=${namespace}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete ConfigMap');
  },

  async createConfigMap(clusterId: string, namespace = 'default', body: { name: string; fileName: string; scriptContent: string }): Promise<{ name: string; data: Record<string, string> }> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/configmaps?namespace=${namespace}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Failed to create ConfigMap');
    return res.json();
  },

  async updateConfigMap(clusterId: string, name: string, data: Record<string, string>, namespace = 'default'): Promise<void> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/configmaps/${name}?namespace=${namespace}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ data }),
    });
    if (!res.ok) throw new Error('Failed to update ConfigMap');
  },

  async getOperatorStatus(): Promise<{ status: 'ready' | 'degraded' | 'unavailable'; accessible_count: number; deployed_count: number; total_count: number }> {
    const res = await apiFetch(`${BASE_URL}/k8s/operator-status`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch operator status');
    return res.json();
  },

  async getActiveTests(): Promise<{ active_count: number; first_active: string }> {
    const res = await apiFetch(`${BASE_URL}/k8s/active-tests`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch active tests count');
    return res.json();
  },

  // K6 CRDs
  async getCRDs(clusterId: string, namespace = 'default'): Promise<K6CRD[]> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/crds?namespace=${namespace}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch K6 CRDs');
    return res.json();
  },

  async createCRD(clusterId: string, namespace = 'default', spec: any): Promise<K6CRD> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/crds?namespace=${namespace}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(spec),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to create K6 CRD');
    }
    return res.json();
  },

  async deleteCRD(clusterId: string, name: string, namespace = 'default'): Promise<void> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/crds/${name}?namespace=${namespace}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete K6 CRD');
  },

  async getBatchWorkloads(clusterId: string, namespace = 'default'): Promise<K6CRD[]> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/batch-workloads?namespace=${namespace}`, {
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({} as { error?: string }));
      const detail = err.error || (res.status === 404
        ? 'batch-workloads API not found — restart the backend to pick up the latest routes'
        : `HTTP ${res.status}`);
      throw new Error(detail);
    }
    return res.json();
  },

  async toggleBatchCronJob(clusterId: string, name: string, namespace = 'default'): Promise<K6CRD> {
    const res = await apiFetch(
      `${BASE_URL}/k8s/clusters/${clusterId}/batch-workloads/cronjobs/${name}/toggle?namespace=${namespace}`,
      { method: 'POST', headers: getHeaders() },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to toggle CronJob');
    }
    return res.json();
  },

  async updateSchedule(id: number, schedule: CreateScheduleInput): Promise<TestSchedule> {
    const res = await apiFetch(`${BASE_URL}/settings/schedules/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(schedule),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update schedule');
    }
    return res.json();
  },

  // InfluxDB telemetry runs
  async getTestRuns(): Promise<TestRunSummary[]> {
    const res = await apiFetch(`${BASE_URL}/influx/runs`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch test runs');
    return res.json();
  },

  async getRunMetrics(
    runId: string, 
    metric: 'vus' | 'http_req_duration' | 'error_rate', 
    range = '1h',
    start?: string,
    stop?: string,
    cluster?: string,
    namespace?: string
  ): Promise<TelemetryPoint[]> {
    let url = `${BASE_URL}/influx/runs/${runId}/metrics?metric=${metric}`;
    if (start && stop) {
      url += `&start=${encodeURIComponent(start)}&stop=${encodeURIComponent(stop)}`;
    } else {
      url += `&range=${range}`;
    }
    if (cluster) {
      url += `&cluster=${encodeURIComponent(cluster)}`;
    }
    if (namespace) {
      url += `&namespace=${encodeURIComponent(namespace)}`;
    }
    const res = await apiFetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch run metrics');
    return res.json();
  },

  // Settings (Admin only)
  async getLocalContexts(): Promise<{ contexts: { context_name: string; cluster_name: string; api_server_url: string; is_current: boolean }[]; current_context: string }> {
    const res = await apiFetch(`${BASE_URL}/k8s/local-contexts`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch local contexts');
    return res.json();
  },

  async getInfluxConfig(): Promise<InfluxServerConfig> {
    const res = await apiFetch(`${BASE_URL}/settings/influxdb`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch InfluxDB config');
    return res.json();
  },

  async setInfluxConfig(config: Omit<InfluxServerConfig, 'id' | 'is_active' | 'created_at'>): Promise<{ success: boolean; warning?: string }> {
    const res = await apiFetch(`${BASE_URL}/settings/influxdb`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update InfluxDB config' }));
      throw new Error(err.error || 'Failed to update InfluxDB config');
    }
    return res.json();
  },

  async testInfluxConfig(config: Omit<InfluxServerConfig, 'id' | 'is_active' | 'created_at'>): Promise<void> {
    const res = await apiFetch(`${BASE_URL}/settings/influxdb/test`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Connection check failed' }));
      throw new Error(err.error || 'Connection check failed');
    }
  },

  // Multi-server InfluxDB endpoints
  async getInfluxServers(): Promise<InfluxServerConfig[]> {
    const res = await apiFetch(`${BASE_URL}/settings/influxdb/servers`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch InfluxDB servers');
    return res.json();
  },

  async createInfluxServer(config: Omit<InfluxServerConfig, 'id' | 'is_active' | 'created_at'>): Promise<InfluxServerConfig> {
    const res = await apiFetch(`${BASE_URL}/settings/influxdb/servers`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create InfluxDB server' }));
      throw new Error(err.error || 'Failed to create InfluxDB server');
    }
    return res.json();
  },

  async updateInfluxServer(id: string, config: Omit<InfluxServerConfig, 'id' | 'is_active' | 'created_at'>): Promise<InfluxServerConfig> {
    const res = await apiFetch(`${BASE_URL}/settings/influxdb/servers/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update InfluxDB server' }));
      throw new Error(err.error || 'Failed to update InfluxDB server');
    }
    return res.json();
  },

  async deleteInfluxServer(id: string): Promise<void> {
    const res = await apiFetch(`${BASE_URL}/settings/influxdb/servers/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to delete InfluxDB server' }));
      throw new Error(err.error || 'Failed to delete InfluxDB server');
    }
  },

  async activateInfluxServer(id: string): Promise<InfluxServerConfig> {
    const res = await apiFetch(`${BASE_URL}/settings/influxdb/servers/${id}/activate`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to activate InfluxDB server' }));
      throw new Error(err.error || 'Failed to activate InfluxDB server');
    }
    return res.json();
  },

  // K6 Run Templates
  async getTemplates(): Promise<K6Template[]> {
    const res = await apiFetch(`${BASE_URL}/settings/templates`, { headers: getHeaders() });
    if (!res.ok) {
      const bodyText = await res.text();
      try {
        const err = JSON.parse(bodyText);
        throw new Error(err.error || bodyText || 'Failed to fetch K6 templates');
      } catch {
        throw new Error(bodyText || 'Failed to fetch K6 templates');
      }
    }
    return res.json();
  },

  async createTemplate(template: Omit<K6Template, 'id' | 'created_at'>): Promise<K6Template> {
    const res = await apiFetch(`${BASE_URL}/settings/templates`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(template),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create template' }));
      throw new Error(err.error || 'Failed to create template');
    }
    return res.json();
  },

  async updateTemplate(id: string, template: Omit<K6Template, 'id' | 'created_at'>): Promise<K6Template> {
    const res = await apiFetch(`${BASE_URL}/settings/templates/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(template),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update template' }));
      throw new Error(err.error || 'Failed to update template');
    }
    return res.json();
  },

  async deleteTemplate(id: string): Promise<void> {
    const res = await apiFetch(`${BASE_URL}/settings/templates/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to delete template' }));
      throw new Error(err.error || 'Failed to delete template');
    }
  },

  // Local Users
  async getUsers(): Promise<User[]> {
    const res = await apiFetch(`${BASE_URL}/settings/users`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch users');
    return res.json();
  },

  async createUser(user: Omit<User, 'created_at'> & { password?: string }): Promise<User> {
    const res = await apiFetch(`${BASE_URL}/settings/users`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(user),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create user' }));
      throw new Error(err.error || 'Failed to create user');
    }
    return res.json();
  },

  async deleteUser(username: string): Promise<void> {
    const res = await apiFetch(`${BASE_URL}/settings/users/${username}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to delete user' }));
      throw new Error(err.error || 'Failed to delete user');
    }
  },

  // SSO Settings & Authentication
  async getSSOConfig(): Promise<SSOConfig> {
    const res = await apiFetch(`${BASE_URL}/settings/sso`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch SSO configuration');
    return res.json();
  },

  async saveSSOConfig(config: SSOConfig): Promise<SSOConfig> {
    const res = await apiFetch(`${BASE_URL}/settings/sso`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to save SSO configuration' }));
      throw new Error(err.error || 'Failed to save SSO configuration');
    }
    return res.json();
  },

  async getSSOStatus(): Promise<{ enabled: boolean; name?: string }> {
    const res = await apiFetch(`${BASE_URL}/auth/sso/status`);
    if (!res.ok) throw new Error('Failed to fetch SSO status');
    return res.json();
  },

  async getSSOAuthorizeUrl(): Promise<{ url: string }> {
    const res = await apiFetch(`${BASE_URL}/auth/sso/url`);
    if (!res.ok) throw new Error('Failed to fetch SSO authorization URL');
    return res.json();
  },

  async exchangeSSOCode(code: string): Promise<{ token: string; username: string; role: string }> {
    const res = await apiFetch(`${BASE_URL}/auth/sso/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'SSO token exchange failed' }));
      throw new Error(err.error || 'SSO token exchange failed');
    }
    const data = await res.json();
    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
    localStorage.setItem('role', data.role);
    return data;
  },

  // API Tokens
  async getAPITokens(): Promise<APIToken[]> {
    const res = await apiFetch(`${BASE_URL}/settings/tokens`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch API tokens');
    return res.json();
  },

  async createAPIToken(name: string, role: string, expiryDays: number): Promise<APIToken> {
    const res = await apiFetch(`${BASE_URL}/settings/tokens`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, role, expiry_days: expiryDays }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to generate API token' }));
      throw new Error(err.error || 'Failed to generate API token');
    }
    return res.json();
  },

  async deleteAPIToken(tokenHash: string): Promise<void> {
    const res = await apiFetch(`${BASE_URL}/settings/tokens/${tokenHash}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to delete API token' }));
      throw new Error(err.error || 'Failed to delete API token');
    }
  },

  // CRD Relaunch
  async relaunchCRD(clusterId: string, name: string, namespace: string): Promise<any> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/crds/${name}/relaunch?namespace=${namespace}`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to relaunch test' }));
      throw new Error(err.error || 'Failed to relaunch test');
    }
    return res.json();
  },

  // Schedules CRUD
  async getSchedules(): Promise<TestSchedule[]> {
    const res = await apiFetch(`${BASE_URL}/settings/schedules`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch schedules');
    return res.json();
  },

  async createSchedule(schedule: CreateScheduleInput): Promise<TestSchedule> {
    const res = await apiFetch(`${BASE_URL}/settings/schedules`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(schedule),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create schedule' }));
      throw new Error(err.error || 'Failed to create schedule');
    }
    return res.json();
  },

  async deleteSchedule(id: number): Promise<void> {
    const res = await apiFetch(`${BASE_URL}/settings/schedules/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete schedule');
  },

  async runSchedule(id: number): Promise<{ success: boolean }> {
    const res = await apiFetch(`${BASE_URL}/settings/schedules/${id}/run`, {
      method: 'POST',
      headers: getHeaders()
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to trigger schedule');
    }
    return res.json();
  },

  async toggleSchedule(id: number): Promise<TestSchedule> {
    const res = await apiFetch(`${BASE_URL}/settings/schedules/${id}/toggle`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to toggle schedule status');
    }
    return res.json();
  },

  async getReports(): Promise<K6Report[]> {
    const res = await apiFetch(`${BASE_URL}/reports`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch reports');
    return res.json();
  },

  // SLA Alerts
  async getAlerts(): Promise<TestAlert[]> {
    const res = await apiFetch(`${BASE_URL}/influx/alerts`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch SLA alerts');
    return res.json();
  },

  // Pod Logs
  async getPodLogs(clusterId: string, podName: string, namespace: string, follow = false): Promise<string> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/pods/${podName}/logs?namespace=${namespace}&follow=${follow}`, { headers: getHeaders() });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      try {
        const json = JSON.parse(errText);
        throw new Error(json.error || json.message || 'Failed to fetch pod logs');
      } catch {
        throw new Error(errText || 'Failed to fetch pod logs');
      }
    }
    return res.text();
  },

  async listPods(clusterId: string, namespace: string): Promise<K8sPod[]> {
    const res = await apiFetch(`${BASE_URL}/k8s/clusters/${clusterId}/pods?namespace=${namespace}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to list pods');
    return res.json();
  },

  async getRunDefaults(): Promise<RunDefaults> {
    const res = await apiFetch(`${BASE_URL}/settings/defaults`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch run defaults');
    const raw = await res.json();
    const envVars = Array.isArray(raw.env_vars)
      ? raw.env_vars.map((entry: any) => ({
          key: typeof entry?.key === 'string' ? entry.key : (typeof entry?.name === 'string' ? entry.name : ''),
          value: typeof entry?.value === 'string' ? entry.value : '',
        })).filter((entry: { key: string; value: string }) => entry.key !== '' || entry.value !== '')
      : [];
    return {
      output_args: raw.output_args ?? '--out influxdb=http://grafana-hub-influxdb.grafana-hub.svc.cluster.local:8086/k6s',
      use_output:  raw.use_output === 'true',
      use_image:   raw.use_image  === 'true',
      image_url:   raw.image_url   ?? '',
      env_vars:    envVars,
    };
  },

  async saveRunDefaults(d: RunDefaults): Promise<void> {
    const body = {
      output_args: d.output_args,
      use_output:  d.use_output  ? 'true' : 'false',
      use_image:   d.use_image   ? 'true' : 'false',
      image_url:   d.image_url,
      env_vars:    d.env_vars.map((entry) => ({ key: entry.key, value: entry.value })),
    };
    const res = await apiFetch(`${BASE_URL}/settings/defaults`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Failed to save run defaults');
  },
};


