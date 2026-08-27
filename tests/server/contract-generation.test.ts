import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';
import { SettingsRepository } from '../../src/server/db/settings-repository';
import { SettingsService } from '../../src/server/services/settings-service';
import { registerOrderRoutes } from '../../src/server/routes/orders';
import { registerSettingsRoutes } from '../../src/server/routes/settings';
import { FileStore } from '../../src/server/files/file-store';
import { renderContractHtml } from '../../src/server/documents/contract-template';
import {
  cloneDefaultContractTemplate,
  normalizeContractTemplate,
} from '../../src/shared/contract';
import { centsToChineseUppercase } from '../../src/shared/money';

const directories: string[] = [];
const apps: FastifyInstance[] = [];
const databases: { close(): void }[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  // Windows 下 sqlite 文件句柄未释放时删除目录会报 EBUSY，必须先关闭连接。
  for (const database of databases.splice(0)) database.close();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeContext() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-contract-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const repositories = new DatabaseRepositories(database);
  const settingsRepository = new SettingsRepository(database);
  const fileStore = new FileStore(join(directory, 'files'));
  const app = Fastify();
  await app.register(multipart, { limits: { files: 5, fileSize: 20 * 1024 * 1024 } });
  // 用假渲染器替代 Playwright：记录传入的 HTML，返回固定 PDF 字节。
  const rendered: string[] = [];
  await registerOrderRoutes(app, {
    repositories,
    fileStore,
    settingsRepository,
    pdfRenderer: {
      render: async (html: string) => {
        rendered.push(html);
        return Buffer.from('%PDF-fake-contract');
      },
    },
  });
  await registerSettingsRoutes(app, { service: new SettingsService(settingsRepository, fileStore) });
  apps.push(app);
  databases.push(database);
  return { directory, database, repositories, settingsRepository, fileStore, app, rendered };
}

function orderInput(overrides: Record<string, unknown> = {}) {
  return {
    orderNo: 'HT-TEST-001',
    orderedAt: '2026-08-10T08:00:00.000Z',
    recipientName: '张三',
    recipientInfo: '深圳市宝安区西乡街道',
    amount: 990,
    shippingCents: 1200,
    customerName: '东莞示例客户',
    customerContactName: '李四',
    customerContactPhone: '13800000000',
    remark: '',
    items: [{
      name: '测试产品',
      specification: '标准规格',
      packCount: 10,
      quantity: 10,
      unitPriceCents: 9900,
    }],
    ...overrides,
  };
}

describe('合同模板共享层', () => {
  it('normalizeContractTemplate 校验标题与条款并做归一化', () => {
    expect(() => normalizeContractTemplate(null)).toThrow('合同模板数据无效');
    expect(() => normalizeContractTemplate({ title: '', clauses: ['a'] })).toThrow('合同标题不能为空');
    expect(() => normalizeContractTemplate({ title: 'T', clauses: [] })).toThrow('合同至少需要一条条款');
    expect(() => normalizeContractTemplate({ title: 'T', clauses: ['  '] })).toThrow('第 1 条条款内容不能为空');
    expect(normalizeContractTemplate({ title: ' T ', clauses: [' 甲 ', '乙'] })).toEqual({ title: 'T', clauses: ['甲', '乙'] });
  });

  it('默认模板可克隆且互不影响', () => {
    const cloned = cloneDefaultContractTemplate();
    cloned.clauses[0] = '被修改';
    expect(cloneDefaultContractTemplate().clauses[0]).not.toBe('被修改');
  });
});

describe('renderContractHtml 渲染器', () => {
  const baseOrder = {
    order_no: 'SO20260810001',
    ordered_at: '2026-08-10',
    customer_name: '乙方公司',
    customer_contact_name: '李四',
    customer_contact_phone: '13800000000',
    recipient_name: '张三',
    recipient_info: '宝安区',
    shipping_cents: 1200,
    remark: '',
  };

  it('替换占位符、注入明细表并对正文转义，未知占位符原样保留', () => {
    const html = renderContractHtml({
      template: {
        title: '销售购销合同',
        clauses: [
          '客户 {客户名} 应支付 {总金额}（大写：{大写金额}），未知占位 {拼错占位} 应保留。',
          '<script>alert(1)</script>',
        ],
      },
      company: { name: '甲方公司<b>', logoRelativePath: null, phone: '0755-123', address: '深圳', defaultIssuer: '' },
      order: baseOrder,
      items: [{ name: '测试产品', specification: '规格<1>', pack_count: 10, quantity: 10, unit_price_cents: 9900, amount_cents: 99000, remark: '' }],
      generatedAt: '2026-08-24T00:00:00.000Z',
    });

    expect(html).toContain('<h1>销售购销合同</h1>');
    expect(html).toContain('客户 乙方公司 应支付 ¥1,002.00');
    expect(html).toContain(centsToChineseUppercase(100200));
    expect(html).toContain('{拼错占位}');
    expect(html).toContain('<table class="items">');
    expect(html).toContain('规格&lt;1&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('甲方公司&lt;b&gt;');
    expect(html).toContain('签订日期：2026-08-24');
  });

  it('运费计入合计，收件地址在收件信息为空时回退客户常用收件信息', () => {
    const html = renderContractHtml({
      template: cloneDefaultContractTemplate(),
      company: { name: '甲', logoRelativePath: null, phone: '', address: '', defaultIssuer: '' },
      order: { ...baseOrder, recipient_info: '', customer_shipping_info: '广东省东莞市' },
      items: [{ name: 'A', amount_cents: 500, quantity: 1 }],
      generatedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(html).toContain('¥5.00');   // 小计
    expect(html).toContain('¥12.00');  // 运费
    expect(html).toContain('¥17.00');  // 合计
    expect(html).toContain('广东省东莞市');
  });
});

describe('购销合同生成接口', () => {
  it('POST generate 返回 PDF、按订单号命名并归档到订单附件', async () => {
    const { app, directory, rendered } = await makeContext();
    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput() });
    expect(created.statusCode).toBe(201);
    const orderId = Number(created.json().data.id);
    const orderNo = String(created.json().data.order_no);

    const response = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/contracts/generate` });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.body).toBe('%PDF-fake-contract');

    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toContain('<h1>销售购销合同</h1>');
    expect(rendered[0]).toContain(orderNo);

    const contracts = await app.inject({ method: 'GET', url: `/api/orders/${orderId}/contracts` });
    expect(contracts.statusCode).toBe(200);
    const items = contracts.json().data.items;
    expect(items).toHaveLength(1);
    expect(items[0].originalName).toBe(`${orderNo}-购销合同.pdf`);
    expect(items[0].mimeType).toBe('application/pdf');
    expect(items[0].category).toBe('other');
    await access(join(directory, 'files', String(items[0].relativePath)));
  });

  it('生成时使用设置里保存的自定义模板与公司资料', async () => {
    const { app, settingsRepository, rendered } = await makeContext();
    settingsRepository.saveCompanyProfile({ name: '自定义公司', phone: '0755-88888888', address: '' });
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/settings/contract-template',
      payload: { title: '定制购销协议', clauses: ['第一条：{公司名} 联系电话 {公司电话}。'] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.title).toBe('定制购销协议');

    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput() });
    expect(created.statusCode, created.body).toBe(201);
    const orderId = Number(created.json().data.id);
    const generated = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/contracts/generate` });
    expect(generated.statusCode, generated.body).toBe(200);

    expect(rendered[0]).toContain('<h1>定制购销协议</h1>');
    expect(rendered[0]).toContain('第一条：自定义公司 联系电话 0755-88888888。');
  });

  it('订单不存在时返回 404，非法模板写入被拒绝', async () => {
    const { app } = await makeContext();

    const missing = await app.inject({ method: 'POST', url: '/api/orders/999/contracts/generate' });
    expect(missing.statusCode, missing.body).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');

    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/settings/contract-template',
      payload: { title: '', clauses: [] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');
  });
});
