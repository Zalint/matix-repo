import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';

import { AppModule } from '../../../app.module';
import { ADMIN_PG_POOL } from '../../../common/database.module';

const TENANT_A = 'a1111111-1111-4111-8111-111111111111';
const USER_A = 'a1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * Tests d'intégration pour le rabais "vente en gros" :
 *   - GET /settings/tenant retourne default_gros_rebate_xof
 *   - PATCH met à jour (et persiste pour le tenant courant)
 *   - GET /products expose effective_gros_price calculé selon la formule
 *   - POST /sales avec pricing_variant='gros' applique le bon prix selon
 *     les cas (override > rabais > erreur si gros_enabled=false)
 */
describe('Gros rebate setting + product effective price (e2e)', () => {
  let app: INestApplication;
  let adminPool: Pool;

  let posId: string;
  let productSimpleId: string;       // gros_enabled=false → pas de toggle
  let productRebateId: string;       // gros_enabled=true, unit_price_gros=NULL → rabais
  let productOverrideId: string;     // gros_enabled=true, unit_price_gros=3000 → override

  beforeAll(async () => {
    process.env.AUTH_MODE = 'dev';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    adminPool = app.get(ADMIN_PG_POOL);

    // Reset settings + license + setup
    await adminPool.query(
      `UPDATE tenants SET default_gros_rebate_xof = 0 WHERE id = $1`,
      [TENANT_A],
    );
    await adminPool.query(
      `INSERT INTO tenant_licenses (tenant_id, module_code, enabled, source)
       VALUES ($1, 'commercial.sales.pos', TRUE, 'manual')
       ON CONFLICT (tenant_id, module_code) DO UPDATE SET enabled = TRUE`,
      [TENANT_A],
    );

    // Cleanup
    await adminPool.query(`DELETE FROM stock_movements WHERE reason LIKE 'GROSTEST-%'`);
    await adminPool.query(`DELETE FROM stock_levels WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'GROSTEST-%')`);
    await adminPool.query(`DELETE FROM sale_items WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'GROSTEST-%')`);
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'GROSTEST-%'`);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code = 'grostest-pv'`);

    // Setup
    const pos = await adminPool.query<{ id: string }>(
      `INSERT INTO points_of_sale (tenant_id, code, name) VALUES ($1, 'grostest-pv', 'PV') RETURNING id`,
      [TENANT_A],
    );
    posId = pos.rows[0].id;

    const simple = await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price, gros_enabled, unit_price_gros)
       VALUES ($1, 'GROSTEST-SIMPLE', 'Simple', 1000, FALSE, NULL) RETURNING id`,
      [TENANT_A],
    );
    productSimpleId = simple.rows[0].id;

    const rebate = await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price, gros_enabled, unit_price_gros)
       VALUES ($1, 'GROSTEST-REBATE', 'Boeuf rebate', 3500, TRUE, NULL) RETURNING id`,
      [TENANT_A],
    );
    productRebateId = rebate.rows[0].id;

    const override = await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price, gros_enabled, unit_price_gros)
       VALUES ($1, 'GROSTEST-OVERRIDE', 'Boeuf override', 3500, TRUE, 3000) RETURNING id`,
      [TENANT_A],
    );
    productOverrideId = override.rows[0].id;

    // Stock pour les ventes
    for (const pid of [productSimpleId, productRebateId, productOverrideId]) {
      await adminPool.query(
        `INSERT INTO stock_movements (tenant_id, product_id, point_of_sale_id, movement_type, quantity, reason)
         VALUES ($1, $2, $3, 'opening', 100, 'GROSTEST-init')`,
        [TENANT_A, pid, posId],
      );
    }
  });

  afterAll(async () => {
    // ALL stock_movements for these products (incl. ceux générés par les ventes auto-post)
    await adminPool.query(`DELETE FROM stock_movements WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'GROSTEST-%')`);
    await adminPool.query(`DELETE FROM stock_levels WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'GROSTEST-%')`);
    await adminPool.query(`DELETE FROM sale_payments WHERE sale_id IN (
      SELECT sale_id FROM sale_items WHERE product_id IN (
        SELECT id FROM products WHERE sku LIKE 'GROSTEST-%'))`);
    await adminPool.query(`DELETE FROM sale_items WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'GROSTEST-%')`);
    await adminPool.query(`DELETE FROM sales WHERE id NOT IN (SELECT sale_id FROM sale_items)
      AND point_of_sale_id IN (SELECT id FROM points_of_sale WHERE code = 'grostest-pv')`);
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'GROSTEST-%'`);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code = 'grostest-pv'`);
    await adminPool.query(
      `UPDATE tenants SET default_gros_rebate_xof = 0 WHERE id = $1`,
      [TENANT_A],
    );
    await app.close();
  });

  const headers = (tenant: string, user: string) => ({
    'X-Dev-Tenant-Id': tenant,
    'X-Dev-User-Id': user,
  });

  it('GET /settings/tenant retourne le default_gros_rebate_xof (0 par défaut)', async () => {
    const res = await request(app.getHttpServer())
      .get('/settings/tenant')
      .set(headers(TENANT_A, USER_A))
      .expect(200);
    expect(res.body.tenant_id).toBe(TENANT_A);
    expect(res.body.default_gros_rebate_xof).toBe(0);
  });

  it('PATCH /settings/tenant met à jour le rabais', async () => {
    const res = await request(app.getHttpServer())
      .patch('/settings/tenant')
      .set(headers(TENANT_A, USER_A))
      .send({ default_gros_rebate_xof: 200 })
      .expect(200);
    expect(res.body.default_gros_rebate_xof).toBe(200);
  });

  it('GET /products expose effective_gros_price avec rabais appliqué', async () => {
    const res = await request(app.getHttpServer())
      .get('/products')
      .set(headers(TENANT_A, USER_A))
      .expect(200);

    const simple = res.body.find((p: { sku: string }) => p.sku === 'GROSTEST-SIMPLE');
    const rebate = res.body.find((p: { sku: string }) => p.sku === 'GROSTEST-REBATE');
    const override = res.body.find((p: { sku: string }) => p.sku === 'GROSTEST-OVERRIDE');

    // gros_enabled=false → effective_gros_price=null
    expect(simple.gros_enabled).toBe(false);
    expect(simple.effective_gros_price).toBeNull();

    // gros_enabled=true, override NULL, rabais=200 → 3500 - 200 = 3300
    expect(rebate.gros_enabled).toBe(true);
    expect(Number(rebate.effective_gros_price)).toBe(3300);

    // gros_enabled=true, override=3000 → 3000 (ignore le rabais)
    expect(override.gros_enabled).toBe(true);
    expect(Number(override.effective_gros_price)).toBe(3000);
  });

  it('POST /sales pricing_variant=gros applique le prix calculé (rabais)', async () => {
    const res = await request(app.getHttpServer())
      .post('/sales')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posId,
        items: [
          { product_id: productRebateId, quantity: 2, pricing_variant: 'gros' },
        ],
        payments: [{ method: 'cash', amount: 6600 }],
        auto_post: true,
      })
      .expect(201);

    expect(res.body.items).toHaveLength(1);
    // 3500 - 200 (rabais) = 3300/kg, × 2 kg = 6600
    expect(Number(res.body.items[0].unit_price)).toBe(3300);
    expect(res.body.items[0].pricing_variant).toBe('gros');
    expect(Number(res.body.total)).toBe(6600);
  });

  it('POST /sales pricing_variant=gros utilise l\'override quand présent', async () => {
    const res = await request(app.getHttpServer())
      .post('/sales')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posId,
        items: [
          { product_id: productOverrideId, quantity: 1, pricing_variant: 'gros' },
        ],
        payments: [{ method: 'cash', amount: 3000 }],
        auto_post: true,
      })
      .expect(201);

    expect(Number(res.body.items[0].unit_price)).toBe(3000);
  });

  it('POST /sales pricing_variant=gros sur produit gros_enabled=false → 400', async () => {
    await request(app.getHttpServer())
      .post('/sales')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posId,
        items: [
          { product_id: productSimpleId, quantity: 1, pricing_variant: 'gros' },
        ],
        payments: [{ method: 'cash', amount: 1000 }],
        auto_post: true,
      })
      .expect(400);
  });

  it('POST /sales pricing_variant=detail applique le prix unit_price normal', async () => {
    const res = await request(app.getHttpServer())
      .post('/sales')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posId,
        items: [
          { product_id: productRebateId, quantity: 1, pricing_variant: 'detail' },
        ],
        payments: [{ method: 'cash', amount: 3500 }],
        auto_post: true,
      })
      .expect(201);

    expect(Number(res.body.items[0].unit_price)).toBe(3500);
    expect(res.body.items[0].pricing_variant).toBe('detail');
  });
});
