import type { ProductRecord } from './components/ProductEditor';

/** 品名相同的兜底：SKU 字典序，再退到自增 id 升序，保证顺序稳定、不会来回跳。 */
function compareStableTail(left: ProductRecord, right: ProductRecord): number {
  const bySku = (left.sku ?? '').localeCompare(right.sku ?? '', 'zh-Hans-CN');
  if (bySku !== 0) return bySku;
  const leftId = Number(left.id);
  const rightId = Number(right.id);
  if (Number.isSafeInteger(leftId) && Number.isSafeInteger(rightId)) return leftId - rightId;
  return String(left.id).localeCompare(String(right.id));
}

/**
 * 产品库列表排序：按品名的拼音序，空名（未命名草稿）统一排最后。
 * 用 `zh-Hans-CN` 而不是默认字典序，中文才会按 玻→充→角→圆 这样的拼音排，
 * 否则退化成 Unicode 码位序，人眼看着是乱的。
 */
export function compareProductByName(left: ProductRecord, right: ProductRecord): number {
  const leftName = (left.name ?? '').trim();
  const rightName = (right.name ?? '').trim();
  if (!leftName || !rightName) {
    if (leftName === rightName) return compareStableTail(left, right);
    return leftName ? -1 : 1;
  }
  const byName = leftName.localeCompare(rightName, 'zh-Hans-CN');
  return byName !== 0 ? byName : compareStableTail(left, right);
}
