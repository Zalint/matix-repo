/**
 * Seed catégories produits + auto-classification.
 *
 * Pour chaque tenant ayant au moins un produit :
 *   1. Crée la taxonomie standard (Bovin / Ovin / Caprin / Volaille / Poisson / Pack / Autres)
 *      si absente.
 *   2. Auto-assigne les catégories aux produits par pattern matching sur le nom.
 *
 * Idempotent : ré-exécutions sûres. Ne touche pas aux produits déjà catégorisés.
 *
 * Usage : pnpm tsx src/db/seed-product-categories.ts
 */
import { Pool } from 'pg';

type CategoryDef = { code: string; name: string; family: string; display_order: number };

const STANDARD_CATEGORIES: CategoryDef[] = [
  { code: 'bovin',    name: 'Bovin',    family: 'Boucherie', display_order: 10 },
  { code: 'ovin',     name: 'Ovin',     family: 'Boucherie', display_order: 20 },
  { code: 'caprin',   name: 'Caprin',   family: 'Boucherie', display_order: 30 },
  { code: 'volaille', name: 'Volaille', family: 'Boucherie', display_order: 40 },
  { code: 'poisson',  name: 'Poisson',  family: 'Boucherie', display_order: 50 },
  { code: 'pack',     name: 'Pack',     family: 'Boucherie', display_order: 60 },
  { code: 'autres',   name: 'Autres',   family: 'Autres',    display_order: 99 },
];

/**
 * Règles de classification par regex (insensible à la casse).
 * L'ordre compte : la première match gagne.
 */
const RULES: Array<{ code: string; pattern: RegExp }> = [
  // Bovin
  { code: 'bovin',    pattern: /(bœuf|boeuf|veau|sans\s*os|faux\s*filet|filet\s|jarret|abats|aloyaux|escalope|t[eê]te.*bœuf|t[eê]te.*boeuf|coeur|d[ée]chet|peaux|merguez|viande\s*hach[ée]e|t-bone|cul\s*de|emin[cs][ée]\s*de\s*b)/i },
  // Volaille
  { code: 'volaille', pattern: /(poulet|coq|dinde|canard|pintade|œuf|oeuf\b|aile|pilon|cuisse|blanc\s*de\s*poulet)/i },
  // Ovin
  { code: 'ovin',     pattern: /(mouton|agneau|t[eê]te\s*agneau|laxass|patte\s*de\s*mouton|foie\s*agneau|foie\s*de\s*mouton)/i },
  // Caprin
  { code: 'caprin',   pattern: /(ch[èe]vre|chevreau|caprin|cabri|bouc)/i },
  // Poisson
  { code: 'poisson',  pattern: /(poisson|thiof|capitaine|crevette|pageot|m[èe]rou|sole|silure|carpe|maquereau|sardine)/i },
  // Pack
  { code: 'pack',     pattern: /(pack|combo|menu|box)/i },
];

async function main() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'matix',
    user: process.env.POSTGRES_ADMIN_USER ?? 'matix_admin',
    password: process.env.POSTGRES_ADMIN_PASSWORD ?? 'matix_admin_dev',
  });

  const client = await pool.connect();
  try {
    // Tenants ayant au moins 1 produit
    const { rows: tenants } = await client.query<{ id: string; slug: string }>(
      `SELECT DISTINCT t.id, t.slug
         FROM tenants t
         JOIN products p ON p.tenant_id = t.id
        WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL
        ORDER BY t.slug`,
    );

    console.log(`→ ${tenants.length} tenants avec produits`);

    for (const tenant of tenants) {
      console.log(`\n=== ${tenant.slug} ===`);

      // 1. Insert categories (idempotent)
      let inserted = 0;
      for (const c of STANDARD_CATEGORIES) {
        const r = await client.query(
          `INSERT INTO product_categories (tenant_id, code, name, family, display_order)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, code) DO NOTHING`,
          [tenant.id, c.code, c.name, c.family, c.display_order],
        );
        if (r.rowCount && r.rowCount > 0) inserted++;
      }
      console.log(`  ✓ ${inserted} nouvelles catégories (${STANDARD_CATEGORIES.length - inserted} déjà présentes)`);

      // 2. Build category code → id map
      const { rows: cats } = await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM product_categories WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenant.id],
      );
      const catId = new Map(cats.map((c) => [c.code, c.id]));

      // 3. Classify products without category
      const { rows: uncats } = await client.query<{ id: string; sku: string; name: string }>(
        `SELECT id, sku, name FROM products
          WHERE tenant_id = $1 AND deleted_at IS NULL AND category_id IS NULL`,
        [tenant.id],
      );
      console.log(`  → ${uncats.length} produits sans catégorie`);

      let classified = 0;
      let autres = 0;
      for (const p of uncats) {
        let matched: string | null = null;
        for (const r of RULES) {
          if (r.pattern.test(p.name)) {
            matched = r.code;
            break;
          }
        }
        const code = matched ?? 'autres';
        if (code === 'autres') autres++;
        else classified++;

        const cid = catId.get(code);
        if (!cid) continue;
        await client.query(
          `UPDATE products SET category_id = $2 WHERE id = $1`,
          [p.id, cid],
        );
      }
      console.log(`  ✓ ${classified} classifiés + ${autres} → 'Autres'`);
    }

    console.log('\n✓ Seed catégories terminé.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
