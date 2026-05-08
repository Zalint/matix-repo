-- Bootstrap pour install Postgres NATIVE (sans Docker).
-- À exécuter UNE FOIS sur la DB `matix` en tant que superuser `postgres`.
-- En Docker, c'est `00_create_app_user.sql` qui fait l'équivalent automatiquement.

-- Roles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matix_admin') THEN
    CREATE USER matix_admin WITH PASSWORD 'matix_admin_dev' SUPERUSER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matix_app') THEN
    CREATE USER matix_app WITH PASSWORD 'matix_app_dev'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- Droits sur la DB matix (à exécuter connecté à matix)
GRANT CONNECT ON DATABASE matix TO matix_app;
GRANT USAGE ON SCHEMA public TO matix_app;

-- Privilèges par défaut sur les futures tables créées par matix_admin
-- (le FOR ROLE est CRITIQUE — sans lui, ne s'applique qu'aux tables créées par postgres)
ALTER DEFAULT PRIVILEGES FOR ROLE matix_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO matix_app;
ALTER DEFAULT PRIVILEGES FOR ROLE matix_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO matix_app;
