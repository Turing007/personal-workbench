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
import { QuotationService, type QuotationProductProvider } from '../../src/server/services/quotation-service';
import { SalesDocumentService, type SalesDocumentProductProvider } from '../../src/server/services/sales-document-service';
import { renderQuotationHtml } from '../../src/server/documents/quotation-template';
import { renderSalesDocumentHtml } from '../../src/server/documents/sales-document-template';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function configuration(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    mode: 'bare',
    accessoryNames: [],
    accessoryPriceCents: 0,
    accessoryWeightKg: 0,
    baseCostCents: 10_000,
    otherCostCents: 0,
    markupPercent: 20,
    shippingUnitPrice: 1.5,
    volumeDivisor: 8000,
    shippingCostCents: 0,
    taxPercent: 0,
    totalCostCents: 0,
    computedSalePriceCents: 0,
    priceOverridden: false,
    priceBasis: 'shipping_ex_tax',
    label: '裸机',
    ...overrides,
  };
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-quotation-config-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  const settingsRepository = new SettingsRepository(database);
  settingsRepository.saveCompanyProfile({ name: '示例公司', phone: '', address: '', defaultIssuer: '高先生' });
  const productId = Number(database.prepare(
    `INSERT INTO products (name, sku, specification, created_at, updated_at)
     VALUES ('配置电钻', 'CFG-1', '21V', '2026-08-08', '2026-08-08')`,
  ).run().lastInsertRowid);
  const productProvider: QuotationProductProvider & SalesDocumentProductProvider = {
    getProduct(id) {
      if (id !== productId) return undefined;
      return { id, name: '配置电钻', sku: 'CFG-1', specification: '21V', parameters: '', images: [] };
    },
  };
  const quotationRepository = new QuotationRepository(database);
  const quotationService = new QuotationService({
    database,
    repository: quotationRepository,
    documentNumberRepository: new DocumentNumberRepository(database),
    settingsRepository,
    productProvider,
    now: () => '2026-08-08T09:00:00.000Z',
  });
  const salesService = new SalesDocumentService({
    database,
    repository: new SalesDocumentRepository(database),
    quotationRepository,
    documentNumberRepository: new DocumentNumberRepository(database),
    settingsRepository,
    productProvider,
    now: () => '2026-08-08T10:00:00.000Z',
  });
  return { database, productId, quotationService, salesService };
}

function quotationInput(productId: number, pricingBasis: string, itemConfiguration = configuration(), unitPriceCents = 1) {
  return {
    quotationDate: '2026-08-08',
    customerName: '配置客户',
    contactName: '王经理',
    contactPhone: '13800000000',
    customerAddress: '深圳市',
    validUntil: '2026-08-31',
    remark: '',
    taxRateBps: 1300,
    pricingBasis,
    companySnapshot: {
      name: '示例公司', logoRelativePath: null, phone: '', address: '', defaultIssuer: '高先生', wechatQrRelativePath: null,
    },
    displayConfig: {
      showLogo: true, showCompanyPhone: true, showCompanyAddress: true, showContactPhone: true,
      showTax: true, showTaxIncludedTotal: true,
      columns: { image: true, name: true, specification: true, unitPrice: true, tierPrice: true, remark: true },
    },
    items: [{
      productId,
      isTemporary: false,
      name: '配置电钻',
      sku: 'CFG-1',
      specification: '21V',
      parameters: '',
      unitPriceCents,
      configuration: itemConfiguration,
      remark: '',
      sortOrder: 0,
    }],
    customFields: [],
  };
}

describe('报价配置快照与价格口径', () => {
  it('保存配置快照并按含运不含税口径重算单价和税额', async () => {
    const { database, productId, quotationService } = await setup();
    const quotation = await quotationService.create(quotationInput(productId, 'shipping_ex_tax'));
    expect(quotation.pricingBasis).toBe('shipping_ex_tax');
    expect(quotation.items[0].unitPriceCents).toBe(12_000);
    expect(quotation.items[0].configuration).toMatchObject({
      mode: 'bare',
      baseCostCents: 10_000,
      markupPercent: 20,
      computedSalePriceCents: 12_000,
      label: '裸机',
      priceBasis: 'shipping_ex_tax',
    });
    expect(quotation.taxCents).toBe(1_560);
    expect(quotation.totalCents).toBe(13_560);
    expect(await renderQuotationHtml(quotation)).toContain('裸机');
    database.close();
  });

  it('含运含税口径不重复加税，只展示其中税额', async () => {
    const { database, productId, quotationService } = await setup();
    const quotation = await quotationService.create(quotationInput(productId, 'shipping_inc_tax'));
    expect(quotation.items[0].unitPriceCents).toBe(13_560);
    expect(quotation.subtotalCents).toBe(13_560);
    expect(quotation.taxCents).toBe(1_560);
    expect(quotation.totalCents).toBe(13_560);
    database.close();
  });

  it('手改价保留提交的单价，并标记 priceOverridden', async () => {
    const { database, productId, quotationService } = await setup();
    const quotation = await quotationService.create(quotationInput(
      productId,
      'shipping_ex_tax',
      configuration({ priceOverridden: true }),
      999,
    ));
    expect(quotation.items[0].unitPriceCents).toBe(999);
    expect(quotation.items[0].configuration?.priceOverridden).toBe(true);
    database.close();
  });

  it('转销售单保留配置快照、价格口径和最终单价', async () => {
    const { database, productId, quotationService, salesService } = await setup();
    const quotation = await quotationService.create(quotationInput(productId, 'shipping_inc_tax'));
    quotationService.updateStatus(quotation.id, 'won');
    const sales = await salesService.createFromQuotation(quotation.id);
    expect(sales.pricingBasis).toBe('shipping_inc_tax');
    expect(sales.items[0].unitPriceCents).toBe(13_560);
    expect(sales.items[0].configuration).toMatchObject({ label: '裸机', computedSalePriceCents: 13_560 });
    expect(sales.subtotalCents).toBe(13_560);
    expect(sales.taxCents).toBe(1_560);
    expect(sales.totalCents).toBe(13_560);
    expect(await renderSalesDocumentHtml(sales)).toContain('裸机');
    database.close();
  });
});
