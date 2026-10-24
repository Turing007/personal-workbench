import type { MappedProduct } from './product-record-mapper.js';
import type { AccessoryPrice } from '../../shared/accessory-prices.js';
import type { BatteryPriceMatrix } from '../../shared/battery-prices.js';
import { BATTERY_COMBO_VARIANTS, batteryUnitPriceOf } from '../../shared/battery-prices.js';
import { normalizeBatteryVoltage, packCountMatchesVoltage, type BatteryVoltage } from '../../shared/battery-voltage.js';
import { round2 } from '../../shared/price-calculator.js';

/** 图册报价的一列：某个节数 × 一电一充/两电一充。 */
export interface CatalogPriceColumn {
  packCount: number;
  batteryCount: 1 | 2;
  label: string;
}

/** 客户版报价表：只含最终售价，不含任何成本字段。 */
export interface CatalogPriceTable {
  voltage: BatteryVoltage;
  capacities: number[];
  columns: CatalogPriceColumn[];
  /** prices[容量行][列] = 向上取整后的售价；null = 该组合未定价。 */
  prices: Array<Array<number | null>>;
  /** 全部组合里的最低价；没有可售组合时为 null。 */
  minPrice: number | null;
}

/**
 * 图册售价 = 成本 ×（1 + 毛利率），向上取整到元。
 * 成本 = 产品默认采购价 + 第一条包装采购价 + 第一个充电器价 + 电池单价 × 电数；
 * 不含税、不含运费（用户口径），配件与其他费用也不计入。
 * 只使用「与产品电压匹配」的节数列；所有容量行都参与。
 */
export function buildCatalogPriceTable(
  product: MappedProduct,
  options: { batteryMatrix: BatteryPriceMatrix; chargerPrices: AccessoryPrice[]; markupPercent: number },
): CatalogPriceTable | null {
  const markup = Number(options.markupPercent);
  if (!Number.isFinite(markup) || markup <= 0) return null;

  const quotes = (Array.isArray(product.purchaseQuotes) ? product.purchaseQuotes : []) as Array<{ price?: unknown; isDefault?: unknown }>;
  const defaultQuote = quotes.find((quote) => quote.isDefault === true || quote.isDefault === 1) ?? quotes[0];
  const quotePrice = Number(defaultQuote?.price);
  const purchasePrice = Number(product.purchasePrice);
  const baseCost = Math.max(0, Number.isFinite(quotePrice) && quotePrice > 0 ? quotePrice : (Number.isFinite(purchasePrice) ? purchasePrice : 0));
  if (baseCost <= 0) return null;

  const packaging = (Array.isArray(product.packaging) ? product.packaging : []) as Array<Record<string, unknown>>;
  const packagingCost = Math.max(0, Number(packaging[0]?.purchasePrice ?? packaging[0]?.purchase_price ?? 0) || 0);
  const chargerCost = Math.max(0, Number(options.chargerPrices[0]?.price) || 0);

  const voltage = normalizeBatteryVoltage(product.batteryVoltage);
  const matrix = options.batteryMatrix;
  const packCounts = matrix.packCounts.filter((packCount) => packCountMatchesVoltage(packCount, voltage));
  if (!matrix.capacities.length || !packCounts.length) return null;

  const columns: CatalogPriceColumn[] = packCounts.flatMap((packCount) => BATTERY_COMBO_VARIANTS.map((variant) => ({
    packCount,
    batteryCount: variant.batteryCount as 1 | 2,
    label: variant.label,
  })));

  let minPrice: number | null = null;
  const prices = matrix.capacities.map((capacity) => columns.map((column) => {
    const unit = batteryUnitPriceOf(matrix, capacity, column.packCount);
    if (unit == null || unit <= 0) return null;
    const cost = round2(baseCost + packagingCost + chargerCost + unit * column.batteryCount);
    const sale = Math.ceil(round2(cost * (1 + markup / 100)));
    if (minPrice == null || sale < minPrice) minPrice = sale;
    return sale;
  }));

  if (minPrice == null) return null;
  return { voltage, capacities: matrix.capacities, columns, prices, minPrice };
}
