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
  Edit,
  Compass
} from 'lucide-react';
import { api, ClusterConfig, EcrCheck, K6CRD, K6Template, K8sPod, RunDefaults } from '@/services/api';
import { defaultRunnerImage, resolveClusterImage, clusterImageContext, needsResolvedRunnerImage } from '@/utils/clusterImage';
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
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0) {
      res += `${indent}${key}:\n${formattedVal}`;
    } else {
      res += `${indent}${key}: ${formattedVal.trimStart()}`;
    }
  });
  return res;
}

export default function CRDsPage() {
  const { t, lang } = usePreferences();
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [namespaces, setNamespaces] = useState<string[]>(['default']);
  const [crds, setCrds] = useState<K6CRD[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCrd, setSelectedCrd] = useState<K6CRD | null>(null);
  const [error, setError] = useState('');
  const [relaunching, setRelaunching] = useState(false);
  const [configMapData, setConfigMapData] = useState<{ name: string; namespace?: string; data: Record<string, string> } | null>(null);
  const [loadingConfigMap, setLoadingConfigMap] = useState(false);
  const [editingConfigMapFile, setEditingConfigMapFile] = useState<string | null>(null);
  const [editingConfigMapContent, setEditingConfigMapContent] = useState('');
  const [savingConfigMap, setSavingConfigMap] = useState(false);
  const [configMaps, setConfigMaps] = useState<{ name: string; namespace?: string; data: Record<string, string> }[]>([]);
  const [loadingConfigMaps, setLoadingConfigMaps] = useState(false);
  const [selectedConfigMap, setSelectedConfigMap] = useState<{ name: string; namespace?: string; data: Record<string, string> } | null>(null);
  const [scriptSource, setScriptSource] = useState<'manual' | 'existing'>('manual');
  const [isCmModalOpen, setIsCmModalOpen] = useState(false);
  const [newCm, setNewCm] = useState({ name: '', fileName: 'script.js', scriptContent: '' });
  const [creatingCm, setCreatingCm] = useState(false);
  const [createCmError, setCreateCmError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  // Pod logs console drawer states
  const [isLogsDrawerOpen, setIsLogsDrawerOpen] = useState(false);
  const [logsPodName, setLogsPodName] = useState('');
  const [podLogsText, setPodLogsText] = useState('');
  const [isLiveLogs, setIsLiveLogs] = useState(true);
  const [logsError, setLogsError] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logCrdName, setLogCrdName] = useState('');
  const [podsList, setPodsList] = useState<K8sPod[]>([]);
  const [loadingPods, setLoadingPods] = useState(false);

  const logsContainerRef = React.useRef<HTMLDivElement>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
  };

  const requestConfirm = (title: string, message: React.ReactNode, onConfirm: () => void | Promise<void>) => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      onConfirm: async () => {
        setConfirmDialog(null);
        await onConfirm();
      }
    });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

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

  const DEFAULT_OUTPUT_ARGS = '--out influxdb=http://grafana-hub-influxdb.grafana-hub.svc.cluster.local:8086/k6s';
  const [runDefaults, setRunDefaults] = useState<RunDefaults>({
    output_args: DEFAULT_OUTPUT_ARGS,
    use_output: false,
    use_image: false,
    image_url: '',
    env_vars: [],
  });

  useEffect(() => {
    api.getRunDefaults().then(d => setRunDefaults({ ...d, env_vars: d.env_vars || [] })).catch(() => {/* use local defaults */});
  }, []);

  const selectedCluster = clusters.find((c) => c.id === selectedClusterId);

  const runnerImagePlaceholder = React.useMemo(
    () => defaultRunnerImage(selectedCluster),
    [selectedCluster],
  );

  const resolvedCustomImage = React.useCallback((imageOverride?: string) => {
    const ctx = clusterImageContext(selectedCluster);
    if (imageOverride?.trim()) {
      return resolveClusterImage(imageOverride, ctx);
    }
    return runDefaults.image_url
      ? resolveClusterImage(runDefaults.image_url, ctx)
      : runnerImagePlaceholder;
  }, [runDefaults.image_url, runnerImagePlaceholder, selectedCluster]);

  const buildDefaultRunConfig = React.useCallback(() => ({
    name: 'k6-load-test-run',
    parallelism: 1,
    scriptName: 'k6-test-script',
    scriptFile: 'test.js',
    cpuLimit: '1000m',
    memLimit: '1Gi',
    scriptContent: DEFAULT_SCRIPT_TEMPLATE,
    useArguments: false,
    argumentsText: runDefaults.output_args || '--out influxdb=http://grafana-hub-influxdb.grafana-hub.svc.cluster.local:8086/k6s',
    useCustomImage: runDefaults.use_image,
    customImage: resolvedCustomImage(),
  }), [runDefaults, resolvedCustomImage]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRun, setNewRun] = useState(buildDefaultRunConfig);
  const [editingCrd, setEditingCrd] = useState<K6CRD | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [cronExpression, setCronExpression] = useState('');
  const [ecrCheck, setEcrCheck] = useState<EcrCheck | null>(null);
  const [checkingEcr, setCheckingEcr] = useState(false);

  const [templates, setTemplates] = useState<K6Template[]>([]);
  const [userRole, setUserRole] = useState('viewer');

  useEffect(() => {
    if (!isModalOpen) {
      setNewRun(buildDefaultRunConfig());
    }
  }, [buildDefaultRunConfig, isModalOpen]);

  useEffect(() => {
    if (!isModalOpen || editingCrd) {
      return;
    }
    const nextImage = resolvedCustomImage();
    setNewRun(prev => (
      prev.customImage === nextImage || needsResolvedRunnerImage(prev.customImage)
        ? { ...prev, customImage: nextImage }
        : prev
    ));
  }, [isModalOpen, editingCrd, resolvedCustomImage, selectedClusterId]);

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

  const handleStartNewRun = () => {
    setEditingCrd(null);
    setScheduleEnabled(false);
    setCronExpression('');
    setScriptSource('manual');
    setNewRun(buildDefaultRunConfig());
    setIsModalOpen(true);
  };

  const handleStartEditRun = (crd: K6CRD) => {
    const spec = crd.spec || {};
    const runner = spec.runner || {};
    const limits = runner.resources?.limits || {};
    const argsText = typeof spec.arguments === 'string' ? spec.arguments : '';
    const scriptConfig = spec.script?.configMap || {};
    const scriptName = scriptConfig.name || '';
    const scriptFile = scriptConfig.file || 'script.js';

    setEditingCrd(crd);
    setScheduleEnabled(false);
    setCronExpression('');
    setScriptSource(scriptName ? 'existing' : 'manual');
    setNewRun({
      ...buildDefaultRunConfig(),
      name: crd.metadata?.name || '',
      parallelism: Number(spec.parallelism || 1),
      scriptName,
      scriptFile,
      cpuLimit: limits.cpu || '1000m',
      memLimit: limits.memory || '1Gi',
      useArguments: argsText.trim() !== '',
      argumentsText: argsText || buildDefaultRunConfig().argumentsText,
      useCustomImage: !!runner.image,
      customImage: runner.image || buildDefaultRunConfig().customImage,
    });
    setIsModalOpen(true);
  };

  useEffect(() => {
    if (isModalOpen) {
      loadTemplates();
      if (!editingCrd) {
        setScriptSource('manual');
        setSelectedTemplateId('');
        setScheduleEnabled(false);
        setCronExpression('');
      }
      setEcrCheck(null);
    }
  }, [editingCrd, isModalOpen]);

  useEffect(() => {
    if (!newRun.useCustomImage || !newRun.customImage || !selectedClusterId) {
      setEcrCheck(null);
      setCheckingEcr(false);
      return;
    }

    let cancelled = false;
    setCheckingEcr(true);
    const timer = setTimeout(() => {
      api.checkEcrRepo(selectedClusterId, newRun.customImage)
        .then((data) => {
          if (!cancelled) {
            setEcrCheck(data);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setEcrCheck({
              exists: false,
              repository: '',
              registry: '',
              image: newRun.customImage,
              message: err.message || t('ecrCheckFailed'),
            });
          }
        })
        .finally(() => {
          if (!cancelled) {
            setCheckingEcr(false);
          }
        });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [newRun.useCustomImage, newRun.customImage, selectedClusterId]);

  const ecrHelper = React.useMemo(() => {
    if (!ecrCheck || !selectedCluster?.region || !ecrCheck.registry || !ecrCheck.image) {
      return null;
    }
    const region = selectedCluster.region;
    const registry = ecrCheck.registry;
    const repository = ecrCheck.repository || 'xk6';
    const localImage = newRun.customImage || ecrCheck.image;
    return {
      login: `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}`,
      ensureRepo: `aws ecr describe-repositories --region ${region} --repository-names ${repository} || aws ecr create-repository --region ${region} --repository-name ${repository}`,
      tag: `docker tag ${localImage} ${ecrCheck.image}`,
      push: `docker push ${ecrCheck.image}`,
    };
  }, [ecrCheck, selectedCluster?.region, newRun.customImage]);

  const loadInitialData = async () => {
    try {
      const data = await api.getClusters();
      const safeData = (data || []).filter(c => c.k6_operator_installed);
      setClusters(safeData);
      if (safeData.length > 0) {
        setSelectedClusterId(safeData[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  const fetchCRDs = async () => {
    if (!selectedClusterId) return;
    try {
      setLoading(true);
      setError('');
      const data = await api.getCRDs(selectedClusterId, namespace);
      const safeData = (data || []).filter(item => {
        const k = (item.kind || '').toLowerCase();
        return k === 'k6' || k === 'testrun';
      });
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
      setError(err.message || t('fetchCrdsFailed'));
    } finally {
      setLoading(false);
    }
  };

  const fetchConfigMaps = async () => {
    if (!selectedClusterId) return;
    try {
      setLoadingConfigMaps(true);
      const data = await api.listConfigMaps(selectedClusterId, namespace);
      setConfigMaps(data || []);
    } catch (err) {
      console.error('Failed to load ConfigMaps', err);
      setConfigMaps([]);
    } finally {
      setLoadingConfigMaps(false);
    }
  };

  useEffect(() => {
    const fetchNamespaces = async () => {
      if (!selectedClusterId) return;
      try {
        const list = await api.getNamespaces(selectedClusterId);
        setNamespaces(list || ['default']);
        if (list && list.length > 0 && namespace !== 'all' && !list.includes(namespace)) {
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
    const fetchSelectedConfigMap = async () => {
      if (!selectedCrd || !selectedClusterId) {
        setConfigMapData(null);
        return;
      }
      const cmName = selectedCrd.spec.script?.configMap?.name;
      if (!cmName) {
        setConfigMapData(null);
        return;
      }
      try {
        setLoadingConfigMap(true);
        const data = await api.getConfigMap(selectedClusterId, cmName, selectedCrd.metadata.namespace || namespace);
        setConfigMapData(data);
      } catch (err) {
        console.error('Failed to fetch configmap', err);
        setConfigMapData(null);
      } finally {
        setLoadingConfigMap(false);
      }
    };
    fetchSelectedConfigMap();
  }, [selectedCrd, selectedClusterId, namespace]);

  useEffect(() => {
    setSelectedCrd(null);
    setSelectedConfigMap(null);
    setConfigMapData(null);
    fetchCRDs();
    fetchConfigMaps();
  }, [selectedClusterId, namespace]);

  const fetchLogs = async (podNameOverride?: string) => {
    const pName = podNameOverride || logsPodName;
    if (!pName || !selectedClusterId || !selectedCrd) return;
    try {
      setLoadingLogs(true);
      setLogsError('');
      const logs = await api.getPodLogs(
        selectedClusterId,
        pName,
        selectedCrd.metadata.namespace || namespace,
        false
      );
      setPodLogsText(logs || t('noLogsReturned'));
    } catch (err: any) {
      console.error(err);
      setLogsError(err.message || t('podLogsFailed'));
    } finally {
      setLoadingLogs(false);
    }
  };

  const loadPods = async (crdName?: string, nsName?: string) => {
    if (!selectedClusterId) return;
    const searchName = crdName || selectedCrd?.metadata.name;
    const targetNamespace = nsName || selectedCrd?.metadata.namespace || namespace;
    try {
      setLoadingPods(true);
      const list = await api.listPods(selectedClusterId, targetNamespace);
      setPodsList(list || []);
      
      if (searchName && list && list.length > 0) {
        const matches = list.filter(p => p.name.startsWith(searchName));
        if (matches.length > 0) {
          const runner = matches.find(p => p.name.includes('-runner') && p.status === 'Running');
          const initializer = matches.find(p => p.name.includes('-initializer') && p.status === 'Running');
          if (runner) {
            setLogsPodName(runner.name);
          } else if (initializer) {
            setLogsPodName(initializer.name);
          } else {
            setLogsPodName(matches[0].name);
          }
        } else {
          setLogsPodName(`${searchName}-initializer`);
        }
      }
    } catch (e) {
      console.error('Failed to load pods', e);
      setPodsList([]);
    } finally {
      setLoadingPods(false);
    }
  };

  // Auto-scroll logs terminal to bottom
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [podLogsText, isLogsDrawerOpen]);

  // Handle polling for logs
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLogsDrawerOpen && isLiveLogs && logsPodName && selectedCrd) {
      fetchLogs();
      interval = setInterval(() => {
        fetchLogs();
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLogsDrawerOpen, isLiveLogs, logsPodName, selectedCrd]);

  const handleNamespaceChange = (val: string) => {
    if (val === '__custom__') {
      const customNs = prompt(t('enterCustomNamespace'));
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

  const handleDeleteCRD = async (name: string, ns?: string) => {
    requestConfirm(
      t('deleteResourceTitle'),
      <span>{t('deleteResourceConfirm', { name })}</span>,
      async () => {
        try {
          await api.deleteCRD(selectedClusterId, name, ns || namespace);
          setCrds(crds.filter(c => c.metadata.name !== name));
          if (selectedCrd?.metadata.name === name) {
            setSelectedCrd(null);
          }
        } catch (err) {
          showToast(t('resourceDeleteError'), 'error');
        }
      }
    );
  };

  const handleDeleteConfigMap = async (name: string, ns?: string) => {
    requestConfirm(
      t('deleteConfigMapTitle'),
      <span>{t('deleteConfigMapConfirm', { name })}</span>,
      async () => {
        try {
          await api.deleteConfigMap(selectedClusterId, name, ns || namespace);
          setConfigMaps(configMaps.filter(c => c.name !== name));
          if (selectedConfigMap?.name === name) {
            setSelectedConfigMap(null);
            setConfigMapData(null);
          }
          showToast(t('configMapDeleted'), 'success');
        } catch (err) {
          showToast(t('configMapDeleteError'), 'error');
        }
      }
    );
  };

  const handleRelaunchCRD = async (crd: K6CRD) => {
    requestConfirm(
      t('relaunchTestTitle'),
      <span>{t('relaunchTestConfirm', { name: crd.metadata.name })}</span>,
      async () => {
        try {
          setRelaunching(true);
          
          // Call the backend relaunch endpoint which handles delete and recreate
          const reCreated = await api.relaunchCRD(selectedClusterId, crd.metadata.name, crd.metadata.namespace || namespace);
          
          // Refresh the CRD list
          await fetchCRDs();
          
          // Select the new one
          setSelectedCrd(reCreated);
          
          showToast(t('relaunchSuccess', { name: crd.metadata.name }), 'success');
        } catch (err: any) {
          console.error(err);
          showToast(t('relaunchFailed', { message: err.message || t('unknownError') }), 'error');
        } finally {
          setRelaunching(false);
        }
      }
    );
  };

  const handleSaveConfigMap = async () => {
    if ((!selectedCrd && !selectedConfigMap) || !selectedClusterId || !configMapData || !editingConfigMapFile) return;
    try {
      setSavingConfigMap(true);
      const updatedData = {
        [editingConfigMapFile]: editingConfigMapContent
      };
      const ns = selectedCrd ? (selectedCrd.metadata.namespace || namespace) : (selectedConfigMap?.namespace || namespace);
      await api.updateConfigMap(selectedClusterId, configMapData.name, updatedData, ns);
      
      setConfigMapData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          data: {
            ...prev.data,
            [editingConfigMapFile]: editingConfigMapContent
          }
        };
      });
      setEditingConfigMapFile(null);
      showToast(t('configMapUpdated'), 'success');
    } catch (err: any) {
      console.error(err);
      showToast(t('configMapUpdateFailed', { message: err.message || t('unknownError') }), 'error');
    } finally {
      setSavingConfigMap(false);
    }
  };

  const handleCreateCRD = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreating(true);

    const targetNs = namespace === 'all' ? (namespaces[0] || 'default') : namespace;
    const cronValue = cronExpression.trim();
    const derivedScriptName = newRun.scriptName || newRun.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const derivedScriptFile = newRun.scriptFile || 'script.js';

    const defaultOutputArgs = runDefaults.use_output ? runDefaults.output_args.trim() : '';
    const overrideOutputArgs = newRun.useArguments ? newRun.argumentsText.trim() : '';
    const outputArgs = newRun.useArguments ? overrideOutputArgs : defaultOutputArgs;
    const existingEnvVars = Array.isArray(editingCrd?.spec?.runner?.env)
      ? (editingCrd?.spec?.runner?.env as Array<{ key?: string; name?: string; value?: string }>)
          .map((entry) => ({
            name: (entry.name || entry.key || '').trim(),
            value: entry.value ?? '',
          }))
          .filter((entry) => entry.name !== '')
      : [];
    const defaultEnvVars = (existingEnvVars.length > 0 ? existingEnvVars : (runDefaults.env_vars || []))
      .map(({ key, value, name }) => ({
        name: (name || key || '').trim(),
        value: value ?? '',
      }))
      .filter(entry => entry.name !== '');

    const specBody: any = {
      name: newRun.name,
      scriptContent: scriptSource === 'manual' ? newRun.scriptContent : '',
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

    if (outputArgs) {
      specBody.spec.arguments = outputArgs;
    }

    if (newRun.useCustomImage) {
      specBody.spec.runner.image = newRun.customImage;
    }
    if (defaultEnvVars.length > 0) {
      specBody.spec.runner.env = defaultEnvVars;
    }

    try {
      if (scheduleEnabled) {
        if (!cronValue) {
          setCreateError(t('cronRequired'));
          return;
        }
        const cronFields = cronValue.split(/\s+/);
        if (cronFields.length !== 5) {
          setCreateError(t('cronInvalid'));
          return;
        }
        if (cronFields[0] !== '0') {
          setCreateError(t('cronRoundHourError'));
          return;
        }

        let templateId = selectedTemplateId;
        if (!templateId) {
          if (scriptSource !== 'manual') {
            setCreateError(t('scheduleRequiresScript'));
            return;
          }

          const createdTemplate = await api.createTemplate({
            name: newRun.name,
            parallelism: Number(newRun.parallelism),
            script_name: derivedScriptName,
            script_file: derivedScriptFile,
            runner_image: newRun.useCustomImage ? newRun.customImage : '',
            cpu_limit: newRun.cpuLimit,
            mem_limit: newRun.memLimit,
            script_content: newRun.scriptContent,
          });
          templateId = createdTemplate.id;
        }

        await api.createSchedule({
          name: newRun.name,
          cluster_id: selectedClusterId,
          namespace: targetNs,
          template_id: templateId,
          cron_expression: cronValue,
          active: true,
          enforce_round_hour: true,
        });
        showToast(t('scheduleCreated'), 'success');
        setIsModalOpen(false);
        setNewRun(buildDefaultRunConfig());
        setSelectedTemplateId('');
        setScheduleEnabled(false);
        setCronExpression('');
        return;
      }

      specBody.resource_kind = 'testrun';
      await api.createCRD(selectedClusterId, targetNs, specBody);
      setIsModalOpen(false);
      // Reset
      setNewRun(buildDefaultRunConfig());
      setEditingCrd(null);
      fetchCRDs();
    } catch (err: any) {
      setCreateError(err.message || t('deployCrdFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateConfigMap = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateCmError('');
    setCreatingCm(true);

    const targetNs = namespace === 'all' ? (namespaces[0] || 'default') : namespace;
    try {
      await api.createConfigMap(selectedClusterId, targetNs, {
        name: newCm.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        fileName: newCm.fileName,
        scriptContent: newCm.scriptContent
      });
      setIsCmModalOpen(false);
      setNewCm({ name: '', fileName: 'script.js', scriptContent: '' });
      fetchConfigMaps();
      showToast(t('configMapCreated'), 'success');
    } catch (err: any) {
      console.error(err);
      setCreateCmError(err.message || t('configMapCreateFailed'));
    } finally {
      setCreatingCm(false);
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Title & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-100">{t('crdControl')}</h2>
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
              <option value="all">{t('allNamespaces')}</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
              <option value="__custom__">{t('addCustomNamespace')}</option>
            </select>
          </div>

          {!isViewer && (
            <button
              onClick={handleStartNewRun}
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
            <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
              <Layers className="w-5 h-5 text-purple-400" />
              <span>{t('crdList')}</span>
            </h3>
            <button
              onClick={fetchCRDs}
              className="p-2 border border-slate-850 hover:bg-slate-800 text-slate-400 hover:text-slate-100 rounded-xl transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loading && crds.length === 0 ? (
            <div className="py-24 text-center text-slate-500">{t('loading')}</div>
          ) : error ? (
            <div className="py-12 px-6 text-center text-red-400 bg-red-500/5 border border-red-500/10 rounded-2xl space-y-3">
              <Compass className="w-8 h-8 mx-auto text-red-500 animate-pulse" />
              <p className="text-sm font-semibold">{error}</p>
              <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                {t('inspectClusters')}
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
                          {namespace === 'all' && (
                            <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded font-semibold text-[9px] uppercase tracking-wider shrink-0">
                              {crd.metadata.namespace}
                            </span>
                          )}
                          <span className="flex items-center space-x-1">
                            <Calendar className="w-3 h-3" />
                            <span>{new Date(crd.metadata.creationTimestamp).toLocaleString(lang)}</span>
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
                            handleDeleteCRD(crd.metadata.name, crd.metadata.namespace);
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

          {/* ConfigMaps Section */}
          <div className="mt-8 pt-6 border-t border-slate-800/60">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2 uppercase tracking-wider">
                <FileCode2 className="w-4 h-4 text-purple-400" />
                <span>{t('scriptConfigMap')} (k6s=enabled)</span>
              </h3>
              <div className="flex items-center space-x-2">
                {!isViewer && (
                  <button
                    onClick={() => {
                      setNewCm({
                        name: '',
                        fileName: 'script.js',
                        scriptContent: 'import http from \'k6/http\';\nimport { sleep } from \'k6\';\n\nexport default function () {\n  http.get(\'https://test.k6.io\');\n  sleep(1);\n}'
                      });
                      setCreateCmError('');
                      setIsCmModalOpen(true);
                    }}
                    className="p-1.5 border border-slate-850 hover:bg-slate-800 text-slate-400 hover:text-slate-100 rounded-lg transition cursor-pointer"
                    title={t('newConfigMap')}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={fetchConfigMaps}
                  className="p-1.5 border border-slate-850 hover:bg-slate-800 text-slate-400 hover:text-slate-100 rounded-lg transition cursor-pointer"
                  title={t('refreshConfigMaps')}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingConfigMaps ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {loadingConfigMaps && configMaps.length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-xs">{t('loading')}</div>
            ) : configMaps.length === 0 ? (
              <div className="py-6 text-center text-slate-600 text-xs">
                {t('noResources')}
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {configMaps.map((cm) => {
                  const isSelected = selectedConfigMap?.name === cm.name;
                  const fileNames = Object.keys(cm.data || {});
                  return (
                    <div
                      key={cm.name}
                      onClick={() => {
                        setSelectedCrd(null);
                        setSelectedConfigMap(cm);
                        setConfigMapData(cm);
                        setEditingConfigMapFile(null);
                      }}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all duration-300 flex items-center justify-between group ${
                        isSelected
                          ? 'bg-slate-900/90 border-purple-500/40 shadow-lg shadow-purple-500/5'
                          : 'bg-slate-900/20 border-slate-850 hover:border-slate-800'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className={`p-2 rounded-lg border ${
                          isSelected 
                            ? 'bg-purple-500/10 text-purple-400 border-purple-500/25' 
                            : 'bg-slate-800/65 text-slate-500 border-slate-850'
                        }`}>
                          <FileCode2 className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-semibold text-xs text-slate-300 truncate">{cm.name}</h4>
                          <p className="text-[10px] text-slate-500 mt-0.5 truncate flex items-center space-x-1.5">
                            {namespace === 'all' && cm.namespace && (
                              <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1 py-0.2 rounded font-semibold text-[8px] uppercase tracking-wider shrink-0 mr-1">
                                {cm.namespace}
                              </span>
                            )}
                            <span>{t('jsFile')}: {fileNames.join(', ') || t('none')}</span>
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-3 shrink-0">
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/5 text-purple-400/80 border border-purple-500/10 font-mono">
                          k6s=enabled
                        </span>
                        {!isViewer && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteConfigMap(cm.name, cm.namespace);
                            }}
                            className="p-2 border border-transparent hover:border-red-500/20 hover:bg-red-500/10 text-slate-500 hover:text-red-400 rounded-lg transition duration-200 cursor-pointer opacity-0 group-hover:opacity-100"
                            title={t('deleteConfigMap')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: CRD Details Panel */}
        <div className="lg:col-span-5 flex flex-col h-full min-h-[500px]">
          {selectedCrd ? (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md flex flex-col flex-1">
              <div className="border-b border-slate-800/80 pb-4 mb-4 flex justify-between items-start">
                <div>
                  <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-md border border-purple-500/20 font-semibold uppercase">
                    {t('details')}
                  </span>
                  <h3 className="text-xl font-bold text-slate-200 mt-2">{selectedCrd.metadata.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">{t('namespaceLabel')}: <strong className="font-semibold text-slate-400">{selectedCrd.metadata.namespace}</strong></p>
                </div>
                <div className="flex space-x-2 shrink-0">
                  <button
                    onClick={() => {
                      const name = selectedCrd.metadata.name;
                      const ns = selectedCrd.metadata.namespace || namespace;
                      setLogCrdName(name);
                      setLogsPodName(`${name}-initializer`);
                      setIsLogsDrawerOpen(true);
                      setPodLogsText('');
                      loadPods(name, ns);
                    }}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 border border-purple-500/20 rounded-xl transition duration-300 text-xs font-semibold cursor-pointer"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>{t('viewLogs')}</span>
                  </button>
                  {!isViewer && (
                    <>
                      {(selectedCrd.kind === 'CronJob' || selectedCrd.kind === 'Job') && (
                        <button
                          onClick={() => handleStartEditRun(selectedCrd)}
                          className="flex items-center space-x-1 px-3 py-1.5 bg-slate-700/40 hover:bg-slate-700/60 text-slate-200 border border-slate-700/60 rounded-xl transition duration-300 text-xs font-semibold cursor-pointer"
                          title={t('edit')}
                        >
                          <Edit className="w-3.5 h-3.5" />
                          <span>{t('edit')}</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleRelaunchCRD(selectedCrd)}
                        disabled={relaunching}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 border border-emerald-500/20 rounded-xl transition duration-300 text-xs font-semibold cursor-pointer disabled:opacity-50"
                        title={t('deleteRerunSameSpec')}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${relaunching ? 'animate-spin' : ''}`} />
                        <span>{relaunching ? t('relaunching') : t('relaunch')}</span>
                      </button>
                      <button
                        onClick={() => handleDeleteCRD(selectedCrd.metadata.name, selectedCrd.metadata.namespace)}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/20 rounded-xl transition duration-300 text-xs font-semibold cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{t('delete')}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Specs parameters */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-900">
                  <div className="flex items-center space-x-2 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                    <FileCode2 className="w-3.5 h-3.5" />
                    <span>{t('scriptConfigMap')}</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-300 mt-1 truncate">
                    {selectedCrd.spec.script?.configMap?.name || t('notAvailable')}
                  </p>
                </div>
                
                <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-900">
                  <div className="flex items-center space-x-2 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>{t('jsFile')}</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-300 mt-1 truncate">
                    {selectedCrd.spec.script?.configMap?.file || t('notAvailable')}
                  </p>
                </div>

                <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-900">
                  <div className="flex items-center space-x-2 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                    <Layers className="w-3.5 h-3.5" />
                    <span>{t('runnerImage')}</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-300 mt-1 truncate">
                    {selectedCrd.spec.runner?.image || 'default'}
                  </p>
                </div>
              </div>

              {/* Resource Limits */}
              <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-900 space-y-2 mb-6">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t('limits')}</h4>
                <div className="grid grid-cols-2 text-xs">
                  <div className="flex justify-between border-r border-slate-800 pr-4">
                    <span className="text-slate-500">{t('cpuLimit')}</span>
                    <span className="font-semibold text-slate-300">{selectedCrd.spec.runner?.resources?.limits?.cpu || t('unlimited')}</span>
                  </div>
                  <div className="flex justify-between pl-4">
                    <span className="text-slate-500">{t('memLimit')}</span>
                    <span className="font-semibold text-slate-300">{selectedCrd.spec.runner?.resources?.limits?.memory || t('unlimited')}</span>
                  </div>
                </div>
              </div>

              {/* Spec YAML Viewer */}
              <div className="flex-1 flex flex-col min-h-[150px] mb-4">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{t('specObject')}</h4>
                <pre className="flex-1 bg-slate-950 rounded-2xl p-4 overflow-auto font-mono text-[10px] text-slate-400 border border-slate-850 leading-relaxed max-h-[200px]">
                  {jsonToYaml(cleanK8sObject(selectedCrd))}
                </pre>
              </div>

              {/* ConfigMap Viewer */}
              {loadingConfigMap ? (
                <div className="text-center text-slate-500 text-xs py-4">{t('loading')}</div>
              ) : configMapData ? (
                <div className="flex flex-col min-h-[150px]">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    {t('scriptConfigMap')}: <span className="font-mono text-purple-400">{configMapData.name}</span>
                  </h4>
                  <div className="bg-slate-950 rounded-2xl border border-slate-850 overflow-hidden flex flex-col flex-1">
                    {Object.keys(configMapData.data || {}).map((fileName) => (
                      <div key={fileName} className="flex flex-col flex-1">
                        <div className="bg-slate-900/50 px-4 py-2 border-b border-slate-850 flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-slate-400 font-mono">{fileName}</span>
                          {!isViewer && (
                            <div className="flex space-x-2">
                              {editingConfigMapFile === fileName ? (
                                <>
                                  <button
                                    onClick={handleSaveConfigMap}
                                    disabled={savingConfigMap}
                                    className="text-[9px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded hover:bg-emerald-500/20 transition cursor-pointer font-semibold"
                                  >
                                    {savingConfigMap ? t('saving') : t('save')}
                                  </button>
                                  <button
                                    onClick={() => setEditingConfigMapFile(null)}
                                    className="text-[9px] px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded hover:bg-slate-700 transition cursor-pointer font-semibold"
                                  >
                                    {t('cancel')}
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingConfigMapFile(fileName);
                                    setEditingConfigMapContent(configMapData.data[fileName] || '');
                                  }}
                                  className="text-[9px] px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded hover:bg-purple-500/20 transition cursor-pointer font-semibold"
                                >
                                  {t('edit')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {editingConfigMapFile === fileName ? (
                          <textarea
                            value={editingConfigMapContent}
                            onChange={(e) => setEditingConfigMapContent(e.target.value)}
                            className="w-full h-[250px] p-4 bg-slate-950 font-mono text-[10px] text-emerald-400 border-0 focus:ring-0 focus:outline-none leading-relaxed resize-y"
                          />
                        ) : (
                          <pre className="p-4 overflow-auto font-mono text-[10px] text-emerald-400/90 leading-relaxed max-h-[200px] bg-slate-950/40">
                            {configMapData.data[fileName]}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

            </div>
          ) : selectedConfigMap ? (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md flex flex-col flex-1">
              <div className="border-b border-slate-800/80 pb-4 mb-4 flex justify-between items-start">
                <div>
                  <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-md border border-purple-500/20 font-semibold uppercase">
                    {t('crdDetails')}
                  </span>
                  <h3 className="text-xl font-bold text-slate-200 mt-2">{selectedConfigMap.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">{t('namespaceLabel')}: <strong className="font-semibold text-slate-400">{selectedConfigMap.namespace || namespace}</strong></p>
                </div>
              </div>

              {configMapData ? (
                <div className="flex flex-col flex-1 min-h-[300px]">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    {t('jsFile')}:
                  </h4>
                  <div className="bg-slate-950 rounded-2xl border border-slate-850 overflow-hidden flex flex-col flex-1">
                    {Object.keys(configMapData.data || {}).map((fileName) => (
                      <div key={fileName} className="flex flex-col flex-1">
                        <div className="bg-slate-900/50 px-4 py-2 border-b border-slate-850 flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-slate-400 font-mono">{fileName}</span>
                          {!isViewer && (
                            <div className="flex space-x-2">
                              {editingConfigMapFile === fileName ? (
                                <>
                                  <button
                                    onClick={handleSaveConfigMap}
                                    disabled={savingConfigMap}
                                    className="text-[9px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded hover:bg-emerald-500/20 transition cursor-pointer font-semibold"
                                  >
                                    {savingConfigMap ? t('saving') : t('save')}
                                  </button>
                                  <button
                                    onClick={() => setEditingConfigMapFile(null)}
                                    className="text-[9px] px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded hover:bg-slate-700 transition cursor-pointer font-semibold"
                                  >
                                    {t('cancel')}
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingConfigMapFile(fileName);
                                    setEditingConfigMapContent(configMapData.data[fileName] || '');
                                  }}
                                  className="text-[9px] px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded hover:bg-purple-500/20 transition cursor-pointer font-semibold"
                                >
                                  {t('edit')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {editingConfigMapFile === fileName ? (
                          <textarea
                            value={editingConfigMapContent}
                            onChange={(e) => setEditingConfigMapContent(e.target.value)}
                            className="w-full h-[300px] p-4 bg-slate-950 font-mono text-[10px] text-emerald-400 border-0 focus:ring-0 focus:outline-none leading-relaxed resize-y"
                          />
                        ) : (
                          <pre className="p-4 overflow-auto font-mono text-[10px] text-emerald-400/90 leading-relaxed max-h-[300px] bg-slate-950/40">
                            {configMapData.data[fileName]}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-slate-500 text-xs py-4">{t('noConfigMapData')}</div>
              )}
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
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl relative flex flex-col max-h-[90vh]">
            {/* Sticky header */}
            <div className="px-8 pt-8 pb-4 flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-2xl font-bold text-slate-100 mb-2">{t('instantiateK6')}</h3>
              <p className="text-slate-400 text-xs mb-0">
                {t('launchSpecDesc')}
              </p>

              {createError && (
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                  {createError}
                </div>
              )}
            </div>

            {/* Scrollable form body */}
            <form onSubmit={handleCreateCRD} className="flex flex-col flex-1 min-h-0">
              <div className="overflow-y-auto flex-1 px-8 py-4 space-y-4">
              {templates.length > 0 && (
                <div className="animate-fadeIn">
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('k6Template')}</label>
                  <select
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedTemplateId(val);
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
                    <option value="">-- {t('k6Template')} --</option>
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

              <div className="grid grid-cols-3 gap-4">
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
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('cpuLimit')}</label>
                  <input
                    type="text"
                    required
                    value={newRun.cpuLimit}
                    onChange={(e) => setNewRun({ ...newRun, cpuLimit: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('memLimit')}</label>
                  <input
                    type="text"
                    required
                    value={newRun.memLimit}
                    onChange={(e) => setNewRun({ ...newRun, memLimit: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">{t('scheduleTest')}</label>
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={(e) => setScheduleEnabled(e.target.checked)}
                    className="accent-purple-500"
                  />
                </div>
                {scheduleEnabled && (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('cronExpression')}</label>
                      <input
                        type="text"
                        value={cronExpression}
                        onChange={(e) => setCronExpression(e.target.value)}
                        placeholder="0 11 * * *"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-purple-500"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">{t('cronExample')}</p>
                    </div>
                    <p className="text-[10px] text-slate-500">{t('scheduleManagedHint')}</p>
                  </div>
                )}
              </div>

              {/* Script Source Selector */}
              <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/80 space-y-2.5">
                <label className="block text-xs font-semibold text-slate-400">{t('scriptSource')}</label>
                <div className="flex space-x-6">
                  <label className="flex items-center space-x-2 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="scriptSource"
                      value="manual"
                      checked={scriptSource === 'manual'}
                      onChange={() => {
                        setScriptSource('manual');
                        setNewRun(prev => ({ ...prev, scriptName: '', scriptFile: 'script.js' }));
                      }}
                      className="accent-purple-500"
                    />
                    <span className="text-xs font-semibold text-slate-300">{t('manualScript')}</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="scriptSource"
                      value="existing"
                      checked={scriptSource === 'existing'}
                      onChange={() => {
                        setScriptSource('existing');
                        setNewRun(prev => ({ ...prev, scriptName: '', scriptFile: '' }));
                      }}
                      className="accent-purple-500"
                    />
                    <span className="text-xs font-semibold text-slate-300">{t('existingScript')}</span>
                  </label>
                </div>
              </div>

              {scriptSource === 'manual' ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('scriptConfigMap')}</label>
                      <input
                        type="text"
                        required
                        value={newRun.scriptName}
                        onChange={(e) => setNewRun({ ...newRun, scriptName: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-purple-500"
                        placeholder="e.g. my-script-configmap"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('jsFile')}</label>
                      <input
                        type="text"
                        required
                        value={newRun.scriptFile}
                        onChange={(e) => setNewRun({ ...newRun, scriptFile: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-purple-500"
                        placeholder="e.g. script.js"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('jsScriptContent')}</label>
                    <textarea
                      required
                      value={newRun.scriptContent}
                      onChange={(e) => setNewRun({ ...newRun, scriptContent: e.target.value })}
                      rows={6}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 outline-none focus:border-purple-500 font-mono leading-relaxed"
                      placeholder="import http from 'k6/http'; ..."
                    />
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('selectConfigMap')}</label>
                    <select
                      value={newRun.scriptName}
                      onChange={(e) => {
                        const cmName = e.target.value;
                        const selectedCm = configMaps.find(cm => cm.name === cmName);
                        const files = selectedCm ? Object.keys(selectedCm.data || {}) : [];
                        setNewRun(prev => ({
                          ...prev,
                          scriptName: cmName,
                          scriptFile: files.length > 0 ? files[0] : 'script.js'
                        }));
                      }}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:border-purple-500 font-semibold"
                    >
                      <option value="">-- {t('selectConfigMap')} --</option>
                      {configMaps.map(cm => (
                        <option key={cm.name} value={cm.name}>{cm.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('jsFile')}</label>
                    <select
                      value={newRun.scriptFile}
                      onChange={(e) => setNewRun({ ...newRun, scriptFile: e.target.value })}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:border-purple-500 font-semibold"
                    >
                      {(() => {
                        const cm = configMaps.find(cm => cm.name === newRun.scriptName);
                        const files = cm?.data ? Object.keys(cm.data) : [];
                        return files.length > 0 ? (
                          files.map(f => (
                            <option key={f} value={f}>{f}</option>
                          ))
                        ) : (
                          <option value="">{t('noFiles')}</option>
                        );
                      })()}
                    </select>
                  </div>
                </div>
              )}

              {/* Arguments Section */}
              <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/80 space-y-3">
                <label className="flex items-center space-x-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newRun.useArguments}
                    onChange={(e) => setNewRun({ ...newRun, useArguments: e.target.checked })}
                    className="accent-purple-500 rounded border-slate-800"
                  />
                  <span className="text-xs font-semibold text-slate-300">{t('addOutputArguments')}</span>
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
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setNewRun(prev => ({
                        ...prev,
                        useCustomImage: enabled,
                        customImage: enabled && needsResolvedRunnerImage(prev.customImage)
                          ? runnerImagePlaceholder
                          : prev.customImage,
                      }));
                    }}
                    className="accent-purple-500 rounded border-slate-800"
                  />
                  <span className="text-xs font-semibold text-slate-300">{t('useCustomImage')}</span>
                </label>

                {newRun.useCustomImage && (
                  <div className="space-y-3 animate-fadeIn">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{t('runnerImagePath')}</label>
                      <input
                        type="text"
                        required
                        value={newRun.customImage}
                        onChange={(e) => setNewRun({ ...newRun, customImage: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono"
                        placeholder={runnerImagePlaceholder}
                      />
                    </div>
                    {checkingEcr && (
                      <p className="text-[10px] text-slate-500">{t('checkingEcrRepo')}</p>
                    )}
                    {!checkingEcr && ecrCheck && (
                      <div className={`text-[10px] ${ecrCheck.exists ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {ecrCheck.exists ? t('ecrRepoFound') : t('ecrRepoNotFound')}
                        {ecrCheck.message && (
                          <span className="text-slate-500 ml-2">{ecrCheck.message}</span>
                        )}
                      </div>
                    )}
                    {ecrHelper && (
                      <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3 space-y-2 text-[10px] text-slate-300">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{t('ecrPushHelper')}</p>
                        <pre className="whitespace-pre-wrap font-mono text-[10px] text-slate-400">{ecrHelper.login}</pre>
                        <pre className="whitespace-pre-wrap font-mono text-[10px] text-slate-400">{ecrHelper.ensureRepo}</pre>
                        <pre className="whitespace-pre-wrap font-mono text-[10px] text-slate-400">{ecrHelper.tag}</pre>
                        <pre className="whitespace-pre-wrap font-mono text-[10px] text-slate-400">{ecrHelper.push}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>

              </div>{/* end scrollable body */}

              {/* Sticky footer */}
              <div className="flex space-x-3 px-8 py-5 border-t border-slate-800 flex-shrink-0">
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

      {/* New ConfigMap Modal */}
      {isCmModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg p-8 shadow-2xl relative animate-slideUp">
            <button
              onClick={() => setIsCmModalOpen(false)}
              className="absolute top-6 right-6 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-bold text-slate-100 mb-2">{t('newConfigMap')}</h3>
            <p className="text-slate-400 text-xs mb-6">
              {t('newConfigMap')} — {t('namespaceLabel')}: <span className="text-purple-400 font-semibold">{namespace === 'all' ? (namespaces[0] || 'default') : namespace}</span> (k6s=enabled)
            </p>

            {createCmError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {createCmError}
              </div>
            )}

            <form onSubmit={handleCreateConfigMap} className="space-y-4">
              {configMaps.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('duplicateFrom')}</label>
                  <select
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) return;
                      const cm = configMaps.find(c => c.name === val);
                      if (cm) {
                        const keys = Object.keys(cm.data || {});
                        const firstFile = keys.length > 0 ? keys[0] : 'script.js';
                        setNewCm({
                          name: `${cm.name}-copy`,
                          fileName: firstFile,
                          scriptContent: cm.data ? (cm.data[firstFile] || '') : ''
                        });
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:border-purple-500 font-semibold"
                  >
                    <option value="">-- {t('duplicateFrom')} --</option>
                    {configMaps.map(cm => (
                      <option key={cm.name} value={cm.name}>{cm.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('configMapName')}</label>
                <input
                  type="text"
                  required
                  value={newCm.name}
                  onChange={(e) => setNewCm({ ...newCm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-purple-500"
                  placeholder="e.g. website-load-test"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('jsFileName')}</label>
                <input
                  type="text"
                  required
                  value={newCm.fileName}
                  onChange={(e) => setNewCm({ ...newCm, fileName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-purple-500"
                  placeholder="e.g. script.js"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('cmContent')}</label>
                <textarea
                  required
                  value={newCm.scriptContent}
                  onChange={(e) => setNewCm({ ...newCm, scriptContent: e.target.value })}
                  rows={8}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 outline-none focus:border-purple-500 font-mono leading-relaxed"
                  placeholder="import http from 'k6/http'; ..."
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCmModalOpen(false)}
                  className="flex-1 py-3 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creatingCm}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer disabled:opacity-50"
                >
                  {creatingCm ? t('creatingConfigMap') : t('submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-slideUp">
          <div className={`flex items-center space-x-3 px-4 py-3 rounded-2xl border shadow-lg backdrop-blur-md transition-all duration-300 ${
            toast.type === 'success' 
              ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-300' 
              : toast.type === 'error'
              ? 'bg-red-950/80 border-red-500/30 text-red-300'
              : 'bg-blue-950/80 border-blue-500/30 text-blue-300'
          }`}>
            <span className="w-2 h-2 rounded-full animate-ping bg-current" />
            <span className="text-xs font-semibold">{toast.message}</span>
          </div>
        </div>
      )}
      {/* Pod Logs Drawer */}
      {isLogsDrawerOpen && (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex justify-end animate-fadeIn">
      <div className="bg-slate-900 border-l border-slate-800 w-full max-w-2xl h-full flex flex-col p-6 shadow-2xl relative animate-slideLeft">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-850 pb-4 mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl">
                  <Terminal className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-100">{t('viewLogs')}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    CRD: <span className="font-semibold text-slate-200">{logCrdName}</span> | {t('namespaceLabel')}: <span className="font-semibold text-slate-200">{selectedCrd?.metadata.namespace || namespace}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsLogsDrawerOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1.5 hover:bg-slate-800 rounded-lg transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Pod Selector / Input */}
            <div className="bg-slate-950/50 p-4 rounded-2xl border border-slate-850 space-y-3 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{t('selectPod')}</label>
                  {loadingPods ? (
                    <div className="text-slate-500 text-xs py-2 animate-pulse">{t('loading')}</div>
                  ) : podsList.length > 0 ? (
                    <select
                      value={logsPodName}
                      onChange={(e) => setLogsPodName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:border-purple-500 outline-none font-mono cursor-pointer"
                    >
                      <option value="">-- {t('selectPod')} --</option>
                      {/* First show matching pods for this test */}
                      <optgroup label={t('matchingPods')}>
                        {podsList.filter(p => p.name.startsWith(logCrdName)).map(p => (
                          <option key={p.name} value={p.name}>{p.name} ({p.status})</option>
                        ))}
                      </optgroup>
                      {/* Then show other pods in the namespace */}
                      <optgroup label={t('otherPods')}>
                        {podsList.filter(p => !p.name.startsWith(logCrdName)).map(p => (
                          <option key={p.name} value={p.name}>{p.name} ({p.status})</option>
                        ))}
                      </optgroup>
                    </select>
                  ) : (
                    <div className="text-slate-500 text-xs py-2">{t('noResources')}</div>
                  )}
                  <div className="mt-2">
                    <input
                      type="text"
                      value={logsPodName}
                      onChange={(e) => setLogsPodName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-1.5 text-[11px] text-slate-400 focus:border-purple-500 outline-none font-mono"
                      placeholder={t('customPodPlaceholder')}
                    />
                  </div>
                </div>
                <div className="flex items-end space-x-2 shrink-0">
                  <button
                    onClick={() => setIsLiveLogs(prev => !prev)}
                    className={`flex items-center space-x-1.5 px-3 py-2 border rounded-xl text-xs font-semibold transition cursor-pointer ${
                      isLiveLogs
                        ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                        : 'border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isLiveLogs ? 'bg-red-500 animate-ping' : 'bg-slate-500'}`} />
                    <span>{isLiveLogs ? t('liveFollow') : t('manual')}</span>
                  </button>
                  <button
                    onClick={() => fetchLogs()}
                    disabled={loadingLogs}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition cursor-pointer border border-slate-700"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Suggestions */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase tracking-wider pt-1 border-t border-slate-900/60 mt-2">
                  <span>{t('recommendations')}:</span>
                  <button
                    onClick={() => loadPods(logCrdName, selectedCrd?.metadata.namespace || namespace)}
                    className="text-purple-400 hover:text-purple-300 font-semibold cursor-pointer normal-case"
                  >
                    {t('refreshConfigMaps')}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => setLogsPodName(`${logCrdName}-initializer`)}
                    className={`px-2.5 py-1 text-[10px] font-mono border rounded-lg transition cursor-pointer ${
                      logsPodName === `${logCrdName}-initializer`
                        ? 'bg-purple-500/10 border-purple-500/40 text-purple-400'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {`${logCrdName}-initializer`}
                  </button>
                  <button
                    onClick={() => setLogsPodName(`${logCrdName}-runner`)}
                    className={`px-2.5 py-1 text-[10px] font-mono border rounded-lg transition cursor-pointer ${
                      logsPodName === `${logCrdName}-runner`
                        ? 'bg-purple-500/10 border-purple-500/40 text-purple-400'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {`${logCrdName}-runner`}
                  </button>
                  <button
                    onClick={() => setLogsPodName(`${logCrdName}-1`)}
                    className={`px-2.5 py-1 text-[10px] font-mono border rounded-lg transition cursor-pointer ${
                      logsPodName === `${logCrdName}-1`
                        ? 'bg-purple-500/10 border-purple-500/40 text-purple-400'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {`${logCrdName}-1`}
                  </button>
                </div>
              </div>
            </div>

            {/* Error Message */}
            {logsError && (
              <div className="mb-4 p-3 bg-red-500/5 border border-red-500/10 rounded-xl text-red-400 text-xs">
                {logsError}
              </div>
            )}

            {/* Console Screen */}
            <div 
              ref={logsContainerRef}
              className="flex-1 bg-black rounded-2xl border border-slate-850 p-4 font-mono text-xs text-emerald-400/90 overflow-y-auto leading-relaxed shadow-inner"
            >
              <pre className="whitespace-pre-wrap">{podLogsText || t('logsConnecting')}</pre>
            </div>
            
            {/* Console Status Footer */}
            <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500 font-medium">
              <span>{t('logsStatus')} {loadingLogs ? t('logsPolling') : t('logsIdle')}</span>
              <span>{t('totalLabel')}: {podLogsText ? podLogsText.split('\n').length : 0}</span>
            </div>

          </div>
        </div>
      )}

      {/* Custom Confirmation Dialog */}
      {confirmDialog?.isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-100">{confirmDialog.title}</h3>
            <p className="text-slate-400 text-xs leading-normal">{confirmDialog.message}</p>
            <div className="flex space-x-3 pt-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 py-2 border border-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-xl text-xs font-semibold shadow-lg transition cursor-pointer hover:from-purple-500 hover:to-pink-400"
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
