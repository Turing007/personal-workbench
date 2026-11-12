import { round2 } from './price-calculator.js';
import { calculateDocumentTotals } from './money.js';

/** 整份报价单的价格口径。 */
export type QuotationPricingBasis = 'shipping_ex_tax' | 'shipping_inc_tax' | 'no_shipping_ex_tax';

export const QUOTATION_PRICING_BASIS_LABELS: Record<QuotationPricingBasis, string> = {
  shipping_ex_tax: '含运不含税',
  shipping_inc_tax: '含运含税',
  no_shipping_ex_tax: '不含运不含税',
};

export function isQuotationPricingBasis(value: unknown): value is QuotationPricingBasis {
  return value === 'shipping_ex_tax' || value === 'shipping_inc_tax' || value === 'no_shipping_ex_tax';
}

export function pricingBasisIncludesTax(basis: QuotationPricingBasis): boolean {
  return basis === 'shipping_inc_tax';
}

export function pricingBasisIncludesShipping(basis: QuotationPricingBasis): boolean {
  return basis !== 'no_shipping_ex_tax';
}

export interface QuotationItemConfiguration {
  version: 1;
  mode: 'bare' | 'battery';
  battery?: {
    packCount: number;
    capacity: number;
    batteryCount: 1 | 2;
    batteryUnitPriceCents: number;
    chargerName: string;
    chargerPriceCents: number;
  };
  packaging?: {
    id: string;
    name: string;
    costCents: number;
  };
  accessoryNames: string[];
  accessoryPriceCents: number;
  accessoryWeightKg: number;
  baseCostCents: number;
  otherCostCents: number;
  markupPercent: number;
  shippingUnitPrice: number;
  volumeDivisor: number;
  shippingCostCents: number;
  taxPercent: number;
  totalCostCents: number;
  computedSalePriceCents: number;
  priceOverridden: boolean;
  priceBasis: QuotationPricingBasis;
  /** 打印到报价单上的配置文字，例如「10节 1500mAh 两电一充 · 配件：锯片」。 */
  label: string;
}

export interface QuotationConfigPriceInput {
  baseCostCents: number;
  packagingCents: number;
  otherCostCents: number;
  accessoryCents: number;
  batteryUnitPriceCents: number;
  batteryCount: number;
  chargerPriceCents: number;
  shippingCents: number;
  taxPercent: number;
  markupPercent: number;
}

/** 与售价计算器同一成本口径：直接成本 × (1 + 税率) × (1 + 毛利率)。 */
export function calculateQuotationConfigPrice(input: QuotationConfigPriceInput): { totalCostCents: number; salePriceCents: number } {
  const directYuan = (
    Math.max(0, input.baseCostCents)
    + Math.max(0, input.packagingCents)
    + Math.max(0, input.otherCostCents)
    + Math.max(0, input.accessoryCents)
    + Math.max(0, input.shippingCents)
    + Math.max(0, input.batteryUnitPriceCents) * Math.max(0, Math.trunc(input.batteryCount))
    + Math.max(0, input.chargerPriceCents)
  ) / 100;
  const taxMultiplier = 1 + Math.max(0, input.taxPercent) / 100;
  const totalCostYuan = round2(directYuan * taxMultiplier);
  const salePriceYuan = round2(totalCostYuan * (1 + Math.max(0, input.markupPercent) / 100));
  return {
    totalCostCents: Math.round(totalCostYuan * 100),
    salePriceCents: Math.round(salePriceYuan * 100),
  };
}

function cents(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function percent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(1000, Math.round(parsed * 100) / 100);
}

/** 服务端保存前清洗配置快照；结构不合法时返回 undefined，按无配置处理。 */
export function normalizeQuotationConfiguration(value: unknown): QuotationItemConfiguration | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return undefined;
  const mode = record.mode === 'battery' ? 'battery' : record.mode === 'bare' ? 'bare' : undefined;
  if (!mode) return undefined;
  const basis = isQuotationPricingBasis(record.priceBasis) ? record.priceBasis : 'shipping_ex_tax';
  const rawBattery = record.battery && typeof record.battery === 'object' ? record.battery as Record<string, unknown> : undefined;
  const batteryCount = Number(rawBattery?.batteryCount);
  const battery = mode === 'battery' && rawBattery ? {
    packCount: Math.max(1, Math.trunc(Number(rawBattery.packCount) || 0)),
    capacity: Math.max(1, Math.trunc(Number(rawBattery.capacity) || 0)),
    batteryCount: (batteryCount === 2 ? 2 : 1) as 1 | 2,
    batteryUnitPriceCents: cents(rawBattery.batteryUnitPriceCents),
    chargerName: typeof rawBattery.chargerName === 'string' ? rawBattery.chargerName.trim().slice(0, 80) : '',
    chargerPriceCents: cents(rawBattery.chargerPriceCents),
  } : undefined;
  if (mode === 'battery' && (!battery || !battery.packCount || !battery.capacity)) return undefined;
  const rawPackaging = record.packaging && typeof record.packaging === 'object' ? record.packaging as Record<string, unknown> : undefined;
  const packaging = rawPackaging ? {
    id: typeof rawPackaging.id === 'string' ? rawPackaging.id.trim().slice(0, 80) : '',
    name: typeof rawPackaging.name === 'string' ? rawPackaging.name.trim().slice(0, 100) : '',
    costCents: cents(rawPackaging.costCents),
  } : undefined;
  const accessoryNames = Array.isArray(record.accessoryNames)
    ? record.accessoryNames.filter((name): name is string => typeof name === 'string' && name.trim().length > 0).map((name) => name.trim().slice(0, 80)).slice(0, 80)
    : [];
  const label = typeof record.label === 'string' ? record.label.trim().slice(0, 240) : '';
  return {
    version: 1,
    mode,
    ...(battery ? { battery } : {}),
    ...(packaging ? { packaging } : {}),
    accessoryNames,
    accessoryPriceCents: cents(record.accessoryPriceCents),
    accessoryWeightKg: Math.max(0, Number(record.accessoryWeightKg) || 0),
    baseCostCents: cents(record.baseCostCents),
    otherCostCents: cents(record.otherCostCents),
    markupPercent: percent(record.markupPercent),
    shippingUnitPrice: Math.max(0, Number(record.shippingUnitPrice) || 0),
    volumeDivisor: Math.min(20000, Math.max(1000, Math.trunc(Number(record.volumeDivisor) || 8000))),
    shippingCostCents: cents(record.shippingCostCents),
    taxPercent: Math.min(100, Math.max(0, Number(record.taxPercent) || 0)),
    totalCostCents: cents(record.totalCostCents),
    computedSalePriceCents: cents(record.computedSalePriceCents),
    priceOverridden: record.priceOverridden === true,
    priceBasis: basis,
    label,
  };
}

/** 含运含税时，从含税小计里拆出税额，用于报价单「其中税额」展示。 */
export function includedTaxCents(subtotalCents: number, taxRateBps: number): number {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0) return 0;
  if (!Number.isSafeInteger(taxRateBps) || taxRateBps <= 0) return 0;
  return Math.round((subtotalCents * taxRateBps) / (10000 + taxRateBps));
}

/** 按整单价格口径计算合计：含税口径不再重复加税，只展示其中税额。 */
export function calculateDocumentTotalsForBasis(
  lines: readonly { quantity: number; unitPriceCents: number }[],
  taxRateBps: number,
  shippingCents: number,
  basis: QuotationPricingBasis,
): { subtotalCents: number; taxCents: number; shippingCents: number; totalCents: number } {
  if (pricingBasisIncludesTax(basis)) {
    const base = calculateDocumentTotals(lines, 0, shippingCents);
    return {
      subtotalCents: base.subtotalCents,
      taxCents: includedTaxCents(base.subtotalCents, taxRateBps),
      shippingCents: base.shippingCents,
      totalCents: base.subtotalCents + base.shippingCents,
    };
  }
  return calculateDocumentTotals(lines, taxRateBps, shippingCents);
}
