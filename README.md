# Matix

Suite SaaS B2B modulaire multi-tenant — inspirée Odoo, ciblée PME africaines (Sénégal Phase 1).

> Statut : **Phase 0 — Fondations**. POC multi-tenant RLS en cours.

## Vision

Matix unifie en une seule plateforme modulaire les fonctionnalités aujourd'hui éclatées entre les apps Mata existantes :
- **Maas App** — Ventes, Stock, Réconciliation, Achats
- **Matix Livreur (MLC)** — CRM, Livraison, GPS, Pointages
- **Dépenses Management** — Comptabilité, Créances, Snapshots

12 modules cibles (4 piliers) :
- **Plateforme** — Identity/Tenancy, Reporting/Snapshots, Notifications
- **Commercial** — CRM, Sales/POS, Subscriptions
- **Opérations** — Inventory, Procurement, Delivery/Field Ops, HR-lite
- **Finance** — Accounting (SYSCOHADA double-entry), Expenses/Invoicing/Payments

## Stack

| Couche | Choix | Raison |
|---|---|---|
| Backend | **NestJS** (TypeScript) | Modules natifs = bounded contexts |
| ORM | **Drizzle** | Raw-SQL-friendly, parfait pour RLS sans surprise |
| DB | **PostgreSQL 16 + RLS** | Multi-tenancy aux milliers de tenants |
| SSO | **Keycloak** (self-hosted) | OIDC/SAML B2B, gratuit |
| Frontend | **Next.js 15** (App Router) + Tailwind + shadcn/ui | PWA-ready |
| Mobile | PWA → Capacitor plus tard | 1 codebase |
| Cache/Queue | Redis + BullMQ | Standard |
| Paiements | **Bictorys** (Wave / OM / MTN MoMo) | Intégration unique multi-opérateurs |
| Files | Cloudflare R2 | Pas d'egress fees |
| Hébergement Phase 1 | Hetzner + Coolify | Budget $1000/mo cible respecté |
| Mono-repo | pnpm workspaces + Turborepo | Standard |

**Décisions explicites** : monolithe modulaire (pas microservices), Postgres RLS (pas schema-per-tenant ni DB-per-tenant), SYSCOHADA double-entry strict, **pas d'offline-first** Phase 1.

Voir `docs/adr/` pour le détail.

## Structure

```
Matix2.0/
├── apps/
│   ├── api/            # Backend NestJS (monolithe modulaire)
│   └── web/            # Frontend Next.js (PWA) — placeholder Phase 0
├── packages/
│   └── shared/         # Types partagés API ↔ Web
├── db/
│   ├── migrations/     # Migrations SQL versionnées
│   └── seed.sql        # Données de dev
├── docs/
│   └── adr/            # Architecture Decision Records
├── scripts/            # Outils ops (provisioning tenant, etc.)
└── docker-compose.yml  # Postgres + Redis + Keycloak pour dev
```

## Démarrer en local

Pré-requis : Node 20+, pnpm 9+, Docker Desktop.

```bash
pnpm install

# Démarre Postgres + Redis + Keycloak + MailHog
docker compose up -d

# Applique les migrations + seed dev (2 tenants de test)
pnpm db:migrate
pnpm db:seed

# Lance l'API en dev
pnpm --filter @matix/api dev
# → http://localhost:3001

# Test anti-fuite multi-tenant (CRITIQUE)
pnpm --filter @matix/api test:e2e
```

## ADRs publiés

- [0001 — Multi-tenancy avec Postgres RLS](docs/adr/0001-multi-tenancy-rls.md)

## Roadmap

| Phase | Durée | Livrable |
|---|---|---|
| **0 — Fondations** | 2 mois | Auth/SSO, multi-tenant RLS, CI/CD, design system |
| **1 — MVP vendable** | 5 mois | Identity + CRM + Sales/POS + Inventory + Invoicing + Bictorys |
| **2 — Verticale logistique** | 3 mois | Delivery + HR-lite + Subscriptions |
| **3 — Verticale finance** | 4 mois | SYSCOHADA, Expenses, Procurement, Reporting avancé |
| **4 — Plateforme** | continu | API publique, marketplace modules, migration des 3 apps existantes |

## Licence

Propriétaire — Mata Group.
