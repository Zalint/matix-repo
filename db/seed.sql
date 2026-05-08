-- Seed dev — 2 tenants de test pour les tests anti-fuite.
-- Exécuté par matix_admin (BYPASSRLS) après les migrations.

INSERT INTO tenants (id, slug, legal_name, status, country_code, currency, locale)
VALUES
  ('a1111111-1111-4111-8111-111111111111', 'acme', 'Acme SARL (TEST)', 'active', 'SN', 'XOF', 'fr'),
  ('b2222222-2222-4222-8222-222222222222', 'beta', 'Beta SUARL (TEST)', 'active', 'SN', 'XOF', 'fr')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_members (tenant_id, user_id, email, role)
VALUES
  ('a1111111-1111-4111-8111-111111111111', 'a1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner@acme.test', 'owner'),
  ('b2222222-2222-4222-8222-222222222222', 'b2222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner@beta.test', 'owner')
ON CONFLICT DO NOTHING;
