'use client';

import React, { useEffect, useState } from 'react';
import { 
  Settings, 
  Database, 
  Server, 
  ShieldAlert, 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  Trash2, 
  X,
  HardDrive,
  Edit,
  FileCode2,
  Users,
  Key
} from 'lucide-react';
import { api, ClusterConfig, InfluxServerConfig, K6Template, User, SSOConfig } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';

export default function SettingsPage() {
  const { t } = usePreferences();
  
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  
  // K8s Clusters settings state
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const [newCluster, setNewCluster] = useState({
    name: '',
    api_server_url: '',
    auth_type: 'token',
    raw_secret: '',
    ca_cert_base64: ''
  });
  const [allowedNamespaces, setAllowedNamespaces] = useState<string[]>([]);
  const [customNamespaceInput, setCustomNamespaceInput] = useState('');
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null);
  
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState('');

  // Local contexts settings state
  const [localContexts, setLocalContexts] = useState<{ context_name: string; cluster_name: string; api_server_url: string; is_current: boolean }[]>([]);
  const [loadingContexts, setLoadingContexts] = useState(false);

  const loadLocalContexts = async () => {
    try {
      setLoadingContexts(true);
      const data = await api.getLocalContexts();
      const contexts = data.contexts || [];
      setLocalContexts(contexts);
      
      if (data.current_context) {
        const current = contexts.find(c => c.context_name === data.current_context);
        if (current) {
          setNewCluster(prev => ({
            ...prev,
            raw_secret: current.context_name,
            api_server_url: current.api_server_url,
            name: prev.name || (current.context_name.split('/').pop() || 'K8s Cluster')
          }));
        }
      } else if (contexts.length > 0) {
        const first = contexts[0];
        setNewCluster(prev => ({
          ...prev,
          raw_secret: first.context_name,
          api_server_url: first.api_server_url,
          name: prev.name || (first.context_name.split('/').pop() || 'K8s Cluster')
        }));
      }
    } catch (err) {
      console.error('Failed to load local contexts', err);
    } finally {
      setLoadingContexts(false);
    }
  };

  useEffect(() => {
    if (newCluster.auth_type === 'local' && isModalOpen) {
      loadLocalContexts();
    }
  }, [newCluster.auth_type, isModalOpen]);

  // InfluxDB settings state
  const [influxServers, setInfluxServers] = useState<InfluxServerConfig[]>([]);
  const [loadingInfluxServers, setLoadingInfluxServers] = useState(false);
  const [isInfluxModalOpen, setIsInfluxModalOpen] = useState(false);
  const [isEditingInflux, setIsEditingInflux] = useState(false);
  const [editingInfluxId, setEditingInfluxId] = useState<string | null>(null);

  const [influxConfig, setInfluxConfig] = useState({
    name: '',
    version: 'v2',
    url: '',
    token: '',
    org: '',
    bucket: '',
    username: '',
    password: '',
    method: 'POST'
  });
  const [useInfluxAuth, setUseInfluxAuth] = useState(false);
  const [savingInflux, setSavingInflux] = useState(false);
  const [influxSuccess, setInfluxSuccess] = useState('');
  const [influxError, setInfluxError] = useState('');
  const [testingInflux, setTestingInflux] = useState(false);
  const [influxTestSuccess, setInfluxTestSuccess] = useState('');
  const [influxTestError, setInfluxTestError] = useState('');

  const loadInfluxServers = async () => {
    try {
      setLoadingInfluxServers(true);
      const list = await api.getInfluxServers();
      setInfluxServers(list || []);
    } catch (err) {
      console.error('Failed to load InfluxDB servers', err);
    } finally {
      setLoadingInfluxServers(false);
    }
  };

  const handleStartAddInflux = () => {
    setIsEditingInflux(false);
    setEditingInfluxId(null);
    setInfluxConfig({
      name: '',
      version: 'v2',
      url: '',
      token: '',
      org: '',
      bucket: '',
      username: '',
      password: '',
      method: 'POST'
    });
    setUseInfluxAuth(false);
    setInfluxSuccess('');
    setInfluxError('');
    setInfluxTestSuccess('');
    setInfluxTestError('');
    setIsInfluxModalOpen(true);
  };

  const handleStartEditInflux = (server: InfluxServerConfig) => {
    setIsEditingInflux(true);
    setEditingInfluxId(server.id);
    setInfluxConfig({
      name: server.name,
      version: server.version,
      url: server.url,
      token: server.token || '',
      org: server.org || '',
      bucket: server.bucket,
      username: server.username || '',
      password: server.password || '',
      method: server.method || 'POST'
    });
    setUseInfluxAuth(!!(server.username || server.password));
    setInfluxSuccess('');
    setInfluxError('');
    setInfluxTestSuccess('');
    setInfluxTestError('');
    setIsInfluxModalOpen(true);
  };

  const handleSaveInfluxServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setInfluxSuccess('');
    setInfluxError('');
    setSavingInflux(true);

    try {
      const payload = {
        ...influxConfig,
        username: useInfluxAuth ? influxConfig.username : '',
        password: useInfluxAuth ? influxConfig.password : ''
      };

      const res = await api.setInfluxConfig(payload);
      if (res && res.warning) {
        setInfluxSuccess(`Saved, but: ${res.warning}`);
      } else {
        setInfluxSuccess('InfluxDB configuration saved successfully.');
      }
      await loadUniqueInfluxConfig();
    } catch (err: any) {
      setInfluxError(err.message || 'Failed to save InfluxDB configuration');
    } finally {
      setSavingInflux(false);
    }
  };

  const handleDeleteInfluxServer = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete the InfluxDB server "${name}"?`)) return;
    try {
      await api.deleteInfluxServer(id);
      await loadInfluxServers();
    } catch (err: any) {
      alert(err.message || 'Error deleting InfluxDB server');
    }
  };

  const handleActivateInfluxServer = async (id: string) => {
    try {
      await api.activateInfluxServer(id);
      await loadInfluxServers();
    } catch (err: any) {
      alert(err.message || 'Error activating InfluxDB server');
    }
  };

  const handleTestInfluxConfig = async (e: React.MouseEvent) => {
    e.preventDefault();
    setInfluxTestSuccess('');
    setInfluxTestError('');
    setTestingInflux(true);

    try {
      const payload = {
        ...influxConfig,
        username: useInfluxAuth ? influxConfig.username : '',
        password: useInfluxAuth ? influxConfig.password : ''
      };
      await api.testInfluxConfig(payload);
      setInfluxTestSuccess('InfluxDB connection verified successfully!');
    } catch (err: any) {
      setInfluxTestError(err.message || 'Failed to verify InfluxDB connection');
    } finally {
      setTestingInflux(false);
    }
  };

  // K6 Run Templates state
  const [templates, setTemplates] = useState<K6Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);

  const DEFAULT_SCRIPT_TEMPLATE = `import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  vus: 1,
  duration: '10s',
};

export default function () {
  http.get('https://test.k6.io');
  sleep(1);
}`;

  const [templateConfig, setTemplateConfig] = useState({
    name: '',
    parallelism: 1,
    script_name: 'k6-test-script',
    script_file: 'test.js',
    cpu_limit: '10m',
    mem_limit: '16Mi',
    script_content: DEFAULT_SCRIPT_TEMPLATE
  });

  const loadTemplates = async () => {
    try {
      setLoadingTemplates(true);
      const list = await api.getTemplates();
      setTemplates(list || []);
    } catch (err) {
      console.error('Failed to load templates', err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleStartAddTemplate = () => {
    setIsEditingTemplate(false);
    setEditingTemplateId(null);
    setTemplateConfig({
      name: '',
      parallelism: 1,
      script_name: 'k6-test-script',
      script_file: 'test.js',
      cpu_limit: '10m',
      mem_limit: '16Mi',
      script_content: DEFAULT_SCRIPT_TEMPLATE
    });
    setTemplateError('');
    setIsTemplateModalOpen(true);
  };

  const handleStartEditTemplate = (tmpl: K6Template) => {
    setIsEditingTemplate(true);
    setEditingTemplateId(tmpl.id);
    setTemplateConfig({
      name: tmpl.name,
      parallelism: tmpl.parallelism,
      script_name: tmpl.script_name,
      script_file: tmpl.script_file,
      cpu_limit: tmpl.cpu_limit,
      mem_limit: tmpl.mem_limit,
      script_content: tmpl.script_content
    });
    setTemplateError('');
    setIsTemplateModalOpen(true);
  };

  const handleSaveTemplateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setTemplateError('');
    setSavingTemplate(true);

    try {
      if (isEditingTemplate && editingTemplateId) {
        await api.updateTemplate(editingTemplateId, templateConfig);
      } else {
        await api.createTemplate(templateConfig);
      }
      setIsTemplateModalOpen(false);
      await loadTemplates();
    } catch (err: any) {
      setTemplateError(err.message || 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete the template "${name}"?`)) return;
    try {
      await api.deleteTemplate(id);
      await loadTemplates();
    } catch (err: any) {
      alert(err.message || 'Error deleting template');
    }
  };

  // User Management state
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [newUserAccount, setNewUserAccount] = useState({
    username: '',
    password: '',
    role: 'editor'
  });
  const [userError, setUserError] = useState('');
  const [savingUser, setSavingUser] = useState(false);

  // SSO state
  const [ssoConfig, setSsoConfig] = useState<SSOConfig>({
    name: '',
    enabled: false,
    issuer_url: '',
    client_id: '',
    client_secret: '',
    redirect_uri: typeof window !== 'undefined' ? `${window.location.origin}/login` : 'http://localhost:3000/login',
    admin_groups: '',
    editor_groups: ''
  });
  const [loadingSSO, setLoadingSSO] = useState(false);
  const [ssoSuccess, setSsoSuccess] = useState('');
  const [ssoError, setSsoError] = useState('');
  const [savingSSO, setSavingSSO] = useState(false);

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      const list = await api.getUsers();
      setUsers(list || []);
    } catch (err) {
      console.error('Failed to load users', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadSSOConfig = async () => {
    try {
      setLoadingSSO(true);
      const config = await api.getSSOConfig();
      if (config) {
        setSsoConfig({
          name: config.name || '',
          enabled: config.enabled,
          issuer_url: config.issuer_url || '',
          client_id: config.client_id || '',
          client_secret: config.client_secret || '',
          redirect_uri: config.redirect_uri || (typeof window !== 'undefined' ? `${window.location.origin}/login` : 'http://localhost:3000/login'),
          admin_groups: config.admin_groups !== undefined ? config.admin_groups : '',
          editor_groups: config.editor_groups !== undefined ? config.editor_groups : ''
        });
      }
    } catch (err) {
      console.error('Failed to load SSO configuration', err);
    } finally {
      setLoadingSSO(false);
    }
  };

  const [influxEnvDefined, setInfluxEnvDefined] = useState(false);

  const loadUniqueInfluxConfig = async () => {
    try {
      const config = await api.getInfluxConfig();
      if (config) {
        setInfluxConfig({
          name: config.name || 'Default InfluxDB',
          version: config.version || 'v2',
          url: config.url || '',
          token: config.token || '',
          org: config.org || '',
          bucket: config.bucket || '',
          username: config.username || '',
          password: config.password || '',
          method: config.method || 'POST'
        });
        setUseInfluxAuth(!!(config.username || config.password));
        setInfluxEnvDefined(!!config.env_defined);
      }
    } catch (err) {
      console.error('Failed to load InfluxDB config', err);
    }
  };

  const handleStartAddUser = () => {
    setNewUserAccount({
      username: '',
      password: '',
      role: 'editor'
    });
    setUserError('');
    setIsUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserError('');
    setSavingUser(true);

    try {
      await api.createUser(newUserAccount);
      setIsUserModalOpen(false);
      await loadUsers();
    } catch (err: any) {
      setUserError(err.message || 'Failed to save user');
    } finally {
      setSavingUser(false);
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (username === 'admin') {
      alert('Cannot delete the main admin account.');
      return;
    }
    if (!confirm(`Are you sure you want to delete the user "${username}"?`)) return;
    try {
      await api.deleteUser(username);
      await loadUsers();
    } catch (err: any) {
      alert(err.message || 'Error deleting user');
    }
  };

  const handleSaveSSO = async (e: React.FormEvent) => {
    e.preventDefault();
    setSsoSuccess('');
    setSsoError('');
    setSavingSSO(true);

    try {
      await api.saveSSOConfig(ssoConfig);
      setSsoSuccess('SSO configuration saved successfully.');
      await loadSSOConfig();
    } catch (err: any) {
      setSsoError(err.message || 'Failed to save SSO configuration');
    } finally {
      setSavingSSO(false);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const role = localStorage.getItem('role');
      setIsAdmin(role === 'administrator');
    }
  }, []);

  const loadSettingsData = async () => {
    if (!isAdmin) return;
    try {
      setLoadingClusters(true);
      const clusterList = await api.getClusters();
      setClusters(clusterList || []);

      await loadUniqueInfluxConfig();
      await loadTemplates();
      await loadUsers();
      await loadSSOConfig();
    } catch (err) {
      console.error('Failed to load settings data', err);
    } finally {
      setLoadingClusters(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadSettingsData();
    }
  }, [isAdmin]);

  const handleStartEdit = (c: ClusterConfig) => {
    setEditingClusterId(c.id);
    setIsEditing(true);
    setNewCluster({
      name: c.name,
      api_server_url: c.api_server_url,
      auth_type: c.auth_type,
      raw_secret: '', // leave empty if not updating the secret
      ca_cert_base64: c.ca_cert_base64 || ''
    });
    setAllowedNamespaces(c.namespaces ? c.namespaces.split(',').map(s => s.trim()).filter(Boolean) : []);
    setIsModalOpen(true);
  };

  const handleStartAdd = () => {
    setIsEditing(false);
    setEditingClusterId(null);
    setNewCluster({
      name: '',
      api_server_url: '',
      auth_type: 'token',
      raw_secret: '',
      ca_cert_base64: ''
    });
    setAllowedNamespaces([]);
    setIsModalOpen(true);
  };

  const handleRegisterCluster = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');

    // Require raw_secret if registering a new cluster (except for in-cluster type)
    if (!isEditing && newCluster.auth_type !== 'in-cluster' && !newCluster.raw_secret) {
      setRegError('Authentication credentials or context selection are required.');
      return;
    }

    setRegistering(true);

    try {
      const namespacesStr = allowedNamespaces.filter(Boolean).join(',');
      const payload = {
        ...newCluster,
        namespaces: namespacesStr
      };

      if (isEditing && editingClusterId) {
        await api.updateCluster(editingClusterId, payload);
      } else {
        await api.registerCluster(payload);
      }
      
      setIsModalOpen(false);
      setIsEditing(false);
      setEditingClusterId(null);
      setNewCluster({
        name: '',
        api_server_url: '',
        auth_type: 'token',
        raw_secret: '',
        ca_cert_base64: ''
      });
      setAllowedNamespaces([]);
      const clusterList = await api.getClusters();
      setClusters(clusterList || []);
    } catch (err: any) {
      setRegError(err.message || t('k8sSettingsError'));
    } finally {
      setRegistering(false);
    }
  };

  const handleDeleteCluster = async (id: string, name: string) => {
    if (!confirm(`${t('delete')} ${name}?`)) return;
    try {
      await api.deleteCluster(id);
      setClusters(clusters.filter(c => c.id !== id));
    } catch (err) {
      alert('Error deleting cluster');
    }
  };


  // Render Access Denied for viewers/SSO users
  if (isAdmin === false) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-4 animate-fadeIn">
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-3xl text-red-400">
          <ShieldAlert className="w-12 h-12" />
        </div>
        <h3 className="text-2xl font-bold text-white">{t('accessForbidden')}</h3>
        <p className="text-slate-400 text-sm max-w-md">
          {t('adminRequired')}
        </p>
      </div>
    );
  }

  if (isAdmin === null) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-slate-500">
        Verification...
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Title */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
          <Settings className="w-8 h-8 text-purple-400" />
          <span>{t('settingsTitle')}</span>
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          {t('settingsSub')}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        
        {/* Left Column: K8s Clusters definitions */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-purple-400" />
              <span>{t('k8sClusters')}</span>
            </h3>
            <button
              onClick={handleStartAdd}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer hover:scale-102 active:scale-98 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('addCluster')}</span>
            </button>
          </div>

          {loadingClusters ? (
            <div className="py-12 text-center text-slate-500 text-xs">Loading...</div>
          ) : clusters.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">No clusters defined.</div>
          ) : (
            <div className="space-y-3">
              {clusters.map((c) => (
                <div 
                  key={c.id} 
                  className="flex items-center justify-between p-4 bg-slate-950/40 border border-slate-800/60 rounded-2xl"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="p-2.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl shrink-0">
                      <HardDrive className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="text-xs font-semibold text-slate-200 truncate">{c.name}</p>
                        {c.namespaces && (
                          <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700/50 rounded-md text-[8px] font-mono">
                            {c.namespaces.split(',').length} NS
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-500 font-mono truncate">{c.api_server_url}</p>
                    </div>
                  </div>

                  <div className="flex space-x-1 shrink-0">
                    <button
                      onClick={() => handleStartEdit(c)}
                      title="Edit Cluster"
                      className="p-2 border border-transparent hover:border-purple-500/25 hover:bg-purple-500/10 text-slate-500 hover:text-purple-400 rounded-xl transition cursor-pointer"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteCluster(c.id, c.name)}
                      title="Delete Cluster"
                      className="p-2 border border-transparent hover:border-red-500/25 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-xl transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: InfluxDB Connection credentials */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-purple-400" />
              <span>{t('influxConfigTitle')}</span>
            </h3>
            {influxEnvDefined && (
              <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-md text-[10px] font-bold uppercase tracking-wider">
                Configured via Env
              </span>
            )}
          </div>

          {influxSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs">
              {influxSuccess}
            </div>
          )}
          {influxError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
              {influxError}
            </div>
          )}
          {influxTestSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs">
              {influxTestSuccess}
            </div>
          )}
          {influxTestError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
              {influxTestError}
            </div>
          )}

          <form onSubmit={handleSaveInfluxServer} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">URL</label>
                <input
                  type="url"
                  required
                  disabled={influxEnvDefined}
                  placeholder="http://influxdb.monitoring.svc:8086"
                  value={influxConfig.url}
                  onChange={(e) => setInfluxConfig({ ...influxConfig, url: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono disabled:opacity-55 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Version</label>
                <select
                  disabled={influxEnvDefined}
                  value={influxConfig.version}
                  onChange={(e) => setInfluxConfig({ ...influxConfig, version: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                >
                  <option value="v2">v2 (Flux)</option>
                  <option value="v1">v1 (InfluxQL)</option>
                </select>
              </div>
            </div>

            {influxConfig.version === 'v2' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Organization</label>
                  <input
                    type="text"
                    required
                    disabled={influxEnvDefined}
                    placeholder="k6-monitoring"
                    value={influxConfig.org}
                    onChange={(e) => setInfluxConfig({ ...influxConfig, org: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Bucket</label>
                  <input
                    type="text"
                    required
                    disabled={influxEnvDefined}
                    placeholder="k6"
                    value={influxConfig.bucket}
                    onChange={(e) => setInfluxConfig({ ...influxConfig, bucket: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Database (Bucket)</label>
                  <input
                    type="text"
                    required
                    disabled={influxEnvDefined}
                    placeholder="k6"
                    value={influxConfig.bucket}
                    onChange={(e) => setInfluxConfig({ ...influxConfig, bucket: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">HTTP Query Method</label>
                  <select
                    disabled={influxEnvDefined}
                    value={influxConfig.method}
                    onChange={(e) => setInfluxConfig({ ...influxConfig, method: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                  >
                    <option value="POST">POST (Recommended)</option>
                    <option value="GET">GET</option>
                  </select>
                </div>
              </div>
            )}

            {influxConfig.version === 'v2' ? (
              <div className="animate-fadeIn">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">API Authentication Token</label>
                <input
                  type="password"
                  required
                  disabled={influxEnvDefined}
                  placeholder="••••••••••••••••••••••••"
                  value={influxConfig.token}
                  onChange={(e) => setInfluxConfig({ ...influxConfig, token: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono disabled:opacity-55 disabled:cursor-not-allowed"
                />
              </div>
            ) : (
              <div className="space-y-4 animate-fadeIn">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="useInfluxAuthCheck"
                    disabled={influxEnvDefined}
                    checked={useInfluxAuth}
                    onChange={(e) => setUseInfluxAuth(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-800 text-purple-600 bg-slate-950 focus:ring-purple-500 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                  <label htmlFor="useInfluxAuthCheck" className="text-xs font-semibold text-slate-400 cursor-pointer select-none">
                    Use Basic Authentication
                  </label>
                </div>

                {useInfluxAuth && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Username</label>
                      <input
                        type="text"
                        required
                        disabled={influxEnvDefined}
                        placeholder="admin"
                        value={influxConfig.username}
                        onChange={(e) => setInfluxConfig({ ...influxConfig, username: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none disabled:opacity-55 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Password</label>
                      <input
                        type="password"
                        required
                        disabled={influxEnvDefined}
                        placeholder="••••••••"
                        value={influxConfig.password}
                        onChange={(e) => setInfluxConfig({ ...influxConfig, password: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono disabled:opacity-55 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {!influxEnvDefined && (
              <div className="grid grid-cols-2 gap-4 pt-2">
                <button
                  type="button"
                  onClick={handleTestInfluxConfig}
                  disabled={testingInflux}
                  className="py-2.5 bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-semibold shadow-md cursor-pointer transition disabled:opacity-50"
                >
                  {testingInflux ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  type="submit"
                  disabled={savingInflux}
                  className="py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer transition hover:scale-102 active:scale-98 disabled:opacity-50"
                >
                  {savingInflux ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            )}
          </form>
        </div>

      </div>

      {/* K6 Run Templates Section */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-purple-400" />
            <span>K6 Run Templates</span>
          </h3>
          <button
            onClick={handleStartAddTemplate}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer hover:scale-102 active:scale-98 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Template</span>
          </button>
        </div>

        {loadingTemplates ? (
          <div className="py-12 text-center text-slate-500 text-xs">Loading templates...</div>
        ) : templates.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">No K6 templates defined. Add one to customize your run configurations.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((tmpl) => (
              <div 
                key={tmpl.id} 
                className="flex flex-col justify-between p-5 bg-slate-950/40 border border-slate-800/60 rounded-2xl space-y-4"
              >
                <div className="flex items-start justify-between min-w-0">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="p-2.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl shrink-0">
                      <FileCode2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-200 truncate">{tmpl.name}</p>
                      <p className="text-[10px] text-slate-500 font-mono truncate">{tmpl.script_name} ({tmpl.script_file})</p>
                    </div>
                  </div>

                  <div className="flex space-x-1 shrink-0">
                    <button
                      onClick={() => handleStartEditTemplate(tmpl)}
                      title="Edit Template"
                      className="p-2 border border-transparent hover:border-purple-500/25 hover:bg-purple-500/10 text-slate-500 hover:text-purple-400 rounded-xl transition cursor-pointer"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(tmpl.id, tmpl.name)}
                      title="Delete Template"
                      className="p-2 border border-transparent hover:border-red-500/25 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-xl transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10px] bg-slate-950/60 p-3 rounded-xl border border-slate-900 text-slate-400 font-medium">
                  <div>
                    <span className="text-slate-500 block text-[8px] uppercase tracking-wider">Parallelism</span>
                    <span className="text-slate-300 font-semibold">{tmpl.parallelism} {tmpl.parallelism > 1 ? 'runners' : 'runner'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[8px] uppercase tracking-wider">CPU Limit</span>
                    <span className="text-slate-300 font-semibold">{tmpl.cpu_limit}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[8px] uppercase tracking-wider">Memory Limit</span>
                    <span className="text-slate-300 font-semibold">{tmpl.mem_limit}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Users and SSO Section Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        
        {/* User Management Panel */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-400" />
              <span>User Management</span>
            </h3>
            <button
              onClick={handleStartAddUser}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-md cursor-pointer hover:scale-102 active:scale-98 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add User</span>
            </button>
          </div>

          {loadingUsers ? (
            <div className="py-12 text-center text-slate-500 text-xs">Loading users...</div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">No users defined.</div>
          ) : (
            <div className="space-y-3">
              {users.map((usr) => (
                <div 
                  key={usr.username} 
                  className="flex items-center justify-between p-4 bg-slate-950/40 border border-slate-800/60 rounded-2xl"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="p-2.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl shrink-0">
                      <Users className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-200 truncate">{usr.username}</p>
                      <p className="text-[10px] text-slate-500 font-mono truncate">Role: <strong className="font-semibold capitalize text-purple-400">{usr.role}</strong></p>
                    </div>
                  </div>

                  <div className="flex space-x-1 shrink-0">
                    <button
                      onClick={() => handleDeleteUser(usr.username)}
                      disabled={usr.username === 'admin'}
                      title="Delete User"
                      className="p-2 border border-transparent hover:border-red-500/25 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-xl transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SSO Setup Panel */}
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6 animate-fadeIn">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-purple-400" />
              <span>OIDC SSO Setup</span>
            </h3>
          </div>

          {ssoSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs animate-fadeIn">
              {ssoSuccess}
            </div>
          )}
          {ssoError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs animate-fadeIn">
              {ssoError}
            </div>
          )}

          <form onSubmit={handleSaveSSO} className="space-y-4">
            <div className="flex items-center space-x-2.5 py-1">
              <input
                type="checkbox"
                id="enableSSOCheckbox"
                checked={ssoConfig.enabled}
                onChange={(e) => setSsoConfig({ ...ssoConfig, enabled: e.target.checked })}
                className="w-4 h-4 rounded border-slate-800 text-purple-600 bg-slate-950 focus:ring-purple-500 cursor-pointer"
              />
              <label htmlFor="enableSSOCheckbox" className="text-xs font-semibold text-slate-300 cursor-pointer select-none">
                Enable Single Sign-On (SSO / OpenID Connect)
              </label>
            </div>

            {ssoConfig.enabled && (
              <div className="space-y-4 animate-fadeIn">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">SSO Provider Name (Display Name)</label>
                  <input
                    type="text"
                    placeholder="e.g. Okta, Keycloak, Auth0 (default is 'SSO')"
                    value={ssoConfig.name}
                    onChange={(e) => setSsoConfig({ ...ssoConfig, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">OIDC Issuer URL</label>
                  <input
                    type="url"
                    required
                    placeholder="https://keycloak.company.local/realms/myrealm"
                    value={ssoConfig.issuer_url}
                    onChange={(e) => setSsoConfig({ ...ssoConfig, issuer_url: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Client ID</label>
                    <input
                      type="text"
                      required
                      placeholder="k6-bedrock-dashboard"
                      value={ssoConfig.client_id}
                      onChange={(e) => setSsoConfig({ ...ssoConfig, client_id: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Client Secret</label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••••••••••"
                      value={ssoConfig.client_secret || ''}
                      onChange={(e) => setSsoConfig({ ...ssoConfig, client_secret: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Redirect URL (SSO Callback)</label>
                  <input
                    type="text"
                    required
                    value={ssoConfig.redirect_uri}
                    onChange={(e) => setSsoConfig({ ...ssoConfig, redirect_uri: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Administrator Groups (Local administrator permissions)</label>
                    <input
                      type="text"
                      placeholder="group-devops-admin, infra-ext-users"
                      value={ssoConfig.admin_groups || ''}
                      onChange={(e) => setSsoConfig({ ...ssoConfig, admin_groups: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Editor Groups (Local editor permissions)</label>
                    <input
                      type="text"
                      placeholder="group-editor-users, technical-users"
                      value={ssoConfig.editor_groups || ''}
                      onChange={(e) => setSsoConfig({ ...ssoConfig, editor_groups: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={savingSSO}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
              >
                {savingSSO ? 'Saving SSO Settings...' : 'Save SSO Settings'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Register Cluster Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl p-8 shadow-2xl relative">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-bold text-white mb-2">
              {isEditing ? 'Edit K8s Cluster' : t('addCluster')}
            </h3>
            <p className="text-slate-400 text-xs mb-6">
              {isEditing 
                ? 'Update settings and namespace permissions for this K8s cluster.' 
                : t('addClusterDesc')}
            </p>

            {regError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {regError}
              </div>
            )}

            <form onSubmit={handleRegisterCluster} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('clusterName')}</label>
                <input
                  type="text"
                  required
                  placeholder="K8s-Prod-Cluster"
                  value={newCluster.name}
                  onChange={(e) => setNewCluster({ ...newCluster, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                />
              </div>

              {newCluster.auth_type !== 'in-cluster' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('apiServerUrl')}</label>
                  <input
                    type="text"
                    required
                    placeholder="https://abc123xyz.yl4.us-west-2.eks.amazonaws.com"
                    value={newCluster.api_server_url}
                    onChange={(e) => setNewCluster({ ...newCluster, api_server_url: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={newCluster.auth_type === 'local' || newCluster.auth_type === 'in-cluster' ? "col-span-2" : ""}>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('authType')}</label>
                  <select
                    value={newCluster.auth_type}
                    onChange={(e) => setNewCluster({ ...newCluster, auth_type: e.target.value, raw_secret: '' })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                  >
                    <option value="in-cluster">In-Cluster ServiceAccount (Default)</option>
                    <option value="token">Service Account Token</option>
                    <option value="kubeconfig">Kubeconfig (YAML)</option>
                    <option value="local">Local Kubeconfig (Context)</option>
                  </select>
                </div>
                {newCluster.auth_type !== 'local' && newCluster.auth_type !== 'in-cluster' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('caCertDesc')}</label>
                    <input
                      type="text"
                      placeholder="LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t..."
                      value={newCluster.ca_cert_base64}
                      onChange={(e) => setNewCluster({ ...newCluster, ca_cert_base64: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                    />
                  </div>
                )}
              </div>

              {newCluster.auth_type === 'in-cluster' ? (
                <div className="p-3.5 bg-purple-500/5 border border-purple-500/10 rounded-2xl">
                  <p className="text-xs text-purple-300 font-medium">
                    In-Cluster authentication uses the pod's service account credentials automatically. No extra tokens or endpoint URLs are required.
                  </p>
                </div>
              ) : newCluster.auth_type === 'local' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Local Kubeconfig Context</label>
                  {loadingContexts ? (
                    <div className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-500">
                      Loading contexts...
                    </div>
                  ) : localContexts.length === 0 ? (
                    <div className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-red-400">
                      No contexts found in ~/.kube/.config or ~/.kube/config
                    </div>
                  ) : (
                    <select
                      value={newCluster.raw_secret}
                      onChange={(e) => {
                        const ctxName = e.target.value;
                        const matched = localContexts.find(c => c.context_name === ctxName);
                        setNewCluster({
                          ...newCluster,
                          raw_secret: ctxName,
                          api_server_url: matched ? matched.api_server_url : newCluster.api_server_url,
                          name: newCluster.name || (ctxName.split('/').pop() || 'K8s Cluster')
                        });
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                    >
                      <option value="">-- Select Kube Context --</option>
                      {localContexts.map((ctx) => (
                        <option key={ctx.context_name} value={ctx.context_name}>
                          {ctx.context_name} {ctx.is_current ? ' (Active)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                    {newCluster.auth_type === 'token' ? t('secretToken') : t('kubeconfigYaml')}
                    {isEditing && <span className="text-slate-500 ml-1.5">(Optional)</span>}
                  </label>
                  <textarea
                    required={!isEditing}
                    rows={4}
                    placeholder={
                      isEditing
                        ? 'Leave blank to keep existing cluster credentials'
                        : newCluster.auth_type === 'token'
                        ? 'eyJhbGciOiJSUzI1NiIsImt...'
                        : 'apiVersion: v1\nclusters:\n...'
                    }
                    value={newCluster.raw_secret}
                    onChange={(e) => setNewCluster({ ...newCluster, raw_secret: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none font-mono text-xs"
                  />
                </div>
              )}

              {/* Allowed Namespaces Whitelist */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-400">
                  Allowed Namespaces
                </label>
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 space-y-3">
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Limit the namespaces available for load testing. If no namespaces are checked or added, all discovered namespaces on the cluster will be available.
                  </p>
                  
                  {/* Common namespace presets and added namespaces */}
                  <div className="flex flex-wrap gap-2">
                    {['default', 'k6-test', 'testing', 'monitoring'].map((ns) => {
                      const isChecked = allowedNamespaces.includes(ns);
                      return (
                        <label 
                          key={ns}
                          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs cursor-pointer select-none transition-all duration-200 ${
                            isChecked
                              ? 'bg-purple-500/10 border-purple-500/40 text-purple-300'
                              : 'bg-slate-900 border-slate-800/80 text-slate-500 hover:text-slate-400 hover:bg-slate-800/40'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                setAllowedNamespaces(allowedNamespaces.filter(n => n !== ns));
                              } else {
                                setAllowedNamespaces([...allowedNamespaces, ns]);
                              }
                            }}
                          />
                          <span>{ns}</span>
                        </label>
                      );
                    })}

                    {/* Show manually added custom namespaces */}
                    {allowedNamespaces
                      .filter((ns) => !['default', 'k6-test', 'testing', 'monitoring'].includes(ns))
                      .map((ns) => (
                        <label
                          key={ns}
                          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border bg-purple-500/10 border-purple-500/40 text-purple-300 text-xs cursor-pointer select-none transition-all duration-200"
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={true}
                            onChange={() => {
                              setAllowedNamespaces(allowedNamespaces.filter((n) => n !== ns));
                            }}
                          />
                          <span>{ns}</span>
                          <X className="w-3 h-3 hover:text-purple-100 shrink-0 ml-0.5" />
                        </label>
                      ))}
                  </div>

                  {/* Add custom namespace input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Add custom namespace..."
                      value={customNamespaceInput}
                      onChange={(e) => setCustomNamespaceInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = customNamespaceInput.trim().toLowerCase();
                          if (val && !allowedNamespaces.includes(val)) {
                            setAllowedNamespaces([...allowedNamespaces, val]);
                            setCustomNamespaceInput('');
                          }
                        }
                      }}
                      className="flex-1 bg-slate-900 border border-slate-800/80 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-purple-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = customNamespaceInput.trim().toLowerCase();
                        if (val && !allowedNamespaces.includes(val)) {
                          setAllowedNamespaces([...allowedNamespaces, val]);
                          setCustomNamespaceInput('');
                        }
                      }}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer border border-slate-700/50 transition active:scale-95"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl text-sm font-semibold transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={registering}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-sm font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {registering ? t('validating') : t('submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* K6 Template Add/Edit Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg p-8 shadow-2xl relative">
            <button
              onClick={() => setIsTemplateModalOpen(false)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-bold text-white mb-2">
              {isEditingTemplate ? 'Edit K6 Run Template' : 'Add K6 Run Template'}
            </h3>
            <p className="text-slate-400 text-xs mb-6">
              Configure template run specifications for K6 Operator loads.
            </p>

            {templateError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {templateError}
              </div>
            )}

            <form onSubmit={handleSaveTemplateConfig} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Template Name</label>
                <input
                  type="text"
                  required
                  placeholder="E.g., High Load API Test"
                  value={templateConfig.name}
                  onChange={(e) => setTemplateConfig({ ...templateConfig, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Parallelism (Runners)</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={templateConfig.parallelism}
                    onChange={(e) => setTemplateConfig({ ...templateConfig, parallelism: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Script ConfigMap Name</label>
                  <input
                    type="text"
                    required
                    placeholder="k6-test-script"
                    value={templateConfig.script_name}
                    onChange={(e) => setTemplateConfig({ ...templateConfig, script_name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">JS Filename</label>
                  <input
                    type="text"
                    required
                    placeholder="test.js"
                    value={templateConfig.script_file}
                    onChange={(e) => setTemplateConfig({ ...templateConfig, script_file: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">CPU Limit</label>
                  <input
                    type="text"
                    required
                    placeholder="10m"
                    value={templateConfig.cpu_limit}
                    onChange={(e) => setTemplateConfig({ ...templateConfig, cpu_limit: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Memory Limit</label>
                  <input
                    type="text"
                    required
                    placeholder="16Mi"
                    value={templateConfig.mem_limit}
                    onChange={(e) => setTemplateConfig({ ...templateConfig, mem_limit: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">JS Script Content</label>
                <textarea
                  required
                  rows={6}
                  value={templateConfig.script_content}
                  onChange={(e) => setTemplateConfig({ ...templateConfig, script_content: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono leading-relaxed"
                  placeholder="import http from 'k6/http'; ..."
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsTemplateModalOpen(false)}
                  className="flex-1 py-3 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTemplate}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {savingTemplate ? 'Saving...' : 'Save Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {isUserModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-8 shadow-2xl relative">
            <button
              onClick={() => setIsUserModalOpen(false)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-bold text-white mb-2">Add Local User</h3>
            <p className="text-slate-400 text-xs mb-6">
              Create a new local account with assigned role permissions.
            </p>

            {userError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {userError}
              </div>
            )}

            <form onSubmit={handleSaveUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Username</label>
                <input
                  type="text"
                  required
                  placeholder="E.g., testeditor"
                  value={newUserAccount.username}
                  onChange={(e) => setNewUserAccount({ ...newUserAccount, username: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={newUserAccount.password}
                  onChange={(e) => setNewUserAccount({ ...newUserAccount, password: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Role Authorization</label>
                <select
                  value={newUserAccount.role}
                  onChange={(e) => setNewUserAccount({ ...newUserAccount, role: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-purple-500 outline-none"
                >
                  <option value="viewer">Viewer (Read-only access)</option>
                  <option value="editor">Editor (Can manage and run load tests)</option>
                  <option value="administrator">Administrator (Full access, manage users/SSO)</option>
                </select>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="flex-1 py-3 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {savingUser ? 'Adding...' : 'Add User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

