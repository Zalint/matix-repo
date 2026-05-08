# Local setup — Docker Compose

Setup local dev pour Matix avec **Postgres + Keycloak en conteneurs Docker**.
Remplace l'ancien setup natif (Postgres 17 installé localement, Keycloak Java en process).

## Prérequis

- **Docker Desktop** ≥ 4.70 (Windows : avec WSL2 backend)
- **Node.js** ≥ 20, **pnpm** ≥ 9 (`corepack enable` puis `pnpm install`)
- **5 GB d'espace disque** libre (images + volumes)

> **Windows : exclusion antivirus.** Windows Defender peut zéroter certains
> binaires extraits dans les images Alpine (notamment `docker-entrypoint.sh`).
> Symptôme : `exec format error` au démarrage. C'est pour ça qu'on utilise
> les images Debian (`postgres:17`) plutôt qu'Alpine. Si tu rencontres
> quand même le souci, ajoute `%LOCALAPPDATA%\Docker` aux exclusions Defender.

## Démarrage rapide

### Première installation

```powershell
git clone <repo> matix && cd matix
pnpm install
docker compose up -d         # Postgres + Keycloak
pnpm db:migrate              # Schéma + reference data
pnpm db:seed                 # (optionnel) Seed données
```

### Au quotidien — script `start_matix.ps1`

```powershell
# Tout démarrer (Docker + API + Web en fenêtres séparées)
.\scripts\start_matix.ps1

# Mode dev (auth simulée via X-Dev-* headers, pas de Keycloak côté API)
.\scripts\start_matix.ps1 -Mode dev

# Force kill de l'API/Web précédent avant de redémarrer
.\scripts\start_matix.ps1 -StopFirst
```

Le script :
- vérifie que Docker tourne, lance la stack Compose si besoin (idempotent)
- attend le healthcheck Postgres + le realm Keycloak
- ouvre **API** (port 3001) et **Web** (port 3000) dans des fenêtres PowerShell séparées
- affiche un récap (URLs, comptes de test Keycloak)

### Stop

```powershell
.\scripts\stop_matix.ps1                # API + Web stoppés, Docker stoppé (mais conteneurs préservés)
.\scripts\stop_matix.ps1 -KeepDocker    # juste API + Web, laisse Postgres/Keycloak tourner
.\scripts\stop_matix.ps1 -Down          # idem mais 'docker compose down' (vire les conteneurs, garde les volumes)
.\scripts\stop_matix.ps1 -WipeData      # ⚠ reset complet : supprime aussi les volumes
```

### Sans le script (équivalent manuel)

```powershell
docker compose up -d         # Postgres + Keycloak
pnpm dev                     # API + Web ensemble (turbo, pas de fenêtres séparées)
# Ctrl+C pour stop pnpm dev
docker compose stop          # stop Docker
```

Tout doit être prêt :
- API → http://localhost:3001
- Web → http://localhost:3000
- Keycloak admin → http://localhost:8080/admin (admin / admin)
- Postgres → `localhost:5432` (matix_admin / matix_admin_dev / db `matix`)

## Stack Compose

| Service | Image | Port host | Profile |
|---|---|---|---|
| `matix-postgres` | `postgres:17` (Debian) | 5432 | default |
| `matix-keycloak` | `quay.io/keycloak/keycloak:25.0` | 8080 | default |
| `matix-redis` | `redis:7-alpine` | 6379 | `extras` |
| `matix-mailhog` | `mailhog/mailhog:latest` | 1025 (SMTP), 8025 (UI) | `extras` |

**Keycloak persistence** : Keycloak utilise Postgres comme DB (pas H2). La DB
`keycloak` et le user `keycloak` sont créés au premier boot via
`db/init/01_create_keycloak_db.sql`. Si tu démarres sur un Postgres déjà
initialisé, run le script manuellement :

```powershell
docker exec -i matix-postgres psql -U matix_admin -d postgres < db/init/01_create_keycloak_db.sql
```

> Note : `KC_DB: dev-mem` (H2 in-memory) **n'est pas viable** pour un dev
> quotidien — Hikari ferme les connexions après ~10min, H2 perd toutes ses
> tables → erreur 500 au login. `dev-file` (H2 persisté) souffre de soucis
> de perms volume. Donc on utilise Postgres.

Les services en `extras` se démarrent à la demande :

```powershell
docker compose --profile extras up -d redis mailhog
```

## Volumes & init

- `matix-pgdata` : data Postgres (persistant entre `down`/`up`)
- `./db/init/` → monté en `/docker-entrypoint-initdb.d` : crée les rôles
  `matix_admin` (BYPASSRLS) et `matix_app` (subject à RLS) au premier boot.
- `./infra/keycloak/realm-matix.json` → importé au démarrage de Keycloak via
  `start-dev --import-realm`.

> **Reset complet** : `docker compose down -v` supprime les volumes (pgdata + KC).
> Au prochain `up`, init scripts + realm-import seront rejoués.

## Variables d'env

| Variable | Default (compose) | Notes |
|---|---|---|
| `POSTGRES_HOST` | `localhost` | |
| `POSTGRES_PORT` | `5432` | |
| `POSTGRES_DB` | `matix` | |
| `POSTGRES_ADMIN_USER` | `matix_admin` | utilisé par migrations |
| `POSTGRES_ADMIN_PASSWORD` | `matix_admin_dev` | |
| `POSTGRES_APP_USER` | `matix_app` | utilisé par l'API à runtime (RLS) |
| `POSTGRES_APP_PASSWORD` | `matix_app_dev` | |
| `KEYCLOAK_ISSUER` | `http://localhost:8080/realms/matix` | **port 8080 en Docker** (était 8180 en natif) |
| `AUTH_MODE` | `dev` | `dev` = headers `X-Dev-*`, `keycloak` = JWT Bearer |

Copier `.env.example` → `.env` (root) et `apps/web/.env.local.example` → `apps/web/.env.local` au premier setup.

## Migration depuis l'ancien setup natif

Si tu avais une instance native Postgres 17 en local avec des données à conserver :

```powershell
# 1. Dump (avant de tout démolir)
pg_dump --data-only --column-inserts -h localhost -p 5432 -U matix_admin matix > db/backups/matix-data.sql

# 2. Stop Postgres natif (Services Windows ou ton process Java)
# 3. Démarrer le stack Docker
docker compose up -d
pnpm db:migrate

# 4. Restaurer (avec FK bypass car le dump est data-only)
docker cp ./db/backups/matix-data.sql matix-postgres:/tmp/restore.sql
docker exec matix-postgres bash -c "echo 'BEGIN;' > /tmp/wrap.sql && echo 'SET session_replication_role = replica;' >> /tmp/wrap.sql && cat /tmp/restore.sql >> /tmp/wrap.sql && echo 'COMMIT;' >> /tmp/wrap.sql"
docker exec matix-postgres psql -U matix_admin -d matix -v ON_ERROR_STOP=1 -f /tmp/wrap.sql
```

## Troubleshooting

### `exec format error` au démarrage de Postgres
Antivirus Windows zérote l'entrypoint. Solution : on utilise déjà `postgres:17`
(Debian) qui n'est pas affecté. Si le problème persiste : `docker compose down -v`,
ajouter `%LOCALAPPDATA%\Docker` à l'exclusion Defender, puis `docker compose up -d`.

### `failed to connect to docker API`
Le daemon Docker Desktop est mort malgré ce qu'affiche l'UI. Solution :
clic droit sur l'icône whale dans le tray Windows → **Restart**, attendre
30-60s que ça redevienne vert.

### `transaction_timeout` not recognized
Tu restaures un dump fait avec Postgres 17+ dans une image Postgres 16.
Solution : utiliser `postgres:17` dans `docker-compose.yml` (déjà le cas).

### Realm Keycloak non importé
Vérifier les logs : `docker logs matix-keycloak`. Erreurs courantes :
- Champ JSON inconnu (`UnrecognizedPropertyException`) → strict parser KC25
  refuse les commentaires custom dans `realm-matix.json`. Retirer la clé.
- `--import-realm` n'est pas dans la commande → vérifier `docker-compose.yml`.

Après correction : `docker compose restart keycloak`.

### Login Keycloak → page d'erreur 500 "Nous sommes désolés"
Symptôme : Keycloak charge bien le branding MATIX mais erreur 500 à l'authorize.
Logs : `Table "REALM_ATTRIBUTE" not found (this database is empty)`.

C'est le bug `KC_DB: dev-mem` — H2 in-memory perd ses tables quand les
connexions Hikari ferment. Solution déjà appliquée : `KC_DB: postgres` avec
DB dédiée. Si tu repars d'un setup ancien où c'était encore en `dev-mem` :

```powershell
# Update docker-compose.yml (KC_DB: postgres + URL/creds)
# Création de la DB keycloak
docker exec -i matix-postgres psql -U matix_admin -d postgres < db/init/01_create_keycloak_db.sql
docker compose up -d --force-recreate keycloak
```

### Login Keycloak → "user_not_found" pour admin/admin
L'admin du realm master n'existe pas. Pour KC 25, les env vars sont
`KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` (pas `KC_BOOTSTRAP_ADMIN_*`,
qui est pour KC 26+). L'admin n'est créé qu'au **premier boot avec une DB
vierge**. Si la DB existe déjà :

```powershell
docker compose stop keycloak
docker exec matix-postgres psql -U matix_admin -d postgres -c "DROP DATABASE keycloak; CREATE DATABASE keycloak OWNER keycloak;"
docker compose up -d keycloak
```

## Commandes utiles

```powershell
# Logs
docker logs -f matix-postgres
docker logs -f matix-keycloak

# Shell Postgres
docker exec -it matix-postgres psql -U matix_admin -d matix

# Status
docker compose ps

# Reset DB seulement (garde Keycloak)
docker compose down
docker volume rm matix20_matix-pgdata
docker compose up -d postgres
pnpm db:migrate

# Stop tout
docker compose down

# Stop + wipe data
docker compose down -v
```

## Liens

- ADR-0006 — RLS & multi-tenant
- `infra/keycloak/README.md` — détails du realm + procédures admin
- `db/migrations/` — schema versioning manuel (numéroté `0001_*.sql`)
