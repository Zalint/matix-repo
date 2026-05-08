# Matix — Granularité et passage à l'échelle

> Document destiné aux fondateurs, à l'équipe métier et aux nouveaux devs. Il explique :
>
> 1. **Pourquoi Matix est si granulaire** (50 modules, 6 piliers, licences et permissions orthogonales)
> 2. **Pourquoi cette granularité permet de servir des milliers de clients** sans s'effondrer
>
> Exemple courant : **Mata Mbao** (boucherie cliente) et **Awa** (caissière).

---

## Sommaire

1. [Le problème : pourquoi la plupart des SaaS ne passent pas l'échelle](#1-le-problème-)
2. [Les 4 dimensions de granularité chez Matix](#2-les-4-dimensions-de-granularité-)
3. [Pourquoi cette granularité est rare](#3-pourquoi-cette-granularité-est-rare)
4. [Comment ça permet de soutenir des milliers de clients](#4-comment-ça-permet-de-soutenir-des-milliers-de-clients)
5. [Comparaison avec l'ancien Maas App](#5-comparaison-avec-lancien-maas-app)
6. [Limites connues et choix conscients](#6-limites-connues)
7. [Que se passe-t-il quand on passe à 1 000, 10 000, 100 000 clients ?](#7-passage-à-léchelle-1000-10000-100000)
8. [Annexe — L'infra locale en Docker (et pourquoi)](#8-annexe--linfra-locale-en-docker-et-pourquoi)
9. [Glossaire](#glossaire)

---

## 1. Le problème : pourquoi la plupart des SaaS ne passent pas l'échelle

Quand une boîte commence à vendre un logiciel à plusieurs clients, elle a généralement **trois écueils**
qui la font s'effondrer dès qu'elle dépasse 50 ou 100 clients :

### Écueil 1 — Le code « tout ou rien »

L'app a une seule grosse fonctionnalité : « tout ». Le client reçoit tout le menu, qu'il en utilise 10% ou 100%.
Conséquences :
- Le client paie cher pour des features qu'il n'utilise pas → il négocie ou s'en va
- Le commercial ne peut pas vendre une « version simple à 15 000 XOF/mois » → tout le monde paie le tarif premium
- Ajouter une feature pour UN client casse l'app pour les 99 autres

### Écueil 2 — Le code « customisé par client »

Pour répondre à chaque demande, on crée des branches Git « client_mata_mbao », « client_acme », etc.
Conséquences :
- Au bout de 20 clients, on a 20 versions du code à maintenir
- Une correction de bug doit être appliquée 20 fois
- Plus personne ne sait ce qui tourne en prod sur quel client

### Écueil 3 — La base de données « bricolée »

Soit toutes les données sont dans une seule base sans isolation (et donc fuites possibles),
soit on crée une base Postgres par client (« schema-per-tenant »). Cette deuxième option est l'approche
de l'ancien Mata Maas App.

Conséquences de l'approche « schema-per-tenant » :
- Une migration de schéma = N migrations à appliquer (1 par client)
- Le backup, le monitoring, les stats, tout est multiplié par N
- À 100 clients, juste opérer la base devient un travail à temps plein
- Onboarder un nouveau client = créer un nouveau schéma → plusieurs minutes, processus manuel

**Matix a été conçu dès le départ pour éviter ces trois écueils.**

---

## 2. Les 4 dimensions de granularité

Quand on dit « Matix est granulaire », on parle de **4 axes indépendants** :

```
                   ┌────────────────────────────────────┐
                   │      4 axes de granularité          │
                   └────────────────────────────────────┘
                                   │
        ┌───────────────────┬─────┴──────┬──────────────────┐
        ▼                   ▼            ▼                  ▼
   Métier (50 modules)  Commerciale  Permissions      Technique
   « ce qu'on fait »    (licences)   (rôles)          (modules de code)
```

### 2.1 Granularité métier — 50 modules dans 6 piliers

Chaque fonctionnalité métier est définie comme un **module nommé**, dans un catalogue central
(`apps/api/src/modules/licensing/catalog.ts`). C'est la **source unique de vérité**.

| Pilier | Exemples de modules | Total |
|---|---|---|
| **Platform** | identity, team, tenants_admin, audit, notifications, files, api_keys, webhooks, settings, billing, snapshots | 11 |
| **Commercial** | crm.customers, crm.segments, crm.credits, sales.pos, sales.cash_closure, sales.reconciliation, sales.discounts, sales.loyalty, subscriptions.plans, pricing.lists, pricing.history… | 13 |
| **Operations** | inventory.levels, inventory.movements, inventory.transfers, inventory.livestock, procurement.purchase_orders, procurement.suppliers, delivery.orders, delivery.gps, delivery.scoring, hr.timesheets… | 17 |
| **Finance** | accounting.journal, accounts_payable, accounts_receivable, expenses.tracking, payments.bictorys, payments.reconciliation, tax.declarations | 7 |
| **Analytics** | dashboards.sales, dashboards.inventory, exports.csv, scheduled_reports… | 5 |
| **Marketplace** | catalog, vendors, commissions | 3 |
| **TOTAL** | | **~50** |

Chaque module a un **code unique stable** (ex : `commercial.sales.pos`), un nom localisé (FR/EN), un statut
(`active`, `beta`, `coming-soon`), et la liste des actions possibles (`read`, `write`, `delete`).

Pourquoi cette granularité est-elle au niveau du module et pas au niveau de la fonctionnalité ? Parce que
c'est le bon niveau de découpage métier :
- Trop gros (« commercial ») = un client paierait pour POS + abonnements même s'il ne fait que du retail
- Trop petit (« sales.pos.button.encaisser ») = ingérable

Le module est la **plus petite unité commercialement vendable**.

### 2.2 Granularité commerciale — chaque module licenciable séparément

Pour chaque tenant, on stocke en base **quel module est activé**. C'est la table `tenant_licenses` :

```sql
SELECT * FROM tenant_licenses WHERE tenant_id = 'mata-mbao-uuid';
```

```
| tenant_id  | module_code                      | enabled | source | expires_at |
|------------|----------------------------------|---------|--------|------------|
| mata-mbao  | commercial.crm.customers         | TRUE    | plan   | NULL       |
| mata-mbao  | commercial.sales.pos             | TRUE    | plan   | NULL       |
| mata-mbao  | operations.inventory.levels      | TRUE    | plan   | NULL       |
| mata-mbao  | operations.inventory.movements   | TRUE    | plan   | NULL       |
| mata-mbao  | commercial.sales.cash_closure    | FALSE   | plan   | NULL       |
| mata-mbao  | commercial.sales.reconciliation  | TRUE    | addon  | 2026-12-31 |
| mata-mbao  | operations.delivery.orders       | TRUE    | manual | NULL       |
```

**Ce qu'on lit ici** :
- Mata Mbao a la licence pour **POS**, **clients**, **stocks**, **mouvements** (inclus dans son plan Starter à 15 000 XOF/mois).
- Pas la **clôture de caisse** (`enabled = FALSE`).
- Mais la **réconciliation** est activée comme **add-on** (option payante au-dessus du plan, expire fin 2026).
- Et **livraison** est activée **manuellement** par Matix (offert au client, pas inclus dans son plan).

Trois sources de licence possibles, qui composent ensemble :
1. **`plan`** — vient du plan abonnement (Free / Starter / Pro / Enterprise)
2. **`addon`** — option payante au-dessus du plan
3. **`manual`** — activation manuelle par Matix (commercial, gracieux, beta-test, etc.)

À chaque requête, le **LicensingGuard** (un Guard NestJS) consulte cette table avant d'autoriser l'accès :

```ts
@Get('sales')
@RequiresModule('commercial.sales.pos', 'read')   // ← le décorateur déclenche le guard
list() { ... }
```

Si Mata Mbao essaie d'accéder à un module non licencié → **HTTP 402 Payment Required**, message
« Module non activé pour votre plan ».

### 2.3 Granularité des permissions — orthogonale aux licences

C'est un **axe complètement séparé** des licences. Une fois qu'un tenant a la licence pour un module,
encore faut-il que l'utilisateur ait la **permission** d'y accéder.

Matix a 5 rôles hiérarchiques :

```
owner (propriétaire) ▶ admin ▶ superviseur ▶ member ▶ readonly
       └─ peut tout            └─ peut         └─ peut
          faire                   manager         vendre
                                  son équipe
```

Pour chaque rôle × chaque module, on définit les **actions autorisées** (`read`, `write`, `delete`) :

```sql
SELECT * FROM role_permissions WHERE tenant_id = 'mata-mbao-uuid' AND role = 'member';
```

```
| role    | module_code                  | action  | allowed |
|---------|------------------------------|---------|---------|
| member  | commercial.sales.pos         | read    | TRUE    |
| member  | commercial.sales.pos         | write   | TRUE    |  ← peut encaisser
| member  | commercial.sales.pos         | delete  | FALSE   |  ← ne peut PAS annuler
| member  | commercial.crm.customers     | read    | TRUE    |
| member  | commercial.crm.customers     | write   | FALSE   |  ← lecture seule
| member  | platform.team                | read    | FALSE   |  ← ne voit pas l'équipe
```

Awa (rôle `member`) peut donc :
- Encaisser des ventes ✓
- Voir les clients ✓
- Modifier les clients ✗
- Voir l'équipe ✗
- Annuler une vente ✗

Si elle clique sur « Annuler » → **HTTP 403 Forbidden**, message « Permission insuffisante pour cette action ».

#### Pourquoi licences et permissions sont orthogonales

Les deux axes répondent à deux questions différentes :
- **Licence** = « ce tenant a-t-il payé pour ce module ? » (axe **commercial**)
- **Permission** = « cet utilisateur a-t-il le droit de faire cette action ? » (axe **organisationnel**)

Imaginons trois cas pour Mata Mbao :

| Cas | Licence sales.pos ? | Permission write d'Awa ? | Ce qui se passe |
|---|---|---|---|
| 1 | ✓ activée | ✓ accordée | ✅ Awa peut encaisser |
| 2 | ✓ activée | ✗ refusée | ❌ 403 — module dispo, mais pas pour Awa |
| 3 | ✗ pas activée | ✓ accordée | ❌ 402 — module pas payé, peu importe le rôle |
| 4 | ✗ pas activée | ✗ refusée | ❌ 402 — pas payé d'abord, c'est le premier check |

C'est cette **orthogonalité** qui rend la granularité robuste. On peut changer un plan commercial sans
toucher à l'organisation interne du tenant, et inversement.

### 2.4 Granularité technique — modules backend + composants frontend indépendants

Côté code, chaque module métier correspond à **un module NestJS isolé** dans `apps/api/src/modules/` :

```
apps/api/src/modules/
├── customers/              ← module CRM clients
├── inventory/              ← module stocks
├── points-of-sale/         ← module points de vente
├── product-categories/     ← module catégories produits
├── products/               ← module catalogue produits
├── sales/                  ← module ventes/POS
├── team/                   ← module équipe (rôles)
├── tenants/                ← module admin tenants
├── licensing/              ← module métacatalogue
└── health/                 ← endpoint healthcheck
```

Chaque module est **fermé sur lui-même** :
- Ses propres tables (déclarées dans son manifest)
- Son propre service (`*.service.ts`)
- Son propre controller (`*.controller.ts`)
- Ses propres tests (`__tests__/`)
- Ses propres DTOs (`dto/`)

Et **importe le minimum** des autres modules — uniquement via leur **service public exporté**, jamais leurs internes.

Concrètement, le graphe de dépendances entre modules backend ressemble à :

```
licensing  ←─── (utilisé par tous via @RequiresModule)
    ↓
common/    ←─── (utilisé par tous : DB, CLS, auth)
    ↑
sales  ─→  inventory   (sales décrémente le stock atomiquement à la validation)
              ↑
              └─ (aucun autre module n'importe inventory)

products, customers, points-of-sale, team, tenants, health, product-categories
   → tous indépendants (pas d'imports entre eux)
```

**Une seule dépendance inter-module légitime : `sales → inventory`**. Et elle est unidirectionnelle —
inventory ne sait pas que sales existe.

#### Côté frontend, même rigueur

Les composants UI sont aussi découpés finement :

```
apps/web/src/components/pos/
├── PosTopbar.tsx              ← bandeau rouge avec PV + switcher de vue
├── PosViewSwitcher.tsx        ← toggle [Caisse | Standard]
├── CaisseView.tsx             ← layout 3 colonnes
├── StandardView.tsx           ← formulaire à plat
├── ProductsGrid.tsx           ← grille produits avec catégories + recherche
├── Cart.tsx                   ← panier avec actions Pré-co/Vider/Sauv./Valider
├── DailySummary.tsx           ← KPIs + transactions du jour
├── PaymentModal.tsx           ← saisie multi-paiement
├── StandardSalesForm.tsx      ← formulaire mode Standard
└── RecentSalesLinesTable.tsx  ← tableau des ventes flat

apps/web/src/lib/pos/
├── useCart.ts                 ← état du panier + persistance localStorage
├── useProductCatalog.ts       ← produits + catégories + filtrage
└── useDailyStats.ts           ← KPIs + ventes récentes
```

Chaque composant prend des **props typées explicites**. Aucun ne lit un état global caché.
**`<Cart>` ne sait pas que les produits existent.** Il reçoit des `lines` et appelle `onValidate()`.
**`<DailySummary>` ne sait pas qu'il y a un panier.** Il fetch ses propres données via son hook.

Cela veut dire qu'on peut :
- Tester chaque composant en isolation
- Remplacer un composant sans toucher aux autres (ex : variante tablette de `<Cart>`)
- Réutiliser un composant ailleurs (ex : `<ProductsGrid>` dans une page d'inventaire)

---

## 3. Pourquoi cette granularité est rare

La plupart des SaaS sont **monolithiques** parce que c'est plus simple à coder au début :
- Tout dans un seul gros service
- Tout activé pour tous les clients
- Pas de catalogue, pas de licensing, pas de permissions par module

C'est efficace **jusqu'à 50-100 clients**. Au-delà, ça craque.

Matix a fait le choix **dès le départ** d'investir dans la granularité, parce que :

1. **L'ancienne expérience Mata l'a prouvé** — Maas App, MLC, Dépenses Management ont tous fini bridés
   par des fonctionnalités collées au monolithe.
2. **Le marché sénégalais est très segmenté** — une boucherie n'a pas les mêmes besoins qu'un commerce
   d'import-export. Vendre un seul plan « tout inclus » = laisser de l'argent sur la table OU sur-vendre.
3. **L'évolution est continue** — chaque module sera amélioré indépendamment. Sans découpage, chaque
   évolution risque de casser autre chose.

Le coût de cette rigueur :
- ~3 fois plus de code initial (catalogue, guards, policies, modules séparés)
- Discipline de code review (rejeter les imports cross-module non justifiés)

Le bénéfice :
- Permet de monter à plusieurs milliers de clients sans refonte
- Permet de vendre des plans très flexibles
- Permet d'ajouter une fonctionnalité pour 10 clients sans toucher aux 990 autres

---

## 4. Comment ça permet de soutenir des milliers de clients

### 4.1 Un seul code, une seule base de données

Quand on onboarde Mata Mbao puis Mata Keur Massar puis Acme Bakery, **on ne déploie pas 3 fois** Matix.
On ne crée pas 3 schémas Postgres. On ne maintient pas 3 versions du code.

On a :
- **Un** code source dans `apps/`
- **Une** base de données `matix`
- **Une** instance API qui sert tous les tenants
- **Une** instance Web qui sert tous les tenants

Ce qui change entre les tenants, c'est :
- Les lignes dans la base (chacun voit les siennes via RLS)
- Les licences activées (table `tenant_licenses`)
- Les permissions configurées (table `role_permissions`)
- Les utilisateurs Keycloak (avec leur attribut `tenant_id`)

### 4.2 Coût marginal par tenant ≈ 0

Onboarder un nouveau tenant = 4 actions automatisées :

```
1. INSERT INTO tenants (slug, legal_name, ...) VALUES (...)
   → 1 ligne SQL, ~10 ms

2. INSERT INTO tenant_licenses (tenant_id, module_code, ...) VALUES (...)
   → ~10 lignes SQL (une par module du plan choisi), ~50 ms

3. INSERT INTO role_permissions (...)
   → ~50 lignes SQL (5 rôles × 10 modules × 3 actions), ~100 ms

4. Création du user Keycloak owner via l'API admin Keycloak
   → 1 appel HTTP, ~200 ms
```

**Total : ~360 ms** pour onboarder un client. Aucun déploiement, aucune migration de schéma, aucun
fichier de config à modifier. **Ça se fait à chaud, pendant que les 999 autres clients utilisent l'app**.

Comparons avec un SaaS schema-per-tenant :

```
1. CREATE SCHEMA mata_mbao
2. Re-jouer les 9 migrations dans ce nouveau schéma
3. Insérer les seeds initiaux dans ce schéma
4. Mettre à jour la config pour router les requêtes Mata Mbao vers ce schéma
5. Re-démarrer un worker
```

**Total : 5 à 30 minutes**, processus partiellement manuel, risque d'échec à chaque étape.

À 1 000 clients, la différence devient **un département entier de DevOps** vs **rien**.

### 4.3 Onboarding instantané d'un nouveau client

Concrètement, voici ce qui se passe quand un commercial Matix vend à Boulangerie Diop :

```
1. Le commercial ouvre /admin/tenants
2. Clique « Provisioner un nouveau tenant »
3. Remplit :
     slug:        boulangerie-diop
     nom légal:   Boulangerie Diop SARL
     pays:        SN
     plan:        Starter (15 000 XOF/mois)
     owner email: m.diop@boulangerie-diop.sn
     owner nom:   Mamadou Diop
4. Clique « Créer »
5. < 1 seconde plus tard >
6. Le tenant existe, le owner peut se connecter, l'app marche.
```

Pas de redéploiement. Pas de ticket DevOps. Pas de migration. **Pas de risque pour les autres clients.**

### 4.4 Activation/désactivation de modules sans toucher au code

Mata Mbao paie aujourd'hui le plan Starter (POS + clients + stocks). Dans 6 mois, ils veulent ajouter
la **réconciliation** des ventes (un module à 5 000 XOF/mois en add-on).

Ce que fait le commercial Matix :

```
1. Ouvre /admin/tenants/mata-mbao/licensing
2. Clique « Activer » sur le module commercial.sales.reconciliation
3. < 1 seconde plus tard >
4. La réconciliation apparaît dans le menu de Mata Mbao, immédiatement.
```

Pas de redéploiement. Pas de feature flag à modifier dans le code. **Le module était déjà là**, simplement
non visible pour Mata Mbao parce que sa ligne dans `tenant_licenses` était `enabled=FALSE`.

### 4.5 Scaling horizontal (architecture prête, à activer le jour J)

Aujourd'hui Matix tourne sur une seule instance. C'est largement suffisant pour des centaines de tenants.
Mais l'architecture est **prête** à scaler horizontalement le jour où ce sera nécessaire :

- **L'API est stateless** — tout ce qui identifie une requête est dans le token JWT et la transaction DB.
  Aucune information n'est stockée en mémoire de l'API. Donc on peut lancer 2, 5, 50 instances de l'API
  derrière un load balancer, n'importe laquelle peut servir n'importe quel tenant.

- **Les transactions DB sont scopées** — chaque requête ouvre sa propre transaction avec son propre
  `app.tenant_id`. Pas de conflit entre tenants concurrents.

- **Les modules sont indépendants** — le jour où le module `delivery.gps` génère 10× plus de trafic que
  les autres (à cause de pings GPS toutes les 30s), on peut l'extraire en microservice sans toucher au reste.

- **La base peut être répliquée** — Postgres permet de faire du read-replica pour décharger les SELECT
  lourds (rapports, analytics) sur des copies.

- **La config est dans la base** — pas de fichiers de config par environnement, pas de code à redéployer
  pour activer une feature pour un client. Tout ce qui est variable est en DB.

Ce qu'on **n'a pas encore fait** mais qu'on pourra faire **sans réécrire le code** :
- Mettre `pgbouncer` devant Postgres pour multiplexer les connexions (à 10 000 utilisateurs concurrents)
- Externaliser le module `analytics` en read-replica
- Ajouter un Redis pour cacher les permissions (vu que `role_permissions` change rarement)
- Lancer plusieurs instances de l'API derrière un nginx ou un Cloud Run

Toutes ces optimisations sont **invisibles pour le code applicatif**. On ne réécrit rien, on ajoute
juste des couches d'infra.

---

## 5. Comparaison avec l'ancien Maas App

L'ancienne app Mata Maas App était l'inspiration de Matix, mais elle a fait des choix opposés sur plusieurs
axes. Comprendre ces différences aide à voir ce qui change.

| Dimension | Maas App | Matix |
|---|---|---|
| Isolation tenant | Schema-per-tenant Postgres | Row Level Security (RLS) sur un schéma partagé |
| Code | Monolithe Express, ~30 000 lignes | Monorepo NestJS + Next.js, modules découpés |
| Modules | Tout activé par défaut, hard-codé | 50 modules dans un catalogue, licenciables séparément |
| Permissions | Codées en dur (`if user.role === 'admin' || ...`) | Table `role_permissions` configurable par tenant |
| Auth | JWT custom, secret partagé | Keycloak OIDC, JWKS, refresh tokens |
| Routing tenant | Middleware qui change le `search_path` Postgres | Interceptor qui pose `app.tenant_id` GUC + RLS |
| Onboarding nouveau tenant | Création schéma + replay migrations | INSERT en base, instantané |
| Migration de schéma | N tenants × M migrations à appliquer | 1 migration appliquée 1 fois |
| Frontend | EJS templates, jQuery | React 19, Next.js 15 App Router |
| Tests | Aucun | 55 tests e2e, isolation cross-tenant vérifiée |

### Ce qui était bien dans Maas App (et qu'on garde)

- **Le sens métier** — le découpage Boucherie/Volaille/Pack/etc., la formule « Pération », les snapshots
  quotidiens, le scoring livreur. Tout ça est documenté dans `docs/business-rules-catalog.md` comme
  source de vérité métier, et chaque module Matix qui correspond a un lien vers cette doc.
- **Les intégrations Bictorys, Wave, Orange Money** — le code Maas sera porté tel quel quand on attaquera
  le pilier finance.

### Ce qu'on a changé sciemment

- **Schema-per-tenant abandonné** — c'était le bon choix au démarrage de Maas (1-5 clients). Pour 1 000
  clients, c'est ingérable. RLS est la bonne réponse 2026.
- **Pas de migration de Maas vers Matix** — on a importé les **données métier** (produits, clients) avec
  un script (`seed-from-maas.ts`), mais le **code** est neuf. C'était plus rapide que d'essayer de
  rétro-fitter Maas avec RLS et licensing.
- **Compta single-entry → SYSCOHADA double-entry** — Maas tenait une compta simplifiée. Pour faire de
  Matix une vraie suite SaaS B2B, on refondra ça en double-entry à la norme OHADA quand on attaquera
  le pilier finance.

---

## 6. Limites connues et choix conscients

Aucune architecture n'est parfaite. Voici ce qu'on a **choisi de ne pas optimiser** pour l'instant :

### Limite 1 — Tous les tenants dans la même base Postgres

**Conséquence** : si un tenant fait une requête monstrueuse (ex : export CSV de 10 ans de ventes),
ça peut ralentir les autres tenants pendant la durée de la requête.

**Mitigation prévue** : quand on aura 100+ tenants actifs, on ajoutera un read-replica Postgres pour
les requêtes lourdes (analytics, exports).

**Pourquoi pas tout de suite** : ajoute de la complexité ops, pas justifié à 4 tenants.

### Limite 2 — Pas de cache des permissions

**Conséquence** : à chaque requête API, on fait 2 queries pour vérifier licence + permission. Ça ajoute
~5 ms par requête.

**Mitigation prévue** : ajouter un cache Redis avec TTL court (1 minute) sur les paires
`(tenant_id, role, module_code)`. Quand le owner change un rôle, on invalide la clé.

**Pourquoi pas tout de suite** : 5 ms × 1 000 req/jour × 100 tenants = négligeable. À 100 000 tenants ça
deviendra un sujet.

### Limite 3 — Un user, un tenant

**Conséquence** : un comptable qui sert 5 boutiques doit avoir 5 comptes différents.

**Mitigation prévue** : Phase 3 — supporter `tenant_ids: string[]` dans le JWT et un sélecteur de tenant
dans l'UI.

**Pourquoi pas tout de suite** : ce n'est pas un cas d'usage prioritaire à Phase 1. Et ça complique le
modèle de permissions (« quel rôle dans quel tenant ? »).

### Limite 4 — Backend monolithique

**Conséquence** : l'API NestJS est une seule app. Si on doit redémarrer pour un déploiement, **toute**
l'API est down quelques secondes.

**Mitigation prévue** : faire du blue-green deployment (deux instances, on bascule de l'une à l'autre).

**Pourquoi pas tout de suite** : le redémarrage prend < 5 secondes. C'est acceptable pour un SaaS B2B
en heures ouvrées.

### Limite 5 — Le module `sales` dépend de `inventory`

**Conséquence** : on ne peut pas extraire le module sales en microservice sans aussi extraire inventory.

**Mitigation prévue** : si jamais nécessaire, on pourrait passer par un event bus (`SalePostedEvent` →
inventory consomme). Mais ça transformerait la cohérence forte (atomique) en cohérence éventuelle, ce qui
est un mauvais trade-off pour le stock.

**Pourquoi pas tout de suite** : aucune raison fonctionnelle de scinder ces deux modules. Les ventes
DOIVENT décrémenter le stock atomiquement.

---

## 7. Passage à l'échelle : 1 000, 10 000, 100 000

Calculons ensemble ce que ça donnerait à différentes tailles. Hypothèses :
- En moyenne, 5 utilisateurs actifs par tenant
- Chaque utilisateur fait ~200 requêtes API par jour ouvré (50 ventes + navigation)
- Les heures de pointe représentent 5× la moyenne

### À 100 tenants (objectif Phase 1)

```
Utilisateurs actifs :         500
Requêtes/jour :               100 000
Requêtes/seconde (moyenne) :  ~3 req/s
Pic :                         ~15 req/s

Infrastructure : 1 instance API + 1 instance Postgres = ~30 €/mois sur Hetzner
Marge brute par tenant :      ~14 700 XOF/mois (15k - 300 XOF de frais d'infra)
```

### À 1 000 tenants

```
Utilisateurs actifs :         5 000
Requêtes/jour :               1 000 000
Requêtes/seconde (moyenne) :  ~30 req/s
Pic :                         ~150 req/s

Infrastructure : 2-3 instances API + 1 Postgres avec read-replica = ~150 €/mois
Marge brute par tenant :      ~14 850 XOF/mois (presque inchangée)
Coût opérationnel :           toujours 1 dev + 1 ops mi-temps
```

### À 10 000 tenants

```
Utilisateurs actifs :         50 000
Requêtes/jour :               10 000 000
Requêtes/seconde (moyenne) :  ~300 req/s
Pic :                         ~1 500 req/s

Infrastructure : 10 instances API + Postgres principal + 3 read-replicas
                  + Redis cache + pgbouncer = ~2 000 €/mois
Marge brute par tenant :      ~14 700 XOF/mois (encore quasi-inchangée !)
Coût opérationnel :           équipe de ~5 personnes
```

### À 100 000 tenants

```
Utilisateurs actifs :         500 000
Requêtes/jour :               100 000 000
Requêtes/seconde (moyenne) :  ~3 000 req/s
Pic :                         ~15 000 req/s

Infrastructure : Kubernetes auto-scaling + Postgres sharding par tenant_id
                  ou par région = ~30 000 €/mois
Marge brute par tenant :      ~14 700 XOF/mois (toujours !)
Coût opérationnel :           équipe de ~30 personnes
```

### Le point clé à retenir

À chaque palier, **le code applicatif ne change pas**. Ce qui change, c'est :
- Le nombre d'instances qu'on lance (configuration d'infra)
- Les caches qu'on ajoute (sans toucher au code métier)
- Les replicas DB (transparent pour l'app)

**La marge unitaire par tenant reste à peu près constante**. C'est ça le test d'une architecture qui scale.
Beaucoup d'apps voient leur marge se dégrader au fur et à mesure qu'on grossit, parce qu'on doit ajouter
de plus en plus d'ops, de plus en plus de spécialistes. Avec Matix, le coût marginal d'un nouveau client
reste **de l'ordre de quelques centimes par mois**.

---

## 8. Annexe — L'infra locale en Docker (et pourquoi)

Avant d'attaquer la prod, parlons du **dev local**. C'est là que les choix d'infra se sentent au
quotidien : 80% du temps d'un développeur est passé sur sa machine. Si l'environnement local est
fragile, le projet ralentit même si l'archi prod est parfaite.

### 8.1 Le choix : Docker pour les services, Node natif pour les apps

| Composant | Comment ça tourne en local | Pourquoi |
|---|---|---|
| **PostgreSQL 17** | Conteneur Docker (`matix-postgres`) | Version figée, init scripts auto, reset = `docker compose down -v` |
| **Keycloak 25** | Conteneur Docker (`matix-keycloak`), DB Postgres dédiée | Pas de JVM à installer, realm importé au boot, persistance fiable |
| **API NestJS** | Process Node natif (`pnpm dev`) | Hot reload instantané, debugger IDE branché direct, perfs build natives |
| **Web Next.js** | Process Node natif (`pnpm dev`) | Idem — Turbopack/HMR pas optimal dans un volume Docker cross-OS |

**Pattern** : tout ce qui est **stable et versionné** (les services backing) tourne en Docker, tout ce
qui change toutes les 30 secondes (le code applicatif) tourne en natif. Le meilleur des deux mondes.

### 8.2 Pourquoi Docker pour Postgres + Keycloak

#### Parité dev / prod

En prod, Postgres et Keycloak seront managés (RDS, Cloud SQL, Keycloak managed ou en VM dédiée). Le
**runtime change**, mais la **surface API** reste identique : même version Postgres, même endpoints
Keycloak OIDC, mêmes credentials format. Un bug local = un bug prod, et inversement. **Pas de
"chez moi ça marchait"**.

#### Onboarding zéro-friction

Un nouveau dev fait :
```bash
git clone matix && cd matix
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```
**5 commandes, 5 minutes, ça tourne**. Pas d'installation de Postgres natif, pas de JDK 17 à
configurer, pas de PATH Windows à régler. Pas non plus à demander à Saliou "comment tu as installé
Keycloak chez toi ?".

Avant Docker, l'onboarding incluait :
- Installer PostgreSQL 17 natif (service Windows à configurer)
- Installer JDK 17 (path à exporter)
- Télécharger Keycloak 25.0.6, le décompresser quelque part
- Lancer `kc.bat start-dev --http-port=8180` dans une fenêtre dédiée
- Espérer que rien ne se cogne avec une autre instance Java sur le système

L'historique est dans le commit qui a remplacé `start_matix.ps1` legacy par la version Docker-aware.

#### Isolation et reset trivial

Un volume Docker se supprime en 1 commande. Si la DB part en vrille (mauvais merge de migrations,
seed corrompu, expérience qui tourne mal), `docker compose down -v` puis `up -d` et tout est neuf.
Pas de `DROP DATABASE` à risquer sur un Postgres qui sert aussi d'autres projets.

#### Versions figées et reproductibles

Le `docker-compose.yml` épingle :
- `postgres:17` (Debian, pas Alpine — Defender Windows zérote certains binaires Alpine)
- `quay.io/keycloak/keycloak:25.0`

Tout le monde dans l'équipe tourne **exactement** les mêmes versions. Une faille de sécurité Postgres
17.x ? On bump le tag, `docker compose up -d`, fini. Pas de "j'ai oublié de mettre à jour mon
service Windows".

#### Pas d'orchestration partagée à imposer

L'équipe peut être sur Windows, macOS, Linux. Docker tourne partout pareil. La seule pré-installation
demandée est **Docker Desktop** (ou colima sur Mac, podman-compose sur Linux pour les puristes).

### 8.3 Pourquoi PAS Docker pour l'API et le Web

C'est tentant de tout mettre en Docker pour la pureté. **Mauvaise idée en dev**. Trois raisons :

1. **Hot reload cross-OS** : monter `/apps` depuis Windows vers un conteneur Linux fait passer chaque
   write de fichier par 9p / VirtioFS. Le watcher Next.js ou ts-node-dev voit les events avec 200-500ms
   de retard. Multiplied par chaque save = expérience misérable.

2. **Debugger** : brancher un debugger Node sur un process dans un conteneur demande des port-forward,
   des configs `--inspect=0.0.0.0:9229`, du mapping de paths source. En natif, c'est zéro config dans
   VS Code / WebStorm.

3. **Build TypeScript** : `next build` ou `tsc` dans un volume cross-OS = 3 à 10× plus lent que natif.
   Sur de gros monorepos, ça décourage de builder localement → on push à CI pour voir les erreurs → on
   perd 10 min par tentative.

**Règle** : Docker pour ce qui est *fixe et serveur* (DB, Keycloak, Redis si besoin). Natif pour ce
qui est *en mutation et applicatif* (le code TypeScript qu'on édite).

### 8.4 Comment ça se lance en pratique

Trois entrées possibles, par ordre de simplicité :

#### Option A — Le script (recommandé)

```powershell
.\scripts\start_matix.ps1
```

→ Vérifie Docker, lance la stack, attend que Postgres soit healthy + Keycloak prêt, ouvre l'API et
le Web dans des fenêtres séparées (logs visibles), affiche les URLs et comptes de test.

Stop tout :
```powershell
.\scripts\stop_matix.ps1
```

#### Option B — Manuel

```powershell
docker compose up -d         # Postgres + Keycloak en arrière-plan
pnpm dev                     # API + Web en parallèle via Turbo (Ctrl+C pour stop)
```

#### Option C — Ajustement fin

```powershell
docker compose up -d postgres                 # juste la DB
docker compose --profile extras up -d redis   # active aussi le Redis optionnel
docker compose stop keycloak                  # stop juste Keycloak (garde Postgres)
docker logs -f matix-postgres                 # suit les logs DB
```

La doc complète (avec troubleshooting des cas tordus rencontrés : `exec format error`,
`KC_DB: dev-mem` qui perd ses tables, `KEYCLOAK_ADMIN` vs `KC_BOOTSTRAP_ADMIN_*`) est dans
**`docs/local-setup.md`**.

### 8.5 Ce qu'on n'a pas (et pourquoi)

- **Pas de Kubernetes en local**. C'est de l'overkill pour un dev. Compose suffit.
- **Pas d'image Docker custom pour Matix**. On n'utilise que les images officielles (`postgres:17`,
  `quay.io/keycloak/keycloak:25.0`, `redis:7-alpine`). Aucun Dockerfile dans le repo.
- **Pas de docker-compose.prod.yml**. La prod n'aura probablement pas les mêmes contraintes
  (services managés vs conteneurs auto-hébergés). On définira ça au déploiement.

### 8.6 La leçon archi

Le choix Docker local **renforce le pattern d'archi** décrit dans le reste du doc :
- Code stateless → on peut le démarrer 1 fois, 5 fois, en dev, en CI, en prod, peu importe
- Postgres + RLS comme source de vérité unique → la DB est la même partout, juste le runtime change
- Pas de fichier de config par environnement → le `docker-compose.yml` est lu en dev, ignoré en prod

Si demain on doit basculer en Kubernetes, en Cloud Run, en Fly.io, en bare-metal Hetzner, **le code
applicatif ne change pas**. C'est la promesse de l'architecture. Docker en dev en est juste la
matérialisation la plus pragmatique aujourd'hui.

---

## En résumé

> **Matix est granulaire à 4 niveaux** : 50 modules métier, licenciables séparément, avec des permissions
> orthogonales, et un code source découpé proprement.
>
> **Cette granularité permet de soutenir des milliers de clients** parce que :
> 1. On n'a qu'un seul code et une seule base à maintenir
> 2. Onboarder un client coûte 360 ms et 0 € de DevOps
> 3. Activer/désactiver une feature pour un client = un INSERT en base
> 4. L'architecture est stateless donc scalable horizontalement quand viendra le moment
>
> **À l'opposé**, l'ancien Mata Maas App utilisait du schema-per-tenant qui aurait demandé un département
> ops entier pour atteindre 1 000 clients.

---

## Glossaire

| Terme | Définition |
|---|---|
| **Tenant** | Un client de Matix (Mata Mbao, Boulangerie Diop, etc.). Chaque tenant a ses propres données isolées. |
| **Module** | Une fonctionnalité métier vendable séparément (ex : `commercial.sales.pos`). Matix en a 50. |
| **Pilier** | Regroupement de modules par domaine (Platform / Commercial / Operations / Finance / Analytics / Marketplace). |
| **Catalogue** | La liste centralisée des 50 modules, source de vérité (`apps/api/src/modules/licensing/catalog.ts`). |
| **Plan** | Une formule commerciale qui inclut un sous-ensemble de modules (Free, Starter, Pro, Enterprise). |
| **Add-on** | Module activé en option au-dessus d'un plan, payant séparément. |
| **Licence** | L'activation d'un module pour un tenant donné. Stockée dans `tenant_licenses`. |
| **Permission** | Le droit pour un rôle d'effectuer une action (read/write/delete) sur un module. Stockée dans `role_permissions`. |
| **Rôle** | Un niveau hiérarchique dans un tenant (owner, admin, superviseur, member, readonly). |
| **Stateless** | Caractérise une API qui ne stocke aucun état en mémoire entre les requêtes. Permet le scaling horizontal. |
| **Scaling horizontal** | Ajouter plus d'instances d'une app pour absorber la charge, vs « scaling vertical » (machine plus puissante). |
| **Schema-per-tenant** | Pattern multi-tenant où chaque tenant a son propre schéma Postgres. Difficile à scaler. Ce que faisait Maas App. |
| **RLS (Row Level Security)** | Pattern multi-tenant où tous les tenants partagent les mêmes tables, et Postgres filtre les lignes par tenant. Ce que fait Matix. |
| **LicensingGuard** | Le code NestJS qui intercepte chaque requête et vérifie la licence + la permission avant de laisser passer. |
| **Read-replica** | Une copie de la base Postgres en lecture seule, utilisée pour décharger les SELECT lourds. |
| **pgbouncer** | Un proxy Postgres qui multiplexe les connexions, utile à très grande échelle. |
| **Coût marginal** | Le coût d'ajouter un client supplémentaire. Plus il est bas, plus l'architecture scale. |
| **OHADA / SYSCOHADA** | Système comptable normalisé pour 17 pays africains, dont le Sénégal. À implémenter dans le pilier Finance. |

---

## Pour aller plus loin

- **`docs/architecture-explained.md`** — Comment l'auth et le multi-tenant fonctionnent (RLS, Keycloak, dev mode).
- **ADR-0005** — Décision de structurer un catalogue centralisé.
- **ADR-0006** — Décision de séparer licensing et permissions.
- **`apps/api/src/modules/licensing/catalog.ts`** — La source de vérité des 50 modules.
- **`db/migrations/0008_licensing.sql`** — Le schéma des tables `plans`, `tenant_licenses`, `role_permissions`.
