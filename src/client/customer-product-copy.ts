import type { CustomerProduct } from '../shared/customers';
import { getCustomerProductCompletionStatus } from '../shared/customers';

function temporaryId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 由既有客户产品派生可编辑的新建草稿：不沿用持久化 ID、系统产品关联、图片路径和附件，
 * 避免两个产品共享同一文件（删除或替换任一方的图片会波及另一方）。品名保持原样。
 */
export function cloneCustomerProductForNew(product: CustomerProduct): CustomerProduct {
  const draft = {
    ...product,
    id: 0,
    systemProductId: null,
    imageRelativePath: null,
    imageOwned: false,
    latestQuoteCents: null,
    sourceQuotationId: null,
    lastSyncedAt: null,
    attachments: [],
    packaging: product.packaging.map((item) => ({ ...item, id: temporaryId('customer-pack-copy') })),
  };
  return {
    ...draft,
    completionStatus: getCustomerProductCompletionStatus(draft),
  };
}
