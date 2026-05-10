import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';

import { AppModule } from '../../../app.module';
import { ADMIN_PG_POOL } from '../../../common/database.module';

const TENANT_A = 'a1111111-1111-4111-8111-111111111111';
const USER_A = 'a1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * Tests d'integration pour DailyClosingService :
 *   - Vue quotidienne calcule le theorique correctement
 *   - setManual force source='manual' et persiste le theorique
 *   - recomputeAuto cree des entrees 'auto' pour les produits 'automatique'
 *   - recomputeAuto ne touche PAS les entrees 'manual' deja saisies
 *   - runNightlyCarryOver cree un opening J+1 idempotent
 */
describe('DailyClosingService (e2e)', () => {
  let app: INestApplication;
  let adminPool: Pool;

  let posId: string;
  let prodAuto: string;     // mode 'automatique'
  let prodManuel: string;   // mode 'manuel'

  // Date fixee pour eviter les variations entre runs
  const D = '2026-04-01';
  const D_NEXT = '2026-04-02';

  beforeAll(async () => {
    process.env.AUTH_MODE = 'dev';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    adminPool = app.get(ADMIN_PG_POOL);

    // S'assurer que tenant A a bien les modules necessaires (idempotent)
    for (const code of ['operations.inventory.movements', 'commercial.sales.reconciliation']) {
      await adminPool.query(
        `INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)
         VALUES ($1, $2, TRUE, 'manual')
         ON CONFLICT (tenant_id, module_code) DO UPDATE SET enabled = TRUE`,
        [TENANT_A, code],
      );
    }

    // Cleanup
    await adminPool.query(`DELETE FROM stock_daily_closings WHERE closing_date IN ($1, $2)`, [D, D_NEXT]);
    await adminPool.query(`DELETE FROM reconciliation_notes WHERE note_date IN ($1, $2)`, [D, D_NEXT]);
    await adminPool.query(
      `DELETE FROM stock_movements WHERE reason LIKE 'DCLOS-%' OR reference_table = 'stock_daily_closings'`,
    );
    await adminPool.query(`DELETE FROM stock_levels WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'DCLOS-%')`);
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'DCLOS-%'`);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code = 'dclos-pv'`);

    // Setup : 1 PV + 2 produits
    const pos = await adminPool.query<{ id: string }>(
      `INSERT INTO points_of_sale (tenant_id, code, name) VALUES ($1, 'dclos-pv', 'PV DClos') RETURNING id`,
      [TENANT_A],
    );
    posId = pos.rows[0].id;

    const a = await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price, stock_mode)
       VALUES ($1, 'DCLOS-A', 'Auto', 100, 'automatique') RETURNING id`,
      [TENANT_A],
    );
    prodAuto = a.rows[0].id;

    const m = await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price, stock_mode)
       VALUES ($1, 'DCLOS-M', 'Manuel', 100, 'manuel') RETURNING id`,
      [TENANT_A],
    );
    prodManuel = m.rows[0].id;

    // Mouvements pour D : opening 100, sale -30, transfer_in 5 (donc theorique = 75)
    // Pour les deux produits.
    for (const pid of [prodAuto, prodManuel]) {
      await adminPool.query(
        `INSERT INTO stock_movements (tenant_id, product_id, point_of_sale_id, movement_type, quantity, performed_at, reason)
         VALUES ($1, $2, $3, 'opening', 100, $4, 'DCLOS-open')`,
        [TENANT_A, pid, posId, `${D}T08:00:00Z`],
      );
      await adminPool.query(
        `INSERT INTO stock_movements (tenant_id, product_id, point_of_sale_id, movement_type, quantity, performed_at, reason)
         VALUES ($1, $2, $3, 'sale', -30, $4, 'DCLOS-sale')`,
        [TENANT_A, pid, posId, `${D}T12:00:00Z`],
      );
      await adminPool.query(
        `INSERT INTO stock_movements (tenant_id, product_id, point_of_sale_id, movement_type, quantity, performed_at, reason)
         VALUES ($1, $2, $3, 'transfer_in', 5, $4, 'DCLOS-tin')`,
        [TENANT_A, pid, posId, `${D}T14:00:00Z`],
      );
    }
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM stock_daily_closings WHERE closing_date IN ($1, $2)`, [D, D_NEXT]);
    await adminPool.query(`DELETE FROM reconciliation_notes WHERE note_date IN ($1, $2)`, [D, D_NEXT]);
    await adminPool.query(
      `DELETE FROM stock_movements WHERE reason LIKE 'DCLOS-%' OR reference_table = 'stock_daily_closings'`,
    );
    await adminPool.query(`DELETE FROM stock_levels WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'DCLOS-%')`);
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'DCLOS-%'`);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code = 'dclos-pv'`);
    await app.close();
  });

  const headers = (tenant: string, user: string) => ({
    'X-Dev-Tenant-Id': tenant,
    'X-Dev-User-Id': user,
  });

  it('GET /inventory/daily-closing calcule le theorique = stock_matin - ventes + transferts_in', async () => {
    const res = await request(app.getHttpServer())
      .get(`/inventory/daily-closing?date=${D}&point_of_sale_id=${posId}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);

    const auto = res.body.find((r: { product: { sku: string } }) => r.product.sku === 'DCLOS-A');
    expect(auto).toBeDefined();
    expect(auto.figures.stock_matin).toBe(100);
    expect(auto.figures.ventes_qte).toBe(30);
    expect(auto.figures.transferts_in).toBe(5);
    expect(auto.figures.stock_theorique).toBe(75);
    expect(auto.product.stock_mode).toBe('automatique');
    expect(auto.closing).toBeNull();

    const man = res.body.find((r: { product: { sku: string } }) => r.product.sku === 'DCLOS-M');
    expect(man.figures.stock_theorique).toBe(75);
    expect(man.product.stock_mode).toBe('manuel');
  });

  it('PUT /inventory/daily-closing — saisie manuelle force source=manual + persiste theorique', async () => {
    await request(app.getHttpServer())
      .put('/inventory/daily-closing')
      .set(headers(TENANT_A, USER_A))
      .send({
        closing_date: D,
        point_of_sale_id: posId,
        product_id: prodManuel,
        quantity: 70,
      })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/inventory/daily-closing?date=${D}&point_of_sale_id=${posId}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);

    const man = res.body.find((r: { product: { sku: string } }) => r.product.sku === 'DCLOS-M');
    expect(man.closing).not.toBeNull();
    expect(man.closing.quantity).toBe(70);
    expect(man.closing.quantity_theorique).toBe(75);
    expect(man.closing.source).toBe('manual');
  });

  it('POST /inventory/daily-closing/recompute-auto cree les auto et ne touche pas les manual', async () => {
    const res = await request(app.getHttpServer())
      .post('/inventory/daily-closing/recompute-auto')
      .set(headers(TENANT_A, USER_A))
      .send({ closing_date: D, point_of_sale_id: posId })
      .expect(201);
    expect(res.body.updated).toBeGreaterThanOrEqual(1);

    const view = await request(app.getHttpServer())
      .get(`/inventory/daily-closing?date=${D}&point_of_sale_id=${posId}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);

    const auto = view.body.find((r: { product: { sku: string } }) => r.product.sku === 'DCLOS-A');
    expect(auto.closing).not.toBeNull();
    expect(auto.closing.source).toBe('auto');
    expect(auto.closing.quantity).toBe(75);

    const man = view.body.find((r: { product: { sku: string } }) => r.product.sku === 'DCLOS-M');
    // L'override manual reste a 70 — recomputeAuto ne doit PAS l'ecraser
    expect(man.closing.source).toBe('manual');
    expect(man.closing.quantity).toBe(70);
  });

  it('Notes : PUT puis GET retournent le body', async () => {
    await request(app.getHttpServer())
      .put('/inventory/daily-closing/notes')
      .set(headers(TENANT_A, USER_A))
      .send({
        note_date: D,
        point_of_sale_id: posId,
        body: 'Coupure de courant 14h-16h',
      })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/inventory/daily-closing/notes?date=${D}&point_of_sale_id=${posId}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);
    expect(res.body.body).toBe('Coupure de courant 14h-16h');
  });

  it('PATCH /products/:id/stock-mode bascule le mode', async () => {
    await request(app.getHttpServer())
      .patch(`/products/${prodAuto}/stock-mode`)
      .set(headers(TENANT_A, USER_A))
      .send({ mode: 'manuel' })
      .expect(200);

    const get = await request(app.getHttpServer())
      .get(`/products/${prodAuto}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);
    expect(get.body.stock_mode).toBe('manuel');
  });
});
