import { describe, expect, it } from 'vitest';
import {
  batteryOptionsForProduct,
  buildQuotationConfiguration,
  packagingWeights,
  productAccessoryList,
  productBaseCostCents,
  quotationConfigPriceInputs,
  quotationConfigWeights,
  recalculateQuotationConfiguration,
  type PricingProduct,
  type QuotationConfigSettings,
} from '../../src/shared/product-pricing';
import { calculateQuotationConfigPrice, type QuotationPricingBasis } from '../../src/shared/quotation-config';
import type { BatteryPriceMatrix } from '../../src/shared/battery-prices';

// 金标准测试（重构方案第 2 步）：期望值全部独立手算，不经过被测函数。
// 口径：直接成本(元) × (1 + 税率) × (1 + 毛利率)，两位小数容差四舍五入；金额落分。

const matrix: BatteryPriceMatrix = {
  capacities: [1300, 1500],
  packCounts: [5, 10],
  // 1300: 5节=11元 / 10节=14元；1500: 5节=15元 / 10节=16元
  prices: [[11, 14], [15, 16]],
};

const product: PricingProduct = {
  purchasePrice: '90',
  purchaseQuotes: [{ price: '100', isDefault: true }],
  category: '电动工具',
  batteryVoltage: '21V',
  accessoryPrices: [{ id: 'a1', name: '锯片', price: 3, weight: 0.1 }],
  accessoryPricesCustomized: true,
  packaging: [
    // 外箱 50×40×30=60000cm³ ÷ 装箱 10 = 6000cm³/台 ÷ 8000 = 0.75kg 体积重
    { id: 'p1', name: '彩盒', innerWeight: '0.8', innerSize: '30×20×10', outerSize: '50×40×30', packSize: 10, purchasePrice: '5' },
    { id: 'p2', name: '简包', innerWeight: '0.6', innerSize: '28×18×9', outerSize: '', packSize: 1, purchasePrice: '3.5' },
  ],
};

function settings(overrides: Partial<QuotationConfigSettings> = {}): QuotationConfigSettings {
  return {
    batteryMatrix: matrix,
    chargerPrices: [{ id: 'c1', name: '2A 充电器', price: 8.5 }],
    volumeDivisor: 8000,
    categoryAccessories: {},
    taxRateBps: 1300,
    pricingBasis: 'shipping_ex_tax',
    shippingUnitPrice: 1.5,
    ...overrides,
  };
}

describe('报价计价金标准', () => {
  it('裸机 · 含运不含税：成本 106.20 / 售价 127.44', () => {
    const config = buildQuotationConfiguration(product, { mode: 'bare', markupPercent: 20 }, settings());
    // 实重 0.8kg > 体积重 0.75kg → 运费 0.8×1.5=1.20 元
    expect(config.shippingCostCents).toBe(120);
    // 直接成本 = 100 + 5 + 1.2 = 106.2；不含税；×1.2 = 127.44
    expect(config.totalCostCents).toBe(10620);
    expect(config.computedSalePriceCents).toBe(12744);
    expect(config.taxPercent).toBe(0);
    expect(config.priceOverridden).toBe(false);
    expect(config.label).toBe('裸机');
  });

  it('5节1300 一电一充 + 锯片 · 含运不含税：成本 129.38 / 售价 155.26', () => {
    const config = buildQuotationConfiguration(product, {
      mode: 'battery', packCount: 5, capacity: 1300, batteryCount: 1,
      accessoryNames: ['锯片'], markupPercent: 20,
    }, settings());
    // 实重 = 0.8 + 0.1 + 0.3×1 + 0.05 = 1.25kg → 运费 round2(1.875)=1.88 元
    expect(config.shippingCostCents).toBe(188);
    // 直接成本 = 100 + 5 + 3 + 1.88 + 11 + 8.5 = 129.38；×1.2 = 155.256 → 155.26
    expect(config.totalCostCents).toBe(12938);
    expect(config.computedSalePriceCents).toBe(15526);
    expect(config.battery).toMatchObject({ packCount: 5, capacity: 1300, batteryCount: 1, batteryUnitPriceCents: 1100, chargerPriceCents: 850 });
    expect(config.label).toContain('5节 1300mAh 一电一充');
    expect(config.label).toContain('锯片');
  });

  it('10节1500 两电一充 · 含运含税：成本 167.56 / 售价 209.45', () => {
    const config = buildQuotationConfiguration(product, {
      mode: 'battery', packCount: 10, capacity: 1500, batteryCount: 2, markupPercent: 25,
    }, settings({ pricingBasis: 'shipping_inc_tax' }));
    // 实重 = 0.8 + 0.5×2 + 0.05 = 1.85kg → 运费 round2(2.775)=2.78 元
    expect(config.shippingCostCents).toBe(278);
    // 直接成本 = 100 + 5 + 2.78 + 16×2 + 8.5 = 148.28
    // 含税成本 = round2(148.28×1.13) = 167.56；×1.25 = 209.45
    expect(config.totalCostCents).toBe(16756);
    expect(config.computedSalePriceCents).toBe(20945);
    expect(config.taxPercent).toBe(13);
  });

  it('不含运不含税：运费快照保留但不计入，成本 105.00 / 售价 126.00', () => {
    const config = buildQuotationConfiguration(product, { mode: 'bare', markupPercent: 20 }, settings({ pricingBasis: 'no_shipping_ex_tax' }));
    expect(config.shippingCostCents).toBe(120);
    expect(config.totalCostCents).toBe(10500);
    expect(config.computedSalePriceCents).toBe(12600);
  });

  it('服务端重算映射与客户端构建逐分一致（三种口径 × 裸机/电池）', () => {
    const bases: QuotationPricingBasis[] = ['shipping_ex_tax', 'shipping_inc_tax', 'no_shipping_ex_tax'];
    for (const pricingBasis of bases) {
      for (const selection of [
        { mode: 'bare' as const, markupPercent: 20 },
        { mode: 'battery' as const, packCount: 5, capacity: 1300, batteryCount: 1 as const, accessoryNames: ['锯片'], markupPercent: 33.3 },
        { mode: 'battery' as const, packCount: 10, capacity: 1500, batteryCount: 2 as const, markupPercent: 0 },
      ]) {
        const config = buildQuotationConfiguration(product, selection, settings({ pricingBasis }));
        // 服务端保存时拿到的就是这份快照组分：重算必须还原出一模一样的成本/售价
        const recomputed = calculateQuotationConfigPrice(quotationConfigPriceInputs({
          baseCostCents: config.baseCostCents,
          packagingCents: config.packaging?.costCents ?? 0,
          otherCostCents: config.otherCostCents,
          accessoryCents: config.accessoryPriceCents,
          batteryUnitPriceCents: config.battery?.batteryUnitPriceCents ?? 0,
          batteryCount: config.battery?.batteryCount ?? 0,
          chargerPriceCents: config.battery?.chargerPriceCents ?? 0,
          shippingCostCents: config.shippingCostCents,
          taxRateBps: 1300,
          markupPercent: config.markupPercent,
          pricingBasis,
        }));
        expect(recomputed.totalCostCents).toBe(config.totalCostCents);
        expect(recomputed.salePriceCents).toBe(config.computedSalePriceCents);
      }
    }
  });

  it('回算保留手改标记，重量与构建口径一致', () => {
    const config = buildQuotationConfiguration(product, { mode: 'battery', packCount: 5, capacity: 1300, batteryCount: 1, markupPercent: 20 }, settings());
    const overridden = { ...config, priceOverridden: true };
    const recalculated = recalculateQuotationConfiguration(overridden, product, settings());
    expect(recalculated.priceOverridden).toBe(true);
    expect(recalculated.computedSalePriceCents).toBe(config.computedSalePriceCents);
    // 该配置未选配件：实重 = 0.8 + 0.3×1 + 0.05 = 1.15kg > 体积重 0.75kg
    expect(quotationConfigWeights(product, config, settings())).toEqual({ actualWeightKg: 1.15, chargeableWeightKg: 1.15 });
  });
});

describe('取数规则', () => {
  it('采购价：默认报价优先 → 镜像列兜底 → 非法归零', () => {
    expect(productBaseCostCents(product)).toBe(10000);
    expect(productBaseCostCents({ purchasePrice: '88.5', purchaseQuotes: [{ price: '', isDefault: true }] })).toBe(8850);
    expect(productBaseCostCents({ purchasePrice: 'abc' })).toBe(0);
    expect(productBaseCostCents({})).toBe(0);
  });

  it('配件：自有优先；未固化沿用类目；固化空清单不再跟随类目', () => {
    const category = { 电动工具: [{ id: 'cat', name: '类目锯片', price: 4, weight: 0.2 }] };
    expect(productAccessoryList(product, category).map((item) => item.name)).toEqual(['锯片']);
    expect(productAccessoryList({ category: '电动工具', accessoryPrices: [], accessoryPricesCustomized: false }, category).map((item) => item.name)).toEqual(['类目锯片']);
    expect(productAccessoryList({ category: '电动工具', accessoryPrices: [], accessoryPricesCustomized: true }, category)).toEqual([]);
  });

  it('电池选项：按电压过滤节数，未定价组合不出现', () => {
    const options21v = batteryOptionsForProduct(product, matrix);
    expect(options21v.map((option) => option.value)).toEqual(['5-1300-1', '5-1300-2', '5-1500-1', '5-1500-2', '10-1300-1', '10-1300-2', '10-1500-1', '10-1500-2']);
    const options12v = batteryOptionsForProduct({ ...product, batteryVoltage: '12V' }, { capacities: [1300], packCounts: [3, 5], prices: [[10, 11]] });
    expect(options12v.map((option) => option.value)).toEqual(['3-1300-1', '3-1300-2']);
    const unpriced = batteryOptionsForProduct(product, { capacities: [1300], packCounts: [5], prices: [[0]] });
    expect(unpriced).toEqual([]);
  });

  it('包装重量：按 id 选行、缺省回退首行、无外箱退回内盒体积', () => {
    // p2：无外箱 → 内盒 28×18×9=4536cm³ ÷ 1 ÷ 8000 = 0.567 → round2 = 0.57kg
    const weightsP2 = packagingWeights(product, 'p2', 8000, { accessoryWeightKg: 0 });
    expect(weightsP2.actualWeightKg).toBe(0.6);
    expect(weightsP2.chargeableWeightKg).toBe(0.6);
    // 缺省 id → 首行 p1（体积重 0.75 > 实重 0.6 时取体积重）
    const weightsDefault = packagingWeights({ ...product, packaging: [{ id: 'p1', innerWeight: '0.6', outerSize: '50×40×30', packSize: 10 }] }, undefined, 8000, { accessoryWeightKg: 0 });
    expect(weightsDefault.chargeableWeightKg).toBe(0.75);
    // 无任何尺寸 → 只按实重
    const weightsNoSize = packagingWeights({ packaging: [{ id: 'x', innerWeight: '1.2' }] }, 'x', 8000, { accessoryWeightKg: 0 });
    expect(weightsNoSize.chargeableWeightKg).toBe(1.2);
  });
});