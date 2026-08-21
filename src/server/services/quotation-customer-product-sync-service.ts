import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from '../db/connection.js';
import { CustomerProductRepository } from '../db/customer-product-repository.js';
import { CustomerRepository } from '../db/customer-repository.js';
import { QuotationRepository } from '../db/quotation-repository.js';
import type {
  CustomerProduct,
  QuotationCustomerProductSyncPreview,
  QuotationCustomerProductSyncPreviewItem,
  QuotationCustomerProductSyncResult,
  QuotationCustomerProductSyncResultItem,
} from '../../shared/customers.js';

export class QuotationCustomerProductSyncError extends Error {
  constructor(
    public readonly code:
      | 'QUOTATION_NOT_FOUND'
      | 'QUOTATION_CUSTOMER_REQUIRED'
      | 'CUSTOMER_NOT_FOUND'
      | 'CUSTOMER_INACTIVE'
      | 'QUOTATION_ITEM_NOT_FOUND'
      | 'INVALID_SELECTION',
    message: string,
  ) {
    super(message);
    this.name = 'QuotationCustomerProductSyncError';
  }
}

interface SyncOptions {
  quotationRepository?: QuotationRepository;
  customerRepository?: CustomerRepository;
  customerProductRepository?: CustomerProductRepository;
  now?: () => string;
}

interface SyncItemInput {
  id: number;
  productId: number | null;
  customerProductId: number | null;
  isTemporary: boolean;
  name: string;
  specification: string;
  sku: string;
  packCount: number | null;
  unitPriceCents: number;
  imageRelativePath: string | null;
}

export class QuotationCustomerProductSyncService {
  readonly quotationRepository: QuotationRepository;
  readonly customerRepository: CustomerRepository;
  readonly customerProductRepository: CustomerProductRepository;
  private readonly now: () => string;

  constructor(
    private readonly database: DatabaseSync,
    options: SyncOptions = {},
  ) {
    this.quotationRepository = options.quotationRepository ?? new QuotationRepository(database);
    this.customerRepository = options.customerRepository ?? new CustomerRepository(database);
    this.customerProductRepository = options.customerProductRepository ?? new CustomerProductRepository(database);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  preview(quotationId: number): QuotationCustomerProductSyncPreview {
    const quotation = this.requireQuotation(quotationId);
    const customerId = this.requireCustomerId(quotation.customerId);
    this.requireActiveCustomer(customerId);
    return {
      quotationId,
      customerId,
      items: quotation.items.map((item) => {
        const input = this.toSyncItem(item);
        const existing = this.findExisting(customerId, input);
        return {
          quotationItemId: input.id,
          customerProductId: existing?.id ?? input.customerProductId,
          imageRelativePath: input.imageRelativePath,
          name: input.name,
          specification: input.specification,
          unitPriceCents: input.unitPriceCents,
          action: existing ? this.getAction(existing, input, quotationId) : 'create',
          selected: true,
        } satisfies QuotationCustomerProductSyncPreviewItem;
      }),
    };
  }

  sync(quotationId: number, quotationItemIds?: readonly number[]): QuotationCustomerProductSyncResult {
    const quotation = this.requireQuotation(quotationId);
    const customerId = this.requireCustomerId(quotation.customerId);
    this.requireActiveCustomer(customerId);
    const items = quotation.items.map((item) => this.toSyncItem(item));
    const selectedIds = this.normalizeSelection(items, quotationItemIds);
    const syncedAt = this.now();
    const resultItems: QuotationCustomerProductSyncResultItem[] = [];

    withTransaction(this.database, (database) => {
      for (const item of items.filter((candidate) => selectedIds.has(candidate.id))) {
        const savepoint = `quotation_product_${item.id}`;
        database.exec(`SAVEPOINT ${savepoint}`);
        try {
          const existing = this.findExisting(customerId, item);
          const synced = existing
            ? this.updateExisting(existing, item, quotationId, syncedAt)
            : this.createNew(customerId, item, quotationId, syncedAt);
          const status = existing
            ? this.getAction(existing, item, quotationId) === 'unchanged' ? 'unchanged' : 'updated'
            : 'created';
          resultItems.push({
            quotationItemId: item.id,
            customerProductId: synced.id,
            status,
            error: null,
          });
          database.exec(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (error) {
          database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          database.exec(`RELEASE SAVEPOINT ${savepoint}`);
          resultItems.push({
            quotationItemId: item.id,
            customerProductId: null,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      this.quotationRepository.markCustomerProductsSynced(database, quotationId, syncedAt);
    });

    const summary = { created: 0, updated: 0, unchanged: 0, failed: 0 };
    resultItems.forEach((item) => { summary[item.status] += 1; });
    return { quotationId, customerId, syncedAt, summary, items: resultItems };
  }

  private requireQuotation(id: number) {
    const quotation = this.quotationRepository.get(id);
    if (!quotation) throw new QuotationCustomerProductSyncError('QUOTATION_NOT_FOUND', '报价单不存在');
    return quotation;
  }

  private requireCustomerId(customerId: number | null): number {
    if (customerId == null) {
      throw new QuotationCustomerProductSyncError('QUOTATION_CUSTOMER_REQUIRED', '报价单必须先选择客户');
    }
    if (!this.customerRepository.get(customerId)) {
      throw new QuotationCustomerProductSyncError('CUSTOMER_NOT_FOUND', '客户不存在');
    }
    return customerId;
  }

  private requireActiveCustomer(customerId: number): void {
    const customer = this.customerRepository.get(customerId);
    if (!customer) throw new QuotationCustomerProductSyncError('CUSTOMER_NOT_FOUND', '客户不存在');
    if (!customer.isActive) {
      throw new QuotationCustomerProductSyncError('CUSTOMER_INACTIVE', '客户已停用，不能同步客户产品');
    }
  }

  private normalizeSelection(items: readonly SyncItemInput[], ids?: readonly number[]): Set<number> {
    if (ids === undefined) return new Set(items.map((item) => item.id));
    if (!Array.isArray(ids)) {
      throw new QuotationCustomerProductSyncError('INVALID_SELECTION', '同步产品选择无效');
    }
    const selected = new Set<number>();
    for (const id of ids) {
      if (!Number.isSafeInteger(id) || !items.some((item) => item.id === id)) {
        throw new QuotationCustomerProductSyncError('QUOTATION_ITEM_NOT_FOUND', '同步产品行不存在');
      }
      selected.add(id);
    }
    return selected;
  }

  private toSyncItem(item: {
    id: number;
    productId: number | null;
    customerProductId: number | null;
    isTemporary: boolean;
    name: string;
    specification: string;
    sku: string;
    packCount: number | null;
    unitPriceCents: number;
    imageRelativePath: string | null;
  }): SyncItemInput {
    return {
      id: item.id,
      productId: item.productId,
      customerProductId: item.customerProductId,
      isTemporary: item.isTemporary,
      name: item.name.trim(),
      specification: item.specification.trim(),
      sku: item.sku.trim(),
      packCount: item.packCount,
      unitPriceCents: item.unitPriceCents,
      imageRelativePath: item.imageRelativePath,
    };
  }

  private findExisting(customerId: number, item: SyncItemInput): CustomerProduct | undefined {
    return item.productId != null
      ? this.customerProductRepository.findBySystemProduct(customerId, item.productId)
      : this.customerProductRepository.findTemporary(customerId, item.name, item.specification);
  }

  private getAction(
    existing: CustomerProduct,
    item: SyncItemInput,
    quotationId: number,
  ): 'update' | 'unchanged' {
    return existing.latestQuoteCents === item.unitPriceCents
      && existing.sourceQuotationId === quotationId
      ? 'unchanged'
      : 'update';
  }

  private updateExisting(
    existing: CustomerProduct,
    item: SyncItemInput,
    quotationId: number,
    syncedAt: string,
  ): CustomerProduct {
    const result = this.customerProductRepository.syncLatestQuote(
      existing.id,
      item.unitPriceCents,
      quotationId,
      syncedAt,
    );
    if (!result) throw new Error('客户产品同步失败');
    return result;
  }

  private createNew(
    customerId: number,
    item: SyncItemInput,
    quotationId: number,
    syncedAt: string,
  ): CustomerProduct {
    if (!item.name) throw new Error('报价产品品名不能为空');
    return this.customerProductRepository.createFromQuotation(customerId, {
      systemProductId: item.productId,
      name: item.name,
      specification: item.specification,
      sku: item.sku,
      packCount: item.packCount,
      finalPriceCents: null,
      latestQuoteCents: item.unitPriceCents,
      sourceQuotationId: quotationId,
      imageRelativePath: item.imageRelativePath,
      lastSyncedAt: syncedAt,
    });
  }
}
