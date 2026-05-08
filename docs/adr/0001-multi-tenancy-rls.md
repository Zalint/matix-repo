# ADR-0001 — Multi-tenancy avec Postgres Row-Level Security

- **Statut** : Proposed
- **Date** : 2026-05-08
- **Décideurs** : Saliou Doucouré, équipe technique Matix

## Contexte

Matix vise des **milliers de tenants PME** sur une seule plateforme SaaS. Les données stockées (compta, créances, ventes, GPS livreurs, salaires) sont sensibles. Une fuite cross-tenant = mort commerciale immédiate + violation LPD Sénégal (loi 2008-12). Le pattern de tenancy choisi conditionne le schéma DB, l'ORM, les migrations, le déploiement, les backups, le RGPD et la performance. Erreur ici = réécriture massive année 2.

## Options évaluées

| Option | Isolation | Scale max réaliste | Coût opex | Migration effort | Adapté Matix |
|---|---|---|---|---|---|
| A. Database-per-tenant | Maximale | ~50-100 | Énorme (N DBs à monitorer) | × N | ❌ Réservé Phase 4 enterprise |
| B. Schema-per-tenant *(Maas App actuel)* | Forte | ~300-500 | Moyen (catalog bloat, pg_dump lent) | × N | ❌ Casse au-delà de quelques centaines |
| **C. Row-Level Security (`tenant_id` + RLS)** | Forte si discipline | ~10 000+ | Minimal | × 1 | ✅ **Choisi** |
| D. Filtre applicatif seul | ❌ Aucune (fuite si bug) | ∞ | Min | × 1 | ❌ Inacceptable B2B |

## Décision

**Row-Level Security (option C)** comme pattern unique pour Phases 1 à 3.
**Hybride** (C + A pour gros clients enterprise) en Phase 4.

## Principes

1. Toute table métier a `tenant_id UUID NOT NULL REFERENCES tenants(id)`.
2. Toute table métier active `ENABLE ROW LEVEL SECURITY` **+ `FORCE ROW LEVEL SECURITY`** (sans `FORCE`, le owner bypasse).
3. Une policy unique par table : `tenant_id = current_setting('app.tenant_id')::uuid`.
4. Le contexte est posé via `SET LOCAL app.tenant_id = '<uuid>'` au début de chaque transaction côté app.
5. Le user Postgres applicatif (`matix_app`) est **non-superuser** et **sans `BYPASSRLS`**.
6. Les tables système (`tenants`, `tenant_members`, `plans`) sont accessibles uniquement via le compte privilégié `matix_admin`.
7. Toute `UNIQUE` métier inclut `tenant_id` (ex : SKU unique *par tenant*).
8. Tout index commence par `tenant_id`.

## Schéma type — voir `db/migrations/0002_products.sql`

```sql
CREATE TABLE products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  sku        TEXT NOT NULL,
  ...
  UNIQUE (tenant_id, sku)
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

## Implémentation NestJS

- **Deux comptes Postgres** : `matix_app` (RLS soumis) pour l'app ; `matix_admin` (BYPASSRLS) pour migrations et jobs cross-tenant.
- **pgBouncer en transaction mode** uniquement (jamais session mode — sinon `SET` fuit entre requêtes).
- **Middleware** `TenantContextMiddleware` extrait `tenant_id` du JWT Keycloak (en Phase 0 dev : header `X-Dev-Tenant-Id`).
- **Interceptor** `TenantTxInterceptor` ouvre une transaction et applique `set_config('app.tenant_id', $1, true)` pour chaque requête HTTP. Voir [tenant-tx.interceptor.ts](../../apps/api/src/common/tenant-tx.interceptor.ts).
- **Aucun code applicatif n'écrit `WHERE tenant_id = ...`** — le filtre est en DB. Si tu en vois un en review, c'est un bug ou une opération admin déguisée.

## Keycloak

- **1 seul realm "Matix"** (pas de realm-per-tenant — ne scale pas).
- User Keycloak avec attribut custom `tenant_ids[]` (un user peut être dans plusieurs tenants).
- Au login, l'utilisateur choisit son tenant actif → mapper de protocole ajoute la claim `tenant_id` dans le JWT.
- JWT contient : `sub` (user_id), `tenant_id`, `roles[]`, `email`.
- Switch de tenant = re-login ou refresh avec contexte mis à jour.
- Source de vérité de l'appartenance = table `tenant_members` côté DB Matix.

## Tests anti-fuite — NON NÉGOCIABLES

Bloquants en CI. Voir [multi-tenant-isolation.e2e-spec.ts](../../apps/api/test/multi-tenant-isolation.e2e-spec.ts).

```ts
it('tenant B never sees tenant A products via API', async () => { ... });
it('tenant B cannot UPDATE tenant A product even by guessing UUID', async () => { ... });
it('RLS at DB level: SET app.tenant_id = B then SELECT WHERE tenant_id = A returns 0', async () => { ... });
```

Plus :
- **Lint custom** : toute migration `CREATE TABLE` sans `ENABLE ROW LEVEL SECURITY` + `FORCE` + policy → CI fail.
- **Test scanné en CI** : pour chaque table métier listée dans un manifest, vérifier que RLS est `enabled` ET `forced` ET qu'au moins une policy existe.

## Pitfalls (à inscrire dans la doc dev)

1. Oublier `FORCE` → propriétaire bypass RLS, fuite garantie.
2. Connecter l'app avec un superuser ou `BYPASSRLS` → RLS ignoré silencieusement.
3. pgBouncer en session-mode → `SET` (sans LOCAL) fuit entre requêtes. Toujours `SET LOCAL` / `set_config(..., true)`.
4. `current_setting('app.tenant_id', true)` (avec `true`) → renvoie `''` si non set ; préférer **sans `true`** pour fail loud.
5. `UNIQUE(sku)` au lieu de `UNIQUE(tenant_id, sku)` → premier tenant qui crée un SKU le bloque pour tout le monde.
6. FK cross-tenant non vérifiées : ex `order.customer_id` peut pointer vers un customer d'un autre tenant si bug app. Mitigation : trigger `BEFORE INSERT` ou check applicatif sur les FK sensibles.
7. Jobs background (BullMQ) : le worker doit re-poser `SET LOCAL app.tenant_id` à partir des metadata du job. Helper centralisé obligatoire.
8. Migrations : tournent avec `matix_admin` (BYPASSRLS) — bien, mais tester en CI que `matix_app` ne peut PAS lire cross-tenant après chaque migration.
9. Analytics cross-tenant pour le SaaS lui-même → utiliser `matix_admin`, séparé, audité.
10. Dériver le `tenant_id` du JWT, **jamais** d'un param URL ou body.

## Performance

- Index composite `(tenant_id, <colonne_filtrée>)` sur les patterns fréquents.
- RLS policy simple (`= comparison`) = surcoût négligeable (<1%).
- Pas de partitioning Phase 1-3. À envisager Phase 4 si un tenant approche 50M lignes sur une table chaude.

## Backups & DR

- **Phase 1** : backup full cluster (Hetzner snapshots + `pg_basebackup` quotidien sur R2). RPO 24h, RTO 4h.
- **Phase 2** : ajout WAL archiving + PITR (RPO < 5 min).
- **Restore sélectif d'un tenant** : non trivial avec RLS — restore d'un cluster shadow + extraction `COPY ... WHERE tenant_id = X` + import prod. À designer Phase 3, pas blocker MVP.

## RGPD / LPD Sénégal — lifecycle

| Action | Implémentation |
|---|---|
| Export tenant (portabilité) | Job qui extrait toutes tables `WHERE tenant_id = X` en JSON+CSV, livré sous 30j |
| Suspend | `tenants.status = 'suspended'` ; AuthGuard refuse 423 |
| Soft delete | `tenants.deleted_at = now()` ; data conservée 30j pour récup |
| Hard delete | Job de purge `DELETE WHERE tenant_id = X` table par table (ordre des FKs) ; audit anonymisé conservé |

## Conséquences

**Positives**
- Scale ~10 000+ tenants sur une instance Postgres.
- Coût infra minimal (1 DB, 1 schéma, 1 pipeline migrations).
- Cohérent avec budget infra $1000/mo Phase 1.

**Négatives / risques**
- Discipline obligatoire — chaque migration revue manuellement (atténuation : lint + tests CI).
- Risque humain — un oubli RLS = fuite (atténuation : tests anti-fuite obligatoires + revue PR à 2).
- Restore par tenant non trivial — accepté Phase 1.

## Alternatives futures

- **Phase 4 hybride** : tier "Enterprise Isolated" → DB Postgres dédiée derrière la même API. Routing au niveau pool (clé `tenant_id` → connection string). Migration `RLS → DB dédiée` = `pg_dump --filter` + `pg_restore`.

## Action items pour passer en `Accepted`

1. Saliou : valide ou challenge les principes.
2. POC Phase 0 : module `products` complet (controller + service + migrations + tests anti-fuite passants) — **livré dans ce repo**.
3. Revue Saliou + dev senior, ajustements.
4. Statut → `Accepted`, le pattern devient référence pour tous les modules suivants.
