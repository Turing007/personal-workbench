import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { DocumentNumberRepository } from '../../src/server/db/document-number-repository';
import { migrateDatabase } from '../../src/server/db/migrate';
import { QuotationRepository } from '../../src/server/db/quotation-repository';
import { SalesDocumentRepository } from '../../src/server/db/sales-document-repository';
import { SettingsRepository } from '../../src/server/db/settings-repository';
import type { StagedFile } from '../../src/server/files/file-store';
import { QuotationService } from '../../src/server/services/quotation-service';
import {
  SalesDocumentService,
  type SalesDocumentInput,
  type SalesDocumentProductProvider,
  type SalesReceiptFileStore,
} from '../../src/server/services/sales-document-service';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createContext() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-sales-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const settingsRepository = new SettingsRepository(database);
  settingsRepository.saveCompanyProfile({
    name: '示例公司',
    phone: '0755-12345678',
    address: '深圳市',
    defaultIssuer: '默认开单人',
  });
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
  const productProvider: SalesDocumentProductProvider = {
    getProduct(id) {
      if (id !== productId) return undefined;
      return {
        id,
        ...productSnapshot,
        images: [],
      };
    },
  };
  const salesRepository = new SalesDocumentRepository(database);
  const quotationRepository = new QuotationRepository(database);
  const salesService = new SalesDocumentService({
    database,
    repository: salesRepository,
    quotationRepository,
    documentNumberRepository: new DocumentNumberRepository(database),
    settingsRepository,
    productProvider,
    now: () => '2026-08-08T10:00:00.000Z',
  });
  const quotationService = new QuotationService({
    database,
    repository: quotationRepository,
    documentNumberRepository: new DocumentNumberRepository(database),
    settingsRepository,
    productProvider,
    now: () => '2026-08-08T09:00:00.000Z',
  });
  return { database, productId, salesRepository, salesService, quotationService, updateProduct: (patch: Partial<typeof productSnapshot>) => { productSnapshot = { ...productSnapshot, ...patch }; } };
}

function makeSalesInput(overrides: Partial<SalesDocumentInput> = {}): SalesDocumentInput {
  return {
    documentDate: '2026-08-08',
    customerName: '华南五金',
    contactName: '张三',
    contactPhone: '13800000000',
    customerAddress: '深圳市宝安区',
    purchaseOrderNo: 'PO-001',
    shippingCents: 1_000,
    taxRateBps: 1_300,
    issuer: '',
    consignee: '张三',
    remark: '销售备注',
    items: [{
      clientKey: 'temporary-line',
      productId: null,
      isTemporary: true,
      productCode: 'TMP-1',
      name: '临时配件',
      sku: 'TMP-1',
      specification: '标准',
      quantity: 1,
      unitPriceCents: 10_000,
      remark: '',
      sortOrder: 0,
    }],
    ...overrides,
  };
}

function makeQuotationInput() {
  return {
    quotationDate: '2026-08-08',
    customerName: '报价客户',
    contactName: '李四',
    contactPhone: '13900000000',
    customerAddress: '广州市天河区',
    validUntil: '2026-08-31',
    remark: '报价备注',
    taxRateBps: 0,
    items: [{
      clientKey: 'quote-temp',
      productId: null,
      isTemporary: true,
      name: '报价临时产品',
      sku: 'Q-TMP',
      specification: '报价规格',
      quantity: 2,
      unitPriceCents: 5_000,
      remark: '报价行备注',
      sortOrder: 0,
    }],
    customFields: [],
  };
}

describe('sales document repository and service', () => {
  it('creates an independent sales document with system and temporary product snapshots', async () => {
    const { database, productId, salesService, updateProduct } = await createContext();
    const beforeProducts = Number(database.prepare('SELECT COUNT(*) AS count FROM products').get()?.count ?? 0);
    const document = await salesService.create(makeSalesInput({
      items: [{
        clientKey: 'system-line',
        productId,
        isTemporary: false,
        productCode: 'CLIENT-CODE',
        name: '客户端名称',
        sku: '客户端 SKU',
        specification: '客户端规格',
        quantity: 2,
        unitPriceCents: 10_000,
        remark: '',
        sortOrder: 0,
      }, {
        clientKey: 'temporary-line',
        productId: null,
        isTemporary: true,
        productCode: 'TMP-1',
        name: '临时配件',
        sku: 'TMP-1',
        specification: '标准',
        quantity: 1,
        unitPriceCents: 5_000,
        remark: '',
        sortOrder: 1,
      }],
    }));

    expect(document.number).toBe('XS20260808001');
    expect(document.documentStatus).toBe('draft');
    expect(document.paymentStatus).toBe('unpaid');
    expect(document.issuer).toBe('默认开单人');
    expect(document.subtotalCents).toBe(25_000);
    expect(document.taxCents).toBe(3_250);
    expect(document.shippingCents).toBe(1_000);
    expect(document.totalCents).toBe(29_250);
    expect(document.outstandingCents).toBe(29_250);
    expect(document.displayConfig.showProductImages).toBe(false);
    expect(document.items[0]).toMatchObject({
      productId,
      isTemporary: false,
      name: '电钻（产品库快照）',
      sku: 'D-1-SNAPSHOT',
      specification: '20V 无刷',
      parameters: '扭矩：35N·m\n转速：0-1500rpm',
      amountCents: 20_000,
    });
    expect(document.items[1]).toMatchObject({ productId: null, isTemporary: true, name: '临时配件' });
    database.prepare("UPDATE products SET name = '修改后的产品库名称', parameters = '修改后的参数' WHERE id = ?").run(productId);
    updateProduct({ name: '修改后的产品库名称', parameters: '修改后的参数' });
    expect(salesService.get(document.id)?.items[0]).toMatchObject({
      name: '电钻（产品库快照）',
      parameters: '扭矩：35N·m\n转速：0-1500rpm',
    });
    expect(Number(database.prepare('SELECT COUNT(*) AS count FROM products').get()?.count ?? 0)).toBe(beforeProducts);
    database.close();
  });

  it('copies only a won quotation into an independent sales draft', async () => {
    const { database, productId, salesService, quotationService, updateProduct } = await createContext();
    const quotation = await quotationService.create(makeQuotationInput());
    await expect(salesService.createFromQuotation(quotation.id)).rejects.toMatchObject({ code: 'QUOTATION_NOT_WON' });

    quotationService.updateStatus(quotation.id, 'won');
    const sales = await salesService.createFromQuotation(quotation.id);
    expect(sales.number).toBe('XS20260808001');
    expect(sales.documentStatus).toBe('draft');
    expect(sales.paymentStatus).toBe('unpaid');
    expect(sales.receivedCents).toBe(0);
    expect(sales.sourceQuotationId).toBe(quotation.id);
    expect(sales.items[0]).toMatchObject({
      isTemporary: true,
      name: '报价临时产品',
      sku: 'Q-TMP',
      specification: '报价规格',
      parameters: '',
    });

    updateProduct({ parameters: '额定电压：12V\n转速：0-1500rpm' });
    const systemQuotation = await quotationService.create({
      ...makeQuotationInput(),
      items: [{
        clientKey: 'quote-system', productId, isTemporary: false, name: '', sku: '', specification: '',
        parameters: '额定电压：12V\n转速：0-1500rpm', quantity: 1, unitPriceCents: 8_000, remark: '', sortOrder: 0,
      }],
    });
    quotationService.updateStatus(systemQuotation.id, 'won');
    const copiedSystem = await salesService.createFromQuotation(systemQuotation.id);
    expect(copiedSystem.items[0]).toMatchObject({
      productId,
      parameters: '额定电压：12V\n转速：0-1500rpm',
    });

    await salesService.update(sales.id, makeSalesInput({
      customerName: '修改后的销售客户',
      shippingCents: 0,
      taxRateBps: 0,
      items: sales.items.map((item) => ({ ...item, clientKey: `saved-${item.id}` })),
    }));
    expect(quotationService.get(quotation.id)?.customerName).toBe('报价客户');
    expect(salesService.get(sales.id)?.customerName).toBe('修改后的销售客户');
    database.close();
  });

  it('keeps a direct sales snapshot when the library changes before updating the document', async () => {
    const { database, productId, salesService, updateProduct } = await createContext();
    const created = await salesService.create(makeSalesInput({
      items: [{
        clientKey: 'system-line',
        productId,
        isTemporary: false,
        productCode: 'CLIENT-CODE',
        name: '客户端名称',
        sku: '客户端 SKU',
        specification: '客户端规格',
        parameters: '创建时参数',
        quantity: 1,
        unitPriceCents: 10_000,
        remark: '',
        sortOrder: 0,
      }],
    }));
    database.prepare("UPDATE products SET name = '后续产品库名称', sku = '后续 SKU', specification = '后续规格', parameters = '后续参数' WHERE id = ?").run(productId);
    updateProduct({ name: '后续产品库名称', sku: '后续 SKU', specification: '后续规格', parameters: '后续参数' });

    const updated = await salesService.update(created.id, makeSalesInput({
      customerName: '编辑后的销售客户',
      shippingCents: 0,
      taxRateBps: 0,
      items: created.items.map((item) => ({
        ...item,
        clientKey: `saved-${item.id}`,
      })),
    }));

    expect(updated?.customerName).toBe('编辑后的销售客户');
    expect(updated?.items[0]).toMatchObject({
      productId,
      name: '电钻（产品库快照）',
      sku: 'D-1-SNAPSHOT',
      specification: '20V 无刷',
      parameters: '扭矩：35N·m\n转速：0-1500rpm',
    });
    database.close();
  });

  it('preserves void documents and requires confirmation before deleting issued documents', async () => {
    const { database, salesService } = await createContext();
    const issued = await salesService.create(makeSalesInput());
    salesService.updateStatus(issued.id, 'issued');
    await expect(salesService.delete(issued.id)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(await salesService.delete(issued.id, true)).toBe(true);

    const voidDocument = await salesService.create(makeSalesInput());
    salesService.updateStatus(voidDocument.id, 'void');
    await expect(salesService.delete(voidDocument.id, true)).rejects.toMatchObject({ code: 'VOID_DOCUMENT_PRESERVED' });
    expect(salesService.get(voidDocument.id)?.documentStatus).toBe('void');
    database.close();
  });

  it('calculates partial and paid states from multiple receipts and rejects overpayment atomically', async () => {
    const { database, salesService } = await createContext();
    const document = await salesService.create(makeSalesInput({ shippingCents: 0, taxRateBps: 0 }));
    const deposit = salesService.addReceipt(document.id, {
      receivedAt: '2026-08-08',
      amountCents: 3_000,
      paymentMethod: '微信',
      note: '预付款',
    });
    expect(deposit.note).toBe('预付款');
    expect(salesService.get(document.id)).toMatchObject({
      paymentStatus: 'partial',
      receivedCents: 3_000,
      outstandingCents: 7_000,
      outstandingUppercase: '柒拾元整',
    });

    await expect(Promise.resolve().then(() => salesService.addReceipt(document.id, {
      receivedAt: '2026-08-09',
      amountCents: 7_001,
      paymentMethod: '银行转账',
      note: '错误尾款',
    }))).rejects.toMatchObject({ code: 'RECEIPT_EXCEEDS_TOTAL' });
    expect(salesService.get(document.id)?.receipts).toHaveLength(1);

    const balance = salesService.addReceipt(document.id, {
      receivedAt: '2026-08-09',
      amountCents: 7_000,
      paymentMethod: '银行转账',
      note: '尾款',
    });
    expect(salesService.get(document.id)).toMatchObject({
      paymentStatus: 'paid',
      receivedCents: 10_000,
      outstandingCents: 0,
      outstandingUppercase: '零元整',
    });

    salesService.updateReceipt(balance.id, {
      receivedAt: '2026-08-10',
      amountCents: 6_000,
      paymentMethod: '支付宝',
      note: '调整尾款',
    });
    expect(salesService.get(document.id)).toMatchObject({ paymentStatus: 'partial', receivedCents: 9_000 });
    expect(await salesService.deleteReceipt(deposit.id)).toBe(true);
    expect(salesService.get(document.id)).toMatchObject({ paymentStatus: 'partial', receivedCents: 6_000 });
    database.close();
  });
});

describe('sales receipt proof metadata', () => {
  function createFileStore() {
    const committed: string[] = [];
    const discarded: string[] = [];
    const deleted: string[] = [];
    const store: SalesReceiptFileStore = {
      async commitStagedFile(file) {
        committed.push(file.relativePath);
        return file;
      },
      async discardStagedFile(file) {
        discarded.push(file.relativePath);
      },
      async deleteFile(path) {
        deleted.push(path);
      },
    };
    return { store, committed, discarded, deleted };
  }

  function stagedFile(name = 'proof.png'): StagedFile {
    return {
      stagingId: '12345678-1234-4123-8123-123456789abc',
      relativePath: `sales-receipt-proofs/${name}`,
      originalName: name,
      mimeType: 'image/png',
      size: 128,
    };
  }

  it('adds and removes receipt proof metadata with the staged file lifecycle', async () => {
    const { database, salesRepository } = await createContext();
    const files = createFileStore();
    const service = new SalesDocumentService({
      database,
      repository: salesRepository,
      receiptFileStore: files.store,
      now: () => '2026-08-08T10:00:00.000Z',
    });
    const document = await service.create(makeSalesInput({ shippingCents: 0, taxRateBps: 0 }));
    const receipt = service.addReceipt(document.id, { receivedAt: '2026-08-08', amountCents: 1_000 });
    const file = await service.addReceiptFile(receipt.id, stagedFile());

    expect(file).toMatchObject({
      receiptId: receipt.id,
      relativePath: 'sales-receipt-proofs/proof.png',
      originalName: 'proof.png',
      mimeType: 'image/png',
      sizeBytes: 128,
    });
    expect(files.committed).toEqual(['sales-receipt-proofs/proof.png']);
    expect(service.get(document.id)?.receipts[0]?.files).toHaveLength(1);
    expect(await service.deleteReceiptFile(file.id)).toBe(true);
    expect(files.deleted).toContain('sales-receipt-proofs/proof.png');
    database.close();
  });

  it('deletes receipt proof files when deleting their receipt', async () => {
    const { database, salesRepository } = await createContext();
    const files = createFileStore();
    const service = new SalesDocumentService({
      database,
      repository: salesRepository,
      receiptFileStore: files.store,
      now: () => '2026-08-08T10:00:00.000Z',
    });
    const document = await service.create(makeSalesInput({ shippingCents: 0, taxRateBps: 0 }));
    const receipt = service.addReceipt(document.id, { receivedAt: '2026-08-08', amountCents: 1_000 });
    await service.addReceiptFile(receipt.id, stagedFile('deposit.png'));

    expect(await service.deleteReceipt(receipt.id)).toBe(true);
    expect(files.deleted).toContain('sales-receipt-proofs/deposit.png');
    expect(database.prepare('SELECT COUNT(*) AS count FROM sales_receipt_files').get()?.count).toBe(0);
    database.close();
  });

  it('discards a staged proof when its receipt does not exist', async () => {
    const { database, salesRepository } = await createContext();
    const files = createFileStore();
    const service = new SalesDocumentService({
      database,
      repository: salesRepository,
      receiptFileStore: files.store,
    });
    await expect(service.addReceiptFile(999, stagedFile('orphan.png'))).rejects.toMatchObject({ code: 'RECEIPT_NOT_FOUND' });
    expect(files.discarded).toEqual(['sales-receipt-proofs/orphan.png']);
    expect(database.prepare('SELECT COUNT(*) AS count FROM sales_receipt_files').get()?.count).toBe(0);
    database.close();
  });
});
