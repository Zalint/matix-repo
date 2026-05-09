# Matix — Quickstart Dev (credentials & URLs)

> Cheat-sheet pour démarrer rapidement la stack Matix en local et trouver
> tous les comptes/passwords/URLs au même endroit.
>
> Pour le détail (architecture, troubleshooting, migration depuis ancien
> setup) → voir `docs/local-setup.md`.

## ⚡ TL;DR

```powershell
# 1. Vérifier Docker Desktop UP (whale icon vert dans le tray)
# 2. Démarrer toute la stack
.\scripts\start_matix.ps1

# 3. Browser http://localhost:3000 → bouton "Se connecter"
# 4. Login : owner@mata-mbao.test / Maas2026!
```

C'est tout. Le script lance Postgres + Keycloak + n8n + Redis + MailHog + API + Web automatiquement.

---

## 🌐 URLs des services

| Service | URL | Notes |
|---|---|---|
| **Frontend Matix** | http://localhost:3000 | Next.js — POS, settings, admin |
| **API Matix** | http://localhost:3001 | NestJS — `/health`, `/readyz` |
| **Keycloak admin** | http://localhost:8081/admin | Realm config, users mgmt |
| **Keycloak realm matix** | http://localhost:8081/realms/matix/account | Compte user end-user |
| **n8n workflows** | http://localhost:5678 | Designer visuel |
| **MailHog (UI)** | http://localhost:8025 | Voir les emails envoyés en dev |
| **MailHog (SMTP)** | localhost:1025 | Pour configurer comme SMTP dans n8n |
| **Postgres** | localhost:5432 | DB principal |
| **Redis** | localhost:6379 | Cache (à utiliser plus tard) |

> ⚠️ **Port Keycloak = 8081** (pas 8080) — on a déplacé pour éviter le conflit
> avec Apache/PEMHTTPD-x64. Cf. commit `accfb5a`.

---

## 🔐 Credentials

### Postgres

| Compte | Password | DB | Usage |
|---|---|---|---|
| `matix_admin` | `matix_admin_dev` | `matix` | Migrations, ops, super-admin (BYPASSRLS) |
| `matix_app` | `matix_app_dev` | `matix` | Compte applicatif (soumis à RLS — 99% du code) |
| `keycloak` | `keycloak_dev` | `keycloak` | Persistance Keycloak |
| `n8n` | `n8n_dev` | `n8n` | Persistance n8n |

Connexion shell :
```powershell
docker exec -it matix-postgres psql -U matix_admin -d matix
```

### Keycloak — admin du realm master

| Login | Password |
|---|---|
| `admin` | `admin` |

URL : http://localhost:8081/admin

### Keycloak — users du realm matix (comptes de test Mata)

Mode `keycloak` (par défaut), via le bouton "Se connecter" sur le frontend :

| Email | Password | Tenant | Rôle | Données |
|---|---|---|---|---|
| `owner@mata-mbao.test` | `Maas2026!` | Mata Mbao | owner | **128 produits Maas** + 1 vente + 1 POS |
| `owner@mata-keur-massar.test` | `Maas2026!` | Mata Keur Massar | owner | **128 produits Maas** + 1 POS |
| `owner@acme.test` | `acme-dev-password` | Acme SARL (test) | owner | seed minimal |
| `owner@beta.test` | `beta-dev-password` | Beta SUARL (test) | owner | (vide) |

### Mode dev (sans Keycloak — tests E2E, debug rapide)

Si `AUTH_MODE=dev` (env var ou flag du script), pas besoin de Keycloak. Le frontend envoie directement :

```http
GET /api/sales
X-Dev-Tenant-Id: <tenant_uuid>
X-Dev-User-Id:   <user_uuid>
```

Récupérer les UUIDs des tenants / users :
```powershell
docker exec matix-postgres psql -U matix_admin -d matix -c "SELECT slug, id FROM tenants;"
docker exec matix-postgres psql -U matix_admin -d matix -c "SELECT user_id, email, role FROM tenant_members;"
```

### n8n owner

Compte créé manuellement au **premier démarrage** de n8n (écran `/setup`). À toi de définir email + password lors du premier login. Stocké dans la DB Postgres `n8n` (pas en clair).

Si tu oublies → reset complet :
```powershell
docker exec matix-postgres psql -U matix_admin -d postgres -c "DROP DATABASE n8n; CREATE DATABASE n8n OWNER n8n;"
docker compose up -d --force-recreate n8n
# → écran /setup réapparaît
```

### Token de service Matix (pour appels n8n → API Matix)

```
MATIX_SERVICE_TOKEN  (à définir dans .env, ex: une longue chaîne aléatoire)
```

n8n utilise ce token + `X-Service-Tenant-Id` pour appeler l'API Matix avec un tenant_id arbitraire :

```http
GET /api/external/dashboard/cash-summary
X-Service-Token: <MATIX_SERVICE_TOKEN>
X-Service-Tenant-Id: <tenant-uuid>
```

L'API recoit ce header, valide le token, et applique RLS Postgres avec le tenant_id reçu.

> Pour générer un token costaud :
> ```powershell
> [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
> ```

---

## 🚀 Commandes courantes

### Premier setup (clone du repo)

```powershell
pnpm install
docker compose up -d           # Postgres + Keycloak (et plus si profile extras)
pnpm db:migrate                # Applique les migrations 0001 → 00NN
pnpm db:seed                   # (optionnel) seed dev
pnpm --filter @matix/api db:seed:kc-users    # seed users Keycloak Mata
pnpm --filter @matix/api db:seed:workflow-templates  # seed n8n_definition templates
```

### Au quotidien

```powershell
# Tout démarrer (recommandé en dev)
.\scripts\start_matix.ps1

# Stack minimale (sans n8n/Redis/MailHog)
.\scripts\start_matix.ps1 -NoExtras

# Stack en mode dev (auth simulée, pas Keycloak)
.\scripts\start_matix.ps1 -Mode dev

# Tuer les anciens process avant
.\scripts\start_matix.ps1 -StopFirst
```

### Tests

```powershell
# Tests E2E anti-fuite multi-tenant (55 tests)
$env:AUTH_MODE='dev'; pnpm --filter @matix/api test:e2e

# TypeScript build clean
cd apps/api ; npx tsc --noEmit
cd apps/web ; npx tsc --noEmit
```

### Stop

```powershell
# Stop tout (API + Web + Docker, volumes préservés)
.\scripts\stop_matix.ps1

# Juste API + Web (Docker reste UP)
.\scripts\stop_matix.ps1 -KeepDocker

# Down (retire conteneurs, volumes préservés)
.\scripts\stop_matix.ps1 -Down

# ⚠ Reset complet (perd DB + Keycloak + n8n)
.\scripts\stop_matix.ps1 -WipeData
```

### Logs

```powershell
docker logs -f matix-postgres
docker logs -f matix-keycloak
docker logs -f matix-n8n
# Logs API/Web : voir les fenêtres PowerShell ouvertes par start_matix.ps1
```

### DB shell

```powershell
docker exec -it matix-postgres psql -U matix_admin -d matix
# Une fois connecté :
#   \dt           → liste tables
#   \du           → liste users
#   \l            → liste databases
#   \q            → quit
```

---

## 📂 Pages utiles dans l'UI

| Page | URL | Login requis |
|---|---|---|
| Login | http://localhost:3000/login | non |
| Dashboard | http://localhost:3000 | oui |
| Caisse / POS | http://localhost:3000/sales | oui |
| Stocks | http://localhost:3000/stock | oui |
| Clients | http://localhost:3000/customers | oui |
| Modules & licences | http://localhost:3000/settings/modules | oui (owner/admin) |
| **Workflows tenant** | http://localhost:3000/settings/workflows | oui (Pro+) |
| Équipe | http://localhost:3000/settings/team | oui (admin+) |
| **Workflows admin Matix** | http://localhost:3000/admin/workflows | oui (super-admin TODO) |
| Tenants admin | http://localhost:3000/admin/tenants | oui (super-admin TODO) |

---

## 🔌 Endpoints API utiles

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness probe (toujours 200 si l'app tourne) |
| `GET /readyz` | Readiness probe (vérifie DB + Keycloak) |
| `GET /workflows/templates` | Templates dispos pour le tenant courant |
| `GET /workflows/instances` | Mes workflows actifs |
| `POST /workflows/activate` | Activer un template |
| `GET /admin/workflow-templates` | (admin) Tous les templates |
| `POST /admin/licensing/:tenant_id/plan` | (admin) Changer le plan d'un tenant |

---

## 🐛 Troubleshooting express

| Problème | Solution |
|---|---|
| Docker daemon down | Restart Docker Desktop (whale tray → Restart) |
| Port 8081 (Keycloak) occupé | `npx kill-port 8081` ou `Stop-Service <service>` |
| Port 5432 occupé par Postgres natif | `Stop-Service postgresql-x64-17` |
| `pnpm db:migrate` échoue | Vérifier que matix-postgres tourne (`docker ps`) |
| Login Keycloak → "Nous sommes désolés" | Détaillé dans `docs/local-setup.md` (section troubleshooting) |
| n8n ne démarre pas | Cf. `infra/n8n-workflows/README.md` |
| `EBUSY` sur fichier `.docx` | Ferme Word, retente |
| Tests E2E hang | Tuer les process node : `Get-Process node \| Stop-Process -Force` |

---

## 📚 Pour aller plus loin

- **`docs/local-setup.md`** — Setup détaillé + troubleshooting complet
- **`docs/architecture-explained.md`** — Comment auth + multi-tenant fonctionnent
- **`docs/architecture-faq.md`** — 20 Q&R sur l'archi
- **`docs/granularity-and-scalability.md`** — Granularité 50+ modules, scaling, Docker rationale
- **`docs/feature-coverage-vs-mata-apps.md`** — Audit des 94 fonctionnalités legacy
- **`README.md`** — Stack, structure, État détaillé, Roadmap
- **`infra/n8n-workflows/README.md`** — Workflows n8n + pattern Stratégie C

---

## 🔒 Sécurité (rappel)

> ⚠️ **Tous les passwords/credentials de cette doc sont des passwords DEV LOCAL uniquement.**

En prod :
- Tous les passwords doivent venir d'un **secrets manager** (Vault, AWS Secrets Manager, GCP Secret Manager, Doppler)
- `MATIX_SERVICE_TOKEN` doit être une chaîne aléatoire de 32+ bytes, jamais en clair dans `.env`
- Désactive le mode `AUTH_MODE=dev` (force `keycloak`)
- Désactive `WORKFLOWS_CRON_ENABLED` tant que les templates n8n ne sont pas validés
- Active 2FA sur Keycloak pour les owners de tenants

Cf. ADR-0001 (RLS) + ADR-0003 (Keycloak) pour les principes de sécurité.
