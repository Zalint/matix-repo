-- Migration 0006 — Module Sales/POS
-- Conforme ADR-0004 §1, §5.

-- ============================================================================
-- document_sequences — compteurs non-réutilisables par (tenant, type)
-- ============================================================================
CREATE TABLE document_sequences (
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  sequence_type  TEXT NOT NULL,
  current_value  BIGINT NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  PRIMARY KEY (tenant_id, sequence_type)
);

ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sequences FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_sequences
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================================
-- sales — transaction commerciale
-- ============================================================================
CREATE TABLE sales (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  point_of_sale_id   UUID NOT NULL REFERENCES points_of_sale(id),
  customer_id        UUID REFERENCES customers(id),
  user_id            UUID NOT NULL,                 -- caissier (Keycloak sub)
  status             TEXT NOT NULL CHECK (status IN ('draft','posted','voided')),
  subtotal           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total              NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid_total         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  change_given       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (change_given >= 0),
  reference_number   TEXT,                           -- NULL jusqu'à post
  notes              TEXT,
  posted_at          TIMESTAMPTZ,
  voided_at          TIMESTAMPTZ,
  voided_reason      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

-- Reference unique par tenant (uniquement pour les ventes postées)
CREATE UNIQUE INDEX idx_sales_ref_unique ON sales(tenant_id, reference_number)
  WHERE reference_number IS NOT NULL;
CREATE INDEX idx_sales_tenant_status ON sales(tenant_id, status, created_at DESC);
CREATE INDEX idx_sales_tenant_pos    ON sales(tenant_id, point_of_sale_id, posted_at DESC) WHERE posted_at IS NOT NULL;
CREATE INDEX idx_sales_tenant_customer ON sales(tenant_id, customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================================
-- sale_items — lignes de vente
-- ============================================================================
CREATE TABLE sale_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  sale_id         UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id),
  quantity        NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_rate        NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate < 1),
  tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total      NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sale_items_tenant_sale    ON sale_items(tenant_id, sale_id);
CREATE INDEX idx_sale_items_tenant_product ON sale_items(tenant_id, product_id);

ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sale_items
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================================
-- sale_payments — encaissements
-- ============================================================================
CREATE TABLE sale_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  sale_id      UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method       TEXT NOT NULL CHECK (method IN ('cash','wave','orange_money','mtn_momo','card','credit')),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference    TEXT,                              -- tx_id Bictorys, n° chèque, etc.
  status       TEXT NOT NULL DEFAULT 'succeeded'
               CHECK (status IN ('pending','succeeded','failed','refunded')),
  received_at  TIMESTAMPTZ,
  received_by  UUID,                              -- Keycloak sub
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sale_payments_tenant_sale ON sale_payments(tenant_id, sale_id);
CREATE INDEX idx_sale_payments_tenant_method ON sale_payments(tenant_id, method, created_at DESC);

ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sale_payments
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
