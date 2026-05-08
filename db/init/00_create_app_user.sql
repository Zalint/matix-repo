-- Exécuté UNE FOIS au premier démarrage Postgres (volume vide).
-- Crée le compte applicatif non-superuser, soumis à RLS.

CREATE USER matix_app WITH PASSWORD 'matix_app_dev';

-- IMPORTANT : NOSUPERUSER + NOBYPASSRLS sont les défauts, mais on les rend explicites
ALTER USER matix_app WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT CONNECT ON DATABASE matix TO matix_app;
GRANT USAGE ON SCHEMA public TO matix_app;

-- Permissions par défaut sur les futures tables (créées par les migrations admin)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO matix_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO matix_app;
