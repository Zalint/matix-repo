/**
 * Seed mata-mbao depuis les données PROD du 02/04/2026.
 *
 * Source : 2 fichiers Excel extraits via extract-xlsx.py vers JSON.
 *  - Stock matin / soir / transferts (6 PV)
 *  - 75 lignes de ventes du PV O.Foire (64 commandes uniques)
 *
 * Cible : tenant `mata-mbao`. Date forcée à AUJOURD'HUI (pour tester en
 * conditions réelles l'enchaînement carry-over / vente / stock soir).
 *
 * Idempotent : nettoie d'abord les opening/sales du jour avant d'insérer.
 *
 * Mapping produit clé : le legacy a 2 SKU distincts "Boeuf en détail" et
 * "Boeuf en gros" pour les ventes, mais un seul "Boeuf" dans le stock. On
 * unifie selon le modèle Matix2.0 : un seul SKU `BOEUF` avec
 * gros_enabled=true et le rabais tenant (150 XOF) qui dérive le prix gros.
 * Idem Veau et Poulet.
 *
 * Lancer : `pnpm --filter @matix/api tsx src/db/seeds/mata-mbao-foire/seed.ts`
 */
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { resolve } from 'node:path';

// ============================================================================
// Config
// ============================================================================

const TENANT_SLUG = 'mata-mbao';
const DEFAULT_GROS_REBATE_XOF = 150;
const TODAY = new Date();
// Format YYYY-MM-DD pour la date logique du jour
const TODAY_ISO_DATE = TODAY.toISOString().slice(0, 10);

// On force minute 30 du matin pour les opening (juste après le cron carry-over)
function openingTimestamp(): string {
  return `${TODAY_ISO_DATE}T00:30:00.000Z`;
}
function transferTimestamp(): string {
  return `${TODAY_ISO_DATE}T08:00:00.000Z`;
}
function saleTimestamp(time: string): string {
  // time = "09:51"
  return `${TODAY_ISO_DATE}T${time}:00.000Z`;
}
function closingTimestamp(): string {
  return `${TODAY_ISO_DATE}T19:30:00.000Z`;
}

// ============================================================================
// Mapping PV : pour les tests, TOUS les PV legacy convergent vers le seul PV
// "Mbao" du tenant mata-mbao. Les volumes se cumulent naturellement (un Boeuf
// 30kg Mbao + 78kg O.Foire devient 108kg Mbao), les transferts internes au
// tenant se neutralisent (un transfer_out Abattage + un transfer_in Chambre
// froide cumulés sur Mbao s'annulent en net 0).
// ============================================================================
const TARGET_POS = { code: 'mbao', name: 'Mbao' };
const POS_MAP: Record<string, { code: string; name: string }> = {
  Mbao: TARGET_POS,
  'O.Foire': TARGET_POS,
  'Sacre Coeur': TARGET_POS,
  'Chambre froide': TARGET_POS,
  Abattage: TARGET_POS,
  'Keur Massar': TARGET_POS,
};

// ============================================================================
// Mapping produit : legacy nom Excel → SKU Matix + catégorie + tarif gros
//
// Les produits "X en détail" et "X en gros" pointent vers le MÊME SKU (X),
// avec un pricing_variant différent à la vente.
// ============================================================================
type ProductDef = {
  sku: string;
  name: string;
  category: 'Bovin' | 'Ovin' | 'Volaille' | 'Divers';
  unit_price: number;   // prix détails
  gros_enabled: boolean;
};

const PRODUCTS: ProductDef[] = [
  // Bovin
  { sku: 'BOEUF',         name: 'Boeuf',           category: 'Bovin',    unit_price: 4100, gros_enabled: true  },
  { sku: 'VEAU',          name: 'Veau',            category: 'Bovin',    unit_price: 4300, gros_enabled: true  },
  { sku: 'FOIE',          name: 'Foie',            category: 'Bovin',    unit_price: 4000, gros_enabled: false },
  { sku: 'YELL',          name: 'Yell',            category: 'Bovin',    unit_price: 3000, gros_enabled: false },
  { sku: 'JARRET',        name: 'Jarret',          category: 'Bovin',    unit_price: 253,  gros_enabled: false },
  // Ovin
  { sku: 'AGNEAU',        name: 'Agneau',          category: 'Ovin',     unit_price: 5300, gros_enabled: false },
  { sku: 'LAXASS',        name: 'Laxass',          category: 'Ovin',     unit_price: 200,  gros_enabled: false },
  { sku: 'FOIE-AGNEAU',   name: 'Foie agneau',     category: 'Ovin',     unit_price: 4000, gros_enabled: false },
  { sku: 'PATTE-MOUTON',  name: 'Patte de mouton', category: 'Ovin',     unit_price: 300,  gros_enabled: false },
  { sku: 'TETE-MOUTON',   name: 'Tete De Mouton',  category: 'Ovin',     unit_price: 1500, gros_enabled: false },
  // Volaille
  { sku: 'POULET',        name: 'Poulet',          category: 'Volaille', unit_price: 4000, gros_enabled: true  },
  // Divers
  { sku: 'DORADE',        name: 'Dorade',          category: 'Divers',   unit_price: 2500, gros_enabled: false },
  { sku: 'BEURRE',        name: 'Beurre',          category: 'Divers',   unit_price: 4000, gros_enabled: false },
  { sku: 'DECHET-400',    name: 'Déchet 400',      category: 'Divers',   unit_price: 400,  gros_enabled: false },
  { sku: 'DECHET-2000',   name: 'Déchet 2000',     category: 'Divers',   unit_price: 2000, gros_enabled: false },
];

/**
 * Mapping nom de produit Excel → { sku, pricing_variant? }.
 * "X en détail" et "X en gros" pointent vers le même SKU X avec variant différent.
 */
function resolveProduct(
  legacyName: string,
): { sku: string; pricing_variant: 'detail' | 'gros' | null } {
  const n = legacyName.trim();
  // Cas variantes
  const m = n.match(/^(.+?)\s+en\s+(détail|details|gros)$/i);
  if (m) {
    const baseName = m[1].trim();
    const variant = m[2].toLowerCase().startsWith('gros') ? 'gros' : 'detail';
    const def = PRODUCTS.find((p) => p.name.toLowerCase() === baseName.toLowerCase());
    if (!def) throw new Error(`Produit base "${baseName}" introuvable pour variante "${n}"`);
    return { sku: def.sku, pricing_variant: variant };
  }
  // Cas simple
  const def = PRODUCTS.find((p) => p.name.toLowerCase() === n.toLowerCase());
  if (!def) throw new Error(`Produit "${n}" introuvable dans le mapping`);
  return { sku: def.sku, pricing_variant: null };
}

// ============================================================================
// Types JSON
// ============================================================================
type StockRow = {
  pos: string;
  product: string;
  quantity: number | null;
  unit_price: number | null;
};
type TransferRow = StockRow & { impact: '+' | '-' };
type SaleRow = {
  time: string;
  category: string;
  product: string;
  unit_price: number;
  quantity: number;
  amount: number;
  order_id: string;
  pos: string;
  sale_type: string;
};

// ============================================================================
// Helpers DB
// ============================================================================

async function getOrCreateCategory(
  client: Pool,
  tenantId: string,
  code: string,
  name: string,
  family: string,
): Promise<string> {
  const upsert = await client.query<{ id: string }>(
    `INSERT INTO product_categories (tenant_id, code, name, family)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, code) DO UPDATE
       SET name = EXCLUDED.name, family = EXCLUDED.family, updated_at = NOW()
     RETURNING id`,
    [tenantId, code, name, family],
  );
  return upsert.rows[0].id;
}

async function getOrCreatePos(
  client: Pool,
  tenantId: string,
  code: string,
  name: string,
): Promise<string> {
  // Avant tout, on cherche un PV existant par NAME (case-insensitive + trim) pour
  // éviter de créer un doublon visuel : si un PV "Mbao" existe déjà sous un autre
  // code (ex: 'pv-1' historique du provisioning), on le réutilise.
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM points_of_sale
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND lower(trim(name)) = lower(trim($2))
      LIMIT 1`,
    [tenantId, name],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  // Sinon, INSERT avec ON CONFLICT sur le code (autre constraint d'unicité)
  const r = await client.query<{ id: string }>(
    `INSERT INTO points_of_sale (tenant_id, code, name, is_active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (tenant_id, code) DO UPDATE
       SET name = EXCLUDED.name, is_active = TRUE, updated_at = NOW()
     RETURNING id`,
    [tenantId, code, name],
  );
  return r.rows[0].id;
}

async function upsertProduct(
  client: Pool,
  tenantId: string,
  def: ProductDef,
  categoryId: string,
): Promise<string> {
  // UNIQUE constraint = (tenant_id, sku) sans filtre partiel — pas de WHERE dans ON CONFLICT
  const r = await client.query<{ id: string }>(
    `INSERT INTO products
       (tenant_id, sku, name, unit_price, gros_enabled, category_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, sku) DO UPDATE
       SET name = EXCLUDED.name,
           unit_price = EXCLUDED.unit_price,
           gros_enabled = EXCLUDED.gros_enabled,
           category_id = EXCLUDED.category_id,
           deleted_at = NULL,
           updated_at = NOW()
     RETURNING id`,
    [tenantId, def.sku, def.name, def.unit_price, def.gros_enabled, categoryId],
  );
  return r.rows[0].id;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Lis les JSON extraits par Python
  const here = resolve(__dirname);
  const stockMatin = JSON.parse(readFileSync(`${here}/stock-matin.json`, 'utf-8')) as StockRow[];
  const stockSoir = JSON.parse(readFileSync(`${here}/stock-soir.json`, 'utf-8')) as StockRow[];
  const transferts = JSON.parse(readFileSync(`${here}/transferts.json`, 'utf-8')) as TransferRow[];
  const ventes = JSON.parse(readFileSync(`${here}/ventes-ofoire.json`, 'utf-8')) as SaleRow[];

  console.log(`📥 Données chargées :`);
  console.log(`   stock matin : ${stockMatin.length}`);
  console.log(`   stock soir  : ${stockSoir.length}`);
  console.log(`   transferts  : ${transferts.length}`);
  console.log(`   ventes      : ${ventes.length}`);
  console.log(`📅 Date logique cible : ${TODAY_ISO_DATE}`);

  // Pool admin (BYPASSRLS) — on filtre manuellement par tenant_id
  const adminPool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'matix',
    user: process.env.POSTGRES_ADMIN_USER ?? 'matix_admin',
    password: process.env.POSTGRES_ADMIN_PASSWORD ?? 'matix_admin_dev',
  });

  try {
    // 1) Tenant ID
    const { rows: tenantRows } = await adminPool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL`,
      [TENANT_SLUG],
    );
    if (tenantRows.length === 0) throw new Error(`Tenant ${TENANT_SLUG} introuvable`);
    const tenantId = tenantRows[0].id;
    console.log(`✅ Tenant ${TENANT_SLUG} (${tenantId})`);

    // Récupère un user_id valide du tenant (sales.user_id NOT NULL)
    const { rows: userRows } = await adminPool.query<{ user_id: string }>(
      `SELECT user_id FROM tenant_members WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    );
    if (userRows.length === 0) throw new Error(`Aucun user membre du tenant ${TENANT_SLUG}`);
    const seedUserId = userRows[0].user_id;
    console.log(`✅ User caissier (seed) : ${seedUserId}`);

    // 2) Setting tenant : rabais gros
    await adminPool.query(
      `UPDATE tenants SET default_gros_rebate_xof = $2, updated_at = NOW() WHERE id = $1`,
      [tenantId, DEFAULT_GROS_REBATE_XOF],
    );
    console.log(`✅ default_gros_rebate_xof = ${DEFAULT_GROS_REBATE_XOF} XOF`);

    // 3) Licences nécessaires (idempotent)
    for (const code of [
      'commercial.sales.pos',
      'operations.inventory.movements',
      'commercial.sales.reconciliation',
    ]) {
      await adminPool.query(
        `INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)
         VALUES ($1, $2, TRUE, 'manual')
         ON CONFLICT (tenant_id, module_code) DO UPDATE SET enabled = TRUE`,
        [tenantId, code],
      );
    }
    console.log(`✅ Licences activées`);

    // 4) Catégories
    const catBovin = await getOrCreateCategory(adminPool, tenantId, 'bovin', 'Bovin', 'Boucherie');
    const catOvin = await getOrCreateCategory(adminPool, tenantId, 'ovin', 'Ovin', 'Boucherie');
    const catVolaille = await getOrCreateCategory(adminPool, tenantId, 'volaille', 'Volaille', 'Volaille');
    const catDivers = await getOrCreateCategory(adminPool, tenantId, 'divers', 'Divers', 'Divers');
    console.log(`✅ Catégories Bovin/Ovin/Volaille/Divers`);

    // 5) PV cible (un seul) — tous les PV legacy convergent dessus
    const mbaoPosId = await getOrCreatePos(adminPool, tenantId, TARGET_POS.code, TARGET_POS.name);
    const posIdsByName: Record<string, string> = {};
    for (const legacy of Object.keys(POS_MAP)) {
      posIdsByName[legacy] = mbaoPosId;
    }
    console.log(`✅ PV cible : ${TARGET_POS.name} (${mbaoPosId}) — ${Object.keys(POS_MAP).length} PV legacy redirigés dessus`);

    // 6) Produits
    const productIdBySku: Record<string, string> = {};
    for (const def of PRODUCTS) {
      const categoryId =
        def.category === 'Bovin' ? catBovin :
        def.category === 'Ovin' ? catOvin :
        def.category === 'Volaille' ? catVolaille :
        catDivers;
      productIdBySku[def.sku] = await upsertProduct(adminPool, tenantId, def, categoryId);
    }
    console.log(`✅ ${PRODUCTS.length} produits`);

    // 7) Cleanup données du jour pour idempotence
    console.log(`🧹 Cleanup du ${TODAY_ISO_DATE}…`);
    await adminPool.query(
      `DELETE FROM sale_payments WHERE sale_id IN (
         SELECT id FROM sales WHERE tenant_id = $1
           AND DATE(posted_at AT TIME ZONE 'UTC') = $2::date
       )`,
      [tenantId, TODAY_ISO_DATE],
    );
    await adminPool.query(
      `DELETE FROM sale_items WHERE sale_id IN (
         SELECT id FROM sales WHERE tenant_id = $1
           AND DATE(COALESCE(posted_at, created_at) AT TIME ZONE 'UTC') = $2::date
       )`,
      [tenantId, TODAY_ISO_DATE],
    );
    await adminPool.query(
      `DELETE FROM sales WHERE tenant_id = $1
         AND DATE(COALESCE(posted_at, created_at) AT TIME ZONE 'UTC') = $2::date`,
      [tenantId, TODAY_ISO_DATE],
    );
    await adminPool.query(
      `DELETE FROM stock_movements WHERE tenant_id = $1
         AND DATE(performed_at AT TIME ZONE 'UTC') = $2::date
         AND reason LIKE 'SEED-FOIRE%'`,
      [tenantId, TODAY_ISO_DATE],
    );
    await adminPool.query(
      `DELETE FROM stock_daily_closings WHERE tenant_id = $1
         AND closing_date = $2::date`,
      [tenantId, TODAY_ISO_DATE],
    );
    // Reset stock_levels pour les produits seed
    await adminPool.query(
      `DELETE FROM stock_levels WHERE tenant_id = $1
         AND product_id = ANY($2::uuid[])`,
      [tenantId, Object.values(productIdBySku)],
    );
    console.log(`✅ Cleanup OK`);

    // 8) Stock matin → opening
    let openingCount = 0;
    for (const row of stockMatin) {
      if (!row.pos || !row.product || !row.quantity || row.quantity <= 0) continue;
      const posInfo = POS_MAP[row.pos];
      if (!posInfo) { console.warn(`⚠ PV inconnu : ${row.pos} (matin)`); continue; }
      const posId = posIdsByName[row.pos];
      const resolved = resolveProduct(row.product);
      const productId = productIdBySku[resolved.sku];
      if (!productId) { console.warn(`⚠ Produit inconnu : ${row.product}`); continue; }
      await adminPool.query(
        `INSERT INTO stock_movements
           (tenant_id, product_id, point_of_sale_id, movement_type, quantity,
            unit_cost, reason, performed_at)
         VALUES ($1, $2, $3, 'opening', $4, $5, 'SEED-FOIRE-MATIN', $6)`,
        [tenantId, productId, posId, row.quantity, row.unit_price, openingTimestamp()],
      );
      openingCount++;
    }
    console.log(`✅ Stock matin : ${openingCount} mouvements opening`);

    // 9) Transferts → transfer_in / transfer_out
    // Le legacy stocke un mouvement par direction (signe via colonne `impact`).
    // On reproduit tel quel : un INSERT par ligne.
    let transferCount = 0;
    for (const row of transferts) {
      if (!row.pos || !row.product || !row.quantity || !row.impact) continue;
      const posId = posIdsByName[row.pos];
      if (!posId) { console.warn(`⚠ PV inconnu : ${row.pos} (transfert)`); continue; }
      const resolved = resolveProduct(row.product);
      const productId = productIdBySku[resolved.sku];
      if (!productId) { console.warn(`⚠ Produit inconnu : ${row.product}`); continue; }
      const isIn = row.impact === '+';
      const movementType = isIn ? 'transfer_in' : 'transfer_out';
      const quantity = isIn ? row.quantity : -row.quantity;
      await adminPool.query(
        `INSERT INTO stock_movements
           (tenant_id, product_id, point_of_sale_id, movement_type, quantity,
            unit_cost, reason, performed_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'SEED-FOIRE-TRANSFER', $7)`,
        [tenantId, productId, posId, movementType, quantity, row.unit_price, transferTimestamp()],
      );
      transferCount++;
    }
    console.log(`✅ Transferts : ${transferCount} mouvements`);

    // 10) Ventes O.Foire : 75 lignes → grouper par Commande ID → N sales avec
    //     leurs sale_items + 1 payment cash de la somme totale
    const groupedByOrder = new Map<string, SaleRow[]>();
    for (const v of ventes) {
      const list = groupedByOrder.get(v.order_id) ?? [];
      list.push(v);
      groupedByOrder.set(v.order_id, list);
    }

    const ofPosId = posIdsByName['O.Foire'];
    let salesCount = 0;
    let itemsCount = 0;
    for (const [orderId, lines] of Array.from(groupedByOrder.entries())) {
      const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
      const firstTime = lines[0].time; // "HH:MM"
      const postedAt = saleTimestamp(firstTime);

      // INSERT sale (status=posted directement, paid)
      // Pas de séquence document : on utilise un reference_number lisible "SEED-OFO-001"
      // pour éviter les conflits avec les vraies ventes.
      const refNum = `SEED-OFO-${String(salesCount + 1).padStart(3, '0')}`;
      const { rows: saleRows } = await adminPool.query<{ id: string }>(
        `INSERT INTO sales
           (tenant_id, point_of_sale_id, user_id, status, subtotal, tax_total, total,
            paid_total, change_given, reference_number, notes,
            posted_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'posted', $4, 0, $4, $4, 0, $5, $6, $7, $7, $7)
         RETURNING id`,
        [
          tenantId, ofPosId, seedUserId, totalAmount, refNum,
          `Seed PROD legacy order ${orderId}`,
          postedAt,
        ],
      );
      const saleId = saleRows[0].id;

      // INSERT sale_items + stock_movements 'sale' associés
      for (const ln of lines) {
        const resolved = resolveProduct(ln.product);
        const productId = productIdBySku[resolved.sku];
        if (!productId) { console.warn(`⚠ Produit inconnu vente : ${ln.product}`); continue; }
        await adminPool.query(
          `INSERT INTO sale_items
             (tenant_id, sale_id, product_id, quantity, unit_price,
              discount_amount, tax_rate, tax_amount, line_total, pricing_variant)
           VALUES ($1, $2, $3, $4, $5, 0, 0, 0, $6, $7)`,
          [
            tenantId, saleId, productId, ln.quantity, ln.unit_price.toFixed(2),
            ln.amount.toFixed(2), resolved.pricing_variant,
          ],
        );
        // Décrémente le stock (sale movement)
        await adminPool.query(
          `INSERT INTO stock_movements
             (tenant_id, product_id, point_of_sale_id, movement_type, quantity,
              reference_table, reference_id, reason, performed_at)
           VALUES ($1, $2, $3, 'sale', $4, 'sales', $5, 'SEED-FOIRE-VENTE', $6)`,
          [tenantId, productId, ofPosId, -ln.quantity, saleId, postedAt],
        );
        itemsCount++;
      }

      // INSERT 1 payment cash de la somme
      await adminPool.query(
        `INSERT INTO sale_payments
           (tenant_id, sale_id, method, amount, status, received_at)
         VALUES ($1, $2, 'cash', $3, 'succeeded', $4)`,
        [tenantId, saleId, totalAmount, postedAt],
      );
      salesCount++;
    }
    console.log(`✅ Ventes : ${salesCount} commandes / ${itemsCount} lignes`);

    // 11) Stock soir → stock_daily_closings (source='manual')
    // Note : comme tous les PV legacy convergent sur Mbao, plusieurs lignes
    // Stock Soir avec le même produit (ex: Boeuf à Mbao + Boeuf à O.Foire)
    // arrivent ici sur le même (date, pos, product). On les CUMULE via
    // ON CONFLICT DO UPDATE en additionnant les quantités saisies.
    const closingCumulated = new Map<string, number>();
    for (const row of stockSoir) {
      if (!row.pos || !row.product || row.quantity === null) continue;
      const resolved = resolveProduct(row.product);
      const productId = productIdBySku[resolved.sku];
      if (!productId) { console.warn(`⚠ Produit inconnu : ${row.product} (soir)`); continue; }
      const key = `${mbaoPosId}:${productId}`;
      closingCumulated.set(key, (closingCumulated.get(key) ?? 0) + (row.quantity ?? 0));
    }
    let closingCount = 0;
    for (const [key, totalQty] of Array.from(closingCumulated.entries())) {
      const [posId, productId] = key.split(':');
      // Recompute le théorique : SUM(stock_movements) du jour pour ce produit/pos.
      const theoriqueRow = await adminPool.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(quantity), 0)::text AS total
           FROM stock_movements
          WHERE tenant_id = $1 AND product_id = $2 AND point_of_sale_id = $3
            AND DATE(performed_at AT TIME ZONE 'UTC') = $4::date`,
        [tenantId, productId, posId, TODAY_ISO_DATE],
      );
      const theorique = Number(theoriqueRow.rows[0]?.total ?? 0);
      await adminPool.query(
        `INSERT INTO stock_daily_closings
           (tenant_id, closing_date, point_of_sale_id, product_id,
            quantity, quantity_theorique, source, set_at, last_auto_at)
         VALUES ($1, $2::date, $3, $4, $5, $6, 'manual', $7, $7)
         ON CONFLICT (tenant_id, closing_date, point_of_sale_id, product_id) DO UPDATE
           SET quantity = EXCLUDED.quantity,
               quantity_theorique = EXCLUDED.quantity_theorique,
               source = 'manual',
               set_at = EXCLUDED.set_at`,
        [tenantId, TODAY_ISO_DATE, posId, productId, totalQty, theorique, closingTimestamp()],
      );
      closingCount++;
    }
    console.log(`✅ Stock soir : ${closingCount} closings (${stockSoir.length} lignes legacy cumulées)`);

    console.log(`\n🎉 Seed terminé sur ${TENANT_SLUG} pour ${TODAY_ISO_DATE}.`);
    console.log(`   Total ventes O.Foire : ${ventes.reduce((s, v) => s + v.amount, 0).toLocaleString('fr-FR')} XOF`);
  } finally {
    await adminPool.end();
  }
}

main().catch((e) => {
  console.error('❌ Erreur seed :', e);
  process.exit(1);
});
