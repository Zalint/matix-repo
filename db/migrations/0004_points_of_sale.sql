-- Migration 0004 — Module Points of Sale (PoS, points de vente)
-- Conforme ADR-0002 + ADR-0004.

CREATE TABLE points_of_sale (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  code          TEXT NOT NULL,                 -- 'main', 'mbao', 'kmu', etc.
  name          TEXT NOT NULL,                 -- 'Boutique principale', 'Mbao', ...
  address       TEXT,
  phone         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);

CREATE INDEX idx_points_of_sale_tenant ON points_of_sale(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_points_of_sale_active ON points_of_sale(tenant_id, is_active) WHERE deleted_at IS NULL;

-- --- RLS ---
ALTER TABLE points_of_sale ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_of_sale FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON points_of_sale
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
