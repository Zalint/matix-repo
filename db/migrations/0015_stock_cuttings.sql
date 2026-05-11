-- Migration 0015 — Découpes (cuttings) + tarif gros + variante prix sale_item
--
-- Ajoute la primitive "découpe" :
--   1 produit source (carcasse, viande à transformer, etc.) consommé
--   N produits de sortie (boeuf, filet, jarret, viande hachée, etc.)
--   chute = source - SUM(sorties), tracée explicitement.
--
-- Au commit d'une découpe, on génère atomiquement :
--   - 1 stock_movements type='cutting_out' (qty négative) sur la source
--   - N stock_movements type='cutting_in' (qty positive) sur les sorties
--   - tous liés par reference_table='stock_cuttings' + reference_id=cutting.id
--
-- Le trigger existant fn_apply_stock_movement met déjà à jour stock_levels
-- pour ces nouveaux types (il ne regarde que le signe, pas le type).
--
-- Ajoute aussi :
--   products.unit_price_gros  : tarif vente en gros (NULL si pas applicable)
--   sale_items.pricing_variant: 'detail' | 'gros' | NULL — quel tarif a été
--                                appliqué à cette ligne de vente
-- ============================================================================

-- ============================================================================
-- 1) Étendre les types de mouvement autorisés sur stock_movements
-- ============================================================================
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
    CHECK (movement_type IN (
      'opening','sale','return','adjustment',
      'transfer_in','transfer_out','closing',
      'cutting_in','cutting_out'
    ));

-- ============================================================================
-- 2) products.unit_price_gros — tarif vente en gros (optionnel)
-- ============================================================================
ALTER TABLE products
  ADD COLUMN unit_price_gros NUMERIC(14,2)
    CHECK (unit_price_gros IS NULL OR unit_price_gros >= 0);

COMMENT ON COLUMN products.unit_price_gros IS
  'Prix de vente en gros. NULL = produit avec un seul tarif (pas de toggle POS).';

-- ============================================================================
-- 3) sale_items.pricing_variant — tarif appliqué à la vente
-- ============================================================================
ALTER TABLE sale_items
  ADD COLUMN pricing_variant TEXT
    CHECK (pricing_variant IS NULL OR pricing_variant IN ('detail','gros'));

COMMENT ON COLUMN sale_items.pricing_variant IS
  'Tarif appliqué : detail (=unit_price products) ou gros (=unit_price_gros). NULL pour les produits sans tarif gros.';

-- ============================================================================
-- 4) stock_cuttings — header d'une découpe
-- ============================================================================
CREATE TABLE stock_cuttings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  point_of_sale_id    UUID NOT NULL REFERENCES points_of_sale(id),
  performed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  source_product_id   UUID NOT NULL REFERENCES products(id),
  source_quantity     NUMERIC(14,3) NOT NULL CHECK (source_quantity > 0),

  -- Champs calcules au commit (denorm pour stats rapides sans recompute).
  -- waste_quantity peut etre <0 sur de la redecoupe (rare) — on tolere via CHECK lache.
  total_outputs       NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (total_outputs >= 0),
  waste_quantity      NUMERIC(14,3) NOT NULL DEFAULT 0,
  waste_pct           NUMERIC(5,2) NOT NULL DEFAULT 0,

  performed_by        UUID,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_cuttings_tenant_date
  ON stock_cuttings(tenant_id, performed_at DESC);
CREATE INDEX idx_stock_cuttings_tenant_pos_date
  ON stock_cuttings(tenant_id, point_of_sale_id, performed_at DESC);
CREATE INDEX idx_stock_cuttings_tenant_source
  ON stock_cuttings(tenant_id, source_product_id, performed_at DESC);

ALTER TABLE stock_cuttings ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_cuttings FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_cuttings
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE OR REPLACE FUNCTION fn_touch_stock_cuttings()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_cuttings_touch
  BEFORE UPDATE ON stock_cuttings
  FOR EACH ROW EXECUTE FUNCTION fn_touch_stock_cuttings();

-- ============================================================================
-- 5) stock_cutting_outputs — lignes (1 ligne par produit de sortie)
-- ============================================================================
CREATE TABLE stock_cutting_outputs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  cutting_id      UUID NOT NULL REFERENCES stock_cuttings(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id),
  quantity        NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost       NUMERIC(14,2),                  -- repartition coût source au prorata
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, cutting_id, product_id)      -- 1 ligne max par produit dans une découpe
);

CREATE INDEX idx_stock_cutting_outputs_tenant_cutting
  ON stock_cutting_outputs(tenant_id, cutting_id);
CREATE INDEX idx_stock_cutting_outputs_tenant_product
  ON stock_cutting_outputs(tenant_id, product_id);

ALTER TABLE stock_cutting_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_cutting_outputs FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_cutting_outputs
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
