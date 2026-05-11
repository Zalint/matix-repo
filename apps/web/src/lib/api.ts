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
export type StockMode = 'manuel' | 'automatique';

export type Product = {
  id: string;
  sku: string;
  name: string;
  unit_price: string;
  /** Override explicite du prix gros. NULL = utilise le rabais tenant (calculé serveur). */
  unit_price_gros: string | null;
  /** Si false, le produit n'a pas d'option vente en gros (pas de toggle POS). */
  gros_enabled: boolean;
  /**
   * Prix gros effectif appliqué :
   *  - null si gros_enabled=false
   *  - unit_price_gros si override
   *  - sinon max(0, unit_price - tenant.default_gros_rebate_xof)
   * Calculé par l'API, pas modifiable directement.
   */
  effective_gros_price: string | null;
  category_id: string | null;
  stock_mode: StockMode;
  created_at: string;
  updated_at: string;
};

export type TenantSettings = {
  tenant_id: string;
  default_gros_rebate_xof: number;
};

export type Cutting = {
  id: string;
  point_of_sale_id: string;
  performed_at: string;
  source_product_id: string;
  source_quantity: number;
  total_outputs: number;
  waste_quantity: number;
  waste_pct: number;
  performed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  outputs: CuttingOutput[];
};

export type CuttingOutput = {
  id: string;
  cutting_id: string;
  product_id: string;
  quantity: number;
  unit_cost: number | null;
  created_at: string;
};

export type CuttingYieldStat = {
  source_product_id: string;
  source_sku: string;
  source_name: string;
  cuttings_count: number;
  source_total: number;
  outputs_total: number;
  waste_total: number;
  yield_pct: number;
};

export type DailyClosingView = {
  product: {
    id: string;
    sku: string;
    name: string;
    stock_mode: StockMode;
    category_id: string | null;
    category_name: string | null;
    category_family: string | null;
  };
  point_of_sale: {
    id: string;
    code: string;
    name: string;
  };
  figures: {
    stock_matin: number;
    ventes_qte: number;
    transferts_in: number;
    transferts_out: number;
    adjustments: number;
    retours: number;
    stock_theorique: number;
  };
  closing: {
    id: string;
    quantity: number;
    quantity_theorique: number;
    source: 'auto' | 'manual';
    last_auto_at: string | null;
    set_at: string;
  } | null;
};

export type DailyClosingRecord = {
  id: string;
  closing_date: string;
  point_of_sale_id: string;
  product_id: string;
  quantity: string;
  quantity_theorique: string;
  source: 'auto' | 'manual';
  last_auto_at: string | null;
  set_by: string | null;
  set_at: string;
};

export type ReconciliationNote = {
  id: string;
  note_date: string;
  point_of_sale_id: string;
  body: string;
  set_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductCategory = {
  id: string;
  code: string;
  name: string;
  family: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type DailyStats = {
  date: string;
  transactions: number;
  orders: number;
  revenue: string;
  items_sold: string;
  by_method: Array<{ method: string; count: number; amount: string }>;
};

export type SaleLineRow = {
  sale_id: string;
  sale_item_id: string;
  reference_number: string | null;
  date: string;
  point_of_sale_id: string;
  point_of_sale_name: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  product_id: string;
  product_name: string;
  category_id: string | null;
  category_name: string | null;
  unit_price: string;
  quantity: string;
  line_total: string;
  is_credit: boolean;
};

export type Tenant = {
  id: string;
  slug: string;
  legal_name: string;
  status: 'trial' | 'active' | 'suspended' | 'churned';
  country_code: string;
  currency: string;
  locale: string;
  created_at: string;
};

export type ProvisionTenantInput = {
  slug: string;
  legal_name: string;
  country_code?: string;
  currency?: string;
  ninea?: string;
  rc?: string;
  owner: {
    email: string;
    first_name: string;
    last_name: string;
    password: string;
  };
};

export type TenantRole = 'owner' | 'admin' | 'superviseur' | 'member' | 'readonly';

export const ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  superviseur: 'Superviseur',
  member: 'Membre',
  readonly: 'Lecture seule',
};

export type TeamMember = {
  user_id: string;
  email: string;
  role: TenantRole;
  created_at: string;
  deactivated_at: string | null;
};

export type CreateMemberInput = {
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  role: TenantRole;
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

export type StockLevel = {
  id: string;
  product_id: string;
  point_of_sale_id: string;
  quantity_on_hand: string;
  quantity_reserved: string;
  updated_at: string;
};

export type MovementType = 'opening' | 'closing' | 'sale' | 'return' | 'adjustment' | 'transfer_in' | 'transfer_out';

export type StockMovement = {
  id: string;
  product_id: string;
  point_of_sale_id: string;
  movement_type: MovementType;
  quantity: string;
  unit_cost: string | null;
  reference_table: string | null;
  reference_id: string | null;
  reason: string | null;
  performed_by: string | null;
  performed_at: string;
};

export type PointOfSale = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// ---- Licensing ----
export type Pillar = 'platform' | 'commercial' | 'operations' | 'finance' | 'analytics' | 'marketplace';
export type ModuleAction = 'read' | 'write' | 'delete';

export type ModuleDefinition = {
  code: string;
  pillar: Pillar;
  label: { fr: string; en: string };
  description_fr?: string;
  actions: ModuleAction[];
  status: 'active' | 'beta' | 'coming-soon';
  depends_on?: string[];
};

export type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthly_price_xof: string;
  modules: string[];
  is_active: boolean;
};

export type TenantLicense = {
  module_code: string;
  enabled: boolean;
  source: 'plan' | 'addon' | 'manual';
  expires_at: string | null;
};

export type EffectivePermission = {
  module: string;
  actions: string[];
};

// ---- Sales / POS ----
export type SaleStatus = 'draft' | 'posted' | 'voided';
export type PaymentMethod = 'cash' | 'wave' | 'orange_money' | 'mtn_momo' | 'card' | 'credit';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  wave: 'Wave',
  orange_money: 'Orange Money',
  mtn_momo: 'MTN Mobile Money',
  card: 'Carte',
  credit: 'Crédit client',
};

export type Sale = {
  id: string;
  point_of_sale_id: string;
  customer_id: string | null;
  user_id: string;
  status: SaleStatus;
  subtotal: string;
  tax_total: string;
  total: string;
  paid_total: string;
  change_given: string;
  reference_number: string | null;
  notes: string | null;
  posted_at: string | null;
  voided_at: string | null;
  voided_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_rate: string;
  tax_amount: string;
  line_total: string;
  pricing_variant: 'detail' | 'gros' | null;
};

export type SalePayment = {
  id: string;
  sale_id: string;
  method: PaymentMethod;
  amount: string;
  reference: string | null;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  received_at: string | null;
};

export type SaleDetail = Sale & { items: SaleItem[]; payments: SalePayment[] };

export type CreateSaleInput = {
  point_of_sale_id: string;
  customer_id?: string;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price?: number;
    discount_amount?: number;
    tax_rate?: number;
    pricing_variant?: 'detail' | 'gros';
  }>;
  payments?: Array<{ method: PaymentMethod; amount: number; reference?: string }>;
  notes?: string;
  auto_post?: boolean;
};

// ---- Workflows ----
export type ConfigurableSettingType =
  | 'time'
  | 'text'
  | 'number'
  | 'emails'
  | 'boolean';

export type ConfigurableSetting = {
  key: string;
  label: string;
  type: ConfigurableSettingType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default?: any;
  required?: boolean;
  help?: string;
};

export type WorkflowTemplate = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  // n8n_definition est libre — JSON brut export n8n
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  n8n_definition: any;
  configurable_settings: ConfigurableSetting[];
  required_modules: string[];
  restricted_to_tenants: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateWorkflowTemplateInput = {
  code: string;
  name: string;
  description?: string;
  configurable_settings: ConfigurableSetting[];
  required_modules: string[];
  restricted_to_tenants?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  n8n_definition?: any;
};

export type UpdateWorkflowTemplateInput = {
  name?: string;
  description?: string;
  configurable_settings?: ConfigurableSetting[];
  required_modules?: string[];
  restricted_to_tenants?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  n8n_definition?: any;
  is_active?: boolean;
};

export type WorkflowRunStatus = 'running' | 'success' | 'error' | 'timeout';
export type WorkflowRunTrigger = 'cron' | 'manual' | 'webhook';

export type TenantWorkflowInstance = {
  id: string;
  tenant_id: string;
  template_id: string;
  template_code: string;
  template_name: string;
  n8n_workflow_id: string | null;
  enabled: boolean;
  // settings libre — schema dicté par configurable_settings du template
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  custom_settings: Record<string, any>;
  configured_by: string | null;
  configured_at: string | null;
  last_run_at: string | null;
  last_run_status: 'success' | 'error' | 'running' | null;
  last_run_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivateWorkflowInput = {
  template_code: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  custom_settings?: Record<string, any>;
};

export type WorkflowRun = {
  id: string;
  instance_id: string;
  template_code: string;
  triggered_by: WorkflowRunTrigger;
  triggered_by_user: string | null;
  started_at: string;
  finished_at: string | null;
  status: WorkflowRunStatus;
  duration_ms: number | null;
  n8n_execution_id: string | null;
  error_message: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload_summary: Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output_summary: Record<string, any> | null;
};

/**
 * Endpoints admin plateforme (sans tenant context — pas de Bearer requis Phase 0).
 * Phase 1 : à protéger côté API par AuthGuard "super-admin Matix".
 */
const API_URL_PUBLIC = API_URL;
async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL_PUBLIC}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body, body?.message ?? `HTTP ${res.status}`);
  return body as T;
}

// ---- Endpoints ----
export const api = {
  products: {
    list: (a: AuthState, opts?: { category_id?: string }) => {
      const qs = opts?.category_id ? `?category_id=${opts.category_id}` : '';
      return apiFetch<Product[]>(a, `/products${qs}`);
    },
    create: (
      a: AuthState,
      body: {
        sku: string;
        name: string;
        unit_price: number;
        unit_price_gros?: number | null;
        gros_enabled?: boolean;
        category_id?: string;
      },
    ) => apiFetch<Product>(a, '/products', { method: 'POST', body: JSON.stringify(body) }),
    update: (
      a: AuthState,
      id: string,
      body: Partial<{
        name: string;
        unit_price: number;
        unit_price_gros: number | null;
        gros_enabled: boolean;
        category_id: string | null;
      }>,
    ) => apiFetch<Product>(a, `/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    setStockMode: (a: AuthState, id: string, mode: StockMode) =>
      apiFetch<Product>(a, `/products/${id}/stock-mode`, {
        method: 'PATCH',
        body: JSON.stringify({ mode }),
      }),
    remove: (a: AuthState, id: string) =>
      apiFetch<void>(a, `/products/${id}`, { method: 'DELETE' }),
  },
  productCategories: {
    list: (a: AuthState, opts?: { activeOnly?: boolean }) =>
      apiFetch<ProductCategory[]>(a, `/product-categories${opts?.activeOnly ? '?active_only=true' : ''}`),
    create: (a: AuthState, body: { code: string; name: string; family?: string; display_order?: number }) =>
      apiFetch<ProductCategory>(a, '/product-categories', { method: 'POST', body: JSON.stringify(body) }),
    update: (
      a: AuthState,
      id: string,
      body: Partial<{ name: string; family: string | null; display_order: number; is_active: boolean }>,
    ) => apiFetch<ProductCategory>(a, `/product-categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (a: AuthState, id: string) =>
      apiFetch<void>(a, `/product-categories/${id}`, { method: 'DELETE' }),
  },
  pointsOfSale: {
    list: (a: AuthState, opts?: { activeOnly?: boolean }) =>
      apiFetch<PointOfSale[]>(a, `/points-of-sale${opts?.activeOnly ? '?active_only=true' : ''}`),
  },
  tenantSettings: {
    get: (a: AuthState) => apiFetch<TenantSettings>(a, '/settings/tenant'),
    update: (a: AuthState, body: { default_gros_rebate_xof?: number }) =>
      apiFetch<TenantSettings>(a, '/settings/tenant', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },
  inventory: {
    levels: (a: AuthState, opts?: { product_id?: string; point_of_sale_id?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.product_id) qs.set('product_id', opts.product_id);
      if (opts?.point_of_sale_id) qs.set('point_of_sale_id', opts.point_of_sale_id);
      return apiFetch<StockLevel[]>(a, `/inventory/levels${qs.toString() ? '?' + qs : ''}`);
    },
    movements: (a: AuthState, opts?: { product_id?: string; point_of_sale_id?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (opts?.product_id) qs.set('product_id', opts.product_id);
      if (opts?.point_of_sale_id) qs.set('point_of_sale_id', opts.point_of_sale_id);
      if (opts?.limit) qs.set('limit', String(opts.limit));
      return apiFetch<StockMovement[]>(a, `/inventory/movements${qs.toString() ? '?' + qs : ''}`);
    },
    recordMovement: (
      a: AuthState,
      body: {
        product_id: string;
        point_of_sale_id: string;
        movement_type: 'opening' | 'closing' | 'adjustment' | 'return';
        quantity: number;
        unit_cost?: number;
        reason?: string;
      },
    ) => apiFetch<StockMovement>(a, '/inventory/movements', { method: 'POST', body: JSON.stringify(body) }),
    transfer: (
      a: AuthState,
      body: {
        product_id: string;
        from_point_of_sale_id: string;
        to_point_of_sale_id: string;
        quantity: number;
        reason?: string;
      },
    ) =>
      apiFetch<{ out_id: string; in_id: string }>(a, '/inventory/transfers', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    dailyClosing: {
      list: (a: AuthState, opts: { date: string; point_of_sale_id?: string }) => {
        const qs = new URLSearchParams({ date: opts.date });
        if (opts.point_of_sale_id) qs.set('point_of_sale_id', opts.point_of_sale_id);
        return apiFetch<DailyClosingView[]>(a, `/inventory/daily-closing?${qs}`);
      },
      setManual: (
        a: AuthState,
        body: {
          closing_date: string;
          point_of_sale_id: string;
          product_id: string;
          quantity: number;
        },
      ) =>
        apiFetch<DailyClosingRecord>(a, '/inventory/daily-closing', {
          method: 'PUT',
          body: JSON.stringify(body),
        }),
      recomputeAuto: (
        a: AuthState,
        body: { closing_date: string; point_of_sale_id?: string },
      ) =>
        apiFetch<{ updated: number }>(a, '/inventory/daily-closing/recompute-auto', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      getNote: (a: AuthState, opts: { date: string; point_of_sale_id: string }) => {
        const qs = new URLSearchParams({
          date: opts.date,
          point_of_sale_id: opts.point_of_sale_id,
        });
        return apiFetch<ReconciliationNote | null>(
          a,
          `/inventory/daily-closing/notes?${qs}`,
        );
      },
      setNote: (
        a: AuthState,
        body: { note_date: string; point_of_sale_id: string; body: string },
      ) =>
        apiFetch<ReconciliationNote>(a, '/inventory/daily-closing/notes', {
          method: 'PUT',
          body: JSON.stringify(body),
        }),
    },
    cuttings: {
      list: (
        a: AuthState,
        opts?: {
          date?: string;
          point_of_sale_id?: string;
          source_product_id?: string;
          limit?: number;
          offset?: number;
        },
      ) => {
        const qs = new URLSearchParams();
        if (opts?.date) qs.set('date', opts.date);
        if (opts?.point_of_sale_id) qs.set('point_of_sale_id', opts.point_of_sale_id);
        if (opts?.source_product_id) qs.set('source_product_id', opts.source_product_id);
        if (opts?.limit) qs.set('limit', String(opts.limit));
        if (opts?.offset) qs.set('offset', String(opts.offset));
        return apiFetch<Cutting[]>(a, `/inventory/cuttings${qs.toString() ? '?' + qs : ''}`);
      },
      getById: (a: AuthState, id: string) => apiFetch<Cutting>(a, `/inventory/cuttings/${id}`),
      create: (
        a: AuthState,
        body: {
          point_of_sale_id: string;
          source_product_id: string;
          source_quantity: number;
          source_unit_cost?: number;
          outputs: Array<{ product_id: string; quantity: number; unit_cost?: number }>;
          performed_at?: string;
          notes?: string;
        },
      ) =>
        apiFetch<Cutting>(a, '/inventory/cuttings', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      yieldStats: (
        a: AuthState,
        opts: { from: string; to: string; point_of_sale_id?: string },
      ) => {
        const qs = new URLSearchParams({ from: opts.from, to: opts.to });
        if (opts.point_of_sale_id) qs.set('point_of_sale_id', opts.point_of_sale_id);
        return apiFetch<CuttingYieldStat[]>(a, `/inventory/cuttings/stats/yield?${qs}`);
      },
    },
  },
  sales: {
    list: (a: AuthState, opts?: { status?: SaleStatus; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (opts?.status) qs.set('status', opts.status);
      if (opts?.limit) qs.set('limit', String(opts.limit));
      if (opts?.offset) qs.set('offset', String(opts.offset));
      return apiFetch<Sale[]>(a, `/sales${qs.toString() ? '?' + qs : ''}`);
    },
    getById: (a: AuthState, id: string) => apiFetch<SaleDetail>(a, `/sales/${id}`),
    create: (a: AuthState, body: CreateSaleInput) =>
      apiFetch<SaleDetail>(a, '/sales', { method: 'POST', body: JSON.stringify(body) }),
    post: (a: AuthState, id: string) =>
      apiFetch<Sale>(a, `/sales/${id}/post`, { method: 'POST' }),
    void: (a: AuthState, id: string, reason: string) =>
      apiFetch<Sale>(a, `/sales/${id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    dailyStats: (a: AuthState, opts?: { date?: string; point_of_sale_id?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.date) qs.set('date', opts.date);
      if (opts?.point_of_sale_id) qs.set('point_of_sale_id', opts.point_of_sale_id);
      return apiFetch<DailyStats>(a, `/sales/daily-stats${qs.toString() ? '?' + qs : ''}`);
    },
    lines: (a: AuthState, opts?: { date?: string; point_of_sale_id?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (opts?.date) qs.set('date', opts.date);
      if (opts?.point_of_sale_id) qs.set('point_of_sale_id', opts.point_of_sale_id);
      if (opts?.limit) qs.set('limit', String(opts.limit));
      if (opts?.offset) qs.set('offset', String(opts.offset));
      return apiFetch<SaleLineRow[]>(a, `/sales/lines${qs.toString() ? '?' + qs : ''}`);
    },
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
  admin: {
    tenants: {
      list: () => adminFetch<Tenant[]>('/admin/tenants'),
      provision: (body: ProvisionTenantInput) =>
        adminFetch<{
          tenant: Tenant;
          owner: { user_id: string; email: string };
          message: string;
        }>('/admin/tenants', { method: 'POST', body: JSON.stringify(body) }),
    },
  },
  licensing: {
    catalog: () => adminFetch<ModuleDefinition[]>('/licensing/catalog'),
    plans: () => adminFetch<Plan[]>('/licensing/plans'),
    me: (a: AuthState) => apiFetch<TenantLicense[]>(a, '/licensing/me'),
    myPermissions: (a: AuthState) => apiFetch<EffectivePermission[]>(a, '/licensing/me/permissions'),
  },
  adminLicensing: {
    listForTenant: (tenantId: string) =>
      adminFetch<TenantLicense[]>(`/admin/licensing/${tenantId}/licenses`),
    assignPlan: (tenantId: string, plan_code: string) =>
      adminFetch<{ ok: true }>(`/admin/licensing/${tenantId}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({ plan_code }),
      }),
    toggleModule: (tenantId: string, module_code: string, enabled: boolean) =>
      adminFetch<{ ok: true }>(`/admin/licensing/${tenantId}/modules`, {
        method: 'POST',
        body: JSON.stringify({ module_code, enabled }),
      }),
  },
  team: {
    list: (a: AuthState) => apiFetch<TeamMember[]>(a, '/team'),
    create: (a: AuthState, body: CreateMemberInput) =>
      apiFetch<TeamMember>(a, '/team', { method: 'POST', body: JSON.stringify(body) }),
    updateRole: (a: AuthState, userId: string, role: TenantRole) =>
      apiFetch<TeamMember>(a, `/team/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    remove: (a: AuthState, userId: string) =>
      apiFetch<void>(a, `/team/${userId}`, { method: 'DELETE' }),
  },
  adminWorkflowTemplates: {
    list: () => adminFetch<WorkflowTemplate[]>('/admin/workflow-templates'),
    get: (code: string) =>
      adminFetch<WorkflowTemplate>(`/admin/workflow-templates/${code}`),
    create: (body: CreateWorkflowTemplateInput) =>
      adminFetch<WorkflowTemplate>('/admin/workflow-templates', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: UpdateWorkflowTemplateInput) =>
      adminFetch<WorkflowTemplate>(`/admin/workflow-templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      adminFetch<void>(`/admin/workflow-templates/${id}`, { method: 'DELETE' }),
    setActive: (id: string, isActive: boolean) =>
      adminFetch<WorkflowTemplate>(`/admin/workflow-templates/${id}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: isActive }),
      }),
  },
  tenantWorkflows: {
    listTemplates: (a: AuthState) =>
      apiFetch<WorkflowTemplate[]>(a, '/workflows/templates'),
    listInstances: (a: AuthState) =>
      apiFetch<TenantWorkflowInstance[]>(a, '/workflows/instances'),
    activate: (a: AuthState, body: ActivateWorkflowInput) =>
      apiFetch<TenantWorkflowInstance>(a, '/workflows/activate', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateSettings: (
      a: AuthState,
      id: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings: Record<string, any>,
    ) =>
      apiFetch<TenantWorkflowInstance>(a, `/workflows/instances/${id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({ custom_settings: settings }),
      }),
    disable: (a: AuthState, id: string) =>
      apiFetch<TenantWorkflowInstance>(a, `/workflows/instances/${id}/disable`, {
        method: 'POST',
      }),
    enable: (a: AuthState, id: string) =>
      apiFetch<TenantWorkflowInstance>(a, `/workflows/instances/${id}/enable`, {
        method: 'POST',
      }),
    trigger: (a: AuthState, id: string) =>
      apiFetch<{ run_id: string; n8n_execution_id: string | null }>(
        a,
        `/workflows/instances/${id}/trigger`,
        { method: 'POST' },
      ),
    listRuns: (a: AuthState, instanceId?: string, limit?: number) => {
      const qs = new URLSearchParams();
      if (instanceId) qs.set('instance_id', instanceId);
      if (limit) qs.set('limit', String(limit));
      return apiFetch<WorkflowRun[]>(
        a,
        `/workflows/runs${qs.toString() ? '?' + qs : ''}`,
      );
    },
  },
};
