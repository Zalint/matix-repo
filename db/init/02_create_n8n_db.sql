-- ============================================================================
-- 02_create_n8n_db.sql
--
-- Cree la base Postgres dediee a n8n (orchestrateur de workflows).
-- Joue uniquement au PREMIER demarrage du conteneur Postgres (init scripts
-- ne se rejouent pas si le volume matix-pgdata existe deja).
--
-- Pour l'ajouter sur un Postgres deja initialise (cas typique) :
--   docker exec -i matix-postgres psql -U matix_admin -d postgres < db/init/02_create_n8n_db.sql
--
-- n8n est en profile docker-compose 'extras' — pas demarre par defaut.
-- ============================================================================

-- User dedie n8n
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n') THEN
    CREATE USER n8n WITH PASSWORD 'n8n_dev';
  END IF;
END
$$;

-- Base dediee n8n. Idempotent via guard.
SELECT 'CREATE DATABASE n8n OWNER n8n'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n')
\gexec

GRANT ALL PRIVILEGES ON DATABASE n8n TO n8n;
