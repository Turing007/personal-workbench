import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';
import { SettingsRepository } from '../../src/server/db/settings-repository';
import { registerSettingsRoutes } from '../../src/server/routes/settings';
import { SettingsService } from '../../src/server/services/settings-service';

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-packaging-presets-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const repositories = new DatabaseRepositories(database);
  const settings = new SettingsRepository(database);
  const app = Fastify();
  app.addHook('onClose', async () => database.close());
  apps.push(app);
  await registerSettingsRoutes(app, {
    service: new SettingsService(settings, undefined, () => repositories.listPackagingRowsForPresets()),
  });
  return { app, repositories, settings };
}

function packaging(innerSize: string, outerSize: string, packCount: number, purchasePrice: number | null, name = '牛皮纸盒') {
  return { name, innerSize, outerSize, packCount, purchasePrice };
}

async function addProduct(repositories: DatabaseRepositories, name: string, rows: ReturnType<typeof packaging>[]) {
  repositories.saveProduct({ name, sku: '', specification: '', packaging: rows } as never);
}

describe('包装预设接口', () => {
  it('首次读取时按现有包装记录自动统计并落库', async () => {
    const { app, repositories, settings } = await createFixture();
    expect(settings.readPackagingPresets()).toBeNull();

    await addProduct(repositories, '逆变器A', [packaging('45*9*9', '47*48*36', 20, null)]);
    await addProduct(repositories, '逆变器B', [packaging('45*9*9', '47*48*36', 20, null)]);
    await addProduct(repositories, '逆变器C', [packaging('23*22*9.5', '50*47*23', 10, 2, '彩盒包装')]);

    const response = await app.inject({ method: 'GET', url: '/api/settings/packaging-presets' });
    expect(response.statusCode).toBe(200);
    const items = response.json().data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    // 用得最多的组合排第一，名称取该组合里最常见的包装名。
    expect(items[0]).toMatchObject({ name: '牛皮纸盒', innerSize: '45*9*9', outerSize: '47*48*36', packSize: 20 });
    expect(items[1]).toMatchObject({ name: '彩盒包装', innerSize: '23*22*9.5', purchasePrice: '2' });
    // 统计结果会写回设置表，之后以用户维护的版本为准。
    expect(settings.readPackagingPresets()).toHaveLength(2);
  });

  it('用户清空预设后不再被自动统计覆盖', async () => {
    const { app, repositories } = await createFixture();
    await addProduct(repositories, '逆变器A', [packaging('45*9*9', '47*48*36', 20, null)]);

    const saved = await app.inject({ method: 'PUT', url: '/api/settings/packaging-presets', payload: { items: [] } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.items).toEqual([]);

    const after = await app.inject({ method: 'GET', url: '/api/settings/packaging-presets' });
    expect(after.json().data.items).toEqual([]);
  });

  it('保存时清洗字段：装箱数兜到 1，全空行丢弃', async () => {
    const { app } = await createFixture();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/packaging-presets',
      payload: {
        items: [
          { id: 'a', name: '牛皮纸盒', innerSize: '45*9*9', outerSize: '47*48*36', packSize: 0, purchasePrice: '2' },
          { id: 'b', name: '', innerSize: '', outerSize: '', packSize: 1, purchasePrice: '' },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const items = response.json().data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'a', packSize: 1, purchasePrice: '2' });
  });

  it('超过上限或格式不对返回 400', async () => {
    const { app } = await createFixture();
    const tooMany = { items: Array.from({ length: 13 }, (_, index) => ({ name: `预设${index}`, innerSize: '10*10*10', outerSize: '50*50*50', packSize: 10, purchasePrice: '' })) };
    const rejected = await app.inject({ method: 'PUT', url: '/api/settings/packaging-presets', payload: tooMany });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.message).toContain('最多 12 条');

    const malformed = await app.inject({ method: 'PUT', url: '/api/settings/packaging-presets', payload: { items: {} } });
    expect(malformed.statusCode).toBe(400);
  });

  it('重新统计会覆盖手工维护的列表', async () => {
    const { app, repositories } = await createFixture();
    await addProduct(repositories, '逆变器A', [packaging('45*9*9', '47*48*36', 20, null)]);
    await app.inject({
      method: 'PUT',
      url: '/api/settings/packaging-presets',
      payload: { items: [{ name: '我自己的', innerSize: '1*1*1', outerSize: '', packSize: 3, purchasePrice: '' }] },
    });

    const reseeded = await app.inject({ method: 'POST', url: '/api/settings/packaging-presets/reseed' });
    expect(reseeded.statusCode).toBe(200);
    const items = reseeded.json().data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: '牛皮纸盒', innerSize: '45*9*9', outerSize: '47*48*36', packSize: 20 });
  });
});
