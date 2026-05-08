'use client';

import { useAuth } from '@/lib/auth-context';
import { Button } from './ui/button';

export function TenantSwitcher() {
  const auth = useAuth();
  if (!auth.ready) return null;

  if (auth.mode === 'dev') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Tenant (dev)</span>
        <select
          value={auth.tenantId}
          onChange={(e) => {
            const found = auth.availableTenants.find((t) => t.id === e.target.value);
            if (found) auth.switchTenant(found);
          }}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {auth.availableTenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // keycloak mode — affiche user + tenant + logout
  return (
    <div className="flex items-center gap-3">
      <div className="text-right text-xs leading-tight">
        <div className="text-gray-700">{auth.userEmail ?? 'Utilisateur'}</div>
        <div className="font-mono text-[10px] text-gray-400">tenant: {auth.tenantId.slice(0, 8)}…</div>
      </div>
      <Button size="sm" variant="secondary" onClick={() => auth.signOut()}>
        Déconnexion
      </Button>
    </div>
  );
}
