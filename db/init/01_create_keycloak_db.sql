-- ============================================================================
-- 01_create_keycloak_db.sql
--
-- Cree la base Postgres dediee a Keycloak.
-- Joue uniquement au PREMIER demarrage du conteneur Postgres (init scripts
-- ne se rejouent pas si le volume matix-pgdata existe deja).
--
-- Pour l'ajouter sur un Postgres deja initialise, voir docs/local-setup.md
-- ("Migration vers Keycloak sur Postgres").
-- ============================================================================

-- User dedie Keycloak. CREATEDB pour que Keycloak puisse creer/migrer son schema
-- via Liquibase au demarrage.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'keycloak') THEN
    CREATE USER keycloak WITH PASSWORD 'keycloak_dev';
  END IF;
END
$$;

-- Base dediee Keycloak. Idempotent via guard.
SELECT 'CREATE DATABASE keycloak OWNER keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')
\gexec

GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak;
