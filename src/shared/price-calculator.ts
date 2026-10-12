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

/**
 * 两位小数。加 1e-6 分（=1e-8 元）容差再四舍五入：
 * 120.1×1.15 这类乘法在浮点里是 138.114999…，真值恰为 138.115（半分），
 * 不补容差会少一分钱；容差远小于半分，真实低于半分的值不会被抬上去。
 */
export function round2(value: number): number {
  return Math.round(value * 100 + 1e-6) / 100;
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

/** 售价计算器的参数快照：方案保存与载入回显用（旧方案没有该字段）。 */
export interface PricePlanParams {
  /** 采购价（裸机）。 */
  baseCost: number;
  /** 包材配件。 */
  packaging: number;
  /** 运费。 */
  shipping: number;
  /** 税（%）。 */
  taxPercent: number;
  /** 充电器名称快照：载入方案时按名称找回下拉项。 */
  chargerName: string;
  chargerPrice: number;
}

/** 清洗参数快照：全部按金额口径处理（≥0、两位小数），缺省为 0 与空名。 */
export function normalizePricePlanParams(value: unknown): PricePlanParams {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    baseCost: pricePlanAmount(record.baseCost),
    packaging: pricePlanAmount(record.packaging),
    shipping: pricePlanAmount(record.shipping),
    taxPercent: pricePlanAmount(record.taxPercent),
    chargerName: typeof record.chargerName === 'string' ? record.chargerName.trim().slice(0, 60) : '',
    chargerPrice: pricePlanAmount(record.chargerPrice),
  };
}

/**
 * 一格组合的总成本 = (采购价 + 包材配件 + 运费 + 电池单价×电数 + 充电器单价) × (1 + 税%/100)。
 * 裸机就是电池与充电器都为 0 的同一口径，整张表因此只有一个公式。
 */
export function comboTotalCost(input: {
  baseCost: number;
  packaging: number;
  shipping: number;
  taxPercent: number;
  batteryUnitPrice?: number;
  batteryCount?: number;
  chargerPrice?: number;
}): number {
  const batteryCost = (input.batteryUnitPrice ?? 0) * (input.batteryCount ?? 0);
  const direct = input.baseCost + input.packaging + input.shipping + batteryCost + (input.chargerPrice ?? 0);
  return round2(direct * (1 + input.taxPercent / 100));
}

/** 复制售价时带的配置名：如「5节1300mah 一电一充」，价格与「元」由调用方拼接。 */
export function batteryComboName(packCount: number, capacity: number, variantLabel: string): string {
  return `${packCount}节${capacity}mah ${variantLabel}`;
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
