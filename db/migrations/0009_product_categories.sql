-- Migration 0009 — Catégories produits (taxonomie tenant-scoped)
-- Inspiré du modèle Maas App (Category.js : nom, ordre, famille).
-- Chaque tenant définit sa propre taxonomie ; pas d'ENUM global.

-- ============================================================================
-- product_categories — catégorisation des produits par tenant
-- ============================================================================
CREATE TABLE product_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  code          TEXT NOT NULL,                          -- slug stable pour l'API
  name          TEXT NOT NULL,                          -- libellé affiché
  family        TEXT,                                   -- regroupement large (ex: 'Boucherie', 'Epicerie')
  display_order INT  NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);

CREATE INDEX idx_product_categories_tenant
  ON product_categories(tenant_id, family, display_order)
  WHERE deleted_at IS NULL;

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_categories
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================================
-- products.category_id — FK optionnelle vers product_categories
-- ============================================================================
ALTER TABLE products
  ADD COLUMN category_id UUID REFERENCES product_categories(id);

CREATE INDEX idx_products_tenant_category
  ON products(tenant_id, category_id)
  WHERE deleted_at IS NULL AND category_id IS NOT NULL;

-- ============================================================================
-- Seed : taxonomie boucherie pour le tenant 'acme' (démo)
-- Idempotent : ne réinsère pas si déjà présent.
-- ============================================================================
DO $$
DECLARE
  acme_tenant_id UUID;
BEGIN
  SELECT id INTO acme_tenant_id FROM tenants WHERE slug = 'acme' LIMIT 1;
  IF acme_tenant_id IS NULL THEN
    RAISE NOTICE 'Tenant acme absent — skip seed catégories';
    RETURN;
  END IF;

  INSERT INTO product_categories (tenant_id, code, name, family, display_order) VALUES
    (acme_tenant_id, 'bovin',    'Bovin',    'Boucherie', 10),
    (acme_tenant_id, 'ovin',     'Ovin',     'Boucherie', 20),
    (acme_tenant_id, 'caprin',   'Caprin',   'Boucherie', 30),
    (acme_tenant_id, 'volaille', 'Volaille', 'Boucherie', 40),
    (acme_tenant_id, 'poisson',  'Poisson',  'Boucherie', 50),
    (acme_tenant_id, 'pack',     'Pack',     'Boucherie', 60),
    (acme_tenant_id, 'autres',   'Autres',   'Autres',    99)
  ON CONFLICT (tenant_id, code) DO NOTHING;
END $$;
