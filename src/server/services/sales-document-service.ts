import type { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { withTransaction } from '../db/connection.js';
import { DocumentNumberRepository } from '../db/document-number-repository.js';
import { QuotationRepository } from '../db/quotation-repository.js';
import { CustomerRepository } from '../db/customer-repository.js';
import { CustomerProductRepository } from '../db/customer-product-repository.js';
import type { CompanyRepository } from '../db/company-repository.js';
import {
  SalesDocumentRepository,
  type SalesDocumentListFilters,
  type SalesDocumentPersistenceInput,
  type SalesDocumentPersistenceItem,
  type SalesDocumentRepositoryDetail,
  type SalesReceiptPersistenceInput,
} from '../db/sales-document-repository.js';
import { EMPTY_COMPANY_PROFILE, SettingsRepository } from '../db/settings-repository.js';
import type { CreateOrderInput } from '../db/repositories.js';
import type { OrderService } from './order-service.js';
import type { DocumentVersionService } from './document-version-service.js';
import type {
  DocumentItemImageInput,
  PreparedDocumentAsset,
  PreparedDocumentAssetBatch,
} from '../documents/document-assets.js';
import type { StagedFile } from '../files/file-store.js';
import type {
  CompanySnapshot,
  PaymentStatus,
  SalesDocumentDisplayConfig,
  SalesDocumentStatus,
  SalesReceipt,
  SalesReceiptFile,
} from '../../shared/documents.js';
import type { CustomerProduct } from '../../shared/customers.js';
import {
  calculateDocumentTotalsForBasis,
  isQuotationPricingBasis,
  normalizeQuotationConfiguration,
  pricingBasisIncludesTax,
  type QuotationItemConfiguration,
  type QuotationPricingBasis,
} from '../../shared/quotation-config.js';
import {
  calculateLineAmountCents,
  calculateOutstandingCents,
  centsToChineseUppercase,
  centsToYuan,
  derivePaymentStatus,
  yuanToCents,
} from '../../shared/money.js';
import {
  DocumentValidationError,
  validateDocumentLines,
  validateNonNegativeCents,
  validateReceiptAmount,
  validateTaxRateBps,
} from '../../shared/document-validation.js';

const DOCUMENT_STATUSES: readonly SalesDocumentStatus[] = ['draft', 'issued', 'void'];
const DOCUMENT_STATUS_TRANSITIONS: Record<SalesDocumentStatus, readonly SalesDocumentStatus[]> = {
  draft: ['issued', 'void'],
  issued: ['void'],
  void: [],
};
const DOCUMENT_STATUS_LABELS: Record<SalesDocumentStatus, string> = { draft: '草稿', issued: '已开单', void: '已作废' };
const PAYMENT_STATUSES: readonly PaymentStatus[] = ['unpaid', 'partial', 'paid'];

export interface SalesDocumentProductImage {
  relativePath: string;
  originalName: string;
  mimeType: string;
}

export interface SalesDocumentProduct {
  id: number;
  name: string;
  sku?: string;
  specification?: string;
  parameters?: string;
  images?: readonly SalesDocumentProductImage[];
}

export interface SalesDocumentProductProvider {
  getProduct(id: number): SalesDocumentProduct | undefined;
}

class DatabaseSalesDocumentProductProvider implements SalesDocumentProductProvider {
  constructor(private readonly database: DatabaseSync) {}

  getProduct(id: number): SalesDocumentProduct | undefined {
    const row = this.database.prepare(
      'SELECT id, name, sku, specification, parameters FROM products WHERE id = ?',
    ).get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const images = this.database.prepare(
      `SELECT relative_path, original_name, mime_type FROM product_images
       WHERE product_id = ? ORDER BY created_at, id`,
    ).all(id) as unknown as Record<string, unknown>[];
    return {
      id: Number(row.id),
      name: String(row.name ?? ''),
      sku: String(row.sku ?? ''),
      specification: String(row.specification ?? ''),
      parameters: typeof row.parameters === 'string' ? row.parameters : '',
      images: images.map((image) => ({
        relativePath: String(image.relative_path ?? ''),
        originalName: String(image.original_name ?? ''),
        mimeType: String(image.mime_type ?? ''),
      })),
    };
  }
}

export interface SalesDocumentAssetManager {
  prepareItemImages(
    targetKind: 'sales-asset',
    inputs: readonly DocumentItemImageInput[],
  ): Promise<PreparedDocumentAssetBatch>;
  commit(batch: PreparedDocumentAssetBatch): Promise<readonly PreparedDocumentAsset[]>;
  rollback(batch: PreparedDocumentAssetBatch): Promise<void>;
  prepareCompanyLogo?(
    targetKind: 'sales-asset',
    sourceRelativePath: string,
  ): Promise<PreparedDocumentAssetBatch>;
  deleteFile?(relativePath: string): Promise<void> | void;
}

export interface SalesReceiptFileStore {
  commitStagedFile(stagedFile: StagedFile): Promise<{ relativePath: string; originalName: string; mimeType: string; size: number }>;
  discardStagedFile(stagedFile: StagedFile): Promise<void>;
  deleteFile(relativePath: string): Promise<void>;
}

export interface SalesDocumentSourceFileReader {
  readFile(relativePath: string): Promise<Buffer>;
}

export interface SalesDocumentItemInput {
  clientKey?: string;
  id?: number;
  productId?: number | null;
  customerProductId?: number | null;
  isTemporary: boolean;
  productCode?: string;
  name: string;
  sku?: string;
  specification?: string;
  parameters?: string;
  imageRelativePath?: string | null;
  imageOriginalName?: string;
  imageMimeType?: string;
  imageUpload?: {
    stream: NodeJS.ReadableStream;
    originalName: string;
    mimeType: string;
  };
  quantity: number;
  packCount?: number | null;
  unitPriceCents?: number;
  unitPrice?: number;
  configuration?: QuotationItemConfiguration;
  remark?: string;
  sortOrder?: number;
}

export interface SalesDocumentInput {
  id?: number;
  documentStatus?: SalesDocumentStatus;
  documentDate: string;
  customerId?: number | null;
  customerName: string;
  contactName?: string;
  contactPhone?: string;
  customerAddress?: string;
  purchaseOrderNo?: string;
  shippingCents?: number;
  shipping?: number;
  taxRateBps: number;
  pricingBasis?: QuotationPricingBasis;
  issuer?: string;
  consignee?: string;
  remark?: string;
  companySnapshot?: Partial<CompanySnapshot>;
  displayConfig?: Partial<SalesDocumentDisplayConfig> & {
    columns?: Partial<SalesDocumentDisplayConfig['columns']>;
  };
  sourceQuotationId?: number | null;
  items: readonly SalesDocumentItemInput[];
}

export interface SalesReceiptInput {
  receivedAt: string;
  amountCents?: number;
  amount?: number;
  paymentMethod?: string;
  note?: string;
}

export interface SalesDocumentServiceOptions {
  database: DatabaseSync;
  repository?: SalesDocumentRepository;
  quotationRepository?: QuotationRepository;
  customerRepository?: CustomerRepository;
  customerProductRepository?: CustomerProductRepository;
  companyRepository?: CompanyRepository;
  documentNumberRepository?: DocumentNumberRepository;
  settingsRepository?: SettingsRepository;
  productProvider?: SalesDocumentProductProvider;
  assetManager?: SalesDocumentAssetManager;
  sourceFileReader?: SalesDocumentSourceFileReader;
  receiptFileStore?: SalesReceiptFileStore;
  orderService?: OrderService;
  /** 与单据写入放在同一事务里记录版本，避免主保存成功而版本写入失败造成重试重复建单。 */
  versions?: DocumentVersionService;
  now?: () => string;
}

export class SalesDocumentServiceError extends Error {
  constructor(
    public readonly code:
      | 'ASSET_MANAGER_REQUIRED'
      | 'CONFIRMATION_REQUIRED'
      | 'INVALID_PAYMENT_STATUS'
      | 'INVALID_STATUS'
      | 'INVALID_STATUS_TRANSITION'
      | 'ISSUED_DOCUMENT_PRESERVED'
      | 'DOCUMENT_HAS_RECEIPTS'
      | 'VOID_WITH_RECEIPTS'
      | 'VOID_WITH_ORDER'
      | 'QUOTATION_NOT_FOUND'
      | 'QUOTATION_NOT_WON'
      | 'RECEIPT_EXCEEDS_TOTAL'
      | 'RECEIPT_FILE_STORE_REQUIRED'
      | 'RECEIPT_NOT_FOUND'
      | 'SALES_DOCUMENT_NOT_FOUND'
      | 'SALES_DOCUMENT_NOT_ISSUED'
      | 'ORDER_SERVICE_REQUIRED'
      | 'ORDER_ALREADY_GENERATED'
      | 'ORDER_QUANTITY_INVALID'
      | 'VOID_DOCUMENT_PRESERVED'
      | 'CUSTOMER_NOT_FOUND'
      | 'CUSTOMER_INACTIVE'
      | 'CUSTOMER_PRODUCT_NOT_FOUND'
      | 'CUSTOMER_PRODUCT_CUSTOMER_MISMATCH',
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'SalesDocumentServiceError';
  }
}

export type SalesDocumentServiceDetail = SalesDocumentRepositoryDetail & {
  shipping: number;
  subtotal: number;
  tax: number;
  total: number;
  received: number;
  outstanding: number;
  outstandingUppercase: string;
};

interface PreparedSave {
  record: SalesDocumentPersistenceInput;
  assetBatches: PreparedDocumentAssetBatch[];
  assetPaths: Set<string>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeParameters(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function inferImageMimeType(fileName: string): string {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function normalizeDate(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new DocumentValidationError(`${field}无效`, field);
  }
  return normalized;
}

function normalizeDocumentStatus(value: unknown): SalesDocumentStatus {
  if (typeof value === 'string' && (DOCUMENT_STATUSES as readonly string[]).includes(value)) {
    return value as SalesDocumentStatus;
  }
  throw new SalesDocumentServiceError('INVALID_STATUS', '销售单状态无效，可选值：草稿、已开单、已作废', 'documentStatus');
}

function normalizePaymentStatus(value: unknown): PaymentStatus {
  if (typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value)) {
    return value as PaymentStatus;
  }
  throw new SalesDocumentServiceError('INVALID_PAYMENT_STATUS', '付款状态无效', 'paymentStatus');
}

function normalizeCompanySnapshot(value: Partial<CompanySnapshot> | undefined, fallback: CompanySnapshot): CompanySnapshot {
  return {
    name: normalizeText(value?.name ?? fallback.name),
    logoRelativePath: value?.logoRelativePath === undefined
      ? fallback.logoRelativePath
      : (value.logoRelativePath ? normalizeText(value.logoRelativePath) : null),
    phone: normalizeText(value?.phone ?? fallback.phone),
    address: normalizeText(value?.address ?? fallback.address),
    defaultIssuer: normalizeText(value?.defaultIssuer ?? fallback.defaultIssuer),
    wechatQrRelativePath: value?.wechatQrRelativePath === undefined
      ? (fallback.wechatQrRelativePath ?? null)
      : (value.wechatQrRelativePath ? normalizeText(value.wechatQrRelativePath) : null),
  };
}

const DEFAULT_COLUMNS: SalesDocumentDisplayConfig['columns'] = {
  productCode: true,
  productName: true,
  specification: true,
  quantity: true,
  unitPrice: true,
  amount: true,
  remark: true,
};

function normalizeDisplayConfig(input: SalesDocumentInput['displayConfig']): SalesDocumentDisplayConfig {
  return {
    showLogo: input?.showLogo ?? false,
    showCompanyPhone: input?.showCompanyPhone ?? false,
    showCompanyAddress: input?.showCompanyAddress ?? false,
    showProductImages: input?.showProductImages ?? false,
    columns: { ...DEFAULT_COLUMNS, ...(input?.columns ?? {}) },
  };
}

function normalizePriceCents(item: SalesDocumentItemInput, index: number): number {
  if (Object.prototype.hasOwnProperty.call(item, 'unitPriceCents')) {
    return validateNonNegativeCents(item.unitPriceCents as number, `items.${index}.unitPriceCents`, '单价');
  }
  if (!Number.isFinite(item.unitPrice)) {
    throw new DocumentValidationError('单价必须是有效数字', `items.${index}.unitPriceCents`);
  }
  try {
    return yuanToCents(item.unitPrice as number);
  } catch (error) {
    throw new DocumentValidationError((error as Error).message, `items.${index}.unitPriceCents`);
  }
}

function normalizeShippingCents(input: SalesDocumentInput): number {
  if (Object.prototype.hasOwnProperty.call(input, 'shippingCents')) {
    return validateNonNegativeCents(input.shippingCents as number, 'shippingCents', '运费');
  }
  if (input.shipping == null) return 0;
  try {
    return yuanToCents(input.shipping);
  } catch (error) {
    throw new DocumentValidationError((error as Error).message, 'shippingCents');
  }
}

function normalizeReceiptAmountCents(input: SalesReceiptInput): number {
  if (Object.prototype.hasOwnProperty.call(input, 'amountCents')) {
    return validateReceiptAmount(input.amountCents as number);
  }
  if (!Number.isFinite(input.amount)) {
    throw new DocumentValidationError('收款金额必须是有效数字', 'amountCents');
  }
  try {
    return yuanToCents(input.amount as number);
  } catch (error) {
    throw new DocumentValidationError((error as Error).message, 'amountCents');
  }
}

function asDetail(value: SalesDocumentRepositoryDetail): SalesDocumentServiceDetail {
  return {
    ...value,
    shipping: centsToYuan(value.shippingCents),
    subtotal: centsToYuan(value.subtotalCents),
    tax: centsToYuan(value.taxCents),
    total: centsToYuan(value.totalCents),
    received: centsToYuan(value.receivedCents),
    outstanding: centsToYuan(value.outstandingCents),
    outstandingUppercase: centsToChineseUppercase(value.outstandingCents),
  };
}

export class SalesDocumentService {
  readonly repository: SalesDocumentRepository;
  readonly quotationRepository: QuotationRepository;
  readonly customerRepository: CustomerRepository;
  readonly customerProductRepository: CustomerProductRepository;
  readonly companyRepository?: CompanyRepository;
  readonly documentNumberRepository: DocumentNumberRepository;
  readonly settingsRepository: SettingsRepository;
  readonly productProvider: SalesDocumentProductProvider;
  readonly assetManager?: SalesDocumentAssetManager;
  readonly sourceFileReader?: SalesDocumentSourceFileReader;
  readonly receiptFileStore?: SalesReceiptFileStore;
  readonly orderService?: OrderService;
  readonly versions?: DocumentVersionService;
  private readonly now: () => string;

  constructor(private readonly options: SalesDocumentServiceOptions) {
    this.repository = options.repository ?? new SalesDocumentRepository(options.database);
    this.quotationRepository = options.quotationRepository ?? new QuotationRepository(options.database);
    this.customerRepository = options.customerRepository ?? new CustomerRepository(options.database);
    this.customerProductRepository = options.customerProductRepository ?? new CustomerProductRepository(options.database);
    this.companyRepository = options.companyRepository;
    this.documentNumberRepository = options.documentNumberRepository ?? new DocumentNumberRepository(options.database);
    this.settingsRepository = options.settingsRepository ?? new SettingsRepository(options.database);
    this.productProvider = options.productProvider ?? new DatabaseSalesDocumentProductProvider(options.database);
    this.assetManager = options.assetManager;
    this.sourceFileReader = options.sourceFileReader;
    this.receiptFileStore = options.receiptFileStore;
    this.orderService = options.orderService;
    this.versions = options.versions;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  list(filters: SalesDocumentListFilters & {
    documentStatus?: SalesDocumentStatus | string;
    paymentStatus?: PaymentStatus | string;
  } = {}) {
    return this.repository.list({
      ...filters,
      documentStatus: filters.documentStatus == null ? undefined : normalizeDocumentStatus(filters.documentStatus),
      paymentStatus: filters.paymentStatus == null ? undefined : normalizePaymentStatus(filters.paymentStatus),
    });
  }

  get(id: number): SalesDocumentServiceDetail | undefined {
    const detail = this.repository.get(id);
    return detail ? asDetail(detail) : undefined;
  }

  async createOrderFromSalesDocument(salesDocumentId: number, createdBy?: string) {
    if (!this.orderService) {
      throw new SalesDocumentServiceError('ORDER_SERVICE_REQUIRED', '生成订单需要配置订单服务');
    }
    const document = this.repository.get(salesDocumentId);
    if (!document) {
      throw new SalesDocumentServiceError('SALES_DOCUMENT_NOT_FOUND', '销售单不存在');
    }
    if (document.documentStatus !== 'issued') {
      throw new SalesDocumentServiceError('SALES_DOCUMENT_NOT_ISSUED', '只有已开单的销售单可以生成订单');
    }
    const existing = this.repository.findGeneratedOrder(salesDocumentId);
    if (existing) {
      throw new SalesDocumentServiceError('ORDER_ALREADY_GENERATED', `该销售单已生成订单 ${existing.orderNo}`);
    }
    const invalidIndex = document.items.findIndex((item) => !Number.isSafeInteger(item.quantity) || item.quantity <= 0);
    if (invalidIndex >= 0) {
      throw new SalesDocumentServiceError(
        'ORDER_QUANTITY_INVALID',
        `第 ${invalidIndex + 1} 行数量 ${document.items[invalidIndex]!.quantity} 不是正整数，订单数量必须为整数`,
      );
    }
    // 含运含税口径下商品单价已含税，taxCents 只是“其中税额”，不能再并入运费。
    const taxIncluded = pricingBasisIncludesTax(document.pricingBasis);
    const shippingCents = document.shippingCents + (taxIncluded ? 0 : document.taxCents);
    const remarkParts = [document.remark.trim(), `生成自销售单 ${document.number}`];
    if (!taxIncluded && document.taxCents > 0) remarkParts.push(`含税费 ${centsToYuan(document.taxCents)} 元已并入运费`);
    const customer = document.customerId == null ? undefined : this.customerRepository.get(document.customerId);
    const company = this.resolveCompanyBySnapshot(document.companySnapshot.name);
    const input: CreateOrderInput = {
      orderNo: '',
      orderedAt: document.documentDate,
      customerId: document.customerId,
      customerName: document.customerName,
      customerContactName: document.contactName,
      customerContactPhone: document.contactPhone,
      customerShippingInfo: document.customerAddress,
      recipientName: document.consignee || document.contactName || document.customerName,
      recipientInfo: document.customerAddress,
      shippingCents,
      remark: remarkParts.filter(Boolean).join('；'),
      orderDetail: document.purchaseOrderNo.trim() ? `采购单号：${document.purchaseOrderNo.trim()}` : undefined,
      // 销售单没有渠道字段；销售单属于线下批发单据，避免生成订单默认落成线上单。
      channel: 'offline',
      // 付款政策以客户档案为准；销售单本身不保存账期快照。
      paymentPolicy: customer?.paymentPolicy,
      depositPercent: customer?.depositPercent,
      creditDays: customer?.creditDays,
      companyId: company?.id,
      sourceSalesDocumentId: salesDocumentId,
      createdBy: createdBy ?? '',
      receipts: document.receipts.map((receipt) => ({
        receivedAt: receipt.receivedAt,
        amountCents: receipt.amountCents,
        paymentMethod: receipt.paymentMethod,
        note: [receipt.note.trim(), `销售单 ${document.number} 收款转入`].filter(Boolean).join('；'),
        createdAt: receipt.createdAt,
      })),
      items: document.items.map((item) => ({
        productId: item.productId ?? undefined,
        customerProductId: item.customerProductId,
        name: item.name,
        sku: item.sku,
        specification: item.specification,
        packCount: item.packCount ?? undefined,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        // 订单行没有单独的参数/配置字段，转入备注避免信息丢失。
        remark: [item.remark.trim(), item.parameters.trim(), item.configuration?.label?.trim()].filter(Boolean).join('；'),
      })),
    };
    try {
      return await this.orderService.create(input);
    } catch (error) {
      if (error instanceof Error && error.message.includes('idx_orders_source_sales_document_id')) {
        const generated = this.repository.findGeneratedOrder(salesDocumentId);
        throw new SalesDocumentServiceError(
          'ORDER_ALREADY_GENERATED',
          generated ? `该销售单已生成订单 ${generated.orderNo}` : '该销售单已生成订单',
        );
      }
      throw error;
    }
  }

  async create(input: SalesDocumentInput, createdBy = ''): Promise<SalesDocumentServiceDetail> {
    const prepared = await this.prepareSave(input, undefined, null);
    try {
      await this.commitAssets(prepared.assetBatches);
      return withTransaction(this.options.database, (database) => {
        prepared.record.number = this.documentNumberRepository.next('sales', prepared.record.documentDate);
        const id = this.repository.insert(database, prepared.record);
        const detail = this.requireDetail(id);
        this.versions?.recordSalesDocument(detail, 'create', createdBy);
        return detail;
      });
    } catch (error) {
      await this.rollbackAssets(prepared.assetBatches);
      throw error;
    }
  }

  async createFromQuotation(
    quotationId: number,
    documentDate?: string,
    createdBy = '',
  ): Promise<SalesDocumentServiceDetail> {
    const quotation = this.quotationRepository.get(quotationId);
    if (!quotation) {
      throw new SalesDocumentServiceError('QUOTATION_NOT_FOUND', '报价单不存在');
    }
    if (quotation.status !== 'won') {
      throw new SalesDocumentServiceError('QUOTATION_NOT_WON', '只有已成交报价单可以复制为销售单', 'quotationId');
    }
    const items = await Promise.all(quotation.items.map(async (item, index): Promise<SalesDocumentItemInput> => {
      let imageUpload: SalesDocumentItemInput['imageUpload'];
      if (item.imageRelativePath) {
        if (!this.assetManager || !this.sourceFileReader) {
          throw new SalesDocumentServiceError(
            'ASSET_MANAGER_REQUIRED',
            '复制带图报价单需要配置销售单资源管理器和源文件读取器',
            `items.${index}.imageRelativePath`,
          );
        }
        const originalName = item.imageRelativePath.split('/').at(-1) ?? 'quotation-image.png';
        imageUpload = {
          stream: Readable.from([await this.sourceFileReader.readFile(item.imageRelativePath)]),
          originalName,
          mimeType: inferImageMimeType(originalName),
        };
      }
      return {
        clientKey: `quotation-${item.id}`,
        productId: item.productId,
        customerProductId: item.customerProductId,
        isTemporary: item.isTemporary,
        productCode: item.sku,
        name: item.name,
        sku: item.sku,
        specification: item.specification,
        parameters: item.parameters,
        imageUpload,
        // 报价单不含数量，复制为销售开单时数量默认 1，由业务在销售单中调整
        quantity: 1,
        packCount: item.packCount,
        unitPriceCents: item.unitPriceCents,
        configuration: item.configuration,
        remark: item.remark,
        sortOrder: index,
      };
    }));
    return this.createWithSourceQuotation({
      documentDate: documentDate ?? quotation.quotationDate,
      customerId: quotation.customerId,
      customerName: quotation.customerName,
      contactName: quotation.contactName,
      contactPhone: quotation.contactPhone,
      customerAddress: quotation.customerAddress,
      purchaseOrderNo: '',
      shippingCents: 0,
      taxRateBps: quotation.taxRateBps,
      pricingBasis: quotation.pricingBasis,
      issuer: quotation.companySnapshot.defaultIssuer,
      consignee: quotation.contactName,
      remark: quotation.remark,
      companySnapshot: quotation.companySnapshot,
      sourceQuotationId: quotationId,
      displayConfig: { showProductImages: false },
      items,
    }, quotationId, createdBy);
  }

  private async createWithSourceQuotation(
    input: SalesDocumentInput,
    sourceQuotationId: number,
    createdBy: string,
  ): Promise<SalesDocumentServiceDetail> {
    const prepared = await this.prepareSave(input, undefined, sourceQuotationId);
    try {
      await this.commitAssets(prepared.assetBatches);
      return withTransaction(this.options.database, (database) => {
        prepared.record.number = this.documentNumberRepository.next('sales', prepared.record.documentDate);
        const id = this.repository.insert(database, prepared.record);
        const detail = this.requireDetail(id);
        this.versions?.recordSalesDocument(detail, 'create', createdBy);
        return detail;
      });
    } catch (error) {
      await this.rollbackAssets(prepared.assetBatches);
      throw error;
    }
  }

  async update(id: number, input: SalesDocumentInput, createdBy = ''): Promise<SalesDocumentServiceDetail | undefined> {
    const existing = this.repository.get(id);
    if (!existing) return undefined;
    const prepared = await this.prepareSave(input, existing, existing.sourceQuotationId);
    try {
      await this.commitAssets(prepared.assetBatches);
      const detail = withTransaction(this.options.database, (database) => {
        if (existing.receivedCents > prepared.record.totalCents) {
          throw new SalesDocumentServiceError(
            'RECEIPT_EXCEEDS_TOTAL',
            '销售单合计不能小于已收金额',
            'totalCents',
          );
        }
        prepared.record.receivedCents = existing.receivedCents;
        prepared.record.outstandingCents = calculateOutstandingCents(prepared.record.totalCents, existing.receivedCents);
        prepared.record.paymentStatus = derivePaymentStatus(prepared.record.totalCents, existing.receivedCents);
        if (!this.repository.replace(database, id, prepared.record)) return undefined;
        const saved = this.requireDetail(id);
        this.versions?.recordSalesDocument(saved, 'update', createdBy);
        return saved;
      });
      if (!detail) {
        await this.rollbackAssets(prepared.assetBatches);
        return undefined;
      }
      const previous = existing.items.map((item) => item.imageRelativePath).filter((path): path is string => Boolean(path));
      if (existing.companySnapshot.logoRelativePath?.startsWith('sales-document-assets/')) {
        previous.push(existing.companySnapshot.logoRelativePath);
      }
      await this.deleteReplacedAssets(previous, prepared.assetPaths);
      return detail;
    } catch (error) {
      await this.rollbackAssets(prepared.assetBatches);
      throw error;
    }
  }

  updateStatus(id: number, status: unknown, createdBy = ''): SalesDocumentServiceDetail | undefined {
    const existing = this.repository.get(id);
    if (!existing) return undefined;
    const normalized = normalizeDocumentStatus(status);
    if (normalized === existing.documentStatus) return this.requireDetail(id);
    if (!DOCUMENT_STATUS_TRANSITIONS[existing.documentStatus].includes(normalized)) {
      throw new SalesDocumentServiceError(
        'INVALID_STATUS_TRANSITION',
        `销售单不能从“${DOCUMENT_STATUS_LABELS[existing.documentStatus]}”改为“${DOCUMENT_STATUS_LABELS[normalized]}”`,
        'documentStatus',
      );
    }
    if (normalized === 'void') {
      if (existing.receivedCents > 0) {
        throw new SalesDocumentServiceError('VOID_WITH_RECEIPTS', '销售单已有收款记录，不能直接作废；请先删除或冲销收款记录', 'documentStatus');
      }
      if (this.repository.findGeneratedOrder(id)) {
        throw new SalesDocumentServiceError('VOID_WITH_ORDER', '销售单已生成订单，不能直接作废；请先处理关联订单', 'documentStatus');
      }
    }
    return withTransaction(this.options.database, () => {
      if (!this.repository.updateStatus(id, normalized, this.now())) return undefined;
      const detail = this.requireDetail(id);
      this.versions?.recordSalesDocument(detail, 'status', createdBy);
      return detail;
    });
  }

  async delete(id: number, _confirmed = false): Promise<boolean> {
    const existing = this.repository.get(id);
    if (!existing) return false;
    if (existing.documentStatus === 'void') {
      throw new SalesDocumentServiceError('VOID_DOCUMENT_PRESERVED', '已作废销售单必须保留历史，不能删除');
    }
    if (existing.documentStatus === 'issued') {
      throw new SalesDocumentServiceError('ISSUED_DOCUMENT_PRESERVED', '已开单销售单必须保留历史，请作废后归档，不能删除');
    }
    if (existing.receivedCents > 0) {
      throw new SalesDocumentServiceError('DOCUMENT_HAS_RECEIPTS', '销售单已有收款记录，不能删除', 'confirmed');
    }
    if (this.repository.findGeneratedOrder(id)) {
      throw new SalesDocumentServiceError('ORDER_ALREADY_GENERATED', '销售单已生成订单，不能删除');
    }
    const paths = this.repository.listDocumentFilePaths(id);
    const deleted = withTransaction(this.options.database, () => {
      const removed = this.repository.delete(id);
      if (removed) this.versions?.removeAll('sales_document', id);
      return removed;
    });
    if (deleted) await this.deleteFiles(paths);
    return deleted;
  }

  /**
   * 销售单生成订单时收款已一次性转入订单财务；之后销售单上的收款只作快照，
   * 若继续允许增删改，订单台账与销售单台账会永久不一致。
   */
  private assertReceiptsEditable(documentId: number): void {
    const generated = this.repository.findGeneratedOrder(documentId);
    if (generated) {
      throw new SalesDocumentServiceError(
        'ORDER_ALREADY_GENERATED',
        `该销售单已生成订单 ${generated.orderNo}，收款与退款请在订单财务中维护`,
      );
    }
  }

  addReceipt(documentId: number, input: SalesReceiptInput): SalesReceipt {
    const document = this.repository.get(documentId);
    if (!document) throw new SalesDocumentServiceError('SALES_DOCUMENT_NOT_FOUND', '销售单不存在');
    if (document.documentStatus === 'void') {
      throw new SalesDocumentServiceError('VOID_DOCUMENT_PRESERVED', '已作废销售单不能添加收款', 'amountCents');
    }
    this.assertReceiptsEditable(documentId);
    const receipt = this.normalizeReceiptInput(documentId, input);
    const id = withTransaction(this.options.database, (database) => {
      const receiptId = this.repository.insertReceipt(database, receipt);
      this.recalculatePayment(database, documentId, document.totalCents, receipt.updatedAt);
      return receiptId;
    });
    return this.requireReceipt(id);
  }

  updateReceipt(receiptId: number, input: SalesReceiptInput): SalesReceipt {
    const existing = this.repository.getReceipt(receiptId);
    if (!existing) throw new SalesDocumentServiceError('RECEIPT_NOT_FOUND', '收款记录不存在');
    const document = this.repository.get(existing.salesDocumentId);
    if (!document) throw new SalesDocumentServiceError('SALES_DOCUMENT_NOT_FOUND', '销售单不存在');
    this.assertReceiptsEditable(existing.salesDocumentId);
    const receipt = this.normalizeReceiptInput(existing.salesDocumentId, input, existing.createdAt);
    withTransaction(this.options.database, (database) => {
      this.repository.updateReceipt(database, receiptId, receipt);
      this.recalculatePayment(database, existing.salesDocumentId, document.totalCents, receipt.updatedAt);
    });
    return this.requireReceipt(receiptId);
  }

  async deleteReceipt(receiptId: number): Promise<boolean> {
    const existing = this.repository.getReceipt(receiptId);
    if (!existing) return false;
    const document = this.repository.get(existing.salesDocumentId);
    if (!document) return false;
    this.assertReceiptsEditable(existing.salesDocumentId);
    const deleted = withTransaction(this.options.database, (database) => {
      const changed = this.repository.deleteReceipt(database, receiptId);
      if (changed) this.recalculatePayment(database, existing.salesDocumentId, document.totalCents, this.now());
      return changed;
    });
    if (deleted) await this.deleteFiles(existing.files.map((file) => file.relativePath));
    return deleted;
  }

  async addReceiptFile(receiptId: number, stagedFile: StagedFile): Promise<SalesReceiptFile> {
    const receipt = this.repository.getReceipt(receiptId);
    if (!receipt) {
      await this.receiptFileStore?.discardStagedFile(stagedFile);
      throw new SalesDocumentServiceError('RECEIPT_NOT_FOUND', '收款记录不存在');
    }
    if (!this.receiptFileStore) {
      throw new SalesDocumentServiceError('RECEIPT_FILE_STORE_REQUIRED', '保存付款凭证需要配置文件存储');
    }
    let fileId: number | undefined;
    try {
      fileId = withTransaction(this.options.database, (database) => this.repository.insertReceiptFile(database, {
        receiptId,
        relativePath: stagedFile.relativePath,
        originalName: stagedFile.originalName,
        mimeType: stagedFile.mimeType,
        sizeBytes: stagedFile.size,
        createdAt: this.now(),
      }));
      await this.receiptFileStore.commitStagedFile(stagedFile);
      const file = this.repository.getReceiptFile(fileId);
      if (!file) throw new Error('付款凭证元数据保存失败');
      return file;
    } catch (error) {
      if (fileId != null) {
        withTransaction(this.options.database, (database) => this.repository.deleteReceiptFile(database, fileId as number));
      }
      await Promise.all([
        this.receiptFileStore.discardStagedFile(stagedFile),
        this.receiptFileStore.deleteFile(stagedFile.relativePath),
      ]);
      throw error;
    }
  }

  async deleteReceiptFile(fileId: number): Promise<boolean> {
    const file = this.repository.getReceiptFile(fileId);
    if (!file) return false;
    const deleted = withTransaction(this.options.database, (database) => this.repository.deleteReceiptFile(database, fileId));
    if (deleted) await this.receiptFileStore?.deleteFile(file.relativePath);
    return deleted;
  }

  private async prepareSave(
    input: SalesDocumentInput,
    existing: SalesDocumentRepositoryDetail | undefined,
    sourceQuotationId: number | null,
  ): Promise<PreparedSave> {
    if (!input || typeof input !== 'object') throw new DocumentValidationError('销售单数据无效');
    const customer = this.resolveCustomer(input.customerId);
    if (input.documentStatus != null) normalizeDocumentStatus(input.documentStatus);
    const items = Array.isArray(input.items) ? input.items : [];
    const taxRateBps = validateTaxRateBps(input.taxRateBps);
    const pricingBasis = isQuotationPricingBasis(input.pricingBasis)
      ? input.pricingBasis
      : existing?.pricingBasis ?? 'shipping_ex_tax';
    const shippingCents = normalizeShippingCents(input);
    const productRows: SalesDocumentPersistenceItem[] = [];
    const assetInputs: DocumentItemImageInput[] = [];
    const assetKeys = new Set<string>();

    items.forEach((item, index) => {
      if (!item || typeof item !== 'object') throw new DocumentValidationError('产品行数据无效', `items.${index}`);
      if (typeof item.isTemporary !== 'boolean') {
        throw new DocumentValidationError('产品来源标记无效', `items.${index}.isTemporary`);
      }
      if (item.productId != null && (!Number.isInteger(item.productId) || item.productId <= 0)) {
        throw new DocumentValidationError('产品库产品 ID 无效', `items.${index}.productId`);
      }
      const previousItem = existing?.items.find((candidate) => candidate.id === item.id);
      const preserveSnapshot = Boolean(
        (existing == null && sourceQuotationId != null)
        || (
          previousItem
          && previousItem.productId === (item.productId ?? null)
          && previousItem.isTemporary === item.isTemporary
        ),
      );
      const customerProduct = this.resolveCustomerProduct(
        item.customerProductId,
        customer?.id ?? null,
        index,
      );
      const product = this.resolveProduct(item, index, preserveSnapshot);
      const name = normalizeText(
        preserveSnapshot
          ? item.name ?? previousItem?.name
          : customerProduct?.name ?? product?.name ?? item.name,
      );
      const sku = normalizeText(
        preserveSnapshot
          ? item.sku ?? previousItem?.sku
          : customerProduct?.sku || product?.sku || item.sku,
      );
      const specification = normalizeText(
        preserveSnapshot
          ? item.specification ?? previousItem?.specification
          : customerProduct?.specification || product?.specification || item.specification,
      );
      const parameters = normalizeParameters(
        preserveSnapshot
          ? item.parameters ?? previousItem?.parameters
          : product?.parameters ?? item.parameters,
      );
      const unitPriceCents = this.normalizePriceCents(item, index, customerProduct);
      const image = this.resolveImage(item, product);
      const key = normalizeText(item.clientKey) || `item-${index}`;
      if (image && !image.relativePath.startsWith('sales-document-assets/')) {
        if (!this.assetManager) {
          throw new SalesDocumentServiceError('ASSET_MANAGER_REQUIRED', '保存产品图片需要配置销售单资源管理器', `items.${index}.imageRelativePath`);
        }
        if (assetKeys.has(key)) throw new DocumentValidationError('产品图片关联标识重复', `items.${index}.clientKey`);
        assetKeys.add(key);
        assetInputs.push({
          key,
          productId: item.productId ?? product?.id,
          sourceRelativePath: item.imageUpload ? undefined : image.relativePath,
          originalName: image.originalName,
          mimeType: image.mimeType,
          ...(item.imageUpload ? { upload: item.imageUpload } : {}),
        });
      }
      productRows.push({
        productId: item.productId == null ? (product?.id ?? null) : item.productId,
        customerProductId: item.customerProductId ?? null,
        isTemporary: item.isTemporary,
        productCode: normalizeText(item.productCode) || previousItem?.productCode || sku,
        name,
        sku,
        specification,
        parameters,
        quantity: item.quantity,
        packCount: item.packCount == null
          ? (customerProduct?.packCount ?? null)
          : Math.max(1, Math.trunc(item.packCount)),
        unitPriceCents,
        amountCents: 0,
        configuration: item.isTemporary ? undefined : normalizeQuotationConfiguration(item.configuration),
        remark: normalizeText(item.remark),
        imageRelativePath: image?.relativePath ?? null,
        imageOriginalName: image?.originalName ?? normalizeText(item.imageOriginalName),
        sortOrder: Number.isInteger(item.sortOrder) && (item.sortOrder as number) >= 0 ? item.sortOrder as number : index,
      });
    });

    validateDocumentLines(productRows);
    productRows.forEach((row) => {
      row.amountCents = calculateLineAmountCents(row.quantity, row.unitPriceCents);
    });
    const totals = calculateDocumentTotalsForBasis(productRows, taxRateBps, shippingCents, pricingBasis);
    const fallbackCompany = this.settingsRepository.getCompanyProfile() ?? EMPTY_COMPANY_PROFILE;
    const companySnapshot = normalizeCompanySnapshot(input.companySnapshot, fallbackCompany);
    const updatedAt = this.now();
    const receivedCents = existing?.receivedCents ?? 0;
    const record: SalesDocumentPersistenceInput = {
      number: existing?.number ?? '',
      sourceQuotationId,
      documentStatus: existing?.documentStatus ?? 'draft',
      paymentStatus: derivePaymentStatus(totals.totalCents, receivedCents),
      documentDate: normalizeDate(input.documentDate, '开单日期'),
      customerId: input.customerId ?? null,
      customerName: normalizeText(input.customerName),
      contactName: normalizeText(input.contactName),
      contactPhone: normalizeText(input.contactPhone),
      customerAddress: normalizeText(input.customerAddress),
      purchaseOrderNo: normalizeText(input.purchaseOrderNo),
      issuer: normalizeText(input.issuer) || companySnapshot.defaultIssuer,
      consignee: normalizeText(input.consignee),
      remark: normalizeText(input.remark),
      shippingCents,
      taxRateBps,
      pricingBasis,
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      receivedCents,
      outstandingCents: calculateOutstandingCents(totals.totalCents, receivedCents),
      companySnapshot,
      displayConfig: normalizeDisplayConfig(input.displayConfig),
      items: productRows,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
    };

    const assetBatches: PreparedDocumentAssetBatch[] = [];
    if (assetInputs.length && this.assetManager) {
      const assetBatch = await this.assetManager.prepareItemImages('sales-asset', assetInputs);
      assetBatches.push(assetBatch);
      const assetsByKey = new Map(assetBatch.assets.map((asset) => [asset.key, asset]));
      productRows.forEach((row, index) => {
        const key = normalizeText(items[index]?.clientKey) || `item-${index}`;
        const asset = assetsByKey.get(key);
        if (asset) {
          row.imageRelativePath = asset.relativePath;
          row.imageOriginalName = asset.originalName;
        } else if (row.imageRelativePath && !row.imageRelativePath.startsWith('sales-document-assets/')) {
          throw new DocumentValidationError('产品图片资源未生成快照', `items.${index}.imageRelativePath`);
        }
      });
    }
    if (companySnapshot.logoRelativePath && !companySnapshot.logoRelativePath.startsWith('sales-document-assets/')) {
      if (!this.assetManager?.prepareCompanyLogo) {
        await this.rollbackAssets(assetBatches);
        throw new SalesDocumentServiceError('ASSET_MANAGER_REQUIRED', '保存公司 Logo 快照需要配置销售单资源管理器', 'companySnapshot.logoRelativePath');
      }
      const logoBatch = await this.assetManager.prepareCompanyLogo('sales-asset', companySnapshot.logoRelativePath);
      assetBatches.push(logoBatch);
      companySnapshot.logoRelativePath = logoBatch.assets[0]?.relativePath ?? null;
    }
    const assetPaths = new Set(productRows.map((item) => item.imageRelativePath).filter((path): path is string => Boolean(path)));
    if (companySnapshot.logoRelativePath?.startsWith('sales-document-assets/')) assetPaths.add(companySnapshot.logoRelativePath);
    return {
      record,
      assetBatches,
      assetPaths,
    };
  }

  /** 销售单只保存公司名称快照；名称能唯一匹配启用公司时带出订单公司，否则交给订单默认公司逻辑。 */
  private resolveCompanyBySnapshot(name: unknown): { id: number } | undefined {
    // 历史销售单的公司快照可能为空对象或缺字段，不能假定 name 一定是字符串。
    const normalized = typeof name === 'string' ? name.trim() : '';
    if (!normalized || !this.companyRepository) return undefined;
    const matches = this.companyRepository.list().filter((company) => (
      company.isActive && (company.fullName.trim() === normalized || company.shortName.trim() === normalized)
    ));
    return matches.length === 1 ? { id: matches[0]!.id } : undefined;
  }

  private resolveCustomer(customerId: number | null | undefined): { id: number; isActive: boolean } | undefined {
    if (customerId == null) return undefined;
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      throw new SalesDocumentServiceError('CUSTOMER_NOT_FOUND', '客户不存在', 'customerId');
    }
    const customer = this.customerRepository.get(customerId);
    if (!customer) throw new SalesDocumentServiceError('CUSTOMER_NOT_FOUND', '客户不存在', 'customerId');
    if (!customer.isActive) throw new SalesDocumentServiceError('CUSTOMER_INACTIVE', '客户已停用，不能保存销售单', 'customerId');
    return customer;
  }

  private resolveCustomerProduct(
    customerProductId: number | null | undefined,
    customerId: number | null,
    index: number,
  ): CustomerProduct | undefined {
    if (customerProductId == null) return undefined;
    if (!Number.isSafeInteger(customerProductId) || customerProductId <= 0) {
      throw new SalesDocumentServiceError('CUSTOMER_PRODUCT_NOT_FOUND', '客户产品不存在', `items.${index}.customerProductId`);
    }
    const product = this.customerProductRepository.getById(customerProductId);
    if (!product) throw new SalesDocumentServiceError('CUSTOMER_PRODUCT_NOT_FOUND', '客户产品不存在', `items.${index}.customerProductId`);
    if (customerId == null || product.customerId !== customerId) {
      throw new SalesDocumentServiceError('CUSTOMER_PRODUCT_CUSTOMER_MISMATCH', '客户产品不属于当前销售客户', `items.${index}.customerProductId`);
    }
    return product;
  }

  private normalizePriceCents(
    item: SalesDocumentItemInput,
    index: number,
    customerProduct: CustomerProduct | undefined,
  ): number {
    if (Object.prototype.hasOwnProperty.call(item, 'unitPriceCents') || Object.prototype.hasOwnProperty.call(item, 'unitPrice')) {
      if (item.unitPriceCents !== undefined || item.unitPrice !== undefined) return normalizePriceCents(item, index);
    }
    if (customerProduct?.finalPriceCents != null) return customerProduct.finalPriceCents;
    throw new DocumentValidationError('单价必须是有效数字', `items.${index}.unitPriceCents`);
  }

  private resolveProduct(item: SalesDocumentItemInput, index: number, preserveSnapshot: boolean): SalesDocumentProduct | undefined {
    if (item.isTemporary) {
      if (item.productId != null) throw new DocumentValidationError('临时产品不能关联产品库', `items.${index}.productId`);
      return undefined;
    }
    if (preserveSnapshot) return undefined;
    if (item.productId == null) throw new DocumentValidationError('系统产品必须选择产品库产品', `items.${index}.productId`);
    const product = this.productProvider.getProduct(item.productId);
    if (!product) throw new DocumentValidationError('产品库产品不存在', `items.${index}.productId`);
    return product;
  }

  private resolveImage(item: SalesDocumentItemInput, product: SalesDocumentProduct | undefined): SalesDocumentProductImage | undefined {
    const imagePath = normalizeText(item.imageRelativePath);
    if (imagePath.startsWith('sales-document-assets/')) {
      return {
        relativePath: imagePath,
        originalName: normalizeText(item.imageOriginalName) || 'sales-image',
        mimeType: normalizeText(item.imageMimeType) || 'image/png',
      };
    }
    const productImage = imagePath
      ? product?.images?.find((image) => image.relativePath === imagePath)
      : product?.images?.[0];
    if (productImage) return productImage;
    if (item.imageUpload) {
      return {
        relativePath: `upload:${normalizeText(item.clientKey)}`,
        originalName: item.imageUpload.originalName,
        mimeType: item.imageUpload.mimeType,
      };
    }
    if (!imagePath) return undefined;
    return {
      relativePath: imagePath,
      originalName: normalizeText(item.imageOriginalName) || 'sales-image',
      mimeType: normalizeText(item.imageMimeType) || 'image/png',
    };
  }

  private normalizeReceiptInput(
    salesDocumentId: number,
    input: SalesReceiptInput,
    createdAt = this.now(),
  ): SalesReceiptPersistenceInput {
    const updatedAt = this.now();
    return {
      salesDocumentId,
      receivedAt: normalizeDate(input.receivedAt, '收款日期'),
      amountCents: normalizeReceiptAmountCents(input),
      paymentMethod: normalizeText(input.paymentMethod),
      note: normalizeText(input.note),
      createdAt,
      updatedAt,
    };
  }

  private recalculatePayment(database: DatabaseSync, documentId: number, totalCents: number, updatedAt: string): void {
    const receivedCents = this.repository.sumReceipts(database, documentId);
    if (receivedCents > totalCents) {
      throw new SalesDocumentServiceError(
        'RECEIPT_EXCEEDS_TOTAL',
        '累计收款不能超过销售单应付金额',
        'amountCents',
      );
    }
    this.repository.updatePaymentTotals(
      database,
      documentId,
      receivedCents,
      calculateOutstandingCents(totalCents, receivedCents),
      derivePaymentStatus(totalCents, receivedCents),
      updatedAt,
    );
  }

  private requireDetail(id: number): SalesDocumentServiceDetail {
    const detail = this.get(id);
    if (!detail) throw new SalesDocumentServiceError('SALES_DOCUMENT_NOT_FOUND', '销售单不存在');
    return detail;
  }

  private requireReceipt(id: number): SalesReceipt {
    const receipt = this.repository.getReceipt(id);
    if (!receipt) throw new SalesDocumentServiceError('RECEIPT_NOT_FOUND', '收款记录不存在');
    return receipt;
  }

  private async commitAssets(batches: readonly PreparedDocumentAssetBatch[]): Promise<void> {
    if (!this.assetManager) return;
    for (const batch of batches) await this.assetManager.commit(batch);
  }

  private async rollbackAssets(batches: readonly PreparedDocumentAssetBatch[]): Promise<void> {
    if (!this.assetManager) return;
    await Promise.all(batches.map((batch) => this.assetManager!.rollback(batch)));
  }

  private async deleteFiles(paths: readonly string[]): Promise<void> {
    await Promise.all(paths.map(async (path) => {
      // 历史版本快照仍引用该文件时保留，否则按版本回看会缺图/缺凭证。
      if (this.versions?.isAssetReferenced(path)) return;
      if (path.startsWith('sales-receipt-proofs/')) {
        await this.receiptFileStore?.deleteFile(path);
      } else {
        await this.assetManager?.deleteFile?.(path);
      }
    }));
  }

  private async deleteReplacedAssets(previousPaths: readonly string[], currentPaths: Set<string>): Promise<void> {
    await this.deleteFiles(previousPaths.filter((path) => !currentPaths.has(path)));
  }
}

export function createSalesDocumentService(options: SalesDocumentServiceOptions): SalesDocumentService {
  return new SalesDocumentService(options);
}
