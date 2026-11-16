import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from '../db/connection.js';
import { DocumentNumberRepository } from '../db/document-number-repository.js';
import {
  QuotationRepository,
  type QuotationPersistenceInput,
  type QuotationPersistenceItem,
  type QuotationRepositoryDetail,
  type QuotationListFilters,
} from '../db/quotation-repository.js';
import { EMPTY_COMPANY_PROFILE, SettingsRepository } from '../db/settings-repository.js';
import { CustomerRepository } from '../db/customer-repository.js';
import { CustomerProductRepository } from '../db/customer-product-repository.js';
import type { CustomerProduct } from '../../shared/customers.js';
import type { DocumentItemImageInput, PreparedDocumentAsset, PreparedDocumentAssetBatch } from '../documents/document-assets.js';
import type {
  CompanySnapshot,
  QuotationDisplayConfig,
  QuotationPriceTier,
  QuotationStatus,
} from '../../shared/documents.js';
import { centsToYuan } from '../../shared/money.js';
import {
  calculateDocumentTotalsForBasis,
  isQuotationPricingBasis,
  normalizeQuotationConfiguration,
  type QuotationItemConfiguration,
  type QuotationPricingBasis,
} from '../../shared/quotation-config.js';
import {
  commitAssetBatches,
  deleteAssetFiles,
  deleteReplacedAssetFiles,
  isRecord,
  normalizeCompanySnapshot,
  normalizeCustomFields,
  normalizeDate,
  normalizeDisplayConfig,
  normalizeParameters,
  normalizePriceCents,
  normalizePriceTiers,
  normalizeText,
  recomputeQuotationConfiguration,
  rollbackAssetBatches,
} from './quotation-save.js';
import {
  DocumentValidationError,
  validateDocumentLines,
  validateTaxRateBps,
} from '../../shared/document-validation.js';

const QUOTATION_STATUSES: readonly QuotationStatus[] = ['draft', 'sent', 'won', 'expired'];

export interface QuotationProductImage {
  relativePath: string;
  originalName: string;
  mimeType: string;
}

export interface QuotationProduct {
  id: number;
  name: string;
  sku?: string;
  specification?: string;
  parameters?: string;
  images?: readonly QuotationProductImage[];
}

export interface QuotationProductProvider {
  getProduct(id: number): QuotationProduct | undefined;
}

class DatabaseQuotationProductProvider implements QuotationProductProvider {
  constructor(private readonly database: DatabaseSync) {}

  getProduct(id: number): QuotationProduct | undefined {
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

export interface QuotationAssetManager {
  prepareItemImages(
    targetKind: 'quotation-asset',
    inputs: readonly DocumentItemImageInput[],
  ): Promise<PreparedDocumentAssetBatch>;
  commit(batch: PreparedDocumentAssetBatch): Promise<readonly PreparedDocumentAsset[]>;
  rollback(batch: PreparedDocumentAssetBatch): Promise<void>;
  prepareCompanyLogo?(
    targetKind: 'quotation-asset',
    sourceRelativePath: string,
  ): Promise<PreparedDocumentAssetBatch>;
  deleteFile?(relativePath: string): Promise<void> | void;
}

export interface QuotationPriceTierInput {
  minQuantity: number;
  maxQuantity?: number | null;
  /** Convenience input for form layers that still express prices in yuan. */
  unitPrice?: number;
  unitPriceCents?: number;
}

export interface QuotationItemInput {
  clientKey?: string;
  id?: number;
  productId?: number | null;
  customerProductId?: number | null;
  isTemporary: boolean;
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
  quantity?: number;
  packCount?: number | null;
  unitPriceCents?: number;
  /** Convenience input for form layers that still express prices in yuan. */
  unitPrice?: number;
  priceTiers?: readonly QuotationPriceTierInput[];
  configuration?: QuotationItemConfiguration;
  remark?: string;
  sortOrder?: number;
}

export interface QuotationInput {
  id?: number;
  status?: QuotationStatus;
  quotationDate: string;
  customerId?: number | null;
  customerName: string;
  contactName?: string;
  contactPhone?: string;
  customerAddress?: string;
  validUntil?: string;
  remark?: string;
  taxRateBps: number;
  pricingBasis?: QuotationPricingBasis;
  companySnapshot?: Partial<CompanySnapshot>;
  displayConfig?: Partial<QuotationDisplayConfig> & { columns?: Partial<QuotationDisplayConfig['columns']> };
  items: readonly QuotationItemInput[];
  customFields?: readonly QuotationCustomFieldSaveInput[];
}

export interface QuotationCustomFieldSaveInput {
  id?: number;
  placement: 'header' | 'footer';
  label: string;
  value?: string;
  sortOrder?: number;
}

export interface QuotationServiceOptions {
  database: DatabaseSync;
  repository?: QuotationRepository;
  documentNumberRepository?: DocumentNumberRepository;
  settingsRepository?: SettingsRepository;
  customerRepository?: CustomerRepository;
  customerProductRepository?: CustomerProductRepository;
  productProvider?: QuotationProductProvider;
  assetManager?: QuotationAssetManager;
  now?: () => string;
}

export class QuotationServiceError extends Error {
  constructor(
    public readonly code:
      | 'CONFIRMATION_REQUIRED'
      | 'INVALID_STATUS'
      | 'QUOTATION_NOT_FOUND'
      | 'ASSET_MANAGER_REQUIRED'
      | 'CUSTOMER_NOT_FOUND'
      | 'CUSTOMER_INACTIVE'
      | 'CUSTOMER_PRODUCT_NOT_FOUND'
      | 'CUSTOMER_PRODUCT_CUSTOMER_MISMATCH',
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'QuotationServiceError';
  }
}

export type QuotationServiceDetail = QuotationRepositoryDetail & {
  subtotal: number;
  tax: number;
  total: number;
};

interface PreparedSave {
  record: QuotationPersistenceInput;
  assetBatches: PreparedDocumentAssetBatch[];
  assetPaths: Set<string>;
}

function normalizeStatus(value: unknown, field = 'status'): QuotationStatus {
  if (typeof value === 'string' && (QUOTATION_STATUSES as readonly string[]).includes(value)) {
    return value as QuotationStatus;
  }
  throw new QuotationServiceError('INVALID_STATUS', '报价单状态无效，可选值：草稿、已发送、已成交、已失效', field);
}

function asDetail(value: QuotationRepositoryDetail): QuotationServiceDetail {
  return {
    ...value,
    subtotal: centsToYuan(value.subtotalCents),
    tax: centsToYuan(value.taxCents),
    total: centsToYuan(value.totalCents),
  };
}

export class QuotationService {
  readonly database: DatabaseSync;
  readonly repository: QuotationRepository;
  readonly documentNumberRepository: DocumentNumberRepository;
  readonly settingsRepository: SettingsRepository;
  readonly customerRepository: CustomerRepository;
  readonly customerProductRepository: CustomerProductRepository;
  readonly productProvider?: QuotationProductProvider;
  readonly assetManager?: QuotationAssetManager;
  private readonly now: () => string;

  constructor(options: QuotationServiceOptions) {
    this.database = options.database;
    this.repository = options.repository ?? new QuotationRepository(options.database);
    this.documentNumberRepository = options.documentNumberRepository ?? new DocumentNumberRepository(options.database);
    this.settingsRepository = options.settingsRepository ?? new SettingsRepository(options.database);
    this.customerRepository = options.customerRepository ?? new CustomerRepository(options.database);
    this.customerProductRepository = options.customerProductRepository ?? new CustomerProductRepository(options.database);
    this.productProvider = options.productProvider ?? new DatabaseQuotationProductProvider(options.database);
    this.assetManager = options.assetManager;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  list(filters: QuotationListFilters & { status?: QuotationStatus | string } = {}) {
    return this.repository.list({
      ...filters,
      status: filters.status == null ? undefined : normalizeStatus(filters.status),
    });
  }

  get(id: number): QuotationServiceDetail | undefined {
    const detail = this.repository.get(id);
    return detail ? asDetail(detail) : undefined;
  }

  async create(input: QuotationInput): Promise<QuotationServiceDetail> {
    const prepared = await this.prepareSave(input, undefined);
    try {
      await this.commitAssets(prepared.assetBatches);
      const id = withTransaction(this.database, (database) => {
        const number = this.documentNumberRepository.next('quotation', prepared.record.quotationDate);
        prepared.record.number = number;
        return this.repository.insert(database, prepared.record);
      });
      return this.requireDetail(id);
    } catch (error) {
      await this.rollbackAssets(prepared.assetBatches);
      throw error;
    }
  }

  async update(id: number, input: QuotationInput): Promise<QuotationServiceDetail | undefined> {
    const existing = this.repository.get(id);
    if (!existing) return undefined;
    const prepared = await this.prepareSave(input, existing);
    try {
      await this.commitAssets(prepared.assetBatches);
      const changed = withTransaction(this.database, (database) => this.repository.replace(database, id, prepared.record));
      if (!changed) {
        await this.rollbackAssets(prepared.assetBatches);
        return undefined;
      }
      const detail = this.requireDetail(id);
      const previousPaths = existing.items
        .map((item) => item.imageRelativePath)
        .filter((path): path is string => Boolean(path));
      if (existing.companySnapshot.logoRelativePath?.startsWith('quotation-assets/')) {
        previousPaths.push(existing.companySnapshot.logoRelativePath);
      }
      await this.deleteReplacedAssets(previousPaths, prepared.assetPaths);
      return detail;
    } catch (error) {
      await this.rollbackAssets(prepared.assetBatches);
      throw error;
    }
  }

  updateStatus(id: number, status: unknown): QuotationServiceDetail | undefined {
    const normalized = normalizeStatus(status);
    if (!this.repository.updateStatus(id, normalized)) return undefined;
    return this.requireDetail(id);
  }

  async delete(id: number, confirmed = false): Promise<boolean> {
    const existing = this.repository.get(id);
    if (!existing) return false;
    if (existing.status === 'won' && !confirmed) {
      throw new QuotationServiceError('CONFIRMATION_REQUIRED', '已成交报价单删除前需要确认', 'confirmed');
    }
    const paths = existing.items.map((item) => item.imageRelativePath).filter((path): path is string => Boolean(path));
    if (existing.companySnapshot.logoRelativePath?.startsWith('quotation-assets/')) {
      paths.push(existing.companySnapshot.logoRelativePath);
    }
    const deleted = this.repository.delete(id);
    if (deleted) await this.deleteAssets(paths);
    return deleted;
  }

  private async prepareSave(input: QuotationInput, existing: QuotationRepositoryDetail | undefined): Promise<PreparedSave> {
    if (!isRecord(input)) throw new DocumentValidationError('报价单数据无效');
    const customer = this.resolveCustomer(input.customerId);
    const items = Array.isArray(input.items) ? input.items : [];
    if (input.status != null) normalizeStatus(input.status);
    const normalizedStatus = existing?.status ?? 'draft';
    const taxRateBps = validateTaxRateBps(input.taxRateBps);
    const pricingBasis = isQuotationPricingBasis(input.pricingBasis)
      ? input.pricingBasis
      : existing?.pricingBasis ?? 'shipping_ex_tax';
    const quotationDate = normalizeDate(input.quotationDate, '报价日期');
    const customFields = normalizeCustomFields(input.customFields ?? []);
    const productRows: QuotationPersistenceItem[] = [];
    const assetInputs: DocumentItemImageInput[] = [];
    const assetKeys = new Set<string>();
    items.forEach((item, index) => {
      if (!isRecord(item)) throw new DocumentValidationError('产品行数据无效', `items.${index}`);
      const itemInput = item as unknown as QuotationItemInput;
      if (typeof itemInput.isTemporary !== 'boolean') {
        throw new DocumentValidationError('产品来源标记无效', `items.${index}.isTemporary`);
      }
      if (
        itemInput.productId != null &&
        (!Number.isInteger(itemInput.productId) || itemInput.productId <= 0)
      ) {
        throw new DocumentValidationError('产品库产品 ID 无效', `items.${index}.productId`);
      }
      const previousItem = existing?.items.find((candidate) => candidate.id === itemInput.id);
      const preserveSnapshot = Boolean(
        previousItem
        && previousItem.productId === (itemInput.productId ?? null)
        && previousItem.isTemporary === itemInput.isTemporary,
      );
      const customerProduct = this.resolveCustomerProduct(
        itemInput.customerProductId,
        customer?.id ?? null,
        index,
      );
      const product = this.resolveProduct(itemInput, index, preserveSnapshot);
      const name = normalizeText(
        preserveSnapshot
          ? itemInput.name ?? previousItem?.name
          : customerProduct?.name ?? product?.name ?? itemInput.name,
      );
      const sku = normalizeText(
        preserveSnapshot
          ? itemInput.sku ?? previousItem?.sku
          : customerProduct?.sku || product?.sku || itemInput.sku,
      );
      const specification = normalizeText(
        preserveSnapshot
          ? itemInput.specification ?? previousItem?.specification
          : customerProduct?.specification || product?.specification || itemInput.specification,
      );
      const parameters = normalizeParameters(
        preserveSnapshot
          ? itemInput.parameters ?? previousItem?.parameters
          : product?.parameters ?? itemInput.parameters,
      );
      let unitPriceCents = this.normalizePriceCents(itemInput, index, customerProduct);
      const priceTiers = normalizePriceTiers(itemInput, index);
      let configuration = normalizeQuotationConfiguration(itemInput.configuration);
      if (configuration && (itemInput.isTemporary || (itemInput.productId ?? product?.id) == null)) {
        configuration = undefined;
      }
      if (configuration) {
        configuration = recomputeQuotationConfiguration(configuration, pricingBasis, taxRateBps);
        if (!configuration.priceOverridden) unitPriceCents = configuration.computedSalePriceCents;
      }
      const image = this.resolveImage(itemInput, product);
      const key = normalizeText(itemInput.clientKey) || `item-${index}`;
      if (image && !image.relativePath.startsWith('quotation-assets/')) {
        if (!this.assetManager) {
          throw new QuotationServiceError('ASSET_MANAGER_REQUIRED', '保存产品图片需要配置报价单资源管理器', `items.${index}.imageRelativePath`);
        }
        if (assetKeys.has(key)) throw new DocumentValidationError('产品图片关联标识重复', `items.${index}.clientKey`);
        assetKeys.add(key);
        assetInputs.push({
          key,
          productId: itemInput.productId ?? product?.id,
          customerProductId: itemInput.customerProductId ?? undefined,
          sourceRelativePath: itemInput.imageUpload ? undefined : image.relativePath,
          originalName: image.originalName,
          mimeType: image.mimeType,
          ...(itemInput.imageUpload ? { upload: itemInput.imageUpload } : {}),
        });
      }
      const imageRelativePath = image?.relativePath ?? null;
      productRows.push({
        productId: itemInput.productId == null ? (product?.id ?? null) : itemInput.productId,
        customerProductId: itemInput.customerProductId ?? null,
        isTemporary: Boolean(itemInput.isTemporary),
        name,
        sku,
        specification,
        parameters,
        packCount: itemInput.packCount == null
          ? (customerProduct?.packCount ?? null)
          : Math.max(1, Math.trunc(itemInput.packCount)),
        unitPriceCents,
        priceTiers,
        configuration,
        remark: normalizeText(itemInput.remark),
        imageRelativePath,
        imageOriginalName: image?.originalName ?? normalizeText(itemInput.imageOriginalName),
        sortOrder: Number.isInteger(itemInput.sortOrder) && (itemInput.sortOrder as number) >= 0 ? itemInput.sortOrder as number : index,
      });
    });

    validateDocumentLines(productRows.map((row) => ({ name: row.name, quantity: 1, unitPriceCents: row.unitPriceCents })));
    const totals = calculateDocumentTotalsForBasis(
      productRows.map((row) => ({ quantity: 1, unitPriceCents: row.unitPriceCents })),
      taxRateBps,
      0,
      pricingBasis,
    );
    const fallbackCompany = this.settingsRepository.getCompanyProfile();
    const companySnapshot = normalizeCompanySnapshot(input.companySnapshot, fallbackCompany ?? EMPTY_COMPANY_PROFILE);
    const displayConfig = normalizeDisplayConfig(input.displayConfig);
    const updatedAt = this.now();
    const record: QuotationPersistenceInput = {
      number: existing?.number ?? '',
      status: normalizedStatus,
      quotationDate,
      customerId: input.customerId ?? null,
      customerName: normalizeText(input.customerName),
      contactName: normalizeText(input.contactName),
      contactPhone: normalizeText(input.contactPhone),
      customerAddress: normalizeText(input.customerAddress),
      validUntil: input.validUntil ? normalizeDate(input.validUntil, '有效期') : '',
      remark: normalizeText(input.remark),
      taxRateBps,
      pricingBasis,
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      companySnapshot,
      displayConfig,
      items: productRows,
      customFields,
      customerProductsSyncedAt: existing?.customerProductsSyncedAt ?? null,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
    };

    const assetBatches: PreparedDocumentAssetBatch[] = [];
    if (assetInputs.length && this.assetManager) {
      const assetBatch = await this.assetManager.prepareItemImages('quotation-asset', assetInputs);
      assetBatches.push(assetBatch);
      const committed = assetBatch.assets;
      const assetsByKey = new Map(committed.map((asset) => [asset.key, asset]));
      productRows.forEach((row, index) => {
        const key = normalizeText(items[index]?.clientKey) || `item-${index}`;
        const asset = assetsByKey.get(key);
        if (asset) {
          row.imageRelativePath = asset.relativePath;
          row.imageOriginalName = asset.originalName;
        } else if (row.imageRelativePath && !row.imageRelativePath.startsWith('quotation-assets/')) {
          throw new DocumentValidationError('产品图片资源未生成快照', `items.${index}.imageRelativePath`);
        }
      });
    }

    if (companySnapshot.logoRelativePath && !companySnapshot.logoRelativePath.startsWith('quotation-assets/')) {
      if (!this.assetManager?.prepareCompanyLogo) {
        await this.rollbackAssets(assetBatches);
        throw new QuotationServiceError('ASSET_MANAGER_REQUIRED', '保存公司 Logo 快照需要配置报价单资源管理器', 'companySnapshot.logoRelativePath');
      }
      const logoBatch = await this.assetManager.prepareCompanyLogo('quotation-asset', companySnapshot.logoRelativePath);
      assetBatches.push(logoBatch);
      companySnapshot.logoRelativePath = logoBatch.assets[0]?.relativePath ?? null;
    }

    const assetPaths = new Set(productRows.map((item) => item.imageRelativePath).filter((path): path is string => Boolean(path)));
    if (companySnapshot.logoRelativePath?.startsWith('quotation-assets/')) assetPaths.add(companySnapshot.logoRelativePath);
    return { record, assetBatches, assetPaths };
  }

  private resolveCustomer(customerId: number | null | undefined): { id: number; isActive: boolean } | undefined {
    if (customerId == null) return undefined;
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      throw new QuotationServiceError('CUSTOMER_NOT_FOUND', '客户不存在', 'customerId');
    }
    const customer = this.customerRepository.get(customerId);
    if (!customer) throw new QuotationServiceError('CUSTOMER_NOT_FOUND', '客户不存在', 'customerId');
    if (!customer.isActive) throw new QuotationServiceError('CUSTOMER_INACTIVE', '客户已停用，不能保存报价单', 'customerId');
    return customer;
  }

  private resolveCustomerProduct(
    customerProductId: number | null | undefined,
    customerId: number | null,
    index: number,
  ): CustomerProduct | undefined {
    if (customerProductId == null) return undefined;
    if (!Number.isSafeInteger(customerProductId) || customerProductId <= 0) {
      throw new QuotationServiceError('CUSTOMER_PRODUCT_NOT_FOUND', '客户产品不存在', `items.${index}.customerProductId`);
    }
    const product = this.customerProductRepository.getById(customerProductId);
    if (!product) throw new QuotationServiceError('CUSTOMER_PRODUCT_NOT_FOUND', '客户产品不存在', `items.${index}.customerProductId`);
    if (customerId == null || product.customerId !== customerId) {
      throw new QuotationServiceError('CUSTOMER_PRODUCT_CUSTOMER_MISMATCH', '客户产品不属于当前报价客户', `items.${index}.customerProductId`);
    }
    return product;
  }

  private normalizePriceCents(
    item: QuotationItemInput,
    index: number,
    customerProduct: CustomerProduct | undefined,
  ): number {
    if (Object.prototype.hasOwnProperty.call(item, 'unitPriceCents') || Object.prototype.hasOwnProperty.call(item, 'unitPrice')) {
      if (item.unitPriceCents !== undefined || item.unitPrice !== undefined) return normalizePriceCents(item, index);
    }
    if (customerProduct?.finalPriceCents != null) return customerProduct.finalPriceCents;
    throw new DocumentValidationError('单价必须是有效数字', `items.${index}.unitPriceCents`);
  }

  private resolveProduct(item: QuotationItemInput, index: number, preserveSnapshot: boolean): QuotationProduct | undefined {
    if (item.isTemporary) {
      if (item.productId != null) throw new DocumentValidationError('临时产品不能关联产品库', `items.${index}.productId`);
      return undefined;
    }
    if (item.productId == null) {
      throw new DocumentValidationError('系统产品必须选择产品库产品', `items.${index}.productId`);
    }
    if (preserveSnapshot) return undefined;
    const product = this.productProvider?.getProduct(item.productId);
    if (this.productProvider && !product) {
      throw new DocumentValidationError('产品库产品不存在', `items.${index}.productId`);
    }
    return product;
  }

  private resolveImage(item: QuotationItemInput, product: QuotationProduct | undefined): QuotationProductImage | undefined {
    const imagePath = normalizeText(item.imageRelativePath);
    if (imagePath.startsWith('quotation-assets/')) {
      return {
        relativePath: imagePath,
        originalName: normalizeText(item.imageOriginalName) || 'quotation-image',
        mimeType: normalizeText(item.imageMimeType) || 'image/png',
      };
    }
    const productImage = imagePath
      ? product?.images?.find((image) => image.relativePath === imagePath)
      : product?.images?.[0];
    if (productImage) return productImage;
    if (!imagePath) {
      if (item.imageUpload) {
        return { relativePath: `upload:${normalizeText(item.clientKey)}`, originalName: item.imageUpload.originalName, mimeType: item.imageUpload.mimeType };
      }
      return undefined;
    }
    return {
      relativePath: imagePath,
      originalName: normalizeText(item.imageOriginalName) || 'quotation-image',
      mimeType: normalizeText(item.imageMimeType) || 'image/png',
    };
  }

  private requireDetail(id: number): QuotationServiceDetail {
    const detail = this.get(id);
    if (!detail) throw new QuotationServiceError('QUOTATION_NOT_FOUND', '报价单不存在');
    return detail;
  }

  private async commitAssets(batches: readonly PreparedDocumentAssetBatch[]): Promise<void> {
    await commitAssetBatches(this.assetManager, batches);
  }

  private async rollbackAssets(batches: readonly PreparedDocumentAssetBatch[]): Promise<void> {
    await rollbackAssetBatches(this.assetManager, batches);
  }

  private async deleteAssets(paths: readonly string[]): Promise<void> {
    await deleteAssetFiles(this.assetManager, paths);
  }

  private async deleteReplacedAssets(previousPaths: readonly string[], currentPaths: Set<string>): Promise<void> {
    await deleteReplacedAssetFiles(this.assetManager, previousPaths, currentPaths);
  }
}

export function createQuotationService(options: QuotationServiceOptions): QuotationService {
  return new QuotationService(options);
}
