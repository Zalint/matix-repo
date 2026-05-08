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

describe('Sales — flow + isolation', () => {
  let app: INestApplication;
  let adminPool: Pool;

  let prodA: string;
  let prodB: string;
  let posA: string;
  let posB: string;
  let custA: string;

  beforeAll(async () => {
    process.env.AUTH_MODE = 'dev';
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    adminPool = app.get(ADMIN_PG_POOL);

    await adminPool.query(`DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM sales WHERE notes LIKE 'ITEST-%')`);
    await adminPool.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE notes LIKE 'ITEST-%')`);
    await adminPool.query(`DELETE FROM sales WHERE notes LIKE 'ITEST-%'`);
    // ALL stock_movements + levels referencing test data, irrespective of reason
    await adminPool.query(
      `DELETE FROM stock_movements WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'ITEST-SALES-%')
                                      OR point_of_sale_id IN (SELECT id FROM points_of_sale WHERE code LIKE 'itest-sales-%')`,
    );
    await adminPool.query(
      `DELETE FROM stock_levels WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'ITEST-SALES-%')
                                  OR point_of_sale_id IN (SELECT id FROM points_of_sale WHERE code LIKE 'itest-sales-%')`,
    );
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'ITEST-SALES-%'`);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code LIKE 'itest-sales-%'`);
    await adminPool.query(`DELETE FROM customers WHERE code LIKE 'ITEST-SALES-%'`);
    await adminPool.query(`DELETE FROM document_sequences WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);

    // Seed
    prodA = (await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price) VALUES ($1, 'ITEST-SALES-A', 'Produit A', 1500) RETURNING id`,
      [TENANT_A],
    )).rows[0].id;
    prodB = (await adminPool.query<{ id: string }>(
      `INSERT INTO products (tenant_id, sku, name, unit_price) VALUES ($1, 'ITEST-SALES-B', 'Produit B', 2000) RETURNING id`,
      [TENANT_B],
    )).rows[0].id;
    posA = (await adminPool.query<{ id: string }>(
      `INSERT INTO points_of_sale (tenant_id, code, name) VALUES ($1, 'itest-sales-a', 'Sales PV A') RETURNING id`,
      [TENANT_A],
    )).rows[0].id;
    posB = (await adminPool.query<{ id: string }>(
      `INSERT INTO points_of_sale (tenant_id, code, name) VALUES ($1, 'itest-sales-b', 'Sales PV B') RETURNING id`,
      [TENANT_B],
    )).rows[0].id;
    custA = (await adminPool.query<{ id: string }>(
      `INSERT INTO customers (tenant_id, code, display_name) VALUES ($1, 'ITEST-SALES-CUST', 'Client A') RETURNING id`,
      [TENANT_A],
    )).rows[0].id;

    // Stock initial sur prodA et prodB
    await adminPool.query(
      `INSERT INTO stock_movements (tenant_id, product_id, point_of_sale_id, movement_type, quantity, reason)
       VALUES ($1, $2, $3, 'opening', 100, 'ITEST-SALES-init-A'),
              ($4, $5, $6, 'opening', 200, 'ITEST-SALES-init-B')`,
      [TENANT_A, prodA, posA, TENANT_B, prodB, posB],
    );
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM sales WHERE notes LIKE 'ITEST-%')`);
    await adminPool.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE notes LIKE 'ITEST-%')`);
    await adminPool.query(`DELETE FROM sales WHERE notes LIKE 'ITEST-%'`);
    await adminPool.query(
      `DELETE FROM stock_movements WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'ITEST-SALES-%')
                                      OR point_of_sale_id IN (SELECT id FROM points_of_sale WHERE code LIKE 'itest-sales-%')`,
    );
    await adminPool.query(
      `DELETE FROM stock_levels WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'ITEST-SALES-%')
                                  OR point_of_sale_id IN (SELECT id FROM points_of_sale WHERE code LIKE 'itest-sales-%')`,
    );
    await adminPool.query(`DELETE FROM products WHERE sku LIKE 'ITEST-SALES-%'`);
    await adminPool.query(`DELETE FROM points_of_sale WHERE code LIKE 'itest-sales-%'`);
    await adminPool.query(`DELETE FROM customers WHERE code LIKE 'ITEST-SALES-%'`);
    await adminPool.query(`DELETE FROM document_sequences WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    await app.close();
  });

  const headers = (tenant: string, user: string) => ({
    'X-Dev-Tenant-Id': tenant,
    'X-Dev-User-Id': user,
  });

  it('Crée + auto-post : décrémente stock et alloue ref ACME-YYYY-000001', async () => {
    const r = await request(app.getHttpServer())
      .post('/sales')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posA,
        customer_id: custA,
        notes: 'ITEST-autopost',
        items: [{ product_id: prodA, quantity: 3 }],
        payments: [{ method: 'cash', amount: 4500, reference: 'ITEST-pay1' }],
        auto_post: true,
      })
      .expect(201);

    expect(r.body.status).toBe('posted');
    expect(Number(r.body.total)).toBe(4500); // 3 × 1500
    expect(Number(r.body.paid_total)).toBe(4500);
    expect(Number(r.body.change_given)).toBe(0);
    expect(r.body.reference_number).toMatch(/^ACME-\d{4}-000001$/);

    const lvl = await request(app.getHttpServer())
      .get(`/inventory/levels?product_id=${prodA}`)
      .set(headers(TENANT_A, USER_A));
    expect(Number(lvl.body[0].quantity_on_hand)).toBe(97); // 100 - 3
  });

  it('Auto-post avec paiement insuffisant → 400', async () => {
    await request(app.getHttpServer())
      .post('/sales')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posA,
        notes: 'ITEST-underpaid',
        items: [{ product_id: prodA, quantity: 1 }],
        payments: [{ method: 'cash', amount: 100 }], // < 1500
        auto_post: true,
      })
      .expect(400);
  });

  it('Crée draft puis post → décrément + ref allouée', async () => {
    const created = await request(app.getHttpServer())
      .post('/sales')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posA,
        notes: 'ITEST-draft',
        items: [{ product_id: prodA, quantity: 2 }],
        payments: [{ method: 'wave', amount: 3000, reference: 'ITEST-wave1' }],
      })
      .expect(201);

    expect(created.body.status).toBe('draft');
    expect(created.body.reference_number).toBeNull();

    const posted = await request(app.getHttpServer())
      .post(`/sales/${created.body.id}/post`)
      .set(headers(TENANT_A, USER_A))
      .expect(200);
    expect(posted.body.status).toBe('posted');
    expect(posted.body.reference_number).toMatch(/^ACME-\d{4}-000002$/); // 2e ref
  });

  it('Void d\'une vente postée → re-incrémente le stock', async () => {
    const created = await request(app.getHttpServer())
      .post('/sales')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posA,
        notes: 'ITEST-void',
        items: [{ product_id: prodA, quantity: 5 }],
        payments: [{ method: 'cash', amount: 7500 }],
        auto_post: true,
      })
      .expect(201);

    const beforeVoid = await request(app.getHttpServer())
      .get(`/inventory/levels?product_id=${prodA}`)
      .set(headers(TENANT_A, USER_A));
    const stockBefore = Number(beforeVoid.body[0].quantity_on_hand);

    await request(app.getHttpServer())
      .post(`/sales/${created.body.id}/void`)
      .set(headers(TENANT_A, USER_A))
      .send({ reason: 'Erreur de saisie' })
      .expect(200);

    const afterVoid = await request(app.getHttpServer())
      .get(`/inventory/levels?product_id=${prodA}`)
      .set(headers(TENANT_A, USER_A));
    expect(Number(afterVoid.body[0].quantity_on_hand)).toBe(stockBefore + 5);
  });

  it('B ne voit pas les ventes de A', async () => {
    const list = await request(app.getHttpServer())
      .get('/sales')
      .set(headers(TENANT_B, USER_B))
      .expect(200);
    expect(list.body.find((s: { notes: string | null }) => s.notes?.startsWith('ITEST-'))).toBeUndefined();
  });

  it('Référence dans tenant B est ACME-séparée (commence à 000001)', async () => {
    const r = await request(app.getHttpServer())
      .post('/sales')
      .set(headers(TENANT_B, USER_B))
      .send({
        point_of_sale_id: posB,
        notes: 'ITEST-tenantB',
        items: [{ product_id: prodB, quantity: 1 }],
        payments: [{ method: 'cash', amount: 2000 }],
        auto_post: true,
      })
      .expect(201);
    expect(r.body.reference_number).toMatch(/^BETA-\d{4}-000001$/);
  });

  it('Vente avec produit d\'un autre tenant → 400 (RLS bloque le lookup prix)', async () => {
    await request(app.getHttpServer())
      .post('/sales')
      .set(headers(TENANT_A, USER_A))
      .send({
        point_of_sale_id: posA,
        notes: 'ITEST-cross',
        items: [{ product_id: prodB, quantity: 1 }], // prodB est de TENANT_B
        payments: [{ method: 'cash', amount: 2000 }],
        auto_post: true,
      })
      .expect(400);
  });
});
