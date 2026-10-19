export type CustomerProductCompletionStatus = 'incomplete' | 'complete';
export type CustomerProductAttachmentCategory = 'label' | 'instruction' | 'packaging' | 'other';

export interface Customer {
  id: number;
  name: string;
  contactName: string;
  contactPhone: string;
  shippingInfo: string;
  invoiceTitle: string;
  taxNo: string;
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
  invoiceTitle: string;
  taxNo: string;
  confirmDuplicateName?: boolean;
}

export interface CustomerProduct {
  id: number;
  customerId: number;
  systemProductId: number | null;
  name: string;
  supplierProductName: string;
  specification: string;
  sku: string;
  packCount: number | null;
  latestQuoteCents: number | null;
  finalPriceCents: number | null;
  costPriceCents: number | null;
  freightPerBoxCents: number | null;
  /** 备注：只给自己看的内部信息（含税运、单价话术等），永远不会印到箱唛上。 */
  remark: string;
  /** 箱唛要求：要印在箱面上的作业指令（贴条码箱唛、机器套气泡袋等），开单时带到订单行并出现在箱唛上。 */
  labelRequirement: string;
  packaging: CustomerProductPackaging[];
  attachments: CustomerProductAttachment[];
  completionStatus: CustomerProductCompletionStatus;
  sourceQuotationId: number | null;
  imageRelativePath: string | null;
  /** 图片是否为本产品自有：false 表示当前显示的是系统产品首图（只借用、删除不影响系统图）。 */
  imageOwned: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProductSaveInput {
  systemProductId?: number | null;
  name: string;
  /** 报给供应商的产品名称；留空时备货表回退使用系统产品名。 */
  supplierProductName?: string;
  specification: string;
  sku: string;
  packCount: number | null;
  finalPriceCents: number | null;
  costPriceCents?: number | null;
  freightPerBoxCents?: number | null;
  remark?: string;
  labelRequirement?: string;
  packaging?: CustomerProductPackaging[];
  imageRelativePath?: string | null;
}

/** 批量新建客户产品：清单中每行是一个独立产品（品名必填，规格、SKU 可逐行填写），其余资料与包装为共享信息。 */
export interface CustomerProductBatchItemInput {
  name: string;
  specification?: string;
  sku?: string;
}

export interface CustomerProductBatchSaveInput {
  items: CustomerProductBatchItemInput[];
  packCount: number | null;
  finalPriceCents: number | null;
  costPriceCents?: number | null;
  freightPerBoxCents?: number | null;
  remark?: string;
  labelRequirement?: string;
  packaging?: CustomerProductPackaging[];
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

/**
 * 箱唛上要印的文字：只取「箱唛要求」。
 * 历史数据把要求写在备注里，所以要求为空时回退备注，避免老订单的箱唛突然少一行；
 * 一旦数据分拣完成（要求填好、内部信息留在备注），回退分支自然不再命中。
 */
export function cartonLabelRequirement(value: { labelRequirement?: string | null; remark?: string | null }): string {
  return value.labelRequirement?.trim() || value.remark?.trim() || '';
}
