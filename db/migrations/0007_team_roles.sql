-- Migration 0007 — Étend les rôles tenant_members pour ajouter 'superviseur'
-- Hiérarchie : owner > admin > superviseur > member > readonly

ALTER TABLE tenant_members DROP CONSTRAINT IF EXISTS tenant_members_role_check;

ALTER TABLE tenant_members ADD CONSTRAINT tenant_members_role_check
  CHECK (role IN ('owner','admin','superviseur','member','readonly'));

-- Soft-delete pour pouvoir retirer un user sans casser les FK historiques
ALTER TABLE tenant_members ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tenant_members_active
  ON tenant_members(tenant_id, user_id) WHERE deactivated_at IS NULL;
