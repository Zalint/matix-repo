# Matix

Suite SaaS B2B modulaire multi-tenant — inspirée Odoo, ciblée PME africaines (Sénégal Phase 1).

> Statut : **Phase 0/1 — POC multi-tenant RLS + POS Maas opérationnels**.
> Login Keycloak, isolation tenant validée par 55 tests e2e, données Maas (Mata Mbao + Mata Keur Massar)
> importées et accessibles via le POS.

## Vision

Matix unifie en une seule plateforme modulaire les fonctionnalités aujourd'hui éclatées entre les apps Mata existantes :
- **Maas App** — Ventes, Stock, Réconciliation, Achats
- **Matix Livreur (MLC)** — CRM, Livraison, GPS, Pointages
- **Dépenses Management** — Comptabilité, Créances, Snapshots

**88 modules cibles dans 6 piliers** (cf. `apps/api/src/modules/licensing/catalog.ts`) :
- **Platform (13)** — Identity/Tenancy, Team, Audit, Notifications, Files, API keys, Webhooks, Settings, Snapshots, Integrations, Workflows
- **Commercial (16)** — CRM, Sales/POS, Subscriptions, Pricing, Loyalty
- **Operations (22)** — Inventory, Procurement, Delivery/GPS, HR-lite, Livestock
- **Finance (22)** — Accounting (SYSCOHADA double-entry), Expenses, Invoicing, Payments, Receivables, Banking
- **Analytics (15)** — Dashboards, Reports (incl. daily_digest), Exports, AI insights, AI agent (LLM), Market intelligence
- **Marketplace (0, Phase 4)** — Catalog, Vendors, Commissions

## Stack

| Couche | Choix | Raison |
|---|---|---|
| Backend | **NestJS** (TypeScript) | Modules natifs = bounded contexts |
| Accès DB | **`pg` direct + RLS Postgres** | Connection scopée par tenant via CLS, pas de magie ORM (ADR-0001) |
| ORM (escape hatch) | **Drizzle** (en deps, peu utilisé) | Compatible avec un client `pg` injecté, type-safe à terme |
| DB | **PostgreSQL 17 + RLS** | Multi-tenancy à milliers de tenants |
| SSO | **Keycloak 25** (self-hosted, DB Postgres dédiée) | OIDC standard, refresh tokens, MFA-ready |
| Frontend | **Next.js 15** (App Router) + Tailwind + shadcn/ui | PWA-ready, RSC |
| Auth client | **Auth.js v5** (NextAuth) | Intégration Keycloak provider native |
| Mobile | PWA → Capacitor plus tard | 1 codebase |
| Cache/Queue | Redis + BullMQ (prévu, en `extras` profile) | Standard |
| Mail dev | MailHog (en `extras` profile) | Capture SMTP locale |
| Paiements | **Bictorys** (Wave / OM / MTN MoMo) — Phase 1+ | Intégration unique multi-opérateurs |
| Files | Cloudflare R2 — Phase 1+ | Pas d'egress fees |
| Hébergement Phase 1 | Hetzner + Coolify | Budget $1000/mo cible respecté |
| Mono-repo | pnpm workspaces + Turborepo | `pnpm dev` lance API + Web en parallèle |
| Infra locale | **Docker Compose** | Postgres + Keycloak en conteneurs, apps Node natives (cf. `docs/local-setup.md`) |
| Workflows externes (transition) | **n8n** (3 workflows) — service Docker en profile `extras`, DB partagée Postgres | Rapports quotidiens email + agent agrégateur APIs ; à absorber par `platform.workflows` + `analytics.ai.agent` Phase 2/4 (cf. `infra/n8n-workflows/`) |

**Décisions explicites** : monolithe modulaire (pas microservices), Postgres RLS (pas schema-per-tenant ni DB-per-tenant), SYSCOHADA double-entry strict, **pas d'offline-first** Phase 1.

Voir `docs/adr/` pour le détail des décisions architecturales et `docs/granularity-and-scalability.md` pour la rationale complète.

## Structure

```
Matix2.0/
├── apps/
│   ├── api/                # Backend NestJS (monolithe modulaire, 10 modules métier)
│   └── web/                # Frontend Next.js — POS fonctionnel + login Keycloak
├── packages/
│   └── shared/             # Types partagés API ↔ Web
├── db/
│   ├── migrations/         # 10 migrations SQL versionnées (000N_*.sql)
│   ├── init/               # Scripts d'init Postgres au 1er boot du conteneur
│   ├── backups/            # Dumps + scripts d'import (gitignored hors README)
│   └── seed.sql            # Seed dev de base
├── docs/
│   ├── architecture-explained.md     # Auth + RLS expliqués accessiblement
│   ├── granularity-and-scalability.md # Granularité 50 modules + Docker rationale
│   ├── business-rules-catalog.md      # Logique métier issue de Maas/MLC/Dépenses
│   ├── local-setup.md                 # Démarrage Docker + troubleshooting
│   └── adr/                           # 7 Architecture Decision Records
├── infra/
│   ├── keycloak/           # realm-matix.json + procédures admin
│   └── n8n-workflows/      # 3 workflows JSON + README (à absorber Phase 2/4)
├── scripts/
│   ├── start_matix.ps1     # Lance Docker + API + Web (Windows)
│   ├── stop_matix.ps1      # Stoppe API/Web et/ou Docker
│   └── check-rls-migrations.sh
└── docker-compose.yml      # Postgres + Keycloak (default), Redis + MailHog + n8n (extras)
```

## Démarrer en local

Pré-requis : **Node 20+**, **pnpm 9+**, **Docker Desktop**.

### Première installation

```bash
pnpm install
docker compose up -d           # Postgres + Keycloak en arrière-plan
pnpm db:migrate                # 9 migrations
pnpm db:seed                   # 5 tenants de test (acme, beta, demo-corp, mata-mbao, mata-keur-massar)
```

### Au quotidien

```bash
# Tout démarrer (Docker + API + Web)
pnpm dev                       # Turbo lance @matix/api (3001) + @matix/web (3000)

# Ou via le script PowerShell (Windows) — fenêtres séparées avec logs visibles
.\scripts\start_matix.ps1
```

### Tests anti-fuite multi-tenant (CRITIQUE)

```bash
pnpm --filter @matix/api test:e2e
# → 55 tests e2e validant l'isolation cross-tenant via RLS
```

Doc complète, troubleshooting et procédures dans **`docs/local-setup.md`**.

## Comptes de test (mode `keycloak`)

| Email | Mot de passe | Tenant | Données |
|---|---|---|---|
| `owner@mata-mbao.test` | `Maas2026!` | Mata Mbao | 128 produits Maas, 1 vente, 1 POS |
| `owner@mata-keur-massar.test` | `Maas2026!` | Mata Keur Massar | 128 produits Maas, 1 POS |
| `owner@acme.test` | `acme-dev-password` | Acme SARL (test) | seed minimal |
| `owner@beta.test` | `beta-dev-password` | Beta SUARL (test) | (vide) |

Compte admin Keycloak : http://localhost:8080/admin — `admin` / `admin`.

## ADRs publiés

| # | Titre |
|---|---|
| [0001](docs/adr/0001-multi-tenancy-rls.md) | Multi-tenancy avec Postgres RLS |
| [0002](docs/adr/0002-module-convention.md) | Convention des modules NestJS |
| [0003](docs/adr/0003-auth-keycloak.md) | Auth via Keycloak (OIDC) |
| [0004](docs/adr/0004-pilier-commercial-domain.md) | Pilier Commercial — domain model |
| [0005](docs/adr/0005-module-catalog.md) | Catalogue centralisé des modules |
| [0006](docs/adr/0006-licensing-permissions.md) | Licensing & permissions orthogonales |
| [0007](docs/adr/0007-catalog-deepaudit-update.md) | Audit profond du catalogue (post-Maas) |

## État détaillé

### ✅ Fait à ce jour

**Fondations**
- Multi-tenant RLS Postgres (ADR-0001) — isolation cross-tenant validée par **55 tests e2e** (ventes, inventaire, customers, points-of-sale, licensing, team)
- Auth **Keycloak 25** OIDC + Auth.js v5 côté web, refresh tokens, mode `dev` (headers `X-Dev-*`) pour tests/CI
- Catalogue centralisé de **88 modules** + table `plans` + `tenant_licenses` + `role_permissions` (ADR-0005, ADR-0006)
- Convention modules NestJS appliquée à tous les modules (ADR-0002)
- **10 migrations SQL** versionnées (`db/migrations/000N_*.sql`) + runner idempotent
- **Infra Docker locale** : Postgres 17 + Keycloak 25 (DB Postgres dédiée), scripts `start_matix.ps1` / `stop_matix.ps1`, doc `local-setup.md`
- Documentation : 4 docs accessibles (`architecture-explained`, `granularity-and-scalability`, `business-rules-catalog`, `local-setup`) + 7 ADRs

**Modules métier livrés (10 NestJS)**
| Pilier | Module | Backend | Frontend |
|---|---|---|---|
| Platform | `identity` (auth + sessions) | ✓ | ✓ login Keycloak |
| Platform | `team` (membres, rôles) | ✓ | ✓ page équipe |
| Platform | `tenants_admin` (provisioning) | ✓ | ✓ admin tenants |
| Platform | `licensing` (plans, modules, permissions) | ✓ | ✓ page Modules & licences |
| Commercial | `crm.customers` | ✓ | ✓ page clients |
| Commercial | `sales.pos` | ✓ | ✓ Caisse + Standard, panier, paiements |
| Commercial | `products` + `product_categories` | ✓ | ✓ grille avec familles Boucherie/Épicerie |
| Operations | `inventory.levels` | ✓ | ✓ page stocks |
| Operations | `inventory.movements` (auto-décrément ventes) | ✓ | (UI partielle) |
| Operations | `points_of_sale` | ✓ | ✓ switcher PV |

**Données métier**
- 5 tenants seed : Acme, Beta, Demo Corp, **Mata Mbao**, **Mata Keur Massar**
- **128 produits Maas/tenant** (dédupliqués depuis 267 → fusion Boucherie : Bovin, Ovin, Caprin, Volaille, Poisson, Pack ; Épicerie : Autres)
- 4 plans (Free, Starter, Pro, Enterprise) avec ~78 modules dans le plan Pro
- 4 users Keycloak fonctionnels (cf. tableau Comptes de test ci-dessus)

---

### 🚧 Reste à faire

**Phase 1 — MVP vendable (en cours)**
- Commercial : `sales.cash_closure` (clôture caisse), `sales.reconciliation` (formule Pération Maas), `sales.discounts`, `pricing.lists` + `pricing.history`
- Finance : `invoicing.tickets` + `invoicing.invoices` + `credit_notes` + génération PDF
- Paiements : intégration **Bictorys** (Wave / Orange Money / MTN MoMo) + `payments.cash`
- Analytics : `dashboards.sales`, `dashboards.inventory`, `exports.csv`/`excel`
- Infra : CI/CD (GitHub Actions : lint + test + deploy), Cloudflare R2 pour fichiers, déploiement Hetzner + Coolify

**Phase 2 — Verticale logistique**
- Delivery : `orders`, `drivers`, `gps`, `routes`, `scoring` (formule MLC), `proof_of_delivery`, `bidirectional_ratings`
- HR-lite : `timesheets` (avec photo start/end), `expenses` (carburant, réparations, etc.), `schedules`
- Commercial : `subscriptions.plans` (cartes MLC) + `subscriptions.billing`
- **Plateforme & IA** : `platform.integrations` (hub Gmail/Bictorys/Slack) + `platform.workflows` (modèle managé : 3 templates Matix paramétrables par tenant, engine n8n caché derrière UI Matix `/settings/workflows`) + `analytics.ai.agent` (chatbot multi-API LLM, successeur webhook MATA AGENT) + `analytics.reports.daily_digest` (wrap les 2 templates daily reports)

**Phase 3 — Verticale finance (SYSCOHADA)**
- Comptabilité : `accounting.gl` (Grand Livre double-entry), `accounting.statements` (bilan, P&L), `accounting.tax` (TVA + déclarations)
- Achats : `procurement.purchase_orders`, `suppliers`, `receiving`, `slaughter` (process abattage Mata)
- Créances : `receivables.aging`, `reminders`, `portfolio` (depuis Dépenses Management)
- Dépenses : `expenses.entry`, `approval`, `ocr` (lecture factures par photo)
- Banque : `banking.accounts`, `reconciliation`, `transfers`
- Partenaires : `partners.accounts`, `partners.deliveries`

**Phase 4 — Plateforme**
- `platform.api_keys` + `platform.webhooks` (intégrations tierces)
- API publique externe documentée (OpenAPI)
- Marketplace de modules tiers
- **Migration progressive** des 3 apps Mata existantes (Maas App, MLC, Dépenses Management) vers Matix
- Veille marché AI (`analytics.market_intelligence` — RSS + GPT, depuis Maas)

> Note : `platform.workflows` est en Phase 2 (modèle managé, n8n DURABLE comme engine — pas décommissionné). Création de workflows custom hors templates = ticket admin Matix.

Pour la liste exhaustive des modules avec leur statut détaillé : `apps/api/src/modules/licensing/catalog.ts`.

---

## Roadmap haut niveau

| Phase | Durée | Livrable | Statut |
|---|---|---|---|
| **0 — Fondations** | 2 mois | Auth/SSO, multi-tenant RLS, CI/CD, design system | ✅ majoritairement livré (CI/CD reste) |
| **1 — MVP vendable** | 5 mois | Identity + CRM + Sales/POS + Inventory + Invoicing + Bictorys | 🚧 en cours — POS + Inventory + CRM ✅, Invoicing/Bictorys/Analytics à faire |
| **2 — Verticale logistique** | 3 mois | Delivery + HR-lite + Subscriptions | ⏸ |
| **3 — Verticale finance** | 4 mois | SYSCOHADA, Expenses, Procurement, Reporting avancé | ⏸ |
| **4 — Plateforme** | continu | API publique, marketplace modules, migration des 3 apps existantes | ⏸ |

## Licence

Propriétaire — Mata Group.
