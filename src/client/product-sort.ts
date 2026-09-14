import type { ProductRecord } from './components/ProductEditor';

function compareName(left: ProductRecord, right: ProductRecord): number {
  return left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true });
}

/**
 * 产品库列表排序：按 SKU 升序。
 * - 采用自然序，`SKU-2` 排在 `SKU-10` 之前；
 * - 未填 SKU 的（草稿、待完善）统一排在末尾，内部按品名排序；
 * - SKU 相同的按品名兜底，保证顺序稳定。
 */
export function compareProductBySku(left: ProductRecord, right: ProductRecord): number {
  const leftSku = left.sku.trim();
  const rightSku = right.sku.trim();
  if (!leftSku && !rightSku) return compareName(left, right);
  if (!leftSku) return 1;
  if (!rightSku) return -1;
  const bySku = leftSku.localeCompare(rightSku, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  return bySku !== 0 ? bySku : compareName(left, right);
}
