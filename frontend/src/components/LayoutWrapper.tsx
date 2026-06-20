'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import { usePreferences } from './PreferencesContext';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, t } = usePreferences();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    
    if (!token && pathname !== '/login') {
      setIsAuthenticated(false);
      router.push('/login');
    } else {
      setIsAuthenticated(true);
      if (token && pathname === '/login') {
        router.push('/');
      }
    }
  }, [pathname, router]);

  // Loading state while verifying auth
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-medium text-sm">
        {t('portalLoading')}
      </div>
    );
  }

  // Login page layout (no sidebar, no wrapper)
  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100" dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-slate-900 bg-slate-900/40 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-30">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold px-2.5 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-full">
              {t('activeAgent')}
            </span>
            <span className="text-[11px] text-slate-500">•</span>
            <span className="text-xs text-slate-400">
              {t('secureSession')}
            </span>
          </div>
          <div className="text-xs text-slate-500">
            {t('syncTime')} : {new Date().toLocaleTimeString(lang)}
          </div>
        </header>
        <main className="flex-1 p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
