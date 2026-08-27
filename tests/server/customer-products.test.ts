import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { migrateDatabase } from '../../src/server/db/migrate';
import { FileStore } from '../../src/server/files/file-store';

interface TestContext {
  app: FastifyInstance;
  database: DatabaseSync;
}

const contexts: TestContext[] = [];
const temporaryDirectories: string[] = [];

async function testApp(fileStore?: FileStore): Promise<TestContext> {
  const database = new DatabaseSync(':memory:');
  migrateDatabase(database);
  const app = await createApp({ database, fileStore });
  const context = { app, database };
  contexts.push(context);
  return context;
}

function multipartImage(filename: string, bytes: Buffer) {
  const boundary = `----customer-product-${Date.now()}`;
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

function multipartAttachment(filename: string, bytes: Buffer) {
  const boundary = `----customer-product-attachment-${Date.now()}`;
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function createCustomer(app: FastifyInstance, name: string): Promise<Record<string, unknown>> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/customers',
    payload: {
      name,
      contactName: '',
      contactPhone: '',
      shippingInfo: '',
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as Record<string, unknown>;
}

function productInput(
  name: string,
  specification: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    name,
    specification,
    sku: '',
    packCount: null,
    finalPriceCents: null,
    ...overrides,
  };
}

async function createCustomerProduct(
  app: FastifyInstance,
  customerId: unknown,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/customers/${customerId}/products`,
    payload: input,
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as Record<string, unknown>;
}

function insertSystemProduct(database: DatabaseSync): number {
  const now = new Date().toISOString();
  const product = database.prepare(
    `INSERT INTO products
      (name, sku, specification, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('无刷电钻', 'VT-0099', '20V', now, now);
  const productId = Number(product.lastInsertRowid);
  database.prepare(
    `INSERT INTO product_packaging
      (product_id, name, inner_size, inner_weight, outer_size, outer_length, outer_width,
       outer_height, outer_weight, pack_count, sort_order, created_at, updated_at)
     VALUES (?, ?, '', 0, '', 0, 0, 0, 0, ?, ?, ?, ?)`,
  ).run(productId, '后备包装', 12, 2, now, now);
  database.prepare(
    `INSERT INTO product_packaging
      (product_id, name, inner_size, inner_weight, outer_size, outer_length, outer_width,
       outer_height, outer_weight, pack_count, sort_order, created_at, updated_at)
     VALUES (?, ?, '', 0, '', 0, 0, 0, 0, ?, ?, ?, ?)`,
  ).run(productId, '首选包装', 24, 1, now, now);
  database.prepare(
    `INSERT INTO product_images
      (product_id, relative_path, original_name, mime_type, size_bytes, created_at)
     VALUES (?, ?, ?, 'image/png', 10, ?)`,
  ).run(productId, 'products/second.png', 'second.png', now);
  database.prepare(
    `INSERT INTO product_images
      (product_id, relative_path, original_name, mime_type, size_bytes, created_at)
     VALUES (?, ?, ?, 'image/png', 10, ?)`,
  ).run(productId, 'products/third.png', 'third.png', now);
  return productId;
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async ({ app, database }) => {
    await app.close();
    database.close();
  }));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('按客户维护的产品 API', () => {
  it('只列出当前客户产品，并按搜索词和完善状态筛选', async () => {
    const { app } = await testApp();
    const zhang = await createCustomer(app, '张三');
    const li = await createCustomer(app, '李四');
    await createCustomerProduct(app, zhang.id, productInput('电钻', '20V'));
    await createCustomerProduct(app, zhang.id, productInput('角磨机', '100mm', {
      sku: 'ZS-002',
      packCount: 12,
      finalPriceCents: 19900,
    }));
    await createCustomerProduct(app, li.id, productInput('电钻', '20V', {
      sku: 'LS-001',
      packCount: 24,
      finalPriceCents: 25900,
    }));

    const incomplete = await app.inject({
      method: 'GET',
      url: `/api/customers/${zhang.id}/products?status=incomplete&q=20V`,
    });
    expect(incomplete.statusCode).toBe(200);
    expect(incomplete.json().data.items).toEqual([
      expect.objectContaining({
        customerId: zhang.id,
        name: '电钻',
        completionStatus: 'incomplete',
      }),
    ]);

    const complete = await app.inject({
      method: 'GET',
      url: `/api/customers/${zhang.id}/products?status=complete&q=ZS-002`,
    });
    expect(complete.json().data.items).toEqual([
      expect.objectContaining({ name: '角磨机', completionStatus: 'complete' }),
    ]);
  });

  it('保存客户产品运费/箱并在更新后保留', async () => {
    const { app } = await testApp();
    const customer = await createCustomer(app, '运费客户');
    const created = await createCustomerProduct(app, customer.id, productInput('运费产品', '标准', { freightPerBoxCents: 1250 }));
    expect(created.freightPerBoxCents).toBe(1250);
    const updated = await app.inject({ method: 'PUT', url: `/api/customer-products/${created.id}`, payload: productInput('运费产品', '标准', { freightPerBoxCents: 800 }) });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.freightPerBoxCents).toBe(800);
  });

  it('同品名不同规格可共存，临时产品规范化后重复会被拒绝', async () => {
    const { app } = await testApp();
    const customer = await createCustomer(app, '张三');

    expect((await app.inject({
      method: 'POST',
      url: `/api/customers/${customer.id}/products`,
      payload: productInput('电钻', '12V'),
    })).statusCode).toBe(201);
    expect((await app.inject({
      method: 'POST',
      url: `/api/customers/${customer.id}/products`,
      payload: productInput('电钻', '20V'),
    })).statusCode).toBe(201);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/customers/${customer.id}/products`,
      payload: productInput(' 电钻 ', ' 20V '),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('CUSTOMER_PRODUCT_EXISTS');
  });

  it('每个客户只能导入同一系统产品一次，并复制产品快照后允许编辑客户字段', async () => {
    const { app, database } = await testApp();
    const customer = await createCustomer(app, '张三');
    const otherCustomer = await createCustomer(app, '李四');
    const systemProductId = insertSystemProduct(database);

    const first = await app.inject({
      method: 'POST',
      url: `/api/customers/${customer.id}/products/from-library`,
      payload: { systemProductId },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({
      customerId: customer.id,
      systemProductId,
      name: '无刷电钻',
      specification: '20V',
      sku: 'VT-0099',
      packCount: 24,
      finalPriceCents: null,
      freightPerBoxCents: null,
      imageRelativePath: 'products/second.png',
      costPriceCents: null,
      completionStatus: 'incomplete',
    });
    expect(first.json().data.packaging).toHaveLength(2);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/customers/${customer.id}/products/from-library`,
      payload: { systemProductId },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('CUSTOMER_PRODUCT_EXISTS');
    expect((await app.inject({
      method: 'POST',
      url: `/api/customers/${otherCustomer.id}/products/from-library`,
      payload: { systemProductId },
    })).statusCode).toBe(201);

    const edited = await app.inject({
      method: 'PUT',
      url: `/api/customer-products/${first.json().data.id}`,
      payload: productInput('张三专用电钻', '20V', {
        sku: 'ZS-001',
        packCount: 24,
        finalPriceCents: 25900,
        systemProductId: 999,
      }),
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data).toMatchObject({
      systemProductId,
      name: '张三专用电钻',
      sku: 'ZS-001',
      completionStatus: 'complete',
    });
  });

  it('优先返回客户产品图片快照，快照为空时回退到系统产品第一张图片', async () => {
    const { app, database } = await testApp();
    const customer = await createCustomer(app, '张三');
    const systemProductId = insertSystemProduct(database);
    const now = new Date().toISOString();
    const fallbackId = Number(database.prepare(
      `INSERT INTO customer_products
        (customer_id, system_product_id, name, specification, sku, image_relative_path,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '', ?, ?)`,
    ).run(customer.id, systemProductId, '回退图片产品', '20V', now, now).lastInsertRowid);
    const snapshotId = Number(database.prepare(
      `INSERT INTO customer_products
        (customer_id, name, specification, sku, image_relative_path, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, ?)`,
    ).run(customer.id, '快照图片产品', '18V', 'customers/snapshot.png', now, now).lastInsertRowid);

    const fallback = await app.inject({ method: 'GET', url: `/api/customer-products/${fallbackId}` });
    expect(fallback.json().data.imageRelativePath).toBe('products/second.png');
    const snapshot = await app.inject({ method: 'GET', url: `/api/customer-products/${snapshotId}` });
    expect(snapshot.json().data.imageRelativePath).toBe('customers/snapshot.png');
  });

  it('校验输入、筛选状态和资源 ID，并拒绝在普通新增中指定系统产品', async () => {
    const { app } = await testApp();
    const customer = await createCustomer(app, '张三');
    const cases = [
      [productInput(' ', ''), 'name'],
      [productInput('产品', '', { packCount: 0 }), 'packCount'],
      [productInput('产品', '', { packCount: 1.5 }), 'packCount'],
      [productInput('产品', '', { finalPriceCents: -1 }), 'finalPriceCents'],
      [productInput('产品', '', { finalPriceCents: 1.5 }), 'finalPriceCents'],
      [productInput('产品', '', { costPriceCents: -1 }), 'costPriceCents'],
      [productInput('产品', '', { packaging: [{ name: '外箱', innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 0, packCount: 0 }] }), 'packaging'],
      [productInput('产品', '', { systemProductId: 1 }), 'systemProductId'],
    ] as const;
    for (const [payload, field] of cases) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/customers/${customer.id}/products`,
        payload,
      });
      expect(response.statusCode, field).toBe(400);
      expect(response.json().error).toMatchObject({ code: 'VALIDATION_ERROR', field });
    }

    expect((await app.inject({
      method: 'GET',
      url: `/api/customers/${customer.id}/products?status=unknown`,
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST',
      url: `/api/customers/${customer.id}/products/from-library`,
      payload: { systemProductId: 0 },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'GET',
      url: '/api/customers/999/products',
    })).statusCode).toBe(404);
  });

  it('临时客户产品可维护成本价和完整包装快照', async () => {
    const { app } = await testApp();
    const customer = await createCustomer(app, '张三');
    const created = await createCustomerProduct(app, customer.id, productInput('临时产品', '标准', {
      costPriceCents: 1234,
      packaging: [{ name: '彩盒', innerSize: '20x10x8', innerWeight: 1.2, outerSize: '42x32x28', outerWeight: 8, packCount: 24 }],
    }));
    expect(created).toMatchObject({ costPriceCents: 1234, packaging: [expect.objectContaining({ name: '彩盒', packCount: 24 })] });
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/customer-products/${created.id}`,
      payload: productInput('临时产品', '标准', { costPriceCents: 1500, packaging: [{ name: '木箱', innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 9, packCount: 12 }] }),
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ costPriceCents: 1500, packaging: [expect.objectContaining({ name: '木箱', packCount: 12 })] });
  });

  it('客户产品备注可保存，附件可上传、读取和删除', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-customer-product-attachments-'));
    temporaryDirectories.push(directory);
    const fileStore = new FileStore(join(directory, 'files'));
    const { app } = await testApp(fileStore);
    const customer = await createCustomer(app, '张三');
    const created = await createCustomerProduct(app, customer.id, productInput('专用产品', '标准', {
      remark: '客户指定蓝色包装，出货前拍照确认',
    }));
    expect(created).toMatchObject({
      remark: '客户指定蓝色包装，出货前拍照确认',
      attachments: [],
    });

    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/customer-products/${created.id}/attachments`,
      ...multipartAttachment('客户包装说明.pdf', Buffer.from('customer attachment')),
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().data).toMatchObject({
      customerProductId: created.id,
      originalName: '客户包装说明.pdf',
      mimeType: 'application/pdf',
      url: expect.stringMatching(/^\/files\/customer-product-attachments\//),
    });
    const relativePath = uploaded.json().data.relativePath as string;
    expect(relativePath).toMatch(/^customer-product-attachments\//);
    await expect(fileStore.readFile(relativePath)).resolves.toEqual(Buffer.from('customer attachment'));

    const fetched = await app.inject({ method: 'GET', url: `/api/customer-products/${created.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().data).toMatchObject({
      remark: '客户指定蓝色包装，出货前拍照确认',
      attachments: [expect.objectContaining({ originalName: '客户包装说明.pdf', relativePath })],
    });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/customer-products/${created.id}`,
      payload: productInput('专用产品', '标准', { remark: '客户指定红色包装' }),
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.remark).toBe('客户指定红色包装');

    const attachmentId = uploaded.json().data.id as number;
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/customer-products/${created.id}/attachments/${attachmentId}`,
    });
    expect(deleted.statusCode).toBe(200);
    await expect(fileStore.readFile(relativePath)).rejects.toThrow();
    expect((await app.inject({ method: 'GET', url: `/api/customer-products/${created.id}` })).json().data.attachments).toEqual([]);
  });

  it('客户产品图片可上传、替换和清空，并且不会删除系统产品图片', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-customer-products-'));
    temporaryDirectories.push(directory);
    const fileStore = new FileStore(join(directory, 'files'));
    const { app, database } = await testApp(fileStore);
    const customer = await createCustomer(app, '张三');
    const systemProductId = insertSystemProduct(database);
    const imported = await app.inject({
      method: 'POST',
      url: `/api/customers/${customer.id}/products/from-library`,
      payload: { systemProductId },
    });
    const customerProductId = imported.json().data.id as number;
    await mkdir(join(directory, 'files', 'products'), { recursive: true });
    await writeFile(join(directory, 'files', 'products', 'second.png'), Buffer.from('system'));

    const first = await app.inject({
      method: 'POST',
      url: `/api/customer-products/${customerProductId}/images`,
      ...multipartImage('first.png', Buffer.from('first')),
    });
    expect(first.statusCode).toBe(201);
    const firstPath = first.json().data.imageRelativePath as string;
    expect(firstPath).toMatch(/^customer-product-images\//);
    await expect(fileStore.readFile(firstPath)).resolves.toEqual(Buffer.from('first'));

    const second = await app.inject({
      method: 'POST',
      url: `/api/customer-products/${customerProductId}/images`,
      ...multipartImage('second.png', Buffer.from('second')),
    });
    expect(second.statusCode).toBe(201);
    const secondPath = second.json().data.imageRelativePath as string;
    await expect(fileStore.readFile(firstPath)).rejects.toThrow();
    await expect(fileStore.readFile(secondPath)).resolves.toEqual(Buffer.from('second'));

    const cleared = await app.inject({
      method: 'PUT',
      url: `/api/customer-products/${customerProductId}`,
      payload: productInput('无刷电钻', '20V', { imageRelativePath: null }),
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data.imageRelativePath).toBe('products/second.png');
    await expect(fileStore.readFile(secondPath)).rejects.toThrow();
    await expect(readFile(join(directory, 'files', 'products', 'second.png'))).resolves.toEqual(Buffer.from('system'));

    const temporary = await createCustomerProduct(app, customer.id, productInput('临时图片产品', '标准'));
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/customer-products/${temporary.id}/images`,
      ...multipartImage('temporary.png', Buffer.from('temporary')),
    });
    const temporaryPath = uploaded.json().data.imageRelativePath as string;
    await app.inject({ method: 'DELETE', url: `/api/customer-products/${temporary.id}` });
    await expect(fileStore.readFile(temporaryPath)).rejects.toThrow();
  });

  it('详情和更新返回 NOT_FOUND，临时产品更新也执行重复校验', async () => {
    const { app } = await testApp();
    const customer = await createCustomer(app, '张三');
    const first = await createCustomerProduct(app, customer.id, productInput('电钻', '12V'));
    const second = await createCustomerProduct(app, customer.id, productInput('电钻', '20V'));

    const fetched = await app.inject({ method: 'GET', url: `/api/customer-products/${first.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().data).toMatchObject({ id: first.id, customerId: customer.id });

    const duplicate = await app.inject({
      method: 'PUT',
      url: `/api/customer-products/${second.id}`,
      payload: productInput(' 电钻 ', ' 12V '),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('CUSTOMER_PRODUCT_EXISTS');

    expect((await app.inject({ method: 'GET', url: '/api/customer-products/999' })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'PUT',
      url: '/api/customer-products/999',
      payload: productInput('不存在', ''),
    })).statusCode).toBe(404);
  });

  it('批量删除先验证全部归属，跨客户或不存在时不进行部分删除', async () => {
    const { app } = await testApp();
    const zhang = await createCustomer(app, '张三');
    const li = await createCustomer(app, '李四');
    const first = await createCustomerProduct(app, zhang.id, productInput('电钻', '12V'));
    const second = await createCustomerProduct(app, zhang.id, productInput('电钻', '20V'));
    const foreign = await createCustomerProduct(app, li.id, productInput('角磨机', '100mm'));

    for (const ids of [[first.id, foreign.id], [first.id, 999]]) {
      const rejected = await app.inject({
        method: 'POST',
        url: `/api/customers/${zhang.id}/products/batch-delete`,
        payload: { ids },
      });
      expect(rejected.statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/customer-products/${first.id}` })).statusCode).toBe(200);
    }

    const deleted = await app.inject({
      method: 'POST',
      url: `/api/customers/${zhang.id}/products/batch-delete`,
      payload: { ids: [first.id, second.id] },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data).toEqual({ deletedCount: 2 });
    expect((await app.inject({ method: 'GET', url: `/api/customer-products/${first.id}` })).statusCode).toBe(404);
  });

  it('删除客户产品只解除目录关联，不删除系统产品或订单历史快照', async () => {
    const { app, database } = await testApp();
    const customer = await createCustomer(app, '张三');
    const systemProductId = insertSystemProduct(database);
    const imported = await app.inject({
      method: 'POST',
      url: `/api/customers/${customer.id}/products/from-library`,
      payload: { systemProductId },
    });
    const customerProductId = imported.json().data.id;
    const now = new Date().toISOString();
    const orderId = Number(database.prepare(
      `INSERT INTO orders
        (customer_id, order_no, ordered_at, customer_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(customer.id, 'ORDER-SNAPSHOT-1', '2026-08-11', '张三', now, now).lastInsertRowid);
    const orderItemId = Number(database.prepare(
      `INSERT INTO order_items
        (order_id, customer_product_id, name, sku, specification, pack_count, quantity, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(orderId, customerProductId, '历史电钻', 'OLD-SKU', '旧规格', 10, 2, now, now).lastInsertRowid);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/customer-products/${customerProductId}` });
    expect(deleted.statusCode).toBe(200);
    expect(database.prepare('SELECT id FROM products WHERE id = ?').get(systemProductId)).toBeDefined();
    expect(database.prepare(
      'SELECT customer_product_id, name, sku, specification, pack_count FROM order_items WHERE id = ?',
    ).get(orderItemId)).toEqual({
      customer_product_id: null,
      name: '历史电钻',
      sku: 'OLD-SKU',
      specification: '旧规格',
      pack_count: 10,
    });
  });

  it('不再暴露旧的全局客户产品列表和新增接口', async () => {
    const { app } = await testApp();
    expect((await app.inject({ method: 'GET', url: '/api/customer-products' })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'POST',
      url: '/api/customer-products',
      payload: productInput('旧接口产品', ''),
    })).statusCode).toBe(404);
  });
});

describe('批量创建客户产品', () => {
  it('清单逐行创建产品，品名/规格/SKU 按行生效，其余资料与包装共享', async () => {
    const { app } = await testApp();
    const customer = await createCustomer(app, '批量客户');
    const response = await app.inject({
      method: 'POST',
      url: `/api/customers/${customer.id}/products/batch`,
      payload: {
        items: [
          { name: '迷你风扇-白色', specification: 'USB款', sku: 'WS-01' },
          { name: ' 迷你风扇-黑色 ', specification: '', sku: '' },
          { name: '迷你风扇-白色', specification: 'USB款' },
        ],
        packCount: 24,
        finalPriceCents: 25900,
        costPriceCents: 15000,
        freightPerBoxCents: 800,
        remark: '彩盒包装',
        packaging: [
          { id: 'pack-1', name: '彩盒', innerSize: '10x8x5', innerWeight: 120, outerSize: '50x40x30', outerWeight: 5200, packCount: 24 },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    const items = response.json().data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: '迷你风扇-白色',
      specification: 'USB款',
      sku: 'WS-01',
      customerId: customer.id,
      systemProductId: null,
      packCount: 24,
      finalPriceCents: 25900,
      costPriceCents: 15000,
      freightPerBoxCents: 800,
      remark: '彩盒包装',
      completionStatus: 'complete',
    });
    expect(items[1]).toMatchObject({
      name: '迷你风扇-黑色',
      specification: '',
      sku: '',
      completionStatus: 'incomplete',
    });
    for (const item of items) {
      expect(item.packaging).toEqual([expect.objectContaining({ name: '彩盒', packCount: 24 })]);
    }
    expect(items[0].id).not.toBe(items[1].id);

    const list = await app.inject({ method: 'GET', url: `/api/customers/${customer.id}/products` });
    expect(list.json().data.items).toHaveLength(2);
  });

  it('任一行与既有产品重名时整体拒绝，不落库', async () => {
    const { app } = await testApp();
    const customer = await createCustomer(app, '查重客户');
    await createCustomerProduct(app, customer.id, productInput('电钻', '20V'));
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/customers/${customer.id}/products/batch`,
      payload: {
        items: [
          { name: '新品A', specification: '' },
          { name: '电钻', specification: '20V' },
        ],
        packCount: null,
        finalPriceCents: null,
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('CUSTOMER_PRODUCT_EXISTS');
    expect(duplicate.json().error.message).toContain('电钻');

    const list = await app.inject({ method: 'GET', url: `/api/customers/${customer.id}/products` });
    expect(list.json().data.items).toHaveLength(1);
  });

  it('空清单、缺失品名的行、超上限和停用客户均被拒绝', async () => {
    const { app } = await testApp();
    const customer = await createCustomer(app, '边界客户');
    const url = `/api/customers/${customer.id}/products/batch`;

    const empty = await app.inject({ method: 'POST', url, payload: { items: [], packCount: null, finalPriceCents: null } });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'items' });

    const missingName = await app.inject({
      method: 'POST',
      url,
      payload: { items: [{ name: '新品A' }, { specification: '没有品名' }], packCount: null, finalPriceCents: null },
    });
    expect(missingName.statusCode).toBe(400);
    expect(missingName.json().error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'items' });
    expect(missingName.json().error.message).toContain('第 2 行');

    const tooMany = await app.inject({
      method: 'POST',
      url,
      payload: {
        items: Array.from({ length: 51 }, (_, index) => ({ name: `产品${index + 1}` })),
        packCount: null,
        finalPriceCents: null,
      },
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.field).toBe('items');

    await app.inject({ method: 'PATCH', url: `/api/customers/${customer.id}/status`, payload: { isActive: false } });
    const inactive = await app.inject({ method: 'POST', url, payload: { items: [{ name: '新品' }], packCount: null, finalPriceCents: null } });
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json().error.code).toBe('CUSTOMER_INACTIVE');
  });
});
