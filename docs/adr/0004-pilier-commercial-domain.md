# ADR-0004 — Schéma de domaine du Pilier Commercial

- **Statut** : Proposed
- **Date** : 2026-05-08
- **Décideurs** : Saliou Doucouré, équipe Matix
- **Référence** : couvre les modules Sales/POS, Inventory (light), Invoicing/Payments

## Contexte

Le pilier Commercial est le cœur du MVP vendable Phase 1. Pour les commerces et restaurants Sénégal qu'on cible, c'est ce qui remplace **Excel + caissier papier** :
1. Enregistrer une **vente** au comptoir (POS).
2. Suivre le **stock** des produits.
3. Émettre une **facture** ou un ticket de caisse.
4. Encaisser via **espèces, mobile money (Wave/OM/MTN), CB**.
5. Faire la **clôture de caisse** quotidienne.
6. Voir les **rapports** ventes/jour, top produits, encaissements par mode.

Cette ADR pose le schéma de données minimal viable (les "rails") pour les 4 modules ; chaque module aura ses propres ADRs détaillées (Sales, Inventory, Invoicing, Reporting).

## Modules concernés

```
┌─────────────────────────────────────────────────────────┐
│  Pilier Commercial                                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐       │
│   │ Customers│────▶│  Sales   │◀───▶│Inventory │       │
│   │  (déjà)  │     │  (POS)   │     │          │       │
│   └──────────┘     └────┬─────┘     └──────────┘       │
│                         │                               │
│                         ▼                               │
│                    ┌──────────┐     ┌──────────┐       │
│                    │ Invoicing│────▶│ Payments │       │
│                    │ (factures│     │(Bictorys)│       │
│                    │ + tickets)    │           │       │
│                    └──────────┘     └──────────┘       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Décisions

### 1. Une vente (`sale`) est l'unité atomique

Une vente représente **une transaction commerciale** : elle a 1 ou N **lignes** (`sale_items`), 1 client (optionnel — ventes au comptoir anonymes), 1 point de vente, 1 caissier, 1 ou N **paiements** (un client peut payer 5000 en cash + 5000 en Wave).

```sql
sales
  id, tenant_id, point_of_sale_id, customer_id?,
  user_id (caissier), status (draft|posted|voided),
  subtotal, tax_total, total, paid_total, change_given,
  reference_number,  -- lisible : ACME-2026-001234
  posted_at, voided_at, voided_reason

sale_items
  id, tenant_id, sale_id, product_id, quantity, unit_price,
  discount_amount, tax_rate, tax_amount, line_total

sale_payments
  id, tenant_id, sale_id, method (cash|wave|orange_money|mtn_momo|card|credit),
  amount, reference (ex: tx_id Bictorys), received_at, received_by
```

**Status flow**:
- `draft` : panier en cours, pas encore validé. Pas de mouvement de stock.
- `posted` : vente finalisée. Stock décrémenté. Compte dans le rapport jour.
- `voided` : annulée après posted. Stock re-incrémenté. Trace conservée.

### 2. Inventory minimal — stock par point de vente

Pas (encore) de gestion fine multi-emplacements. Chaque produit a un stock par `point_of_sale`.

```sql
points_of_sale
  id, tenant_id, code, name, address, currency,
  is_active, created_at

stock_levels
  id, tenant_id, product_id, point_of_sale_id,
  quantity_on_hand, quantity_reserved,
  UNIQUE (tenant_id, product_id, point_of_sale_id)

stock_movements      -- journal append-only des mouvements
  id, tenant_id, product_id, point_of_sale_id,
  movement_type (sale|return|adjustment|transfer_in|transfer_out|opening|closing),
  quantity (signed: + entrée, - sortie),
  reference_table (ex: 'sales'), reference_id,
  reason, performed_by, performed_at
```

Tout mouvement de stock passe par une ligne `stock_movements` — vérité source. `stock_levels.quantity_on_hand` est un cache dénormalisé recalculable depuis le journal.

Cas Phase 1 supportés :
- Vente → décrément (mouvement type `sale`).
- Retour → incrément (`return`).
- Ajustement manuel (correction inventaire) → `adjustment`.
- Stock initial → `opening`.

Cas Phase 2+ :
- Transferts inter-PV.
- Stock vivant (animaux, denrées périssables — inspiré Dépenses Mgmt).
- Réservations / précommandes.

### 3. Invoicing distinct des ventes

Une **vente** est une transaction commerciale. Une **facture** est un document légal qui peut référencer une ou plusieurs ventes. Pour le POS Phase 1, chaque vente émet automatiquement un **ticket** (= facture simplifiée) ; les vraies factures B2B viennent en Phase 2.

```sql
invoices
  id, tenant_id, invoice_type (ticket|invoice|credit_note),
  number,                       -- séquence légale par type, par tenant
  customer_id?,
  sale_id?,                     -- lien vers sale si ticket POS
  status (draft|sent|paid|partial|overdue|voided),
  issue_date, due_date,
  subtotal, tax_total, total, amount_paid,
  currency, exchange_rate,      -- multi-devise prêt
  pdf_url?,                     -- généré on-demand puis caché
  created_at
```

### 4. Paiements & Bictorys

Tous les modes passent par la table `sale_payments` (POS) ou `invoice_payments` (factures différées). Pour Bictorys :
- Endpoint API qui crée un `payment_intent` côté Bictorys, retourne une URL de paiement.
- Le frontend redirige le client vers cette URL.
- Webhook Bictorys → endpoint Matix qui finalise le `sale_payment.status = succeeded` ou `failed`.
- Idempotency clé sur le `tx_id` Bictorys.

**Hors scope ADR-0004** : détails de l'intégration Bictorys (sera ADR-0005).

### 5. Numérotation des séquences

Chaque tenant a ses propres séquences (factures, tickets, références ventes). Une fois émise, **non réutilisable** — exigence comptable SYSCOHADA.

```sql
document_sequences
  tenant_id, sequence_type ('sale_ref'|'invoice'|'ticket'|'credit_note'),
  current_value bigint NOT NULL,
  prefix text,                -- 'ACME-2026-' généré dynamiquement
  PRIMARY KEY (tenant_id, sequence_type)
```

Allocation atomique via `UPDATE ... RETURNING` dans la même tx que l'INSERT du document.

### 6. RLS — pattern uniformisé

Toutes les tables ci-dessus respectent ADR-0001 §4 :
- `tenant_id UUID NOT NULL REFERENCES tenants(id)`
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
- Policy `tenant_isolation`
- `UNIQUE` toujours `(tenant_id, …)`
- Index commençant par `tenant_id`

### 7. Devises

`tenants.currency` = devise par défaut du tenant. Phase 1 : 1 seule devise active par tenant.
`invoices.currency` + `exchange_rate` : structure prête pour multi-devise Phase 2 (ex : restaurant qui facture en EUR à des touristes).

## Modules à livrer

| ID | Module | Migrations | Tests |
|---|---|---|---|
| `points-of-sale` | Référentiel des PV (1 PV "Principal" seedé par défaut) | `0004_points_of_sale.sql` | isolation |
| `inventory` | stock_levels + stock_movements + endpoints inventory | `0005_inventory.sql` | isolation + service tests |
| `sales` | sales + sale_items + sale_payments + flow draft→posted | `0006_sales.sql` | isolation + flow |
| `invoicing` | invoices + invoice_payments + génération PDF | `0007_invoicing.sql` | isolation |
| `payments` | abstraction provider + Bictorys impl | `0008_payments.sql` | mock provider |

Chacun aura sa propre ADR si nécessaire (`0005-bictorys.md`, etc.).

## Conséquences

**Positives**
- Pattern cohérent avec le pilier Plateforme (RLS, conventions, tests).
- Stock journal = audit trail immuable, conforme attentes comptables.
- Séparation ventes / factures = prête pour B2B Phase 2.

**Négatives / à surveiller**
- 6+ tables nouvelles → revue migration soigneuse.
- Performance : `stock_movements` peut grossir vite. Index `(tenant_id, product_id, performed_at)` dès le début ; partitionning si volume Phase 4.
- Précision NUMERIC(14,2) suffit jusqu'à 99 999 999 999,99 XOF (~99 milliards) — OK pour PME.

## Action items

1. Saliou : valide ou challenge.
2. Livrer `points-of-sale` + `inventory` (livrables atomiques) — la base.
3. Puis `sales` qui consomme les deux.
4. Puis `invoicing` + `payments` (Bictorys).
