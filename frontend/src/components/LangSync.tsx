'use client';

import { useEffect } from 'react';
import { usePreferences } from './PreferencesContext';

/** Syncs document lang and dir with user language preference. */
export default function LangSync() {
  const { lang } = usePreferences();

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  }, [lang]);

  return null;
}
