-- Migration 0016 — Rabais "vente en gros" par défaut au niveau tenant
--
-- Aujourd'hui (migration 0015) chaque produit a une colonne unit_price_gros
-- qui peut être NULL (pas de tarif gros) ou un montant explicite. Ça marche,
-- mais ça oblige à saisir le prix gros produit par produit alors qu'en
-- pratique chez Mata le rabais est le MÊME pour tous les produits :
--   "gros = détails − 200 XOF" partout.
--
-- On introduit :
--   - tenants.default_gros_rebate_xof : montant du rabais (par défaut 0)
--   - products.gros_enabled : flag indiquant si le produit a l'option gros
--
-- Calcul du prix gros effectif :
--   - gros_enabled = false → pas de tarif gros (pas de toggle POS)
--   - gros_enabled = true, unit_price_gros IS NULL → unit_price − tenant.rebate
--   - gros_enabled = true, unit_price_gros IS NOT NULL → override explicite
--
-- Backfill : tous les produits avec un unit_price_gros déjà saisi (de la
-- migration 0015) passent à gros_enabled=true. Le reste reste FALSE.
-- ============================================================================

-- ============================================================================
-- 1) Setting tenant : rabais par défaut en XOF
-- ============================================================================
ALTER TABLE tenants
  ADD COLUMN default_gros_rebate_xof NUMERIC(14,2) NOT NULL DEFAULT 0
    CHECK (default_gros_rebate_xof >= 0);

COMMENT ON COLUMN tenants.default_gros_rebate_xof IS
  'Rabais en XOF appliqué automatiquement aux produits gros_enabled=TRUE sans unit_price_gros explicite. 0 = pas de rabais (gros = détails par défaut).';

-- Permet au compte applicatif de modifier ce setting (le reste de la table
-- tenants reste lecture seule pour matix_app).
GRANT UPDATE (default_gros_rebate_xof, updated_at) ON tenants TO matix_app;

-- ============================================================================
-- 2) Flag produit : vente en gros activée
-- ============================================================================
ALTER TABLE products
  ADD COLUMN gros_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN products.gros_enabled IS
  'Si TRUE, le produit a l''option "vente en gros" au POS. Le prix gros effectif vient soit de unit_price_gros (override) soit de unit_price - tenant.default_gros_rebate_xof.';

-- Backfill : tout produit avec un unit_price_gros déjà saisi a l'option gros activée
UPDATE products SET gros_enabled = TRUE WHERE unit_price_gros IS NOT NULL;

CREATE INDEX idx_products_tenant_gros_enabled
  ON products(tenant_id, gros_enabled)
  WHERE gros_enabled = TRUE AND deleted_at IS NULL;
