# Matix — Architecture FAQ

> 20 questions/réponses pour comprendre les choix architecturaux de Matix.
> Doc d'onboarding pour nouveaux devs, support pour audits techniques et discussions investisseurs.
>
> Pour aller plus loin sur un sujet : voir les ADRs (`docs/adr/`) et les docs détaillées
> (`architecture-explained.md`, `granularity-and-scalability.md`).

## Sommaire

- [Multi-tenant & RLS](#multi-tenant--rls) — Q1 à Q5
- [Auth & Keycloak](#auth--keycloak) — Q6 à Q10
- [Modularité, licensing, permissions](#modularité-licensing-permissions) — Q11 à Q15
- [Stack, scaling, infra dev](#stack-scaling-infra-dev) — Q16 à Q20

---

## Multi-tenant & RLS

### Q1. Pourquoi RLS Postgres plutôt que schema-per-tenant ou database-per-tenant ?

Schema-per-tenant (ce que faisait Maas App) casse au-delà de ~300 tenants : chaque migration =
N migrations à appliquer, `pg_dump` devient lent, le catalogue Postgres bloate, l'onboarding
prend des minutes. DB-per-tenant explose les coûts ops (N bases à monitorer, backuper, patcher).

RLS = 1 schema partagé, 1 migration unique, scaling à 10k+ tenants avec marge constante par tenant.
Référence : **ADR-0001**.

### Q2. Si un dev oublie `WHERE tenant_id = ?`, que se passe-t-il ?

Rien de grave. La policy RLS Postgres applique automatiquement
`tenant_id = current_setting('app.tenant_id')::uuid` à toutes les queries du compte `matix_app`.

Le mode d'échec est **"voir moins, jamais voir plus"** : si le dev oublie un filtre, au pire la
query renvoie 0 ligne. **Aucune fuite cross-tenant possible.** C'est la DB qui filtre, pas
l'application.

### Q3. Quel est le rôle de `matix_app` vs `matix_admin` ?

| Compte | Pouvoirs | Utilisé pour |
|---|---|---|
| `matix_admin` | Superuser avec `BYPASSRLS` | Migrations, provisioning de tenant, lookup auth (extractAuthContext) |
| `matix_app` | Non-superuser, **soumis à RLS** | 99% du code métier (toutes les requêtes business) |

La séparation est la **garantie structurelle** qu'aucun chemin business ne peut leak. Si on n'avait
qu'un seul compte avec `BYPASSRLS`, les policies RLS deviendraient consultatives. Avec 2 pools
(`APP_PG_POOL` et `ADMIN_PG_POOL`), l'usage de `matix_admin` pour une route métier est un code
smell flagué en review.

### Q4. Que fait `FORCE ROW LEVEL SECURITY` (vs `ENABLE` seul) ?

`ENABLE ROW LEVEL SECURITY` active la RLS pour les autres users mais **pas pour le owner de la
table**. `FORCE ROW LEVEL SECURITY` applique la policy même au owner.

Comme Matix crée toutes les tables avec `matix_admin` (qui en devient owner), sans `FORCE` les
queries de `matix_admin` ne seraient pas filtrées — ce qu'on veut pour les ops admin. Mais on
applique systématiquement `FORCE` partout : ceinture + bretelles, et c'est `BYPASSRLS` (privilège
du rôle, pas de la table) qui décide qui contourne.

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE  ROW LEVEL SECURITY;
```

### Q5. Comment `app.tenant_id` est-elle posée à chaque requête ?

Le `TenantTxInterceptor` NestJS exécute pour chaque requête HTTP métier :

```ts
const client = await pool.connect();          // user matix_app
await client.query('BEGIN');
await client.query(
  `SELECT set_config('app.tenant_id', $1, true)`,  // 'true' = SET LOCAL
  [tenantId],
);
cls.set('pgClient', client);                  // partagé via AsyncLocalStorage
// ... le service métier exécute ses queries via getTenantPgClient(cls)
await client.query('COMMIT');
client.release();
```

Tous les services métier dans la requête utilisent la **même connexion** = la même `app.tenant_id`.
Le `SET LOCAL` est scopé à la transaction → quand `COMMIT` ou `ROLLBACK` s'exécute, la GUC
disparaît. Deux requêtes simultanées sur 2 connexions différentes ne se voient jamais.

---

## Auth & Keycloak

### Q6. Pourquoi Keycloak plutôt qu'un auth maison ?

- **OIDC standard** → intégrations futures triviales (mobile, tiers, apps externes)
- **MFA, lockout, password policies, refresh tokens** : déjà là, pas à réinventer
- **Coût** : gratuit (self-hosted), seul l'opex héberge
- **Sécurité** : l'auth est un domaine où "réinventer" = produire des CVE. Keycloak audité par RedHat

Référence : **ADR-0003**.

### Q7. Pourquoi requeryer `tenant_members` à chaque requête si le JWT contient déjà `tenant_id` ?

**Defense in depth.** Le token dit X, la DB confirme X. Le JWT est une *prétention* signée par
Keycloak ; la DB est l'*autorité* présente.

#### Le scénario "Awa virée à 14h00" — détail technique

"Virer Awa" en code, c'est **deux opérations distinctes** :

```sql
-- 1. Côté DB Matix : marquer son membership inactif
UPDATE tenant_members
   SET deactivated_at = NOW()
 WHERE user_id = 'awa-uuid' AND tenant_id = 'mata-mbao-uuid';
```

```http
# 2. Côté Keycloak : désactiver son compte (optionnel mais recommandé)
PUT /admin/realms/matix/users/awa-uuid
{ "enabled": false }
```

Beaucoup de devs oublient l'étape 2. C'est exactement pour ça que la check DB en (1) est la
**seule défense réelle**.

##### Sans la check DB (mauvaise architecture)

Imaginons une API qui lit juste le JWT et fait confiance à `claims.tenant_id` + `claims.role` :

```
14h00:00 — Saliou (owner) clique « Retirer Awa »
           UPDATE tenant_members SET deactivated_at = NOW() WHERE user_id='awa-uuid'
           ✓ DB modifiée

14h00:01 — Awa (toujours sur son onglet) clique « Exporter ventes du mois »
           Browser envoie : Authorization: Bearer eyJhbGciOiJSUzI1Ni... (token émis à 14h00:00)

           API:
             ├─ Vérifie signature JWT → OK (clé publique Keycloak)
             ├─ Lit claims.tenant_id = 'mata-mbao-uuid'
             ├─ Lit claims.sub = 'awa-uuid'
             ├─ Lit claims.role = 'admin'
             └─ ✓ Sert la requête → Awa télécharge tous les CSV

           ❌ Awa exporte les données client, prix, marges, fournisseurs

14h00:02 — Awa clique « Supprimer ce client »
           DELETE /customers/123
           API:
             ├─ JWT valide ✓
             ├─ role='admin' → autorisé à delete ✓
             └─ ✓ Client supprimé

           ❌ Sabotage

14h00:03 ... 14h15:00 — pendant ces 15 minutes :
           Awa peut continuer toutes les requêtes
           Si Keycloak n'est pas désactivé : son refresh_token marche toujours
           → elle obtient un nouveau access_token à 14h14
           → 15 minutes supplémentaires de pouvoir
           → en boucle, indéfiniment, jusqu'à ce que Saliou pense aussi à désactiver KC
```

**Window de dégât = 15 min minimum, potentiellement plusieurs heures si KC oublié.**

##### Avec la check DB (Matix actuel)

```
14h00:00 — Saliou clique « Retirer Awa »
           UPDATE tenant_members SET deactivated_at = NOW() WHERE user_id='awa-uuid'

14h00:01 — Awa clique « Exporter ventes »
           API extractAuthContext :
             ├─ Vérifie signature JWT → OK
             ├─ Lit claims.sub = 'awa-uuid'
             ├─ Lit claims.tenant_id = 'mata-mbao-uuid'
             ├─ Query DB (via matix_admin pool) :
             │   SELECT role FROM tenant_members
             │    WHERE user_id = 'awa-uuid'
             │      AND tenant_id = 'mata-mbao-uuid'
             │      AND deactivated_at IS NULL
             ├─ → 0 rows
             └─ throw UnauthorizedException('membership désactivé')

           Réponse : HTTP 401
           Browser intercepte le 401 → redirect /login

14h00:01 — Awa retombe sur la page de login
           Si KC user désactivé : « Compte désactivé, contactez l'admin »
           Si KC user encore actif : login OK → mais à la 1ère requête API, 401 à nouveau
```

**Window de dégât = 1 requête, soit < 1 seconde.**

##### Et pourquoi pas des tokens de 30 secondes ?

On pourrait penser : "tokens super courts, pas besoin de check DB". Mauvaise idée :
- 30s = refresh call toutes les 30s par user → 100 req/min/user juste pour rafraîchir
- 100 users × 100 req/min = 10 000 req/min sur Keycloak → KC devient SPOF
- Tu n'as pas résolu le problème, juste réduit la window de 15 min à 30 s

**La check DB est la solution propre.** Elle coûte ~5 ms par requête (1 SELECT indexé) et ferme
la window à zéro.

### Q8. Pourquoi 2 modes d'auth (`dev` vs `keycloak`) ?

| Mode | Header/Token | Usage | Vitesse |
|---|---|---|---|
| `dev` | `X-Dev-Tenant-Id`, `X-Dev-User-Id` | Tests e2e, CI, dev local | ~ms (pas de minting JWT) |
| `keycloak` | `Authorization: Bearer eyJ...` | Staging, prod | ~30 ms (vérification signature) |

Crucialement : **après l'extraction de contexte, le code applicatif est identique**. Même
transaction DB, mêmes policies RLS, mêmes guards, mêmes services. Ce que tu testes en `dev` est
fidèlement ce qui tourne en prod. **Pas de raccourci dev qui cacherait un trou de sécurité.**

```ts
// extract-context.ts — la SEULE fonction qui change selon le mode
if (process.env.AUTH_MODE === 'dev') {
  // Lit X-Dev-Tenant-Id et X-Dev-User-Id (confiance — on est en dev)
} else {
  // Vérifie signature JWT contre la clé publique Keycloak
}
// → puis exactement la même check DB tenant_members dans les 2 cas
```

### Q9. Pourquoi le rôle vient toujours de la DB et jamais du JWT ?

Le rôle change pour 3 raisons :
1. Promotion (member → superviseur)
2. Rétrogradation (admin → member)
3. Erreur à corriger (owner clique le mauvais bouton)

Si le rôle est figé dans le JWT au moment du login, il ne peut pas refléter les changements
intervenus pendant la durée de vie du token (~15 min).

#### Exemple concret : la rétrogradation accidentelle

```
13h00:00 — Saliou veut promouvoir Awa de « member » à « superviseur »
           Il clique le mauvais bouton et la passe à « admin » par erreur
           UPDATE tenant_members SET role = 'admin' WHERE user_id = 'awa-uuid'

13h00:05 — Awa fait une nouvelle requête. Son token actuel est de tout à l'heure (role: 'member')

           CAS 1 : SI le rôle venait du JWT
             ├─ JWT.role = 'member'
             ├─ Refuse les actions admin
             └─ ❌ La promotion (légitime) n'a pas pris effet
                 → Saliou doit la faire se reconnecter pour que ça marche

           CAS 2 : Matix actuel (rôle DB)
             ├─ extractAuthContext requery tenant_members → role='admin'
             ├─ Awa peut faire des actions admin ✓
             └─ ✓ Promotion immédiatement effective

13h05:00 — Saliou réalise son erreur et la rétrograde à 'member'
           UPDATE tenant_members SET role = 'member' WHERE user_id = 'awa-uuid'

13h05:30 — Awa (qui ne sait pas qu'elle a été rétrogradée) clique « Supprimer ce produit »
           (action réservée admin)

           CAS 1 : SI le rôle venait du JWT
             ├─ JWT.role = 'admin' (toujours, jusqu'à expiration à 13h15)
             ├─ ✓ DELETE autorisé
             └─ ❌ Awa supprime un produit qu'elle ne devrait pas
                 → 10 minutes de pouvoir admin fantôme

           CAS 2 : Matix actuel (rôle DB)
             ├─ extractAuthContext → role='member'
             ├─ Guard refuse l'action admin
             └─ ✓ HTTP 403, aucun dégât
```

#### Comment c'est implémenté concrètement

Dans `apps/api/src/common/auth/extract-context.ts` (simplifié) :

```ts
export async function extractAuthContext(req, adminPool): Promise<AuthContext> {
  // 1. Source d'identité — du JWT (ou des headers en mode dev)
  const { sub: userId, tenant_id: tenantIdClaim } = await verifyKeycloakJwt(req);

  // 2. Source d'autorité — TOUJOURS la DB
  const { rows } = await adminPool.query(
    `SELECT role
       FROM tenant_members
      WHERE user_id = $1
        AND tenant_id = $2
        AND deactivated_at IS NULL`,
    [userId, tenantIdClaim],
  );

  if (rows.length === 0) {
    throw new UnauthorizedException('Membership inactif ou inexistant');
  }

  return {
    userId,
    tenantId: tenantIdClaim,
    role: rows[0].role,    // ← DB, pas JWT
  };
}
```

#### Bonus : le rôle DB protège aussi contre une compromission Keycloak

Imaginons un attaquant qui vole la clé privée Keycloak. Il peut générer des JWT arbitraires :

```json
{ "sub": "fake-user", "tenant_id": "mata-mbao", "role": "owner" }
```

Sur une archi qui fait confiance au token : 🔥 game over.

Sur Matix :
- Vérification signature → ✓ (la clé volée signe correctement)
- Query `tenant_members WHERE user_id='fake-user'` → **0 lignes**
- 401, attaque bloquée

La DB est une **deuxième frontière** indépendante de Keycloak. Pour passer, il faudrait
compromettre **les deux** (clé KC + accès écriture sur la DB).

### Q10. Que se passe-t-il si Keycloak tombe ?

| État | Comportement |
|---|---|
| **JWT déjà émis** | Continuent à fonctionner jusqu'à expiration (~15 min). L'API vérifie la signature en local via la clé publique cachée — **pas d'appel à Keycloak en chemin chaud**. |
| **Nouveau login** | Impossible jusqu'au retour de Keycloak. |
| **Refresh token** | Impossible — Keycloak doit valider le refresh. |

→ Dégradation **graceful** sur ~15 min, pas de blast radius global. Les utilisateurs déjà connectés
ne s'en aperçoivent pas, sauf à devoir se reconnecter au prochain refresh.

---

## Modularité, licensing, permissions

### Q11. Pourquoi un catalogue centralisé de modules ?

Source unique de vérité dans `apps/api/src/modules/licensing/catalog.ts`. Permet de :
- **Vendre des plans flexibles** (Free, Starter, Pro, Enterprise) qui sont juste des sous-ensembles
- **Activer un add-on sans déployer** : 1 INSERT dans `tenant_licenses`
- **Tracker exactement ce qu'a un client** (auditable, reportable)
- **Le `LicensingGuard` NestJS** lit le catalogue et bloque l'accès aux modules non licenciés
  (HTTP 402 Payment Required)

Référence : **ADR-0005**, **ADR-0006**.

### Q12. Comment `plans`, `tenant_licenses`, `role_permissions` interagissent ?

| Table | Rôle | Exemple |
|---|---|---|
| `plans` | Catalogues commerciaux globaux | `Pro` → liste de 78 modules |
| `tenant_licenses` | Matérialisation par tenant | `(mata-mbao, commercial.sales.pos, enabled, plan)` |
| `role_permissions` | Qui peut faire quoi sur les modules activés | `(mata-mbao, member, sales.pos, [read,write])` |

À chaque requête, le `LicensingGuard` vérifie d'abord la **licence** (HTTP 402 si non payée) puis la
**permission** (HTTP 403 si non autorisée). Les 2 sont des SELECTs indexés (~5 ms total).

### Q13. Pourquoi licences et permissions sont orthogonales ?

- **Licence** = "ce tenant a-t-il payé pour ce module ?" (axe **commercial**)
- **Permission** = "cet utilisateur a-t-il le droit de faire cette action ?" (axe **organisationnel**)

Elles répondent à 2 questions différentes. Les coupler ferait que :
- Changer un plan recâblerait les permissions internes du tenant ❌
- Promouvoir Awa en superviseur affecterait la facturation ❌

Mauvais design. Garder les axes séparés permet à chacun de bouger sans toucher à l'autre.
Référence : **ADR-0006**.

| | Licence sales.pos ? | Permission write d'Awa ? | Comportement |
|---|---|---|---|
| Cas 1 | ✓ activée | ✓ accordée | ✅ Awa peut encaisser |
| Cas 2 | ✓ activée | ✗ refusée | ❌ 403 — module dispo, mais pas pour Awa |
| Cas 3 | ✗ pas activée | ✓ accordée | ❌ 402 — module pas payé, peu importe le rôle |

### Q14. Comment onboarder un nouveau tenant techniquement ?

4 actions, ~360 ms au total :

```sql
-- 1. Création du tenant
INSERT INTO tenants (slug, legal_name, ...) VALUES (...);                 -- ~10 ms

-- 2. Activation des modules selon le plan choisi
INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)
SELECT $1, unnest(p.modules), TRUE, 'plan'
  FROM plans p WHERE p.code = 'starter';                                 -- ~50 ms

-- 3. Permissions par défaut (5 rôles × N modules × 3 actions)
INSERT INTO role_permissions (...);                                       -- ~100 ms
```

```http
# 4. Création du user owner via l'API admin Keycloak
POST /admin/realms/matix/users
{ "email": "owner@boulangerie-diop.sn", "attributes": { "tenant_id": "..." } }
# ~200 ms
```

**Pas de migration. Pas de redéploiement. Pas de DevOps.** Ça se fait à chaud pendant que les
autres tenants utilisent l'app.

### Q15. Pourquoi granularité au module et pas au feature ?

- **Trop gros** (`commercial`) = client paie POS + abonnements même s'il fait que du retail
  → over-pricing, perte de deals
- **Trop fin** (`sales.pos.button.encaisser`) = ingérable, ~500 toggles à maintenir
  → cauchemar pour le commercial qui doit pricer

**Le module est la plus petite unité commercialement vendable.** C'est le niveau où le commercial
peut dire "ça c'est +5000F/mois" sans se mêler les pinceaux. Le bon trade-off entre flexibilité
business et complexité config.

---

## Stack, scaling, infra dev

### Q16. Pourquoi `pg` direct + RLS plutôt qu'un ORM (Sequelize / Prisma / TypeORM) ?

Le pattern RLS impose qu'**une seule connexion** voie le `SET LOCAL app.tenant_id` pour toute la
transaction. Sequelize/Prisma gèrent leur propre pool et choisissent la connexion par query → ils
peuvent envoyer la query métier sur une autre connexion qui n'a pas la GUC posée → policy = NULL =
**blocage de toutes les requêtes** (mode d'échec safe mais inutilisable).

Drizzle (déjà en deps) accepte un client `pg` injecté → utilisable plus tard pour le typage sans
casser le pattern :

```ts
const db = drizzle(getTenantPgClient(this.cls));   // client RLS-scopé
const rows = await db.select().from(products);    // typed + sur la bonne connexion
```

### Q17. Pourquoi monolithe modulaire et pas microservices ?

- **1 codebase** = 1 pipeline CI, 1 process à monitorer, 0 distributed tracing à mettre en place
- **Atomicité naturelle** : `sales → inventory` se fait en 1 transaction Postgres, pas en saga
  distribuée avec compensation
- **Module-as-NestJS-module** : déjà découpés en bounded contexts, donc le jour où il faut
  extraire `delivery.gps` (qui ping toutes les 30s) en microservice → faisable **sans toucher
  au reste**

Microservices = optimisation **prématurée** pour un produit en Phase 0/1. À garder en option
pour Phase 4 si un module devient un goulot d'étranglement spécifique.

### Q18. Comment Matix passe de 100 à 100 000 tenants sans changer le code ?

À chaque palier, ce qui change c'est l'infra, pas l'app :

| Tenants | Infra | Coût | Marge/tenant |
|---|---|---|---|
| 100 | 1 API + 1 Postgres | ~30 €/mois | 14 700 XOF/mois |
| 1 000 | 2-3 API + Postgres + read-replica | ~150 €/mois | 14 850 XOF/mois |
| 10 000 | 10 API + Redis cache + pgbouncer | ~2 000 €/mois | 14 700 XOF/mois |
| 100 000 | K8s autoscale + sharding tenant_id ou région | ~30 000 €/mois | 14 700 XOF/mois |

L'API est **stateless** (token + transaction = autosuffisant), donc on lance N instances derrière
un load balancer, n'importe laquelle peut servir n'importe quel tenant. La **marge unitaire par
tenant reste constante** — c'est ça le test d'une archi qui scale.

### Q19. Pourquoi Docker pour Postgres+Keycloak mais pas pour API+Web en dev ?

| Couche | Runtime dev | Pourquoi |
|---|---|---|
| Postgres, Keycloak | **Docker** (fixe et serveur) | Version figée, parité prod, onboarding 5 min, isolation |
| API, Web | **Node natif** (en mutation) | Hot reload instantané, debugger IDE direct, build TypeScript natif |

3 raisons concrètes pour NE PAS Dockeriser l'API/Web en dev :
1. **Hot reload cross-OS** : monter `/apps` Windows→Linux conteneur via 9p / VirtioFS = 200-500 ms
   de retard sur chaque save → expérience misérable
2. **Debugger** : brancher un debugger Node sur un process en conteneur = port-forward,
   `--inspect=0.0.0.0:9229`, mapping de paths source. En natif : zéro config dans VS Code
3. **Build TypeScript** : `next build` ou `tsc` dans un volume cross-OS = 3 à 10× plus lent que
   natif → on push à CI pour voir les erreurs → 10 min perdues par tentative

**Règle** : Docker pour ce qui est *fixe et serveur* ; natif pour ce qui est *en mutation et
applicatif*. Cf. `granularity-and-scalability.md` §8.

### Q20. Quelles sont les limitations connues et acceptées ?

| # | Limitation | Pourquoi acceptée maintenant | Mitigation prévue |
|---|---|---|---|
| 1 | Tous les tenants dans le même Postgres | Suffisant à 100 tenants | Read-replica pour analytics à 100+ |
| 2 | Pas de cache permissions (5 ms par requête) | Négligeable à 1000 req/jour | Redis avec TTL 1 min à 100k tenants |
| 3 | 1 user = 1 tenant | Pas un cas d'usage Phase 1 (employés mono-boutique) | `tenant_ids[]` + selector UI Phase 3 |
| 4 | API monolithique (redémarrage = downtime) | <5 s acceptable B2B heures ouvrées | Blue-green deployment Phase 2 |
| 5 | `sales` couplé à `inventory` | Cohérence forte stock = transaction atomique requise | Aucune raison de splitter, jamais |

Aucune archi n'est parfaite. Ces limitations sont **conscientes** et chacune a un chemin de
sortie clair quand le besoin se présentera.

---

## Pour aller plus loin

- **`docs/architecture-explained.md`** — Comment auth + multi-tenant fonctionnent en détail
  (ton accessible non-tech, exemples Mata Mbao)
- **`docs/granularity-and-scalability.md`** — Granularité 50 modules + Docker rationale + scaling
  100 → 100k tenants
- **`docs/business-rules-catalog.md`** — Pépites métier des 3 apps Mata existantes
- **`docs/local-setup.md`** — Démarrage Docker + troubleshooting
- **`docs/feature-coverage-vs-mata-apps.md`** — Audit comparatif Matix vs Maas/MLC/Dépenses
- **ADRs** dans `docs/adr/` — Décisions architecturales formelles (0001-0007)
