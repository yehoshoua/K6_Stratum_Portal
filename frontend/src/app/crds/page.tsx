'use client';

import React, { useEffect, useState } from 'react';
import { 
  Layers, 
  Trash2, 
  Plus, 
  Play, 
  RefreshCw, 
  Terminal, 
  FileCode2,
  Calendar,
  X,
  Compass
} from 'lucide-react';
import { api, ClusterConfig, K6CRD, K6Template } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';

function cleanK8sObject(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = JSON.parse(JSON.stringify(obj));
  if (clean.metadata) {
    const keptMetadata: any = {};
    const keysToKeep = ['name', 'namespace', 'labels', 'annotations'];
    keysToKeep.forEach(k => {
      if (clean.metadata[k] !== undefined) {
        keptMetadata[k] = clean.metadata[k];
      }
    });
    clean.metadata = keptMetadata;
  }
  delete clean.status;
  return clean;
}

function jsonToYaml(val: any, depth = 0): string {
  const indent = '  '.repeat(depth);
  if (val === null || val === undefined) {
    return 'null\n';
  }
  if (typeof val !== 'object') {
    if (typeof val === 'string') {
      if (val.includes('\n') || val.includes(':') || val.includes('"') || val.includes("'")) {
        return `|-\n${val.split('\n').map(line => '  '.repeat(depth + 1) + line).join('\n')}\n`;
      }
      return `"${val.replace(/"/g, '\\"')}"\n`;
    }
    return `${val}\n`;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]\n';
    let res = '\n';
    val.forEach(item => {
      const formattedItem = jsonToYaml(item, depth + 1).trimStart();
      res += `${indent}- ${formattedItem}`;
    });
    return res;
  }
  const keys = Object.keys(val);
  if (keys.length === 0) return '{}\n';
  let res = '';
  keys.forEach((key) => {
    const value = val[key];
    const formattedVal = jsonToYaml(value, depth + 1);
    if (typeof value === 'object' && value !== null && Object.keys(value).length > 0) {
      res += `${indent}${key}:${formattedVal.startsWith('\n') ? '' : ' '}${formattedVal}`;
    } else {
      res += `${indent}${key}: ${formattedVal.trimStart()}`;
    }
  });
  return res;
}

export default function CRDsPage() {
  const { t } = usePreferences();
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [namespaces, setNamespaces] = useState<string[]>(['default']);
  const [crds, setCrds] = useState<K6CRD[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCrd, setSelectedCrd] = useState<K6CRD | null>(null);
  const [error, setError] = useState('');

  // New CRD Run Modal state
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

  const DEFAULT_RUN_CONFIG = {
    name: 'k6-load-test-run',
    parallelism: 1,
    scriptName: 'k6-test-script',
    scriptFile: 'test.js',
    cpuLimit: '10m',
    memLimit: '16Mi',
    scriptContent: DEFAULT_SCRIPT_TEMPLATE,
    useArguments: false,
    argumentsText: '--out influxdb=http://grafana-hub-influxdb.grafana-hub.svc.cluster.local:8086/k6s',
    useCustomImage: false,
    awsAccountId: '107435627496',
    awsRegion: 'us-east-1',
    customImage: '107435627496.dkr.ecr.us-east-1.amazonaws.com/rem-helm-images/rem-apps/xk6:v1.1'
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRun, setNewRun] = useState(DEFAULT_RUN_CONFIG);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [templates, setTemplates] = useState<K6Template[]>([]);
  const [userRole, setUserRole] = useState('viewer');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUserRole(localStorage.getItem('role') || 'viewer');
    }
  }, []);

  const isViewer = userRole === 'viewer';


  const loadTemplates = async () => {
    try {
      const list = await api.getTemplates();
      setTemplates(list || []);
    } catch (e) {
      console.error('Failed to load templates', e);
    }
  };

  useEffect(() => {
    if (isModalOpen) {
      loadTemplates();
    }
  }, [isModalOpen]);

  const loadInitialData = async () => {
    try {
      const data = await api.getClusters();
      const safeData = data || [];
      setClusters(safeData);
      if (safeData.length > 0) {
        setSelectedClusterId(safeData[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAwsAccountOrRegionChange = (accountId: string, region: string) => {
    setNewRun(prev => ({
      ...prev,
      awsAccountId: accountId,
      awsRegion: region,
      customImage: `${accountId}.dkr.ecr.${region}.amazonaws.com/rem-helm-images/rem-apps/xk6:v1.1`
    }));
  };

  useEffect(() => {
    const selectedCluster = clusters.find(c => c.id === selectedClusterId);
    const region = selectedCluster?.region || 'us-east-1';
    setNewRun(prev => ({
      ...prev,
      awsRegion: region,
      customImage: `${prev.awsAccountId}.dkr.ecr.${region}.amazonaws.com/rem-helm-images/rem-apps/xk6:v1.1`
    }));
  }, [selectedClusterId, clusters]);

  useEffect(() => {
    loadInitialData();
  }, []);

  const fetchCRDs = async () => {
    if (!selectedClusterId) return;
    try {
      setLoading(true);
      setError('');
      const data = await api.getCRDs(selectedClusterId, namespace);
      const safeData = data || [];
      setCrds(safeData);
      if (safeData.length > 0) {
        setSelectedCrd(safeData[0]);
      } else {
        setSelectedCrd(null);
      }
    } catch (err: any) {
      console.error('Failed to load CRDs', err);
      setCrds([]);
      setSelectedCrd(null);
      setError(err.message || 'Failed to fetch K6 CRDs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const fetchNamespaces = async () => {
      if (!selectedClusterId) return;
      try {
        const list = await api.getNamespaces(selectedClusterId);
        setNamespaces(list || ['default']);
        if (list && list.length > 0 && !list.includes(namespace)) {
          setNamespace(list[0]);
        }
      } catch (err) {
        console.error('Failed to load namespaces', err);
        setNamespaces(['default']);
      }
    };
    fetchNamespaces();
  }, [selectedClusterId]);

  useEffect(() => {
    fetchCRDs();
  }, [selectedClusterId, namespace]);

  const handleNamespaceChange = (val: string) => {
    if (val === '__custom__') {
      const customNs = prompt('Enter custom namespace:');
      if (customNs && customNs.trim()) {
        const cleanNs = customNs.trim();
        if (!namespaces.includes(cleanNs)) {
          setNamespaces(prev => [...prev, cleanNs]);
        }
        setNamespace(cleanNs);
      }
    } else {
      setNamespace(val);
    }
  };

  const handleDeleteCRD = async (name: string) => {
    if (!confirm(`${t('delete')} ${name}?`)) return;
    try {
      await api.deleteCRD(selectedClusterId, name, namespace);
      setCrds(crds.filter(c => c.metadata.name !== name));
      if (selectedCrd?.metadata.name === name) {
        setSelectedCrd(null);
      }
    } catch (err) {
      alert('Error deleting resource');
    }
  };

  const handleCreateCRD = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreating(true);

    const specBody: any = {
      name: newRun.name,
      scriptContent: newRun.scriptContent,
      spec: {
        parallelism: Number(newRun.parallelism),
        script: {
          configMap: {
            name: newRun.scriptName,
            file: newRun.scriptFile
          }
        },
        runner: {
          resources: {
            limits: {
              cpu: newRun.cpuLimit,
              memory: newRun.memLimit
            }
          }
        }
      }
    };

    if (newRun.useArguments) {
      specBody.spec.arguments = newRun.argumentsText.trim();
    }

    if (newRun.useCustomImage) {
      specBody.spec.runner.image = newRun.customImage;
    }

    try {
      await api.createCRD(selectedClusterId, namespace, specBody);
      setIsModalOpen(false);
      // Reset
      setNewRun(DEFAULT_RUN_CONFIG);
      fetchCRDs();
    } catch (err: any) {
      setCreateError(err.message || 'Error deploying CRD');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Title & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">{t('crdControl')}</h2>
          <p className="text-slate-400 text-sm mt-1">
            {t('subWelcome')}
          </p>
        </div>
        
        <div className="flex items-center space-x-3 shrink-0">
          {/* Cluster Selector */}
          <div className="relative">
            <select
              value={selectedClusterId}
              onChange={(e) => setSelectedClusterId(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:border-purple-500 font-semibold"
            >
              {clusters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Namespace Selector */}
          <div className="relative">
            <select
              value={namespace}
              onChange={(e) => handleNamespaceChange(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:border-purple-500 font-semibold"
            >
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
              <option value="__custom__">+ Custom Namespace...</option>
            </select>
          </div>

          {!isViewer && (
            <button
              onClick={() => setIsModalOpen(true)}
              disabled={!selectedClusterId}
              className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white rounded-xl font-semibold shadow-lg shadow-purple-500/10 hover:shadow-purple-500/25 transition duration-300 text-xs cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{t('newTest')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Side: CRD List */}
        <div className="lg:col-span-7 bg-slate-900/30 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-purple-400" />
              <span>{t('crdList')}</span>
            </h3>
            <button
              onClick={fetchCRDs}
              className="p-2 border border-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="py-24 text-center text-slate-500">Loading...</div>
          ) : error ? (
            <div className="py-12 px-6 text-center text-red-400 bg-red-500/5 border border-red-500/10 rounded-2xl space-y-3">
              <Compass className="w-8 h-8 mx-auto text-red-500 animate-pulse" />
              <p className="text-sm font-semibold">{error}</p>
              <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                Please verify K8s cluster connection in settings, check if your Service Account token has permissions to read namespaces/k6s, and ensure the k6 operator CRD is installed.
              </p>
            </div>
          ) : crds.length === 0 ? (
            <div className="py-24 text-center text-slate-500 space-y-4">
              <Compass className="w-8 h-8 mx-auto text-slate-600 animate-pulse" />
              <p className="text-sm">{t('noResources')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {crds.map((crd) => {
                const isSelected = selectedCrd?.metadata.name === crd.metadata.name;
                const stage = crd.status?.stage || 'unknown';
                return (
                  <div
                    key={crd.metadata.name}
                    onClick={() => setSelectedCrd(crd)}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all duration-300 flex items-center justify-between group ${
                      isSelected
                        ? 'bg-slate-900/90 border-purple-500/40 shadow-lg shadow-purple-500/5'
                        : 'bg-slate-900/40 border-slate-850 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-4">
                      <div className={`p-2.5 rounded-xl border ${
                        stage === 'running' 
                          ? 'bg-pink-500/10 text-pink-400 border-pink-500/20' 
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        <Play className={`w-4 h-4 ${stage === 'running' ? 'animate-pulse' : ''}`} />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm text-slate-200">{crd.metadata.name}</h4>
                        <div className="flex items-center space-x-3 mt-1.5 text-[10px] text-slate-500">
                          <span className="flex items-center space-x-1">
                            <Calendar className="w-3 h-3" />
                            <span>{new Date(crd.metadata.creationTimestamp).toLocaleString()}</span>
                          </span>
                          <span>•</span>
                          <span>{t('runners')}: {crd.spec.parallelism}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-md border font-semibold capitalize ${
                        stage === 'running'
                          ? 'bg-pink-500/10 text-pink-400 border-pink-500/25 animate-pulse'
                          : stage === 'finished'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        {stage}
                      </span>
                      {!isViewer && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCRD(crd.metadata.name);
                          }}
                          className="p-2 border border-transparent hover:border-red-500/20 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-lg transition duration-200 cursor-pointer opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Side: CRD Details Panel */}
        <div className="lg:col-span-5 flex flex-col h-full min-h-[500px]">
          {selectedCrd ? (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md flex flex-col flex-1">
              <div className="border-b border-slate-800/80 pb-4 mb-4">
                <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-md border border-purple-500/20 font-semibold uppercase">
                  {t('details')}
                </span>
                <h3 className="text-xl font-bold text-white mt-2">{selectedCrd.metadata.name}</h3>
                <p className="text-xs text-slate-500 mt-1">Namespace: <strong className="font-semibold text-slate-400">{selectedCrd.metadata.namespace}</strong></p>
              </div>

              {/* Specs parameters */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-900">
                  <div className="flex items-center space-x-2 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                    <FileCode2 className="w-3.5 h-3.5" />
                    <span>{t('scriptConfigMap')}</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-300 mt-1 truncate">
                    {selectedCrd.spec.script?.configMap?.name || 'N/A'}
                  </p>
                </div>
                
                <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-900">
                  <div className="flex items-center space-x-2 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>{t('jsFile')}</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-300 mt-1 truncate">
                    {selectedCrd.spec.script?.configMap?.file || 'N/A'}
                  </p>
                </div>
              </div>

              {/* Resource Limits */}
              <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-900 space-y-2 mb-6">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t('limits')}</h4>
                <div className="grid grid-cols-2 text-xs">
                  <div className="flex justify-between border-r border-slate-800 pr-4">
                    <span className="text-slate-500">CPU</span>
                    <span className="font-semibold text-slate-300">{selectedCrd.spec.runner?.resources?.limits?.cpu || 'Unlimited'}</span>
                  </div>
                  <div className="flex justify-between pl-4">
                    <span className="text-slate-500">Memory</span>
                    <span className="font-semibold text-slate-300">{selectedCrd.spec.runner?.resources?.limits?.memory || 'Unlimited'}</span>
                  </div>
                </div>
              </div>

              {/* Spec YAML Viewer */}
              <div className="flex-1 flex flex-col min-h-[200px]">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{t('specObject')}</h4>
                <pre className="flex-1 bg-slate-950 rounded-2xl p-4 overflow-auto font-mono text-[10px] text-slate-400 border border-slate-850 leading-relaxed max-h-[250px]">
                  {jsonToYaml(cleanK8sObject(selectedCrd))}
                </pre>
              </div>

            </div>
          ) : (
            <div className="bg-slate-900/10 border border-dashed border-slate-800 rounded-3xl p-6 flex flex-col items-center justify-center text-slate-500 flex-1">
              {t('selectRes')}
            </div>
          )}
        </div>

      </div>

      {/* New CRD Run Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg p-8 shadow-2xl relative">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-bold text-white mb-2">{t('instantiateK6')}</h3>
            <p className="text-slate-400 text-xs mb-6">
              {t('launchSpecDesc')}
            </p>

            {createError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateCRD} className="space-y-4">
              {templates.length > 0 && (
                <div className="animate-fadeIn">
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Apply K6 Template</label>
                  <select
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) return;
                      const tmpl = templates.find(t => t.id === val);
                      if (tmpl) {
                        setNewRun({
                          ...newRun,
                          name: tmpl.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                          parallelism: tmpl.parallelism,
                          scriptName: tmpl.script_name,
                          scriptFile: tmpl.script_file,
                          cpuLimit: tmpl.cpu_limit,
                          memLimit: tmpl.mem_limit,
                          scriptContent: tmpl.script_content
                        });
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:border-purple-500 font-semibold"
                  >
                    <option value="">-- Choose template to load --</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('runName')}</label>
                <input
                  type="text"
                  required
                  value={newRun.name}
                  onChange={(e) => setNewRun({ ...newRun, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('parallelism')}</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    required
                    value={newRun.parallelism}
                    onChange={(e) => setNewRun({ ...newRun, parallelism: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('scriptConfigMap')}</label>
                  <input
                    type="text"
                    required
                    value={newRun.scriptName}
                    onChange={(e) => setNewRun({ ...newRun, scriptName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('jsFile')}</label>
                  <input
                    type="text"
                    required
                    value={newRun.scriptFile}
                    onChange={(e) => setNewRun({ ...newRun, scriptFile: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('cpuLimit')}</label>
                  <input
                    type="text"
                    required
                    value={newRun.cpuLimit}
                    onChange={(e) => setNewRun({ ...newRun, cpuLimit: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('memLimit')}</label>
                  <input
                    type="text"
                    required
                    value={newRun.memLimit}
                    onChange={(e) => setNewRun({ ...newRun, memLimit: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">JS Script Content</label>
                <textarea
                  required
                  value={newRun.scriptContent}
                  onChange={(e) => setNewRun({ ...newRun, scriptContent: e.target.value })}
                  rows={6}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 outline-none focus:border-purple-500 font-mono leading-relaxed"
                  placeholder="import http from 'k6/http'; ..."
                />
              </div>

              {/* Arguments Section */}
              <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/80 space-y-3">
                <label className="flex items-center space-x-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newRun.useArguments}
                    onChange={(e) => setNewRun({ ...newRun, useArguments: e.target.checked })}
                    className="accent-purple-500 rounded border-slate-800"
                  />
                  <span className="text-xs font-semibold text-slate-300">Add output arguments</span>
                </label>

                {newRun.useArguments && (
                  <div className="animate-fadeIn">
                    <input
                      type="text"
                      required
                      value={newRun.argumentsText}
                      onChange={(e) => setNewRun({ ...newRun, argumentsText: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono"
                      placeholder="--out influxdb=http://..."
                    />
                  </div>
                )}
              </div>

              {/* Custom Image Section */}
              <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/80 space-y-3">
                <label className="flex items-center space-x-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newRun.useCustomImage}
                    onChange={(e) => setNewRun({ ...newRun, useCustomImage: e.target.checked })}
                    className="accent-purple-500 rounded border-slate-800"
                  />
                  <span className="text-xs font-semibold text-slate-300">Use custom image</span>
                </label>

                {newRun.useCustomImage && (
                  <div className="space-y-3 animate-fadeIn">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">AWS Account ID</label>
                        <input
                          type="text"
                          required
                          value={newRun.awsAccountId}
                          onChange={(e) => handleAwsAccountOrRegionChange(e.target.value, newRun.awsRegion)}
                          className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">EKS Region</label>
                        <input
                          type="text"
                          required
                          value={newRun.awsRegion}
                          onChange={(e) => handleAwsAccountOrRegionChange(newRun.awsAccountId, e.target.value)}
                          className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Runner Image URL</label>
                      <input
                        type="text"
                        required
                        value={newRun.customImage}
                        onChange={(e) => setNewRun({ ...newRun, customImage: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono text-[10px]"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {creating ? t('deploying') : t('deploy')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
