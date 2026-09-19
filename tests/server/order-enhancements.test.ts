import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';
import { OrderNumberService, orderDateKey } from '../../src/server/services/order-number-service';
import { registerOrderRoutes } from '../../src/server/routes/orders';
import { registerLabelRoutes } from '../../src/server/routes/labels';
import { registerCustomerProductRoutes } from '../../src/server/routes/customer-products';
import { CustomerProductRepository } from '../../src/server/db/customer-product-repository';
import { CustomerRepository } from '../../src/server/db/customer-repository';
import { CustomerProductService } from '../../src/server/services/customer-product-service';
import { FileStore } from '../../src/server/files/file-store';

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeContext() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-order-enhancements-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const repositories = new DatabaseRepositories(database);
  const customerRepository = new CustomerRepository(database);
  const customerProductRepository = new CustomerProductRepository(database);
  const fileStore = new FileStore(join(directory, 'files'));
  const app = Fastify();
  await app.register(multipart, { limits: { files: 5, fileSize: 20 * 1024 * 1024 } });
  await registerOrderRoutes(app, { repositories, customerRepository, customerProductRepository, fileStore });
  await registerLabelRoutes(app, { repositories });
  await registerCustomerProductRoutes(app, {
    service: new CustomerProductService(
      customerProductRepository,
      customerRepository,
    ),
  });
  apps.push(app);
  return { database, repositories, customerRepository, customerProductRepository, fileStore, app };
}

function multipartFile(filename: string, bytes: Buffer, mimeType = 'image/png') {
  const boundary = `----workbench-order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

function multipartImage(filename: string, bytes: Buffer) {
  return multipartFile(filename, bytes);
}

function insertCustomer(database: ReturnType<typeof openDatabase>, name: string, isActive = true): number {
  const now = new Date().toISOString();
  return Number(database.prepare(
    `INSERT INTO customers
      (name, contact_name, contact_phone, shipping_info, is_active, created_at, updated_at)
     VALUES (?, '', '', '', ?, ?, ?)`,
  ).run(name, isActive ? 1 : 0, now, now).lastInsertRowid);
}

function orderInput(overrides: Record<string, unknown> = {}) {
  return {
    orderNo: '',
    orderedAt: '2026-08-10T08:00:00.000Z',
    recipientName: '张三',
    recipientInfo: '深圳市宝安区',
    amount: 100,
    trackingNo: '',
    paymentNote: '',
    remark: '',
    items: [{
      name: '测试产品',
      sku: 'VT-0001',
      specification: '标准规格',
      packagingName: '彩盒包装',
      packCount: 10,
      quantity: 10,
    }],
    ...overrides,
  };
}

describe('订单号基础设施', () => {
  it('按 Asia/Shanghai 日期生成 SOYYYYMMDD001，并在同一天递增', async () => {
    const { database } = await makeContext();
    const numbers = new OrderNumberService(database);
    const firstMoment = new Date('2026-08-09T16:00:00.000Z');
    const secondMoment = new Date('2026-08-10T15:59:00.000Z');

    expect(orderDateKey(firstMoment)).toBe('20260810');
    expect(numbers.preview(firstMoment)).toBe('SO20260810001');
    expect(numbers.next(firstMoment)).toBe('SO20260810001');
    expect(numbers.next(secondMoment)).toBe('SO20260810002');
    database.close();
  });

  it('初始化默认来源微信和1688（order_source_types 表保留用于旧数据兼容）', async () => {
    const { database } = await makeContext();

    const names = database.prepare('SELECT name FROM order_source_types WHERE is_active = 1 ORDER BY id').all()
      .map((row) => String((row as { name: unknown }).name));
    expect(names).toEqual(['微信', '1688']);
    database.close();
  });

  it('新建订单空订单号由服务端生成，预览不消耗流水，手动订单号必须唯一', async () => {
    const { app, database } = await makeContext();
    const date = orderDateKey(new Date());

    const previewBefore = await app.inject({ method: 'GET', url: '/api/orders/next-number' });
    expect(previewBefore.statusCode).toBe(200);
    expect(previewBefore.json().data.number).toBe(`SO${date}001`);

    const automatic = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput() });
    expect(automatic.statusCode).toBe(201);
    expect(automatic.json().data.order_no).toBe(`SO${date}001`);
    expect(automatic.json().data.ordered_at).toBe('2026-08-10');

    const previewAfter = await app.inject({ method: 'GET', url: '/api/orders/next-number' });
    expect(previewAfter.json().data.number).toBe(`SO${date}002`);
    const secondAutomatic = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput() });
    expect(secondAutomatic.json().data.order_no).toBe(`SO${date}002`);

    const manual = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({ orderNo: '客户自定义-001' }),
    });
    expect(manual.statusCode).toBe(201);
    expect(manual.json().data.order_no).toBe('客户自定义-001');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({ orderNo: '客户自定义-001' }),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('ORDER_NO_EXISTS');

    const sequence = database.prepare('SELECT last_value FROM order_number_sequences WHERE sequence_date = ?').get(date);
    expect(sequence?.last_value).toBe(2);
    database.close();
  });

  it('订单结算方式支持对公/对私，默认对公并可随订单更新', async () => {
    const { app, database } = await makeContext();

    const personal = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({ settlementType: 'personal' }) });
    expect(personal.statusCode).toBe(201);
    expect(personal.json().data.settlement_type).toBe('personal');
    const personalId = Number(personal.json().data.id);
    const personalOrderNo = String(personal.json().data.order_no);

    const corporate = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput() });
    expect(corporate.statusCode).toBe(201);
    expect(corporate.json().data.settlement_type).toBe('corporate');

    const invalid = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({ settlementType: 'unknown' }) });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', field: 'settlementType' },
    });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/orders/${personalId}`,
      payload: orderInput({ orderNo: personalOrderNo, settlementType: 'corporate' }),
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.settlement_type).toBe('corporate');
    database.close();
  });

  it('旧待打印箱唛订单点击进入备货后可正常推进', async () => {
    const { app, database } = await makeContext();
    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput() });
    const orderId = Number(created.json().data.id);
    database.prepare("UPDATE orders SET status = 'label_pending' WHERE id = ?").run(orderId);
    const advanced = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to: 'pending_stock', reason: 'manual' } });
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json().data.status).toBe('pending_stock');
    database.close();
  });

  it('新建订单直接进入待备货，打印箱唛只记录提醒不改变状态', async () => {
    const { app, database } = await makeContext();
    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput() });
    expect(created.statusCode).toBe(201);
    const orderId = Number(created.json().data.id);
    expect(created.json().data.status).toBe('pending_stock');

    const labels = await app.inject({ method: 'GET', url: `/api/orders/${orderId}/labels` });
    expect(labels.statusCode).toBe(200);
    const labelId = Number(labels.json().data.labels[0].id);
    const printed = await app.inject({
      method: 'POST',
      url: '/api/labels/print-history',
      payload: { orderIds: [orderId], labels: [{ orderId, id: labelId }], actionType: 'print' },
    });
    expect(printed.statusCode).toBe(201);
    expect(database.prepare('SELECT status, label_printed_at FROM orders WHERE id = ?').get(orderId)).toMatchObject({ status: 'pending_stock' });
    expect(database.prepare('SELECT label_printed_at FROM orders WHERE id = ?').get(orderId)?.label_printed_at).toEqual(expect.any(String));
    const repeated = await app.inject({
      method: 'POST',
      url: '/api/labels/print-history',
      payload: { orderIds: [orderId], labels: [{ orderId, id: labelId }], actionType: 'first-print' },
    });
    expect(repeated.statusCode).toBe(201);
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(orderId)?.status).toBe('pending_stock');
    database.close();
  });

  it('编辑订单必须传入非空订单号，并允许手动修改订单号', async () => {
    const { app, database } = await makeContext();
    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput() });
    const orderId = created.json().data.id;

    const emptyUpdate = await app.inject({
      method: 'PUT',
      url: `/api/orders/${orderId}`,
      payload: orderInput({ orderNo: '' }),
    });
    expect(emptyUpdate.statusCode).toBe(400);
    expect(emptyUpdate.json().error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'orderNo' });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/orders/${orderId}`,
      payload: orderInput({ orderNo: '手动修改-001' }),
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.order_no).toBe('手动修改-001');
    database.close();
  });

  it('客户产品按客户维护四个核心字段，并支持清空待完善字段', async () => {
    const { app, database } = await makeContext();
    const now = new Date().toISOString();
    const customerId = Number(database.prepare(
      `INSERT INTO customers
        (name, contact_name, contact_phone, shipping_info, created_at, updated_at)
       VALUES (?, '', '', '', ?, ?)`,
    ).run('张三', now, now).lastInsertRowid);

    const created = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/products`,
      payload: {
        name: '客户产品', sku: 'C-001', specification: '大号', packCount: 24, finalPriceCents: 1000,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      customerId,
      name: '客户产品',
      sku: 'C-001',
      specification: '大号',
      packCount: 24,
      finalPriceCents: 1000,
      completionStatus: 'complete',
    });

    const productId = created.json().data.id;
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/customer-products/${productId}`,
      payload: {
        name: '客户产品改名', sku: '', specification: '大号', packCount: null, finalPriceCents: null,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({
      name: '客户产品改名',
      sku: '',
      packCount: null,
      finalPriceCents: null,
      completionStatus: 'incomplete',
    });
    database.close();
  });

  it('按当前客户带入客户产品快照、单价和订单行金额', async () => {
    const { app, database } = await makeContext();
    const customerId = insertCustomer(database, '张三');
    const product = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/products`,
      payload: {
        name: '无刷电钻', sku: 'ZS-001', specification: '20V', packCount: 24, finalPriceCents: 25_900,
      },
    });
    const customerProductId = product.json().data.id;

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({
        customerId,
        customerName: '',
        customerShippingInfo: '',
        amountCents: 51_800,
        items: [{
          customerProductId,
          name: '',
          sku: '',
          specification: '',
          packagingName: '彩盒包装',
          packCount: undefined,
          quantity: 2,
          unitPriceCents: undefined,
        }],
      }),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      customer_id: customerId,
      customer_name: '张三',
      amount_cents: 51_800,
    });
    expect(response.json().data.items[0]).toMatchObject({
      customer_product_id: customerProductId,
      name: '无刷电钻',
      sku: 'ZS-001',
      specification: '20V',
      pack_count: 24,
      unit_price_cents: 25_900,
      amount_cents: 51_800,
    });
    database.close();
  });

  it('新建订单时复制客户产品的定制要求和分类附件，并保留订单快照', async () => {
    const { app, database, fileStore } = await makeContext();
    const customerId = insertCustomer(database, '资料客户');
    const product = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/products`,
      payload: {
        name: '资料产品',
        sku: 'DOC-001',
        specification: '标准',
        packCount: 12,
        finalPriceCents: 3300,
        remark: '标贴：外箱右上角贴客户标贴；说明书：每箱放一份中文版说明书；打包：每 12 个装一箱，使用客户彩盒',
      },
    });
    expect(product.statusCode).toBe(201);
    const customerProductId = Number(product.json().data.id);
    const now = new Date().toISOString();
    const sourcePath = 'customer-product-attachments/customer-label.pdf';
    const absoluteSourcePath = fileStore.resolvePublicPath(sourcePath);
    await mkdir(dirname(absoluteSourcePath), { recursive: true });
    await writeFile(absoluteSourcePath, Buffer.from('customer label file'));
    database.prepare(`
      INSERT INTO customer_product_attachments
        (customer_product_id, category, relative_path, original_name, mime_type, size_bytes, created_at)
      VALUES (?, 'label', ?, '客户标贴.pdf', 'application/pdf', ?, ?)
    `).run(customerProductId, sourcePath, Buffer.byteLength('customer label file'), now);

    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({
        customerId,
        items: [{
          customerProductId,
          name: '',
          sku: '',
          specification: '',
          quantity: 12,
          unitPriceCents: undefined,
        }],
      }),
    });
    expect(created.statusCode).toBe(201);
    const orderId = Number(created.json().data.id);
    expect(created.json().data.items[0]).toMatchObject({
      remark: '标贴：外箱右上角贴客户标贴；说明书：每箱放一份中文版说明书；打包：每 12 个装一箱，使用客户彩盒',
    });
    expect(created.json().data.contracts).toEqual([expect.objectContaining({ category: 'label', original_name: '客户标贴.pdf', relative_path: expect.stringMatching(/^order-item-requirements\//) })]);
    const copiedPath = String(created.json().data.contracts[0].relative_path);
    expect(copiedPath).toMatch(/^order-item-requirements\//);
    await expect(fileStore.readFile(copiedPath)).resolves.toEqual(Buffer.from('customer label file'));

    const detail = await app.inject({ method: 'GET', url: `/api/orders/${orderId}/detail` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.items[0].remark).toBe('标贴：外箱右上角贴客户标贴；说明书：每箱放一份中文版说明书；打包：每 12 个装一箱，使用客户彩盒');
    expect(detail.json().data.contracts).toEqual([expect.objectContaining({ category: 'label', relativePath: copiedPath })]);

    const changedProduct = await app.inject({
      method: 'PUT',
      url: `/api/customer-products/${customerProductId}`,
      payload: {
        name: '资料产品', sku: 'DOC-001', specification: '标准', packCount: 12, finalPriceCents: 3300,
        remark: '改为左下角贴标',
      },
    });
    expect(changedProduct.statusCode).toBe(200);
    const unchangedOrder = await app.inject({ method: 'GET', url: `/api/orders/${orderId}/detail` });
    expect(unchangedOrder.json().data.items[0].remark).toBe('标贴：外箱右上角贴客户标贴；说明书：每箱放一份中文版说明书；打包：每 12 个装一箱，使用客户彩盒');

    const deleted = await app.inject({ method: 'DELETE', url: `/api/orders/${orderId}` });
    expect(deleted.statusCode).toBe(200);
    await expect(fileStore.readFile(copiedPath)).rejects.toThrow();
    database.close();
  });

  it('订单金额由订单产品数量和单价自动汇总，不采用手工总额', async () => {
    const { app, database } = await makeContext();
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({
        amount: 1,
        amountCents: 100,
        items: [
          { name: '产品一', sku: 'A-001', specification: '标准', quantity: 2, packCount: 10, unitPriceCents: 1299 },
          { name: '产品二', sku: 'A-002', specification: '大号', quantity: 3, packCount: 10, unitPriceCents: 2500 },
        ],
      }),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ amount: 100.98, amount_cents: 10098 });
    expect(response.json().data.items.map((item: { amount_cents: number }) => item.amount_cents)).toEqual([2598, 7500]);
    database.close();
  });

  it('订单金额 = 产品金额 + 运费，运费可修改并拒绝负数', async () => {
    const { app, database } = await makeContext();
    const items = [{ name: '产品一', sku: 'A-001', specification: '标准', quantity: 2, packCount: 10, unitPriceCents: 1299 }];
    const create = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({ shippingCents: 1500, items }),
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().data).toMatchObject({ amount: 40.98, amount_cents: 4098, shipping_cents: 1500 });

    const orderId = create.json().data.id;
    const update = await app.inject({
      method: 'PUT',
      url: `/api/orders/${orderId}`,
      payload: orderInput({ orderNo: create.json().data.order_no, shippingCents: 0, items }),
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data).toMatchObject({ amount: 25.98, amount_cents: 2598, shipping_cents: 0 });

    const negative = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({ shippingCents: -1 }),
    });
    expect(negative.statusCode).toBe(400);
    database.close();
  });

  it('拒绝跨客户客户产品、不存在客户和停用客户新建订单', async () => {
    const { app, database } = await makeContext();
    const zhangId = insertCustomer(database, '张三');
    const liId = insertCustomer(database, '李四');
    const inactiveId = insertCustomer(database, '停用客户', false);
    const product = await app.inject({
      method: 'POST',
      url: `/api/customers/${liId}/products`,
      payload: { name: '李四产品', sku: 'LI-001', specification: '标准', packCount: 10, finalPriceCents: 1000 },
    });
    const customerProductId = product.json().data.id;

    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({ customerId: zhangId, items: [{ ...orderInput().items[0], customerProductId }] }),
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe('CUSTOMER_PRODUCT_CUSTOMER_MISMATCH');

    const missingCustomer = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({ customerId: 999999 }),
    });
    expect(missingCustomer.statusCode).toBe(404);
    expect(missingCustomer.json().error.code).toBe('CUSTOMER_NOT_FOUND');

    const inactive = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({ customerId: inactiveId }),
    });
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json().error.code).toBe('CUSTOMER_INACTIVE');
    database.close();
  });

  it('订单日期只保存 YYYY-MM-DD，兼容历史 ISO，并严格拒绝非法公历日期', async () => {
    const { app, database } = await makeContext();

    const dateOnly = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({ orderedAt: '2024-02-29' }) });
    expect(dateOnly.statusCode).toBe(201);
    expect(dateOnly.json().data.ordered_at).toBe('2024-02-29');

    const edited = await app.inject({
      method: 'PUT',
      url: `/api/orders/${dateOnly.json().data.id}`,
      payload: orderInput({ orderNo: '历史编辑', orderedAt: '2026-08-10T08:00:00.000Z' }),
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data.ordered_at).toBe('2026-08-10');

    for (const orderedAt of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-02-30T08:00:00.000Z', '2026-8-1']) {
      const response = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({ orderedAt }) });
      expect(response.statusCode, orderedAt).toBe(400);
    }
    database.close();
  });

  it('保存订单详情文字和图片，并在删除订单时级联清理详情图片', async () => {
    const { app, database, fileStore } = await makeContext();
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({ orderDetail: '蓝色，外箱贴易碎标识' }),
    });
    expect(created.statusCode).toBe(201);
    const orderId = Number(created.json().data.id);
    expect(created.json().data.order_detail).toBe('蓝色，外箱贴易碎标识');

    const firstUpload = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/detail-images`,
      ...multipartImage('detail-one.png', Buffer.from('detail-one')),
    });
    expect(firstUpload.statusCode).toBe(201);
    const firstImage = firstUpload.json().data;
    expect(firstImage.relativePath).toMatch(/^order-detail-images\/[0-9a-f-]+\.png$/);
    expect(await fileStore.readFile(firstImage.relativePath)).toEqual(Buffer.from('detail-one'));

    const secondUpload = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/detail-images`,
      ...multipartImage('detail-two.png', Buffer.from('detail-two')),
    });
    expect(secondUpload.statusCode).toBe(201);
    const secondImage = secondUpload.json().data;

    const detail = await app.inject({ method: 'GET', url: `/api/orders/${orderId}/detail` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.orderDetailImages).toHaveLength(2);

    const removedImage = await app.inject({ method: 'DELETE', url: `/api/order-detail-images/${firstImage.id}` });
    expect(removedImage.statusCode).toBe(200);
    await expect(fileStore.readFile(firstImage.relativePath)).rejects.toThrow();

    const removedOrder = await app.inject({ method: 'DELETE', url: `/api/orders/${orderId}` });
    expect(removedOrder.statusCode).toBe(200);
    expect((database.prepare('SELECT COUNT(*) AS count FROM order_detail_images WHERE order_id = ?').get(orderId) as { count: number }).count).toBe(0);
    await expect(fileStore.readFile(secondImage.relativePath)).rejects.toThrow();
    expect((await app.inject({ method: 'GET', url: `/api/orders/${orderId}` })).statusCode).toBe(404);
    database.close();
  });

  it('详情接口返回订单快照、附件元数据和统一 URL', async () => {
    const { app, database } = await makeContext();
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({
        customerName: '客户快照',
        customerContactName: '李四',
        customerContactPhone: '13800000000',
        trackingNo: 'SF123456',
        paymentNote: '已收定金',
        orderDetail: '需要防潮包装',
        remark: '优先发货',
        items: [{
          name: '带包装产品', sku: 'PK-001', specification: '大号', quantity: 12,
          packCount: 6, unitPriceCents: 2500, remark: '每箱放干燥剂',
          packaging: [{ name: '纸箱', innerSize: '20×20×10', innerWeight: 0.2, outerSize: '22×22×12', outerLength: 22, outerWidth: 22, outerHeight: 12, outerWeight: 0.5, packCount: 6 }],
        }],
      }),
    });
    expect(created.statusCode).toBe(201);
    const orderId = Number(created.json().data.id);

    const proof = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/payment-proofs`, ...multipartImage('payment.png', Buffer.from('payment')) });
    expect(proof.statusCode).toBe(201);
    const contract = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/contracts`, ...multipartImage('contract.png', Buffer.from('contract')) });
    expect(contract.statusCode).toBe(201);

    const detail = await app.inject({ method: 'GET', url: `/api/orders/${orderId}/detail` });
    expect(detail.statusCode).toBe(200);
    const data = detail.json().data;
    expect(data.customer_name).toBe('客户快照');
    expect(data.tracking_no).toBe('SF123456');
    expect(data.paymentNote).toBe('已收定金');
    expect(data.items[0].remark).toBe('每箱放干燥剂');
    expect(data.items[0].packaging[0]).toMatchObject({ name: '纸箱', packCount: 6, outerLength: 22 });
    expect(data.paymentProofs[0]).toMatchObject({ originalName: 'payment.png', url: expect.stringContaining('/files/') });
    expect(data.contracts[0]).toMatchObject({ originalName: 'contract.png', size: 8, url: expect.stringContaining('/files/') });

    const missing = await app.inject({ method: 'GET', url: '/api/orders/999999/detail' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
    database.close();
  });

  it('合同超过 20MB 时报错，而不是截断成一份损坏的附件', async () => {
    const { app, database } = await makeContext();
    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({ recipientName: '截断测试' }) });
    const orderId = Number(created.json().data.id);

    // request.parts 关掉了 throwFileSizeLimit：不显式检查 truncated，半截文件会存成一条看起来正常的记录。
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 16, 0x41);
    const response = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/contracts`,
      ...multipartFile('huge.pdf', oversized, 'application/pdf'),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('CONTRACT_TOO_LARGE');

    const detail = await app.inject({ method: 'GET', url: `/api/orders/${orderId}/detail` });
    expect((detail.json().data.contracts as unknown[]).length).toBe(0);
    database.close();
  });

  it('返回订单各产品行对应的图片', async () => {
    const { app, database } = await makeContext();
    const now = new Date().toISOString();
    const productId = Number(database.prepare(
      `INSERT INTO products (name, specification, sku, category, status, created_at, updated_at) VALUES (?, ?, ?, '', 'active', ?, ?) RETURNING id`,
    ).run('测试产品', '标准', 'TS-001', now, now).lastInsertRowid);
    database.prepare(
      `INSERT INTO product_images (product_id, relative_path, original_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, 'image/png', 10, ?)`,
    ).run(productId, 'products/test.png', 'test.png', now);
    const customerId = insertCustomer(database, '测试客户');
    const customerProductId = Number(database.prepare(
      `INSERT INTO customer_products (customer_id, system_product_id, name, specification, sku, pack_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).run(customerId, productId, '测试产品', '标准', 'TS-001', 10, now, now).lastInsertRowid);

    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({
        customerId,
        items: [{ customerProductId, name: '', sku: '', specification: '', packagingName: '纸箱', packCount: 10, quantity: 5, unitPriceCents: 1000 }],
      }),
    });
    expect(created.statusCode).toBe(201);
    const orderId = created.json().data.id;
    const orderItemId = created.json().data.items[0].id;

    const images = await app.inject({ method: 'GET', url: `/api/orders/${orderId}/items-images` });
    expect(images.statusCode).toBe(200);
    expect(images.json().data.itemImages[orderItemId]).toEqual([{ url: '/files/products/test.png', name: 'test.png', mimeType: 'image/png' }]);

    database.close();
  });
});

describe('删除订单', () => {
  it('已发货或已加入发货批次的订单可正常删除，发货相关子表一并清理', async () => {
    const { app, database } = await makeContext();
    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput() });
    expect(created.statusCode).toBe(201);
    const orderId = created.json().data.id as number;

    // 模拟订单已进入发货流程：加入批次并确认发货
    const now = new Date().toISOString();
    const batchId = Number(database.prepare(
      `INSERT INTO shipment_batches (batch_no, status, created_at) VALUES ('BH20260824001', 'confirmed', ?)`,
    ).run(now).lastInsertRowid);
    database.prepare(
      `INSERT INTO shipment_batch_orders (batch_id, order_id, tracking_no, sort_order) VALUES (?, ?, 'SF123456', 0)`,
    ).run(batchId, orderId);
    database.prepare(
      `INSERT INTO shipments (order_id, tracking_no, shipped_at, total_boxes, recipient_info, remark) VALUES (?, 'SF123456', ?, 1, '', '')`,
    ).run(orderId, now);

    // 修复前：shipments / shipment_batch_orders 为 RESTRICT 外键，删除报 FOREIGN KEY constraint failed
    const removed = await app.inject({ method: 'DELETE', url: `/api/orders/${orderId}` });
    expect(removed.statusCode).toBe(200);

    expect(database.prepare('SELECT COUNT(*) AS n FROM orders WHERE id = ?').get(orderId)).toEqual({ n: 0 });
    expect(database.prepare('SELECT COUNT(*) AS n FROM shipment_batch_orders WHERE order_id = ?').get(orderId)).toEqual({ n: 0 });
    expect(database.prepare('SELECT COUNT(*) AS n FROM shipments WHERE order_id = ?').get(orderId)).toEqual({ n: 0 });

    await app.close();
    database.close();
  });

  it('不存在的订单返回 404', async () => {
    const { app, database } = await makeContext();
    const removed = await app.inject({ method: 'DELETE', url: '/api/orders/999999' });
    expect(removed.statusCode).toBe(404);
    await app.close();
    database.close();
  });
});

describe('订单草稿', () => {
  it('创建草稿订单：status 为 draft，且收件人可暂缺', async () => {
    const { app, database } = await makeContext();
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({
        isDraft: true,
        recipientName: '',
        items: [{ name: '', quantity: 5, packCount: 2 }],
      }),
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.data.status).toBe('draft');

    const row = database.prepare('SELECT status, recipient_name FROM orders WHERE id = ?').get(Number(body.data.id));
    expect(row).toMatchObject({ status: 'draft', recipient_name: '' });
    await app.close();
    database.close();
  });

  it('草稿在列表中可通过 status=draft 筛选', async () => {
    const { app, database } = await makeContext();
    await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({ isDraft: true }) });
    await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput() });

    const drafts = await app.inject({ method: 'GET', url: '/api/orders?status=draft' });
    expect(drafts.statusCode).toBe(200);
    const rows = drafts.json().data.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('draft');
    await app.close();
    database.close();
  });

  it('发布草稿：进入待备货，信息完整时成功', async () => {
    const { app, database } = await makeContext();
    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({ isDraft: true }) });
    const orderId = Number(created.json().data.id);

    const published = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/publish` });
    expect(published.statusCode).toBe(200);
    expect(published.json().data.status).toBe('pending_stock');
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(orderId)).toEqual({ status: 'pending_stock' });
    await app.close();
    database.close();
  });

  it('发布失败：收件人为空时保持草稿不变', async () => {
    const { app, database } = await makeContext();
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderInput({ isDraft: true, recipientName: '' }),
    });
    const orderId = Number(created.json().data.id);

    const published = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/publish` });
    expect(published.statusCode).toBe(400);
    // 草稿保持原状态，可继续编辑
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(orderId)).toEqual({ status: 'draft' });
    await app.close();
    database.close();
  });

  it('非草稿订单不能发布', async () => {
    const { app, database } = await makeContext();
    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput() });
    const orderId = Number(created.json().data.id);

    const published = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/publish` });
    expect(published.statusCode).toBe(400);
    await app.close();
    database.close();
  });

  it('更新草稿不改变其 draft 状态；正式订单更新不受影响', async () => {
    const { app, database } = await makeContext();
    const draftCreated = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({ isDraft: true }) });
    const draftId = Number(draftCreated.json().data.id);
    const draftOrderNo = String(draftCreated.json().data.order_no ?? '');

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/orders/${draftId}`,
      payload: orderInput({ orderNo: draftOrderNo, recipientName: '李四' }),
    });
    expect(updated.statusCode).toBe(200);
    expect(database.prepare('SELECT status FROM orders WHERE id = ?').get(draftId)).toEqual({ status: 'draft' });
    await app.close();
    database.close();
  });
});
