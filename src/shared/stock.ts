/** 同一品名下按规格汇总的数量。 */
export interface StockPreparationSpec {
  specification: string;
  quantity: number;
}

/** 按供应商聚合后的备货产品行。 */
export interface StockPreparationItem {
  /** 聚合键：已关联系统产品时为其 id，未关联时为 null（此时按客户产品聚合）。 */
  systemProductId: number | null;
  customerProductId: number | null;
  /** 显示名：供应商产品名称 → 系统产品名 → 订单快照名。 */
  displayName: string;
  /** 同品名多订单合并后的总数量。 */
  quantity: number;
  /** 同品名下按规格汇总的数量（同规格累加，不同规格并列）。 */
  specs: StockPreparationSpec[];
  /** 贡献该产品的待备货订单 id（去重），用于分供应商/整页确认备货。 */
  orderIds: number[];
}

export type StockPreparationGroupKind = 'supplier' | 'missing-supplier' | 'unlinked';

export interface StockPreparationGroup {
  kind: StockPreparationGroupKind;
  /** 分组标题：供应商名，或「未填供应商」「未关联产品」。 */
  title: string;
  items: StockPreparationItem[];
  /** 当前筛选范围内该供应商最近一次确认备货的时间与操作人。 */
  lastConfirmedAt?: string;
  lastConfirmedBy?: string;
  lastConfirmedOrderCount?: number;
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

/** 备货明细行文本：名称（规格 × 数量，规格 × 数量）。 */
export function formatStockItemLine(item: StockPreparationItem): string {
  const specs = item.specs.length
    ? item.specs.map((spec) => `${spec.specification ? `${spec.specification} × ` : '× '}${spec.quantity}`).join('，')
    : `× ${item.quantity}`;
  return `${item.displayName}（${specs}）`;
}

/** 供应商备货确认记录里的一笔订单。 */
export interface StockConfirmationOrder {
  orderId: number;
  orderNo: string;
  /** 本次确认是否已把该订单推进到「已备货」。 */
  advanced: boolean;
}

/** 供应商备货确认记录里的产品快照。 */
export interface StockConfirmationItem {
  displayName: string;
  quantity: number;
  specs: StockPreparationSpec[];
}

export interface StockConfirmation {
  id: number;
  supplier: string;
  /** 'all' 或 YYYY-MM-DD，与备货表筛选范围一致。 */
  scope: string;
  /** '' 表示全部渠道，否则 online/offline。 */
  channel: string;
  confirmedAt: string;
  confirmedBy: string;
  note: string;
  itemCount: number;
  totalQuantity: number;
  orders: StockConfirmationOrder[];
  items: StockConfirmationItem[];
}

export interface StockConfirmationInput {
  date?: string;
  channel?: 'online' | 'offline';
  supplier: string;
  note?: string;
}

export interface StockConfirmationResult {
  confirmation: StockConfirmation;
  advancedOrderIds: number[];
  pendingOrderIds: number[];
  failedOrderIds: number[];
}

export interface SupplierStockConfirmPlan {
  /** 全部待备货明细都在该供应商组内：可以一起推进。 */
  advanceOrderIds: number[];
  /** 还涉及其他供应商/待补全分组：留到整页「标记已备货」处理。 */
  pendingOrderIds: number[];
}

/** 单个供应商确认备货时，只推进「只涉及该供应商」的订单，避免跨供应商的货没齐就进下一步。 */
export function planSupplierStockConfirm(groups: StockPreparationGroup[], target: StockPreparationGroup): SupplierStockConfirmPlan {
  const groupCountByOrder = new Map<number, number>();
  for (const group of groups) {
    const orderIds = new Set<number>();
    for (const item of group.items) for (const orderId of item.orderIds) orderIds.add(orderId);
    for (const orderId of orderIds) groupCountByOrder.set(orderId, (groupCountByOrder.get(orderId) ?? 0) + 1);
  }
  const targetOrderIds = new Set<number>();
  for (const item of target.items) for (const orderId of item.orderIds) targetOrderIds.add(orderId);
  const advanceOrderIds: number[] = [];
  const pendingOrderIds: number[] = [];
  for (const orderId of targetOrderIds) {
    if ((groupCountByOrder.get(orderId) ?? 0) <= 1) advanceOrderIds.push(orderId);
    else pendingOrderIds.push(orderId);
  }
  return { advanceOrderIds, pendingOrderIds };
}
