/**
 * 售价计算：成本明细行（名称 + 数量 + 单价）+ 加价率 → 合计与建议售价。
 * 纯函数，客户端实时试算与服务端保存时重算共用同一套口径（服务端不信任客户端提交的合计值）。
 */

export interface PricePlanItemInput {
  name: string;
  qty: number;
  unitPrice: number;
}

export interface PricePlanItem extends PricePlanItemInput {
  amount: number;
}

export const PRICE_PLAN_MARKUP_LIMIT = 1000;
export const PRICE_PLAN_ITEM_LIMIT = 40;

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function planItemAmount(qty: number, unitPrice: number): number {
  return round2(qty * unitPrice);
}

export function planItemsWithAmounts(items: PricePlanItemInput[]): PricePlanItem[] {
  return items.map((item) => ({ ...item, amount: planItemAmount(item.qty, item.unitPrice) }));
}

export function planTotalCost(items: PricePlanItem[]): number {
  return round2(items.reduce((sum, item) => sum + item.amount, 0));
}

export function planSalePrice(totalCost: number, markupPercent: number): number {
  return round2(totalCost * (1 + markupPercent / 100));
}

/** 实得毛利率（%）：售价填了才算；售价为 0 时无意义，返回 null。 */
export function planMargin(salePrice: number, totalCost: number): number | null {
  if (!Number.isFinite(salePrice) || salePrice <= 0) return null;
  return Math.round(((salePrice - totalCost) / salePrice) * 1000) / 10;
}

export function pricePlanQty(value: unknown): number {
  if (value == null || value === '') return 1;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 0), 99999);
}

export function pricePlanAmount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return round2(parsed);
}

export function pricePlanMarkup(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(round2(parsed), PRICE_PLAN_MARKUP_LIMIT);
}

/** 清洗一行明细：名称为空视为无效（返回 null，由调用方丢弃）。 */
export function normalizePricePlanItem(value: unknown): PricePlanItemInput | null {
  const record = (value ?? {}) as Partial<PricePlanItemInput>;
  const name = typeof record.name === 'string' ? record.name.trim().slice(0, 40) : '';
  if (!name) return null;
  return { name, qty: pricePlanQty(record.qty), unitPrice: pricePlanAmount(record.unitPrice) };
}

export function normalizePricePlanItems(value: unknown): PricePlanItem[] {
  const list = Array.isArray(value) ? value : [];
  const result: PricePlanItem[] = [];
  list.forEach((entry) => {
    if (result.length >= PRICE_PLAN_ITEM_LIMIT) return;
    const item = normalizePricePlanItem(entry);
    if (item) result.push({ ...item, amount: planItemAmount(item.qty, item.unitPrice) });
  });
  return result;
}
