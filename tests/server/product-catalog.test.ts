import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories, type ProductInput } from '../../src/server/db/repositories';
import { FileStore } from '../../src/server/files/file-store';
import { registerProductRoutes } from '../../src/server/routes/products';
import { parseParameterRows } from '../../src/server/documents/product-catalog-template';

const directories: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-catalog-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const repositories = new DatabaseRepositories(database);
  const app = Fastify();
  app.addHook('onClose', async () => database.close());
  await app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } });
  // 用假渲染器替代 Playwright：记录排版出的 HTML，返回固定 PDF 字节。
  const rendered: string[] = [];
  await registerProductRoutes(app, {
    repositories,
    fileStore: new FileStore(join(directory, 'files')),
    pdfRenderer: {
      render: async (html: string) => {
        rendered.push(html);
        return Buffer.from('%PDF-fake-catalog');
      },
    },
  });
  apps.push(app);
  return { app, repositories, rendered };
}

function productInput(name: string, sku: string, overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name,
    sku,
    specification: '',
    parameters: '',
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

function pages(html: string) {
  return html.split('<section class="page"').slice(1);
}

describe('产品图册', () => {
  it('参数文本按实测的三种写法拆成两列', () => {
    const rows = parseParameterRows([
      '电机类型：5230无刷电机',
      '额定功率:800W',
      '额定电压21v',
      '最大切割深度：57mm（90°）',
      '               41mm（45°）',
    ].join('\n'));
    expect(rows).toEqual([
      { label: '电机类型', value: '5230无刷电机' },
      { label: '额定功率', value: '800W' },
      { label: '额定电压', value: '21v' },
      // 缩进的续行属于上一项，不能变成独立字段
      { label: '最大切割深度', value: '57mm（90°） 41mm（45°）' },
    ]);
  });

  it('客户版图册不含供应商、价格与配件', async () => {
    const { app, repositories, rendered } = await createFixture();
    const saved = repositories.saveProduct(productInput('圆锯-7寸', 'VT-9101', { parameters: '额定功率：800W' }));
    const response = await app.inject({
      method: 'POST',
      url: '/api/products/catalog',
      payload: { ids: [Number((saved as { id?: number }).id)] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    const html = rendered[0];
    expect(html).toContain('额定功率');
    expect(html).toContain('800W');
    expect(html).toContain('中性彩盒');
    expect(html).toContain('装箱 50');
    // 内盒/外箱重量是客户要算运费的，属于图册内容；成本类字段才是秘密。
    for (const secret of ['东莞某某五金厂', '128.5', '锯片40齿', '内部备注', '3.2']) {
      expect(html).not.toContain(secret);
    }
  });

  it('按内容量装箱，每页产品数落在 4～8 个之间', async () => {
    const { app, repositories, rendered } = await createFixture();
    const ids: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      // 交替给「参数饱满」和「只有一行」两种产品，装箱要能混排。
      const long = index % 3 === 0;
      const saved = repositories.saveProduct(productInput(`产品 ${index}`, `VT-92${index}`, {
        parameters: long
          ? ['额定功率：800W', '空载转速：4000rpm', '锯片尺寸：185*20mm', '最大切割深度：57mm', '净重：2.1kg', '电压：21V', '噪音：92dB', '防护等级：IPX4'].join('\n')
          : '额定功率：800W',
      }));
      ids.push(Number((saved as { id?: number }).id));
    }

    const response = await app.inject({ method: 'POST', url: '/api/products/catalog', payload: { ids, density: 'standard' } });
    expect(response.statusCode).toBe(200);
    const sheets = pages(rendered[0]);
    expect(sheets.length).toBeGreaterThan(1);
    for (const sheet of sheets) {
      const cells = (sheet.match(/<div class="cell"/g) ?? []).length;
      expect(cells).toBeGreaterThanOrEqual(4);
      expect(cells).toBeLessThanOrEqual(8);
    }
    // 每页格子总数不能超过产品数，装箱不能凭空重复。
    expect(sheets.reduce((sum, sheet) => sum + (sheet.match(/<div class="cell"/g) ?? []).length, 0)).toBe(30);
  });

  it('没有可选产品时报错，不渲染空图册', async () => {
    const { app } = await createFixture();
    const empty = await app.inject({ method: 'POST', url: '/api/products/catalog', payload: { ids: [] } });
    expect(empty.statusCode).toBe(400);
    const missing = await app.inject({ method: 'POST', url: '/api/products/catalog', payload: { ids: [424242] } });
    expect(missing.statusCode).toBe(404);
  });
});
