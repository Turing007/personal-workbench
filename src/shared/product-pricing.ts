import type { AccessoryPrice } from './accessory-prices.js';
import { accessoryTotals } from './accessory-prices.js';
import { batteryUnitPriceOf, BATTERY_COMBO_VARIANTS, type BatteryPriceMatrix } from './battery-prices.js';
import { packCountMatchesVoltage } from './battery-voltage.js';
import {
  autoShippingCost,
  chargeableWeightKg,
  comboShippingWeightKg,
  parsePackagingVolumeCm3,
  volumetricWeightKg,
} from './price-calculator.js';
import {
  calculateQuotationConfigPrice,
  pricingBasisIncludesShipping,
  pricingBasisIncludesTax,
  type QuotationConfigPriceInput,
  type QuotationItemConfiguration,
  type QuotationPricingBasis,
} from './quotation-config.js';

/**
 * 报价配置计价核心（客户端试算与服务端保存重算共用）。
 * 只依赖结构化的产品字段，不依赖 UI 层的 ProductRecord 类型。
 * 口径与售价计算器一致：直接成本 × (1 + 税率) × (1 + 毛利率)。
 */

/** 计价所需的最小包装行结构（与产品编辑器的 PackagingOption 结构兼容）。 */
export interface PricingPackagingRow {
  id?: string;
  name?: string;
  innerSize?: string;
  innerWeight?: string | number;
  outerSize?: string;
  packSize?: number | string;
  purchasePrice?: string | number;
}

/** 计价所需的最小产品结构（ProductRecord 结构兼容）。 */
export interface PricingProduct {
  purchasePrice?: string;
  purchaseQuotes?: ReadonlyArray<{ price?: string; isDefault?: boolean }>;
  accessoryPrices?: ReadonlyArray<AccessoryPrice>;
  accessoryPricesCustomized?: boolean;
  category?: string;
  batteryVoltage?: string;
  packaging?: ReadonlyArray<PricingPackagingRow>;
}

export interface QuotationConfigSettings {
  batteryMatrix: BatteryPriceMatrix | null;
  chargerPrices: AccessoryPrice[];
  volumeDivisor: number;
  categoryAccessories: Record<string, AccessoryPrice[]>;
  taxRateBps: number;
  pricingBasis: QuotationPricingBasis;
  shippingUnitPrice: number;
}

export interface QuotationConfigSelection {
  mode?: 'bare' | 'battery';
  packCount?: number;
  capacity?: number;
  batteryCount?: 1 | 2;
  chargerId?: string;
  packagingId?: string;
  accessoryNames?: string[];
  markupPercent?: number;
  otherCostCents?: number;
}

export interface BatteryConfigOption {
  value: string;
  label: string;
  packCount: number;
  capacity: number;
  batteryCount: 1 | 2;
  unitPriceCents: number;
}

export function productBaseCostCents(product: PricingProduct): number {
  const quotes = product.purchaseQuotes ?? [];
  const defaultQuote = quotes.find((quote) => quote.isDefault) ?? quotes[0];
  const raw = (defaultQuote?.price ?? '').trim() || product.purchasePrice || '0';
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : 0;
}

export function productAccessoryList(product: PricingProduct, categoryAccessories: Record<string, AccessoryPrice[]>): AccessoryPrice[] {
  const own = (product.accessoryPrices ?? []).filter((item) => item.name.trim());
  if (own.length || product.accessoryPricesCustomized) return own;
  return categoryAccessories[product.category?.trim() ?? ''] ?? [];
}

export function batteryOptionsForProduct(product: PricingProduct, matrix: BatteryPriceMatrix | null): BatteryConfigOption[] {
  if (!matrix) return [];
  const options: BatteryConfigOption[] = [];
  for (const packCount of matrix.packCounts) {
    if (!packCountMatchesVoltage(packCount, product.batteryVoltage)) continue;
    for (const capacity of matrix.capacities) {
      const price = batteryUnitPriceOf(matrix, capacity, packCount);
      if (price == null) continue;
      for (const variant of BATTERY_COMBO_VARIANTS) {
        options.push({
          value: `${packCount}-${capacity}-${variant.batteryCount}`,
          label: `${packCount}节 ${capacity}mAh ${variant.label}`,
          packCount,
          capacity,
          batteryCount: variant.batteryCount as 1 | 2,
          unitPriceCents: Math.round(price * 100),
        });
      }
    }
  }
  return options;
}

export function batteryOptionValue(config: QuotationItemConfiguration | undefined): string {
  if (!config || config.mode === 'bare' || !config.battery) return 'bare';
  return `${config.battery.packCount}-${config.battery.capacity}-${config.battery.batteryCount}`;
}

export interface ConfigWeightInput {
  accessoryWeightKg: number;
  batteryPackCount?: number;
  batteryCount?: number;
  hasCharger?: boolean;
}

/**
 * 所选包装行的实重/计费重：产品重量取内盒重量，体积重按外箱（缺省退回内盒）÷ 装箱数。
 * 构建配置与回算重量共用这一份，避免两处口径漂移。
 */
export function packagingWeights(
  product: PricingProduct,
  packagingId: string | undefined,
  volumeDivisor: number,
  weightInput: ConfigWeightInput,
): { actualWeightKg: number; chargeableWeightKg: number } {
  const packagingRow = (product.packaging ?? []).find((row) => String(row.id) === packagingId) ?? (product.packaging ?? [])[0];
  const productWeightKg = Number(packagingRow?.innerWeight) || 0;
  const outerVolumeCm3 = parsePackagingVolumeCm3(packagingRow?.outerSize);
  const parcelVolumeCm3 = outerVolumeCm3 ?? parsePackagingVolumeCm3(packagingRow?.innerSize);
  const unitsPerCarton = Math.max(1, Math.trunc(Number(packagingRow?.packSize) || 1));
  const volumeWeightKg = volumetricWeightKg(parcelVolumeCm3, volumeDivisor, unitsPerCarton);
  const actualWeightKg = comboShippingWeightKg({
    productWeightKg,
    accessoryWeightKg: weightInput.accessoryWeightKg,
    batteryPackCount: weightInput.batteryPackCount,
    batteryCount: weightInput.batteryCount,
    hasCharger: weightInput.hasCharger,
  });
  return { actualWeightKg, chargeableWeightKg: chargeableWeightKg(actualWeightKg, volumeWeightKg) };
}

export function quotationConfigWeights(
  product: PricingProduct,
  config: QuotationItemConfiguration,
  settings: QuotationConfigSettings,
): { actualWeightKg: number; chargeableWeightKg: number } {
  return packagingWeights(product, config.packaging?.id, settings.volumeDivisor, {
    accessoryWeightKg: config.accessoryWeightKg,
    batteryPackCount: config.battery?.packCount,
    batteryCount: config.battery?.batteryCount,
    hasCharger: Boolean(config.battery),
  });
}

/** 配置的成本组分 + 整单口径/税率。 */
export interface QuotationConfigCostComponents {
  baseCostCents: number;
  packagingCents: number;
  otherCostCents: number;
  accessoryCents: number;
  batteryUnitPriceCents: number;
  batteryCount: number;
  chargerPriceCents: number;
  /** 运费快照始终保留；是否计入由价格口径决定。 */
  shippingCostCents: number;
  taxRateBps: number;
  markupPercent: number;
  pricingBasis: QuotationPricingBasis;
}

/**
 * 价格口径 → 计价参数的唯一映射：含运才计运费、含税才计税率。
 * 客户端构建配置与服务端保存重算都走这里，保证两边逐分一致。
 */
export function quotationConfigPriceInputs(components: QuotationConfigCostComponents): QuotationConfigPriceInput {
  return {
    baseCostCents: components.baseCostCents,
    packagingCents: components.packagingCents,
    otherCostCents: components.otherCostCents,
    accessoryCents: components.accessoryCents,
    batteryUnitPriceCents: components.batteryUnitPriceCents,
    batteryCount: components.batteryCount,
    chargerPriceCents: components.chargerPriceCents,
    shippingCents: pricingBasisIncludesShipping(components.pricingBasis) ? components.shippingCostCents : 0,
    taxPercent: pricingBasisIncludesTax(components.pricingBasis) ? components.taxRateBps / 100 : 0,
    markupPercent: components.markupPercent,
  };
}

export function buildQuotationConfiguration(
  product: PricingProduct,
  selection: QuotationConfigSelection,
  settings: QuotationConfigSettings,
): QuotationItemConfiguration {
  const mode = selection.mode === 'battery' ? 'battery' : 'bare';
  const packagingRows = product.packaging ?? [];
  const packagingRow = packagingRows.find((row) => String(row.id) === selection.packagingId) ?? packagingRows[0];
  const baseCostCents = productBaseCostCents(product);
  const packagingCents = Math.round((Number(packagingRow?.purchasePrice) || 0) * 100);
  const otherCostCents = Math.max(0, Math.trunc(selection.otherCostCents ?? 0));
  const accessories = productAccessoryList(product, settings.categoryAccessories);
  const selectedNames = selection.accessoryNames ?? [];
  const selectedAccessories = accessories.filter((item) => selectedNames.includes(item.name));
  const accessory = accessoryTotals(selectedAccessories);
  const accessoryPriceCents = Math.round(accessory.price * 100);
  const accessoryWeightKg = accessory.weight;

  const options = batteryOptionsForProduct(product, settings.batteryMatrix);
  const selectedBattery = mode === 'battery'
    ? options.find((option) => option.value === `${selection.packCount}-${selection.capacity}-${selection.batteryCount}`) ?? options[0]
    : undefined;
  const batteryCount = selectedBattery?.batteryCount ?? 0;
  const batteryUnitPriceCents = selectedBattery?.unitPriceCents ?? 0;
  const charger = settings.chargerPrices.find((item) => item.id === selection.chargerId || item.name === selection.chargerId) ?? settings.chargerPrices[0];
  const chargerPriceCents = selectedBattery ? Math.round((charger?.price ?? 0) * 100) : 0;

  const weights = packagingWeights(product, selection.packagingId, settings.volumeDivisor, {
    accessoryWeightKg,
    batteryPackCount: selectedBattery?.packCount,
    batteryCount,
    hasCharger: Boolean(selectedBattery),
  });
  // 运费快照始终保留，切换含运/不含运口径时可直接复用，不必重新选包装。
  const shippingCostCents = Math.round(autoShippingCost(weights.chargeableWeightKg, settings.shippingUnitPrice) * 100);
  const taxPercent = pricingBasisIncludesTax(settings.pricingBasis) ? settings.taxRateBps / 100 : 0;
  const markupPercent = Math.max(0, Number(selection.markupPercent ?? 0));
  const price = calculateQuotationConfigPrice(quotationConfigPriceInputs({
    baseCostCents,
    packagingCents,
    otherCostCents,
    accessoryCents: accessoryPriceCents,
    batteryUnitPriceCents,
    batteryCount,
    chargerPriceCents,
    shippingCostCents,
    taxRateBps: settings.taxRateBps,
    markupPercent,
    pricingBasis: settings.pricingBasis,
  }));

  const batteryLabel = selectedBattery ? selectedBattery.label : '裸机';
  const accessoryLabel = selectedNames.length ? ` · 配件：${selectedNames.join('、')}` : '';
  return {
    version: 1,
    mode,
    ...(selectedBattery ? {
      battery: {
        packCount: selectedBattery.packCount,
        capacity: selectedBattery.capacity,
        batteryCount: selectedBattery.batteryCount,
        batteryUnitPriceCents: selectedBattery.unitPriceCents,
        chargerName: charger?.name ?? '',
        chargerPriceCents,
      },
    } : {}),
    ...(packagingRow ? {
      packaging: {
        id: String(packagingRow.id ?? ''),
        name: packagingRow.name ?? '',
        costCents: packagingCents,
      },
    } : {}),
    accessoryNames: selectedNames,
    accessoryPriceCents,
    accessoryWeightKg,
    baseCostCents,
    otherCostCents,
    markupPercent,
    shippingUnitPrice: settings.shippingUnitPrice,
    volumeDivisor: settings.volumeDivisor,
    shippingCostCents,
    taxPercent,
    totalCostCents: price.totalCostCents,
    computedSalePriceCents: price.salePriceCents,
    priceOverridden: false,
    priceBasis: settings.pricingBasis,
    label: `${batteryLabel}${accessoryLabel}`,
  };
}

/** 用已保存的配置回算重量/运费/成本，保留原包装与配件选择。 */
export function recalculateQuotationConfiguration(
  config: QuotationItemConfiguration,
  product: PricingProduct,
  settings: QuotationConfigSettings,
): QuotationItemConfiguration {
  const next = buildQuotationConfiguration(product, {
    mode: config.mode,
    packCount: config.battery?.packCount,
    capacity: config.battery?.capacity,
    batteryCount: config.battery?.batteryCount,
    chargerId: config.battery?.chargerName,
    packagingId: config.packaging?.id,
    accessoryNames: config.accessoryNames,
    markupPercent: config.markupPercent,
    otherCostCents: config.otherCostCents,
  }, settings);
  return { ...next, priceOverridden: config.priceOverridden };
}