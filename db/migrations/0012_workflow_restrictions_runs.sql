-- Migration 0012 — Restrictions templates + audit des executions
--
-- 1. Ajoute workflow_templates.restricted_to_tenants UUID[]
--    Si vide/NULL : template visible a tous les tenants ayant les modules requis
--    Si peuple    : template visible UNIQUEMENT aux tenants listes
--
-- 2. Cree workflow_runs : audit chaque execution declenchee par le scheduler.
--    Permet de debugger qui a declenche quoi quand, et avec quel resultat.

-- ============================================================================
-- 1. Restrictions templates
-- ============================================================================
ALTER TABLE workflow_templates
  ADD COLUMN restricted_to_tenants UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN workflow_templates.restricted_to_tenants IS
  'Liste des tenant_id auxquels ce template est exclusif. Vide ARRAY = visible a tous (avec required_modules respectes). Non-vide = visible UNIQUEMENT a ces tenants.';

-- Index GIN pour les queries "WHERE :tenant_id = ANY(restricted_to_tenants)"
CREATE INDEX idx_workflow_templates_restricted ON workflow_templates USING GIN(restricted_to_tenants)
  WHERE cardinality(restricted_to_tenants) > 0;

-- ============================================================================
-- 2. Audit des executions
-- ============================================================================
CREATE TABLE workflow_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id     UUID NOT NULL REFERENCES tenant_workflow_instances(id) ON DELETE CASCADE,
  template_code   TEXT NOT NULL,                     -- denormalise pour faciliter les queries
  -- Trigger
  triggered_by    TEXT NOT NULL CHECK (triggered_by IN ('cron', 'manual', 'webhook')),
  triggered_by_user UUID,                            -- user_id qui a declenche (si manual)
  -- Execution
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error', 'timeout')),
  duration_ms     INTEGER,
  -- Resultat
  n8n_execution_id TEXT,                             -- ID de l'execution dans n8n (pour debug)
  error_message   TEXT,
  payload_summary JSONB,                             -- resume des inputs (sans secrets)
  output_summary  JSONB                              -- resume des outputs (success only)
);

CREATE INDEX idx_workflow_runs_tenant_started ON workflow_runs(tenant_id, started_at DESC);
CREATE INDEX idx_workflow_runs_instance ON workflow_runs(instance_id, started_at DESC);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status) WHERE status IN ('error', 'timeout');

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_runs
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE ON workflow_runs TO matix_app;
