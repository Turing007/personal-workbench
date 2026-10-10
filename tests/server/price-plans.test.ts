import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';
import { PricePlanRepository } from '../../src/server/db/price-plan-repository';
import { SettingsRepository } from '../../src/server/db/settings-repository';
import { registerProductRoutes } from '../../src/server/routes/products';

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-price-plans-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const repositories = new DatabaseRepositories(database);
  const pricePlanRepository = new PricePlanRepository(database);
  const settingsRepository = new SettingsRepository(database);
  const app = Fastify();
  app.addHook('onClose', async () => database.close());
  await registerProductRoutes(app, { repositories, pricePlanRepository });
  apps.push(app);
  return { app, repositories, pricePlanRepository, settingsRepository };
}

const productPayload = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  specification: '',
  category: '电动工具',
  supplier: '示例供应商',
  packaging: [{ name: '彩盒包装', packCount: 10 }],
  ...extra,
});

async function createProduct(app: FastifyInstance, name: string, extra: Record<string, unknown> = {}) {
  const response = await app.inject({ method: 'POST', url: '/api/products', payload: productPayload(name, extra) });
  expect(response.statusCode).toBe(201);
  return response.json().data as { id: number; accessoryPrices: Array<{ name: string; price: number }> };
}

const planPayload = (extra: Record<string, unknown> = {}) => ({
  name: '双电版',
  markupPercent: 20,
  items: [
    { name: '产品成本', qty: 1, unitPrice: 46 },
    { name: '彩盒包装', qty: 1, unitPrice: 3.2 },
    { name: '21V电池', qty: 2, unitPrice: 8.5 },
  ],
  ...extra,
});

describe('售价计算器：算价方案', () => {
  it('保存方案由服务端重算合计与售价；列表倒序；可删除', async () => {
    const { app, pricePlanRepository } = await createFixture();
    const product = await createProduct(app, '圆锯-7寸');

    const first = await app.inject({ method: 'POST', url: `/api/products/${product.id}/price-plans`, payload: planPayload() });
    expect(first.statusCode).toBe(201);
    const firstPlan = first.json().data as { id: number; totalCost: number; salePrice: number; items: Array<{ amount: number }> };
    // 46 + 3.2 + 2×8.5 = 66.2；×1.2 = 79.44；明细行金额同样服务端算。
    expect(firstPlan.totalCost).toBe(66.2);
    expect(firstPlan.salePrice).toBe(79.44);
    expect(firstPlan.items.map((item) => item.amount)).toEqual([46, 3.2, 17]);

    await app.inject({
      method: 'POST',
      url: `/api/products/${product.id}/price-plans`,
      payload: planPayload({ name: '裸机版', markupPercent: 25, targetPrice: 100, items: [{ name: '产品成本', qty: 1, unitPrice: 46 }] }),
    });
    const list = await app.inject({ method: 'GET', url: `/api/products/${product.id}/price-plans` });
    const items = list.json().data.items as Array<{ id: number; name: string; salePrice: number; targetPrice: number | null; items: unknown[] }>;
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe('裸机版');
    expect(items[0].salePrice).toBe(57.5);
    expect(items[0].targetPrice).toBe(100);
    expect(items[0].items).toHaveLength(1);
    expect(items[1].name).toBe('双电版');

    expect((await app.inject({ method: 'DELETE', url: `/api/products/${product.id}/price-plans/${firstPlan.id}` })).statusCode).toBe(200);
    expect(pricePlanRepository.listForProduct(product.id)).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/products/${product.id}/price-plans/${firstPlan.id}` })).statusCode).toBe(404);
  });

  it('校验：没有有效明细 400；产品不存在 404；删产品时方案一并清掉', async () => {
    const { app, pricePlanRepository } = await createFixture();
    const product = await createProduct(app, '圆锯-7寸');
    await app.inject({ method: 'POST', url: `/api/products/${product.id}/price-plans`, payload: planPayload() });

    const empty = await app.inject({
      method: 'POST',
      url: `/api/products/${product.id}/price-plans`,
      payload: { items: [{ name: '   ', qty: 1, unitPrice: 3 }] },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe('VALIDATION_ERROR');
    expect((await app.inject({ method: 'GET', url: '/api/products/424242/price-plans' })).statusCode).toBe(404);

    expect((await app.inject({ method: 'DELETE', url: `/api/products/${product.id}` })).statusCode).toBe(200);
    expect(pricePlanRepository.listForProduct(product.id)).toHaveLength(0);
  });
});

describe('售价计算器：产品「配件与价格」', () => {
  it('随产品保存：带数组整表覆盖、没带保持原样、空数组清空', async () => {
    const { app } = await createFixture();
    const product = await createProduct(app, '圆锯-7寸', {
      accessoryPrices: [
        { name: '21V 2.0Ah 电池', price: 8.5 },
        { name: '  ', price: 3 },
        { name: '锯片', price: '4.56' },
      ],
    });
    // 空名行被丢弃、价格保留两位。
    expect(product.accessoryPrices).toEqual([
      expect.objectContaining({ name: '21V 2.0Ah 电池', price: 8.5 }),
      expect.objectContaining({ name: '锯片', price: 4.56 }),
    ]);

    // Excel 导入这类没带 accessoryPrices 的保存：保持原样。
    const withoutField = await app.inject({
      method: 'PUT',
      url: `/api/products/${product.id}`,
      payload: productPayload('圆锯-7寸-改名'),
    });
    expect(withoutField.statusCode).toBe(200);
    expect(withoutField.json().data.accessoryPrices).toHaveLength(2);

    // 显式传空数组：清空。
    const cleared = await app.inject({
      method: 'PUT',
      url: `/api/products/${product.id}`,
      payload: productPayload('圆锯-7寸-改回', { accessoryPrices: [] }),
    });
    expect(cleared.json().data.accessoryPrices).toEqual([]);
  });

  it('全店共用的配件清单：保存与读取走 settings，空名丢弃', async () => {
    const { settingsRepository } = await createFixture();
    expect(settingsRepository.readAccessoryPrices()).toEqual([]);
    const saved = settingsRepository.saveAccessoryPrices([
      { name: '21V 2.0Ah 电池', price: 8.5 },
      { name: '', price: 3 },
      { name: '1.5A 充电器', price: 6 },
    ]);
    expect(saved).toHaveLength(2);
    expect(settingsRepository.readAccessoryPrices().map((item) => item.name)).toEqual(['21V 2.0Ah 电池', '1.5A 充电器']);
  });
});
