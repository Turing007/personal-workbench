/** 备货明细的单条订单构成：哪个订单贡献了多少数量。 */
export interface StockPreparationSource {
  orderId: number;
  orderNo: string;
  customerName: string;
  quantity: number;
  remark: string;
}

/** 按供应商聚合后的备货产品行。 */
export interface StockPreparationItem {
  /** 聚合键：已关联系统产品时为其 id，未关联时为 null（此时按客户产品聚合）。 */
  systemProductId: number | null;
  customerProductId: number | null;
  /** 显示名：供应商产品名称 → 系统产品名 → 订单快照名。 */
  displayName: string;
  /** 同产品多订单合并后的总数量。 */
  quantity: number;
  /** 各订单数量构成，按下单时间排序。 */
  sources: StockPreparationSource[];
  /** 各订单行备注（去重保序），如“装一个外箱”“不要包装”。 */
  remarks: string[];
}

export type StockPreparationGroupKind = 'supplier' | 'missing-supplier' | 'unlinked';

export interface StockPreparationGroup {
  kind: StockPreparationGroupKind;
  /** 分组标题：供应商名，或「未填供应商」「未关联产品」。 */
  title: string;
  items: StockPreparationItem[];
}

export interface StockPreparation {
  /** 'all' 或 YYYY-MM-DD（按订单下单日期过滤）。 */
  scope: string;
  orderCount: number;
  supplierCount: number;
  itemCount: number;
  totalQuantity: number;
  groups: StockPreparationGroup[];
}

/** 备货明细行文本：名称*数量（备注）。 */
export function formatStockItemLine(item: StockPreparationItem): string {
  const remarks = item.remarks.length ? `，${item.remarks.join('；')}` : '';
  return `${item.displayName}*${item.quantity}${remarks}`;
}
