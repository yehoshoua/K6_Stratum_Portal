'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, User, ShieldAlert, KeyRound, ArrowRight } from 'lucide-react';
import { api } from '@/services/api';
import { usePreferences } from '@/components/PreferencesContext';

export default function LoginPage() {
  const router = useRouter();
  const { t } = usePreferences();
  const [activeTab, setActiveTab] = useState<'local' | 'sso'>('local');
  
  // Local Form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // SSO status and redirection state
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoName, setSsoName] = useState('SSO');
  const [exchangeLoading, setExchangeLoading] = useState(false);

  // Legacy/Mock SSO form state
  const [ssoUser, setSsoUser] = useState('sso-admin');
  const [ssoEmail, setSsoEmail] = useState('sso-admin@company.com');

  useEffect(() => {
    // Check if real OIDC SSO is enabled on backend
    api.getSSOStatus().then(res => {
      setSsoEnabled(res.enabled);
      if (res.name) {
        setSsoName(res.name);
      }
      if (res.enabled) {
        setActiveTab('sso');
      }
    }).catch(err => console.error(err));

    // Handle OIDC callback code in URL parameters
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) {
        setExchangeLoading(true);
        setError('');
        api.exchangeSSOCode(code)
          .then(() => {
            router.push('/');
          })
          .catch(err => {
            setError(err.message || 'SSO OIDC exchange failed');
          })
          .finally(() => {
            setExchangeLoading(false);
          });
      }
    }
  }, []);

  const handleLocalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.login(username, password);
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleRealSSOLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.getSSOAuthorizeUrl();
      if (res && res.url) {
        window.location.href = res.url;
      } else {
        throw new Error('Could not retrieve OIDC authorization endpoint');
      }
    } catch (err: any) {
      setError(err.message || 'OIDC redirect failed');
      setLoading(false);
    }
  };

  const handleSSOSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.loginSSO(ssoUser, ssoEmail);
      router.push('/');
    } catch (err: any) {
      setError('SSO connection failed');
    } finally {
      setLoading(false);
    }
  };

  if (exchangeLoading) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-purple-600/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-pink-500/15 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl relative z-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center font-bold text-white shadow-xl shadow-purple-500/20 text-xl mx-auto animate-pulse">
            K6
          </div>
          <h2 className="text-xl font-bold text-white">OIDC Authentication</h2>
          <p className="text-slate-400 text-xs animate-pulse">Exchanging authorization code for dashboard session...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background gradients */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-purple-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-pink-500/15 rounded-full blur-[120px] pointer-events-none" />

      {/* Main card */}
      <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl relative z-10 animate-fadeIn">
        
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center font-bold text-white shadow-xl shadow-purple-500/20 text-xl mb-3">
            K6
          </div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            {t('welcome')}
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            {t('subWelcome')}
          </p>
        </div>

        {/* Tab Buttons */}
        {ssoEnabled && (
          <div className="flex bg-slate-950 p-1.5 rounded-2xl mb-6 border border-slate-800/80">
            <button
              type="button"
              onClick={() => setActiveTab('local')}
              className={`flex-1 py-2.5 text-xs font-semibold rounded-xl transition-all duration-300 ${
                activeTab === 'local'
                  ? 'bg-slate-800 text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t('localLogin')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sso')}
              className={`flex-1 py-2.5 text-xs font-semibold rounded-xl transition-all duration-300 ${
                activeTab === 'sso'
                  ? 'bg-slate-800 text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {ssoName} Login
            </button>
          </div>
        )}

        {/* Error alert */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center space-x-3 text-red-400 text-xs animate-shake">
            <ShieldAlert className="w-4.5 h-4.5 shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        {/* Local authentication form */}
        {(activeTab === 'local' || !ssoEnabled) && (
          <form onSubmit={handleLocalSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('username')}</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  required
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800 hover:border-slate-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 rounded-2xl py-3 pl-11 pr-4 text-sm text-slate-200 placeholder-slate-600 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('password')}</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800 hover:border-slate-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 rounded-2xl py-3 pl-11 pr-4 text-sm text-slate-200 placeholder-slate-600 outline-none transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white font-semibold py-3 px-4 rounded-2xl transition-all duration-300 shadow-lg shadow-purple-500/10 active:scale-98 text-sm cursor-pointer disabled:opacity-50"
            >
              {loading ? '...' : t('login')}
            </button>

            <div className="mt-4 p-3 bg-purple-500/5 border border-purple-500/10 rounded-xl flex items-start space-x-2.5 text-[11px] text-purple-400">
              <KeyRound className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>Local database accounts:</strong> use local users registered under the settings console.
              </span>
            </div>
          </form>
        )}

        {/* SSO authentication form */}
        {activeTab === 'sso' && ssoEnabled && (
          <div className="space-y-4 animate-fadeIn">
            {ssoEnabled ? (
              <div className="text-center py-4 space-y-4">
                <p className="text-xs text-slate-400">{ssoName} is configured. Click below to redirect to OIDC provider login.</p>
                <button
                  onClick={handleRealSSOLogin}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white font-semibold py-3.5 px-4 rounded-2xl transition-all duration-300 shadow-lg active:scale-98 text-sm cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-2"
                >
                  <span>Launch {ssoName} Login</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <form onSubmit={handleSSOSubmit} className="space-y-4">
                <div className="p-4 bg-slate-950 border border-slate-800/80 rounded-2xl space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">SSO User Name</label>
                    <input
                      type="text"
                      required
                      value={ssoUser}
                      onChange={(e) => setSsoUser(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-purple-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Email</label>
                    <input
                      type="email"
                      required
                      value={ssoEmail}
                      onChange={(e) => setSsoEmail(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-purple-500/50"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 px-4 rounded-2xl border border-slate-700 transition-all duration-300 shadow-md active:scale-98 text-sm cursor-pointer disabled:opacity-50"
                >
                  {t('ssoLogin')}
                </button>
              </form>
            )}
          </div>
        )}

      </div>
    </main>
  );
}

