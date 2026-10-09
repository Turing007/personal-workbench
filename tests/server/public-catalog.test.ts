import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { CatalogRepository } from '../../src/server/db/catalog-repository';
import { DatabaseRepositories, type ProductInput } from '../../src/server/db/repositories';
import { SettingsRepository } from '../../src/server/db/settings-repository';
import { FileStore } from '../../src/server/files/file-store';
import { CatalogService } from '../../src/server/services/catalog-service';
import { registerCatalogRoutes } from '../../src/server/routes/catalogs';
import { registerPublicCatalogRoutes } from '../../src/server/routes/public-catalog';
import { registerProductRoutes } from '../../src/server/routes/products';

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-public-catalog-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const repositories = new DatabaseRepositories(database);
  const settingsRepository = new SettingsRepository(database);
  const catalogRepository = new CatalogRepository(database);
  const service = new CatalogService(catalogRepository, {
    listProductRows: () => repositories.listProducts(),
    settingsRepository,
  });
  const app = Fastify();
  app.addHook('onClose', async () => database.close());
  await registerCatalogRoutes(app, { service });
  await registerPublicCatalogRoutes(app, { service, fileStore: new FileStore(join(directory, 'files')) });
  // 「编辑器勾选添加到图册」走产品保存接口：这里同时挂上产品路由（与线上接线一致）。
  await registerProductRoutes(app, { repositories, catalogRepository });
  apps.push(app);
  return { app, repositories, settingsRepository, catalogRepository, database };
}

function productInput(name: string, sku: string, overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name,
    sku,
    specification: '',
    parameters: '额定功率：800W',
    category: '圆锯',
    purchasePrice: 128.5,
    supplier: '东莞某某五金厂',
    colors: ['蓝'],
    batteryPlugs: ['牧田'],
    accessories: '锯片40齿 7',
    remark: '内部备注，不外发',
    status: 'active',
    packaging: [{ name: '中性彩盒', innerSize: '10.5*10.5*7', innerWeight: 0.4, outerSize: '62*37*23', outerWeight: 12.5, packCount: 50, purchasePrice: 3.2 }],
    ...overrides,
  } as ProductInput;
}

async function createCatalog(app: FastifyInstance, name: string, productIds: number[]) {
  const response = await app.inject({ method: 'POST', url: '/api/catalogs', payload: { name, productIds } });
  expect(response.statusCode).toBe(201);
  return response.json().data as { id: number; token: string };
}

describe('产品图册（在线链接版）', () => {
  it('新建/列表/明细：链接为随机长 token，明细带回有序选品', async () => {
    const { app, repositories } = await createFixture();
    const first = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101'));
    const second = repositories.saveProduct(productInput('圆锯-9寸', 'VT-9102'));
    const catalog = await createCatalog(app, '2026 主推图册', [Number((second as { id?: number }).id), Number((first as { id?: number }).id)]);
    expect(catalog.token).toMatch(/^[A-Za-z0-9_-]{16,}$/);

    const list = (await app.inject({ method: 'GET', url: '/api/catalogs' })).json().data.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: '2026 主推图册', enabled: true, itemCount: 2, viewCount: 0 });

    const detail = (await app.inject({ method: 'GET', url: `/api/catalogs/${catalog.id}` })).json().data;
    // 顺序按创建时传入的 ids，不按大小重排。
    expect(detail.productIds).toEqual([Number((second as { id?: number }).id), Number((first as { id?: number }).id)]);
  });

  it('校验：名称必填、至少一个产品、产品必须存在', async () => {
    const { app, repositories } = await createFixture();
    const saved = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101'));
    const id = Number((saved as { id?: number }).id);
    expect((await app.inject({ method: 'POST', url: '/api/catalogs', payload: { name: '  ', productIds: [id] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/catalogs', payload: { name: '图册', productIds: [] } })).statusCode).toBe(400);
    const missing = await app.inject({ method: 'POST', url: '/api/catalogs', payload: { name: '图册', productIds: [424242] } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('CATALOG_PRODUCT_NOT_FOUND');
  });

  it('公开页：不需要登录即可看到产品与公司信息；供应商/价格/备注一律不出现', async () => {
    const { app, repositories, settingsRepository } = await createFixture();
    settingsRepository.saveCompanyProfile({ name: '维高工具', phone: '13800000000', address: '深圳市宝安区', wechatQrRelativePath: 'company-qrs/qr.png' });
    const saved = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101'));
    // 服务端会把 SKU 按自有规则重新编号：按回填的真实 SKU 断言。
    const savedSku = String((saved as { sku?: unknown }).sku ?? '');
    expect(savedSku).not.toBe('');
    const catalog = await createCatalog(app, '主推图册', [Number((saved as { id?: number }).id)]);

    const page = await app.inject({ method: 'GET', url: `/c/${catalog.token}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    const html = page.body;
    expect(html).toContain('圆锯-7寸');
    expect(html).toContain(savedSku);
    expect(html).toContain('额定功率');
    expect(html).toContain('中性彩盒');
    expect(html).toContain('维高工具');
    expect(html).toContain('13800000000');
    // 封面：固定描述语 + 二维码下的「点击放大」提示；电话与地址不再出现在封面上（电话仍在底部吸条）。
    expect(html).toContain('500+款锂电工具，外贸跨境一站式解决。');
    expect(html).toContain('扫码加微信');
    expect(html).toContain('点击放大');
    expect(html).not.toContain('深圳市宝安区');
    for (const secret of ['东莞某某五金厂', '128.5', '锯片40齿', '内部备注', '3.2']) {
      expect(html).not.toContain(secret);
    }
  });

  it('加品即见：改选品保存后同一链接立即显示新产品', async () => {
    const { app, repositories } = await createFixture();
    const first = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101'));
    const second = repositories.saveProduct(productInput('新品-锂电钻', 'VT-9201'));
    const catalog = await createCatalog(app, '主推图册', [Number((first as { id?: number }).id)]);
    expect((await app.inject({ method: 'GET', url: `/c/${catalog.token}` })).body).not.toContain('新品-锂电钻');

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/catalogs/${catalog.id}`,
      payload: { productIds: [Number((first as { id?: number }).id), Number((second as { id?: number }).id)] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.itemCount).toBe(2);
    expect((await app.inject({ method: 'GET', url: `/c/${catalog.token}` })).body).toContain('新品-锂电钻');
  });

  it('停用后链接立即 404；重新启用恢复', async () => {
    const { app, repositories } = await createFixture();
    const saved = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101'));
    const catalog = await createCatalog(app, '主推图册', [Number((saved as { id?: number }).id)]);

    await app.inject({ method: 'PUT', url: `/api/catalogs/${catalog.id}`, payload: { enabled: false } });
    const disabled = await app.inject({ method: 'GET', url: `/c/${catalog.token}` });
    expect(disabled.statusCode).toBe(404);
    expect(disabled.body).toContain('不可用');

    await app.inject({ method: 'PUT', url: `/api/catalogs/${catalog.id}`, payload: { enabled: true } });
    expect((await app.inject({ method: 'GET', url: `/c/${catalog.token}` })).statusCode).toBe(200);
  });

  it('乱码/不存在的 token 打不开；打开次数只在成功打开时记一次', async () => {
    const { app, repositories } = await createFixture();
    const saved = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101'));
    const catalog = await createCatalog(app, '主推图册', [Number((saved as { id?: number }).id)]);

    expect((await app.inject({ method: 'GET', url: '/c/短码' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/c/AAAAAAAAAAAAAAAAAAAAAAAA' })).statusCode).toBe(404);
    const before = (await app.inject({ method: 'GET', url: '/api/catalogs' })).json().data.items[0];
    expect(before.viewCount).toBe(0);

    await app.inject({ method: 'GET', url: `/c/${catalog.token}` });
    await app.inject({ method: 'GET', url: `/c/${catalog.token}` });
    const after = (await app.inject({ method: 'GET', url: '/api/catalogs' })).json().data.items[0];
    expect(after.viewCount).toBe(2);
    expect(typeof after.lastViewedAt).toBe('string');
  });

  it('图片按 token 校验：产品不在本图册或缺图时 404', async () => {
    const { app, repositories } = await createFixture();
    const saved = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101'));
    const other = repositories.saveProduct(productInput('不在册的产品', 'VT-9999'));
    const catalog = await createCatalog(app, '主推图册', [Number((saved as { id?: number }).id)]);
    // 未配缩略图服务时统一 404；关键是别的产品 id 不能借这条链接取图。
    expect((await app.inject({ method: 'GET', url: `/c/${catalog.token}/img/${Number((other as { id?: number }).id)}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/c/${catalog.token}/img/${Number((saved as { id?: number }).id)}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/c/AAAAAAAAAAAAAAAAAAAAAAAA/img/1' })).statusCode).toBe(404);
  });

  it('在线图册不设数量上限：超过 200 个产品也能建、能看', async () => {
    const { app, repositories } = await createFixture();
    const ids: number[] = [];
    for (let index = 0; index < 205; index += 1) {
      const saved = repositories.saveProduct(productInput(`批量产品 ${index}`, `VT-9${String(index).padStart(3, '0')}`));
      ids.push(Number((saved as { id?: number }).id));
    }
    const catalog = await createCatalog(app, '全量图册', ids);
    const list = (await app.inject({ method: 'GET', url: '/api/catalogs' })).json().data.items;
    expect(list[0].itemCount).toBe(205);
    const page = await app.inject({ method: 'GET', url: `/c/${catalog.token}` });
    expect(page.statusCode).toBe(200);
    expect((page.body.split('<h3>').length - 1)).toBeGreaterThanOrEqual(205);
  });

  it('删除图册后列表清空、链接失效', async () => {
    const { app, repositories } = await createFixture();
    const saved = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101'));
    const catalog = await createCatalog(app, '主推图册', [Number((saved as { id?: number }).id)]);
    expect((await app.inject({ method: 'DELETE', url: `/api/catalogs/${catalog.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/catalogs' })).json().data.items).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: `/c/${catalog.token}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/catalogs/${catalog.id}` })).statusCode).toBe(404);
  });

  it('新品分区：起算日前的老条目不算新品；重新保存保留加入时间，同一链接里新品排前', async () => {
    const { app, repositories, database } = await createFixture();
    const oldProduct = repositories.saveProduct(productInput('老款圆锯', 'VT-9101'));
    const freshProduct = repositories.saveProduct(productInput('新款锂电钻', 'VT-9201'));
    const oldId = Number((oldProduct as { id?: number }).id);
    const freshId = Number((freshProduct as { id?: number }).id);
    const catalog = await createCatalog(app, '主推图册', [oldId]);
    // 把老条目回拨到起算日（2026-10-10）之前：它不该算新品。
    database.prepare("UPDATE catalog_items SET created_at = '2025-01-01T00:00:00.000Z'").run();

    const before = (await app.inject({ method: 'GET', url: `/c/${catalog.token}` })).body;
    expect(before).not.toContain('id="new-arrivals"');
    expect(before).not.toContain('>新品<');

    // 重新保存：老品保留旧加入时间，新品按本次加入时间进「新品」。
    await app.inject({
      method: 'PUT',
      url: `/api/catalogs/${catalog.id}`,
      payload: { productIds: [oldId, freshId] },
    });
    // 起算日之前（含建册当天的批量存量）都不算新品，把这条新加的拨到起算日之后。
    database.prepare("UPDATE catalog_items SET created_at = '2026-10-10T02:00:00.000Z' WHERE product_id = ?").run(freshId);
    const after = (await app.inject({ method: 'GET', url: `/c/${catalog.token}` })).body;
    expect(after).toContain('id="new-arrivals"');
    expect(after).toContain('>新品<');
    // 新品分区 + 分类分区：老款只在分类里出现一次，新款出现两次（新品 + 分类）。
    // 名字还会出现在 alt 与详情 JSON 里，所以按 <h3> 精确计数。
    expect(after.split('<h3>老款圆锯</h3>').length - 1).toBe(1);
    expect(after.split('<h3>新款锂电钻</h3>').length - 1).toBe(2);
  });

  it('编辑器「添加到产品图册」：保存产品时追加进所选图册，重复保存不重复加', async () => {
    const { app, repositories, catalogRepository } = await createFixture();
    const first = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101'));
    const firstId = Number((first as { id?: number }).id);
    const catalog = await createCatalog(app, '主推图册', [firstId]);

    // 新建产品时带上 addToCatalogId：产品保存成功，并追加到图册末尾。
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { ...productInput('新款锂电钻', 'VT-9201'), addToCatalogId: catalog.id },
    });
    expect(created.statusCode).toBe(201);
    const createdId = Number(created.json().data.id);
    expect(catalogRepository.listItemProductIds(catalog.id)).toEqual([firstId, createdId]);

    // 再编辑一次仍带勾选：已在册不重复加。
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/products/${createdId}`,
      payload: { ...productInput('新款锂电钻-改名', 'VT-9201'), addToCatalogId: catalog.id },
    });
    expect(updated.statusCode).toBe(200);
    expect(catalogRepository.listItemProductIds(catalog.id)).toEqual([firstId, createdId]);
  });

  it('「添加到产品图册」的图册不存在时：产品照常保存成功，图册不动', async () => {
    const { app, repositories, catalogRepository } = await createFixture();
    const saved = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101'));
    const catalog = await createCatalog(app, '主推图册', [Number((saved as { id?: number }).id)]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { ...productInput('新款锂电钻', 'VT-9201'), addToCatalogId: 424242 },
    });
    expect(response.statusCode).toBe(201);
    expect(catalogRepository.listItemProductIds(catalog.id)).toHaveLength(1);
  });
});
