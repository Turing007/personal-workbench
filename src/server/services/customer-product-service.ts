import type {
  CustomerProduct,
  CustomerProductListFilters,
  CustomerProductSaveInput,
} from '../../shared/customers.js';
import {
  CustomerProductRepository,
  SystemProductNotFoundError,
} from '../db/customer-product-repository.js';
import { CustomerRepository } from '../db/customer-repository.js';

type CustomerProductField = keyof CustomerProductSaveInput | 'ids' | 'status';

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
  constructor() {
    super('该客户已存在相同产品');
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
  ) {}

  list(customerId: number, filters: CustomerProductListFilters = {}): CustomerProduct[] {
    this.assertCustomer(customerId);
    const status = filters.status ?? 'all';
    if (!['all', 'incomplete', 'complete'].includes(status)) {
      throw new CustomerProductValidationError('完善状态无效', 'status');
    }
    return this.repository.list(customerId, {
      search: filters.search?.trim(),
      status,
    });
  }

  get(id: number): CustomerProduct | undefined {
    return this.repository.getById(id);
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
    return this.repository.create(customerId, normalized);
  }

  createFromSystemProduct(customerId: number, systemProductId: unknown): CustomerProduct {
    this.assertActiveCustomer(customerId);
    const normalizedId = normalizePositiveId(systemProductId, 'systemProductId');
    if (this.repository.findBySystemProduct(customerId, normalizedId)) {
      throw new CustomerProductExistsError();
    }
    return this.repository.createFromSystemProduct(customerId, normalizedId);
  }

  createFromSystemProductWithInput(customerId: number, systemProductId: unknown, input: CustomerProductSaveInput): CustomerProduct {
    this.assertActiveCustomer(customerId);
    const normalizedId = normalizePositiveId(systemProductId, 'systemProductId');
    if (this.repository.findBySystemProduct(customerId, normalizedId)) {
      throw new CustomerProductExistsError();
    }
    const normalized = normalizeInput({ ...input, systemProductId: normalizedId });
    return this.repository.createFromSystemProduct(customerId, normalizedId, normalized);
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
    return this.repository.update(id, normalized);
  }

  remove(id: number): boolean {
    return this.repository.delete(id);
  }

  setImagePath(id: number, imageRelativePath: string | null): CustomerProduct | undefined {
    return this.repository.setImagePath(id, imageRelativePath);
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

function normalizeInput(input: CustomerProductSaveInput): CustomerProductSaveInput {
  return {
    systemProductId: input.systemProductId ?? null,
    name: normalizeText(input.name, 'name', '品名', true),
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
      '成本价',
      false,
    ),
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
