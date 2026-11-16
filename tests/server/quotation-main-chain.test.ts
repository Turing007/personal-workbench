import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { QuotationService } from '../../src/server/services/quotation-service';

// 报价单主链路护栏（重构方案第 0 步）：
// F1/F2/F5 是期望行为的永久护栏；F4 先固定现状，第 1 步补数据后翻转断言。

const directories: string[] = [];
const databases: DatabaseSync[] = [];

afterEach(async () => {
  // Windows 下必须先关句柄再删文件，否则 EBUSY
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* 已关闭 */ }
  }
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createContext() {
  const directory = await mkdtemp(join(tmpdir(), 'quotation-main-chain-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  databases.push(database);
  migrateDatabase(database);
  const service = new QuotationService({ database });
  return { database, service };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    quotationDate: '2026-11-15',
    customerName: '华南五金',
    contactName: '张三',
    contactPhone: '13800000000',
    customerAddress: '深圳市宝安区',
    validUntil: '',
    remark: '',
    taxRateBps: 0,
    items: [
      {
        clientKey: 'a',
        productId: null,
        isTemporary: true,
        name: '临时配件',
        sku: 'TMP-1',
        specification: '标准',
        unitPrice: 50,
        remark: '',
        sortOrder: 0,
      },
    ],
    customFields: [],
    ...overrides,
  };
}

describe('报价单主链路护栏', () => {
  it('F1 服务端搜索覆盖产品名/SKU/规格/客户地址', async () => {
    const { service } = await createContext();
    await service.create(makeInput({
      customerAddress: '杭州市余杭区',
      items: [{
        clientKey: 'a', productId: null, isTemporary: true,
        name: '曲线锯条', sku: 'JIG-9', specification: 'T型柄',
        unitPrice: 50, remark: '', sortOrder: 0,
      }],
    }));
    for (const keyword of ['曲线锯条', 'JIG-9', 'T型柄', '杭州市余杭区']) {
      const result = service.list({ q: keyword });
      expect(result.total, `关键词「${keyword}」应命中`).toBe(1);
    }
    expect(service.list({ q: '不存在的词' }).total).toBe(0);
  });

  it('F2 分页：total 为全量数，rows 按页截取', async () => {
    const { service } = await createContext();
    for (let index = 0; index < 3; index += 1) {
      await service.create(makeInput({ customerName: `分页客户${index}` }));
    }
    const page1 = service.list({ page: 1, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.rows).toHaveLength(2);
    const page2 = service.list({ page: 2, pageSize: 2 });
    expect(page2.rows).toHaveLength(1);
    expect(page2.total).toBe(3);
  });

  it('F4 列表行返回真实产品数 itemCount', async () => {
    const { service } = await createContext();
    await service.create(makeInput({
      items: [
        { clientKey: 'a', productId: null, isTemporary: true, name: '产品一', unitPrice: 10, remark: '', sortOrder: 0 },
        { clientKey: 'b', productId: null, isTemporary: true, name: '产品二', unitPrice: 20, remark: '', sortOrder: 1 },
      ],
    }));
    const result = service.list({});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].itemCount).toBe(2);
    // 详情接口同样带出 itemCount（mapSummary 共用）
    const detail = service.get(result.rows[0].id);
    expect(detail?.itemCount).toBe(2);
  });

  it('F5 保存不改状态：状态只能走 updateStatus（表单状态下拉因此移除）', async () => {
    const { service } = await createContext();
    const created = await service.create(makeInput());
    expect(created.status).toBe('draft');
    const updated = await service.update(created.id, makeInput({ status: 'sent' }));
    expect(updated?.status).toBe('draft');
    const patched = service.updateStatus(created.id, 'sent');
    expect(patched?.status).toBe('sent');
  });
});