'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Tableau de bord' },
  { href: '/products', label: 'Produits' },
  { href: '/customers', label: 'Clients' },
];

const ADMIN_NAV = [
  { href: '/admin/tenants', label: 'Tenants' },
];

export function Sidebar() {
  const pathname = usePathname();
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
          Administration
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
