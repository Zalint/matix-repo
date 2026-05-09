/**
 * Seed les n8n_definition des workflow_templates depuis infra/n8n-workflows/templates-strategy-c/*.json
 *
 * Le mapping fichier → template code est dans le champ meta.matix_template_code du JSON.
 *
 * Usage : pnpm --filter @matix/api db:seed:workflow-templates
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

const TEMPLATES_DIR = resolve(__dirname, '../../../../infra/n8n-workflows/templates-strategy-c');

type N8nTemplate = {
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  meta?: {
    matix_template_code?: string;
    matix_phase?: string;
    matix_pattern?: string;
  };
};

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
    const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      console.log(`Aucun template trouvé dans ${TEMPLATES_DIR}`);
      return;
    }

    let updated = 0;
    let skipped = 0;
    let missing = 0;

    for (const file of files) {
      const path = join(TEMPLATES_DIR, file);
      const raw = readFileSync(path, 'utf8');
      const def = JSON.parse(raw) as N8nTemplate;

      const code = def.meta?.matix_template_code;
      if (!code) {
        console.log(`✗ ${file} : pas de meta.matix_template_code, skip`);
        skipped++;
        continue;
      }

      // Check si le template existe en DB (sinon le seed migration 0011 doit avoir été appliqué)
      const { rows } = await client.query<{ id: string; has_def: boolean }>(
        `SELECT id, (n8n_definition IS NOT NULL) AS has_def
           FROM workflow_templates
          WHERE code = $1`,
        [code],
      );

      if (rows.length === 0) {
        console.log(`✗ ${file} : template "${code}" n'existe pas en DB (migration 0011 manquante ?)`);
        missing++;
        continue;
      }

      // Strip meta avant de stocker (info Matix, pas n8n)
      const { meta: _meta, ...n8nOnly } = def;

      await client.query(
        `UPDATE workflow_templates
            SET n8n_definition = $1::jsonb,
                updated_at = NOW()
          WHERE code = $2`,
        [JSON.stringify(n8nOnly), code],
      );

      const action = rows[0].has_def ? 'mis à jour' : 'seedé';
      console.log(`✓ ${file} → workflow_templates[${code}] ${action}`);
      updated++;
    }

    console.log(`\nRésumé : ${updated} updated, ${skipped} skipped, ${missing} missing`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
