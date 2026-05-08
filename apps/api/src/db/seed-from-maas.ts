/**
 * Seed Matix depuis la base legacy `maas_db` (Maas App).
 *
 * Mappe les schémas tenants Maas (mbao, keur_massar) → tenants Matix.
 * Pour chaque tenant Maas, copie :
 *   - points_vente   → matix.points_of_sale
 *   - produits       → matix.products
 *   - clients_abonnes→ matix.customers
 *   - stocks (matin) → matix.stock_movements (type 'opening')
 *
 * Idempotent : ON CONFLICT (tenant_id, code) DO NOTHING.
 *
 * Usage :
 *   pnpm --filter @matix/api db:seed:maas
 *
 * Les ventes ne sont PAS importées (leur format Maas est trop dénormalisé
 * pour reconstruire des sale_items propres en Phase 1).
 */
import { Pool } from 'pg';

type MaasTenant = { schema: string; slug: string; legal_name: string };

const MAAS_TENANTS: MaasTenant[] = [
  { schema: 'mbao', slug: 'mata-mbao', legal_name: 'Mata Mbao' },
  { schema: 'keur_massar', slug: 'mata-keur-massar', legal_name: 'Mata Keur Massar' },
];

async function main() {
  const maasUrl = {
    host: process.env.MAAS_HOST ?? 'localhost',
    port: Number(process.env.MAAS_PORT ?? 5432),
    database: process.env.MAAS_DB ?? 'maas_db',
    user: process.env.MAAS_USER ?? 'postgres',
    password: process.env.MAAS_PASSWORD ?? process.env.PGPASSWORD ?? '',
  };
  const matixUrl = {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'matix',
    user: process.env.POSTGRES_ADMIN_USER ?? 'matix_admin',
    password: process.env.POSTGRES_ADMIN_PASSWORD ?? 'matix_admin_dev',
  };

  if (!maasUrl.password) {
    console.error('Set MAAS_PASSWORD (or PGPASSWORD) to access maas_db.');
    process.exit(1);
  }

  const maas = new Pool(maasUrl);
  const matix = new Pool(matixUrl);

  // Réutilise les UUIDs de seed existants pour mata-mbao = acme, mata-keur-massar = beta ?
  // Non — on crée DE NOUVEAUX tenants distincts pour ne pas polluer les tests qui utilisent ACME/BETA.
  for (const t of MAAS_TENANTS) {
    console.log(`\n=== Tenant ${t.slug} (schéma maas: ${t.schema}) ===`);

    // 1. Crée le tenant si absent
    const tenantRow = await matix.query<{ id: string }>(
      `INSERT INTO tenants (slug, legal_name, status, country_code, currency, locale)
       VALUES ($1, $2, 'active', 'SN', 'XOF', 'fr')
       ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [t.slug, t.legal_name],
    );
    const tenantId = tenantRow.rows[0].id;
    console.log(`  tenant_id = ${tenantId}`);

    // 2. Points de vente
    const pvs = await maas.query<{ id: number; nom: string; active: boolean }>(
      `SELECT id, nom, active FROM ${t.schema}.points_vente`,
    );
    console.log(`  → ${pvs.rows.length} points de vente`);
    for (const pv of pvs.rows) {
      const code = `pv-${pv.id}`;
      await matix.query(
        `INSERT INTO points_of_sale (tenant_id, code, name, is_active)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active`,
        [tenantId, code, pv.nom, pv.active ?? true],
      );
    }

    // 3. Produits
    const prods = await maas.query<{
      id: number;
      nom: string;
      prix_defaut: string | null;
      categorie_affichage: string | null;
    }>(
      `SELECT id, nom, prix_defaut, categorie_affichage FROM ${t.schema}.produits ORDER BY id`,
    );
    console.log(`  → ${prods.rows.length} produits`);
    let inserted = 0;
    for (const p of prods.rows) {
      const sku = `MAAS-${p.id}`;
      const price = p.prix_defaut ? Number(p.prix_defaut) : 0;
      const result = await matix.query(
        `INSERT INTO products (tenant_id, sku, name, unit_price)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name, unit_price = EXCLUDED.unit_price
         RETURNING id`,
        [tenantId, sku, (p.nom ?? 'Sans nom').slice(0, 200), price],
      );
      if (result.rowCount) inserted++;
    }
    console.log(`     ${inserted} insérés/maj`);

    // 4. Clients abonnés
    const clients = await maas.query<{
      id: number;
      abonne_id: string | null;
      prenom: string | null;
      nom: string | null;
      telephone: string | null;
      adresse: string | null;
    }>(`SELECT id, abonne_id, prenom, nom, telephone, adresse FROM ${t.schema}.clients_abonnes`);
    console.log(`  → ${clients.rows.length} clients`);
    for (const c of clients.rows) {
      const code = c.abonne_id || `CUST-${c.id}`;
      const displayName = [c.prenom, c.nom].filter(Boolean).join(' ').trim() || `Client ${c.id}`;
      const phone = c.telephone?.replace(/\s+/g, '').slice(0, 20) ?? null;
      await matix.query(
        `INSERT INTO customers (tenant_id, code, display_name, phone, address)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, code) DO UPDATE SET display_name = EXCLUDED.display_name, phone = EXCLUDED.phone`,
        [tenantId, code.slice(0, 50), displayName.slice(0, 200), phone, c.adresse?.slice(0, 500) ?? null],
      );
    }

    // 5. Stock initial : on prend le stock 'matin' le plus récent par (point_vente, produit)
    //    et on le pose comme 'opening' movement.
    //    On a besoin de matcher par nom (Maas est dénormalisé) — on se limite aux paires
    //    où le nom produit ET le nom point de vente matchent ce qu'on a inséré.
    const stocks = await maas.query<{
      point_vente: string;
      produit: string;
      quantite: number;
      prix_unitaire: number | null;
      date: string;
    }>(
      `SELECT DISTINCT ON (point_vente, produit) point_vente, produit, quantite, prix_unitaire, date
       FROM ${t.schema}.stocks
       WHERE type_stock = 'matin' AND quantite > 0
       ORDER BY point_vente, produit, date DESC`,
    );
    console.log(`  → ${stocks.rows.length} stocks 'matin' à importer (les + récents)`);

    let stockImported = 0;
    let stockSkipped = 0;
    for (const s of stocks.rows) {
      // Trouver le point_of_sale par nom EXACT
      const posRow = await matix.query<{ id: string }>(
        `SELECT id FROM points_of_sale WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
        [tenantId, s.point_vente],
      );
      // Trouver le produit par nom EXACT
      const prodRow = await matix.query<{ id: string }>(
        `SELECT id FROM products WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
        [tenantId, s.produit],
      );
      if (!posRow.rowCount || !prodRow.rowCount) {
        stockSkipped++;
        continue;
      }
      // Idempotent : ne pas re-créer un opening si déjà fait pour cette paire
      const exists = await matix.query<{ id: string }>(
        `SELECT id FROM stock_movements
         WHERE tenant_id = $1 AND product_id = $2 AND point_of_sale_id = $3
           AND movement_type = 'opening' AND reason LIKE 'maas-import:%'
         LIMIT 1`,
        [tenantId, prodRow.rows[0].id, posRow.rows[0].id],
      );
      if (exists.rowCount) {
        stockSkipped++;
        continue;
      }
      await matix.query(
        `INSERT INTO stock_movements
           (tenant_id, product_id, point_of_sale_id, movement_type, quantity, unit_cost, reason, performed_at)
         VALUES ($1, $2, $3, 'opening', $4, $5, $6, $7)`,
        [
          tenantId,
          prodRow.rows[0].id,
          posRow.rows[0].id,
          s.quantite,
          s.prix_unitaire,
          `maas-import:${t.schema}:${s.date}`,
          new Date(s.date),
        ],
      );
      stockImported++;
    }
    console.log(`     ${stockImported} stocks importés, ${stockSkipped} sautés (pas de match nom ou déjà existants)`);
  }

  // Counts finaux
  console.log('\n=== Résumé Matix ===');
  for (const t of MAAS_TENANTS) {
    const tid = (await matix.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [t.slug])).rows[0].id;
    const products = (await matix.query<{ c: string }>(`SELECT COUNT(*)::text c FROM products WHERE tenant_id = $1 AND deleted_at IS NULL`, [tid])).rows[0].c;
    const customers = (await matix.query<{ c: string }>(`SELECT COUNT(*)::text c FROM customers WHERE tenant_id = $1 AND deleted_at IS NULL`, [tid])).rows[0].c;
    const pos = (await matix.query<{ c: string }>(`SELECT COUNT(*)::text c FROM points_of_sale WHERE tenant_id = $1 AND deleted_at IS NULL`, [tid])).rows[0].c;
    const stockLevels = (await matix.query<{ c: string }>(`SELECT COUNT(*)::text c FROM stock_levels WHERE tenant_id = $1`, [tid])).rows[0].c;
    console.log(`  ${t.slug}: ${products} produits, ${customers} clients, ${pos} PV, ${stockLevels} stocks`);
  }

  await maas.end();
  await matix.end();
  console.log('\n✓ Seed terminé.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
