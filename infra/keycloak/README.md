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
   - Sur Windows : `winget install -e --id Microsoft.OpenJDK.17 --silent --accept-source-agreements --accept-package-agreements` (le scope user fonctionne et installe sous `%LOCALAPPDATA%\Programs\Microsoft\jdk-17.x.x.x-hotspot\`)
   - Set `JAVA_HOME` permanent : `[Environment]::SetEnvironmentVariable('JAVA_HOME', '<path>', 'User')`
3. Décompresser Keycloak, puis :

```powershell
# IMPORTANT : Keycloak 25 utilise KEYCLOAK_ADMIN/_PASSWORD (les KC_BOOTSTRAP_ADMIN_* sont pour Keycloak 26+)
$env:KEYCLOAK_ADMIN = 'admin'
$env:KEYCLOAK_ADMIN_PASSWORD = 'admin'
$env:JAVA_HOME = '<chemin JDK 17>'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
cd <keycloak-25.0.6>
# Si port 8080 déjà occupé chez toi, change-le ici
.\bin\kc.bat start-dev --http-port=8180
```

> **Note** : si la première tentative échoue (port en conflit, etc.), supprime `data/` AVANT de relancer — sinon le bootstrap admin est skippé car le master realm existe déjà.

## Importer le realm

Une fois Keycloak en route et l'admin connecté à http://localhost:8080 :

### Via UI (le plus simple)

1. Login http://localhost:8180/admin (admin/admin) → menu déroulant en haut à gauche → **Create realm**.
2. Section **Resource file** → upload `realm-matix.json`.
3. **Create**.

### Via REST API (testé sur Windows, plus fiable que kcadm.bat)

```powershell
# 1. Récupère un token admin
$body = @{ grant_type='password'; client_id='admin-cli'; username='admin'; password='admin' }
$token = (Invoke-RestMethod -Method POST -Uri "http://localhost:8180/realms/master/protocol/openid-connect/token" -ContentType "application/x-www-form-urlencoded" -Body $body).access_token

# 2. POST le realm
curl.exe -X POST "http://localhost:8180/admin/realms" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  --data-binary "@C:\Mata\Matix2.0\infra\keycloak\realm-matix.json"
# → HTTP 201

# 3. Vérifie
curl.exe -s -H "Authorization: Bearer $token" "http://localhost:8180/admin/realms/matix" | ConvertFrom-Json | Select-Object realm, enabled
```

### Aligner les user_id Keycloak avec tenant_members

Keycloak génère un `sub` UUID par user qui n'est PAS celui du seed dev. Pour que le check defense-in-depth de l'API passe en mode `keycloak`, il faut ajouter ces sub à `tenant_members` :

```powershell
# Récupère le sub du token user
$body = @{ grant_type='password'; client_id='matix-web'; username='owner@acme.test'; password='acme-dev-password' }
$tok = Invoke-RestMethod -Method POST -Uri "http://localhost:8180/realms/matix/protocol/openid-connect/token" -ContentType "application/x-www-form-urlencoded" -Body $body
# Décode la 2e partie du JWT pour avoir 'sub' — voir scripts/decode-jwt.ps1 (à venir)

# Insert dans tenant_members
$env:PGPASSWORD='matix_admin_dev'
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -h localhost -U matix_admin -d matix `
  -c "INSERT INTO tenant_members (tenant_id, user_id, email, role) VALUES ('<TENANT_UUID>', '<KEYCLOAK_SUB>', 'owner@acme.test', 'owner') ON CONFLICT DO NOTHING;"
```

⚠️ Phase 1 fix attendu : table `users` (id Matix interne, keycloak_sub nullable) — voir backlog. En l'état, dev mode et keycloak mode coexistent en ajoutant les 2 user_id distincts à tenant_members.

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
