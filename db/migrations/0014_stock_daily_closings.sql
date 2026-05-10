-- Migration 0014 — Gestion du stock soir avec deux modes (manuel / automatique)
--
-- Contexte : avant la "reconciliation" comptable, on a besoin d'une saisie de
-- stock soir propre. Deux comportements selon le produit :
--
--   - mode 'manuel' (defaut famille Boucherie) : l'utilisateur SAISIT le stock
--     soir chaque soir, a la main. Le systeme calcule a cote un "stock
--     theorique" pour info (= stock matin - ventes - transferts_out + transferts_in).
--     Pendant la nuit, un cron copie le stock soir J -> stock matin J+1.
--
--   - mode 'automatique' (defaut autres familles) : le systeme calcule le stock
--     soir tout seul a partir des mouvements. L'utilisateur peut overrider la
--     valeur (passe alors en source='manual'). On stocke last_auto_at pour
--     savoir si la valeur affichee vient d'un calcul recent.
--
-- Conformement a l'invariant d'isolation Matix : RLS active sur toutes les
-- tables ajoutees + UNIQUE incluant tenant_id.
-- ============================================================================

-- ============================================================================
-- 1) products.stock_mode — defaut au niveau produit (overridable)
-- ============================================================================
ALTER TABLE products
  ADD COLUMN stock_mode TEXT NOT NULL DEFAULT 'automatique'
    CHECK (stock_mode IN ('manuel','automatique'));

-- Backfill : produits dont la categorie a family='Boucherie' -> 'manuel'.
UPDATE products p
   SET stock_mode = 'manuel'
  FROM product_categories pc
 WHERE p.category_id = pc.id
   AND pc.family = 'Boucherie';

CREATE INDEX idx_products_tenant_stock_mode
  ON products(tenant_id, stock_mode)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- 2) stock_daily_closings — stock soir saisi/calcule par (date, pos, produit)
-- ============================================================================
CREATE TABLE stock_daily_closings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  closing_date        DATE NOT NULL,
  point_of_sale_id    UUID NOT NULL REFERENCES points_of_sale(id),
  product_id          UUID NOT NULL REFERENCES products(id),
  quantity            NUMERIC(14,3) NOT NULL CHECK (quantity >= 0),
  quantity_theorique  NUMERIC(14,3) NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('auto','manual')),
  last_auto_at        TIMESTAMPTZ,
  set_by              UUID,
  set_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, closing_date, point_of_sale_id, product_id)
);

CREATE INDEX idx_stock_daily_closings_tenant_date
  ON stock_daily_closings(tenant_id, closing_date DESC);
CREATE INDEX idx_stock_daily_closings_tenant_pos_date
  ON stock_daily_closings(tenant_id, point_of_sale_id, closing_date DESC);

ALTER TABLE stock_daily_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_daily_closings FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_daily_closings
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE OR REPLACE FUNCTION fn_touch_stock_daily_closings()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_daily_closings_touch
  BEFORE UPDATE ON stock_daily_closings
  FOR EACH ROW EXECUTE FUNCTION fn_touch_stock_daily_closings();

-- ============================================================================
-- 3) reconciliation_notes — un commentaire libre par (date, pos)
-- ============================================================================
CREATE TABLE reconciliation_notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  note_date           DATE NOT NULL,
  point_of_sale_id    UUID NOT NULL REFERENCES points_of_sale(id),
  body                TEXT NOT NULL DEFAULT '',
  set_by              UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, note_date, point_of_sale_id)
);

CREATE INDEX idx_reconciliation_notes_tenant_date
  ON reconciliation_notes(tenant_id, note_date DESC);

ALTER TABLE reconciliation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_notes FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reconciliation_notes
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TRIGGER trg_reconciliation_notes_touch
  BEFORE UPDATE ON reconciliation_notes
  FOR EACH ROW EXECUTE FUNCTION fn_touch_stock_daily_closings();
