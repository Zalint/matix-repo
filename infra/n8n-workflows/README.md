# Workflows n8n — templates Matix managés

> Modèle **managé** : ces 3 workflows servent de **templates** que chaque tenant peut
> activer + paramétrer (heure cron, destinataires, seuils) **sans pouvoir créer
> de nouveau workflow**. Pour un workflow custom, le tenant ouvre un ticket auprès
> de l'admin Matix qui ajoute un nouveau template au catalogue.
>
> Architecture (cf. `db/migrations/0011_workflow_templates.sql`) :
> - **`workflow_templates`** (table globale, gérée par admins Matix) — les 3 templates au démarrage
> - **`tenant_workflow_instances`** (RLS par tenant) — clones avec settings personnalisés
> - **n8n** est caché derrière l'UI Matix `/settings/workflows`. Le tenant n'a JAMAIS accès direct à l'UI n8n.
>
> Engine d'exécution : n8n Community (service Docker en profile `extras`).

## Inventaire

| Fichier | Workflow n8n | Trigger | État | Module Matix cible |
|---|---|---|---|---|
| `mata-banq-report.json` | MATA BANQ REPORT | Schedule 23h55 quotidien | Inactif | `analytics.reports.daily_digest` |
| `mlc-daily-report.json` | MLC N8N GMAIL V2 | Schedule 4h30 quotidien | **Actif** | `analytics.reports.daily_digest` |
| `mata-agent-webhook.json` | MATA AGENT WEBHOOK ASOFTODAY 19 | Webhook `GET /webhook/mata-rapport-today` | **Actif** | `analytics.ai.agent` + `analytics.reports.daily_digest` |

## Détail

### `mata-banq-report.json`
- 5 nodes : ScheduleTrigger → Code (date) → HttpRequest (`/external/api/status` Dépenses) → Code (format) → Gmail
- Email : "Rapport Matabanq au {date}" → `doucoure.saliou@gmail.com`, `ousmane.info@gmail.com`
- Source unique : Dépenses Management

### `mlc-daily-report.json`
- 7 nodes : ScheduleTrigger → 2 HttpRequest (MLC livreurStats + MLC orders) → 2 Code (format) → Set → Gmail
- Email : "MATA REPORT 2: MLC {date}" → 4 destinataires
- Sources : `matix-livreur-backend.onrender.com/api/external/mlc/*`

### `mata-agent-webhook.json` ⭐
- 36 nodes : Webhook entry → 16 HttpRequest en parallèle → 16 Code → Gmail + Respond
- **Agrège 16 APIs** :
  - **Matix/Maas** : `/api/external/{reconciliation×3, achats-boeuf, estimation, analytics, performance-achat, gestionStock, reconciliation/aggregated}`
  - **Dépenses** : `/external/api/{creance, status, virement}`
  - **MLC** : `/api/external/mlc/livreurStats/daily`
  - **Bictorys** : `/balance/me` + `/transactions/amount`
  - **Point-de-vente CRM** : `/api/external/point-vente/status`
- Email : "MATA REPORT 1: Ventes et Stock {date}"
- C'est le futur `analytics.ai.agent` : un endpoint qui agrège tout l'état business sur demande

## Templates Stratégie C (Phase 2)

Les 3 JSON `mata-*.json` à la racine sont les **workflows legacy n8n** exportés tels quels (URLs hardcodées vers les 3 apps Mata). Ils servent de référence historique.

Les **templates Stratégie C** (Matix orchestre, n8n exécute) sont dans `templates-strategy-c/` et suivent le pattern :

```
Webhook (POST) — reçoit { tenant_id, tenant_slug, api_base, service_token, recipients[], settings }
   ↓
HTTP Request → Matix API
   Headers: X-Service-Token + X-Service-Tenant-Id
   URL: {{ $json.api_base }}/api/external/...
   ↓ (RLS Postgres filtre par tenant_id)
Code (formatage)
   ↓
Send Email
   to: {{ $json.recipients.join(',') }}
   ↓
Respond to Webhook → { status: "sent", recipients_count, tenant_id }
```

### Templates disponibles

| Fichier | Template code | Nodes | Status |
|---|---|---|---|
| `templates-strategy-c/daily-cash-report-template.json` | `mata.daily_cash_report` | 5 | Seedé en DB ✓ |
| `templates-strategy-c/daily-mlc-report-template.json` | `mata.daily_mlc_report` | — | À créer (Phase 2 step 3) |
| `templates-strategy-c/daily-business-agent-template.json` | `mata.daily_business_agent` | — | À créer (Phase 2 step 3, complexe — 16 APIs) |

### Charger les templates en DB

Les `n8n_definition` de la table `workflow_templates` sont seedés via :

```powershell
pnpm --filter @matix/api db:seed:workflow-templates
```

Le script lit tous les `templates-strategy-c/*.json`, identifie le `meta.matix_template_code` dans chaque fichier, et UPDATE la row correspondante dans `workflow_templates`. Idempotent.

### Adapter les workflows legacy vers Stratégie C

Pour transformer un workflow legacy (ex: `mata-banq-report.json`) :

1. **Trigger** : remplacer `Schedule Trigger` par `Webhook` avec `httpMethod: POST` et `path: <slug>`
2. **HTTP Request** : remplacer chaque URL hardcodée par une expression :
   ```
   {{ $json.api_base }}/api/external/<endpoint>
   ```
   Et ajouter dans `headerParameters` :
   ```json
   { "name": "X-Service-Token",   "value": "={{ $json.service_token }}" },
   { "name": "X-Service-Tenant-Id", "value": "={{ $json.tenant_id }}" }
   ```
3. **Send Email** : remplacer `toEmail` codé en dur par :
   ```
   {{ $('Webhook').first().json.recipients.join(',') }}
   ```
4. **Ajouter** un node `Respond to Webhook` à la fin pour que Matix puisse logger le résultat
5. **Métadonnées** : ajouter dans `meta` :
   ```json
   {
     "matix_template_code": "mata.your_workflow_code",
     "matix_phase": "2-strategy-c",
     "matix_pattern": "managed-multi-tenant"
   }
   ```
6. **Sauvegarder** dans `templates-strategy-c/` puis run `pnpm db:seed:workflow-templates`

### Importer un template dans n8n (test bout-en-bout)

```powershell
# 1. Lancer n8n (profile extras)
.\scripts\start_matix.ps1 -WithExtras

# 2. UI n8n : http://localhost:5678
#    Login avec ton compte owner créé au setup

# 3. Workflows → "+" → Import from File
#    → infra/n8n-workflows/templates-strategy-c/daily-cash-report-template.json

# 4. Configurer les credentials SMTP dans le node Send Email :
#    En dev : SMTP localhost:1025 (MailHog) — démarrer avec docker compose --profile extras up -d mailhog
#    En prod : SES / SendGrid / Postmark

# 5. Activer le workflow (toggle "Active" en haut à droite)

# 6. Tester depuis Matix :
#    /admin/workflows → activer "mata.daily_cash_report" pour Mata Mbao
#    /settings/workflows → trigger manuel → vérifier email reçu via http://localhost:8025
```

---

## Plan d'implémentation (n8n reste — pas décommissionné)

n8n est l'engine d'exécution durable. Ce qui change Phase 2, c'est l'**UI Matix** qui wrappe n8n.

| Étape | Statut | Modules concernés |
|---|---|---|
| 1. Sauvegarde des JSON dans le repo | ✅ Fait | — |
| 2. Catalogage des modules cibles | ✅ Fait (catalog.ts) | `platform.workflows`, `platform.integrations`, `analytics.ai.agent`, `analytics.reports.daily_digest` |
| 3. Schéma DB `workflow_templates` + `tenant_workflow_instances` | ✅ Fait (migration 0011) | — |
| 4. Seed des 3 templates | ✅ Fait (migration 0011, n8n_definition à remplir Phase 2) | — |
| 5. Service de provisioning : clone template → instance n8n par tenant | 🔜 Phase 2 | `platform.workflows` |
| 6. UI superviseur `/settings/workflows` | 🔜 Phase 2 | `platform.workflows` |
| 7. Implémentation `analytics.reports.daily_digest` (sous-cas `platform.workflows`) | 🔜 Phase 2 | Wrap les 2 templates daily_*_report |
| 8. Implémentation `analytics.ai.agent` (LLM + tools, peut appeler `platform.workflows`) | 🔜 Phase 2/3 | Wrap mata.daily_business_agent + ajout LLM |
| 9. Multi-tenancy n8n via tags `tenant=<slug>` | 🔜 Phase 2 | Isolation cosmétique côté UI n8n (admins Matix) |

## Lancer n8n en local (Docker)

n8n est intégré au `docker-compose.yml` en profile `extras` (pas démarré par défaut). Persistance dans la même DB Postgres (`db = n8n`, user `n8n`).

### Premier démarrage

```powershell
# Si tu pars d'un setup existant : crée la DB n8n dans Postgres
docker exec -i matix-postgres psql -U matix_admin -d postgres < db/init/02_create_n8n_db.sql

# Démarre le service n8n
docker compose --profile extras up -d n8n

# Logs (n8n met ~30 sec à booter au 1er démarrage : init schema Postgres)
docker logs -f matix-n8n
```

### Accéder à l'UI

- URL : **http://localhost:5678**
- Login : `admin` / `admin` (basic auth, dev only — change-le pour prod)
- Au premier login, n8n te demande de créer un compte propriétaire (email + password). Choisis ce que tu veux, c'est local.

### Importer les 3 workflows existants

Le dossier `infra/n8n-workflows/` est monté dans le conteneur en `/workflows` (read-only). Pour importer un workflow :

**Via l'UI** :
1. Workflows → "+" → "Import from File"
2. Choisir `mata-banq-report.json`, `mlc-daily-report.json` ou `mata-agent-webhook.json`
3. Reconnecter les credentials manquants (Gmail OAuth, API keys Bictorys) — ils ne sont pas versionnés pour des raisons de sécurité

**Via CLI** (alternative, plus rapide pour les 3 d'un coup) :
```powershell
docker exec matix-n8n n8n import:workflow --separate --input=/workflows
```

### Activer un workflow

Par défaut les workflows sont importés en état "désactivé". Pour activer :
1. Ouvrir le workflow dans l'UI
2. Toggle "Active" en haut à droite

⚠️ **Avant d'activer en local** : vérifie que tu ne vas pas envoyer d'emails réels avec les credentials Gmail. Désactive les nodes `Gmail` ou remplace par un node MailHog (`mailhog:1025` SMTP) pour les tests.

### Arrêter / supprimer

```powershell
docker compose stop n8n              # arrêt simple (volume persistant)
docker compose down                  # arrête tout (volume persistant)
docker volume rm matix20_matix-n8n-data  # ⚠ supprime aussi tous les workflows + credentials
```

## Sécurité (important)

- **Credentials non versionnés** : les fichiers JSON ici ne contiennent pas les API keys, OAuth tokens, passwords. Tu les ressaisiras à l'import.
- **Auth basique = dev only** : `admin/admin` est OK en local. En prod : Keycloak SSO devant n8n via reverse proxy, ou désactiver l'UI publique.
- **Données sensibles** : n8n stocke les exécutions (logs HTTP, payloads) en DB. Si un workflow appelle une API qui retourne des données client, ces données vivent dans la DB n8n. Pas critique en dev, à reconsidérer en prod (rétention courte + anonymisation).
