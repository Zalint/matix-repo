-- Migration 0002 — Module products (POC RLS multi-tenant)
-- Cette migration sert de TEMPLATE pour toutes les futures tables métier.
--
-- Règles obligatoires pour toute table métier :
--   1. Colonne `tenant_id UUID NOT NULL REFERENCES tenants(id)`
--   2. Toute UNIQUE constraint inclut `tenant_id`
--   3. Tout index utile commence par `tenant_id`
--   4. ENABLE + FORCE Row Level Security
--   5. Policy d'isolation `tenant_id = current_setting('app.tenant_id')::uuid`

CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  sku         TEXT NOT NULL,
  name        TEXT NOT NULL,
  unit_price  NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, sku)
);

CREATE INDEX idx_products_tenant ON products(tenant_id) WHERE deleted_at IS NULL;

-- --- RLS ---
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON products
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
