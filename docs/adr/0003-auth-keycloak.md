# ADR-0003 — Auth & SSO avec Keycloak

- **Statut** : Proposed
- **Date** : 2026-05-08
- **Décideurs** : Saliou Doucouré, équipe Matix

## Contexte

Phase 0 utilise un mode dev avec headers `X-Dev-Tenant-Id` / `X-Dev-User-Id`. Inacceptable en prod. Il faut un IdP B2B SaaS qui supporte multi-tenant, OIDC/SAML, gratuit, self-hostable.

## Décision

**Keycloak self-hosted**, 1 seul realm `matix`, multi-tenant via attribut `tenant_ids[]` sur user, mapper de protocole pour exposer `tenant_id` actif comme claim JWT.

## Architecture

```
┌────────────┐  1. Login (OIDC PKCE)   ┌──────────┐
│ Next.js    │ ──────────────────────► │ Keycloak │
│ (web)      │ ◄─────────────────────── │ realm:   │
└────┬───────┘  2. id_token + access   │ matix    │
     │                                  └──────────┘
     │ 3. Bearer access_token
     ▼
┌────────────┐  4. Verify JWT via JWKS  ┌──────────┐
│ NestJS API │ ◄────────────────────────│ Keycloak │
│            │     (cached 10 min)       └──────────┘
└────────────┘
     │ 5. Extract tenant_id from claim
     ▼
   set_config('app.tenant_id', ...)
   → RLS Postgres applique
```

## Mode dual

L'API et le frontend supportent **deux modes**, switch via env :

| Mode | API var | Web var | Usage |
|---|---|---|---|
| `dev` | `AUTH_MODE=dev` | `NEXT_PUBLIC_AUTH_MODE=dev` | Phase 0 — headers X-Dev-* / dropdown tenant. Dev local + tests e2e. |
| `keycloak` | `AUTH_MODE=keycloak` | `NEXT_PUBLIC_AUTH_MODE=keycloak` | Staging + prod — JWT OIDC. |

Permet une transition sans flag day. Les tests anti-fuite restent en mode `dev` (rapides, pas besoin de Keycloak en CI).

## Réalm Keycloak

- **Realm** : `matix`
- **Clients** :
  - `matix-web` : public, OIDC, PKCE, redirect `http://localhost:3000/api/auth/callback/keycloak` (dev) + URI prod
  - `matix-api` : bearer-only (vérifie les tokens, n'émet rien)
- **Attribut user** : `tenant_ids` (array) — liste des tenants auxquels le user appartient
- **Attribut user** : `active_tenant_id` — tenant courant choisi par le user (changeable via UI)
- **Mapper de protocole** : `active_tenant_id` → claim JWT `tenant_id`
- **Mapper de protocole** : `tenant_ids` → claim JWT `tenant_ids`
- **Roles** : `owner`, `admin`, `member`, `readonly` (4 rôles plateforme standards)

## Vérification du JWT côté API

- Utilise `jose` (lib JWT moderne, pure JS, pas de node-jose lourd).
- Récupère JWKS depuis `${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`, **cache 10 min**.
- Vérifie : signature, `iss`, `aud=matix-api`, `exp`, `nbf`.
- Extrait : `sub` (user_id), `tenant_id`, `tenant_ids[]`, `realm_access.roles[]`, `email`.
- Vérifie en DB que `(user_id, tenant_id) ∈ tenant_members` — sinon 403 (un user ne peut pas usurper un tenant qui n'est pas le sien, même si claim falsifiée).

## Switch de tenant

- Le user multi-tenant a la liste `tenant_ids[]` dans son token.
- Pour basculer : appel à un endpoint Keycloak custom (ou UI dédiée) qui met à jour `active_tenant_id` côté Keycloak puis force un refresh token.
- Phase 1 : implémenté côté Keycloak via Authentication Flow custom OU côté API en re-générant un token via `token_exchange`.

## Provisioning d'un nouveau tenant

Reprend le flow de l'ADR-0001 §8, en remplaçant l'étape 2 :
1. INSERT tenants
2. **Créer ou inviter user dans Keycloak** via Admin REST API + ajouter `tenant_id` à son `tenant_ids[]`
3. INSERT tenant_members (role=owner)
4. Seed comptable
5. Email/WA d'activation avec lien d'invitation Keycloak

## Tests

- Tests unitaires de la fonction de vérification JWT (mocks JWKS).
- Tests d'intégration avec Keycloak réel : **skippés en CI Phase 0** (Keycloak pas dispo en CI). Ils tournent en CI Phase 1+ via service container Keycloak.
- Tests anti-fuite RLS continuent à tourner en mode `dev` — c'est leur rôle, pas de tester l'auth.

## Conséquences

**Positives**
- Vraie auth B2B-grade.
- 1 user = N tenants supporté nativement.
- Migration sans flag day grâce au dual-mode.

**Négatives**
- Keycloak = composant en plus à exploiter (backups DB Keycloak, maj versions).
- Latence supplémentaire (JWKS fetch, mais cachée).

## Action items

1. Code dual-mode auth livré dans Phase 0 (cette ADR + commit suivant).
2. Setup Keycloak local (Docker quand dispo, ZIP + Java 17 sinon) — toi ou moi.
3. Bascule `AUTH_MODE=keycloak` en staging Phase 1.
4. ADR-0004 plus tard : provisioning user/tenant flow détaillé.
