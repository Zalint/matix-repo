'use client';

import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from '@/i18n/config';

export function LocaleSwitcher() {
  const current = useLocale() as Locale;
  const [pending, startTransition] = useTransition();

  function changeLocale(next: Locale) {
    if (next === current) return;
    startTransition(async () => {
      await fetch('/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: next }),
      });
      // Reload pour que le RSC layout recharge les messages
      window.location.reload();
    });
  }

  return (
    <select
      value={current}
      disabled={pending}
      onChange={(e) => changeLocale(e.target.value as Locale)}
      className="h-9 rounded-md border border-gray-300 bg-white px-2 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      aria-label="Language"
    >
      {SUPPORTED_LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
