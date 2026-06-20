'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  Server, 
  Activity, 
  CheckCircle2, 
  Plus, 
  Database,
  ArrowUpRight,
  ShieldCheck
} from 'lucide-react';
import { api, ClusterConfig } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';

export default function DashboardPage() {
  const { t, lang } = usePreferences();
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [operatorStatus, setOperatorStatus] = useState<{ status: 'ready' | 'degraded' | 'unavailable'; accessible_count: number; deployed_count: number; total_count: number } | null>(null);
  const [loadingOperator, setLoadingOperator] = useState(true);
  const [activeTests, setActiveTests] = useState<{ active_count: number; first_active: string }>({ active_count: 0, first_active: 'None' });
  const [loadingActiveTests, setLoadingActiveTests] = useState(true);
  const [influxRunsCount, setInfluxRunsCount] = useState<string>('...');
  const [influxStatus, setInfluxStatus] = useState<'online' | 'offline' | 'checking'>('checking');

  const fetchClusters = async () => {
    try {
      setLoading(true);
      const data = await api.getClusters();
      setClusters(data || []);
    } catch (err: any) {
      setError(t('k8sLoadError'));
    } finally {
      setLoading(false);
    }
  };

  const fetchOperatorStatus = async () => {
    try {
      setLoadingOperator(true);
      const data = await api.getOperatorStatus();
      setOperatorStatus(data);
    } catch (err) {
      console.error('Failed to load operator status', err);
    } finally {
      setLoadingOperator(false);
    }
  };

  const fetchActiveTests = async () => {
    try {
      setLoadingActiveTests(true);
      const data = await api.getActiveTests();
      setActiveTests(data);
    } catch (err) {
      console.error('Failed to load active tests count', err);
    } finally {
      setLoadingActiveTests(false);
    }
  };

  const fetchInfluxRuns = async () => {
    try {
      setInfluxStatus('checking');
      const runs = await api.getTestRuns();
      setInfluxRunsCount((runs || []).length.toString());
      setInfluxStatus('online');
    } catch (err) {
      console.error('Failed to fetch test runs from InfluxDB', err);
      setInfluxRunsCount(t('notAvailable'));
      setInfluxStatus('offline');
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const role = localStorage.getItem('role');
      setIsAdmin(role === 'administrator');
    }
    fetchClusters();
    fetchOperatorStatus();
    fetchActiveTests();
    fetchInfluxRuns();
  }, []);

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Page Title & Add Button */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">{t('dashboard')}</h2>
          <p className="text-slate-400 text-sm mt-1">
            {t('subWelcome')}
          </p>
        </div>
        
        {isAdmin && (
          <Link
            href="/settings"
            className="flex items-center space-x-2 px-5 py-3 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white rounded-xl font-semibold shadow-lg shadow-purple-500/10 hover:shadow-purple-500/25 transition-all duration-300 text-sm hover:scale-102 active:scale-98 shrink-0 cursor-pointer"
          >
            <Plus className="w-4.5 h-4.5" />
            <span>{t('addCluster')}</span>
          </Link>
        )}
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { title: t('totalClusters'), value: clusters.length, sub: t('operational'), icon: Server, color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
          { title: t('k6SuccessRate'), value: '99.8%', sub: t('period24h'), icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
          { 
            title: t('activeTests'), 
            value: loadingActiveTests ? '...' : activeTests.active_count.toString(), 
            sub: loadingActiveTests ? t('checking') : (activeTests.active_count > 0 ? activeTests.first_active : t('noneRunning')), 
            icon: Activity, 
            color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' 
          },
          { 
            title: t('influxTelemetries'), 
            value: influxStatus === 'offline' ? t('errorLabel') : influxRunsCount, 
            sub: influxStatus === 'offline' ? t('connectionFailed') : t('recentRuns'), 
            icon: Database, 
            color: influxStatus === 'offline' 
              ? 'text-red-400 bg-red-500/10 border-red-500/20' 
              : 'text-blue-400 bg-blue-500/10 border-blue-500/20' 
          }
        ].map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md relative overflow-hidden group hover:border-slate-700 transition-all duration-300">
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-white/5 to-transparent rounded-bl-full pointer-events-none" />
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <span className="text-xs text-slate-500 font-medium">{stat.title}</span>
                  <h3 className="text-3xl font-extrabold text-white">{stat.value}</h3>
                  <span className="text-[11px] text-slate-400 flex items-center space-x-1">
                    <span>{stat.sub}</span>
                  </span>
                </div>
                <div className={`p-3 rounded-xl border ${stat.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Grid: Clusters & Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Clusters List */}
        <div className="lg:col-span-2 bg-slate-900/30 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white">{t('registeredK8sClusters')}</h3>
            <span className="text-xs text-slate-500 font-medium">{clusters.length} {t('totalLabel')}</span>
          </div>

          {loading ? (
            <div className="py-12 text-center text-slate-500 text-sm">{t('loading')}</div>
          ) : error ? (
            <div className="py-12 text-center text-red-400 text-sm">{error}</div>
          ) : clusters.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">{t('noClusters')}</div>
          ) : (
            <div className="space-y-4">
              {clusters.map((cluster) => (
                <div 
                  key={cluster.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-5 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition-all duration-300 gap-4"
                >
                  <div className="flex items-start space-x-4">
                    <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
                      <Server className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white text-sm flex items-center gap-2">
                        {cluster.name}
                      </h4>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">{cluster.api_server_url}</p>
                      <div className="flex items-center space-x-3 mt-2 text-[10px] text-slate-400">
                        <span className="flex items-center space-x-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-emerald-400">{t('connected')}</span>
                        </span>
                        <span>•</span>
                        <span>{t('authLabel')}: <strong className="uppercase">{cluster.auth_type}</strong></span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Platform Status / Quick Docs */}
        <div className="bg-slate-900/30 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md space-y-6">
          <h3 className="text-lg font-bold text-white">{t('operatorStatus')}</h3>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-900/40 rounded-xl border border-slate-800/80">
              <div className="flex items-center space-x-3">
                <span className={`w-2.5 h-2.5 rounded-full ${
                  loadingOperator ? 'bg-slate-600 animate-pulse' :
                  !operatorStatus ? 'bg-slate-600' :
                  operatorStatus.status === 'ready' ? 'bg-emerald-500' :
                  operatorStatus.status === 'degraded' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
                }`} />
                <div>
                  <span className="text-sm font-semibold text-slate-200 block">{t('k6OperatorLabel')}</span>
                  {operatorStatus && (
                    <span className="text-[10px] text-slate-500 block font-mono">
                      {t('activeCountLabel')} {operatorStatus.deployed_count}/{operatorStatus.total_count}
                    </span>
                  )}
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-md border ${
                loadingOperator ? 'text-slate-500 bg-slate-500/10 border-slate-500/25' :
                !operatorStatus ? 'text-slate-500 bg-slate-500/10 border-slate-500/25' :
                operatorStatus.status === 'ready' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25' :
                operatorStatus.status === 'degraded' ? 'text-amber-400 bg-amber-400/10 border-amber-400/25' : 
                'text-red-400 bg-red-400/10 border-red-400/25'
              }`}>
                {loadingOperator ? t('checking') :
                 !operatorStatus ? t('operatorUnknown') :
                 operatorStatus.status === 'ready' ? t('operatorReady') :
                 operatorStatus.status === 'degraded' ? t('operatorDegraded') : t('operatorOffline')}
              </span>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-900/40 rounded-xl border border-slate-800/80">
              <div className="flex items-center space-x-3">
                <span className={`w-2.5 h-2.5 rounded-full ${
                  influxStatus === 'online' ? 'bg-emerald-500' :
                  influxStatus === 'checking' ? 'bg-slate-600 animate-pulse' : 'bg-red-500'
                }`} />
                <span className="text-sm font-semibold text-slate-200">{t('influxdbService')}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-md border ${
                influxStatus === 'online' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25' :
                influxStatus === 'checking' ? 'text-slate-500 bg-slate-500/10 border-slate-500/25' :
                'text-red-400 bg-red-400/10 border-red-400/25'
              }`}>
                {influxStatus === 'online' ? t('online') : influxStatus === 'checking' ? t('checking') : t('offline')}
              </span>
            </div>
          </div>

          <div className="p-4 bg-purple-500/5 border border-purple-500/10 rounded-xl space-y-2">
            <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider">{t('recommendations')}</h4>
            <p className="text-xs text-slate-400 leading-normal">
              {t('recDesc')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
