-- Migration 0017 — Unicité du libellé (name) d'un point de vente par tenant
--
-- Aujourd'hui seul le code est UNIQUE (tenant_id, code). Ça permet d'avoir
-- deux PV "Mbao" avec des codes différents (pv-1 et mbao) pour le même
-- tenant, ce qui crée un doublon visuel insoluble pour l'utilisateur (il
-- voit deux "Mbao" dans le dropdown sans pouvoir les distinguer).
--
-- On ajoute une UNIQUE INDEX partiel case-insensitive sur le nom :
--   - normalisation lower(trim(name)) : "Mbao", "mbao", "Mbao " sont considérés identiques
--   - WHERE deleted_at IS NULL : un PV supprimé ne bloque pas la réutilisation du nom
--   - inclut tenant_id : la contrainte est strictement par tenant
-- ============================================================================

CREATE UNIQUE INDEX uq_points_of_sale_tenant_name_active
  ON points_of_sale(tenant_id, lower(trim(name)))
  WHERE deleted_at IS NULL;

COMMENT ON INDEX uq_points_of_sale_tenant_name_active IS
  'Empêche deux PV actifs avec le même libellé (insensible casse + espaces) pour un même tenant.';
