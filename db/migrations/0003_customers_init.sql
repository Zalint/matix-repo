-- Migration 0003 — Module CRM Customers
-- Conforme ADR-0002 (convention modules) et ADR-0001 (RLS).

CREATE TABLE customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  code          TEXT NOT NULL,            -- Référence courte (ex: CUST-001) — unique par tenant
  display_name  TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,                     -- E.164 préféré (+221...). Validation côté DTO.
  address       TEXT,
  segment       TEXT,                     -- 'individual' | 'business' | autre, libre
  credit_limit  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);

CREATE INDEX idx_customers_tenant ON customers(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_phone  ON customers(tenant_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;

-- --- RLS ---
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON customers
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
