-- Migration 0013 — Ajouter platform.workflows au plan Pro et le propager aux tenants Pro
--
-- Le module platform.workflows etait dans catalog.ts (status coming-soon) mais
-- n'a jamais ete ajoute a plans.modules pour Pro ni materialise dans tenant_licenses.
-- Resultat : LicensingGuard renvoie 402 Payment Required quand un tenant Pro
-- accede a /workflows/* (alors qu'il devrait y avoir acces).
--
-- Cette migration corrige ca pour Pro et propage aux tenants Pro existants.

-- 1. Ajouter platform.workflows aux modules du plan Pro (idempotent)
UPDATE plans
SET modules = modules || ARRAY['platform.workflows']::TEXT[],
    updated_at = NOW()
WHERE code = 'pro'
  AND NOT ('platform.workflows' = ANY(modules));

-- 2. Materialiser la licence pour les tenants en plan Pro existants
INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)
SELECT t.id, 'platform.workflows', TRUE, 'plan'
  FROM tenants t
  JOIN plans p ON p.id = t.plan_id
 WHERE p.code = 'pro'
   AND t.deleted_at IS NULL
ON CONFLICT (tenant_id, module_code) DO UPDATE SET
  enabled = TRUE,
  source = 'plan',
  updated_at = NOW();

-- Note: plan Enterprise (modules = []) recoit automatiquement tous les modules
-- via le runtime (le code applicatif lit MODULE_CATALOG, pas plans.modules).
-- Plan Free et Starter restent inchanges (module avance, reserve a Pro+).
