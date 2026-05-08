# ADR-0003 — Auth & SSO avec Keycloak

- **Statut** : Proposed
- **Date** : 2026-05-08
- **Référence** : implémenté par `apps/api/src/common/auth.guard.ts` ; runbook : [keycloak-setup.md](../runbooks/keycloak-setup.md)

## Contexte

Matix est une suite SaaS B2B multi-tenant. L'auth doit gérer :
- **Identité** : un user humain s'authentifie une fois et accède à tous les modules de Matix.
- **Multi-appartenance** : un user peut être membre de plusieurs tenants (ex : un comptable externe).
- **Tenant actif** : à chaque requête, on doit savoir QUEL tenant le user est en train de regarder — c'est cette claim qui pilote la RLS (cf. ADR-0001).
- **B2B SSO** : à terme, certains tenants voudront brancher leur Azure AD / Google Workspace.
- **Provisioning** : signup self-serve (essai gratuit) ET création par admin Matix (commercial).

## Décision

**Keycloak self-hosted** comme IdP unique pour Matix.

| Sujet | Choix |
|---|---|
| IdP | **Keycloak 25+** self-hosted |
| Realm | **1 seul realm "matix"** (PAS realm-per-tenant — ne scale pas, complique le SSO trans-tenant) |
| Tenant ↔ User | Attribut user custom `tenant_ids` (array) + table `tenant_members` côté DB Matix (source de vérité) |
| Tenant actif | Choisi par l'utilisateur après login → claim `tenant_id` dans le JWT (mapper Keycloak) |
| Token | **Access token JWT** (RS256), vérifié par l'API via JWKS (no DB lookup per request) |
| Refresh | Refresh token Keycloak standard, géré côté frontend |
| SSO B2B | OIDC/SAML brokering Keycloak vers IdP du tenant (Phase 4) |
| Backend lib | **`jose`** (lib OIDC TS, support JWKS rotation, performante) |
| Frontend lib | **`oidc-client-ts`** (Phase 1) |

## Rejetés

- **Realm-per-tenant** : impossible de scaler à 10k tenants (Keycloak n'est pas conçu pour ça), et casse le SSO trans-tenant pour les users multi-tenant.
- **Auth0/Clerk/WorkOS** : excellents mais $$ à grande échelle ; on les recommandera plus tard pour les enterprise tenants si besoin.
- **DIY auth (passport+session)** : danger — on referait des bugs déjà résolus par Keycloak depuis 15 ans.

## Modes d'exécution de l'API

L'API supporte 2 modes contrôlés par les variables d'environnement :

| Mode | Activation | Comportement |
|---|---|---|
| **Dev** (Phase 0) | `DEV_AUTH_ENABLED=true` | Lit `X-Dev-Tenant-Id` + `X-Dev-User-Id` headers. Aucune vérification crypto. **Jamais en prod.** |
| **Prod / Phase 1+** | `KEYCLOAK_URL=...` + `KEYCLOAK_REALM=...` | Vérifie un Bearer JWT signé par Keycloak via JWKS. Refuse si `DEV_AUTH_ENABLED=true`. |

Une CI check refuse un déploiement si `DEV_AUTH_ENABLED=true` et `NODE_ENV=production` simultanément (cf. § Tests).

## Mapping JWT → contexte CLS

Claims attendues dans l'access token Keycloak :

```json
{
  "sub": "uuid-user",                    // → cls.userId
  "tenant_id": "uuid-tenant",            // → cls.tenantId (filtre RLS)
  "tenant_ids": ["uuid-1", "uuid-2"],    // → liste des tenants accessibles
  "preferred_username": "saliou",
  "email": "saliou@acme.sn",
  "realm_access": { "roles": ["matix-user"] },
  "iss": "https://kc.matix.app/realms/matix",
  "exp": 1234567890
}
```

**Validation côté API** :
- Signature RS256 vérifiée contre JWKS (cache 1h)
- `iss` = `KEYCLOAK_URL/realms/KEYCLOAK_REALM`
- `aud` ou `azp` contient `matix-api`
- `exp` non expiré (clock skew toléré 30s)
- `tenant_id` est un UUID valide ET appartient à `tenant_ids`
- `tenant_id` correspond bien à un tenant `active` dans la DB Matix (table `tenants`)
- `(user_id, tenant_id)` existe dans `tenant_members`

## Flow de login (Phase 1 frontend)

1. User va sur `app.matix.sn` non-loggué → redirect vers `kc.matix.app/realms/matix/protocol/openid-connect/auth`
2. Login Keycloak (form ou IdP brokered)
3. Callback `app.matix.sn/auth/callback?code=...` → exchange code → access + refresh tokens
4. Si user a `tenant_ids.length > 1` → écran "Choisir l'organisation"
5. Le tenant choisi est passé à l'endpoint Keycloak `/token` avec un mapper qui injecte `tenant_id` dans le JWT
6. Stockage côté client : access token en mémoire (Context React) ; refresh token en cookie httpOnly secure

## Switch de tenant

User clique "Changer d'organisation" → frontend appelle Keycloak avec le nouveau tenant choisi → nouveau JWT avec `tenant_id` mis à jour. Pas de logout nécessaire.

## Provisioning

| Cas | Flow |
|---|---|
| **Signup self-serve** | Frontend → API `/admin/tenants/signup` → Keycloak admin API : crée user, crée tenant DB, link user↔tenant, envoie mail vérif WhatsApp/email |
| **Invitation par owner** | Owner → API `/tenants/me/invite` → Keycloak crée user temporaire avec lien magic, ajoute `tenant_ids += <tenant>` |
| **Login social** (Phase 2) | Keycloak IdP brokering Google/Microsoft, mêmes flows ensuite |
| **SSO entreprise** (Phase 4) | Keycloak IdP brokering SAML/OIDC vers Azure AD du tenant |

## Sécurité

- Tokens **JWT RS256** uniquement — clés privées dans Keycloak, jamais ailleurs.
- Pas de tokens longue durée. Access TTL 15 min, refresh TTL 7 jours.
- Refresh token rotation activée.
- Rate limit sur `/token` côté Keycloak.
- API : refus dur de tout token sans `tenant_id` claim.
- Logout = révocation + redirect Keycloak `/logout`.
- En cas de suspension d'un tenant ou d'un user, refus immédiat (vérif DB sur table `tenants`/`tenant_members`).

## Tests

- Unit : `JwtAuthGuard` valide bien les claims (signature, iss, aud, exp, tenant cohérent).
- E2E : flow complet avec un Keycloak en testcontainer (Phase 1 quand Docker dispo).
- CI guard : un script bloque si `DEV_AUTH_ENABLED=true` détecté avec `NODE_ENV=production`.

## Conséquences

**Positives**
- Code applicatif minimal, sécurité concentrée dans Keycloak (battle-tested).
- Multi-tenant + multi-appartenance + SSO supportés natif.
- Migration vers tier "Enterprise Isolated" ou IdP dédié = config Keycloak, pas réécriture.

**Négatives**
- Complexité opérationnelle Keycloak (DB Postgres dédiée, backups réguliers, upgrades majeurs ~1/an).
- Frontend a un flow OIDC à gérer (mais bibli mature).
- Setup local dev plus lourd qu'un simple JWT maison — atténué par le mode `DEV_AUTH_ENABLED`.

## Status courant Phase 0

- ✅ Mode dev fonctionnel (headers `X-Dev-*`)
- ✅ Couche `JwtAuthGuard` codée en mode dual (dev | JWT JWKS) — voir `apps/api/src/common/auth.guard.ts`
- ⏳ Mode JWT non testé end-to-end (nécessite Keycloak qui tourne)
- ⏳ Frontend OIDC : reporté Phase 1 quand Keycloak sera up
- 📄 Runbook : [keycloak-setup.md](../runbooks/keycloak-setup.md)

## Action items pour passer en `Accepted`

1. Saliou installe Docker Desktop OU JDK 21.
2. Lancer Keycloak via runbook → realm config.
3. Configurer les env vars API (`KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`).
4. Vérifier qu'un curl avec un vrai Bearer token Keycloak passe sur l'API.
5. Frontend : intégrer `oidc-client-ts` + écran de choix de tenant.
