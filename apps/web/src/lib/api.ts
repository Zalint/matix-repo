'use client';

import { DEV_TENANTS, type DevTenant } from './tenant-context';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

/**
 * Wrapper fetch typé. Phase 0 : ajoute les headers X-Dev-* depuis le tenant courant.
 * Phase 1 : remplacé par un Authorization: Bearer <jwt> Keycloak.
 */
async function apiFetch<T>(
  tenant: DevTenant,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Dev-Tenant-Id': tenant.id,
      'X-Dev-User-Id': tenant.userId,
      ...(init.headers ?? {}),
    },
  });

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
    list: (t: DevTenant) => apiFetch<Product[]>(t, '/products'),
    create: (t: DevTenant, body: { sku: string; name: string; unit_price: number }) =>
      apiFetch<Product>(t, '/products', { method: 'POST', body: JSON.stringify(body) }),
    update: (t: DevTenant, id: string, body: Partial<{ name: string; unit_price: number }>) =>
      apiFetch<Product>(t, `/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (t: DevTenant, id: string) =>
      apiFetch<void>(t, `/products/${id}`, { method: 'DELETE' }),
  },
  customers: {
    list: (t: DevTenant, search?: string) =>
      apiFetch<Customer[]>(t, `/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    create: (t: DevTenant, body: Partial<Customer> & { code: string; display_name: string }) =>
      apiFetch<Customer>(t, '/customers', { method: 'POST', body: JSON.stringify(body) }),
    update: (t: DevTenant, id: string, body: Partial<Customer>) =>
      apiFetch<Customer>(t, `/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (t: DevTenant, id: string) =>
      apiFetch<void>(t, `/customers/${id}`, { method: 'DELETE' }),
  },
};

export { DEV_TENANTS };
