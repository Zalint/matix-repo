-- Migration 0010 — Modules inspirés des workflows n8n existants
--
-- Ajoute 4 nouveaux modules au catalogue (déclarés dans catalog.ts) :
--   - platform.integrations          (Phase 2)
--   - platform.workflows             (Phase 4)
--   - analytics.ai.agent             (Phase 2)
--   - analytics.reports.daily_digest (Phase 2)
--
-- Met à jour les plans Pro et Enterprise pour les inclure :
--   - Pro:        + integrations + ai.agent + reports.daily_digest
--   - Enterprise: + tous les ci-dessus + workflows
--   - Free, Starter: aucun (modules avancés)
--
-- Met à jour les tenant_licenses existants pour propager le changement
-- aux tenants déjà en plan Pro / Enterprise.

-- 1. Ajouter les modules aux plans existants
UPDATE plans
SET modules = modules || ARRAY['platform.integrations', 'analytics.ai.agent', 'analytics.reports.daily_digest']::TEXT[],
    updated_at = NOW()
WHERE code = 'pro';

-- Le plan Enterprise est seedé avec [] (rempli au runtime), donc rien à faire ici.
-- Le plan Free et Starter restent inchangés (modules avancés).

-- 2. Propager aux tenants en plan Pro
INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)
SELECT t.id, m.module_code, TRUE, 'plan'
  FROM tenants t
  JOIN plans p ON p.id = t.plan_id
  CROSS JOIN UNNEST(ARRAY['platform.integrations', 'analytics.ai.agent', 'analytics.reports.daily_digest']) AS m(module_code)
 WHERE p.code = 'pro'
   AND t.deleted_at IS NULL
ON CONFLICT (tenant_id, module_code) DO UPDATE SET enabled = TRUE, source = 'plan', updated_at = NOW();

-- Note: les tenants Enterprise reçoivent automatiquement les nouveaux modules
-- via le runtime (le code applicatif lit MODULE_CATALOG, pas plans.modules).
