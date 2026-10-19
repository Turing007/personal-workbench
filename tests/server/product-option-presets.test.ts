import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCT_COLORS, DEFAULT_PRODUCT_PLUGS, PRODUCT_OPTION_LIMIT } from '../../src/shared/product-options';
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
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-product-options-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const repositories = new DatabaseRepositories(database);
  const settings = new SettingsRepository(database);
  const app = Fastify();
  app.addHook('onClose', async () => database.close());
  apps.push(app);
  await registerSettingsRoutes(app, {
    service: new SettingsService(settings, undefined, undefined, undefined, () => repositories.listProductOptionRows()),
  });
  return { app, repositories, settings };
}

function addProduct(repositories: DatabaseRepositories, name: string, colors: string[], batteryPlugs: string[]) {
  repositories.saveProduct({ name, sku: '', specification: '', colors, batteryPlugs } as never);
}

describe('颜色与插脚预设接口', () => {
  it('首次读取按产品库统计并落库，用得多的排在前面', async () => {
    const { app, repositories, settings } = await createFixture();
    expect(settings.readProductOptionPresets()).toBeNull();

    addProduct(repositories, 'A', ['红', '蓝'], ['牧田']);
    addProduct(repositories, 'B', ['红'], ['德伟']);
    addProduct(repositories, 'C', ['红'], ['牧田']);

    const response = await app.inject({ method: 'GET', url: '/api/settings/product-option-presets' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ colors: ['红', '蓝'], plugs: ['牧田', '德伟'] });
    expect(settings.readProductOptionPresets()).toEqual({ colors: ['红', '蓝'], plugs: ['牧田', '德伟'] });
  });

  it('产品库没有历史值时回落到默认三条', async () => {
    const { app } = await createFixture();
    const response = await app.inject({ method: 'GET', url: '/api/settings/product-option-presets' });
    expect(response.json().data).toEqual({ colors: DEFAULT_PRODUCT_COLORS, plugs: DEFAULT_PRODUCT_PLUGS });
  });

  it('用户清空后不再被自动统计覆盖', async () => {
    const { app, repositories } = await createFixture();
    addProduct(repositories, 'A', ['红'], ['牧田']);

    const saved = await app.inject({ method: 'PUT', url: '/api/settings/product-option-presets', payload: { colors: [], plugs: [] } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toEqual({ colors: [], plugs: [] });

    const after = await app.inject({ method: 'GET', url: '/api/settings/product-option-presets' });
    expect(after.json().data).toEqual({ colors: [], plugs: [] });
  });

  it('保存时清洗：去空白、大小写不敏感去重并保留顺序', async () => {
    const { app } = await createFixture();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/product-option-presets',
      payload: { colors: [' 蓝 ', '蓝', 'PV', 'pv', ''], plugs: ['牧田', '  ', '牧田'] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ colors: ['蓝', 'PV'], plugs: ['牧田'] });
  });

  it('超过上限或格式不对返回 400', async () => {
    const { app } = await createFixture();
    const tooMany = await app.inject({
      method: 'PUT',
      url: '/api/settings/product-option-presets',
      payload: { colors: Array.from({ length: PRODUCT_OPTION_LIMIT + 1 }, (_, index) => `色${index}`), plugs: [] },
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.message).toContain('最多 40 条');

    const malformed = await app.inject({ method: 'PUT', url: '/api/settings/product-option-presets', payload: { colors: '红' } });
    expect(malformed.statusCode).toBe(400);
  });

  it('重新统计覆盖手工清单', async () => {
    const { app, repositories } = await createFixture();
    addProduct(repositories, 'A', ['红', '蓝'], ['牧田']);
    await app.inject({ method: 'PUT', url: '/api/settings/product-option-presets', payload: { colors: ['我自己的'], plugs: ['自己的'] } });

    const reseeded = await app.inject({ method: 'POST', url: '/api/settings/product-option-presets/reseed' });
    expect(reseeded.statusCode).toBe(200);
    expect(reseeded.json().data).toEqual({ colors: ['红', '蓝'], plugs: ['牧田'] });
  });
});
