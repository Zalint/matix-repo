# Keycloak — Setup Phase 0/1

Ce dossier contient la config Keycloak pour Matix : realm, clients, mappers, users de test.

## Démarrer Keycloak

### Option A — Docker (recommandé)

Le `docker-compose.yml` à la racine du repo a déjà un service `keycloak` (profile `full`).

```bash
docker compose --profile full up -d keycloak
# → http://localhost:8080  (admin / admin)
```

### Option B — ZIP + Java 17 (sans Docker)

1. Télécharger Keycloak 25.x : https://www.keycloak.org/downloads
2. Installer **OpenJDK 17+** (Microsoft, Eclipse Temurin, Azul Zulu).
3. Décompresser, puis :
```powershell
$env:KC_BOOTSTRAP_ADMIN_USERNAME = 'admin'
$env:KC_BOOTSTRAP_ADMIN_PASSWORD = 'admin'
.\bin\kc.bat start-dev
```

## Importer le realm

Une fois Keycloak en route et l'admin connecté à http://localhost:8080 :

### Via UI

1. Connexion → menu déroulant en haut à gauche → **Create realm**.
2. Section **Resource file** → upload `realm-matix.json`.
3. **Create**.

### Via CLI (`kcadm`)

```bash
# Auth admin
./bin/kcadm.sh config credentials --server http://localhost:8080 \
  --realm master --user admin --password admin

# Import realm
./bin/kcadm.sh create realms -f infra/keycloak/realm-matix.json
```

## Vérifier

Le realm `matix` doit contenir :
- 2 clients : `matix-api` (bearer-only) + `matix-web` (PKCE public)
- 4 rôles realm : `owner`, `admin`, `member`, `readonly`
- 2 users : `owner@acme.test` (mdp `acme-dev-password`) + `owner@beta.test` (mdp `beta-dev-password`)
- Mappers protocoles sur `matix-web` : `tenant_id` + `tenant_ids` + audience

Tester un login : http://localhost:8080/realms/matix/account → s'authentifier en tant qu'`owner@acme.test`.

## Activer Keycloak côté Matix

### API (`apps/api/.env`)

```bash
AUTH_MODE=keycloak
KEYCLOAK_ISSUER=http://localhost:8080/realms/matix
KEYCLOAK_AUDIENCE=matix-api
```

Redémarrer l'API. À partir de là, les requêtes sans `Authorization: Bearer <token>` valide retournent 401.

### Frontend (`apps/web/.env.local`) — Phase 1

```bash
NEXT_PUBLIC_AUTH_MODE=keycloak
KEYCLOAK_ISSUER=http://localhost:8080/realms/matix
KEYCLOAK_CLIENT_ID=matix-web
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<random>
```

**Note Phase 0** : le frontend n'a pas encore son intégration NextAuth/Keycloak. Pour tester l'API en mode Keycloak depuis le frontend, il faudra livrable Phase 1 ultérieur (NextAuth setup). En attendant, tu peux tester l'API en mode Keycloak via curl :

```bash
# Récupérer un token
TOKEN=$(curl -s -X POST http://localhost:8080/realms/matix/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=matix-web" \
  -d "username=owner@acme.test" \
  -d "password=acme-dev-password" \
  | jq -r .access_token)

# Appeler l'API
curl http://localhost:3001/products \
  -H "Authorization: Bearer $TOKEN"
```

⚠️ Le `password grant` est désactivé par défaut sur `matix-web`. Pour les tests CLI, créer un client temporaire `matix-test` avec `directAccessGrantsEnabled: true`, ou utiliser le flow normal via navigateur.

## Mode dev fallback

Si tu n'as ni Docker ni Java 17 installés, garde simplement `AUTH_MODE=dev` côté API et le frontend continue de fonctionner avec le tenant switcher. Le code Keycloak est en place et prêt pour l'activation, mais ne s'exécute pas tant que le mode n'est pas explicitement `keycloak`.
