/**
 * 产品状态：draft 草稿（信息不全，可继续编辑）、active 在售（原「正式产品」）、
 * discontinued 停售（下架但保留资料与图片）。
 * 未知值一律按在售兜底，避免老数据或被改坏的值让产品从所有筛选里消失。
 */
export type ProductStatus = 'draft' | 'active' | 'discontinued';

export function normalizeProductStatus(value: unknown): ProductStatus {
  if (value === 'draft' || value === 'discontinued' || value === 'active') return value;
  return 'active';
}
