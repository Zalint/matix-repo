-- ============================================================================
-- Dedup produits + family categories
--
-- 1. Set product_categories.family = 'boucherie' / 'epicerie'
-- 2. Build dedup map (canonical = highest SKU number per tenant+category+lower(name))
-- 3. Re-point stock_movements / stock_levels / sale_items vers canonique
-- 4. Soft-delete les doublons
-- ============================================================================

BEGIN;

-- 1. Family
UPDATE product_categories SET family = 'boucherie', updated_at = NOW()
WHERE name IN ('Bovin','Ovin','Volaille','Caprin','Poisson','Pack');

UPDATE product_categories SET family = 'epicerie', updated_at = NOW()
WHERE name = 'Autres';

-- 2. Dedup map (tous tenants)
CREATE TEMP TABLE dedup_map AS
WITH ranked AS (
  SELECT p.id, p.name, p.tenant_id, p.category_id,
    ROW_NUMBER() OVER (
      PARTITION BY p.tenant_id, p.category_id, LOWER(TRIM(p.name))
      ORDER BY
        COALESCE(NULLIF(regexp_replace(p.sku, '\D+','','g'), '')::int, 0) DESC,
        p.created_at DESC
    ) AS rnk
  FROM products p
  WHERE p.deleted_at IS NULL
),
canonicals AS (
  SELECT id AS canon_id, tenant_id, category_id, LOWER(TRIM(name)) AS canon_lower
  FROM ranked WHERE rnk = 1
)
SELECT r.id AS dup_id, c.canon_id, r.tenant_id
FROM ranked r
JOIN canonicals c
  ON c.tenant_id = r.tenant_id
  AND c.category_id IS NOT DISTINCT FROM r.category_id
  AND c.canon_lower = LOWER(TRIM(r.name))
WHERE r.rnk > 1;

-- 3. Re-point stock_movements (pas de UNIQUE → simple UPDATE)
UPDATE stock_movements sm
SET product_id = dm.canon_id
FROM dedup_map dm
WHERE sm.product_id = dm.dup_id;

-- 4. Merge stock_levels (UNIQUE sur tenant+product+pos → INSERT ON CONFLICT puis DELETE)
INSERT INTO stock_levels (tenant_id, product_id, point_of_sale_id, quantity_on_hand, quantity_reserved, updated_at)
SELECT sl.tenant_id, dm.canon_id, sl.point_of_sale_id,
       SUM(sl.quantity_on_hand),
       SUM(sl.quantity_reserved),
       NOW()
FROM stock_levels sl
JOIN dedup_map dm ON dm.dup_id = sl.product_id
GROUP BY sl.tenant_id, dm.canon_id, sl.point_of_sale_id
ON CONFLICT (tenant_id, product_id, point_of_sale_id)
DO UPDATE SET
  quantity_on_hand = stock_levels.quantity_on_hand + EXCLUDED.quantity_on_hand,
  quantity_reserved = stock_levels.quantity_reserved + EXCLUDED.quantity_reserved,
  updated_at = NOW();

DELETE FROM stock_levels WHERE product_id IN (SELECT dup_id FROM dedup_map);

-- 5. Re-point sale_items (pas de UNIQUE)
UPDATE sale_items si
SET product_id = dm.canon_id
FROM dedup_map dm
WHERE si.product_id = dm.dup_id;

-- 6. Soft-delete les doublons
UPDATE products SET deleted_at = NOW(), updated_at = NOW()
WHERE id IN (SELECT dup_id FROM dedup_map);

-- Stats
SELECT
  (SELECT COUNT(*) FROM dedup_map) AS doublons_soft_deleted,
  (SELECT COUNT(DISTINCT canon_id) FROM dedup_map) AS canoniques_avec_merges;

DROP TABLE dedup_map;

COMMIT;
