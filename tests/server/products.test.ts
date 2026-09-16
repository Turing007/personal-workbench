import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';
import { FileStore } from '../../src/server/files/file-store';
import { registerProductRoutes } from '../../src/server/routes/products';

const directories: string[] = [];
const apps: FastifyInstance[] = [];

async function makeRepositories(): Promise<{ repositories: DatabaseRepositories; close: () => void }> {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-products-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  return { repositories: new DatabaseRepositories(database), close: () => database.close() };
}

const productInput = (name: string, sku = '') => ({
  name,
  sku,
  specification: '标准规格',
  packaging: [{ name: '彩盒包装', packCount: 10 }],
});

async function makeProductApp(): Promise<{ app: FastifyInstance; repositories: DatabaseRepositories; close: () => void }> {
  const context = await makeRepositories();
  const app = Fastify();
  await app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } });
  const fileStore = new FileStore(join(directories[directories.length - 1], 'files'));
  await registerProductRoutes(app, { repositories: context.repositories, fileStore });
  apps.push(app);
  return { app, repositories: context.repositories, close: context.close };
}

function binaryUpload(filename: string, content: string, category = 'manual') {
  const boundary = `----workbench-attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    url: `/api/products/1/attachments?category=${category}`,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(content),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

function excelUpload(workbook: XLSX.WorkBook, filename = 'products.xlsx') {
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const boundary = `----workbench-products-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

function importWorkbook(products: unknown[][], packaging: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(products), '产品');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(packaging), '包装');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['产品库 Excel 导入模板']]), '说明');
  return workbook;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('产品库 SKU', () => {
  it('新增产品从 VT-0001 开始自动生成 SKU，并忽略前端传入值', async () => {
    const { repositories, close } = await makeRepositories();

    const product = repositories.saveProduct(productInput('第一个产品', 'CUSTOM-SKU'));

    expect(product?.sku).toBe('VT-0001');
    close();
  });

  it('根据现有 VT-数字 SKU 的最大值递增，不复用删除后的编号', async () => {
    const { repositories, close } = await makeRepositories();

    const first = repositories.saveProduct(productInput('第一个产品'))!;
    const second = repositories.saveProduct(productInput('第二个产品'))!;
    expect(first.sku).toBe('VT-0001');
    expect(second.sku).toBe('VT-0002');

    repositories.deleteProduct(Number(second.id));
    const third = repositories.saveProduct(productInput('第三个产品'));

    expect(third?.sku).toBe('VT-0003');
    close();
  });

  it('只识别严格的 VT-数字格式，并在编辑时保留原 SKU', async () => {
    const { repositories, close } = await makeRepositories();
    const database = (repositories as unknown as { database: import('node:sqlite').DatabaseSync }).database;

    const timestamp = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO products
          (name, sku, specification, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('历史产品', 'VT-0007', '历史规格', timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO products
          (name, sku, specification, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('自定义产品', 'VT-ABC', '自定义规格', timestamp, timestamp);

    const next = repositories.saveProduct(productInput('新产品'))!;
    expect(next.sku).toBe('VT-0008');

    const edited = repositories.saveProduct(productInput('修改后的产品', 'VT-0999'), Number(next.id))!;
    expect(edited.sku).toBe('VT-0008');
    close();
  });

  it('新增产品保存并返回多行参数', async () => {
    const { repositories, close } = await makeRepositories();
    const parameters = '扭矩：35N·m\n转速：0-1500rpm\n额定电压：12V';

    const product = repositories.saveProduct({ ...productInput('参数产品'), parameters });

    expect(product?.parameters).toBe(parameters);
    close();
  });

  it('更新产品参数并支持清空', async () => {
    const { repositories, close } = await makeRepositories();
    const created = repositories.saveProduct({ ...productInput('待编辑产品'), parameters: '初始参数' })!;

    const updated = repositories.saveProduct(
      { ...productInput('待编辑产品'), parameters: '第一行\n第二行' },
      Number(created.id),
    );
    expect(updated?.parameters).toBe('第一行\n第二行');

    const cleared = repositories.saveProduct({ ...productInput('待编辑产品'), parameters: '' }, Number(created.id));
    expect(cleared?.parameters).toBe('');
    close();
  });
});

describe('产品参数路由校验', () => {
  it('历史 products 表缺少 accessories 列时会被迁移补齐', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-products-legacy-'));
    directories.push(directory);
    const database = openDatabase(join(directory, 'workbench.sqlite'));
    database.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sku TEXT NOT NULL DEFAULT '',
        specification TEXT NOT NULL DEFAULT '',
        parameters TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        purchase_price REAL,
        supplier TEXT NOT NULL DEFAULT '',
        colors_json TEXT NOT NULL DEFAULT '[]',
        battery_plugs_json TEXT NOT NULL DEFAULT '[]',
        remark TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    migrateDatabase(database);

    const columns = database.prepare('PRAGMA table_info(products)').all().map((row: { name?: unknown }) => String(row.name));
    expect(columns).toContain('accessories');
    const repositories = new DatabaseRepositories(database);
    const saved = repositories.saveProduct({ ...productInput('历史产品'), accessories: '充电器' });
    expect(saved?.accessories).toBe('充电器');
    database.close();
  });

  it('创建和更新时保留多行参数，并将缺省参数归一为空字符串', async () => {
    const { app, repositories, close } = await makeProductApp();
    const parameters = '扭矩：35N·m\n转速：0-1500rpm';
    const accessories = '充电器\n备用电池';
    const payload = { ...productInput('路由产品'), parameters, accessories };

    const created = await app.inject({ method: 'POST', url: '/api/products', payload });
    expect(created.statusCode).toBe(201);
    const createdProduct = created.json().data;
    expect(createdProduct.parameters).toBe(parameters);
    expect(createdProduct.accessories).toBe(accessories);

    const fetched = await app.inject({ method: 'GET', url: `/api/products/${createdProduct.id}` });
    expect(fetched.json().data.parameters).toBe(parameters);
    expect(fetched.json().data.accessories).toBe(accessories);

    const cleared = await app.inject({
      method: 'PUT',
      url: `/api/products/${createdProduct.id}`,
      payload: { ...productInput('路由产品'), parameters: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data.parameters).toBe('');

    const missing = await app.inject({ method: 'POST', url: '/api/products', payload: productInput('缺省参数') });
    expect(missing.statusCode).toBe(201);
    expect(missing.json().data.parameters).toBe('');
    expect(repositories.getProduct(Number(missing.json().data.id))?.parameters).toBe('');
    close();
  });

  it.each([
    ['数字', 123],
    ['数组', ['扭矩：35N·m']],
    ['对象', { torque: '35N·m' }],
  ])('拒绝参数为%s', async (_label, parameters) => {
    const { app, close } = await makeProductApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { ...productInput('非法参数'), parameters },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', field: 'parameters' },
    });
    close();
  });

  it('按请求顺序更新产品图片，并将第一张作为封面', async () => {
    const { app, repositories, close } = await makeProductApp();
    const product = repositories.saveProduct(productInput('图片排序产品'))!;
    const first = repositories.addProductImage(Number(product.id), {
      relativePath: 'product-images/first.png',
      originalName: '第一张.png',
      mimeType: 'image/png',
      size: 10,
    });
    const second = repositories.addProductImage(Number(product.id), {
      relativePath: 'product-images/second.png',
      originalName: '第二张.png',
      mimeType: 'image/png',
      size: 20,
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/api/products/${product.id}/images/order`,
      payload: { imageIds: [Number((second as { id: number }).id), Number((first as { id: number }).id)] },
    });

    expect(response.statusCode).toBe(200);
    expect(repositories.getProduct(Number(product.id))?.images.map((image) => image.id)).toEqual([
      Number((second as { id: number }).id),
      Number((first as { id: number }).id),
    ]);
    close();
  });
});

function imageUpload(url: string, filename: string, content: string) {
  const boundary = `----workbench-product-image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    url,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from(content),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe('产品图片分类', () => {
  it('上传图片时按分类归档并保存备注，未指定分类时归为产品图', async () => {
    const { app, repositories, close } = await makeProductApp();
    const product = repositories.saveProduct(productInput('图片分类产品'))!;

    const dimension = await app.inject({
      method: 'POST',
      ...imageUpload(`/api/products/${product.id}/images?category=dimension&note=${encodeURIComponent('客户A要求补拍侧面')}`, '尺寸图.png', 'dimension-bytes'),
    });
    expect(dimension.statusCode).toBe(201);
    expect(dimension.json().data).toMatchObject({ category: 'dimension', note: '客户A要求补拍侧面' });

    const fallback = await app.inject({
      method: 'POST',
      ...imageUpload(`/api/products/${product.id}/images`, '主图.png', 'default-bytes'),
    });
    expect(fallback.statusCode).toBe(201);
    expect(fallback.json().data).toMatchObject({ category: 'product', note: '' });

    const images = repositories.getProduct(Number(product.id))?.images ?? [];
    expect(images.map((image) => [image.category, image.note])).toEqual([
      ['dimension', '客户A要求补拍侧面'],
      ['product', ''],
    ]);
    close();
  });

  it('拒绝未知分类与超长备注，且不写入图片记录', async () => {
    const { app, repositories, close } = await makeProductApp();
    const product = repositories.saveProduct(productInput('图片校验产品'))!;

    const invalidCategory = await app.inject({
      method: 'POST',
      ...imageUpload(`/api/products/${product.id}/images?category=unknown`, '图.png', 'bytes'),
    });
    expect(invalidCategory.statusCode).toBe(400);
    expect(invalidCategory.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', field: 'category' } });

    const tooLongNote = await app.inject({
      method: 'POST',
      ...imageUpload(`/api/products/${product.id}/images?note=${encodeURIComponent('备'.repeat(201))}`, '图.png', 'bytes'),
    });
    expect(tooLongNote.statusCode).toBe(400);
    expect(tooLongNote.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', field: 'note' } });

    expect(repositories.getProduct(Number(product.id))?.images).toEqual([]);
    close();
  });

  it('支持修改已有图片的分类和备注', async () => {
    const { app, repositories, close } = await makeProductApp();
    const product = repositories.saveProduct(productInput('图片改分类产品'))!;
    const image = repositories.addProductImage(Number(product.id), {
      relativePath: 'product-images/customer-shot.png',
      originalName: '客户实拍.png',
      mimeType: 'image/png',
      size: 12,
    });
    const imageId = Number((image as { id: number }).id);
    const url = `/api/products/${product.id}/images/${imageId}`;

    const patched = await app.inject({ method: 'PATCH', url, payload: { category: 'customer', note: '客户B 2026-03 实拍' } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data).toMatchObject({ category: 'customer', note: '客户B 2026-03 实拍' });

    // 只改备注时保留原分类。
    const noteOnly = await app.inject({ method: 'PATCH', url, payload: { note: '客户B 追加白底图' } });
    expect(noteOnly.statusCode).toBe(200);
    expect(noteOnly.json().data).toMatchObject({ category: 'customer', note: '客户B 追加白底图' });

    const invalidCategory = await app.inject({ method: 'PATCH', url, payload: { category: 'unknown' } });
    expect(invalidCategory.statusCode).toBe(400);

    const emptyPatch = await app.inject({ method: 'PATCH', url, payload: {} });
    expect(emptyPatch.statusCode).toBe(400);

    const missingImage = await app.inject({ method: 'PATCH', url: `/api/products/${product.id}/images/999999`, payload: { category: 'customer' } });
    expect(missingImage.statusCode).toBe(404);

    close();
  });
});

describe('产品附件路由', () => {
  it('上传附件时保存分类和元数据，并支持分类更新与删除', async () => {
    const { app, repositories, close } = await makeProductApp();
    const product = repositories.saveProduct(productInput('附件产品'))!;
    const upload = binaryUpload('说明书.PDF', 'manual-content', 'manual');
    upload.url = `/api/products/${product.id}/attachments?category=manual`;

    const created = await app.inject({ method: 'POST', ...upload });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ category: 'manual', originalName: '说明书.PDF', size: 14 });
    const attachmentId = String(created.json().data.id);

    const updated = await app.inject({ method: 'PATCH', url: `/api/products/${product.id}/attachments/${attachmentId}`, payload: { category: 'packaging-design' } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.category).toBe('packaging-design');

    const deleted = await app.inject({ method: 'DELETE', url: `/api/products/${product.id}/attachments/${attachmentId}` });
    expect(deleted.statusCode).toBe(200);
    expect(repositories.listProductAttachments(Number(product.id))).toHaveLength(0);
    close();
  });

  it('上传附件后产品列表和详情返回正确的附件 URL', async () => {
    const { app, repositories, close } = await makeProductApp();
    const product = repositories.saveProduct(productInput('附件URL产品'))!;
    const upload = binaryUpload('说明书.PDF', 'manual-content', 'manual');
    upload.url = `/api/products/${product.id}/attachments?category=manual`;
    const created = await app.inject({ method: 'POST', ...upload });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: `/api/products?q=附件URL` });
    expect(list.statusCode).toBe(200);
    const listData = list.json().data;
    const item = listData.items.find((item: { id: number }) => item.id === product.id);
    expect(item).toBeDefined();
    expect(item.attachments).toHaveLength(1);
    expect(item.attachments[0]).toMatchObject({ originalName: '说明书.PDF', size: 14 });
    expect(item.attachments[0].url).toMatch(/^\/files\/product-attachments\//);
    expect(item.attachments[0].url).not.toContain('undefined');

    const detail = await app.inject({ method: 'GET', url: `/api/products/${product.id}` });
    expect(detail.statusCode).toBe(200);
    const detailData = detail.json().data;
    expect(detailData.attachments).toHaveLength(1);
    expect(detailData.attachments[0].url).toMatch(/^\/files\/product-attachments\//);
    expect(detailData.attachments[0].url).not.toContain('undefined');
    close();
  });

  it('拒绝不支持的产品附件扩展名', async () => {
    const { app, repositories, close } = await makeProductApp();
    const product = repositories.saveProduct(productInput('非法附件产品'))!;
    const upload = binaryUpload('malware.exe', 'not-allowed');
    upload.url = `/api/products/${product.id}/attachments?category=other`;

    const response = await app.inject({ method: 'POST', ...upload });
    expect(response.statusCode).toBe(415);
    close();
  });
});

describe('产品包装新旧字段兼容', () => {
  it('保存并返回内盒/外箱文本尺寸，同时保留不可解析的尺寸原文', async () => {
    const { repositories, close } = await makeRepositories();

    const product = repositories.saveProduct({
      ...productInput('文本尺寸产品'),
      packaging: [{
        name: '彩盒包装',
        innerSize: '22×10×8cm',
        innerWeight: 0.45,
        outerSize: '按订单定制-A/B，不可拆分',
        outerWeight: 12.5,
        packCount: 24,
      }],
    });

    expect(product?.packaging).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: '彩盒包装',
        innerSize: '22×10×8cm',
        innerWeight: 0.45,
        outerSize: '按订单定制-A/B，不可拆分',
        outerWeight: 12.5,
        packCount: 24,
        outerLength: 0,
        outerWidth: 0,
        outerHeight: 0,
      }),
    ]));
    close();
  });

  it('读取旧长宽高包装时生成外箱尺寸文本并保留旧字段', async () => {
    const { repositories, close } = await makeRepositories();
    const database = (repositories as unknown as { database: import('node:sqlite').DatabaseSync }).database;
    const timestamp = new Date().toISOString();
    const productId = Number(database.prepare(
      `INSERT INTO products (name, sku, specification, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('旧包装产品', 'VT-OLD', '标准', timestamp, timestamp).lastInsertRowid);
    database.prepare(
      `INSERT INTO product_packaging
        (product_id, name, outer_length, outer_width, outer_height, outer_weight, pack_count, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(productId, '外箱', 35, 28, 20, 9.5, 24, 0, timestamp, timestamp);

    const product = repositories.getProduct(productId);
    expect(product?.packaging[0]).toEqual(expect.objectContaining({
      outerSize: '35×28×20',
      outerLength: 35,
      outerWidth: 28,
      outerHeight: 20,
      outerWeight: 9.5,
      packCount: 24,
    }));
    close();
  });
});

describe('产品库导入导出', () => {
  it('导出产品库时保留多行参数、多值字段、包装和图片元数据', async () => {
    const { app, repositories, close } = await makeProductApp();
    const product = repositories.saveProduct({
      ...productInput('导出产品', '外部-SKU'),
      parameters: '功率：100W\n电压：24V',
      category: '工具',
      purchasePrice: 38.5,
      supplier: '供应商甲',
      colors: ['黑', '白'],
      batteryPlugs: ['通用'],
      accessories: '充电器',
      remark: '导出备注',
      packaging: [
        { name: '纸箱', innerSize: '20×10×8', innerWeight: 0.3, outerSize: '42×32×25', outerWeight: 8, packCount: 12, purchasePrice: 38.5 },
        { name: '木箱', packCount: 4, purchasePrice: 52 },
      ],
    })!;
    repositories.addProductImage(Number(product.id), {
      relativePath: 'product-images/export-image.png',
      originalName: '产品图.png',
      mimeType: 'image/png',
      size: 1234,
    });

    const response = await app.inject({ method: 'GET', url: '/api/products/export' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
    const exported = XLSX.read(Buffer.from(response.rawPayload), { type: 'buffer' });
    expect(exported.SheetNames).toEqual(['产品', '包装', '说明']);
    const productRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(exported.Sheets['产品'], { defval: '' });
    const packagingRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(exported.Sheets['包装'], { defval: '' });
    expect(productRows[0]).toMatchObject({
      '产品名称（必填）': '导出产品',
      SKU: 'VT-0001',
      参数: '功率：100W\n电压：24V',
      '颜色（多个用、分隔）': '黑、白',
    });
    expect(packagingRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ '包装名称（必填）': '纸箱', '装箱数（必填）': 12, '包装采购价': 38.5 }),
      expect.objectContaining({ '包装名称（必填）': '木箱', '装箱数（必填）': 4, '包装采购价': 52 }),
    ]));
    close();
  });

  it('提供包含产品、包装和说明工作表的 Excel 模板', async () => {
    const { app, close } = await makeProductApp();
    const response = await app.inject({ method: 'GET', url: '/api/products/import-template' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain("filename*=UTF-8''%E4%BA%A7%E5%93%81%E5%BA%93%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx");
    const workbook = XLSX.read(Buffer.from(response.rawPayload), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['产品', '包装', '说明']);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['产品'], { header: 1 })[0]).toContain('产品默认采购价');
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['包装'], { header: 1 })[0]).toContain('包装采购价');
    close();
  });

  it('从 Excel 导入时按 SKU 更新已有产品，并分别保存不同包装采购价', async () => {
    const { app, repositories, close } = await makeProductApp();
    const existing = repositories.saveProduct(productInput('待更新产品'))!;
    const headers = ['产品标识（必填）', 'SKU', '产品名称（必填）', '参数', '分类', '产品默认采购价', '供应商', '颜色（多个用、分隔）', '电池插脚（多个用、分隔）', '配件', '备注', '产品图片路径'];
    const packagingHeaders = ['产品标识（必填）', 'SKU', '包装名称（必填）', '内盒尺寸', '内盒重量(kg)', '外箱尺寸', '外箱重量(kg)', '装箱数（必填）', '包装采购价'];
    const workbook = importWorkbook([
      headers,
      ['existing', existing.sku, '已更新产品', '新参数', '工具', 30, '供应商', '黑', '通用', '', '', ''],
      ['new-product', '', '导入新增产品', '', '', '', '', '', '', '', '', ''],
    ], [
      packagingHeaders,
      ['existing', existing.sku, '小包装', '', '', '', '', 12, 19.9],
      ['existing', existing.sku, '大包装', '', '', '', '', 24, 35.5],
      ['new-product', '', '标准包装', '', '', '', '', 2, 8],
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/products/import',
      ...excelUpload(workbook),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ total: 2, created: 1, updated: 1 });
    const products = repositories.listProducts({});
    expect(products).toHaveLength(2);
    expect(products.find((item) => item.sku === existing.sku)).toMatchObject({ name: '已更新产品', parameters: '新参数', packaging: expect.arrayContaining([
      expect.objectContaining({ name: '小包装', purchasePrice: 19.9 }),
      expect.objectContaining({ name: '大包装', purchasePrice: 35.5 }),
    ]) });
    expect(products.find((item) => item.name === '导入新增产品')?.sku).toBe('VT-0002');
    close();
  });

  it('拒绝 Excel 中的重复 SKU，并且不写入任何产品', async () => {
    const { app, repositories, close } = await makeProductApp();
    const headers = ['产品标识（必填）', 'SKU', '产品名称（必填）', '参数', '分类', '产品默认采购价', '供应商', '颜色（多个用、分隔）', '电池插脚（多个用、分隔）', '配件', '备注', '产品图片路径'];
    const packagingHeaders = ['产品标识（必填）', 'SKU', '包装名称（必填）', '内盒尺寸', '内盒重量(kg)', '外箱尺寸', '外箱重量(kg)', '装箱数（必填）', '包装采购价'];
    const workbook = importWorkbook([
      headers,
      ['one', 'SAME-SKU', '重复产品一', '', '', '', '', '', '', '', '', ''],
      ['two', 'SAME-SKU', '重复产品二', '', '', '', '', '', '', '', '', ''],
    ], [
      packagingHeaders,
      ['one', 'SAME-SKU', '包装', '', '', '', '', 1, 10],
      ['two', 'SAME-SKU', '包装', '', '', '', '', 1, 20],
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/products/import',
      ...excelUpload(workbook),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'DUPLICATE_SKU' } });
    expect(repositories.listProducts({})).toHaveLength(0);
    close();
  });
});

describe('产品草稿', () => {
  it('草稿允许缺少品名，保存后可继续编辑并转正', async () => {
    const { app, repositories, close } = await makeProductApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { ...productInput(''), name: '', status: 'draft' },
    });
    expect(created.statusCode).toBe(201);
    const draft = created.json().data;
    expect(draft).toMatchObject({ name: '', status: 'draft', sku: 'VT-0001' });

    const published = await app.inject({
      method: 'PUT',
      url: `/api/products/${draft.id}`,
      payload: { ...productInput('补全后的产品'), status: 'active' },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().data).toMatchObject({ name: '补全后的产品', status: 'active' });
    expect(repositories.getProduct(Number(draft.id))?.status).toBe('active');
    close();
  });

  it('正式产品仍要求品名必填，未知状态按正式处理', async () => {
    const { app, close } = await makeProductApp();
    const missingName = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { ...productInput(''), name: '' },
    });
    expect(missingName.statusCode).toBe(400);
    expect(missingName.json()).toMatchObject({ ok: false, error: { field: 'name' } });

    const unknownStatus = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { ...productInput('状态异常产品'), status: 'archived' },
    });
    expect(unknownStatus.statusCode).toBe(201);
    expect(unknownStatus.json().data.status).toBe('active');
    close();
  });

  it('产品列表支持按状态过滤', async () => {
    const { app, repositories, close } = await makeProductApp();
    repositories.saveProduct(productInput('正式产品'));
    repositories.saveProduct({ ...productInput('草稿产品'), status: 'draft' });

    const all = await app.inject({ method: 'GET', url: '/api/products' });
    expect(all.json().data.total).toBe(2);

    const drafts = await app.inject({ method: 'GET', url: '/api/products?status=draft' });
    expect(drafts.json().data.total).toBe(1);
    expect(drafts.json().data.items[0]).toMatchObject({ name: '草稿产品', status: 'draft' });

    const active = await app.inject({ method: 'GET', url: '/api/products?status=active' });
    expect(active.json().data.total).toBe(1);
    expect(active.json().data.items[0]).toMatchObject({ name: '正式产品', status: 'active' });
    close();
  });

  it('导出不包含草稿，导入不按 SKU 覆盖草稿', async () => {
    const { app, repositories, close } = await makeProductApp();
    const draft = repositories.saveProduct({ ...productInput('草稿产品', 'VT-0001'), status: 'draft' })!;
    repositories.saveProduct(productInput('正式产品'));

    const exported = await app.inject({ method: 'GET', url: '/api/products/export' });
    const workbook = XLSX.read(Buffer.from(exported.rawPayload), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['产品'], { defval: '' });
    expect(rows.map((row) => row.SKU)).toEqual(['VT-0002']);

    const headers = ['产品标识（必填）', 'SKU', '产品名称（必填）', '参数', '分类', '产品默认采购价', '供应商', '颜色（多个用、分隔）', '电池插脚（多个用、分隔）', '配件', '备注', '产品图片路径'];
    const packagingHeaders = ['产品标识（必填）', 'SKU', '包装名称（必填）', '内盒尺寸', '内盒重量(kg)', '外箱尺寸', '外箱重量(kg)', '装箱数（必填）', '包装采购价'];
    const importFile = importWorkbook([
      headers,
      ['import-draft', 'VT-0001', '导入产品', '', '', '', '', '', '', '', '', ''],
    ], [
      packagingHeaders,
      ['import-draft', 'VT-0001', '标准包装', '', '', '', '', 1, 10],
    ]);
    const response = await app.inject({ method: 'POST', url: '/api/products/import', ...excelUpload(importFile) });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ total: 1, created: 1, updated: 0 });

    const reloadedDraft = repositories.getProduct(Number(draft.id));
    expect(reloadedDraft).toMatchObject({ name: '草稿产品', status: 'draft' });
    close();
  });
});
