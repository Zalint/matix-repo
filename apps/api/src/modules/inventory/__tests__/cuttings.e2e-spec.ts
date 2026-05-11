import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';

import { AppModule } from '../../../app.module';
import { ADMIN_PG_POOL } from '../../../common/database.module';

const TENANT_A = 'a1111111-1111-4111-8111-111111111111';
const USER_A = 'a1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'b2222222-2222-4222-8222-222222222222';
const USER_B = 'b2222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Tests d'intégration CuttingsService :
 *   - create transactionnel (header + outputs + mouvements stock cohérents)
 *   - validation : sortie supérieure à la source -> 400
 *   - validation : produit dupliqué dans outputs -> 400
 *   - validation : source dans outputs -> 400
 *   - chute calculée et stockée explicitement (waste_quantity + waste_pct)
 *   - le stock_level de la source est décrémenté
 *   - les stock_levels des outputs sont incrémentés
 *   - les mouvements stock générés portent reference_table='stock_cuttings'
 *   - RLS : tenant B ne voit pas les découpes de tenant A
 *   - DailyClosingService inclut cutting_in/out dans le théorique
 *   - stats yield agrège correctement
 */
describe('CuttingsService (e2e)', () => {
  let app: INestApplication;
  let adminPool: Pool;

  let posA: string;
  let carcasseId: string;       // produit source
  let boeufId: string;          // produit fini 1
  let filetId: string;          // produit fini 2

  beforeAll(async () => {
    process.env.AUTH_MODE = 'dev';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    adminPool = app.get(ADMIN_PG_POOL);

    // Licenses tenant A
    await adminPool.query(
      `INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)
       VALUES ($1, 'operations.inventory.movements', TRUE, 'manual')
       ON CONFLICT (tenant_id, module_code) DO UPDATE SET enabled = TRUE`,
      [TENANT_A],
    );

    // Cleanup
    await adminPool.query(`DELETE FROM stock_cutting_outputs WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'CTEST-%')`);
    await adminPool.query(`DELETE FROM stock_cuttings WHERE source_product_id IN (
      SELECT id FROM products WHERE sku LIKE 'CTEST-%')`);
    await adminPool.query(
      `DELETE FROM stock_movements WHERE reason LIKE 'CTEST-%' OR (reference_table = 'stock_cuttings')`,
    );
    await adminPool.query(`DELETE FROM stock_levels WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'CTEST-%')`);
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'CTEST-%'`);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code = 'ctest-pv'`);

    // Setup PV + 3 produits (1 carcasse + 2 produits finis)
    const pos = await adminPool.query<{ id: string }>(
      `INSERT INTO points_of_sale (tenant_id, code, name) VALUES ($1, 'ctest-pv', 'PV Test Cuttings') RETURNING id`,
      [TENANT_A],
    );
    posA = pos.rows[0].id;

    const carc = await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price) VALUES ($1, 'CTEST-CARC', 'Carcasse', 4500) RETURNING id`,
      [TENANT_A],
    );
    carcasseId = carc.rows[0].id;

    const bf = await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price) VALUES ($1, 'CTEST-BOEUF', 'Boeuf', 3500) RETURNING id`,
      [TENANT_A],
    );
    boeufId = bf.rows[0].id;

    const fl = await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price) VALUES ($1, 'CTEST-FILET', 'Filet', 7500) RETURNING id`,
      [TENANT_A],
    );
    filetId = fl.rows[0].id;

    // Stock initial : 120 kg de carcasse au PV
    await adminPool.query(
      `INSERT INTO stock_movements (tenant_id, product_id, point_of_sale_id, movement_type, quantity, reason)
       VALUES ($1, $2, $3, 'opening', 120, 'CTEST-init')`,
      [TENANT_A, carcasseId, posA],
    );
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM stock_cutting_outputs WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'CTEST-%')`);
    await adminPool.query(`DELETE FROM stock_cuttings WHERE source_product_id IN (
      SELECT id FROM products WHERE sku LIKE 'CTEST-%')`);
    await adminPool.query(
      `DELETE FROM stock_movements WHERE reason LIKE 'CTEST-%' OR (reference_table = 'stock_cuttings')`,
    );
    await adminPool.query(`DELETE FROM stock_levels WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'CTEST-%')`);
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'CTEST-%'`);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code = 'ctest-pv'`);
    await app.close();
  });

  const headers = (tenant: string, user: string) => ({
    'X-Dev-Tenant-Id': tenant,
    'X-Dev-User-Id': user,
  });

  it('POST /inventory/cuttings : crée la découpe transactionnelle + mouvements + maj stock_levels', async () => {
    // Découpe 120 kg carcasse -> 70 boeuf + 2,5 filet = 72,5 sortie / 47,5 chute (39,6%)
    const res = await request(app.getHttpServer())
      .post('/inventory/cuttings')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posA,
        source_product_id: carcasseId,
        source_quantity: 120,
        source_unit_cost: 4500,
        outputs: [
          { product_id: boeufId, quantity: 70 },
          { product_id: filetId, quantity: 2.5 },
        ],
        notes: 'Découpe test 1',
      })
      .expect(201);

    expect(res.body.source_quantity).toBe(120);
    expect(res.body.total_outputs).toBe(72.5);
    expect(res.body.waste_quantity).toBe(47.5);
    expect(res.body.waste_pct).toBeCloseTo(39.58, 1);
    expect(res.body.outputs).toHaveLength(2);
    expect(res.body.notes).toBe('Découpe test 1');

    // Vérif stock_levels via API
    const levels = await request(app.getHttpServer())
      .get(`/inventory/levels?point_of_sale_id=${posA}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);

    const carcLevel = levels.body.find((l: { product_id: string }) => l.product_id === carcasseId);
    const boeufLevel = levels.body.find((l: { product_id: string }) => l.product_id === boeufId);
    const filetLevel = levels.body.find((l: { product_id: string }) => l.product_id === filetId);

    expect(Number(carcLevel.quantity_on_hand)).toBe(0);          // 120 - 120 (cutting_out)
    expect(Number(boeufLevel.quantity_on_hand)).toBe(70);
    expect(Number(filetLevel.quantity_on_hand)).toBe(2.5);

    // Vérif mouvements générés
    const mvts = await adminPool.query(
      `SELECT movement_type, quantity, reference_table, reference_id
         FROM stock_movements
        WHERE reference_table = 'stock_cuttings' AND reference_id = $1
        ORDER BY movement_type`,
      [res.body.id],
    );
    expect(mvts.rows).toHaveLength(3);
    const out = mvts.rows.find((m: { movement_type: string }) => m.movement_type === 'cutting_out');
    const ins = mvts.rows.filter((m: { movement_type: string }) => m.movement_type === 'cutting_in');
    expect(Number(out.quantity)).toBe(-120);
    expect(ins).toHaveLength(2);
    expect(ins.map((i: { quantity: string }) => Number(i.quantity)).sort()).toEqual([2.5, 70]);
  });

  it('POST /inventory/cuttings refuse si Σ outputs > source', async () => {
    await request(app.getHttpServer())
      .post('/inventory/cuttings')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posA,
        source_product_id: carcasseId,
        source_quantity: 10,
        outputs: [
          { product_id: boeufId, quantity: 15 },
        ],
      })
      .expect(400);
  });

  it('POST /inventory/cuttings refuse si un produit apparait 2x dans outputs', async () => {
    await request(app.getHttpServer())
      .post('/inventory/cuttings')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posA,
        source_product_id: carcasseId,
        source_quantity: 100,
        outputs: [
          { product_id: boeufId, quantity: 30 },
          { product_id: boeufId, quantity: 20 },
        ],
      })
      .expect(400);
  });

  it('POST /inventory/cuttings refuse si la source est aussi en output', async () => {
    await request(app.getHttpServer())
      .post('/inventory/cuttings')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posA,
        source_product_id: carcasseId,
        source_quantity: 50,
        outputs: [
          { product_id: carcasseId, quantity: 30 },
        ],
      })
      .expect(400);
  });

  it('GET /inventory/cuttings filtre par date et PV', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app.getHttpServer())
      .get(`/inventory/cuttings?date=${today}&point_of_sale_id=${posA}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].outputs).toBeDefined();
  });

  it('DailyClosingService intègre cutting_in/out dans le calcul du théorique', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const view = await request(app.getHttpServer())
      .get(`/inventory/daily-closing?date=${today}&point_of_sale_id=${posA}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);

    // Carcasse : ouverture 120 + cutting_out 120 -> théorique 0
    const carc = view.body.find((r: { product: { sku: string } }) => r.product.sku === 'CTEST-CARC');
    expect(carc.figures.stock_matin).toBe(120);
    expect(carc.figures.cuttings_out).toBe(120);
    expect(carc.figures.stock_theorique).toBe(0);

    // Boeuf : cutting_in 70 (aucun stock matin, aucune vente) -> théorique 70
    const bf = view.body.find((r: { product: { sku: string } }) => r.product.sku === 'CTEST-BOEUF');
    expect(bf.figures.cuttings_in).toBe(70);
    expect(bf.figures.stock_theorique).toBe(70);
  });

  it('GET /inventory/cuttings/stats/yield agrège les rendements', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app.getHttpServer())
      .get(`/inventory/cuttings/stats/yield?from=${today}&to=${today}&point_of_sale_id=${posA}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);

    const carcStat = res.body.find((s: { source_sku: string }) => s.source_sku === 'CTEST-CARC');
    expect(carcStat).toBeDefined();
    expect(carcStat.source_total).toBe(120);
    expect(carcStat.outputs_total).toBe(72.5);
    expect(carcStat.waste_total).toBe(47.5);
    expect(carcStat.yield_pct).toBeCloseTo(60.42, 1);
  });

  it('Tenant B ne voit pas les découpes de Tenant A (RLS)', async () => {
    await adminPool.query(
      `INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)
       VALUES ($1, 'operations.inventory.movements', TRUE, 'manual')
       ON CONFLICT (tenant_id, module_code) DO UPDATE SET enabled = TRUE`,
      [TENANT_B],
    );

    const res = await request(app.getHttpServer())
      .get('/inventory/cuttings')
      .set(headers(TENANT_B, USER_B))
      .expect(200);
    // Aucune découpe de A ne doit apparaître
    expect(res.body.find((c: { source_product_id: string }) => c.source_product_id === carcasseId))
      .toBeUndefined();
  });
});
