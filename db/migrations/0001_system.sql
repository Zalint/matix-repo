-- Migration 0001 — Tables système (pas de RLS, accessibles via compte admin uniquement)
-- Exécutée par le compte matix_admin.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- tenants — la table racine du multi-tenancy
-- ============================================================================
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL,
  legal_name    TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('trial','active','suspended','churned')),
  country_code  CHAR(2) NOT NULL DEFAULT 'SN',
  currency      CHAR(3) NOT NULL DEFAULT 'XOF',
  locale        TEXT NOT NULL DEFAULT 'fr',
  ninea         TEXT,
  rc            TEXT,
  trial_ends_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_tenants_status ON tenants(status) WHERE deleted_at IS NULL;

-- ============================================================================
-- tenant_members — lien user (Keycloak sub) ↔ tenant ↔ rôle
-- ============================================================================
CREATE TABLE tenant_members (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,                    -- subject Keycloak (en dev: UUID arbitraire)
  email      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner','admin','member','readonly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX idx_tenant_members_user ON tenant_members(user_id);

-- ============================================================================
-- Le compte applicatif a accès en lecture seule aux tables système
-- (pour vérifier l'appartenance d'un user à un tenant lors de l'auth).
-- ============================================================================
GRANT SELECT ON tenants, tenant_members TO matix_app;
