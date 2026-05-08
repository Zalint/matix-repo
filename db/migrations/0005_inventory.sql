-- Migration 0005 — Module Inventory
-- Tables :
--   stock_levels     : cache (quantity_on_hand par (product, point_of_sale))
--   stock_movements  : journal append-only — vérité source
-- Trigger : auto-update stock_levels à chaque INSERT dans stock_movements.

-- ============================================================================
-- stock_levels — cache dénormalisé, recalculable depuis stock_movements
-- ============================================================================
CREATE TABLE stock_levels (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  product_id         UUID NOT NULL REFERENCES products(id),
  point_of_sale_id   UUID NOT NULL REFERENCES points_of_sale(id),
  quantity_on_hand   NUMERIC(14,3) NOT NULL DEFAULT 0,
  quantity_reserved  NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, product_id, point_of_sale_id)
);

CREATE INDEX idx_stock_levels_tenant_product ON stock_levels(tenant_id, product_id);
CREATE INDEX idx_stock_levels_tenant_pos     ON stock_levels(tenant_id, point_of_sale_id);

ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_levels FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_levels
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================================
-- stock_movements — journal append-only
-- Types :
--   'opening'        : stock initial (positif)
--   'sale'           : sortie pour vente (négatif)
--   'return'         : retour client (positif)
--   'adjustment'     : ajustement manuel (positif ou négatif)
--   'transfer_out'   : sortie pour transfert (négatif) — Phase 2
--   'transfer_in'    : entrée par transfert (positif)  — Phase 2
-- ============================================================================
CREATE TABLE stock_movements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  product_id         UUID NOT NULL REFERENCES products(id),
  point_of_sale_id   UUID NOT NULL REFERENCES points_of_sale(id),
  movement_type      TEXT NOT NULL CHECK (movement_type IN
    ('opening','sale','return','adjustment','transfer_in','transfer_out','closing')),
  quantity           NUMERIC(14,3) NOT NULL CHECK (quantity <> 0),
  unit_cost          NUMERIC(14,2),               -- coût de revient (optionnel) — utile pour valorisation stock
  reference_table    TEXT,                         -- ex: 'sales'
  reference_id       UUID,
  reason             TEXT,
  performed_by       UUID,                         -- user_id Keycloak
  performed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_movements_tenant_product ON stock_movements(tenant_id, product_id, performed_at DESC);
CREATE INDEX idx_stock_movements_tenant_pos     ON stock_movements(tenant_id, point_of_sale_id, performed_at DESC);
CREATE INDEX idx_stock_movements_ref            ON stock_movements(tenant_id, reference_table, reference_id)
  WHERE reference_table IS NOT NULL;

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_movements
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================================
-- Trigger : maintient stock_levels.quantity_on_hand cohérent avec stock_movements
-- L'INSERT dans stock_movements upserte la ligne stock_levels correspondante.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_apply_stock_movement()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO stock_levels (tenant_id, product_id, point_of_sale_id, quantity_on_hand)
  VALUES (NEW.tenant_id, NEW.product_id, NEW.point_of_sale_id, NEW.quantity)
  ON CONFLICT (tenant_id, product_id, point_of_sale_id) DO UPDATE
    SET quantity_on_hand = stock_levels.quantity_on_hand + NEW.quantity,
        updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movements_apply
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_apply_stock_movement();
