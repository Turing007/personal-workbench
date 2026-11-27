import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';
import { CustomerRepository } from '../../src/server/db/customer-repository';
import { CustomerProductRepository } from '../../src/server/db/customer-product-repository';
import { CustomerProductService } from '../../src/server/services/customer-product-service';
import { registerOrderRoutes } from '../../src/server/routes/orders';

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeContext() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-sticker-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const repositories = new DatabaseRepositories(database);
  const customers = new CustomerRepository(database);
  const customerProducts = new CustomerProductRepository(database);
  const app = Fastify();
  await registerOrderRoutes(app, {
    repositories,
    customerRepository: customers,
    customerProductRepository: customerProducts,
  });
  apps.push(app);
  const customer = customers.create({ name: '贴标客户', contactName: '', contactPhone: '', shippingInfo: '', invoiceTitle: '', taxNo: '' });
  const product = customerProducts.create(customer.id, {
    name: '贴标产品', specification: '标准', sku: 'STICKER-1', packCount: 10, finalPriceCents: null, stickerEnabled: true, stickerPerSheet: 30,
  });
  const service = new CustomerProductService(customerProducts, customers);
  return { database, repositories, customers, customerProducts, app, customer, product, service };
}

async function createOrder(app: FastifyInstance, productId: number, quantity: number, orderNo: string, customerId: number) {
  const created = await app.inject({
    method: 'POST',
    url: '/api/orders',
    payload: {
      orderNo,
      customerId: customerId,
      customerName: '贴标客户',
      orderedAt: '2026-11-20T08:00:00.000Z',
      recipientName: '张三',
      recipientInfo: '深圳市宝安区',
      items: [{ customerProductId: productId, name: '', sku: '', specification: '', quantity, packCount: 10, unitPriceCents: 1000 }],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  return Number(created.json().data.id);
}

describe('贴标库存', () => {
  it('完成打包扣减、回退不返还、重复打包可跳过，打印入库与手动调整实时反映', async () => {
    const { customerProducts, app, product, service, customer, database } = await makeContext();
    const orderId = await createOrder(app, Number(product.id), 20, 'SO-STICKER-1', customer.id);
    for (const to of ['stock_reported', 'pending_packing']) {
      expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to } })).statusCode).toBe(200);
    }

    // 第一次完成打包：按数量扣减 20
    expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to: 'ship_pending' } })).statusCode).toBe(200);
    const detail = await app.inject({ method: 'GET', url: `/api/orders/${orderId}/detail` });
    expect(detail.json().data.sticker_consumed_count).toBe(1);
    let ledger = service.stickerLedger(Number(product.id))!;
    expect(ledger.remaining).toBe(-20);
    expect(ledger.consumed).toBe(20);

    // 回退到待打包：标贴不返还
    expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to: 'pending_packing', reason: 'rollback' } })).statusCode).toBe(200);
    ledger = service.stickerLedger(Number(product.id))!;
    expect(ledger.remaining).toBe(-20);

    // 再次完成打包：默认再次扣减
    expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to: 'ship_pending' } })).statusCode).toBe(200);
    ledger = service.stickerLedger(Number(product.id))!;
    expect(ledger.remaining).toBe(-40);
    expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to: 'pending_packing', reason: 'rollback' } })).statusCode).toBe(200);

    // 明确跳过：不再扣减
    expect((await app.inject({ method: 'POST', url: `/api/orders/${orderId}/status`, payload: { to: 'ship_pending', deductStickers: false } })).statusCode).toBe(200);
    ledger = service.stickerLedger(Number(product.id))!;
    expect(ledger.remaining).toBe(-40);

    // 打印入库 2 张 × 30，手动调整 +5
    ledger = service.addStickerTransaction(Number(product.id), { kind: 'print', sheets: 2, note: '打印店' })!;
    expect(ledger.remaining).toBe(20);
    expect(ledger.printed).toBe(60);
    ledger = service.addStickerTransaction(Number(product.id), { kind: 'adjust', quantity: 5, note: '换标贴补差' })!;
    expect(ledger.remaining).toBe(25);
    expect(customerProducts.getById(Number(product.id))?.stickerRemaining).toBe(25);
    database.close();
  });

  it('标贴打印文件优先取附件中最新标贴 PDF，删除后回退并保留历史文件兜底', async () => {
    const { database, repositories, customerProducts, app, product, customer } = await makeContext();
    const productId = Number(product.id);
    expect(customerProducts.getById(productId)?.stickerFileRelativePath).toBeNull();

    const addAttachment = (originalName: string, category: 'label' | 'other', relativePath: string, mimeType = 'application/pdf') => Number(
      customerProducts.addAttachment(productId, { relativePath, originalName, mimeType, size: 3, category }).id,
    );

    const firstId = addAttachment('标贴-v1.pdf', 'label', 'customer-product-attachments/v1.pdf');
    expect(customerProducts.getById(productId)?.stickerFileRelativePath).toBe('customer-product-attachments/v1.pdf');

    const secondId = addAttachment('标贴-v2.PDF', 'label', 'customer-product-attachments/v2.pdf');
    expect(customerProducts.getById(productId)?.stickerFileRelativePath).toBe('customer-product-attachments/v2.pdf');

    // 只有附件分类为标贴且扩展名是 PDF 时才参与
    addAttachment('标贴图.png', 'label', 'customer-product-attachments/pic.png', 'image/png');
    addAttachment('说明书.pdf', 'other', 'customer-product-attachments/manual.pdf');
    expect(customerProducts.getById(productId)?.stickerFileRelativePath).toBe('customer-product-attachments/v2.pdf');

    const orderId = await createOrder(app, productId, 5, 'SO-STICKER-FILE', customer.id);
    const detail = repositories.getOrderDetail(orderId) as unknown as { sticker_json: string };
    expect(JSON.parse(detail.sticker_json)[0].file).toBe('customer-product-attachments/v2.pdf');

    customerProducts.deleteAttachment(productId, secondId);
    expect(customerProducts.getById(productId)?.stickerFileRelativePath).toBe('customer-product-attachments/v1.pdf');

    // 没有标贴附件时继续使用历史单独上传的文件
    customerProducts.setStickerFile(productId, 'customer-product-attachments/legacy.pdf');
    customerProducts.deleteAttachment(productId, firstId);
    expect(customerProducts.getById(productId)?.stickerFileRelativePath).toBe('customer-product-attachments/legacy.pdf');

    addAttachment('标贴-v3.pdf', 'label', 'customer-product-attachments/v3.pdf');
    expect(customerProducts.getById(productId)?.stickerFileRelativePath).toBe('customer-product-attachments/v3.pdf');
    database.close();
  });
});
