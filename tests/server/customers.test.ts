import { DatabaseSync } from 'node:sqlite';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { CustomerRepository } from '../../src/server/db/customer-repository';
import { migrateDatabase } from '../../src/server/db/migrate';
import { registerCustomerRoutes } from '../../src/server/routes/customers';
import { CustomerService } from '../../src/server/services/customer-service';
import { getCustomerProductCompletionStatus } from '../../src/shared/customers';
import { authInject, setupAdmin } from './helpers/auth';

interface TestContext {
  app: FastifyInstance;
  database: DatabaseSync;
}

const contexts: TestContext[] = [];

async function testApp(): Promise<TestContext> {
  const database = new DatabaseSync(':memory:');
  migrateDatabase(database);
  const app = await createApp({ database });
  await setupAdmin(app);
  const context = { app, database };
  contexts.push(context);
  return context;
}

function customerPayload(name = '张三') {
  return {
    name,
    contactName: '张先生',
    contactPhone: '13800000000',
    shippingInfo: '张三 13800000000 浙江省宁波市',
  };
}

async function createCustomer(app: FastifyInstance, name = '张三'): Promise<Record<string, unknown>> {
  const response = await authInject(app, {
    method: 'POST',
    url: '/api/customers',
    payload: customerPayload(name),
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as Record<string, unknown>;
}

function insertCustomerProduct(
  database: DatabaseSync,
  customerId: unknown,
  name: string,
  sku = '',
): void {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO customer_products
      (customer_id, name, specification, sku, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(customerId, name, '测试规格', sku, now, now);
}

async function customQueryApp(query: Record<string, unknown>): Promise<TestContext> {
  const database = new DatabaseSync(':memory:');
  migrateDatabase(database);
  const app = Fastify({
    routerOptions: {
      querystringParser: () => query,
    },
  });
  await registerCustomerRoutes(app, {
    service: new CustomerService(new CustomerRepository(database)),
  });
  const context = { app, database };
  contexts.push(context);
  return context;
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async ({ app, database }) => {
    await app.close();
    database.close();
  }));
});

describe('客户档案 API', () => {
  it('创建、搜索、查看和编辑客户，并返回产品统计', async () => {
    const { app, database } = await testApp();
    const createdResponse = await authInject(app, {
      method: 'POST',
      url: '/api/customers',
      payload: {
        name: '  张三  ',
        contactName: '  张先生 ',
        contactPhone: ' 13800000000 ',
        shippingInfo: '  张三 浙江省宁波市  ',
      },
    });

    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json().data;
    expect(created).toMatchObject({
      name: '张三',
      contactName: '张先生',
      contactPhone: '13800000000',
      shippingInfo: '张三 浙江省宁波市',
      isActive: true,
      productCount: 0,
      incompleteProductCount: 0,
    });

    const now = new Date().toISOString();
    database.prepare(
      `INSERT INTO customer_products
        (customer_id, name, specification, sku, pack_count, final_price_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(created.id, '无刷电钻', '20V', '', null, null, now, now);
    database.prepare(
      `INSERT INTO customer_products
        (customer_id, name, specification, sku, pack_count, final_price_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(created.id, '角磨机', '125mm', 'ZS-002', 4, 25900, now, now);

    const listed = await authInject(app, { method: 'GET', url: '/api/customers?q=1380000' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.items).toEqual([
      expect.objectContaining({
        id: created.id,
        productCount: 2,
        incompleteProductCount: 1,
      }),
    ]);

    const fetched = await authInject(app, { method: 'GET', url: `/api/customers/${created.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().data).toMatchObject({ productCount: 2, incompleteProductCount: 1 });

    const updated = await authInject(app, {
      method: 'PUT',
      url: `/api/customers/${created.id}`,
      payload: {
        name: '张三工具店',
        contactName: '张经理',
        contactPhone: '13900000000',
        shippingInfo: '浙江省金华市',
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({
      id: created.id,
      name: '张三工具店',
      contactName: '张经理',
      productCount: 2,
    });
  });

  it('名称必填，其他文本字段类型错误时返回字段级校验错误', async () => {
    const { app } = await testApp();

    const missingName = await authInject(app, {
      method: 'POST',
      url: '/api/customers',
      payload: { ...customerPayload(), name: '   ' },
    });
    expect(missingName.statusCode).toBe(400);
    expect(missingName.json()).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', field: 'name' },
    });

    const invalidPhone = await authInject(app, {
      method: 'POST',
      url: '/api/customers',
      payload: { ...customerPayload(), contactPhone: 13800000000 },
    });
    expect(invalidPhone.statusCode).toBe(400);
    expect(invalidPhone.json()).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', field: 'contactPhone' },
    });
  });

  it('创建同名客户必须显式确认，确认后允许创建', async () => {
    const { app } = await testApp();
    await createCustomer(app);

    const duplicate = await authInject(app, {
      method: 'POST',
      url: '/api/customers',
      payload: customerPayload('  张三 '),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      ok: false,
      error: { code: 'CUSTOMER_NAME_EXISTS', field: 'name' },
    });

    const confirmed = await authInject(app, {
      method: 'POST',
      url: '/api/customers',
      payload: { ...customerPayload(), confirmDuplicateName: true },
    });
    expect(confirmed.statusCode).toBe(201);

    const listed = await authInject(app, { method: 'GET', url: '/api/customers?q=张三' });
    expect(listed.json().data.items).toHaveLength(2);
  });

  it('编辑为同名客户也必须显式确认，确认前不修改原客户', async () => {
    const { app } = await testApp();
    const first = await createCustomer(app, '华南五金');
    const second = await createCustomer(app, '华东五金');

    const duplicate = await authInject(app, {
      method: 'PUT',
      url: `/api/customers/${second.id}`,
      payload: customerPayload('  华南五金  '),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({
      ok: false,
      error: {
        code: 'CUSTOMER_NAME_EXISTS',
        message: '客户名称已存在，请确认后再创建',
        field: 'name',
      },
    });

    const unchanged = await authInject(app, { method: 'GET', url: `/api/customers/${second.id}` });
    expect(unchanged.json().data.name).toBe('华东五金');

    const confirmed = await authInject(app, {
      method: 'PUT',
      url: `/api/customers/${second.id}`,
      payload: { ...customerPayload('华南五金'), confirmDuplicateName: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().data).toMatchObject({ id: second.id, name: first.name });
  });

  it('按启用状态、待完善数、更新时间和 ID 降序稳定排序', async () => {
    const { app, database } = await testApp();
    const low = await createCustomer(app, '低优先级');
    const tieOlderId = await createCustomer(app, '同更新时间旧 ID');
    const tieNewerId = await createCustomer(app, '同更新时间新 ID');
    const newest = await createCustomer(app, '更新时间最新');
    const inactive = await createCustomer(app, '停用客户');

    for (const customer of [tieOlderId, tieNewerId, newest]) {
      insertCustomerProduct(database, customer.id, `${customer.name}-1`);
      insertCustomerProduct(database, customer.id, `${customer.name}-2`);
    }
    for (let index = 0; index < 3; index += 1) {
      insertCustomerProduct(database, inactive.id, `停用产品-${index}`);
    }

    database.prepare('UPDATE customers SET updated_at = ? WHERE id = ?')
      .run('2026-08-11T08:00:00.000Z', low.id);
    database.prepare('UPDATE customers SET updated_at = ? WHERE id IN (?, ?)')
      .run('2026-08-11T09:00:00.000Z', tieOlderId.id, tieNewerId.id);
    database.prepare('UPDATE customers SET updated_at = ? WHERE id = ?')
      .run('2026-08-11T10:00:00.000Z', newest.id);
    database.prepare('UPDATE customers SET is_active = 0, updated_at = ? WHERE id = ?')
      .run('2026-08-11T11:00:00.000Z', inactive.id);

    const response = await authInject(app, { method: 'GET', url: '/api/customers?includeInactive=1' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items.map((customer: { id: number }) => customer.id)).toEqual([
      newest.id,
      tieNewerId.id,
      tieOlderId.id,
      low.id,
      inactive.id,
    ]);
  });

  it('待完善统计严格匹配共享函数的 SQLite 类型和 JS 安全整数规则', async () => {
    const { app, database } = await testApp();
    const customer = await createCustomer(app, '整数边界客户');
    const now = new Date().toISOString();
    const insertSql = (name: string, skuSql: string, packSql: string, priceSql: string) => {
      database.exec(`
        INSERT INTO customer_products
          (customer_id, name, specification, sku, pack_count, final_price_cents, created_at, updated_at)
        VALUES
          (${Number(customer.id)}, '${name}', '规格', ${skuSql}, ${packSql}, ${priceSql}, '${now}', '${now}');
      `);
    };

    insertSql('安全上限', "'MAX'", '9007199254740991', '9007199254740991');
    insertSql('装箱数超限', "'PACK-OVER'", '9007199254740992', '1');
    insertSql('价格超限', "'PRICE-OVER'", '1', '9007199254740992');
    insertSql('装箱数为 REAL', "'PACK-REAL'", '1.5', '1');
    insertSql('价格为 REAL', "'PRICE-REAL'", '1', '1.5');
    insertSql('空白 SKU', "'   '", '1', '1');

    expect(getCustomerProductCompletionStatus({
      sku: 'MAX',
      packCount: 9007199254740991,
      finalPriceCents: 9007199254740991,
    })).toBe('complete');
    expect(getCustomerProductCompletionStatus({
      sku: 'OVER',
      packCount: 9007199254740992,
      finalPriceCents: 1,
    })).toBe('incomplete');

    const response = await authInject(app, { method: 'GET', url: `/api/customers/${customer.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      productCount: 6,
      incompleteProductCount: 5,
    });
  });

  it.each([
    ['%', '百分号%客户'],
    ['_', '下划线_客户'],
    ['\\', '反斜杠\\客户'],
  ])('搜索将 %s 作为字面量而不是 LIKE 通配符', async (query, expectedName) => {
    const { app } = await testApp();
    await createCustomer(app, '百分号%客户');
    await createCustomer(app, '下划线_客户');
    await createCustomer(app, '反斜杠\\客户');
    await createCustomer(app, '普通客户');

    const response = await authInject(app, {
      method: 'GET',
      url: `/api/customers?${new URLSearchParams({ q: query })}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items.map((customer: { name: string }) => customer.name)).toEqual([expectedName]);
  });

  it.each([
    '/api/customers?q=张三&q=李四',
    '/api/customers?includeInactive=1&includeInactive=0',
  ])('重复查询参数返回 400 VALIDATION_ERROR：%s', async (url) => {
    const { app } = await testApp();
    const response = await authInject(app, { method: 'GET', url });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it.each([
    ['q', { q: 123 }],
    ['includeInactive', { includeInactive: { value: '1' } }],
  ])('%s 为非字符串时返回 400 VALIDATION_ERROR', async (field, query) => {
    const { app } = await customQueryApp(query);
    // customQueryApp 是未接鉴权门的裸应用，无需会话。
    const response = await app.inject({ method: 'GET', url: '/api/customers' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', field },
    });
  });

  it('可手动停用和启用客户，列表默认隐藏停用客户', async () => {
    const { app } = await testApp();
    const customer = await createCustomer(app);

    const deactivated = await authInject(app, {
      method: 'PATCH',
      url: `/api/customers/${customer.id}/status`,
      payload: { isActive: false },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().data.isActive).toBe(false);

    const activeOnly = await authInject(app, { method: 'GET', url: '/api/customers' });
    expect(activeOnly.json().data.items).toHaveLength(0);

    const all = await authInject(app, { method: 'GET', url: '/api/customers?includeInactive=1' });
    expect(all.json().data.items).toEqual([
      expect.objectContaining({ id: customer.id, isActive: false }),
    ]);

    const activated = await authInject(app, {
      method: 'PATCH',
      url: `/api/customers/${customer.id}/status`,
      payload: { isActive: true },
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().data.isActive).toBe(true);
  });

  it('没有产品或历史单据引用时物理删除客户', async () => {
    const { app, database } = await testApp();
    const customer = await createCustomer(app, '可删除客户');

    const response = await authInject(app, { method: 'DELETE', url: `/api/customers/${customer.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ mode: 'deleted', id: customer.id });
    expect(database.prepare('SELECT 1 FROM customers WHERE id = ?').get(customer.id)).toBeUndefined();
  });

  it.each(['customer_products', 'orders', 'quotations', 'sales_documents'] as const)(
    '存在 %s 引用时删除改为停用',
    async (table) => {
      const { app, database } = await testApp();
      const customer = await createCustomer(app, `${table}-客户`);
      const now = new Date().toISOString();

      if (table === 'customer_products') {
        database.prepare(
          `INSERT INTO customer_products
            (customer_id, name, specification, sku, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(customer.id, '测试产品', '规格', '', now, now);
      } else if (table === 'orders') {
        database.prepare(
          `INSERT INTO orders
            (customer_id, order_no, ordered_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(customer.id, `ORDER-${customer.id}`, '2026-08-11', now, now);
      } else if (table === 'quotations') {
        database.prepare(
          `INSERT INTO quotations
            (customer_id, number, status, quotation_date, company_snapshot_json,
             display_config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(customer.id, `QT-${customer.id}`, 'draft', '2026-08-11', '{}', '{}', now, now);
      } else {
        database.prepare(
          `INSERT INTO sales_documents
            (customer_id, number, document_status, document_date, company_snapshot_json,
             display_config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(customer.id, `SO-${customer.id}`, 'draft', '2026-08-11', '{}', '{}', now, now);
      }

      const response = await authInject(app, { method: 'DELETE', url: `/api/customers/${customer.id}` });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({
        mode: 'deactivated',
        customer: expect.objectContaining({
          id: customer.id,
          isActive: false,
        }),
      });
      expect(database.prepare('SELECT is_active FROM customers WHERE id = ?').get(customer.id))
        .toMatchObject({ is_active: 0 });
    },
  );

  it('不存在的客户在详情、编辑、状态和删除接口均返回 NOT_FOUND', async () => {
    const { app } = await testApp();
    const responses = await Promise.all([
      authInject(app, { method: 'GET', url: '/api/customers/999' }),
      authInject(app, { method: 'PUT', url: '/api/customers/999', payload: customerPayload() }),
      authInject(app, { method: 'PATCH', url: '/api/customers/999/status', payload: { isActive: false } }),
      authInject(app, { method: 'DELETE', url: '/api/customers/999' }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    }
  });
});
