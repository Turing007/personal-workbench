import type { Customer, CustomerSaveInput } from '../../shared/customers.js';
import {
  CustomerRepository,
  type CustomerDeleteResult,
  type CustomerListOptions,
} from '../db/customer-repository.js';

export class CustomerValidationError extends Error {
  constructor(
    message: string,
    public readonly field: keyof CustomerSaveInput,
  ) {
    super(message);
    this.name = 'CustomerValidationError';
  }
}

export class CustomerNameExistsError extends Error {
  readonly field = 'name';

  constructor() {
    super('客户名称已存在，请确认后再创建');
    this.name = 'CustomerNameExistsError';
  }
}

export class CustomerService {
  constructor(private readonly repository: CustomerRepository) {}

  list(options: CustomerListOptions = {}): Customer[] {
    return this.repository.list({
      search: options.search?.trim(),
      includeInactive: options.includeInactive,
    });
  }

  get(id: number): Customer | undefined {
    return this.repository.get(id);
  }

  create(input: CustomerSaveInput): Customer {
    const normalized = normalizeCustomerInput(input);
    if (!normalized.confirmDuplicateName && this.repository.hasName(normalized.name)) {
      throw new CustomerNameExistsError();
    }
    return this.repository.create(normalized);
  }

  update(id: number, input: CustomerSaveInput): Customer | undefined {
    if (!this.repository.get(id)) return undefined;
    const normalized = normalizeCustomerInput(input);
    if (!normalized.confirmDuplicateName && this.repository.hasName(normalized.name, id)) {
      throw new CustomerNameExistsError();
    }
    return this.repository.update(id, normalized);
  }

  setActive(id: number, isActive: boolean): Customer | undefined {
    return this.repository.setActive(id, isActive);
  }

  remove(id: number): CustomerDeleteResult | undefined {
    return this.repository.remove(id);
  }
}

function normalizeCustomerInput(input: CustomerSaveInput): CustomerSaveInput {
  return {
    name: normalizeText(input.name, 'name', '客户名称', true),
    contactName: normalizeText(input.contactName, 'contactName', '联系人'),
    contactPhone: normalizeText(input.contactPhone, 'contactPhone', '联系电话'),
    shippingInfo: normalizeText(input.shippingInfo, 'shippingInfo', '常用收件信息'),
    confirmDuplicateName: input.confirmDuplicateName === true,
  };
}

function normalizeText(
  value: unknown,
  field: keyof CustomerSaveInput,
  label: string,
  required = false,
): string {
  if (value === undefined || value === null) {
    if (required) throw new CustomerValidationError(`${label}不能为空`, field);
    return '';
  }
  if (typeof value !== 'string') throw new CustomerValidationError(`${label}必须是文本`, field);
  const normalized = value.trim();
  if (required && !normalized) throw new CustomerValidationError(`${label}不能为空`, field);
  return normalized;
}
