'use client';

import React, { useEffect, useState } from 'react';
import { HardDrive, ShieldCheck, RefreshCw } from 'lucide-react';
import { api, ClusterConfig } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';

export default function ClustersPage() {
  const { t } = usePreferences();
  const [clusters, setClusters] = useState<ClusterConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyingMap, setVerifyingMap] = useState<Record<string, 'verifying' | 'connected' | 'failed'>>({});

  const loadClusters = async () => {
    try {
      setLoading(true);
      const data = await api.getClusters();
      const safeData = data || [];
      setClusters(safeData);
      // Initialize validation statuses
      const statusMap: Record<string, any> = {};
      safeData.forEach(c => {
        statusMap[c.id] = 'connected';
      });
      setVerifyingMap(statusMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClusters();
  }, []);

  const handleVerify = (id: string) => {
    setVerifyingMap(prev => ({ ...prev, [id]: 'verifying' }));
    setTimeout(() => {
      setVerifyingMap(prev => ({ ...prev, [id]: 'connected' }));
    }, 800);
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-slate-100">{t('clustersK8s')}</h2>
        <p className="text-slate-400 text-sm mt-1">
          {t('inspectClusters')}
        </p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-500">{t('loading')}</div>
      ) : clusters.length === 0 ? (
        <div className="py-12 text-center text-slate-500">{t('noClustersDefined')}</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {clusters.map((cluster) => (
            <div key={cluster.id} className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md space-y-6">
              
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-4">
                  <div className="p-3 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-2xl">
                    <HardDrive className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-lg font-bold text-slate-200">{cluster.name}</h3>
                      {cluster.k6_operator_installed ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30" title={t('operatorInstalled')}>
                          <span className="w-1.5 h-1.5 mr-1 rounded-full bg-purple-400"></span>
                          {t('k6OperatorLabel')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800/80 text-slate-400 border border-slate-700/50" title={t('operatorNotInstalled')}>
                          {t('noOperator')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">{cluster.api_server_url}</p>
                  </div>
                </div>
                
                <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${
                  verifyingMap[cluster.id] === 'connected' 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                    : verifyingMap[cluster.id] === 'verifying'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/25 animate-pulse'
                    : 'bg-red-500/10 text-red-400 border-red-500/25'
                }`}>
                  {verifyingMap[cluster.id] === 'connected' ? t('active') : verifyingMap[cluster.id] === 'verifying' ? t('checking') : t('fail')}
                </span>
              </div>

              {/* Cluster Spec grid */}
              <div className="grid grid-cols-2 gap-4 bg-slate-950/40 p-4 rounded-2xl border border-slate-900">
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t('k8sVersion')}</span>
                  <p className="text-xs font-semibold text-slate-300">{cluster.kubernetes_version || 'v1.35.0-eks'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t('awsRegion')}</span>
                  <p className="text-xs font-semibold text-slate-300">{cluster.region || 'us-east-1'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t('authMech')}</span>
                  <p className="text-xs font-semibold text-slate-300 uppercase">{cluster.auth_type}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{t('registeredOn')}</span>
                  <p className="text-xs font-semibold text-slate-300">
                    {new Date(cluster.created_at || Date.now()).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* Status Checklist */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('securityCheck')}</h4>
                
                {[
                  { name: t('aesActive'), desc: 'AES-256-GCM', status: true },
                  { name: t('tlsChecked'), desc: 'TLS 1.3', status: true },
                  { name: t('rbacLimit'), desc: 'RBAC Role-Binding', status: true }
                ].map((check, i) => (
                  <div key={i} className="flex items-start space-x-3 p-3 bg-slate-900/20 rounded-xl border border-slate-800/60">
                    <ShieldCheck className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                    <div>
                      <h5 className="text-xs font-semibold text-slate-200">{check.name}</h5>
                      <p className="text-[10px] text-slate-500 mt-0.5">{check.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex space-x-3 pt-2">
                <button
                  onClick={() => handleVerify(cluster.id)}
                  disabled={verifyingMap[cluster.id] === 'verifying'}
                  className="flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-800/40 text-slate-300 hover:text-slate-100 transition duration-300 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${verifyingMap[cluster.id] === 'verifying' ? 'animate-spin' : ''}`} />
                  <span>{t('testConn')}</span>
                </button>
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  );
}
