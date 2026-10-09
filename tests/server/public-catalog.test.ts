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
  apps.push(app);
  return { app, repositories, settingsRepository, catalogRepository };
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
    settingsRepository.saveCompanyProfile({ name: '维高工具', phone: '13800000000', address: '深圳市宝安区' });
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

  it('删除图册后列表清空、链接失效', async () => {
    const { app, repositories } = await createFixture();
    const saved = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101'));
    const catalog = await createCatalog(app, '主推图册', [Number((saved as { id?: number }).id)]);
    expect((await app.inject({ method: 'DELETE', url: `/api/catalogs/${catalog.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/catalogs' })).json().data.items).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: `/c/${catalog.token}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/catalogs/${catalog.id}` })).statusCode).toBe(404);
  });
});
