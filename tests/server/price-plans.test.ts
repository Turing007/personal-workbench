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
import { SettingsService } from '../../src/server/services/settings-service';
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
  const settingsService = new SettingsService(
    settingsRepository,
    undefined,
    undefined,
    undefined,
    undefined,
    (category, items) => { repositories.freezeCategoryAccessoryPrices(category, items); },
  );
  const app = Fastify();
  app.addHook('onClose', async () => database.close());
  await registerProductRoutes(app, { repositories, pricePlanRepository });
  apps.push(app);
  return { app, repositories, pricePlanRepository, settingsRepository, settingsService };
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
  return response.json().data as { id: number; accessoryPrices: Array<{ name: string; price: number }>; accessoryPricesCustomized: boolean };
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

  it('方案参数快照：随保存写入并按白名单清洗回读；不带参数存空、读回 null', async () => {
    const { app } = await createFixture();
    const product = await createProduct(app, '圆锯-9寸');

    const withParams = await app.inject({
      method: 'POST',
      url: `/api/products/${product.id}/price-plans`,
      payload: planPayload({
        params: { baseCost: 105, packaging: 0, shipping: 0, taxPercent: 7.7, chargerName: ' 小线充（欧/美规）-0.5A ', chargerPrice: 2.3, junk: 'x', baseCostJunk: 'nope' },
      }),
    });
    expect(withParams.statusCode).toBe(201);
    const saved = withParams.json().data as { params: Record<string, unknown> };
    // 白名单清洗：junk 字段被丢掉；运费模式与单价缺失时补默认（手动 + 1.5）。
    expect(saved.params).toEqual({
      baseCost: 105, packaging: 0, shipping: 0, taxPercent: 7.7,
      chargerName: '小线充（欧/美规）-0.5A', chargerPrice: 2.3,
      shippingMode: 'manual', shippingUnitPrice: 1.5,
    });
    // 读列表同样带回参数快照。
    const list = await app.inject({ method: 'GET', url: `/api/products/${product.id}/price-plans` });
    expect((list.json().data.items[0] as { params: Record<string, unknown> }).params).toMatchObject({ baseCost: 105, chargerPrice: 2.3 });

    // 脏值清洗：负价格与非法数字一律按 0。
    const dirty = await app.inject({
      method: 'POST',
      url: `/api/products/${product.id}/price-plans`,
      payload: planPayload({ name: '脏值', params: { baseCost: -5, chargerPrice: 'abc', chargerName: 42 } }),
    });
    expect((dirty.json().data as { params: Record<string, unknown> }).params).toEqual({
      baseCost: 0, packaging: 0, shipping: 0, taxPercent: 0, chargerName: '', chargerPrice: 0,
      shippingMode: 'manual', shippingUnitPrice: 1.5,
    });

    // 旧客户端不带 params：存空对象、读回 null（按旧方案处理）。
    const legacy = await app.inject({ method: 'POST', url: `/api/products/${product.id}/price-plans`, payload: planPayload({ name: '旧口径' }) });
    expect((legacy.json().data as { params: unknown }).params).toBeNull();
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
  it('随产品保存：带数组整表覆盖（并标记已固化）、没带保持原样、空数组清空', async () => {
    const { app } = await createFixture();
    const product = await createProduct(app, '圆锯-7寸', {
      accessoryPrices: [
        { name: '21V 2.0Ah 电池', price: 8.5 },
        { name: '  ', price: 3 },
        { name: '锯片', price: '4.56' },
      ],
    });
    // 空名行被丢弃、价格保留两位；带数组保存 = 已固化（不再跟随类目默认）。
    expect(product.accessoryPrices).toEqual([
      expect.objectContaining({ name: '21V 2.0Ah 电池', price: 8.5 }),
      expect.objectContaining({ name: '锯片', price: 4.56 }),
    ]);
    expect(product.accessoryPricesCustomized).toBe(true);

    // Excel 导入这类没带 accessoryPrices 的保存：保持原样，固化标记也不动。
    const withoutField = await app.inject({
      method: 'PUT',
      url: `/api/products/${product.id}`,
      payload: productPayload('圆锯-7寸-改名'),
    });
    expect(withoutField.statusCode).toBe(200);
    expect(withoutField.json().data.accessoryPrices).toHaveLength(2);
    expect(withoutField.json().data.accessoryPricesCustomized).toBe(true);

    // 显式传空数组：清空，且仍是「已固化」——详情不会回落到类目默认。
    const cleared = await app.inject({
      method: 'PUT',
      url: `/api/products/${product.id}`,
      payload: productPayload('圆锯-7寸-改回', { accessoryPrices: [] }),
    });
    expect(cleared.json().data.accessoryPrices).toEqual([]);
    expect(cleared.json().data.accessoryPricesCustomized).toBe(true);

    // 从没带过配件的新产品：未固化；改名字也不置位；只有显式保存清单才固化。
    const fresh = await createProduct(app, '圆锯-8寸');
    expect(fresh.accessoryPricesCustomized).toBe(false);
    const renamed = await app.inject({
      method: 'PUT',
      url: `/api/products/${fresh.id}`,
      payload: productPayload('圆锯-8寸-改名'),
    });
    expect(renamed.json().data.accessoryPricesCustomized).toBe(false);
    const frozen = await app.inject({
      method: 'PUT',
      url: `/api/products/${fresh.id}`,
      payload: productPayload('圆锯-8寸-定稿', { accessoryPrices: [{ name: '扳手', price: 5 }] }),
    });
    expect(frozen.json().data.accessoryPricesCustomized).toBe(true);
  });

  it('电池矩阵与充电器价格：迁移后自带默认矩阵，保存阅读一致', async () => {
    const { settingsRepository } = await createFixture();
    // v31 迁移已在首次建库时写入默认矩阵（1300/1500/2000 × 5/10/15/20，价格留空）。
    expect(settingsRepository.readBatteryPriceMatrix()).toEqual({
      capacities: [1300, 1500, 2000],
      packCounts: [5, 10, 15, 20],
      prices: [new Array(4).fill(0), new Array(4).fill(0), new Array(4).fill(0)],
    });
    const matrix = settingsRepository.saveBatteryPriceMatrix({ capacities: [1300], packCounts: [5, 10], prices: [[11.5, 0]] });
    expect(matrix.prices).toEqual([[11.5, 0]]);
    expect(settingsRepository.readBatteryPriceMatrix()).toEqual(matrix);

    expect(settingsRepository.readChargerPrices()).toEqual([]);
    const chargers = settingsRepository.saveChargerPrices([
      { name: '1.5A 充电器', price: 6 },
      { name: '', price: 3 },
    ]);
    expect(chargers).toHaveLength(1);
    expect(settingsRepository.readChargerPrices().map((item) => item.name)).toEqual(['1.5A 充电器']);
  });

  it('改类目默认：已有产品固化旧清单且不刷新更新时间，新默认只给之后新建的产品', async () => {
    const { app, repositories, settingsService } = await createFixture();
    settingsService.saveCategoryAccessoryPrices('电锤', [{ name: '9 件套筒', price: 6 }]);

    const existing = await createProduct(app, '电锤-老款', { category: '电锤' });
    expect(existing.accessoryPricesCustomized).toBe(false);
    const beforeUpdatedAt = (repositories.getProduct(existing.id) as { updated_at?: string } | undefined)?.updated_at;

    // 改写默认：老产品固化的是「它现在看到的」旧清单，而不是新模板。
    settingsService.saveCategoryAccessoryPrices('电锤', [
      { name: '9 件套筒', price: 6 },
      { name: '链条', price: 5 },
    ]);
    const frozen = repositories.getProduct(existing.id);
    expect(frozen?.accessoryPricesCustomized).toBe(true);
    expect(frozen?.accessoryPrices.map((item) => item.name)).toEqual(['9 件套筒']);
    expect((frozen as { updated_at?: string } | undefined)?.updated_at).toBe(beforeUpdatedAt);

    // 改完之后新建的产品仍是「未固化」，详情会带出最新的类目默认。
    const fresh = await createProduct(app, '电锤-新款', { category: '电锤' });
    expect(fresh.accessoryPricesCustomized).toBe(false);

    // 别的类目不受影响。
    const other = await createProduct(app, '圆锯-7寸');
    settingsService.saveCategoryAccessoryPrices('电锤', [{ name: '钻头', price: 3 }]);
    expect(repositories.getProduct(other.id)?.accessoryPricesCustomized).toBe(false);
  });

  it('类目配件表：按分类分开存取，互不覆盖', async () => {
    const { settingsRepository } = await createFixture();
    settingsRepository.saveCategoryAccessoryPrices('电锤', [{ name: '9 件套筒', price: 6 }]);
    settingsRepository.saveCategoryAccessoryPrices('链锯', [{ name: '链条', price: 12 }, { name: '', price: 1 }]);
    expect(settingsRepository.readCategoryAccessoryPricesFor('电锤')).toEqual([expect.objectContaining({ name: '9 件套筒', price: 6 })]);
    expect(settingsRepository.readCategoryAccessoryPricesFor('链锯')).toHaveLength(1);
    expect(settingsRepository.readCategoryAccessoryPricesFor(' 电锤 ')).toHaveLength(1);
    expect(settingsRepository.readCategoryAccessoryPrices()).toEqual(
      expect.objectContaining({ 电锤: expect.any(Array), 链锯: expect.any(Array) }),
    );
  });
});
