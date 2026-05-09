# Matix — Comment ça marche, expliqué simplement

> Document destiné aux non-spécialistes (fondateurs, équipe métier, nouveaux devs) qui veulent comprendre
> comment Matix isole les données entre plusieurs entreprises clientes (« tenants ») et comment les
> utilisateurs s'identifient.
>
> Exemple courant : **Mata Mbao**, une boucherie cliente de Matix, et **Awa**, une caissière chez Mata Mbao.

---

## Sommaire

1. [Le problème à résoudre](#1-le-problème-à-résoudre)
2. [Les acteurs en présence](#2-les-acteurs-en-présence)
3. [Partie A — Multi-tenant : isoler les données entre clients](#partie-a--multi-tenant--isoler-les-données-entre-clients)
   - [La méthode naïve et pourquoi elle échoue](#la-méthode-naïve-et-pourquoi-elle-échoue)
   - [Row Level Security (RLS) de PostgreSQL](#row-level-security-rls-de-postgresql)
   - [Démo concrète sur la table `sales`](#démo-concrète-sur-la-table-sales)
   - [Les deux comptes Postgres : `matix_admin` vs `matix_app`](#les-deux-comptes-postgres--matix_admin-vs-matix_app)
4. [Partie B — Authentification : le flow Keycloak étape par étape](#partie-b--authentification--le-flow-keycloak-étape-par-étape)
   - [Analogie : le passeport et le tampon](#analogie--le-passeport-et-le-tampon)
   - [Le flow en 9 étapes](#le-flow-en-9-étapes)
   - [Pourquoi un « code » d'abord, puis un token ?](#pourquoi-un-code-dabord-puis-un-token-)
   - [Que contient un token ?](#que-contient-un-token-)
5. [Partie C — Comment Matix sait qu'Awa appartient à Mata Mbao](#partie-c--comment-matix-sait-quawa-appartient-à-mata-mbao)
   - [Source 1 : l'attribut Keycloak](#source-1--lattribut-keycloak)
   - [Source 2 : la table `tenant_members`](#source-2--la-table-tenant_members)
   - [Défense en profondeur : les deux doivent être d'accord](#défense-en-profondeur--les-deux-doivent-être-daccord)
   - [Le rôle vient toujours de la base, jamais du token](#le-rôle-vient-toujours-de-la-base-jamais-du-token)
6. [Partie D — Deux modes d'auth : dev et keycloak](#partie-d--deux-modes-dauth--dev-et-keycloak)
7. [Cycle de vie complet d'une requête](#cycle-de-vie-complet-dune-requête)
8. [Glossaire](#glossaire)

---

## 1. Le problème à résoudre

Matix est **une seule application**, **une seule base de données**, qui sert plusieurs entreprises clientes
(qu'on appelle des « tenants ») :
- Mata Mbao
- Mata Keur Massar
- Acme Bakery
- ...

Chaque entreprise doit voir **uniquement ses propres données** : ses produits, ses clients, ses ventes.
Si une entreprise concurrente trafique l'URL ou envoie un faux header, on ne doit jamais la laisser jeter
un coup d'œil chez les autres.

Sur **chaque requête HTTP**, deux questions doivent être réglées :

1. **Qui demande ?** (l'utilisateur)
2. **Pour quelle entreprise ?** (le tenant)

Si on se trompe sur l'une ou l'autre, l'entreprise A peut voir le chiffre d'affaires de l'entreprise B.
Catastrophe.

---

## 2. Les acteurs en présence

| Acteur | Qui c'est | Où ça vit |
|---|---|---|
| **Le navigateur** | Chrome/Firefox d'Awa | Sur le PC d'Awa |
| **Matix-Web** | Le frontend Next.js (`apps/web`) | Sur notre serveur |
| **Matix-API** | Le backend NestJS (`apps/api`) | Sur notre serveur |
| **Keycloak** | Le serveur de login dédié | Sur notre serveur (port 8081, conteneur `matix-keycloak`) |
| **PostgreSQL** | La base de données | Sur notre serveur (port 5432, conteneur `matix-postgres`) |

> **Note infra locale** : en dev, Keycloak et Postgres tournent dans des conteneurs Docker
> orchestrés par `docker-compose.yml` (cf. `docs/local-setup.md`). Keycloak utilise une
> base dédiée `keycloak` dans le même Postgres pour sa persistance — pas de H2 en mémoire.
> En prod, ces composants seront probablement managés (RDS/Cloud SQL pour Postgres,
> Keycloak en VM dédiée ou managed).

Schéma général :

```
┌──────────────┐                   ┌──────────────┐
│  Navigateur  │ ──────────────────│   Keycloak   │  (login uniquement)
│  d'Awa       │                   │              │
└──────┬───────┘                   └──────────────┘
       │
       │  (token Bearer dans chaque requête)
       │
       ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Matix-Web   │───▶│  Matix-API   │───▶│  PostgreSQL  │
│  (Next.js)   │    │  (NestJS)    │    │              │
└──────────────┘    └──────────────┘    └──────────────┘
```

---

## Partie A — Multi-tenant : isoler les données entre clients

### La méthode naïve et pourquoi elle échoue

La plupart des applications font ainsi : à chaque requête SQL, le développeur ajoute un filtre `WHERE tenant_id = ...`.

```sql
-- Dans le code de l'endpoint « lister les ventes »
SELECT * FROM sales WHERE tenant_id = 'mata-mbao-uuid';
```

**Problème** : il suffit qu'**un seul** développeur, **une seule fois**, oublie cette clause `WHERE tenant_id = ...`
pour que toutes les ventes de Mata Keur Massar, d'Acme Bakery, etc., fuient vers Mata Mbao.

Sur 100 endpoints × 5 requêtes chacun = **500 endroits où il faut se souvenir**. Une faute de frappe et c'est fini.

### Row Level Security (RLS) de PostgreSQL

PostgreSQL offre une fonctionnalité appelée **Row Level Security** (RLS), littéralement « sécurité au niveau des lignes ».
Le nom est exact : RLS permet à la base de **cacher certaines lignes** automatiquement, selon des règles qu'on définit
une fois pour toutes au moment de créer la table.

L'idée tient en une phrase :

> **On enseigne à la base une règle : « pour la table X, ne montre que les lignes qui satisfont la condition Y ».
> À partir de là, la base applique silencieusement ce filtre à toutes les requêtes, que l'application le demande ou non.**

#### Comment on définit une règle RLS

```sql
-- Étape 1 : activer RLS sur la table
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE  ROW LEVEL SECURITY;     -- ← même le propriétaire de la table respecte RLS

-- Étape 2 : définir la règle d'isolation
CREATE POLICY tenant_isolation ON sales
  FOR ALL                                          -- ← s'applique à SELECT, INSERT, UPDATE, DELETE
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
--           ↑                                ↑
--    « ce qu'on peut LIRE »          « ce qu'on peut ÉCRIRE »
```

Traduction en français : *« ne montre que les lignes où `tenant_id` est égal à la valeur d'une variable
nommée `app.tenant_id` ; et n'autorise pas d'INSERT/UPDATE qui définirait une autre valeur. »*

#### Qu'est-ce que `app.tenant_id` ?

C'est une **variable de session Postgres**. Avant chaque requête, Matix dit à Postgres :

```sql
SET LOCAL app.tenant_id = 'mata-mbao-uuid';
```

Pour le temps de la transaction en cours, toutes les requêtes sur cette connexion seront filtrées
automatiquement à Mata Mbao. Quand la transaction se termine (`COMMIT` ou `ROLLBACK`), la variable est effacée.

`SET LOCAL` (le mot-clé `LOCAL`) est la clé : ça scope la variable à la transaction. Deux requêtes simultanées,
sur deux connexions différentes, ne se voient jamais.

### Démo concrète sur la table `sales`

Imaginons que la table `sales` contienne 3 lignes appartenant à 2 tenants différents :

```
| id | tenant_id        | total | client      |
|----|------------------|-------|-------------|
| 1  | mata-mbao        | 5000  | Awa         |
| 2  | mata-keur-massar | 8000  | Moussa      |
| 3  | mata-mbao        | 3000  | Fatou       |
```

Voyons ce qui se passe dans plusieurs scénarios :

#### Scénario 1 — Le compte super-utilisateur `matix_admin`

```sql
-- En tant que matix_admin (BYPASSRLS)
SELECT * FROM sales;
-- → Retourne les 3 lignes. Voit tout. Utilisé uniquement pour les migrations et le provisioning.
```

#### Scénario 2 — Le compte applicatif avec `app.tenant_id` posé

```sql
-- En tant que matix_app, juste après SET LOCAL app.tenant_id = 'mata-mbao'
SELECT * FROM sales;
-- → Retourne les lignes 1 et 3 SEULEMENT.
-- → Mata Keur Massar (ligne 2) est INVISIBLE pour cette session.
```

#### Scénario 3 — Le compte applicatif sans `app.tenant_id`

```sql
-- En tant que matix_app, sans avoir posé app.tenant_id
SELECT * FROM sales;
-- → Retourne 0 ligne.
-- → Le filtre n'a aucune valeur de comparaison, donc rien ne passe.
```

**Le mode d'échec est « voir moins », jamais « voir plus ».** Si le développeur oublie quelque chose,
le pire qui arrive c'est que ça ne marche pas. Aucune fuite possible.

#### Scénario 4 — Tentative d'écriture cross-tenant

```sql
-- En tant que matix_app, app.tenant_id = 'mata-mbao'
INSERT INTO sales (tenant_id, total) VALUES ('mata-keur-massar', 99999);
-- → ERREUR : new row violates row-level security policy for table "sales"
```

Le `WITH CHECK` empêche d'**insérer** une ligne qui appartiendrait à un autre tenant. Awa ne peut pas
créer une fausse vente au nom de Mata Keur Massar, même si elle voulait.

### Les deux comptes Postgres : `matix_admin` vs `matix_app`

PostgreSQL permet de créer plusieurs **comptes utilisateurs** avec des pouvoirs différents. Matix en a deux :

| Compte | Pouvoirs | Utilisé pour |
|---|---|---|
| `matix_admin` | `BYPASSRLS` (ignore RLS), peut créer/modifier les tables | Migrations, création d'un nouveau tenant, lookup interne pour l'auth |
| `matix_app` | Pas de pouvoirs spéciaux, **soumis à RLS** | **99% du code** : toutes les requêtes métier (vendre, lister produits, etc.) |

C'est comme un immeuble :
- `matix_admin` = la clé maître, gardée dans le coffre du gardien
- `matix_app` = la clé d'usage quotidien qui **physiquement n'ouvre qu'un appartement à la fois**

Dans le code Matix, deux pools de connexion sont configurés au démarrage
(voir `apps/api/src/common/database.module.ts`) :

```ts
// Configuration des deux pools (simplifiée)
APP_PG_POOL  → user matix_app   (max: 20 connexions)   // pour les requêtes métier
ADMIN_PG_POOL → user matix_admin (max:  5 connexions)  // pour les opérations admin
```

Et le code applicatif **doit toujours** passer par `APP_PG_POOL` pour toute requête métier.
Si quelqu'un essaie de contourner et d'utiliser `ADMIN_PG_POOL` pour une requête business,
c'est un code smell flagué en review.

#### Pourquoi pas un seul compte BYPASSRLS partout ?

Parce que ça ruinerait toute l'architecture. Si `matix_app` avait `BYPASSRLS`, les policies RLS deviendraient
des commentaires consultatifs au lieu d'une protection réelle. La séparation en deux comptes est la
**garantie structurelle** qu'aucun chemin de code business ne peut fuiter de données — même avec un service
buggé ou une clause `WHERE` oubliée.

---

## Partie B — Authentification : le flow Keycloak étape par étape

### Analogie : le passeport et le tampon

Imagine qu'Awa veuille entrer dans un bâtiment officiel. Il y a un garde à la porte (Matix-API) qui
ne fait que vérifier des laissez-passer en papier. Les laissez-passer sont délivrés à un guichet séparé
de la mairie (Keycloak). La mairie a vérifié l'identité d'Awa, son empreinte, son autorisation, puis
a tamponné un laissez-passer avec son sceau officiel.

Quand le garde voit le laissez-passer, **il ne re-vérifie pas l'identité d'Awa**. Il vérifie **le sceau** —
est-il vraiment celui de la mairie ? Le laissez-passer est-il encore valide ? Si oui, Awa entre.

C'est exactement ce qui se passe ici. Matix ne voit jamais le mot de passe d'Awa. Seul Keycloak le voit.
Matix ne voit qu'un **token signé** par Keycloak qui dit *« c'est Awa, on s'en porte garant »*.

### Le flow en 9 étapes

```
Navigateur d'Awa     Matix-Web              Keycloak             Matix-API
     │                  │                      │                     │
1.   │ clic « Connexion »                      │                     │
     ├─────────────────▶│                      │                     │
     │                  │                      │                     │
2.   │  ◀── 302 redirection vers Keycloak ────│                     │
     │                                                               │
3.   ├─── GET keycloak/realms/matix/auth ────▶│                     │
     │                                         │                     │
4.   │  ◀──── HTML formulaire login ──────────│                     │
     │                                         │                     │
5.   │ Awa tape email + mot de passe           │                     │
     ├─── POST email + mot de passe ──────────▶│ vérifie credentials │
     │                                         │ génère un token     │
     │                                         │                     │
6.   │  ◀── 302 redirection Matix?code=ABC123 ─│                     │
     │                                                               │
7.   ├─── GET matix-web/callback?code=ABC123 ─▶│                     │
     │                  │                      │                     │
     │                  │ ─ POST /token ─────▶ │                     │
     │                  │ échange code        │                     │
     │                  │ contre vrai token   │                     │
     │                  │ ◀── { access_token, │                     │
     │                  │      refresh_token }│                     │
     │                  │                      │                     │
8.   │  ◀── pose cookie session, redirection /dashboard ─────────────│
     │                                                               │
9.   │ ─── GET /sales (Authorization: Bearer xxx) ──────────────────▶│ vérifie signature du token
     │                                                               │ extrait tenant_id, user_id
     │  ◀──────── 200 OK { données ventes } ────────────────────────│
     │                                                               │
```

#### Détail de chaque étape

**Étape 1.** Awa ouvre Matix dans son navigateur et clique sur « Se connecter ».

**Étape 2.** Matix-Web ne sait pas valider le mot de passe — c'est le job de Keycloak. Matix-Web répond
au navigateur : *« va voir Keycloak, voici son adresse »*. Le navigateur reçoit un code HTTP 302 (redirection).

**Étape 3.** Le navigateur va sur l'URL de Keycloak (un domaine séparé : `keycloak/realms/matix/...`).

**Étape 4.** Keycloak renvoie une page HTML avec un formulaire email + mot de passe. **Cette page n'est pas
Matix** — c'est Keycloak. Awa pourrait personnaliser le design via Keycloak.

**Étape 5.** Awa tape son email (ex: `awa@mata-mbao.com`) et son mot de passe. Quand elle clique « Se connecter »,
le navigateur envoie ces credentials **à Keycloak**, pas à Matix. **Matix ne voit jamais le mot de passe.**

**Étape 6.** Keycloak vérifie email + mot de passe contre sa base de données interne. Si OK, il génère un
**code à usage unique** (court, ~30 secondes de validité) et redirige le navigateur vers Matix-Web avec ce code
dans l'URL : `https://matix-web/callback?code=ABC123`.

**Étape 7.** Le navigateur arrive sur Matix-Web. Matix-Web reçoit le code dans l'URL. Maintenant, **Matix-Web
parle directement à Keycloak** (canal serveur-à-serveur, pas via le navigateur) pour échanger le code contre
le vrai token. Matix-Web s'identifie auprès de Keycloak avec son **client_secret** (un mot de passe
applicatif que seul Matix-Web connaît).

**Étape 8.** Matix-Web reçoit deux tokens de Keycloak :
- Un **access_token** (valide ~15 minutes) qui sert à appeler l'API
- Un **refresh_token** (valide plus longtemps) qui sert à obtenir un nouveau access_token quand l'autre expire

Matix-Web stocke ces tokens dans un cookie de session (HTTPOnly, sécurisé) et redirige Awa vers `/dashboard`.

**Étape 9.** À partir de maintenant, **chaque** requête API qu'Awa fait, le navigateur envoie le token dans
l'en-tête `Authorization: Bearer xxx`. Matix-API vérifie la signature du token **localement** (sans appeler
Keycloak — ça serait trop lent), extrait `tenant_id` et `user_id`, et sert la requête.

### Pourquoi un « code » d'abord, puis un token ?

Quand Keycloak valide le mot de passe d'Awa (étape 6), il pourrait simplement mettre le token directement
dans l'URL de redirection : `?token=eyJxxx...`. Mais les URLs finissent dans :
- l'historique du navigateur
- les logs du serveur
- les screenshots qu'on partage sur Slack
- les referrers HTTP envoyés au site suivant

Mettre le token dans l'URL serait une fuite assurée.

À la place, Keycloak met un **code** dans l'URL (`?code=ABC123`). Matix-Web fait ensuite (côté serveur,
invisible pour le navigateur) : *« Salut Keycloak, voici le code, voici aussi mon client_secret —
donne-moi le vrai token »*. Keycloak vérifie le code ET le secret, puis remet le token sur un canal privé.

Si un attaquant vole le code dans l'URL, il ne peut rien en faire sans le client_secret de Matix-Web.
Le code expire aussi en ~30 secondes. La fenêtre de fuite est minuscule.

C'est le **flow Authorization Code** d'OAuth/OIDC. C'est le standard utilisé par Google, GitHub,
Microsoft, etc. quand on clique « Connexion via Google ».

### Que contient un token ?

Un token est un **JSON encodé en base64 avec une signature cryptographique**. Si tu le décodes, tu vois
quelque chose comme :

```json
{
  "sub":       "awa-uuid-12345",                    ← l'identifiant unique d'Awa
  "tenant_id": "mata-mbao-uuid-67890",              ← le tenant d'Awa
  "email":     "awa@mata-mbao.com",
  "iss":       "http://keycloak/realms/matix",      ← qui a émis ce token
  "aud":       "matix-api",                          ← à qui il est destiné
  "exp":       1746732000,                           ← expire à cette date Unix
  "iat":       1746731100                            ← émis à cette date Unix
}
.signature
```

**N'importe qui peut décoder le JSON** — il n'est pas chiffré. Mais **seul Keycloak peut produire une
signature valide**. Si quelqu'un modifie ne serait-ce qu'un caractère, la signature ne correspond plus.

Matix-API a la clé publique de Keycloak en cache local. Il vérifie la signature en quelques microsecondes
sur chaque requête. Pas besoin d'appeler Keycloak à chaque fois.

---

## Partie C — Comment Matix sait qu'Awa appartient à Mata Mbao

C'est une excellente question parce qu'il y a **deux réponses** qui se renforcent mutuellement pour la sécurité.

### Source 1 — L'attribut Keycloak

Quand Awa a été ajoutée à l'équipe de Mata Mbao (par le owner ou un admin), deux choses se sont passées
**en même temps** (de manière atomique, dans une seule transaction) :

```
1. Un user a été créé dans Keycloak avec :
     id:         awa-uuid
     email:      awa@mata-mbao.com
     password:   (à définir plus tard via lien email)
     attributes: { tenant_id: "mata-mbao-uuid" }   ← l'attribut custom

2. Une ligne a été insérée dans la table tenant_members de Matix :
     tenant_id:    mata-mbao-uuid
     user_id:      awa-uuid
     role:         member
     created_at:   2026-05-01 09:32
```

Quand Awa se connecte, Keycloak lit l'attribut `tenant_id` de son profil et l'**injecte dans le token**
en tant que claim :

```json
{
  "sub": "awa-uuid",
  "tenant_id": "mata-mbao-uuid",   ← vient de son profil Keycloak
  ...
}
```

Donc le token lui-même **prétend** qu'Awa vient de Mata Mbao.

### Source 2 — La table `tenant_members`

Mais Matix-API **ne fait pas entièrement confiance au token**. Même si la signature prouve que le token
vient bien de Keycloak, plusieurs scénarios pourraient mal tourner :

- Awa a été virée de Mata Mbao hier mais son token est encore valide ?
- Quelqu'un dans l'admin Keycloak a accidentellement défini un mauvais `tenant_id` sur son profil ?
- Un bug dans le mapper Keycloak a mis la mauvaise valeur ?

Donc à **chaque** requête, Matix-API exécute aussi cette query contre la base :

```sql
SELECT role
  FROM tenant_members
 WHERE user_id   = 'awa-uuid'                ← du `sub` du token
   AND tenant_id = 'mata-mbao-uuid'          ← du `tenant_id` du token
   AND deactivated_at IS NULL                ← le membership est encore actif
```

- **Si la query renvoie une ligne** → Awa est bien membre actif de Mata Mbao → la requête continue avec son rôle.
- **Si la query renvoie rien** → 403 Forbidden. Causes possibles :
  - Elle a été retirée de Mata Mbao (`deactivated_at` est posé)
  - Elle n'a jamais été membre (token trafiqué ou mal configuré)
  - Le tenant n'existe plus

### Défense en profondeur : les deux doivent être d'accord

C'est ce qu'on appelle **"defense in depth"** — même si une couche échoue, l'autre rattrape. Le token dit X,
la base confirme X. Les deux doivent être d'accord pour que la requête passe.

| | Attribut `tenant_id` Keycloak | Table `tenant_members` |
|---|---|---|
| Fonction | Indique au token quel tenant prétendre | La vraie source de vérité du membership |
| Vérifié quand | Au moment du login (par Keycloak) | À chaque requête API (par Matix-API) |
| Source d'autorité | « Qui se connecte » | « Qui est autorisé maintenant » |
| En cas de désaccord | La base gagne (requête rejetée) | n/a |

Pense à Keycloak comme le **passeport** (qui tu es) et à `tenant_members` comme la **liste d'accès du
bâtiment** (qui est autorisé aujourd'hui). Les deux doivent dire « oui » pour entrer.

### Le rôle vient toujours de la base, jamais du token

C'est un point subtil mais important.

Remarque que la query ci-dessus renvoie aussi `role`. On utilise **ce rôle** pour les vérifications de
permissions, **pas** quoi que ce soit dans le token.

Pourquoi ? Parce que si le rôle était dans le token :

> Le token d'Awa dit `role: 'admin'`.
> Le owner la rétrograde à `member` à 14h00.
> Le token d'Awa dit toujours `admin` jusqu'à 14h15 (expiration du token).
> Pendant 15 minutes, elle a des pouvoirs admin qu'elle ne devrait pas avoir.

En gardant le rôle dans la base, la rétrogradation est effective dès la **toute prochaine requête** d'Awa.
Le token ne sert qu'à dire « c'est bien Awa », pas « voici ce qu'Awa peut faire ».

### Et si Awa appartient à plusieurs tenants ?

Dans le modèle actuel de Matix : **un user, un tenant**. Awa fait partie de Mata Mbao, point. Si elle
rejoignait un autre tenant, elle aurait un compte séparé avec un autre login.

C'est plus simple, et ça correspond à la réalité métier de Mata — le personnel est employé par un magasin,
pas en freelance entre plusieurs boutiques.

Si on devait un jour supporter le multi-tenant pour les utilisateurs (consultants, comptables servant
plusieurs boutiques), on devrait :
1. Changer l'attribut Keycloak en `tenant_ids: ["mata-mbao", "mata-keur-massar"]`
2. Ajouter un sélecteur « Switch tenant » dans l'UI
3. Tracker le « tenant actif courant » dans la session

Mais c'est une feature Phase 3+. Pas dans le radar.

---

## Partie D — Deux modes d'auth : dev et keycloak

Pour identifier « qui demande », Matix supporte deux modes, sélectionnés par une seule variable
d'environnement : `AUTH_MODE`.

### Mode `dev` — pour le développement local et les tests

```bash
AUTH_MODE=dev pnpm dev
```

Le frontend (en mode dev) envoie deux headers HTTP simples :

```http
GET /sales
X-Dev-Tenant-Id: mata-mbao-uuid
X-Dev-User-Id:   awa-uuid
```

**Avantages** :
- Aucune infrastructure à lancer (pas de Keycloak)
- Tests qui tournent en millisecondes (pas de minting de token)
- On peut « se faire passer pour » n'importe quel user instantanément en changeant le header

**Inconvénients** :
- Les headers peuvent être envoyés par n'importe qui — c'est OK en dev/test, fatal en prod
- Pas de validation de mot de passe, pas de MFA, rien de réel

**Utilisé dans** :
- Développement local (`pnpm dev`)
- Tests automatisés (les 55 tests e2e)
- Pipelines CI

### Mode `keycloak` — pour la production

```bash
AUTH_MODE=keycloak \
KEYCLOAK_ISSUER=http://localhost:8081/realms/matix \
KEYCLOAK_AUDIENCE=matix-api \
pnpm dev
```

Le navigateur envoie un token Bearer signé par Keycloak (cf Partie B).

**Avantages** :
- Vraie auth — mots de passe, MFA optionnel, lockout après tentatives échouées
- Tokens qui expirent — si quelqu'un en vole un, il n'est valide que 15 minutes
- OIDC standard — n'importe quel client peut s'intégrer (web, mobile, tiers)

**Inconvénients** :
- Coût de démarrage : Keycloak met 30 secondes à booter
- Plus de pièces mouvantes à débugger

**Utilisé dans** : production, staging, démos avec vrais clients.

### Ce qui est identique entre les deux

C'est le point important : **tout ce qui se passe après l'identification est identique**. La même
fonction `extractAuthContext` retourne `{ tenantId, userId, role }` dans les deux cas. Même transaction
DB, mêmes policies RLS, mêmes guards de modules, mêmes controllers, mêmes services.

```ts
// extract-context.ts — la SEULE fonction qui lit la requête entrante

if (process.env.AUTH_MODE === 'dev') {
  // Lit X-Dev-Tenant-Id et X-Dev-User-Id
  // Leur fait confiance — on est en dev
} else {
  // Lit Authorization Bearer token
  // Vérifie sa signature contre la clé publique de Keycloak
  // Rejette si signature mauvaise, expirée, ou venant d'un autre issuer
}
```

Après cette fonction, **le reste du code ne sait pas dans quel mode on tourne**. Ce que tu testes en
dev est fidèlement ce qui tourne en prod. Pas de « raccourci dev » qui cacherait un trou de sécurité.

### Basculer entre les deux

Dans `apps/api/.env` :
```bash
AUTH_MODE=dev          # ← change en keycloak, redémarre, tu es en mode prod
```

C'est tout le switch.

---

## Cycle de vie complet d'une requête

Mettons tout ensemble. Une requête `POST /sales` venant d'Awa, en mode production (Keycloak) :

```
1. Browser ───▶ POST /sales
              Authorization: Bearer eyJhbG...
              Body: { items: [...], payments: [...] }

2. NestJS reçoit la requête

3. Middleware CLS s'exécute (avant tout handler) :
   ├─ URL = /sales (pas admin, pas public)
   ├─ Appelle extractAuthContext(req, adminPool)
   │   ├─ Mode keycloak
   │   ├─ verifyKeycloakJwt(token)
   │   │   ├─ Récupère la clé publique de Keycloak (cachée)
   │   │   ├─ Vérifie signature, iss, aud, exp
   │   │   └─ Retourne les claims
   │   ├─ Lit claims.sub = 'awa-uuid'
   │   ├─ Lit claims.tenant_id = 'mata-mbao-uuid'
   │   ├─ Query tenant_members via adminPool :
   │   │   SELECT role FROM tenant_members
   │   │   WHERE user_id = 'awa-uuid' AND tenant_id = 'mata-mbao-uuid'
   │   │     AND deactivated_at IS NULL
   │   ├─ Retourne { tenantId, userId, email, role: 'member' }
   ├─ cls.set('tenantId', 'mata-mbao-uuid')
   ├─ cls.set('userId',   'awa-uuid')
   └─ cls.set('role',     'member')

4. APP_INTERCEPTOR TenantTxInterceptor s'exécute :
   ├─ Lit cls.get('tenantId') = 'mata-mbao-uuid'
   ├─ Acquiert un client matix_app depuis APP_PG_POOL
   ├─ BEGIN
   ├─ SELECT set_config('app.tenant_id', 'mata-mbao-uuid', true)
   └─ cls.set('pgClient', client)

5. LicensingGuard s'exécute (déclencheur : @RequiresModule('commercial.sales.pos', 'write')) :
   ├─ Lit cls.get('tenantId'), cls.get('role')
   ├─ Query tenant_licenses (via adminPool) :
   │   « est-ce que mata-mbao a la licence commercial.sales.pos active ? »
   ├─ Query role_permissions :
   │   « est-ce que le rôle 'member' a l'action 'write' sur ce module ? »
   └─ Si l'un échoue : 402 Payment Required (licence) ou 403 Forbidden (permission)

6. Handler de route SalesController.create() s'exécute :
   ├─ DTO validé par class-validator (whitelist: true)
   ├─ Appelle SalesService.create(dto)
   │   ├─ Récupère le client scopé : getTenantPgClient(cls)
   │   ├─ INSERT INTO sales (tenant_id, ...) VALUES (current_setting('app.tenant_id')::uuid, ...)
   │   │   ↑ La policy RLS WITH CHECK valide que tenant_id correspond bien à la GUC
   │   ├─ INSERT INTO sale_items (...)
   │   ├─ INSERT INTO sale_payments (...)
   │   ├─ Appelle inventory.recordMovementInternal(client, ...) — même client, même tx
   │   │   ├─ INSERT INTO stock_movements (...) — RLS check
   │   │   └─ Trigger DB met à jour stock_levels — RLS check
   │   └─ Retourne le Sale créé + items + payments
   └─ Retourne le résultat au framework

7. Interceptor finalise :
   ├─ COMMIT
   ├─ client.release() → retourne au pool
   └─ cls.set('pgClient', undefined)

8. Réponse 201 Created ───▶ Browser
```

Si une étape jette une erreur :
- Auth échouée → 401, aucune connexion DB ouverte
- Licence échouée → 402, aucune connexion DB ouverte
- Permission échouée → 403, aucune connexion DB ouverte
- Validation DTO échouée → 400, aucune connexion DB ouverte
- Service échoué → ROLLBACK, client released, erreur originale propagée

---

## Glossaire

| Terme | Définition |
|---|---|
| **Tenant** | Une entreprise cliente isolée (Mata Mbao, Mata Keur Massar, etc.). Chaque tenant a ses propres données. |
| **RLS (Row Level Security)** | Fonctionnalité Postgres qui permet de filtrer automatiquement les lignes d'une table selon une règle. |
| **Policy** | La règle RLS elle-même. Définie en SQL par `CREATE POLICY`. |
| **GUC (Grand Unified Configuration)** | Variable de session Postgres. Ex : `current_setting('app.tenant_id')`. Posée avec `SET` ou `set_config()`. |
| **`SET LOCAL`** | Pose une variable Postgres uniquement pour la transaction en cours. |
| **`BYPASSRLS`** | Privilège Postgres qui ignore toutes les policies RLS. Réservé au compte `matix_admin`. |
| **JWT (JSON Web Token)** | Token au format JSON, signé cryptographiquement. Contient des claims sur l'utilisateur. |
| **Claim** | Une affirmation dans un JWT. Ex : « le tenant_id de l'utilisateur est X ». |
| **OIDC (OpenID Connect)** | Protocole standard d'authentification, basé sur OAuth 2.0. |
| **Authorization Code Flow** | Le flow d'OIDC qu'on utilise (browser → Keycloak → code → token). |
| **JWKS (JSON Web Key Set)** | Endpoint exposé par Keycloak qui publie ses clés publiques pour que Matix puisse vérifier les signatures. |
| **Keycloak Realm** | Un espace logique dans Keycloak. On a un realm `matix`. Différents realms = différents groupes d'utilisateurs. |
| **Client (au sens Keycloak)** | Une application qui peut demander des tokens. Matix-Web est un client `matix-web` enregistré dans le realm. |
| **Client Secret** | Un mot de passe que Matix-Web utilise pour s'authentifier auprès de Keycloak lors de l'échange code ⟷ token. |
| **CLS (Continuation Local Storage)** | Mécanisme Node qui permet de partager des données à travers les fonctions async d'une même requête, sans devoir les passer en paramètre. |
| **Interceptor (NestJS)** | Code qui s'exécute avant et après le handler de route. Matix utilise un interceptor pour ouvrir/fermer la transaction DB autour de chaque requête. |
| **Middleware (NestJS)** | Code qui s'exécute avant le handler de route. Matix utilise le middleware CLS pour extraire le contexte d'auth. |
| **Guard (NestJS)** | Code qui décide si une requête peut atteindre le handler. Matix utilise `LicensingGuard` pour vérifier licences et permissions. |
| **Pool (de connexions)** | Ensemble de connexions DB pré-ouvertes, réutilisées entre les requêtes. Plus rapide que d'ouvrir une connexion par requête. |
| **Defense in depth** | Principe de sécurité : empiler plusieurs couches de protection, pour que la défaillance d'une couche n'expose pas le système. |

---

## Pour aller plus loin

- ADR-0001 — Multi-tenancy via RLS
- ADR-0002 — Convention des modules
- ADR-0003 — Auth Keycloak
- ADR-0006 — Licensing et permissions

Et le code source des fichiers clés :

| Quoi | Où |
|---|---|
| Configuration des deux pools Postgres | `apps/api/src/common/database.module.ts` |
| Extraction du contexte auth (dev + keycloak) | `apps/api/src/common/auth/extract-context.ts` |
| Vérification du JWT Keycloak | `apps/api/src/common/auth/keycloak-jwt.ts` |
| Interceptor qui pose `app.tenant_id` | `apps/api/src/common/tenant-tx.interceptor.ts` |
| Setup global du middleware CLS | `apps/api/src/app.module.ts` |
| Une migration RLS typique | `db/migrations/0002_products.sql` |
| Le runner de migrations | `apps/api/src/db/migrate.ts` |
