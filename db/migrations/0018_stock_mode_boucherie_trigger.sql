-- Migration 0018 — Force stock_mode='manuel' pour les produits Boucherie
--
-- La migration 0014 faisait un BACKFILL one-shot : tous les produits
-- existants dont la catégorie a family='Boucherie' passaient à 'manuel'.
-- Mais elle ne couvrait PAS les produits créés après. Bug constaté avec le
-- seed mata-mbao-foire : 5 produits Bovin + 5 Ovin créés avec le default
-- 'automatique' alors qu'ils devraient être 'manuel'.
--
-- Solution : trigger BEFORE INSERT OR UPDATE sur products qui :
--   - si la catégorie a family='Boucherie' → force stock_mode='manuel'
--   - sinon laisse la valeur saisie (ou default)
--
-- Cas couverts :
--   - INSERT : un nouveau produit créé avec category_id Boucherie → manuel
--   - UPDATE de category_id : si on bascule un produit vers Boucherie, il
--     passe automatiquement en manuel
--   - UPDATE manuel de stock_mode : un user peut TOUJOURS forcer 'manuel'
--     ou 'automatique' explicitement après coup (le trigger ne tape qu'à
--     l'insert si non spécifié, et au changement de catégorie)
--
-- Plus un backfill correctif pour les produits actuels mal classés.
-- ============================================================================

-- ============================================================================
-- 1) Backfill correctif : produits Bovin/Ovin (family='Boucherie') créés
--    après la migration 0014 et restés en 'automatique'.
-- ============================================================================
UPDATE products p
   SET stock_mode = 'manuel', updated_at = NOW()
  FROM product_categories pc
 WHERE p.category_id = pc.id
   AND pc.family = 'Boucherie'
   AND p.stock_mode != 'manuel'
   AND p.deleted_at IS NULL;

-- ============================================================================
-- 2) Trigger qui force stock_mode = 'manuel' à l'INSERT si la catégorie
--    est Boucherie. Et au UPDATE si category_id change vers une catégorie
--    Boucherie.
--
-- Note : on ne force pas au UPDATE de stock_mode lui-même — l'utilisateur
-- doit pouvoir explicitement basculer en 'automatique' même pour un produit
-- Boucherie (cas légitime : un produit fini issu d'une découpe que le
-- système peut calculer automatiquement).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_force_stock_mode_boucherie()
RETURNS TRIGGER AS $$
DECLARE
  v_family TEXT;
  v_category_changed BOOLEAN;
BEGIN
  -- Détecte si on insère ou si la catégorie change
  v_category_changed := (TG_OP = 'INSERT')
                     OR (TG_OP = 'UPDATE' AND NEW.category_id IS DISTINCT FROM OLD.category_id);

  IF NOT v_category_changed THEN
    RETURN NEW;
  END IF;

  -- Pas de catégorie → on laisse la valeur par défaut
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT family INTO v_family FROM product_categories WHERE id = NEW.category_id;

  IF v_family = 'Boucherie' THEN
    -- Force 'manuel' UNIQUEMENT si stock_mode n'a pas été explicitement
    -- changé dans cette opération. À l'INSERT, on a la valeur par défaut
    -- ou celle fournie ; à l'UPDATE, on suppose que si stock_mode bouge,
    -- l'utilisateur sait ce qu'il fait.
    IF TG_OP = 'INSERT' OR NEW.stock_mode = OLD.stock_mode THEN
      NEW.stock_mode := 'manuel';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_force_stock_mode_boucherie
  BEFORE INSERT OR UPDATE OF category_id ON products
  FOR EACH ROW EXECUTE FUNCTION fn_force_stock_mode_boucherie();

COMMENT ON TRIGGER trg_products_force_stock_mode_boucherie ON products IS
  'À l''INSERT ou au changement de category_id, force stock_mode=manuel si la catégorie est de famille Boucherie. L''utilisateur peut toujours basculer manuellement après coup via PATCH /products/:id/stock-mode.';
