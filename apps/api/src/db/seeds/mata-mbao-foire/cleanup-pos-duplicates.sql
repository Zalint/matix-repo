-- Cleanup one-shot : doublon de PV "Mbao" sur tenant mata-mbao.
-- pv-1 (Mbao) et mbao (Mbao) coexistent. On migre tout vers `mbao` et supprime `pv-1`.

BEGIN;

WITH t AS (SELECT id FROM tenants WHERE slug='mata-mbao'),
     from_pos AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='pv-1'),
     to_pos   AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='mbao')
UPDATE stock_movements
   SET point_of_sale_id = (SELECT id FROM to_pos)
 WHERE point_of_sale_id = (SELECT id FROM from_pos);

WITH t AS (SELECT id FROM tenants WHERE slug='mata-mbao'),
     from_pos AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='pv-1'),
     to_pos   AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='mbao')
UPDATE sales
   SET point_of_sale_id = (SELECT id FROM to_pos)
 WHERE point_of_sale_id = (SELECT id FROM from_pos);

-- Migration stock_daily_closings : cumule si même (date, product) sur la cible, sinon migre
WITH t AS (SELECT id FROM tenants WHERE slug='mata-mbao'),
     from_pos AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='pv-1'),
     to_pos   AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='mbao')
UPDATE stock_daily_closings sdc1
   SET point_of_sale_id = (SELECT id FROM to_pos)
 WHERE point_of_sale_id = (SELECT id FROM from_pos)
   AND NOT EXISTS (
     SELECT 1 FROM stock_daily_closings sdc2
      WHERE sdc2.tenant_id = sdc1.tenant_id
        AND sdc2.closing_date = sdc1.closing_date
        AND sdc2.product_id = sdc1.product_id
        AND sdc2.point_of_sale_id = (SELECT id FROM to_pos)
   );
WITH t AS (SELECT id FROM tenants WHERE slug='mata-mbao'),
     from_pos AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='pv-1')
DELETE FROM stock_daily_closings WHERE point_of_sale_id = (SELECT id FROM from_pos);

-- reconciliation_notes : pareil, on migre ou on supprime si déjà existant côté cible
WITH t AS (SELECT id FROM tenants WHERE slug='mata-mbao'),
     from_pos AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='pv-1'),
     to_pos   AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='mbao')
UPDATE reconciliation_notes rn1
   SET point_of_sale_id = (SELECT id FROM to_pos)
 WHERE point_of_sale_id = (SELECT id FROM from_pos)
   AND NOT EXISTS (
     SELECT 1 FROM reconciliation_notes rn2
      WHERE rn2.tenant_id = rn1.tenant_id
        AND rn2.note_date = rn1.note_date
        AND rn2.point_of_sale_id = (SELECT id FROM to_pos)
   );
WITH t AS (SELECT id FROM tenants WHERE slug='mata-mbao'),
     from_pos AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='pv-1')
DELETE FROM reconciliation_notes WHERE point_of_sale_id = (SELECT id FROM from_pos);

-- stock_cuttings (les outputs cascadent via FK)
WITH t AS (SELECT id FROM tenants WHERE slug='mata-mbao'),
     from_pos AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='pv-1'),
     to_pos   AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='mbao')
UPDATE stock_cuttings
   SET point_of_sale_id = (SELECT id FROM to_pos)
 WHERE point_of_sale_id = (SELECT id FROM from_pos);

WITH t AS (SELECT id FROM tenants WHERE slug='mata-mbao'),
     from_pos AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='pv-1')
DELETE FROM stock_levels WHERE point_of_sale_id = (SELECT id FROM from_pos);

WITH t AS (SELECT id FROM tenants WHERE slug='mata-mbao'),
     to_pos AS (SELECT id FROM points_of_sale WHERE tenant_id=(SELECT id FROM t) AND code='mbao')
INSERT INTO stock_levels (tenant_id, product_id, point_of_sale_id, quantity_on_hand)
SELECT m.tenant_id, m.product_id, m.point_of_sale_id, SUM(m.quantity)
  FROM stock_movements m
 WHERE m.point_of_sale_id = (SELECT id FROM to_pos)
 GROUP BY m.tenant_id, m.product_id, m.point_of_sale_id
ON CONFLICT (tenant_id, product_id, point_of_sale_id) DO UPDATE
  SET quantity_on_hand = EXCLUDED.quantity_on_hand, updated_at = NOW();

DELETE FROM points_of_sale
 WHERE tenant_id = (SELECT id FROM tenants WHERE slug='mata-mbao')
   AND code='pv-1';

COMMIT;

SELECT code, name FROM points_of_sale
 WHERE tenant_id = (SELECT id FROM tenants WHERE slug='mata-mbao')
 ORDER BY code;
