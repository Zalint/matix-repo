-- Migration 0008 — Licensing & Permissions (ADR-0006)

-- ============================================================================
-- plans — global, geres par super-admin Matix
-- ============================================================================
CREATE TABLE plans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT UNIQUE NOT NULL,           -- 'free' | 'starter' | 'pro' | 'enterprise'
  name               TEXT NOT NULL,
  description        TEXT,
  monthly_price_xof  BIGINT NOT NULL DEFAULT 0 CHECK (monthly_price_xof >= 0),
  modules            TEXT[] NOT NULL DEFAULT '{}',   -- liste de module_code
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pas de RLS — table globale.
GRANT SELECT ON plans TO matix_app;

-- ============================================================================
-- tenant_licenses — par tenant, materialise les modules autorises
-- ============================================================================
CREATE TABLE tenant_licenses (
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_code   TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  source        TEXT NOT NULL CHECK (source IN ('plan','addon','manual')),
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, module_code)
);

CREATE INDEX idx_tenant_licenses_enabled ON tenant_licenses(tenant_id, module_code) WHERE enabled = TRUE;

ALTER TABLE tenant_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_licenses FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_licenses
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================================
-- role_permissions — overrides custom (Enterprise tier, Phase 2)
-- ============================================================================
CREATE TABLE role_permissions (
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner','admin','superviseur','member','readonly')),
  module_code  TEXT NOT NULL,
  actions      TEXT[] NOT NULL DEFAULT '{}',         -- subset de ['read','write','delete']
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, role, module_code)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permissions
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================================
-- tenants : ajoute plan_id
-- ============================================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id);
CREATE INDEX IF NOT EXISTS idx_tenants_plan ON tenants(plan_id);

-- ============================================================================
-- Seed des 4 plans par defaut
-- ============================================================================
INSERT INTO plans (code, name, monthly_price_xof, modules) VALUES
  ('free', 'Free', 0, ARRAY[
    'platform.identity','platform.team','platform.settings','platform.notifications','platform.files','platform.audit','platform.snapshots',
    'commercial.crm.customers',
    'commercial.sales.pos',
    'operations.inventory.levels','operations.inventory.movements'
  ]),
  -- starter: ajout cash_closure et unit_conversion (post-audit ADR-0007)
  ('starter', 'Starter', 15000, ARRAY[
    'platform.identity','platform.team','platform.settings','platform.notifications','platform.files','platform.audit','platform.snapshots',
    'commercial.crm.customers','commercial.crm.tags','commercial.crm.credits',
    'commercial.sales.pos','commercial.sales.cash_closure','commercial.sales.reconciliation','commercial.sales.discounts',
    'commercial.pricing.lists','commercial.pricing.history',
    'operations.inventory.levels','operations.inventory.movements','operations.inventory.transfers','operations.inventory.alerts','operations.inventory.counts','operations.inventory.unit_conversion',
    'finance.invoicing.tickets',
    'finance.payments.mobile_money','finance.payments.cash',
    'analytics.dashboards.sales','analytics.dashboards.inventory',
    'analytics.exports.csv','analytics.exports.excel'
  ]),
  ('pro', 'Pro', 50000, ARRAY[
    'platform.identity','platform.team','platform.settings','platform.notifications','platform.files','platform.audit','platform.snapshots','platform.api_keys','platform.webhooks',
    'commercial.crm.customers','commercial.crm.segments','commercial.crm.tags','commercial.crm.credits','commercial.crm.communications',
    'commercial.sales.pos','commercial.sales.cash_closure','commercial.sales.reconciliation','commercial.sales.performance_audit','commercial.sales.discounts','commercial.sales.loyalty',
    'commercial.subscriptions.plans','commercial.subscriptions.billing',
    'commercial.pricing.lists','commercial.pricing.history','commercial.pricing.promotions',
    'operations.inventory.levels','operations.inventory.movements','operations.inventory.transfers','operations.inventory.valuation','operations.inventory.alerts','operations.inventory.counts','operations.inventory.livestock',
    'operations.procurement.purchase_orders','operations.procurement.suppliers','operations.procurement.receiving','operations.procurement.slaughter',
    'operations.delivery.orders','operations.delivery.drivers','operations.delivery.gps','operations.delivery.routes','operations.delivery.scoring','operations.delivery.proof_of_delivery','operations.delivery.bidirectional_ratings',
    'operations.hr.timesheets','operations.hr.expenses','operations.hr.schedules',
    'finance.accounting.gl','finance.accounting.statements','finance.accounting.tax',
    'finance.expenses.entry','finance.expenses.approval','finance.expenses.ocr',
    'finance.receivables.aging','finance.receivables.reminders','finance.receivables.portfolio',
    'finance.payables.aging',
    'finance.invoicing.invoices','finance.invoicing.tickets','finance.invoicing.credit_notes','finance.invoicing.pdf',
    'finance.banking.accounts','finance.banking.reconciliation','finance.banking.transfers',
    'finance.payments.mobile_money','finance.payments.cards','finance.payments.cash',
    'finance.partners.accounts','finance.partners.deliveries',
    'analytics.dashboards.sales','analytics.dashboards.inventory','analytics.dashboards.finance',
    'analytics.reports.standard','analytics.reports.scheduled',
    'analytics.ai.insights','analytics.market_intelligence',
    'analytics.exports.csv','analytics.exports.excel','analytics.exports.pdf'
  ]),
  ('enterprise', 'Enterprise', 0 /* sur devis */, ARRAY[]::TEXT[])
ON CONFLICT (code) DO NOTHING;

-- Le plan enterprise a "tous" les modules — populated by app code at runtime
-- (more flexible: when MODULE_CATALOG grows, we don't have to update plans).
