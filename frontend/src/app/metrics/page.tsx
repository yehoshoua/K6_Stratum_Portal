'use client';

import React, { useEffect, useState } from 'react';
import { 
  BarChart3, 
  Database, 
  Calendar, 
  RefreshCw, 
  ArrowDownWideNarrow, 
  TrendingUp,
  ChevronDown,
  ChevronRight,
  Printer,
  Activity
} from 'lucide-react';
import { api, TestRunSummary, TelemetryPoint, InfluxServerConfig } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';

export default function MetricsPage() {
  const { t } = usePreferences();
  const [runs, setRuns] = useState<TestRunSummary[]>([]);
  const [selectedRunKeys, setSelectedRunKeys] = useState<string[]>([]);
  const [metric, setMetric] = useState<'vus' | 'http_req_duration' | 'error_rate'>('http_req_duration');
  const [timeRange, setTimeRange] = useState('1h');
  const [isLive, setIsLive] = useState(false);
  
  const [selectedCluster, setSelectedCluster] = useState<string>('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');

  const [multiPoints, setMultiPoints] = useState<{[runKey: string]: TelemetryPoint[]}>({});
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [error, setError] = useState('');

  const [expandedGroups, setExpandedGroups] = useState<{[key: string]: boolean}>({});

  const [servers, setServers] = useState<InfluxServerConfig[]>([]);
  const [activeServerId, setActiveServerId] = useState<string>('');

  const getRunKey = (run: TestRunSummary) => `${run.test_run_id}|${run.cluster || ''}|${run.namespace || ''}`;

  const displayRunName = (runKey: string) => {
    const parts = runKey.split('|');
    const runId = parts[0];
    const cluster = parts[1];
    const namespace = parts[2];
    if (cluster && namespace) {
      return `${runId} (${cluster}/${namespace})`;
    } else if (cluster) {
      return `${runId} (${cluster})`;
    }
    return runId;
  };

  const loadServers = async () => {
    try {
      const data = await api.getInfluxServers();
      setServers(data || []);
      const active = data.find(s => s.is_active);
      if (active) {
        setActiveServerId(active.id);
      }
    } catch (err) {
      console.error('Failed to load InfluxDB servers', err);
    }
  };

  const handleServerChange = async (serverId: string) => {
    try {
      setLoadingRuns(true);
      setError('');
      await api.activateInfluxServer(serverId);
      setActiveServerId(serverId);
      await loadRuns(false);
      setRefreshTrigger(prev => prev + 1);
    } catch (err: any) {
      console.error('Failed to switch active InfluxDB server', err);
      setError(err.message || 'Failed to switch InfluxDB server');
    } finally {
      setLoadingRuns(false);
    }
  };

  const selectedRunKey = selectedRunKeys[0] || '';

  const loadRuns = async (preserveSelection = true) => {
    try {
      setLoadingRuns(true);
      setError('');
      const data = await api.getTestRuns();
      const safeData = data || [];
      setRuns(safeData);
      
      if (safeData.length > 0) {
        // Keep current selections if they still exist, otherwise select first run
        const stillExists = preserveSelection && selectedRunKeys.filter(key => safeData.some(r => getRunKey(r) === key));
        if (stillExists && stillExists.length > 0) {
          setSelectedRunKeys(stillExists);
        } else {
          setSelectedRunKeys([getRunKey(safeData[0])]);
        }
      } else {
        setSelectedRunKeys([]);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to fetch test runs');
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  };

  const handleRefresh = async () => {
    await loadRuns(true);
    setRefreshTrigger(prev => prev + 1);
  };

  useEffect(() => {
    loadServers();
    loadRuns(false); // First load selects the first run
  }, []);

  // Filtered runs list based on cluster and namespace selections
  const filteredRuns = runs.filter(run => {
    if (selectedCluster && run.cluster !== selectedCluster) return false;
    if (selectedNamespace && run.namespace !== selectedNamespace) return false;
    return true;
  });

  // Extract unique clusters and namespaces
  const uniqueClusters = Array.from(
    new Set(runs.map(r => r.cluster).filter(Boolean) as string[])
  ).sort();
  const uniqueNamespaces = Array.from(
    new Set(runs.map(r => r.namespace).filter(Boolean) as string[])
  ).sort();

  // Keep selection aligned with filter changes
  useEffect(() => {
    if (filteredRuns.length > 0) {
      const validSelectedKeys = selectedRunKeys.filter(key => filteredRuns.some(r => getRunKey(r) === key));
      if (validSelectedKeys.length === 0) {
        setSelectedRunKeys([getRunKey(filteredRuns[0])]);
      } else if (validSelectedKeys.length !== selectedRunKeys.length) {
        setSelectedRunKeys(validSelectedKeys);
      }
    } else {
      setSelectedRunKeys([]);
    }
  }, [selectedCluster, selectedNamespace, runs]);

  const loadMetrics = async () => {
    if (selectedRunKeys.length === 0) {
      setMultiPoints({});
      return;
    }
    try {
      setLoadingMetrics(true);
      const results: {[runKey: string]: TelemetryPoint[]} = {};
      
      let absoluteStart: string | undefined = undefined;
      let absoluteStop: string | undefined = undefined;

      const selectedRuns = runs.filter(r => selectedRunKeys.includes(getRunKey(r)));
      if (selectedRuns.length > 0) {
        let minTime = Infinity;
        let maxTime = -Infinity;

        selectedRuns.forEach(r => {
          if (!r.start_time) return;
          const tStart = new Date(r.start_time).getTime();
          const duration = r.duration_seconds > 0 ? r.duration_seconds : 60;
          const tEnd = tStart + duration * 1000;

          if (tStart < minTime) minTime = tStart;
          if (tEnd > maxTime) maxTime = tEnd;
        });

        if (minTime !== Infinity && maxTime !== -Infinity) {
          // Add 10 seconds safety margins before and after
          absoluteStart = new Date(minTime - 10000).toISOString();
          absoluteStop = new Date(maxTime + 10000).toISOString();
        }
      }

      await Promise.all(
        selectedRuns.map(async (run) => {
          try {
            const runKey = getRunKey(run);
            const data = await api.getRunMetrics(
              run.test_run_id, 
              metric, 
              timeRange, 
              absoluteStart, 
              absoluteStop,
              run.cluster,
              run.namespace
            );
            results[runKey] = data || [];
          } catch (err) {
            console.error(`Failed to load metrics for run ${run.test_run_id}`, err);
            results[getRunKey(run)] = [];
          }
        })
      );
      setMultiPoints(results);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMetrics(false);
    }
  };

  // Turn off live mode if we aren't viewing exactly one run
  useEffect(() => {
    if (selectedRunKeys.length !== 1) {
      setIsLive(false);
    }
  }, [selectedRunKeys]);

  // Handle EventSource connection for live telemetry streaming
  useEffect(() => {
    if (!isLive || selectedRunKeys.length !== 1) return;

    const run = runs.find(r => getRunKey(r) === selectedRunKey);
    if (!run) return;

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
    const url = `/api/influx/runs/${run.test_run_id}/stream?metric=${metric}&cluster=${encodeURIComponent(run.cluster || '')}&namespace=${encodeURIComponent(run.namespace || '')}&token=${encodeURIComponent(token || '')}`;

    setLoadingMetrics(true);
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data)) {
          setMultiPoints(prev => ({
            ...prev,
            [selectedRunKey]: data
          }));
        }
        setLoadingMetrics(false);
      } catch (err) {
        console.error('Failed to parse SSE data:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      eventSource.close();
      setLoadingMetrics(false);
    };

    return () => {
      eventSource.close();
    };
  }, [isLive, selectedRunKey, metric, runs]);

  useEffect(() => {
    if (!isLive) {
      loadMetrics();
    }
  }, [selectedRunKeys, metric, timeRange, refreshTrigger, isLive]);

  const activeRun = runs.find(r => getRunKey(r) === selectedRunKey);

  // SVG Chart calculation helpers
  const svgWidth = 800;
  const svgHeight = 300;
  const padding = 40;

  const chartColors = [
    { stroke: '#C084FC', stopColor: '#A855F7', id: 'purple' }, // Purple
    { stroke: '#F472B6', stopColor: '#EC4899', id: 'pink' },   // Pink
    { stroke: '#34D399', stopColor: '#10B981', id: 'emerald' },// Emerald
    { stroke: '#60A5FA', stopColor: '#3B82F6', id: 'blue' },   // Blue
    { stroke: '#FBBF24', stopColor: '#F59E0B', id: 'orange' }, // Orange
    { stroke: '#F87171', stopColor: '#EF4444', id: 'red' },    // Red
  ];

  const getChartData = () => {
    // Collect all points across all selected runs to find global min/max
    const allPoints: { value: number; timestamp: Date }[] = [];
    Object.values(multiPoints).forEach((pts) => {
      pts.forEach(p => {
        allPoints.push({ value: p.value, timestamp: new Date(p.timestamp) });
      });
    });

    if (allPoints.length === 0) {
      return { lines: [], gridY: [] };
    }

    const xMin = padding;
    const xMax = svgWidth - padding;
    const yMin = padding;
    const yMax = svgHeight - padding;

    const values = allPoints.map(p => p.value);
    const minVal = Math.min(...values) * 0.9;
    const maxVal = Math.max(...values) * 1.1 || 1;
    const valRange = maxVal - minVal || 1;

    // Generate Y-axis gridlines
    const gridY = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
      const val = minVal + ratio * valRange;
      const y = yMax - ratio * (yMax - yMin);
      return { val, y };
    });

    // Generate lines for each run
    const lines = Object.entries(multiPoints).map(([runKey, pts], runIndex) => {
      const color = chartColors[runIndex % chartColors.length];
      const divisor = pts.length > 1 ? pts.length - 1 : 1;
      
      const pointsList = pts.map((p, idx) => {
        const x = pts.length === 1 
          ? (xMin + xMax) / 2 
          : xMin + (idx / divisor) * (xMax - xMin);
        const y = yMax - ((p.value - minVal) / valRange) * (yMax - yMin);
        return { x, y, value: p.value, timestamp: new Date(p.timestamp).toLocaleTimeString() };
      });

      let path = '';
      if (pointsList.length > 0) {
        path = `M ${pointsList[0].x} ${pointsList[0].y}`;
        for (let i = 1; i < pointsList.length; i++) {
          const prev = pointsList[i - 1];
          const curr = pointsList[i];
          const cpX1 = prev.x + (curr.x - prev.x) / 2;
          const cpY1 = prev.y;
          const cpX2 = prev.x + (curr.x - prev.x) / 2;
          const cpY2 = curr.y;
          path += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${curr.x} ${curr.y}`;
        }
      }

      return {
        runId: runKey.split('|')[0],
        runKey,
        pointsList,
        path,
        color
      };
    });

    return { lines, gridY };
  };

  const chart = getChartData();
  const allValues = Object.values(multiPoints).flatMap(pts => pts.map(p => p.value));
  let avgValue = '0';
  let maxValue = '0';
  let minValue = '0';

  if (allValues.length > 0) {
    const sum = allValues.reduce((a, b) => a + b, 0);
    const avg = sum / allValues.length;
    const max = Math.max(...allValues);
    const min = Math.min(...allValues);

    if (metric === 'error_rate') {
      avgValue = `${(avg * 100).toFixed(1)}%`;
      maxValue = `${(max * 100).toFixed(1)}%`;
      minValue = `${(min * 100).toFixed(1)}%`;
    } else if (metric === 'vus') {
      avgValue = avg.toFixed(0);
      maxValue = max.toFixed(0);
      minValue = min.toFixed(0);
    } else {
      avgValue = `${avg.toFixed(1)} ms`;
      maxValue = `${max.toFixed(1)} ms`;
      minValue = `${min.toFixed(1)} ms`;
    }
  } else {
    if (metric === 'error_rate') {
      avgValue = '0.0%';
      maxValue = '0.0%';
      minValue = '0.0%';
    } else if (metric === 'vus') {
      avgValue = '0';
      maxValue = '0';
      minValue = '0';
    } else {
      avgValue = '0.0 ms';
      maxValue = '0.0 ms';
      minValue = '0.0 ms';
    }
  }

  // Group runs by base name
  const getBaseTestName = (runId: string): string => {
    const parts = runId.split('-');
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (/^\d+$/.test(last) || last.length <= 4) {
        return parts.slice(0, -1).join('-');
      }
    }
    return runId;
  };

  const groupedRuns: { [baseName: string]: TestRunSummary[] } = {};
  filteredRuns.forEach(run => {
    const base = getBaseTestName(run.test_run_id);
    if (!groupedRuns[base]) {
      groupedRuns[base] = [];
    }
    groupedRuns[base].push(run);
  });

  const toggleGroup = (base: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [base]: !prev[base]
    }));
  };

  const handleSelectRun = (run: TestRunSummary) => {
    setSelectedRunKeys([getRunKey(run)]);
  };

  const handleToggleRunCheckbox = (run: TestRunSummary, e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const runKey = getRunKey(run);
    setSelectedRunKeys(prev => {
      if (prev.includes(runKey)) {
        return prev.filter(key => key !== runKey);
      } else {
        return [...prev, runKey];
      }
    });
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Print-only CSS layout injection */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          /* 1. Global Reset & Print Setup */
          @page {
            size: landscape;
            margin: 10mm 15mm;
          }
          
          html, body {
            background: white !important;
            color: black !important;
            width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
            position: static !important;
            font-size: 12px !important;
          }
          
          /* 2. Reset Structural Wrappers */
          #__next,
          body > div,
          div[dir="ltr"],
          div[dir="rtl"],
          div[dir="ltr"] > div,
          div[dir="rtl"] > div,
          .min-h-screen,
          main {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
            background: transparent !important;
            padding: 0 !important;
            margin: 0 !important;
            position: static !important;
          }

          /* 3. Hide Unwanted UI Elements */
          aside, 
          header, 
          .no-print, 
          button, 
          select, 
          input, 
          .shrink-0 {
            display: none !important;
          }

          /* 4. Column & Grid Reset */
          .grid {
            display: block !important;
          }
          
          .lg\\:col-span-4 {
            display: none !important;
          }
          
          .lg\\:col-span-8 {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            background: #ffffff !important;
            border: 1px solid #e2e8f0 !important;
            border-radius: 24px !important;
            padding: 2rem !important;
            margin: 0 !important;
            box-shadow: none !important;
          }

          /* 5. Space & Margin Compression */
          .space-y-8 {
            display: block !important;
            width: 100% !important;
          }
          
          .space-y-8 > * {
            margin-top: 0.75rem !important;
            margin-bottom: 0 !important;
          }
          
          .space-y-8 > :first-child {
            margin-top: 0 !important;
          }

          /* Compress layout margins */
          .mb-6 {
            margin-bottom: 0.75rem !important;
          }
          .pb-4 {
            padding-bottom: 0.5rem !important;
          }
          .space-y-6 > * {
            margin-top: 0.75rem !important;
            margin-bottom: 0 !important;
          }
          .space-y-6 > :first-child {
            margin-top: 0 !important;
          }

          /* 6. Stats Grid & Cards */
          .grid-cols-3 {
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 1rem !important;
            margin-bottom: 1rem !important;
            width: 100% !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          
          .grid-cols-3 > div {
            background: #f8fafc !important;
            border: 1px solid #e2e8f0 !important;
            border-radius: 12px !important;
            padding: 0.75rem 1rem !important;
            color: #0f172a !important;
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
            box-shadow: none !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          /* 7. Chart Container & SVG */
          .chart-container-print {
            background: #f8fafc !important;
            border: 1px solid #e2e8f0 !important;
            border-radius: 16px !important;
            padding: 1rem !important;
            height: 320px !important;
            min-height: 320px !important;
            display: block !important;
            box-shadow: none !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin-top: 0.75rem !important;
          }
          
          .chart-container-print svg {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
          }

          /* 8. Text & Contrast Color Overrides */
          .text-white, h2, h3, h1 {
            color: #0f172a !important;
          }
          
          .text-slate-400, .text-slate-500 {
            color: #475569 !important;
          }
          
          /* Icon Colors with High Contrast */
          .text-pink-400 {
            color: #db2777 !important;
          }
          .text-purple-400 {
            color: #7c3aed !important;
          }
          .text-blue-400 {
            color: #2563eb !important;
          }

          /* SVG elements */
          circle {
            fill: #ffffff !important;
          }
          line[stroke="#1E293B"] {
            stroke: #cbd5e1 !important;
          }
          text[fill="#64748B"] {
            fill: #334155 !important;
          }
        }
      `}} />

      {/* Print-only Report Header */}
      <div className="hidden print:block border-b-2 border-slate-300 pb-4 mb-6 no-print">
        <h1 className="text-2xl font-bold text-slate-900">K6 Stratum Portal - Performance Test Report</h1>
        <p className="text-xs text-slate-500 mt-1">Generated on: {new Date().toLocaleString()}</p>
      </div>

      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">{t('metricsTitle')}</h2>
          <p className="text-slate-400 text-sm mt-1">
            {t('metricsSub')}
          </p>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          {selectedRunKeys.length === 1 && (
            <button
              onClick={() => setIsLive(prev => !prev)}
              className={`flex items-center space-x-2 px-3.5 py-2.5 border rounded-xl text-xs font-semibold transition cursor-pointer ${
                isLive
                  ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                  : 'border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className={`w-4 h-4 ${isLive ? 'animate-pulse' : ''}`} />
              <span>{isLive ? 'LIVE' : 'Go Live'}</span>
            </button>
          )}

          <button
            onClick={() => window.print()}
            className="flex items-center space-x-2 px-3.5 py-2.5 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Export PDF</span>
          </button>

          <button
            onClick={handleRefresh}
            className="p-2.5 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${(loadingRuns || loadingMetrics) ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Grid selector & details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Side: Runs List grouped by Test Box */}
        <div className="lg:col-span-4 bg-slate-900/30 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md flex flex-col space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-purple-400" />
            <span>{t('runs')}</span>
          </h3>

          {/* Cluster & Namespace Selectors */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Cluster</label>
              <select
                value={selectedCluster}
                onChange={(e) => {
                  setSelectedCluster(e.target.value);
                  setSelectedRunKeys([]);
                }}
                className="w-full bg-slate-950/80 border border-slate-850 text-slate-300 hover:text-white px-2.5 py-2 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer"
              >
                <option value="">All Clusters</option>
                {uniqueClusters.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Namespace</label>
              <select
                value={selectedNamespace}
                onChange={(e) => {
                  setSelectedNamespace(e.target.value);
                  setSelectedRunKeys([]);
                }}
                className="w-full bg-slate-950/80 border border-slate-850 text-slate-300 hover:text-white px-2.5 py-2 rounded-xl outline-none focus:border-purple-500/50 transition cursor-pointer"
              >
                <option value="">All Namespaces</option>
                {uniqueNamespaces.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          {loadingRuns ? (
            <div className="py-12 text-slate-500 text-center text-xs">Loading...</div>
          ) : error ? (
            <div className="py-8 px-4 text-center text-red-400 bg-red-500/5 border border-red-500/10 rounded-2xl space-y-2">
              <p className="text-xs font-semibold">{error}</p>
              <p className="text-[10px] text-slate-500 max-w-[200px] mx-auto">
                Make sure InfluxDB is port-forwarded and correctly configured in settings.
              </p>
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className="py-12 text-slate-500 text-center text-xs">No test runs match selected filters.</div>
          ) : (
            <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1">
              {Object.entries(groupedRuns).map(([baseName, groupRuns]) => {
                const isExpanded = !!expandedGroups[baseName];
                const selectedInGroup = groupRuns.filter(r => selectedRunKeys.includes(getRunKey(r)));
                return (
                  <div key={baseName} className="border border-slate-850 rounded-2xl overflow-hidden bg-slate-950/20">
                    <div 
                      onClick={() => toggleGroup(baseName)}
                      className="p-3 bg-slate-900/20 hover:bg-slate-900/40 flex items-center justify-between cursor-pointer transition text-slate-200"
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-purple-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                        <span className="font-semibold text-xs truncate" title={baseName}>{baseName}</span>
                      </div>
                      {selectedInGroup.length > 0 && (
                        <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-md text-[9px] font-bold">
                          {selectedInGroup.length} Selected
                        </span>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="p-3 space-y-2.5 border-t border-slate-850 bg-slate-900/10 max-h-[300px] overflow-y-auto">
                        {groupRuns.map((run) => {
                          const runKey = getRunKey(run);
                          const isSelected = selectedRunKeys.includes(runKey);
                          return (
                            <div
                              key={runKey}
                              onClick={() => handleSelectRun(run)}
                              className={`p-3 rounded-xl border cursor-pointer transition-all duration-300 space-y-1.5 ${
                                isSelected
                                  ? 'bg-slate-900/80 border-purple-500/40 shadow-md shadow-purple-500/5'
                                  : 'bg-slate-900/20 border-slate-850 hover:border-slate-800'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2 min-w-0">
                                  <input 
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => handleToggleRunCheckbox(run, e)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="accent-purple-500 cursor-pointer"
                                  />
                                  <span className="font-semibold text-[11px] text-slate-300 truncate" title={run.test_run_id}>
                                    {run.test_run_id.substring(baseName.length + 1) || run.test_run_id}
                                  </span>
                                </div>
                                <Calendar className="w-3 h-3 text-slate-600 shrink-0" />
                              </div>
                              
                              <p className="text-[9px] text-slate-500">
                                {new Date(run.start_time).toLocaleString()}
                              </p>

                              {(run.cluster || run.namespace) && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {run.cluster && (
                                    <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-[8px] font-bold">
                                      {run.cluster}
                                    </span>
                                  )}
                                  {run.namespace && (
                                    <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[8px] font-bold">
                                      {run.namespace}
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-850/40 text-[9px] text-slate-400">
                                <div>VUs Max : <strong className="text-slate-200">{run.max_vus}</strong></div>
                                <div>Avg : <strong className="text-slate-200">{run.avg_req_duration_ms}ms</strong></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Side: Graph & Detailed telemetry metrics */}
        <div className="lg:col-span-8 bg-slate-900/30 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md flex flex-col justify-between space-y-6">
          {selectedRunKeys.length > 0 ? (
            <>
              {/* Header metrics filters */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-white truncate">
                    {selectedRunKeys.length === 1 ? displayRunName(selectedRunKey) : `Comparing ${selectedRunKeys.length} Runs`}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t('telemetry')}
                  </p>
                  <div className="hidden print:flex items-center space-x-2 text-[10px] text-slate-500 mt-1.5">
                    <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-700 font-semibold">
                      Metric: {metric === 'http_req_duration' ? 'Latency' : metric === 'vus' ? 'Active Users' : 'Error Rate'}
                    </span>
                    <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-700 font-semibold">
                      Time Range: {
                        timeRange === '5m' ? '5 Minutes' :
                        timeRange === '15m' ? '15 Minutes' :
                        timeRange === '30m' ? '30 Minutes' :
                        timeRange === '1h' ? '1 Hour' :
                        timeRange === '3h' ? '3 Hours' :
                        timeRange === '6h' ? '6 Hours' :
                        timeRange === '12h' ? '12 Hours' :
                        timeRange === '24h' ? '24 Hours' :
                        timeRange === '7d' ? '7 Days' : timeRange
                      }
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  {/* Timeline Selection */}
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value)}
                    className="bg-slate-950/80 border border-slate-850 text-slate-300 hover:text-white px-3 py-1.5 rounded-xl text-xs transition cursor-pointer outline-none focus:border-purple-500/50"
                  >
                    <option value="5m">5 Minutes</option>
                    <option value="15m">15 Minutes</option>
                    <option value="30m">30 Minutes</option>
                    <option value="1h">1 Hour</option>
                    <option value="3h">3 Hours</option>
                    <option value="6h">6 Hours</option>
                    <option value="12h">12 Hours</option>
                    <option value="24h">24 Hours</option>
                    <option value="7d">7 Days</option>
                  </select>

                  {/* Metric Toggle */}
                  <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-850 text-[10px] font-bold">
                    <button
                      onClick={() => setMetric('http_req_duration')}
                      className={`px-3 py-1.5 rounded-lg transition ${
                        metric === 'http_req_duration'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {t('metricRateToggle')}
                    </button>
                    <button
                      onClick={() => setMetric('vus')}
                      className={`px-3 py-1.5 rounded-lg transition ${
                        metric === 'vus'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {t('metricVUsToggle')}
                    </button>
                    <button
                      onClick={() => setMetric('error_rate')}
                      className={`px-3 py-1.5 rounded-lg transition ${
                        metric === 'error_rate'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {t('metricErrorToggle') || 'Error Rate (http_req_failed)'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Stats panel widgets */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { name: t('valMax'), value: maxValue, icon: TrendingUp, color: 'text-pink-400 border-pink-500/10' },
                  { name: t('valAvg'), value: avgValue, icon: BarChart3, color: 'text-purple-400 border-purple-500/10' },
                  { name: t('valMin'), value: minValue, icon: ArrowDownWideNarrow, color: 'text-blue-400 border-blue-500/10' }
                ].map((stat, i) => (
                  <div key={i} className="p-4 bg-slate-950/40 border border-slate-900 rounded-2xl flex items-center justify-between">
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{stat.name}</span>
                      <p className="text-lg font-bold text-white">{stat.value}</p>
                    </div>
                    <stat.icon className={`w-5 h-5 ${stat.color.split(' ')[0]}`} />
                  </div>
                ))}
              </div>

              {/* Legend for Compare Mode */}
              {selectedRunKeys.length > 1 && (
                <div className="flex flex-wrap gap-3 p-3.5 bg-slate-950/40 border border-slate-850 rounded-2xl text-[10px]">
                  {chart.lines.map((line) => (
                    <div key={line.runKey} className="flex items-center space-x-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: line.color.stroke }} />
                      <span className="text-slate-300 font-medium truncate max-w-[180px]" title={displayRunName(line.runKey)}>
                        {displayRunName(line.runKey)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Responsive SVG Chart */}
              <div className="relative bg-slate-950/60 rounded-2xl p-4 border border-slate-900 overflow-hidden flex-1 min-h-[300px] flex items-center justify-center chart-container-print">
                {loadingMetrics ? (
                  <div className="text-slate-500 text-sm">{t('chartLoading')}</div>
                ) : chart.lines.length === 0 ? (
                  <div className="text-slate-500 text-sm">{t('chartNoData')}</div>
                ) : (
                  <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-full text-slate-600">
                    <defs>
                      {chart.lines.map((line) => (
                        <linearGradient key={line.runKey} id={`chartGradient-${line.color.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={line.color.stopColor} stopOpacity="0.25" />
                          <stop offset="100%" stopColor={line.color.stopColor} stopOpacity="0.0" />
                        </linearGradient>
                      ))}
                    </defs>

                    {/* Y-axis gridlines */}
                    {chart.gridY.map((g, idx) => (
                      <g key={idx}>
                        <line 
                          x1={padding} 
                          y1={g.y} 
                          x2={svgWidth - padding} 
                          y2={g.y} 
                          stroke="#1E293B" 
                          strokeWidth="1" 
                          strokeDasharray="4 4"
                        />
                        <text 
                          x={padding - 10} 
                          y={g.y + 4} 
                          fill="#64748B" 
                          fontSize="9" 
                          textAnchor="end"
                          className="font-mono"
                        >
                          {metric === 'error_rate' 
                            ? `${(g.val * 100).toFixed(1)}%` 
                            : metric === 'http_req_duration' 
                            ? `${g.val.toFixed(0)} ms` 
                            : g.val.toFixed(0)}
                        </text>
                      </g>
                    ))}

                    {/* Gradients under curves */}
                    {chart.lines.map((line) => (
                      line.pointsList.length > 0 && (
                        <path
                          key={`grad-${line.runKey}`}
                          d={`${line.path} L ${line.pointsList[line.pointsList.length - 1].x} ${svgHeight - padding} L ${line.pointsList[0].x} ${svgHeight - padding} Z`}
                          fill={`url(#chartGradient-${line.color.id})`}
                        />
                      )
                    ))}

                    {/* Main smooth curves */}
                    {chart.lines.map((line) => (
                      <path
                        key={`path-${line.runKey}`}
                        d={line.path}
                        fill="none"
                        stroke={line.color.stroke}
                        strokeWidth="2.5"
                      />
                    ))}

                    {/* Interactive dots */}
                    {chart.lines.map((line) => (
                      line.pointsList.map((pt, idx) => (
                        <circle
                          key={`${line.runKey}-dot-${idx}`}
                          cx={pt.x}
                          cy={pt.y}
                          r="3"
                          fill="#0F172A"
                          stroke={line.color.stroke}
                          strokeWidth="1.5"
                          className="hover:r-4 cursor-pointer transition-all"
                        >
                          <title>{`Run: ${displayRunName(line.runKey)}\nTime: ${pt.timestamp}\nValue: ${pt.value.toFixed(1)}`}</title>
                        </circle>
                      ))
                    ))}

                    {/* Bottom timestamps */}
                    {chart.lines.length > 0 && chart.lines[0].pointsList.map((pt, idx) => {
                      if (idx === 0 || idx === chart.lines[0].pointsList.length - 1 || idx === Math.floor(chart.lines[0].pointsList.length / 2)) {
                        return (
                          <text
                             key={idx}
                             x={pt.x}
                             y={svgHeight - padding + 15}
                             fill="#64748B"
                             fontSize="9"
                             textAnchor="middle"
                             className="font-mono"
                          >
                            {pt.timestamp}
                          </text>
                        );
                      }
                      return null;
                    })}
                  </svg>
                )}
              </div>
            </>
          ) : (
            <div className="py-24 text-center text-slate-500 border border-dashed border-slate-800 rounded-3xl">
              {t('chartSelectRun')}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
