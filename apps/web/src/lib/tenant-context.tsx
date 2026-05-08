'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Phase 0 — gestion du tenant courant en mode dev.
 * Stocké en localStorage. Phase 1 : remplacé par claim JWT Keycloak.
 *
 * Les UUIDs ci-dessous correspondent aux tenants de seed (db/seed.sql).
 */
export type DevTenant = {
  id: string;
  userId: string;
  label: string;
};

export const DEV_TENANTS: DevTenant[] = [
  {
    id: 'a1111111-1111-4111-8111-111111111111',
    userId: 'a1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    label: 'Acme SARL',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222222',
    userId: 'b2222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    label: 'Beta SUARL',
  },
];

type TenantCtx = {
  current: DevTenant;
  setCurrent: (t: DevTenant) => void;
  ready: boolean;
};

const Ctx = createContext<TenantCtx | null>(null);

const STORAGE_KEY = 'matix.dev.tenantId';

export function TenantProvider({ children }: { children: ReactNode }) {
  const [current, setCurrentState] = useState<DevTenant>(DEV_TENANTS[0]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved) {
      const found = DEV_TENANTS.find((t) => t.id === saved);
      if (found) setCurrentState(found);
    }
    setReady(true);
  }, []);

  const setCurrent = (t: DevTenant) => {
    setCurrentState(t);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, t.id);
  };

  return <Ctx.Provider value={{ current, setCurrent, ready }}>{children}</Ctx.Provider>;
}

export function useTenant() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTenant must be used inside TenantProvider');
  return ctx;
}
