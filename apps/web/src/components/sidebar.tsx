'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const NAV = [
    { href: '/dashboard', label: t('dashboard') },
    { href: '/products', label: t('products') },
    { href: '/customers', label: t('customers') },
    { href: '/sales', label: 'Ventes' },
  ];
  const OPERATIONS_NAV = [
    { href: '/operations/inventory', label: 'Stock' },
    { href: '/operations/inventory/daily', label: 'Stock soir (saisie)' },
    { href: '/operations/reconciliation', label: 'Réconciliation' },
  ];
  const SETTINGS_NAV = [
    { href: '/settings/team', label: 'Équipe' },
    { href: '/settings/licensing', label: 'Modules & licences' },
    { href: '/settings/workflows', label: 'Workflows' },
  ];
  const ADMIN_NAV = [
    { href: '/admin/tenants', label: t('tenants') },
    { href: '/admin/workflows', label: 'Workflows (admin)' },
  ];
  return (
    <aside className="w-56 shrink-0 border-r border-gray-200 bg-white">
      <div className="px-4 py-5">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-brand-600 text-white grid place-items-center font-bold">M</div>
          <span className="text-lg font-semibold">Matix</span>
        </Link>
      </div>
      <nav className="px-2">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'block rounded-md px-3 py-2 text-sm font-medium',
                active ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-100',
              )}
            >
              {item.label}
            </Link>
          );
        })}

        <div className="mt-6 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Opérations
        </div>
        {OPERATIONS_NAV.map((item) => {
          // Match strictement la route + sous-routes du SEGMENT, sinon
          // /operations/inventory resterait actif sur /operations/inventory/daily.
          const active =
            pathname === item.href ||
            // sous-route uniquement si pas un autre item plus precis ne match
            (pathname?.startsWith(item.href + '/') &&
              !OPERATIONS_NAV.some(
                (other) =>
                  other.href !== item.href &&
                  other.href.startsWith(item.href + '/') &&
                  pathname?.startsWith(other.href),
              ));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'block rounded-md px-3 py-2 text-sm font-medium',
                active ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-100',
              )}
            >
              {item.label}
            </Link>
          );
        })}

        <div className="mt-6 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Paramètres
        </div>
        {SETTINGS_NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'block rounded-md px-3 py-2 text-sm font-medium',
                active ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-100',
              )}
            >
              {item.label}
            </Link>
          );
        })}

        <div className="mt-6 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          {t('administration')}
        </div>
        {ADMIN_NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'block rounded-md px-3 py-2 text-sm font-medium',
                active ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-100',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
