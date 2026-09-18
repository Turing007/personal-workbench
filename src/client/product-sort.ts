import type { ProductRecord } from './components/ProductEditor';

/** 时间倒序：越新越靠前；时间缺失或不合法时视为最旧。 */
function compareTimeDesc(left?: string, right?: string): number {
  const leftTime = Date.parse(left ?? '');
  const rightTime = Date.parse(right ?? '');
  const leftValid = !Number.isNaN(leftTime);
  const rightValid = !Number.isNaN(rightTime);
  if (leftValid && rightValid) return rightTime - leftTime;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
}

/** 时间相同时用自增 id 兜底（批量导入常落在同一秒），仍然是新的在前。 */
function compareIdDesc(left: ProductRecord, right: ProductRecord): number {
  const leftId = Number(left.id);
  const rightId = Number(right.id);
  if (Number.isSafeInteger(leftId) && Number.isSafeInteger(rightId)) return rightId - leftId;
  return String(right.id).localeCompare(String(left.id));
}

/**
 * 产品库列表排序：最新的排最上面。
 * - 以「最近更新时间」为准，与客户产品库以及服务端 `ORDER BY updated_at DESC, id DESC` 保持一致；
 * - 时间相同（批量导入、批量新建常见）时按自增 id 倒序，保证顺序稳定、不会来回跳动；
 * - 本地新建但还没落库的记录没有时间，统一排在已有数据之后。
 */
export function compareProductByNewest(left: ProductRecord, right: ProductRecord): number {
  const byTime = compareTimeDesc(left.updatedAt, right.updatedAt);
  return byTime !== 0 ? byTime : compareIdDesc(left, right);
}
