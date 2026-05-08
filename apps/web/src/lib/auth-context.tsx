'use client';

import { SessionProvider, useSession, signOut as nextSignOut } from 'next-auth/react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const AUTH_MODE = (process.env.NEXT_PUBLIC_AUTH_MODE ?? 'dev') as 'dev' | 'keycloak';

// ============================================================================
// Types unifiés
// ============================================================================

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

export type AuthState =
  | {
      ready: false;
      mode: 'dev' | 'keycloak';
    }
  | {
      ready: true;
      mode: 'dev';
      tenantId: string;
      userId: string;
      tenantLabel: string;
      switchTenant: (t: DevTenant) => void;
      availableTenants: DevTenant[];
    }
  | {
      ready: true;
      mode: 'keycloak';
      tenantId: string;
      userId: string;
      userEmail?: string;
      accessToken: string;
      tenantIds: string[];
      signOut: () => Promise<void>;
    };

const Ctx = createContext<AuthState | null>(null);

// ============================================================================
// Provider racine — SessionProvider en mode keycloak, simple bypass en dev
// ============================================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  if (AUTH_MODE === 'keycloak') {
    return (
      <SessionProvider>
        <KeycloakAuthBridge>{children}</KeycloakAuthBridge>
      </SessionProvider>
    );
  }
  return <DevAuthBridge>{children}</DevAuthBridge>;
}

// ============================================================================
// Bridge mode dev (dropdown localStorage)
// ============================================================================

const DEV_STORAGE_KEY = 'matix.dev.tenantId';

function DevAuthBridge({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<DevTenant>(DEV_TENANTS[0]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(DEV_STORAGE_KEY) : null;
    if (saved) {
      const found = DEV_TENANTS.find((t) => t.id === saved);
      if (found) setCurrent(found);
    }
    setReady(true);
  }, []);

  const value: AuthState = useMemo(() => {
    if (!ready) return { ready: false, mode: 'dev' };
    return {
      ready: true,
      mode: 'dev',
      tenantId: current.id,
      userId: current.userId,
      tenantLabel: current.label,
      availableTenants: DEV_TENANTS,
      switchTenant: (t: DevTenant) => {
        setCurrent(t);
        if (typeof window !== 'undefined') localStorage.setItem(DEV_STORAGE_KEY, t.id);
      },
    };
  }, [current, ready]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ============================================================================
// Bridge mode keycloak (lit la session NextAuth)
// ============================================================================

function KeycloakAuthBridge({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();

  const value: AuthState = useMemo(() => {
    if (status !== 'authenticated' || !session?.accessToken || !session.tenantId) {
      return { ready: false, mode: 'keycloak' };
    }

    const userIdFromToken = decodeSub(session.accessToken);
    return {
      ready: true,
      mode: 'keycloak',
      tenantId: session.tenantId,
      userId: userIdFromToken ?? '',
      userEmail: session.user?.email ?? undefined,
      accessToken: session.accessToken,
      tenantIds: session.tenantIds ?? [session.tenantId],
      signOut: async () => {
        await nextSignOut({ callbackUrl: '/login' });
      },
    };
  }, [session, status]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function decodeSub(token: string): string | null {
  try {
    const part = token.split('.')[1];
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    const json = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).sub ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Hook public
// ============================================================================

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function getAuthMode(): 'dev' | 'keycloak' {
  return AUTH_MODE;
}
