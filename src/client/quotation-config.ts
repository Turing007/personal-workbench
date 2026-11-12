import type { ProductRecord } from './components/ProductEditor';
import type { AccessoryPrice } from '../shared/accessory-prices';
import { accessoryTotals } from '../shared/accessory-prices';
import { batteryUnitPriceOf, BATTERY_COMBO_VARIANTS, type BatteryPriceMatrix } from '../shared/battery-prices';
import { packCountMatchesVoltage } from '../shared/battery-voltage';
import {
  autoShippingCost,
  chargeableWeightKg,
  comboShippingWeightKg,
  parsePackagingVolumeCm3,
  volumetricWeightKg,
} from '../shared/price-calculator';
import {
  calculateQuotationConfigPrice,
  pricingBasisIncludesShipping,
  pricingBasisIncludesTax,
  type QuotationItemConfiguration,
  type QuotationPricingBasis,
} from '../shared/quotation-config';

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

export function productBaseCostCents(product: ProductRecord): number {
  const quotes = product.purchaseQuotes ?? [];
  const defaultQuote = quotes.find((quote) => quote.isDefault) ?? quotes[0];
  const raw = (defaultQuote?.price ?? '').trim() || product.purchasePrice || '0';
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : 0;
}

export function productAccessoryList(product: ProductRecord, categoryAccessories: Record<string, AccessoryPrice[]>): AccessoryPrice[] {
  const own = (product.accessoryPrices ?? []).filter((item) => item.name.trim());
  if (own.length || product.accessoryPricesCustomized) return own;
  return categoryAccessories[product.category?.trim() ?? ''] ?? [];
}

export function batteryOptionsForProduct(product: ProductRecord, matrix: BatteryPriceMatrix | null): BatteryConfigOption[] {
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

export function quotationConfigWeights(
  product: ProductRecord,
  config: QuotationItemConfiguration,
  settings: QuotationConfigSettings,
): { actualWeightKg: number; chargeableWeightKg: number } {
  const packagingRow = (product.packaging ?? []).find((row) => String(row.id) === config.packaging?.id) ?? (product.packaging ?? [])[0];
  const productWeightKg = Number(packagingRow?.innerWeight) || 0;
  const outerVolumeCm3 = parsePackagingVolumeCm3(packagingRow?.outerSize);
  const parcelVolumeCm3 = outerVolumeCm3 ?? parsePackagingVolumeCm3(packagingRow?.innerSize);
  const unitsPerCarton = Math.max(1, Math.trunc(Number(packagingRow?.packSize) || 1));
  const volumeWeightKg = volumetricWeightKg(parcelVolumeCm3, settings.volumeDivisor, unitsPerCarton);
  const actualWeightKg = comboShippingWeightKg({
    productWeightKg,
    accessoryWeightKg: config.accessoryWeightKg,
    batteryPackCount: config.battery?.packCount,
    batteryCount: config.battery?.batteryCount,
    hasCharger: Boolean(config.battery),
  });
  return { actualWeightKg, chargeableWeightKg: chargeableWeightKg(actualWeightKg, volumeWeightKg) };
}

export function buildQuotationConfiguration(
  product: ProductRecord,
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

  const productWeightKg = Number(packagingRow?.innerWeight) || 0;
  const outerVolumeCm3 = parsePackagingVolumeCm3(packagingRow?.outerSize);
  const parcelVolumeCm3 = outerVolumeCm3 ?? parsePackagingVolumeCm3(packagingRow?.innerSize);
  const unitsPerCarton = Math.max(1, Math.trunc(Number(packagingRow?.packSize) || 1));
  const volumeWeightKg = volumetricWeightKg(parcelVolumeCm3, settings.volumeDivisor, unitsPerCarton);
  const actualWeightKg = comboShippingWeightKg({
    productWeightKg,
    accessoryWeightKg,
    batteryPackCount: selectedBattery?.packCount,
    batteryCount,
    hasCharger: Boolean(selectedBattery),
  });
  const chargeable = chargeableWeightKg(actualWeightKg, volumeWeightKg);
  // 运费快照始终保留，切换含运/不含运口径时可直接复用，不必重新选包装。
  const shippingCostCents = Math.round(autoShippingCost(chargeable, settings.shippingUnitPrice) * 100);
  const shippingCents = pricingBasisIncludesShipping(settings.pricingBasis) ? shippingCostCents : 0;
  const taxPercent = pricingBasisIncludesTax(settings.pricingBasis) ? settings.taxRateBps / 100 : 0;
  const markupPercent = Math.max(0, Number(selection.markupPercent ?? 0));
  const price = calculateQuotationConfigPrice({
    baseCostCents,
    packagingCents,
    otherCostCents,
    accessoryCents: accessoryPriceCents,
    batteryUnitPriceCents,
    batteryCount,
    chargerPriceCents,
    shippingCents,
    taxPercent,
    markupPercent,
  });

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
  product: ProductRecord,
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
