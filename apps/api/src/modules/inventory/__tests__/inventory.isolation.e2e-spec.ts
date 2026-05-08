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

describe('Inventory — multi-tenant isolation + trigger', () => {
  let app: INestApplication;
  let adminPool: Pool;

  let prodA: string;
  let prodB: string;
  let posA: string;
  let posB: string;

  beforeAll(async () => {
    process.env.AUTH_MODE = 'dev';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    adminPool = app.get(ADMIN_PG_POOL);

    // Cleanup de runs précédents
    await adminPool.query(`DELETE FROM stock_movements WHERE reason LIKE 'ITEST-%'`);
    await adminPool.query(`DELETE FROM stock_levels WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'ITEST-INV-%')`);
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'ITEST-INV-%'`);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code LIKE 'itest-inv-%'`);

    // Setup : un produit + un PV par tenant (via admin pool, BYPASSRLS)
    const pa = await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price) VALUES ($1, 'ITEST-INV-A', 'Produit A', 100) RETURNING id`,
      [TENANT_A],
    );
    prodA = pa.rows[0].id;
    const pb = await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price) VALUES ($1, 'ITEST-INV-B', 'Produit B', 200) RETURNING id`,
      [TENANT_B],
    );
    prodB = pb.rows[0].id;
    const sa = await adminPool.query<{ id: string }>(
      `INSERT INTO points_of_sale (tenant_id, code, name) VALUES ($1, 'itest-inv-a', 'PV A') RETURNING id`,
      [TENANT_A],
    );
    posA = sa.rows[0].id;
    const sb = await adminPool.query<{ id: string }>(
      `INSERT INTO points_of_sale (tenant_id, code, name) VALUES ($1, 'itest-inv-b', 'PV B') RETURNING id`,
      [TENANT_B],
    );
    posB = sb.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM stock_movements WHERE reason LIKE 'ITEST-%'`);
    await adminPool.query(`DELETE FROM stock_levels WHERE product_id IN (
      SELECT id FROM products WHERE sku LIKE 'ITEST-INV-%')`);
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'ITEST-INV-%'`);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code LIKE 'itest-inv-%'`);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code = 'itest-inv-a-bis'`);
    await app.close();
  });

  const headers = (tenant: string, user: string) => ({
    'X-Dev-Tenant-Id': tenant,
    'X-Dev-User-Id': user,
  });

  it('Opening stock + trigger met à jour le level', async () => {
    await request(app.getHttpServer())
      .post('/inventory/movements')
      .set(headers(TENANT_A, USER_A))
      .send({
        product_id: prodA,
        point_of_sale_id: posA,
        movement_type: 'opening',
        quantity: 50,
        reason: 'ITEST-opening-A',
      })
      .expect(201);

    const levels = await request(app.getHttpServer())
      .get(`/inventory/levels?product_id=${prodA}`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);
    expect(levels.body).toHaveLength(1);
    expect(Number(levels.body[0].quantity_on_hand)).toBe(50);
  });

  it('Sale décrémente, return incrémente', async () => {
    // Vente de 10 unités
    await request(app.getHttpServer())
      .post('/inventory/movements')
      .set(headers(TENANT_A, USER_A))
      .send({
        product_id: prodA,
        point_of_sale_id: posA,
        movement_type: 'sale',
        quantity: -10,
        reason: 'ITEST-sale-A',
      })
      .expect(201);

    let levels = await request(app.getHttpServer())
      .get(`/inventory/levels?product_id=${prodA}`)
      .set(headers(TENANT_A, USER_A));
    expect(Number(levels.body[0].quantity_on_hand)).toBe(40);  // 50 - 10

    // Retour client de 3
    await request(app.getHttpServer())
      .post('/inventory/movements')
      .set(headers(TENANT_A, USER_A))
      .send({
        product_id: prodA,
        point_of_sale_id: posA,
        movement_type: 'return',
        quantity: 3,
        reason: 'ITEST-return-A',
      })
      .expect(201);

    levels = await request(app.getHttpServer())
      .get(`/inventory/levels?product_id=${prodA}`)
      .set(headers(TENANT_A, USER_A));
    expect(Number(levels.body[0].quantity_on_hand)).toBe(43);
  });

  it('Stock insuffisant pour vente → 400', async () => {
    await request(app.getHttpServer())
      .post('/inventory/movements')
      .set(headers(TENANT_A, USER_A))
      .send({
        product_id: prodA,
        point_of_sale_id: posA,
        movement_type: 'sale',
        quantity: -1000,
        reason: 'ITEST-overflow-A',
      })
      .expect(400);
  });

  it('Sale avec quantity positif → 400 (mauvais signe)', async () => {
    await request(app.getHttpServer())
      .post('/inventory/movements')
      .set(headers(TENANT_A, USER_A))
      .send({
        product_id: prodA,
        point_of_sale_id: posA,
        movement_type: 'sale',
        quantity: 5,
      })
      .expect(400);
  });

  it('B ne voit pas les niveaux/mouvements de A', async () => {
    const levels = await request(app.getHttpServer())
      .get('/inventory/levels')
      .set(headers(TENANT_B, USER_B))
      .expect(200);
    expect(levels.body.find((l: { product_id: string }) => l.product_id === prodA)).toBeUndefined();

    const movements = await request(app.getHttpServer())
      .get('/inventory/movements')
      .set(headers(TENANT_B, USER_B))
      .expect(200);
    expect(movements.body.find((m: { reason: string | null }) => m.reason === 'ITEST-opening-A')).toBeUndefined();
  });

  it('Transfert inter-PV : décrémente source, incrémente cible (atomic)', async () => {
    // Setup : 2e PV pour TENANT_A
    const posA2 = (await adminPool.query<{ id: string }>(
      `INSERT INTO points_of_sale (tenant_id, code, name) VALUES ($1, 'itest-inv-a-bis', 'PV A bis') ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [TENANT_A],
    )).rows[0].id;

    // Stock 60 au PV principal (déjà 43 du test précédent + on en a déjà eu 43 puis +3 puis -10... let's just check)
    const before = await request(app.getHttpServer())
      .get(`/inventory/levels?product_id=${prodA}`)
      .set(headers(TENANT_A, USER_A));
    const sourceQtyBefore = Number(before.body.find((l: { point_of_sale_id: string }) => l.point_of_sale_id === posA).quantity_on_hand);

    // Transfert de 5 unités
    await request(app.getHttpServer())
      .post('/inventory/transfers')
      .set(headers(TENANT_A, USER_A))
      .send({
        product_id: prodA,
        from_point_of_sale_id: posA,
        to_point_of_sale_id: posA2,
        quantity: 5,
        reason: 'ITEST-transfer',
      })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get(`/inventory/levels?product_id=${prodA}`)
      .set(headers(TENANT_A, USER_A));
    const sourceQtyAfter = Number(after.body.find((l: { point_of_sale_id: string }) => l.point_of_sale_id === posA).quantity_on_hand);
    const targetQtyAfter = Number(after.body.find((l: { point_of_sale_id: string }) => l.point_of_sale_id === posA2).quantity_on_hand);

    expect(sourceQtyAfter).toBe(sourceQtyBefore - 5);
    expect(targetQtyAfter).toBe(5);
  });

  it('Transfert même PV → 400', async () => {
    await request(app.getHttpServer())
      .post('/inventory/transfers')
      .set(headers(TENANT_A, USER_A))
      .send({
        product_id: prodA,
        from_point_of_sale_id: posA,
        to_point_of_sale_id: posA,
        quantity: 1,
      })
      .expect(400);
  });

  it('Transfert avec stock insuffisant → 400', async () => {
    await request(app.getHttpServer())
      .post('/inventory/transfers')
      .set(headers(TENANT_A, USER_A))
      .send({
        product_id: prodA,
        from_point_of_sale_id: posA,
        to_point_of_sale_id: '00000000-0000-4000-8000-000000000000',
        quantity: 99999,
      })
      .expect(400);
  });

  it('Adjustment peut être positif ou négatif (pas de check de signe)', async () => {
    // B fait un opening de 100 sur son produit
    await request(app.getHttpServer())
      .post('/inventory/movements')
      .set(headers(TENANT_B, USER_B))
      .send({ product_id: prodB, point_of_sale_id: posB, movement_type: 'opening', quantity: 100, reason: 'ITEST-opening-B' })
      .expect(201);

    // Adjustment négatif (perte)
    await request(app.getHttpServer())
      .post('/inventory/movements')
      .set(headers(TENANT_B, USER_B))
      .send({ product_id: prodB, point_of_sale_id: posB, movement_type: 'adjustment', quantity: -7, reason: 'ITEST-loss-B' })
      .expect(201);

    const levels = await request(app.getHttpServer())
      .get(`/inventory/levels?product_id=${prodB}`)
      .set(headers(TENANT_B, USER_B));
    expect(Number(levels.body[0].quantity_on_hand)).toBe(93);
  });
});
