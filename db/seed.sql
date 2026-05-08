-- Seed dev — 2 tenants de test pour les tests anti-fuite.
-- Exécuté par matix_admin (BYPASSRLS) après les migrations.

INSERT INTO tenants (id, slug, legal_name, status, country_code, currency, locale)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'acme', 'Acme SARL (TEST)', 'active', 'SN', 'XOF', 'fr'),
  ('22222222-2222-2222-2222-222222222222', 'beta', 'Beta SUARL (TEST)', 'active', 'SN', 'XOF', 'fr')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_members (tenant_id, user_id, email, role)
VALUES
  ('11111111-1111-1111-1111-111111111111', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner@acme.test', 'owner'),
  ('22222222-2222-2222-2222-222222222222', '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner@beta.test', 'owner')
ON CONFLICT DO NOTHING;
