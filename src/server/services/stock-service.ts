import type {
  StockPreparation,
  StockPreparationGroup,
  StockPreparationGroupKind,
  StockPreparationItem,
} from '../../shared/stock.js';
import { StockRepository, type StockPreparationRow } from '../db/stock-repository.js';

export const UNLINKED_GROUP_TITLE = '未关联产品';
export const MISSING_SUPPLIER_GROUP_TITLE = '未填供应商';

export class StockPreparationService {
  constructor(private readonly repository: StockRepository) {}

  /** 生成备货表：date 为 null 时汇总全部待备货订单。 */
  getPreparation(date: string | null): StockPreparation {
    return buildPreparation(this.repository.listPendingStockItems(date ?? undefined), date);
  }
}

/** 把待备货明细行聚合为按供应商分组的备货表：同供应商同产品合并数量，未关联/未填供应商各自成警示组。 */
export function buildPreparation(rows: StockPreparationRow[], date: string | null): StockPreparation {
  const groupsByKey = new Map<string, StockPreparationGroup>();
  const itemsByKey = new Map<string, StockPreparationItem>();
  const orderIds = new Set<number>();

  for (const row of rows) {
    orderIds.add(Number(row.order_id));
    const linked = row.customer_product_id != null && row.product_id != null;
    const supplier = linked ? String(row.product_supplier ?? '').trim() : '';
    const kind: StockPreparationGroupKind = !linked ? 'unlinked' : supplier ? 'supplier' : 'missing-supplier';
    const title = kind === 'unlinked' ? UNLINKED_GROUP_TITLE : kind === 'missing-supplier' ? MISSING_SUPPLIER_GROUP_TITLE : supplier;
    const groupKey = `${kind}\u0000${title}`;
    let group = groupsByKey.get(groupKey);
    if (!group) {
      group = { kind, title, items: [] };
      groupsByKey.set(groupKey, group);
    }

    // 已关联按系统产品合并；临时客户产品按客户产品合并；完全未挂客户产品的明细（手填行）各占一行，避免把不相关的手填明细并到一起
    const itemKey = `${groupKey}\u0000${linked
      ? `p${row.product_id}`
      : row.customer_product_id != null ? `cp${row.customer_product_id}` : `oi${row.order_item_id}`}`;
    let item = itemsByKey.get(itemKey);
    if (!item) {
      item = {
        systemProductId: linked ? Number(row.product_id) : null,
        customerProductId: row.customer_product_id == null ? null : Number(row.customer_product_id),
        displayName: pickDisplayName(row),
        quantity: 0,
        sources: [],
        remarks: [],
      };
      itemsByKey.set(itemKey, item);
      group.items.push(item);
    }

    const quantity = Math.max(0, Math.trunc(Number(row.quantity) || 0));
    item.quantity += quantity;
    item.sources.push({
      orderId: Number(row.order_id),
      orderNo: String(row.order_no ?? ''),
      customerName: String(row.customer_name ?? ''),
      quantity,
      remark: String(row.item_remark ?? '').trim(),
    });
    const remark = String(row.item_remark ?? '').trim();
    if (remark && !item.remarks.includes(remark)) item.remarks.push(remark);
  }

  const groups = [...groupsByKey.values()];
  const supplierGroups = groups
    .filter((group) => group.kind === 'supplier')
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  const missingSupplierGroups = groups.filter((group) => group.kind === 'missing-supplier');
  const unlinkedGroups = groups.filter((group) => group.kind === 'unlinked');
  const orderedGroups = [...supplierGroups, ...missingSupplierGroups, ...unlinkedGroups];

  return {
    scope: date ?? 'all',
    orderCount: orderIds.size,
    supplierCount: supplierGroups.length,
    itemCount: orderedGroups.reduce((sum, group) => sum + group.items.length, 0),
    totalQuantity: orderedGroups.reduce(
      (sum, group) => sum + group.items.reduce((subtotal, item) => subtotal + item.quantity, 0),
      0,
    ),
    groups: orderedGroups,
  };
}

/** 显示名回退链：客户产品报供名称 → 系统产品名 → 订单快照名（未关联时兜底）。 */
function pickDisplayName(row: StockPreparationRow): string {
  const supplierName = String(row.supplier_product_name ?? '').trim();
  if (supplierName) return supplierName;
  const productName = String(row.product_name ?? '').trim();
  if (productName) return productName;
  const snapshot = [String(row.item_name ?? '').trim(), String(row.item_specification ?? '').trim()]
    .filter(Boolean)
    .join(' ');
  return snapshot || '未命名产品';
}
