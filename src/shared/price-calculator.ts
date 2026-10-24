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

/**
 * 复制售价时附带的计价口径：这笔价格里到底含不含运费、含不含税。
 * 按实际计入金额判断（自动运费算出来是 0 也算不含运），避免只填了 0 或空值被误标。
 */
export function priceInclusionLabel(shipping: number, taxPercent: number): '不含税运' | '含运不含税' | '含税不含运' | '含税运' {
  const hasShipping = Number.isFinite(shipping) && shipping > 0;
  const hasTax = Number.isFinite(taxPercent) && taxPercent > 0;
  if (hasShipping && hasTax) return '含税运';
  if (hasShipping) return '含运不含税';
  if (hasTax) return '含税不含运';
  return '不含税运';
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

/** 售价计算器的参数快照：方案保存与载入回显用（旧方案没有新增字段）。 */
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
  /** 运费模式：auto = 按计费重量 × 单价自动预估；manual = 手填固定值。旧方案缺省按 manual 原样回显。 */
  shippingMode: PriceShippingMode;
  /** 自动预估的运费单价（元/kg）。 */
  shippingUnitPrice: number;
  /** 体积重参数（cm³/kg），默认 8000；旧方案缺省按默认值。 */
  volumeDivisor?: number;
  /**
   * 本次计入的配件名称快照。用名称而不是 id：类目默认配件的 id 可能随维护变化，
   * 名称更稳定。空数组 = 明确一个都没选；缺省 = 旧方案，载入时按「全部计入」回显。
   */
  accessoryNames?: string[];
}

/** 方案里的配件名称：去空白、截断超长名、去重、去掉空项；非数组视为「没存过」。 */
function normalizePlanAccessoryNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (names.length >= 80) break;
    if (typeof entry !== 'string') continue;
    const name = entry.trim().slice(0, 60);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** 清洗参数快照：全部按金额口径处理（≥0、两位小数），缺省为 0 与空名。 */
export function normalizePricePlanParams(value: unknown): PricePlanParams {
  const record = (value ?? {}) as Record<string, unknown>;
  const accessoryNames = normalizePlanAccessoryNames(record.accessoryNames);
  return {
    baseCost: pricePlanAmount(record.baseCost),
    packaging: pricePlanAmount(record.packaging),
    shipping: pricePlanAmount(record.shipping),
    taxPercent: pricePlanAmount(record.taxPercent),
    chargerName: typeof record.chargerName === 'string' ? record.chargerName.trim().slice(0, 60) : '',
    chargerPrice: pricePlanAmount(record.chargerPrice),
    // 旧方案没存过这两个字段：按 manual 回显既有运费值，单价补默认值，行为与改版前一致。
    shippingMode: record.shippingMode === 'auto' ? 'auto' : 'manual',
    shippingUnitPrice: record.shippingUnitPrice == null ? DEFAULT_SHIPPING_UNIT_PRICE : pricePlanAmount(record.shippingUnitPrice),
    volumeDivisor: normalizeVolumeDivisor(record.volumeDivisor),
    // 旧方案没有这个字段：不写出，载入时按「全部配件」处理。
    ...(accessoryNames === undefined ? {} : { accessoryNames }),
  };
}

/* ===== 运费预估：按计费重量 × 单价 ===== */

/**
 * 电池包单重（kg）。5 节 0.3 / 10 节 0.5 / 15 节 0.7 / 20 节 0.9 ——
 * 用查表而不是公式，某一档要单独调整时不会牵动其他档位。
 */
const BATTERY_PACK_WEIGHT_KG: Record<number, number> = { 5: 0.3, 10: 0.5, 15: 0.7, 20: 0.9 };

/** 充电器按 0.05kg 计。 */
export const CHARGER_WEIGHT_KG = 0.05;

/** 运费预估单价默认值（元/kg），低于线下常用值，用户自行调整。 */
export const DEFAULT_SHIPPING_UNIT_PRICE = 1.5;

export type PriceShippingMode = 'auto' | 'manual';

/** 体积重参数默认值（cm³/kg）：国际快递常用 5000，国内陆运/快递常用 8000。 */
export const DEFAULT_VOLUME_DIVISOR = 8000;

/** 体积重参数合法范围：太小会把运费算飞，太大等于不按体积计费。 */
export const VOLUME_DIVISOR_MIN = 1000;
export const VOLUME_DIVISOR_MAX = 20000;

/** 清洗体积重参数：非数字/越界时回落到默认 8000。 */
export function normalizeVolumeDivisor(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_VOLUME_DIVISOR;
  return Math.min(Math.max(Math.round(parsed), VOLUME_DIVISOR_MIN), VOLUME_DIVISOR_MAX);
}

/** 解析包装尺寸文本：支持「40×30×25」「40x30x25 cm」「40*30*25」，返回 cm 数值；解析不出返回 null。 */
export function parsePackagingVolumeCm3(value: string | null | undefined): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const matched = text.match(/^\s*([\d.]+)\s*[×x*]\s*([\d.]+)\s*[×x*]\s*([\d.]+)\s*(?:cm|厘米)?\s*$/i);
  if (!matched) return null;
  const [length, width, height] = matched.slice(1, 4).map((part) => Number(part));
  if (![length, width, height].every((part) => Number.isFinite(part) && part > 0)) return null;
  return round2(length * width * height);
}

/**
 * 单台体积重（kg）= 单台体积（cm³）÷ 体积参数。
 * 单台体积 = 外箱体积 ÷ 装箱数；包装里没有装箱数时按 1 台算。
 * 没有体积数据时返回 0，计费重量就仍按实重，老产品结果不变。
 */
export function volumetricWeightKg(parcelVolumeCm3: number | null | undefined, divisor: unknown, unitsPerCarton = 1): number {
  const volume = Number(parcelVolumeCm3);
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  const units = Number.isFinite(unitsPerCarton) && unitsPerCarton > 0 ? Math.trunc(unitsPerCarton) : 1;
  return round2(volume / units / normalizeVolumeDivisor(divisor));
}

/** 计费重量：实重与体积重取较大者（物流通用口径）。 */
export function chargeableWeightKg(actualWeightKg: number, volumeWeightKgValue: number): number {
  return round2(Math.max(0, actualWeightKg, volumeWeightKgValue));
}

/**
 * 单个电池包的重量（kg）：已知档位查表；表里没有的节数按同一斜率线性外推
 * （5 节 0.3kg 起、每 5 节 +0.2kg），保证设置里出现新档位时仍算得出重量而不是卡住。
 */
export function batteryPackWeightKg(packCount: number): number {
  const count = Math.trunc(packCount);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return BATTERY_PACK_WEIGHT_KG[count] ?? round2(0.1 + 0.04 * count);
}

/**
 * 一格组合的实重（kg）= 产品重量（包装首行内盒重量）+ 配件重量 + 电池包重量 × 电数 + 充电器重量。
 * 裸机就是电池与充电器都为 0 的同一口径；配件是每台都带，所有组合都计入。
 */
export function comboShippingWeightKg(input: {
  productWeightKg: number;
  accessoryWeightKg?: number;
  batteryPackCount?: number;
  batteryCount?: number;
  hasCharger?: boolean;
}): number {
  const accessory = Math.max(0, input.accessoryWeightKg ?? 0);
  const battery = input.batteryCount ? batteryPackWeightKg(input.batteryPackCount ?? 0) * input.batteryCount : 0;
  const charger = input.hasCharger ? CHARGER_WEIGHT_KG : 0;
  return round2(Math.max(0, input.productWeightKg) + accessory + battery + charger);
}

/** 按重量预估运费：重量 × 单价，两位小数 —— 界面显示与实际入账用同一个值。 */
export function autoShippingCost(weightKg: number, unitPrice: number): number {
  return round2(Math.max(0, weightKg) * Math.max(0, unitPrice));
}

/**
 * 一格组合的总成本 = (采购价 + 包材 + 配件 + 运费 + 电池单价×电数 + 充电器单价) × (1 + 税%/100)。
 * 裸机就是电池与充电器都为 0 的同一口径，整张表因此只有一个公式。
 */
export function comboTotalCost(input: {
  baseCost: number;
  packaging: number;
  shipping: number;
  taxPercent: number;
  accessoryPrice?: number;
  batteryUnitPrice?: number;
  batteryCount?: number;
  chargerPrice?: number;
}): number {
  const batteryCost = (input.batteryUnitPrice ?? 0) * (input.batteryCount ?? 0);
  const direct = input.baseCost + input.packaging + (input.accessoryPrice ?? 0) + input.shipping + batteryCost + (input.chargerPrice ?? 0);
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
