export type CustomerProductCompletionStatus = 'incomplete' | 'complete';
export type CustomerProductAttachmentCategory = 'label' | 'instruction' | 'packaging' | 'other';

export interface Customer {
  id: number;
  name: string;
  contactName: string;
  contactPhone: string;
  shippingInfo: string;
  isActive: boolean;
  productCount: number;
  incompleteProductCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSaveInput {
  name: string;
  contactName: string;
  contactPhone: string;
  shippingInfo: string;
  confirmDuplicateName?: boolean;
}

export interface CustomerProduct {
  id: number;
  customerId: number;
  systemProductId: number | null;
  name: string;
  specification: string;
  sku: string;
  packCount: number | null;
  latestQuoteCents: number | null;
  finalPriceCents: number | null;
  costPriceCents: number | null;
  freightPerBoxCents: number | null;
  remark: string;
  packaging: CustomerProductPackaging[];
  attachments: CustomerProductAttachment[];
  completionStatus: CustomerProductCompletionStatus;
  sourceQuotationId: number | null;
  imageRelativePath: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProductSaveInput {
  systemProductId?: number | null;
  name: string;
  specification: string;
  sku: string;
  packCount: number | null;
  finalPriceCents: number | null;
  costPriceCents?: number | null;
  freightPerBoxCents?: number | null;
  remark?: string;
  packaging?: CustomerProductPackaging[];
  imageRelativePath?: string | null;
}

export interface CustomerProductAttachment {
  id: number;
  customerProductId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
  category: CustomerProductAttachmentCategory;
}

export interface CustomerProductPackaging {
  id?: string | number;
  name: string;
  innerSize: string;
  innerWeight: number;
  outerSize: string;
  outerWeight: number;
  packCount: number;
}

export interface CustomerProductCompletenessInput {
  sku: string;
  packCount: number | null;
  finalPriceCents: number | null;
}

export interface CustomerProductListFilters {
  search?: string;
  status?: CustomerProductCompletionStatus | 'all';
}

export type QuotationCustomerProductSyncAction = 'create' | 'update' | 'unchanged';

export interface QuotationCustomerProductSyncPreviewItem {
  quotationItemId: number;
  customerProductId: number | null;
  imageRelativePath: string | null;
  name: string;
  specification: string;
  unitPriceCents: number;
  action: QuotationCustomerProductSyncAction;
  selected: boolean;
}

export interface QuotationCustomerProductSyncPreview {
  quotationId: number;
  customerId: number;
  items: QuotationCustomerProductSyncPreviewItem[];
}

export type QuotationCustomerProductSyncItemStatus =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'failed';

export interface QuotationCustomerProductSyncResultItem {
  quotationItemId: number;
  customerProductId: number | null;
  status: QuotationCustomerProductSyncItemStatus;
  error: string | null;
}

export interface QuotationCustomerProductSyncResult {
  quotationId: number;
  customerId: number;
  syncedAt: string;
  summary: {
    created: number;
    updated: number;
    unchanged: number;
    failed: number;
  };
  items: QuotationCustomerProductSyncResultItem[];
}

export function getCustomerProductCompletionStatus(
  input: CustomerProductCompletenessInput,
): CustomerProductCompletionStatus {
  return input.sku.trim()
    && Number.isSafeInteger(input.packCount)
    && Number(input.packCount) > 0
    && Number.isSafeInteger(input.finalPriceCents)
    && Number(input.finalPriceCents) >= 0
    ? 'complete'
    : 'incomplete';
}
