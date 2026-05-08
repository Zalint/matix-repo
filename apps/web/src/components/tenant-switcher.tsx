'use client';

import { DEV_TENANTS, useTenant } from '@/lib/tenant-context';

export function TenantSwitcher() {
  const { current, setCurrent } = useTenant();

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Tenant (dev)</span>
      <select
        value={current.id}
        onChange={(e) => {
          const found = DEV_TENANTS.find((t) => t.id === e.target.value);
          if (found) setCurrent(found);
        }}
        className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        {DEV_TENANTS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}
