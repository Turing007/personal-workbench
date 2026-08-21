import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DocumentNumberRepository } from '../../src/server/db/document-number-repository';
import { QuotationRepository } from '../../src/server/db/quotation-repository';
import { SettingsRepository } from '../../src/server/db/settings-repository';
import { QuotationService, type QuotationProductProvider } from '../../src/server/services/quotation-service';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function createContext() {
  const directory = join(tmpdir(), `personal-workbench-quotation-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);

  const productId = Number(database.prepare(
    `INSERT INTO products (name, sku, specification, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('电钻', 'D-1', '20V', '2026-08-08', '2026-08-08').lastInsertRowid);

  let productSnapshot = {
    name: '电钻（产品库快照）',
    sku: 'D-1-SNAPSHOT',
    specification: '20V 无刷',
    parameters: '扭矩：35N·m\n转速：0-1500rpm',
  };
  const products: QuotationProductProvider = {
    getProduct(id) {
      if (id !== productId) return undefined;
      return {
        id: productId,
        ...productSnapshot,
        images: [],
      };
    },
  };
  const service = new QuotationService({
    database,
    repository: new QuotationRepository(database),
    documentNumberRepository: new DocumentNumberRepository(database),
    settingsRepository: new SettingsRepository(database),
    productProvider: products,
  });
  return { database, service, productId, updateProduct: (patch: Partial<typeof productSnapshot>) => { productSnapshot = { ...productSnapshot, ...patch }; } };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    quotationDate: '2026-08-08',
    customerName: '华南五金',
    contactName: '张三',
    contactPhone: '13800000000',
    customerAddress: '深圳市宝安区',
    validUntil: '2026-08-31',
    remark: '报价备注',
    taxRateBps: 0,
    companySnapshot: {
      name: '示例公司',
      logoRelativePath: null,
      phone: '0755-12345678',
      address: '深圳市',
      defaultIssuer: '高先生',
    },
    displayConfig: {
      showLogo: true,
      showCompanyPhone: true,
      showCompanyAddress: true,
      showContactPhone: true,
      showTax: true,
      showTaxIncludedTotal: true,
      columns: {
        image: true,
        name: true,
        sku: true,
        specification: true,
        quantity: true,
        unitPrice: true,
        amount: true,
        remark: true,
      },
    },
    items: [
      {
        clientKey: 'a',
        productId: null,
        isTemporary: true,
        name: '临时配件',
        sku: 'TMP-1',
        specification: '标准',
        quantity: 1,
        unitPrice: 50,
        remark: '',
        sortOrder: 0,
      },
    ],
    customFields: [{ placement: 'footer', label: '付款方式', value: '预付款', sortOrder: 0 }],
    ...overrides,
  };
}

describe('quotation repository and service', () => {
  it('saves multiple lines, recalculates tax totals, and stores product snapshots', async () => {
    const { service, productId, database, updateProduct } = createContext();
    const quotation = await service.create(makeInput({
      taxRateBps: 1300,
      items: [
        { clientKey: 'a', productId, isTemporary: false, name: '客户端名称', sku: '客户端 SKU', specification: '客户端规格', quantity: 2, unitPrice: 100, remark: '', sortOrder: 0 },
        { clientKey: 'b', productId: null, isTemporary: true, name: '临时配件', sku: '', specification: '', quantity: 1, unitPrice: 50, remark: '', sortOrder: 1 },
      ],
    }));

    expect(quotation.number).toBe('BJ20260808001');
    expect(quotation.subtotalCents).toBe(25_000);
    expect(quotation.taxCents).toBe(3_250);
    expect(quotation.totalCents).toBe(28_250);
    expect(quotation.subtotal).toBe(250);
    expect(quotation.tax).toBe(32.5);
    expect(quotation.total).toBe(282.5);
    expect(quotation.items).toHaveLength(2);
    expect(quotation.items[0]).toMatchObject({
      productId,
      isTemporary: false,
      name: '电钻（产品库快照）',
      sku: 'D-1-SNAPSHOT',
      specification: '20V 无刷',
      parameters: '扭矩：35N·m\n转速：0-1500rpm',
      unitPriceCents: 10_000,
      amountCents: 20_000,
    });
    expect(quotation.customFields[0]).toMatchObject({ placement: 'footer', label: '付款方式', value: '预付款' });
    database.prepare("UPDATE products SET name = '产品库已修改', specification = '已修改规格', parameters = '已修改参数' WHERE id = ?").run(productId);
    updateProduct({ name: '产品库已修改', specification: '已修改规格', parameters: '已修改参数' });
    expect(service.get(quotation.id)?.items[0]).toMatchObject({
      name: '电钻（产品库快照）',
      specification: '20V 无刷',
      parameters: '扭矩：35N·m\n转速：0-1500rpm',
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM quotations').get()?.count).toBe(1);
    database.close();
  });

  it('does not replace an existing quotation snapshot with changed library data on update', async () => {
    const { service, productId, database, updateProduct } = createContext();
    const created = await service.create(makeInput({
      items: [{
        clientKey: 'system-line',
        productId,
        isTemporary: false,
        name: '客户端填写名称',
        sku: '客户端填写 SKU',
        specification: '客户端填写规格',
        parameters: '客户端填写参数',
        quantity: 1,
        unitPrice: 80,
        remark: '',
        sortOrder: 0,
      }],
    }));
    const existingItem = created.items[0];
    database.prepare("UPDATE products SET name = '产品库新名称', sku = 'NEW-SKU', specification = '新规格', parameters = '新参数' WHERE id = ?").run(productId);
    updateProduct({ name: '产品库新名称', sku: 'NEW-SKU', specification: '新规格', parameters: '新参数' });

    const updated = await service.update(created.id, makeInput({
      customerName: '编辑后的客户',
      items: [{
        id: existingItem?.id,
        productId,
        isTemporary: false,
        name: existingItem?.name ?? '',
        sku: existingItem?.sku ?? '',
        specification: existingItem?.specification ?? '',
        parameters: existingItem?.parameters,
        quantity: existingItem?.quantity ?? 1,
        unitPriceCents: existingItem?.unitPriceCents ?? 0,
        remark: existingItem?.remark ?? '',
        sortOrder: 0,
      }],
    }));

    expect(updated?.customerName).toBe('编辑后的客户');
    expect(updated?.items[0]).toMatchObject({
      name: '电钻（产品库快照）',
      sku: 'D-1-SNAPSHOT',
      specification: '20V 无刷',
      parameters: '扭矩：35N·m\n转速：0-1500rpm',
    });
    database.close();
  });

  it('preserves an empty parameter snapshot when the product provider omits parameters', async () => {
    const { service, database } = createContext();
    const quotation = await service.create(makeInput({
      items: [{ ...makeInput().items[0], productId: null, isTemporary: true, parameters: undefined }],
    }));
    expect(quotation.items[0]?.parameters).toBe('');
    database.close();
  });

  it('lists, gets, replaces, and updates quotation status', async () => {
    const { service, database } = createContext();
    const created = await service.create(makeInput({ status: 'won' }));
    expect(created.status).toBe('draft');
    expect(service.get(created.id)?.number).toBe(created.number);
    expect(service.list({ status: 'draft' }).total).toBe(1);

    const updated = await service.update(created.id, makeInput({ status: 'expired', customerName: '修改后的客户', items: [
      { clientKey: 'c', productId: null, isTemporary: true, name: '新品', sku: '', specification: '大号', quantity: 2, unitPrice: 25, remark: '更新', sortOrder: 0 },
    ] }));
    expect(updated?.customerName).toBe('修改后的客户');
    expect(updated?.status).toBe('draft');
    expect(updated?.items[0]?.amountCents).toBe(5_000);
    expect(service.updateStatus(created.id, 'sent')?.status).toBe('sent');
    expect(service.list({ status: 'draft' }).total).toBe(0);
    expect(service.list({ status: 'sent' }).rows[0]?.number).toBe(created.number);
    database.close();
  });

  it('requires confirmation before deleting a won quotation', async () => {
    const { service, database } = createContext();
    const quotation = await service.create(makeInput());
    service.updateStatus(quotation.id, 'won');

    await expect(service.delete(quotation.id)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(await service.delete(quotation.id, true)).toBe(true);
    expect(service.get(quotation.id)).toBeUndefined();
    database.close();
  });

  it('rejects empty, negative, and invalid quotation values', async () => {
    const { service, database } = createContext();
    await expect(service.create(makeInput({ items: [] }))).rejects.toMatchObject({ field: 'items' });
    await expect(service.create(makeInput({ items: [{ ...makeInput().items[0], quantity: -1 }] }))).rejects.toMatchObject({ field: 'items.0.quantity' });
    await expect(service.create(makeInput({ items: [{ ...makeInput().items[0], unitPriceCents: -1, unitPrice: undefined }] }))).rejects.toMatchObject({ field: 'items.0.unitPriceCents' });
    await expect(service.create(makeInput({ taxRateBps: 10001 }))).rejects.toMatchObject({ field: 'taxRateBps' });
    database.close();
  });

  it('does not require an asset manager when quotation lines have no images', async () => {
    const { service, database } = createContext();
    const quotation = await service.create(makeInput());
    expect(quotation.items[0]?.imageRelativePath).toBeNull();
    database.close();
  });

  it('uses an injected asset manager to persist a document image snapshot', async () => {
    const { database, productId } = createContext();
    const preparedKeys: string[] = [];
    const service = new QuotationService({
      database,
      repository: new QuotationRepository(database),
      documentNumberRepository: new DocumentNumberRepository(database),
      settingsRepository: new SettingsRepository(database),
      productProvider: {
        getProduct: () => ({
          id: productId,
          name: '带图产品',
          sku: 'IMG-1',
          specification: '图像规格',
          images: [{ relativePath: 'product-images/source.png', originalName: 'source.png', mimeType: 'image/png' }],
        }),
      },
      assetManager: {
        async prepareItemImages(_kind, inputs) {
          preparedKeys.push(...inputs.map((input) => input.key));
          return {
            assets: inputs.map((input) => ({
              key: input.key,
              relativePath: `quotation-assets/${input.key}.png`,
              originalName: 'source.png',
              mimeType: 'image/png',
              size: 10,
            })),
            stagedFiles: [],
            state: 'prepared',
          };
        },
        async commit(batch) {
          batch.state = 'committed';
          return batch.assets;
        },
        async rollback(batch) {
          batch.state = 'rolled-back';
        },
      },
    });

    const quotation = await service.create(makeInput({
      items: [{
        clientKey: 'image-line',
        productId,
        isTemporary: false,
        name: '',
        sku: '',
        specification: '',
        imageRelativePath: 'product-images/source.png',
        quantity: 1,
        unitPrice: 100,
        remark: '',
        sortOrder: 0,
      }],
    }));

    expect(preparedKeys).toEqual(['image-line']);
    expect(quotation.items[0]?.imageRelativePath).toBe('quotation-assets/image-line.png');
    database.close();
  });
});
