import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';
import { FileStore } from '../../src/server/files/file-store';
import { registerProductRoutes } from '../../src/server/routes/products';

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-product-status-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const repositories = new DatabaseRepositories(database);
  const app = Fastify();
  app.addHook('onClose', async () => database.close());
  await app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } });
  await registerProductRoutes(app, { repositories, fileStore: new FileStore(join(directory, 'files')) });
  apps.push(app);
  return { app, repositories };
}

function productInput(name: string, sku = '') {
  return { name, sku, specification: '标准规格', packaging: [{ name: '彩盒包装', packCount: 10 }] } as never;
}

function statusOf(repositories: DatabaseRepositories, id: number) {
  return (repositories.getProduct(id) as { status?: string }).status;
}

describe('产品停售状态', () => {
  it('停售与恢复在售只改状态，不刷新更新时间', async () => {
    const { app, repositories } = await createFixture();
    const saved = repositories.saveProduct(productInput('冲击扳手', 'VT-9001')) as { id?: number };
    const id = Number(saved.id);
    const before = repositories.getProduct(id) as { updated_at?: string };

    const off = await app.inject({ method: 'POST', url: `/api/products/${id}/status`, payload: { status: 'discontinued' } });
    expect(off.statusCode).toBe(200);
    expect(off.json().data.status).toBe('discontinued');
    expect(statusOf(repositories, id)).toBe('discontinued');
    // 产品库按「最近更新」排序，改状态不能让老品窜到最前。
    expect((repositories.getProduct(id) as { updated_at?: string }).updated_at).toBe(before.updated_at);

    const on = await app.inject({ method: 'POST', url: `/api/products/${id}/status`, payload: { status: 'active' } });
    expect(on.json().data.status).toBe('active');
    expect(statusOf(repositories, id)).toBe('active');
  });

  it('状态接口拒绝草稿值与不存在的产品', async () => {
    const { app, repositories } = await createFixture();
    const id = Number((repositories.saveProduct(productInput('逆变器')) as { id?: number }).id);

    const bad = await app.inject({ method: 'POST', url: `/api/products/${id}/status`, payload: { status: 'draft' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain('在售');

    const missing = await app.inject({ method: 'POST', url: '/api/products/999999/status', payload: { status: 'discontinued' } });
    expect(missing.statusCode).toBe(404);
  });

  it('列表可按停售筛选，未知状态值当作在售兜底', async () => {
    const { app, repositories } = await createFixture();
    const kept = Number((repositories.saveProduct(productInput('在售品', 'VT-9002')) as { id?: number }).id);
    const stopped = Number((repositories.saveProduct(productInput('停售品', 'VT-9003')) as { id?: number }).id);
    await app.inject({ method: 'POST', url: `/api/products/${stopped}/status`, payload: { status: 'discontinued' } });

    const stoppedList = await app.inject({ method: 'GET', url: '/api/products?status=discontinued' });
    expect(stoppedList.json().data.items.map((item: { id: number }) => item.id)).toEqual([stopped]);
    const activeList = await app.inject({ method: 'GET', url: '/api/products?status=active' });
    expect(activeList.json().data.items.map((item: { id: number }) => item.id)).toEqual([kept]);

    // 老客户端传了不认识的 status 值：不筛选，而不是报错或返回空。
    const odd = await app.inject({ method: 'GET', url: '/api/products?status=archived' });
    expect(odd.json().data.total).toBe(2);
  });

  it('编辑保存可以把停售状态原样写回', async () => {
    const { app, repositories } = await createFixture();
    const id = Number((repositories.saveProduct(productInput('马刀锯', 'VT-9004')) as { id?: number }).id);
    await app.inject({ method: 'POST', url: `/api/products/${id}/status`, payload: { status: 'discontinued' } });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/products/${id}`,
      payload: { name: '马刀锯 5 档', category: '马刀锯', status: 'discontinued', packaging: [{ name: '彩盒包装', packCount: 10 }] },
    });
    expect(updated.statusCode).toBe(200);
    expect(statusOf(repositories, id)).toBe('discontinued');
  });

  it('导入同 SKU 时匹配停售产品并保留其状态，不再长出重复 SKU', async () => {
    const { repositories } = await createFixture();
    const id = Number((repositories.saveProduct(productInput('吹风机')) as { id?: number }).id);
    // 新建产品的 SKU 由服务端按 VT-#### 生成，导入要用真实回填的那个。
    const sku = String((repositories.getProduct(id) as { sku?: string }).sku);
    repositories.setProductStatus(id, 'discontinued');

    const result = repositories.importProducts([{
      sourceSku: sku,
      product: { name: '吹风机 1800W', sku, specification: '新规格', status: 'active', packaging: [{ name: '彩盒包装', packCount: 12 }] } as never,
    }]);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(repositories.listProducts({ sku })).toHaveLength(1);
    expect(statusOf(repositories, id)).toBe('discontinued');
    expect((repositories.getProduct(id) as { name?: string }).name).toBe('吹风机 1800W');
  });
});
