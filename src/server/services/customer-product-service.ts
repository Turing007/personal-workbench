import type {
  CustomerProduct,
  CustomerProductBatchSaveInput,
  CustomerProductListFilters,
  CustomerProductSaveInput,
} from '../../shared/customers.js';
import { normalizeCustomerProductTaxMode, type CustomerProductTaxMode } from '../../shared/customers.js';
import {
  CustomerProductRepository,
  SystemProductNotFoundError,
} from '../db/customer-product-repository.js';
import { CustomerRepository } from '../db/customer-repository.js';
import type { SettingsRepository } from '../db/settings-repository.js';

type CustomerProductField = keyof CustomerProductSaveInput | keyof CustomerProductBatchSaveInput | 'ids' | 'status';

export class CustomerProductValidationError extends Error {
  constructor(
    message: string,
    public readonly field: CustomerProductField,
  ) {
    super(message);
    this.name = 'CustomerProductValidationError';
  }
}

export class CustomerProductExistsError extends Error {
  constructor(message = '该客户已存在相同产品') {
    super(message);
    this.name = 'CustomerProductExistsError';
  }
}

export class CustomerNotFoundError extends Error {
  constructor() {
    super('客户不存在');
    this.name = 'CustomerNotFoundError';
  }
}

export class CustomerInactiveError extends Error {
  constructor() {
    super('客户已停用，不能新增客户产品');
    this.name = 'CustomerInactiveError';
  }
}

export class CustomerProductNotFoundError extends Error {
  constructor() {
    super('客户产品不存在');
    this.name = 'CustomerProductNotFoundError';
  }
}

export class CustomerProductService {
  constructor(
    private readonly repository: CustomerProductRepository,
    private readonly customerRepository: CustomerRepository,
    private readonly systemProductExists: (systemProductId: number) => boolean = () => true,
    private readonly settingsRepository?: SettingsRepository,
  ) {}

  private taxFlags(): Record<string, CustomerProductTaxMode> {
    return this.settingsRepository?.getCustomerProductTaxFlags() ?? {};
  }

  private withTaxFlag(product: CustomerProduct, flags: Record<string, CustomerProductTaxMode> = this.taxFlags()): CustomerProduct {
    return { ...product, finalPriceIncludesTax: flags[String(product.id)] ?? null };
  }

  /** undefined = 老客户端没传，保持原值；null = 清空标记；inc/exc = 设置标记。 */
  private saveTaxFlag(productId: number, value: unknown): void {
    if (!this.settingsRepository || value === undefined) return;
    this.settingsRepository.setCustomerProductTaxFlag(productId, normalizeCustomerProductTaxMode(value));
  }

  list(customerId: number, filters: CustomerProductListFilters = {}): CustomerProduct[] {
    this.assertCustomer(customerId);
    const status = filters.status ?? 'all';
    if (!['all', 'incomplete', 'complete'].includes(status)) {
      throw new CustomerProductValidationError('完善状态无效', 'status');
    }
    const products = this.repository.list(customerId, {
      search: filters.search?.trim(),
      status,
    });
    const flags = this.taxFlags();
    return products.map((product) => this.withTaxFlag(product, flags));
  }

  setStickerFile(id: number, relativePath: string | null): CustomerProduct | undefined {
    return this.repository.setStickerFile(id, relativePath);
  }

  stickerLedger(id: number, limit = 100) {
    const product = this.repository.getById(id);
    if (!product) return undefined;
    const transactions = this.repository.listStickerTransactions(id, limit).map((row) => ({
      id: Number(row.id),
      kind: String(row.kind),
      quantity: Number(row.quantity ?? 0),
      sheets: row.sheets == null ? null : Number(row.sheets),
      perSheet: row.per_sheet == null ? null : Number(row.per_sheet),
      orderId: row.order_id == null ? null : Number(row.order_id),
      note: String(row.note ?? ''),
      createdAt: String(row.created_at ?? ''),
    }));
    const printed = transactions.filter((row) => row.kind === 'print').reduce((sum, row) => sum + row.quantity, 0);
    const consumed = -transactions.filter((row) => row.kind === 'consume').reduce((sum, row) => sum + row.quantity, 0);
    return { remaining: product.stickerRemaining, printed, consumed, transactions };
  }

  addStickerTransaction(id: number, input: { kind: 'print' | 'adjust'; sheets?: number; quantity?: number; note?: string }) {
    const product = this.repository.getById(id);
    if (!product) return undefined;
    if (!product.stickerEnabled) throw new CustomerProductValidationError('该产品还没有开启贴标', 'stickerEnabled');
    if (input.kind === 'print') {
      const sheets = Math.max(0, Math.trunc(Number(input.sheets) || 0));
      if (sheets <= 0) throw new CustomerProductValidationError('打印张数必须是正整数', 'stickerPerSheet');
      const perSheet = Math.max(0, product.stickerPerSheet);
      if (perSheet <= 0) throw new CustomerProductValidationError('请先填写每张标贴数量', 'stickerPerSheet');
      this.repository.addStickerTransaction(id, { kind: 'print', quantity: sheets * perSheet, sheets, perSheet, note: input.note });
    } else {
      const quantity = Math.trunc(Number(input.quantity) || 0);
      if (quantity === 0) throw new CustomerProductValidationError('调整数量不能为 0', 'stickerPerSheet');
      this.repository.addStickerTransaction(id, { kind: 'adjust', quantity, note: input.note });
    }
    return this.stickerLedger(id);
  }

  get(id: number): CustomerProduct | undefined {
    const product = this.repository.getById(id);
    return product ? this.withTaxFlag(product) : undefined;
  }

  create(customerId: number, input: CustomerProductSaveInput): CustomerProduct {
    this.assertActiveCustomer(customerId);
    if (input.systemProductId !== undefined && input.systemProductId !== null) {
      throw new CustomerProductValidationError('系统产品只能通过产品库调用', 'systemProductId');
    }
    const normalized = normalizeInput(input);
    if (this.repository.findTemporary(customerId, normalized.name, normalized.specification)) {
      throw new CustomerProductExistsError();
    }
    const product = this.repository.create(customerId, normalized);
    this.saveTaxFlag(product.id, input.finalPriceIncludesTax);
    return this.withTaxFlag(product);
  }

  createFromSystemProduct(customerId: number, systemProductId: unknown): CustomerProduct {
    this.assertActiveCustomer(customerId);
    const normalizedId = normalizePositiveId(systemProductId, 'systemProductId');
    // 同一客户可以多次导入同一个系统产品：系统 SKU 有多个规格，客户会按规格各建一条。
    return this.withTaxFlag(this.repository.createFromSystemProduct(customerId, normalizedId));
  }

  createFromSystemProductWithInput(customerId: number, systemProductId: unknown, input: CustomerProductSaveInput): CustomerProduct {
    this.assertActiveCustomer(customerId);
    const normalizedId = normalizePositiveId(systemProductId, 'systemProductId');
    const normalized = normalizeInput({ ...input, systemProductId: normalizedId });
    const product = this.repository.createFromSystemProduct(customerId, normalizedId, normalized);
    this.saveTaxFlag(product.id, input.finalPriceIncludesTax);
    return this.withTaxFlag(product);
  }

  createMany(customerId: number, input: CustomerProductBatchSaveInput): CustomerProduct[] {
    this.assertActiveCustomer(customerId);
    const items = normalizeBatchItems(input.items);
    if (!items.length) {
      throw new CustomerProductValidationError('请至少添加一行产品', 'items');
    }
    if (items.length > MAX_CUSTOMER_PRODUCT_BATCH_SIZE) {
      throw new CustomerProductValidationError(`单个批次最多创建 ${MAX_CUSTOMER_PRODUCT_BATCH_SIZE} 个客户产品`, 'items');
    }
    const template = normalizeInput({
      systemProductId: null,
      name: items[0].name,
      specification: items[0].specification,
      sku: items[0].sku,
      packCount: input.packCount,
      finalPriceCents: input.finalPriceCents ?? null,
      costPriceCents: input.costPriceCents,
      freightPerBoxCents: input.freightPerBoxCents,
      remark: input.remark,
      labelRequirement: input.labelRequirement,
      packaging: input.packaging,
    });
    const conflicts = items.filter((item) => this.repository.findTemporary(customerId, item.name, item.specification));
    if (conflicts.length) {
      throw new CustomerProductExistsError(`该客户已存在相同产品：${conflicts.map((item) => item.name).join('、')}`);
    }
    const products = this.repository.createMany(customerId, items.map((item) => ({
      ...template,
      name: item.name,
      specification: item.specification,
      sku: item.sku,
    })));
    for (const product of products) this.saveTaxFlag(product.id, input.finalPriceIncludesTax);
    const flags = this.taxFlags();
    return products.map((product) => this.withTaxFlag(product, flags));
  }

  update(id: number, input: CustomerProductSaveInput): CustomerProduct | undefined {
    const existing = this.repository.getById(id);
    if (!existing) return undefined;
    const normalized = normalizeInput(input);
    if (existing.systemProductId === null) {
      const duplicate = this.repository.findTemporary(
        existing.customerId,
        normalized.name,
        normalized.specification,
      );
      if (duplicate && duplicate.id !== id) throw new CustomerProductExistsError();
    }
    const updated = this.repository.update(id, normalized);
    if (!updated) return undefined;
    this.saveTaxFlag(id, input.finalPriceIncludesTax);
    return this.withTaxFlag(updated);
  }

  remove(id: number): boolean {
    return this.repository.delete(id);
  }

  /** 备货模块补关联：一次性建立与系统产品的映射并填写报供名称；传 null 表示清除映射。 */
  linkSystemProduct(id: number, input: { systemProductId: unknown; supplierProductName?: unknown }): CustomerProduct {
    const existing = this.repository.getById(id);
    if (!existing) throw new CustomerProductNotFoundError();
    if (input.systemProductId === null || input.systemProductId === '') {
      return this.withTaxFlag(this.repository.setSystemProduct(id, null, '')!);
    }
    const systemProductId = normalizePositiveId(input.systemProductId, 'systemProductId');
    if (!this.systemProductExists(systemProductId)) throw new SystemProductNotFoundError();
    // 允许多条客户产品关联同一个系统产品（不同规格），不再要求先解除旧关联。
    const supplierProductName = input.supplierProductName === undefined || input.supplierProductName === null
      ? ''
      : normalizeText(input.supplierProductName, 'supplierProductName', '供应商产品名称');
    const updated = this.repository.setSystemProduct(id, systemProductId, supplierProductName);
    if (!updated) throw new CustomerProductNotFoundError();
    return this.withTaxFlag(updated);
  }

  setImagePath(id: number, imageRelativePath: string | null): CustomerProduct | undefined {
    const updated = this.repository.setImagePath(id, imageRelativePath);
    return updated ? this.withTaxFlag(updated) : undefined;
  }

  addAttachment(
    id: number,
    file: { relativePath: string; originalName: string; mimeType: string; size: number; category: CustomerProduct['attachments'][number]['category'] },
  ) {
    if (!this.repository.getById(id)) throw new CustomerProductNotFoundError();
    return this.repository.addAttachment(id, file);
  }

  deleteAttachment(id: number, attachmentId: number): string | undefined {
    if (!this.repository.getById(id)) throw new CustomerProductNotFoundError();
    return this.repository.deleteAttachment(id, attachmentId);
  }

  updateAttachmentCategory(id: number, attachmentId: number, category: CustomerProduct['attachments'][number]['category']): boolean {
    if (!this.repository.getById(id)) throw new CustomerProductNotFoundError();
    return this.repository.updateAttachmentCategory(id, attachmentId, category);
  }

  deleteMany(customerId: number, ids: unknown): number {
    this.assertCustomer(customerId);
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new CustomerProductValidationError('请选择需要删除的客户产品', 'ids');
    }
    const normalizedIds = [...new Set(ids.map((id) => normalizePositiveId(id, 'ids')))];
    const allBelongToCustomer = normalizedIds.every((id) => (
      this.repository.getById(id)?.customerId === customerId
    ));
    if (!allBelongToCustomer) throw new CustomerProductNotFoundError();
    return this.repository.deleteMany(customerId, normalizedIds);
  }

  private assertCustomer(customerId: number): void {
    if (!this.customerRepository.get(customerId)) throw new CustomerNotFoundError();
  }

  private assertActiveCustomer(customerId: number): void {
    const customer = this.customerRepository.get(customerId);
    if (!customer) throw new CustomerNotFoundError();
    if (!customer.isActive) throw new CustomerInactiveError();
  }
}

export { SystemProductNotFoundError };

const MAX_CUSTOMER_PRODUCT_BATCH_SIZE = 50;

/** 校验并规范化批量清单：品名必填，规格/SKU 逐行取值，按"品名+规格"（不区分大小写）去除批次内重复行。 */
function normalizeBatchItems(value: unknown): Array<{ name: string; specification: string; sku: string }> {
  if (!Array.isArray(value)) {
    throw new CustomerProductValidationError('产品清单必须是数组', 'items');
  }
  const seen = new Set<string>();
  const items: Array<{ name: string; specification: string; sku: string }> = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new CustomerProductValidationError(`产品清单第 ${index + 1} 行无效`, 'items');
    }
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) {
      throw new CustomerProductValidationError(`产品清单第 ${index + 1} 行的品名不能为空`, 'items');
    }
    const specification = typeof row.specification === 'string' ? row.specification.trim() : '';
    const sku = typeof row.sku === 'string' ? row.sku.trim() : '';
    const key = `${name.toLowerCase()}\u0000${specification.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ name, specification, sku });
  });
  return items;
}

function normalizeInput(input: CustomerProductSaveInput): CustomerProductSaveInput {
  return {
    systemProductId: input.systemProductId ?? null,
    name: normalizeText(input.name, 'name', '品名', true),
    supplierProductName: input.supplierProductName === undefined
      ? undefined
      : normalizeText(input.supplierProductName, 'supplierProductName', '供应商产品名称'),
    specification: normalizeText(input.specification, 'specification', '规格'),
    sku: normalizeText(input.sku, 'sku', 'SKU'),
    packCount: normalizeNullableInteger(input.packCount, 'packCount', '装箱数', true),
    finalPriceCents: normalizeNullableInteger(
      input.finalPriceCents,
      'finalPriceCents',
      '最终价格',
      false,
    ),
    costPriceCents: normalizeNullableInteger(
      input.costPriceCents,
      'costPriceCents',
      '机头/基础成本',
      false,
    ),
    batteryCostCents: normalizeNullableInteger(input.batteryCostCents, 'batteryCostCents', '电池成本', false),
    chargerCostCents: normalizeNullableInteger(input.chargerCostCents, 'chargerCostCents', '充电器成本', false),
    packagingCostCents: normalizeNullableInteger(input.packagingCostCents, 'packagingCostCents', '包装成本', false),
    accessoryCostCents: normalizeNullableInteger(input.accessoryCostCents, 'accessoryCostCents', '配件成本', false),
    otherCostCents: normalizeNullableInteger(input.otherCostCents, 'otherCostCents', '其他单件成本', false),
    costConfirmed: input.costConfirmed === undefined ? undefined : Boolean(input.costConfirmed),
    freightPerBoxCents: normalizeNullableInteger(
      input.freightPerBoxCents,
      'freightPerBoxCents',
      '运费/箱',
      false,
    ),
    packaging: input.packaging === undefined ? undefined : normalizePackaging(input.packaging),
    remark: input.remark === undefined
      ? undefined
      : normalizeText(input.remark, 'remark', '备注'),
    labelRequirement: input.labelRequirement === undefined
      ? undefined
      : normalizeText(input.labelRequirement, 'labelRequirement', '箱唛要求'),
    stickerEnabled: input.stickerEnabled === undefined ? undefined : Boolean(input.stickerEnabled),
    stickerPerSheet: input.stickerPerSheet === undefined
      ? undefined
      : Math.max(0, Math.trunc(Number(input.stickerPerSheet) || 0)),
    imageRelativePath: normalizeOptionalImagePath(input.imageRelativePath),
  };
}

function normalizePackaging(value: unknown): CustomerProductSaveInput['packaging'] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new CustomerProductValidationError('包装信息必须是数组', 'packaging');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new CustomerProductValidationError(`包装信息第 ${index + 1} 行无效`, 'packaging');
    const row = item as Record<string, unknown>;
    const number = (field: string, label: string, positive = false) => {
      const value = row[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
        throw new CustomerProductValidationError(`${label}必须是${positive ? '正' : '非负'}数字`, 'packaging');
      }
      return value;
    };
    const text = (field: string) => typeof row[field] === 'string' ? String(row[field]).trim() : '';
    return {
      id: row.id == null ? undefined : String(row.id),
      name: text('name'),
      innerSize: text('innerSize'),
      innerWeight: number('innerWeight', '内盒重量'),
      outerSize: text('outerSize'),
      outerWeight: number('outerWeight', '外箱重量'),
      packCount: Math.trunc(number('packCount', '装箱数', true)),
    };
  });
}

function normalizeOptionalImagePath(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new CustomerProductValidationError('图片路径必须是文本', 'imageRelativePath');
  return value.trim() || null;
}

function normalizeText(
  value: unknown,
  field: CustomerProductField,
  label: string,
  required = false,
): string {
  if (value === undefined || value === null) {
    if (required) throw new CustomerProductValidationError(`${label}不能为空`, field);
    return '';
  }
  if (typeof value !== 'string') {
    throw new CustomerProductValidationError(`${label}必须是文本`, field);
  }
  const normalized = value.trim();
  if (required && !normalized) {
    throw new CustomerProductValidationError(`${label}不能为空`, field);
  }
  return normalized;
}

function normalizeNullableInteger(
  value: unknown,
  field: CustomerProductField,
  label: string,
  positive: boolean,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const valid = typeof value === 'number'
    && Number.isSafeInteger(value)
    && (positive ? value > 0 : value >= 0);
  if (!valid) {
    throw new CustomerProductValidationError(
      `${label}必须是${positive ? '正' : '非负'}整数`,
      field,
    );
  }
  return value;
}

function normalizePositiveId(value: unknown, field: CustomerProductField): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new CustomerProductValidationError('资源 ID 必须是正整数', field);
  }
  return value;
}
