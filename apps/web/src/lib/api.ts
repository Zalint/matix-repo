'use client';

import type { AuthState } from './auth-context';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

/**
 * Wrapper fetch typé. Selon le mode auth :
 *   - dev      → headers X-Dev-Tenant-Id / X-Dev-User-Id
 *   - keycloak → Authorization: Bearer <accessToken>
 */
async function apiFetch<T>(auth: AuthState, path: string, init: RequestInit = {}): Promise<T> {
  if (!auth.ready) throw new ApiError(401, null, 'Auth not ready');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };

  if (auth.mode === 'dev') {
    headers['X-Dev-Tenant-Id'] = auth.tenantId;
    headers['X-Dev-User-Id'] = auth.userId;
  } else {
    headers['Authorization'] = `Bearer ${auth.accessToken}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, body, body?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

// ---- Types ----
export type Product = {
  id: string;
  sku: string;
  name: string;
  unit_price: string;
  created_at: string;
  updated_at: string;
};

export type Customer = {
  id: string;
  code: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  segment: string | null;
  credit_limit: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ---- Endpoints ----
export const api = {
  products: {
    list: (a: AuthState) => apiFetch<Product[]>(a, '/products'),
    create: (a: AuthState, body: { sku: string; name: string; unit_price: number }) =>
      apiFetch<Product>(a, '/products', { method: 'POST', body: JSON.stringify(body) }),
    update: (a: AuthState, id: string, body: Partial<{ name: string; unit_price: number }>) =>
      apiFetch<Product>(a, `/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (a: AuthState, id: string) =>
      apiFetch<void>(a, `/products/${id}`, { method: 'DELETE' }),
  },
  customers: {
    list: (a: AuthState, search?: string) =>
      apiFetch<Customer[]>(a, `/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    create: (a: AuthState, body: Partial<Customer> & { code: string; display_name: string }) =>
      apiFetch<Customer>(a, '/customers', { method: 'POST', body: JSON.stringify(body) }),
    update: (a: AuthState, id: string, body: Partial<Customer>) =>
      apiFetch<Customer>(a, `/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (a: AuthState, id: string) =>
      apiFetch<void>(a, `/customers/${id}`, { method: 'DELETE' }),
  },
};
