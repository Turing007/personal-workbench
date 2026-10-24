import { describe, expect, it } from 'vitest';
import { batteryVoltageForPackCount, normalizeBatteryVoltage, packCountMatchesVoltage } from '../../src/shared/battery-voltage';
import { buildCatalogPriceTable } from '../../src/server/services/catalog-pricing';
import type { MappedProduct } from '../../src/server/services/product-record-mapper';
import type { BatteryPriceMatrix } from '../../src/shared/battery-prices';

function product(overrides: Partial<MappedProduct> = {}): MappedProduct {
  return {
    id: 1,
    name: '测试产品',
    sku: 'VT-0001',
    specification: '',
    parameters: '',
    category: '电钻',
    purchasePrice: 100,
    supplier: '',
    colors: [],
    batteryPlugs: [],
    batteryVoltage: '21V',
    accessories: '',
    accessoryPrices: [],
    accessoryPricesCustomized: false,
    remark: '',
    status: 'active',
    packaging: [{ purchasePrice: 3.2 }],
    purchaseQuotes: [{ supplier: '', variant: '', price: '100', isDefault: true }],
    images: [],
    videos: [],
    attachments: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as MappedProduct;
}

const matrix: BatteryPriceMatrix = {
  capacities: [1300],
  packCounts: [3, 5, 10],
  prices: [[10, 8, 14]],
};

describe('电池电压与图册报价', () => {
  it('电压映射：3 节 12V、4 节 16.8V、5 节及以上 21V', () => {
    expect(batteryVoltageForPackCount(3)).toBe('12V');
    expect(batteryVoltageForPackCount(4)).toBe('16.8V');
    for (const count of [5, 10, 15, 20]) expect(batteryVoltageForPackCount(count)).toBe('21V');
    expect(packCountMatchesVoltage(3, '12V')).toBe(true);
    expect(packCountMatchesVoltage(3, '21V')).toBe(false);
    expect(packCountMatchesVoltage(10, '21V')).toBe(true);
    expect(normalizeBatteryVoltage('16.8V')).toBe('16.8V');
    expect(normalizeBatteryVoltage('7.2V')).toBe('21V');
  });

  it('图册报价：只出匹配电压的列，成本含包装与充电器，向上取整到元', () => {
    const table = buildCatalogPriceTable(product({ batteryVoltage: '12V' }), {
      batteryMatrix: matrix,
      chargerPrices: [{ id: 'c1', name: '充电器', price: 2 }],
      markupPercent: 20,
    });
    expect(table).not.toBeNull();
    expect(table!.voltage).toBe('12V');
    expect(table!.columns.map((column) => `${column.packCount}-${column.batteryCount}`)).toEqual(['3-1', '3-2']);
    // 一电一充：100 + 3.2 + 2 + 10 = 115.2 → ×1.2 = 138.24 → 139
    // 两电一充：100 + 3.2 + 2 + 20 = 125.2 → ×1.2 = 150.24 → 151
    // 裸机：(100 + 3.2) × 1.2 = 123.84 → 124
    expect(table!.prices).toEqual([[139, 151]]);
    expect(table!.barePrice).toBe(124);
    expect(table!.minPrice).toBe(124);
  });

  it('21V 只出 5 节及以上；16.8V 没有 4 节时仍显示裸机价', () => {
    const table = buildCatalogPriceTable(product({ batteryVoltage: '21V' }), {
      batteryMatrix: matrix,
      chargerPrices: [],
      markupPercent: 10,
    });
    expect(table!.columns.map((column) => column.packCount)).toEqual([5, 5, 10, 10]);
    // 5 节一电：103.2 + 8 = 111.2 × 1.1 = 122.32 → 123；两电：119.2 × 1.1 = 131.12 → 132
    expect(table!.prices[0].slice(0, 2)).toEqual([123, 132]);
    expect(table!.barePrice).toBe(114); // 103.2 × 1.1 = 113.52 → 114
    expect(table!.minPrice).toBe(114);

    // 表里没有 4 节列时，16.8V 产品仍显示裸机价，只是没有电池配置。
    const noBattery = buildCatalogPriceTable(product({ batteryVoltage: '16.8V' }), {
      batteryMatrix: matrix,
      chargerPrices: [],
      markupPercent: 20,
    });
    expect(noBattery).not.toBeNull();
    expect(noBattery!.columns).toHaveLength(0);
    expect(noBattery!.barePrice).toBe(124);
  });

  it('毛利率 <= 0 或没有采购价时不出报价', () => {
    expect(buildCatalogPriceTable(product(), { batteryMatrix: matrix, chargerPrices: [], markupPercent: 0 })).toBeNull();
    expect(buildCatalogPriceTable(product({ purchasePrice: 0, purchaseQuotes: [] }), {
      batteryMatrix: matrix, chargerPrices: [], markupPercent: 20,
    })).toBeNull();
  });
});
