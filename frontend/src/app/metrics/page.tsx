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
  ChevronRight
} from 'lucide-react';
import { api, TestRunSummary, TelemetryPoint, InfluxServerConfig } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';

export default function MetricsPage() {
  const { t } = usePreferences();
  const [runs, setRuns] = useState<TestRunSummary[]>([]);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [metric, setMetric] = useState<'vus' | 'http_req_duration'>('http_req_duration');
  const [timeRange, setTimeRange] = useState('1h');
  
  const [multiPoints, setMultiPoints] = useState<{[runId: string]: TelemetryPoint[]}>({});
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [error, setError] = useState('');

  const [expandedGroups, setExpandedGroups] = useState<{[key: string]: boolean}>({});

  const [servers, setServers] = useState<InfluxServerConfig[]>([]);
  const [activeServerId, setActiveServerId] = useState<string>('');

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

  const selectedRunId = selectedRunIds[0] || '';

  const loadRuns = async (preserveSelection = true) => {
    try {
      setLoadingRuns(true);
      setError('');
      const data = await api.getTestRuns();
      const safeData = data || [];
      setRuns(safeData);
      
      if (safeData.length > 0) {
        // Keep current selections if they still exist, otherwise select first run
        const stillExists = preserveSelection && selectedRunIds.filter(id => safeData.some(r => r.test_run_id === id));
        if (stillExists && stillExists.length > 0) {
          setSelectedRunIds(stillExists);
        } else {
          setSelectedRunIds([safeData[0].test_run_id]);
        }
      } else {
        setSelectedRunIds([]);
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

  const loadMetrics = async () => {
    if (selectedRunIds.length === 0) {
      setMultiPoints({});
      return;
    }
    try {
      setLoadingMetrics(true);
      const results: {[runId: string]: TelemetryPoint[]} = {};
      await Promise.all(
        selectedRunIds.map(async (runId) => {
          try {
            const data = await api.getRunMetrics(runId, metric, timeRange);
            results[runId] = data || [];
          } catch (err) {
            console.error(`Failed to load metrics for run ${runId}`, err);
            results[runId] = [];
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

  useEffect(() => {
    loadMetrics();
  }, [selectedRunIds, metric, timeRange, refreshTrigger]);

  const activeRun = runs.find(r => r.test_run_id === selectedRunId);

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
    const lines = Object.entries(multiPoints).map(([runId, pts], runIndex) => {
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
        runId,
        pointsList,
        path,
        color
      };
    });

    return { lines, gridY };
  };

  const chart = getChartData();
  const allValues = Object.values(multiPoints).flatMap(pts => pts.map(p => p.value));
  const avgValue = allValues.length > 0 ? (allValues.reduce((a, b) => a + b, 0) / allValues.length).toFixed(1) : '0';
  const maxValue = allValues.length > 0 ? Math.max(...allValues).toFixed(1) : '0';
  const minValue = allValues.length > 0 ? Math.min(...allValues).toFixed(1) : '0';

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
  runs.forEach(run => {
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

  const handleSelectRun = (runId: string) => {
    setSelectedRunIds([runId]);
  };

  const handleToggleRunCheckbox = (runId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    setSelectedRunIds(prev => {
      if (prev.includes(runId)) {
        return prev.filter(id => id !== runId);
      } else {
        return [...prev, runId];
      }
    });
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">{t('metricsTitle')}</h2>
          <p className="text-slate-400 text-sm mt-1">
            {t('metricsSub')}
          </p>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          {servers.length > 0 && (
            <select
              value={activeServerId}
              onChange={(e) => handleServerChange(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-300 hover:text-white px-3 py-2 rounded-xl text-xs transition cursor-pointer outline-none focus:border-purple-500/50"
            >
              {servers.map((srv) => (
                <option key={srv.id} value={srv.id}>
                  {srv.name}
                </option>
              ))}
            </select>
          )}

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

          {loadingRuns ? (
            <div className="py-12 text-slate-500 text-center text-xs">Loading...</div>
          ) : error ? (
            <div className="py-8 px-4 text-center text-red-400 bg-red-500/5 border border-red-500/10 rounded-2xl space-y-2">
              <p className="text-xs font-semibold">{error}</p>
              <p className="text-[10px] text-slate-500 max-w-[200px] mx-auto">
                Make sure InfluxDB is port-forwarded and correctly configured in settings.
              </p>
            </div>
          ) : runs.length === 0 ? (
            <div className="py-12 text-slate-500 text-center text-xs">{t('chartNoData')}</div>
          ) : (
            <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1">
              {Object.entries(groupedRuns).map(([baseName, groupRuns]) => {
                const isExpanded = !!expandedGroups[baseName];
                const selectedInGroup = groupRuns.filter(r => selectedRunIds.includes(r.test_run_id));
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
                          const isSelected = selectedRunIds.includes(run.test_run_id);
                          return (
                            <div
                              key={run.test_run_id}
                              onClick={() => handleSelectRun(run.test_run_id)}
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
                                    onChange={(e) => handleToggleRunCheckbox(run.test_run_id, e)}
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
          {selectedRunIds.length > 0 ? (
            <>
              {/* Header metrics filters */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-white truncate">
                    {selectedRunIds.length === 1 ? selectedRunId : `Comparing ${selectedRunIds.length} Runs`}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t('telemetry')}
                  </p>
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
                  </div>
                </div>
              </div>

              {/* Stats panel widgets */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { name: t('valMax'), value: `${maxValue}${metric === 'vus' ? '' : ' ms'}`, icon: TrendingUp, color: 'text-pink-400 border-pink-500/10' },
                  { name: t('valAvg'), value: `${avgValue}${metric === 'vus' ? '' : ' ms'}`, icon: BarChart3, color: 'text-purple-400 border-purple-500/10' },
                  { name: t('valMin'), value: `${minValue}${metric === 'vus' ? '' : ' ms'}`, icon: ArrowDownWideNarrow, color: 'text-blue-400 border-blue-500/10' }
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
              {selectedRunIds.length > 1 && (
                <div className="flex flex-wrap gap-3 p-3.5 bg-slate-950/40 border border-slate-850 rounded-2xl text-[10px]">
                  {chart.lines.map((line) => (
                    <div key={line.runId} className="flex items-center space-x-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: line.color.stroke }} />
                      <span className="text-slate-300 font-medium truncate max-w-[180px]" title={line.runId}>
                        {line.runId}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Responsive SVG Chart */}
              <div className="relative bg-slate-950/60 rounded-2xl p-4 border border-slate-900 overflow-hidden flex-1 min-h-[300px] flex items-center justify-center">
                {loadingMetrics ? (
                  <div className="text-slate-500 text-sm">{t('chartLoading')}</div>
                ) : chart.lines.length === 0 ? (
                  <div className="text-slate-500 text-sm">{t('chartNoData')}</div>
                ) : (
                  <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-full text-slate-600">
                    <defs>
                      {chart.lines.map((line) => (
                        <linearGradient key={line.runId} id={`chartGradient-${line.color.id}`} x1="0" y1="0" x2="0" y2="1">
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
                          {g.val.toFixed(0)}
                        </text>
                      </g>
                    ))}

                    {/* Gradients under curves */}
                    {chart.lines.map((line) => (
                      line.pointsList.length > 0 && (
                        <path
                          key={`grad-${line.runId}`}
                          d={`${line.path} L ${line.pointsList[line.pointsList.length - 1].x} ${svgHeight - padding} L ${line.pointsList[0].x} ${svgHeight - padding} Z`}
                          fill={`url(#chartGradient-${line.color.id})`}
                        />
                      )
                    ))}

                    {/* Main smooth curves */}
                    {chart.lines.map((line) => (
                      <path
                        key={`path-${line.runId}`}
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
                          key={`${line.runId}-dot-${idx}`}
                          cx={pt.x}
                          cy={pt.y}
                          r="3"
                          fill="#0F172A"
                          stroke={line.color.stroke}
                          strokeWidth="1.5"
                          className="hover:r-4 cursor-pointer transition-all"
                        >
                          <title>{`Run: ${line.runId}\nTime: ${pt.timestamp}\nValue: ${pt.value.toFixed(1)}`}</title>
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
