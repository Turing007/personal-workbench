import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db/connection.js';
import { migrateDatabase } from '../../src/server/db/migrate.js';
import { authInject, setupAdmin } from './helpers/auth.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-order-profit-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const app = await createApp({ database, filesDirectory: join(directory, 'files') });
  await setupAdmin(app);
  const customer = await authInject(app, {
    method: 'POST',
    url: '/api/customers',
    payload: { name: `利润测试客户${Date.now()}`, contactName: '王工', contactPhone: '13800000000', shippingInfo: '深圳市南山区' },
  });
  expect(customer.statusCode).toBe(201);
  const customerId = Number(customer.json().data.id);
  const customerProduct = await authInject(app, {
    method: 'POST',
    url: `/api/customers/${customerId}/products`,
    payload: {
      name: '利润测试产品',
      specification: '24V 100Ah',
      sku: `PROFIT-${Date.now()}`,
      packCount: 10,
      finalPriceCents: 8800,
      costPriceCents: 5000,
      batteryCostCents: 800,
      chargerCostCents: 300,
      packagingCostCents: 200,
      accessoryCostCents: 100,
      otherCostCents: 0,
      costConfirmed: true,
      packaging: [{ name: '彩盒', innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 0, packCount: 10 }],
      imageRelativePath: null,
    },
  });
  expect(customerProduct.statusCode).toBe(201);
  return { database, app, customerId, customerProductId: Number(customerProduct.json().data.id) };
}

function orderPayload(customerId: number, customerProductId: number, withCosts = true) {
  return {
    orderNo: '',
    orderedAt: '2026-08-22',
    customerId,
    recipientName: '王工',
    recipientInfo: '王工 13800000000 深圳市南山区',
    shippingCents: 0,
    ...(withCosts ? {
      logisticsCostCents: 1500,
      labelCostCents: 100,
      otherCostCents: 500,
      otherCostNote: '平台手续费',
      costConfirmed: true,
    } : {}),
    items: [{
      customerProductId,
      quantity: 2,
      unitPriceCents: 8800,
      packCount: 10,
      ...(withCosts ? {
        machineCostCents: 3000,
        batteryCostCents: 800,
        chargerCostCents: 300,
        packagingCostCents: 200,
        accessoryCostCents: 100,
        otherCostCents: 0,
        costConfirmed: true,
      } : {}),
    }],
  };
}

describe('订单利润核算', () => {
  it('保存成本快照并在财务列表与详情中计算毛利', async () => {
    const { database, app, customerId, customerProductId } = await setup();
    const created = await authInject(app, { method: 'POST', url: '/api/orders', payload: orderPayload(customerId, customerProductId) });
    expect(created.statusCode).toBe(201);
    const order = created.json().data;
    expect(order.items[0]).toMatchObject({
      machine_cost_cents: 3000,
      battery_cost_cents: 800,
      charger_cost_cents: 300,
      packaging_cost_cents: 200,
      accessory_cost_cents: 100,
      other_cost_cents: 0,
      cost_confirmed: 1,
    });
    expect(order).toMatchObject({
      logistics_cost_cents: 1500,
      label_cost_cents: 100,
      other_cost_cents: 500,
      other_cost_note: '平台手续费',
      cost_confirmed: 1,
    });

    const finance = await authInject(app, { method: 'GET', url: '/api/finance/orders?month=2026-08' });
    expect(finance.statusCode).toBe(200);
    expect(finance.json().data.rows[0]).toMatchObject({
      orderId: Number(order.id),
      costCents: 10900,
      profitCents: 6700,
      costComplete: true,
    });
    expect(finance.json().data.stats).toMatchObject({
      profitCents: 6700,
      profitOrderCount: 1,
      costPendingOrderCount: 0,
    });

    const detail = await authInject(app, { method: 'GET', url: `/api/finance/orders/${order.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.profit).toMatchObject({
      costComplete: true,
      itemCostCents: 8800,
      totalCostCents: 10900,
      profitCents: 6700,
      marginPercent: 38.1,
      missingItemCount: 0,
    });
    await app.close();
    database.close();
  });

  it('修改客户产品成本不会污染历史订单，旧客户端编辑也不会清空成本', async () => {
    const { database, app, customerId, customerProductId } = await setup();
    const created = await authInject(app, { method: 'POST', url: '/api/orders', payload: orderPayload(customerId, customerProductId) });
    const orderId = Number(created.json().data.id);

    const changedProduct = await authInject(app, {
      method: 'PUT',
      url: `/api/customer-products/${customerProductId}`,
      payload: {
        name: '利润测试产品',
        specification: '24V 100Ah',
        sku: 'PROFIT-CHANGED',
        packCount: 10,
        finalPriceCents: 8800,
        costPriceCents: 9000,
        packaging: [{ name: '彩盒', innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 0, packCount: 10 }],
      },
    });
    expect(changedProduct.statusCode).toBe(200);

    const unchanged = await authInject(app, { method: 'GET', url: `/api/orders/${orderId}/detail` });
    expect(unchanged.json().data.items[0].machine_cost_cents).toBe(3000);

    const oldClientPayload = orderPayload(customerId, customerProductId, false);
    const updated = await authInject(app, {
      method: 'PUT',
      url: `/api/orders/${orderId}`,
      payload: { ...oldClientPayload, orderNo: created.json().data.order_no },
    });
    expect(updated.statusCode).toBe(200);
    const preserved = await authInject(app, { method: 'GET', url: `/api/orders/${orderId}/detail` });
    expect(preserved.json().data.items[0]).toMatchObject({
      machine_cost_cents: 3000,
      cost_confirmed: 1,
    });
    expect(preserved.json().data).toMatchObject({
      logistics_cost_cents: 1500,
      label_cost_cents: 100,
      other_cost_cents: 500,
      cost_confirmed: 1,
    });
    await app.close();
    database.close();
  });

  it('客户产品标准成本会自动带入新订单并保持已核对状态', async () => {
    const { database, app, customerId, customerProductId } = await setup();
    const created = await authInject(app, {
      method: 'POST',
      url: '/api/orders',
      payload: orderPayload(customerId, customerProductId, false),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.items[0]).toMatchObject({
      machine_cost_cents: 5000,
      battery_cost_cents: 800,
      charger_cost_cents: 300,
      packaging_cost_cents: 200,
      accessory_cost_cents: 100,
      other_cost_cents: 0,
      cost_confirmed: 1,
    });
    await app.close();
    database.close();
  });

  it('拒绝负数成本和未确认行不计入完整毛利', async () => {
    const { database, app, customerId, customerProductId } = await setup();
    const invalid = await authInject(app, {
      method: 'POST',
      url: '/api/orders',
      payload: { ...orderPayload(customerId, customerProductId), items: [{ ...orderPayload(customerId, customerProductId).items[0], machineCostCents: -1 }] },
    });
    expect(invalid.statusCode).toBe(400);

    const pendingPayload = orderPayload(customerId, customerProductId);
    pendingPayload.items[0].costConfirmed = false;
    const created = await authInject(app, { method: 'POST', url: '/api/orders', payload: pendingPayload });
    expect(created.statusCode).toBe(201);
    const finance = await authInject(app, { method: 'GET', url: '/api/finance/orders?month=2026-08' });
    expect(finance.json().data.rows[0]).toMatchObject({ costComplete: false, costCents: null, profitCents: null });
    expect(finance.json().data.stats).toMatchObject({ profitCents: 0, profitOrderCount: 0, costPendingOrderCount: 1 });
    await app.close();
    database.close();
  });
});
