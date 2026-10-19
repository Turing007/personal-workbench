import type { FastifyInstance } from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { migrateDatabase } from '../../src/server/db/migrate';
import { buildPreparation } from '../../src/server/services/stock-service';
import type { StockPreparationRow } from '../../src/server/db/stock-repository';
import { authInject, setupAdmin } from './helpers/auth';

const contexts: Array<{ app: FastifyInstance; database: DatabaseSync }> = [];

afterEach(() => {
  while (contexts.length) {
    const context = contexts.pop()!;
    context.database.close();
  }
});

async function testApp(): Promise<{ app: FastifyInstance; database: DatabaseSync }> {
  const database = new DatabaseSync(':memory:');
  migrateDatabase(database);
  const app = await createApp({ database });
  await setupAdmin(app);
  contexts.push({ app, database });
  return { app, database };
}

function row(overrides: Partial<StockPreparationRow>): StockPreparationRow {
  return {
    order_id: 1,
    order_no: 'SO-260908-001',
    customer_name: '张三',
    ordered_at: '2026-09-08T08:00:00.000Z',
    order_item_id: 1,
    quantity: 5,
    item_remark: '',
    item_name: '快照名',
    item_specification: '标准',
    customer_product_id: 11,
    supplier_product_name: '',
    product_id: 21,
    product_name: '系统产品',
    product_supplier: '大公2',
    ...overrides,
  } as StockPreparationRow;
}

describe('buildPreparation 聚合规则', () => {
  it('按供应商分组、合并同产品数量并去重备注', () => {
    const preparation = buildPreparation([
      row({ order_id: 1, order_item_id: 1, quantity: 5, item_remark: '装一个外箱', supplier_product_name: '米沃奇脚58款' }),
      row({ order_id: 2, order_no: 'SO-260908-002', order_item_id: 2, quantity: 7, item_remark: '装一个外箱' }),
      row({ order_id: 3, order_no: 'SO-260908-003', order_item_id: 3, quantity: 2, item_remark: '不要包装', product_id: 22, product_name: '另一产品' }),
    ], '2026-09-08');

    expect(preparation.scope).toBe('2026-09-08');
    expect(preparation.orderCount).toBe(3);
    expect(preparation.supplierCount).toBe(1);
    expect(preparation.itemCount).toBe(2);
    expect(preparation.totalQuantity).toBe(14);
    expect(preparation.groups).toHaveLength(1);
    const [group] = preparation.groups;
    expect(group.kind).toBe('supplier');
    expect(group.title).toBe('大公2');
    expect(group.items[0]).toMatchObject({ systemProductId: 21, displayName: '米沃奇脚58款', quantity: 12, remarks: ['装一个外箱'] });
    expect(group.items[0].sources).toHaveLength(2);
    expect(group.items[1]).toMatchObject({ displayName: '另一产品', quantity: 2 });
  });

  it('显示名回退：无报供名称用系统产品名，未关联用订单快照名', () => {
    const preparation = buildPreparation([
      row({ order_item_id: 1, supplier_product_name: '' }),
      row({ order_item_id: 2, customer_product_id: null, product_id: null, product_name: null, supplier_product_name: null, item_name: '临时产品', item_specification: '白色' }),
    ], null);

    expect(preparation.groups.map((group) => group.kind)).toEqual(['supplier', 'unlinked']);
    expect(preparation.groups[0].items[0].displayName).toBe('系统产品');
    expect(preparation.groups[1].title).toBe('未关联产品');
    expect(preparation.groups[1].items[0].displayName).toBe('临时产品 白色');
  });

  it('关联了系统产品但供应商为空时进入未填供应商警示组', () => {
    const preparation = buildPreparation([
      row({ product_supplier: '  ' }),
    ], null);

    expect(preparation.groups).toHaveLength(1);
    expect(preparation.groups[0]).toMatchObject({ kind: 'missing-supplier', title: '未填供应商' });
    expect(preparation.supplierCount).toBe(0);
  });

  it('供应商组按名称排序，警示组排在其后', () => {
    const preparation = buildPreparation([
      row({ order_item_id: 1, product_supplier: '贞景' }),
      row({ order_item_id: 2, product_id: 22, product_supplier: '大公2' }),
      row({ order_item_id: 3, customer_product_id: null, product_id: null, product_name: null, supplier_product_name: null }),
    ], null);

    expect(preparation.groups.map((group) => group.title)).toEqual(['大公2', '贞景', '未关联产品']);
  });

  it('未挂客户产品的手填明细各占一行，不与其他订单的手填明细合并', () => {
    const preparation = buildPreparation([
      row({ order_id: 1, order_no: 'SO-260908-001', order_item_id: 1, customer_product_id: null, product_id: null, product_name: null, supplier_product_name: null, item_name: '手填A', quantity: 2 }),
      row({ order_id: 2, order_no: 'SO-260908-002', order_item_id: 2, customer_product_id: null, product_id: null, product_name: null, supplier_product_name: null, item_name: 'E2E产品', quantity: 10 }),
    ], null);

    expect(preparation.groups).toHaveLength(1);
    expect(preparation.orderCount).toBe(2);
    expect(preparation.groups[0].items).toHaveLength(2);
    expect(preparation.groups[0].items[0]).toMatchObject({ displayName: '手填A 标准', quantity: 2 });
    expect(preparation.groups[0].items[1]).toMatchObject({ displayName: 'E2E产品 标准', quantity: 10 });
  });
});

describe('备货表接口', () => {
  async function seedPreparationData(app: FastifyInstance) {
    const customer = await authInject(app, {
      method: 'POST',
      url: '/api/customers',
      payload: { name: '客户甲', contactName: '', contactPhone: '', shippingInfo: '' },
    });
    const customerId = Number(customer.json().data.id);

    const product = await authInject(app, {
      method: 'POST',
      url: '/api/products',
      payload: {
        name: '冲压米沃奇脚58款',
        specification: '58款',
        sku: '',
        supplier: '大公2',
        status: 'active',
        packaging: [{ name: '彩盒', innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 0, packCount: 100 }],
      },
    });
    expect(product.statusCode).toBe(201);
    const systemProductId = Number(product.json().data.id);

    const customerProduct = await authInject(app, {
      method: 'POST',
      url: `/api/customers/${customerId}/products/from-library/complete`,
      payload: { systemProductId, name: '客户甲-A款冲压脚', supplierProductName: 'A款冲压米沃奇脚58款', specification: '58款', sku: '', packCount: null, finalPriceCents: null },
    });
    expect(customerProduct.statusCode).toBe(201);
    const customerProductId = Number(customerProduct.json().data.id);
    return { customerId, systemProductId, customerProductId };
  }

  async function createOrder(app: FastifyInstance, options: {
    customerId?: number;
    orderedAt: string;
    items: Array<Record<string, unknown>>;
  }): Promise<number> {
    const created = await authInject(app, {
      method: 'POST',
      url: '/api/orders',
      payload: {
        orderNo: '',
        customerId: options.customerId,
        orderedAt: options.orderedAt,
        recipientName: '张三',
        recipientInfo: '',
        amount: 0,
        trackingNo: '',
        paymentNote: '',
        remark: '',
        items: options.items,
      },
    });
    expect(created.statusCode).toBe(201);
    return Number(created.json().data.id);
  }

  it('按下单日期生成供应商分组备货表，并支持导出与标记已备货', async () => {
    const { app } = await testApp();
    const { customerId, customerProductId } = await seedPreparationData(app);
    await createOrder(app, {
      customerId,
      orderedAt: '2026-09-08T08:00:00.000Z',
      items: [{ name: '客户甲-A款冲压脚', sku: '', specification: '58款', quantity: 5, unitPriceCents: 1000, customerProductId, remark: '装一个外箱' }],
    });
    const secondOrderId = await createOrder(app, {
      customerId,
      orderedAt: '2026-09-08T10:00:00.000Z',
      items: [{ name: '客户甲-A款冲压脚', sku: '', specification: '58款', quantity: 7, unitPriceCents: 1000, customerProductId }],
    });
    await createOrder(app, {
      customerId,
      orderedAt: '2026-09-09T09:00:00.000Z',
      items: [{ name: '客户甲-A款冲压脚', sku: '', specification: '58款', quantity: 3, unitPriceCents: 1000, customerProductId }],
    });

    const dayList = await authInject(app, { method: 'GET', url: '/api/stock/preparation?date=2026-09-08' });
    expect(dayList.statusCode).toBe(200);
    const dayPreparation = dayList.json().data;
    expect(dayPreparation.scope).toBe('2026-09-08');
    expect(dayPreparation.orderCount).toBe(2);
    expect(dayPreparation.supplierCount).toBe(1);
    expect(dayPreparation.groups[0].title).toBe('大公2');
    expect(dayPreparation.groups[0].items[0]).toMatchObject({
      displayName: 'A款冲压米沃奇脚58款',
      quantity: 12,
      remarks: ['装一个外箱'],
    });

    const otherDay = await authInject(app, { method: 'GET', url: '/api/stock/preparation?date=2026-09-09' });
    expect(otherDay.json().data.groups[0].items[0].quantity).toBe(3);

    const all = await authInject(app, { method: 'GET', url: '/api/stock/preparation' });
    expect(all.json().data.scope).toBe('all');
    expect(all.json().data.orderCount).toBe(3);

    const exported = await authInject(app, { method: 'GET', url: '/api/stock/preparation/export?date=2026-09-08' });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml');
    expect(exported.body.length).toBeGreaterThan(0);

    const marked = await authInject(app, {
      method: 'POST',
      url: `/api/orders/${secondOrderId}/status`,
      payload: { to: 'stock_reported', reason: 'manual' },
    });
    expect(marked.statusCode).toBe(200);
    const afterMark = await authInject(app, { method: 'GET', url: '/api/stock/preparation?date=2026-09-08' });
    expect(afterMark.json().data.orderCount).toBe(1);
    expect(afterMark.json().data.groups[0].items[0].quantity).toBe(5);
  });

  it('未关联客户产品的订单明细进入未关联警示组', async () => {
    const { app } = await testApp();
    await createOrder(app, {
      orderedAt: '2026-09-08T08:00:00.000Z',
      items: [{ name: '手填产品', sku: '', specification: '黑色', quantity: 4, unitPriceCents: 500 }],
    });

    const list = await authInject(app, { method: 'GET', url: '/api/stock/preparation?date=2026-09-08' });
    const groups = list.json().data.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'unlinked', title: '未关联产品' });
    expect(groups[0].items[0]).toMatchObject({ displayName: '手填产品 黑色', quantity: 4 });
  });

  it('link 接口建立映射并写入报供名称，冲突时报 409', async () => {
    const { app } = await testApp();
    const { customerId } = await seedPreparationData(app);

    const secondProduct = await authInject(app, {
      method: 'POST',
      url: '/api/products',
      payload: {
        name: '无刷马刀锯底座',
        specification: '通用',
        sku: '',
        supplier: '德乙堡',
        status: 'active',
        packaging: [{ name: '彩盒', innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 0, packCount: 50 }],
      },
    });
    expect(secondProduct.statusCode).toBe(201);
    const secondSystemProductId = Number(secondProduct.json().data.id);

    const temp = await authInject(app, {
      method: 'POST',
      url: `/api/customers/${customerId}/products`,
      payload: { name: '手工录入产品', specification: '', sku: '', packCount: null, finalPriceCents: null },
    });
    const tempId = Number(temp.json().data.id);

    const linked = await authInject(app, {
      method: 'POST',
      url: `/api/customer-products/${tempId}/link`,
      payload: { systemProductId: secondSystemProductId, supplierProductName: ' 手工报供名 ' },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().data).toMatchObject({ systemProductId: secondSystemProductId, supplierProductName: '手工报供名' });

    const another = await authInject(app, {
      method: 'POST',
      url: `/api/customers/${customerId}/products`,
      payload: { name: '另一手工产品', specification: '', sku: '', packCount: null, finalPriceCents: null },
    });
    const anotherId = Number(another.json().data.id);
    // 同一系统 SKU 允许多条客户产品匹配（不同规格各一条），不再报冲突。
    const secondLink = await authInject(app, {
      method: 'POST',
      url: `/api/customer-products/${anotherId}/link`,
      payload: { systemProductId: secondSystemProductId, supplierProductName: '' },
    });
    expect(secondLink.statusCode).toBe(200);
    expect(secondLink.json().data).toMatchObject({ systemProductId: secondSystemProductId });

    const missingProduct = await authInject(app, {
      method: 'POST',
      url: `/api/customer-products/${anotherId}/link`,
      payload: { systemProductId: 999999, supplierProductName: '' },
    });
    expect(missingProduct.statusCode).toBe(404);
  });
});
