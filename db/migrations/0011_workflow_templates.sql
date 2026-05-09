-- Migration 0011 — Workflow templates + instances par tenant
--
-- Modèle managé : Matix livre des templates de workflows, chaque tenant peut
-- les activer + paramétrer mais ne peut PAS créer de nouveaux templates.
-- Pour custom = ticket admin Matix (qui ajoute un template via INSERT direct).
--
-- Engine d'exécution : n8n (service Docker en profile extras).

-- ============================================================================
-- workflow_templates — global (pas de tenant_id, géré par admins Matix)
-- ============================================================================
CREATE TABLE workflow_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,                  -- ex: 'mata.daily_cash_report'
  name          TEXT NOT NULL,
  description   TEXT,
  -- JSON du workflow n8n (contenu d'un export workflow.json).
  -- NULLABLE pour permettre le seed initial sans définition (Phase 2 remplira via script
  -- qui lit infra/n8n-workflows/*.json). Contraintes NOT NULL à ajouter en migration ultérieure
  -- une fois les 3 templates remplis.
  n8n_definition JSONB,
  -- Liste des paramètres modifiables par le tenant (schéma JSON-schema simplifié)
  -- ex: [{"key":"cron","label":"Heure d'envoi","type":"time"}, {"key":"recipients","type":"emails"}]
  configurable_settings JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Modules requis pour pouvoir activer ce template
  required_modules TEXT[] NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_templates_code ON workflow_templates(code) WHERE is_active = TRUE;

-- Pas de RLS — table globale lisible par tous (lecture seule pour les tenants)
GRANT SELECT ON workflow_templates TO matix_app;

-- ============================================================================
-- tenant_workflow_instances — par tenant (RLS)
-- ============================================================================
CREATE TABLE tenant_workflow_instances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id       UUID NOT NULL REFERENCES workflow_templates(id),
  -- ID du workflow dans n8n (résultat du clone)
  n8n_workflow_id   TEXT,
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  -- Settings personnalisés par le tenant : {"cron":"0 23 * * *","recipients":["..."]}
  custom_settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Audit qui a configuré (user_id Keycloak — pas de FK car tenant_members PK composite (tenant_id, user_id))
  configured_by     UUID,
  configured_at     TIMESTAMPTZ,
  -- Dernière exécution (alimenté par callback n8n)
  last_run_at       TIMESTAMPTZ,
  last_run_status   TEXT CHECK (last_run_status IN ('success','error','running')),
  last_run_error    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, template_id)   -- 1 instance max par template par tenant
);

CREATE INDEX idx_tenant_workflows_tenant_enabled
  ON tenant_workflow_instances(tenant_id, enabled) WHERE enabled = TRUE;

ALTER TABLE tenant_workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_workflow_instances FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_workflow_instances
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_workflow_instances TO matix_app;

-- ============================================================================
-- Seed des 3 templates par défaut (issus des workflows n8n existants)
-- ============================================================================
-- Note: n8n_definition est laissé vide ici. À l'implémentation Phase 2, l'admin
-- Matix importera le JSON du workflow correspondant via un script de seed
-- (qui lit infra/n8n-workflows/*.json et fait l'INSERT).

INSERT INTO workflow_templates (code, name, description, configurable_settings, required_modules) VALUES
  (
    'mata.daily_cash_report',
    'Rapport cash/banque quotidien',
    'Récupère le statut financier (créances, dépenses, soldes) du tenant et envoie un email récapitulatif tous les soirs à 23h55. Hérité du workflow n8n MATA BANQ REPORT.',
    '[{"key":"cron","label":"Heure d''envoi","type":"time","default":"23:55"},{"key":"recipients","label":"Destinataires email","type":"emails","required":true}]'::jsonb,
    ARRAY['analytics.reports.daily_digest', 'platform.workflows']
  ),
  (
    'mata.daily_mlc_report',
    'Rapport livraisons MLC quotidien',
    'Récupère stats livreurs + table commandes MLC du jour et envoie un email à 4h30. Hérité du workflow n8n MLC N8N GMAIL V2. Requiert le module operations.delivery.orders.',
    '[{"key":"cron","label":"Heure d''envoi","type":"time","default":"04:30"},{"key":"recipients","label":"Destinataires email","type":"emails","required":true}]'::jsonb,
    ARRAY['analytics.reports.daily_digest', 'platform.workflows', 'operations.delivery.orders']
  ),
  (
    'mata.daily_business_agent',
    'Agent rapport business à la demande (16 APIs agrégées)',
    'Endpoint webhook qui agrège l''état business complet du tenant : ventes, stock, livraisons, créances, paiements Bictorys. Envoie un email récapitulatif détaillé. Hérité du workflow n8n MATA AGENT WEBHOOK ASOFTODAY. Préfigure analytics.ai.agent (LLM par-dessus).',
    '[{"key":"webhook_path","label":"Chemin webhook","type":"text","default":"mata-rapport-today"},{"key":"recipients","label":"Destinataires email","type":"emails","required":true}]'::jsonb,
    ARRAY['analytics.ai.agent', 'platform.workflows']
  )
ON CONFLICT (code) DO NOTHING;
