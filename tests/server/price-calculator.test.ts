import { describe, expect, it } from 'vitest';
import {
  autoShippingCost,
  batteryPackWeightKg,
  CHARGER_WEIGHT_KG,
  comboShippingWeightKg,
  DEFAULT_SHIPPING_UNIT_PRICE,
  normalizePricePlanItems,
  normalizePricePlanParams,
  planItemAmount,
  planMargin,
  planSalePrice,
  planTotalCost,
  pricePlanMarkup,
  round2,
} from '../../src/shared/price-calculator';
import { mergeAccessoryPrices, normalizeAccessoryPrices, parseLegacyAccessoriesText } from '../../src/shared/accessory-prices';
import { batteryMatrixForProduct, batteryMatrixOptions, buildBatteryMatrixSeed, normalizeBatteryMatrix } from '../../src/shared/battery-prices';

describe('售价计算（纯函数）', () => {
  it('行金额 = 数量 × 单价，合计到分，售价按加价率折算', () => {
    expect(planItemAmount(2, 8.5)).toBe(17);
    expect(planItemAmount(3, 1.11)).toBe(3.33);
    const items = normalizePricePlanItems([
      { name: '产品成本', qty: 1, unitPrice: 46 },
      { name: '彩盒包装', qty: 1, unitPrice: 3.2 },
      { name: '21V电池', qty: 2, unitPrice: 8.5 },
    ]);
    const total = planTotalCost(items);
    expect(total).toBe(66.2);
    expect(planSalePrice(total, 20)).toBe(79.44);
    expect(planSalePrice(total, 0)).toBe(66.2);
  });

  it('毛利率 = (售价−成本)÷售价；售价为 0 时无意义', () => {
    expect(planMargin(91.44, 76.2)).toBe(16.7);
    expect(planMargin(0, 10)).toBeNull();
    expect(planMargin(-1, 10)).toBeNull();
  });

  it('明细清洗：名称为空丢行、数量与金额不为负、加价率封顶 1000', () => {
    const items = normalizePricePlanItems([
      { name: '  电池  ', qty: -2, unitPrice: 8.5 },
      { name: '   ', qty: 1, unitPrice: 3 },
      { name: '运费', qty: 1.9, unitPrice: -5 },
      { name: '充电器', qty: '', unitPrice: 6 },
    ]);
    expect(items).toEqual([
      { name: '电池', qty: 0, unitPrice: 8.5, amount: 0 },
      { name: '运费', qty: 1, unitPrice: 0, amount: 0 },
      { name: '充电器', qty: 1, unitPrice: 6, amount: 6 },
    ]);
    expect(pricePlanMarkup(3000)).toBe(1000);
    expect(pricePlanMarkup('abc')).toBe(0);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe('运费预估（按计费重量 × 单价）', () => {
  it('电池包单重：5 节 0.3 / 10 节 0.5 / 15 节 0.7 / 20 节 0.9', () => {
    expect(batteryPackWeightKg(5)).toBe(0.3);
    expect(batteryPackWeightKg(10)).toBe(0.5);
    expect(batteryPackWeightKg(15)).toBe(0.7);
    expect(batteryPackWeightKg(20)).toBe(0.9);
  });

  it('表里没有的节数按斜率外推，非法输入归零', () => {
    // 5 节 0.3 起、每 5 节 +0.2kg → 斜率 0.04/kg，截距 0.1。
    expect(batteryPackWeightKg(25)).toBe(1.1);
    expect(batteryPackWeightKg(30)).toBe(1.3);
    expect(batteryPackWeightKg(0)).toBe(0);
    expect(batteryPackWeightKg(-5)).toBe(0);
    expect(batteryPackWeightKg(Number.NaN)).toBe(0);
  });

  it('组合计费重量 = 产品重量 + 电池包重量 × 电数 + 充电器 0.05', () => {
    // 裸机：只有产品重量。
    expect(comboShippingWeightKg({ productWeightKg: 0.9 })).toBe(0.9);
    // 5 节一电一充：0.9 + 0.3 + 0.05。
    expect(comboShippingWeightKg({ productWeightKg: 0.9, batteryPackCount: 5, batteryCount: 1, hasCharger: true })).toBe(1.25);
    // 5 节两电一充：0.9 + 0.6 + 0.05。
    expect(comboShippingWeightKg({ productWeightKg: 0.9, batteryPackCount: 5, batteryCount: 2, hasCharger: true })).toBe(1.55);
    // 10 节两电一充：0.9 + 1.0 + 0.05。
    expect(comboShippingWeightKg({ productWeightKg: 0.9, batteryPackCount: 10, batteryCount: 2, hasCharger: true })).toBe(1.95);
    // 充电器按 0.05kg 计。
    expect(CHARGER_WEIGHT_KG).toBe(0.05);
  });

  it('无电池组合不带充电器重量；产品重量为负按 0 兜底', () => {
    expect(comboShippingWeightKg({ productWeightKg: 1.2, batteryPackCount: 5, batteryCount: 0 })).toBe(1.2);
    expect(comboShippingWeightKg({ productWeightKg: -1 })).toBe(0);
  });

  it('运费 = 重量 × 单价，保留两位小数；默认单价 1.5', () => {
    expect(autoShippingCost(1.25, DEFAULT_SHIPPING_UNIT_PRICE)).toBe(1.88);
    expect(autoShippingCost(0.9, 1.5)).toBe(1.35);
    expect(autoShippingCost(0, 1.5)).toBe(0);
    expect(DEFAULT_SHIPPING_UNIT_PRICE).toBe(1.5);
  });

  it('参数快照存运费模式与单价；旧方案按手动回显既有运费', () => {
    const params = normalizePricePlanParams({
      baseCost: 100, packaging: 2, shipping: 1.88, taxPercent: 0,
      chargerName: '小线充', chargerPrice: 2, shippingMode: 'auto', shippingUnitPrice: 1.5,
    });
    expect(params.shippingMode).toBe('auto');
    expect(params.shippingUnitPrice).toBe(1.5);
    // 旧方案（没有这两个字段）：模式回落到手动、运费保持原值、单价补默认。
    const legacy = normalizePricePlanParams({ baseCost: 100, shipping: 7.5 });
    expect(legacy.shippingMode).toBe('manual');
    expect(legacy.shipping).toBe(7.5);
    expect(legacy.shippingUnitPrice).toBe(DEFAULT_SHIPPING_UNIT_PRICE);
    // 非法模式值一律按手动。
    expect(normalizePricePlanParams({ shippingMode: 'weird' }).shippingMode).toBe('manual');
  });
});

describe('配件与价格清洗', () => {
  it('名称为空丢行、价格不为负、保留两位、按上限截断', () => {
    expect(
      normalizeAccessoryPrices([
        { id: 'a1', name: ' 21V 2.0Ah 电池 ', price: '8.456' },
        { name: '', price: 3 },
        { name: '充电器', price: -1 },
      ]),
    ).toEqual([
      { id: 'a1', name: '21V 2.0Ah 电池', price: 8.46 },
      { id: 'acc-2', name: '充电器', price: 0 },
    ]);
    const many = Array.from({ length: 100 }, (_, index) => ({ name: `配件${index}`, price: index }));
    expect(normalizeAccessoryPrices(many)).toHaveLength(80);
  });

  it('电池矩阵播种：默认模板打底，旧条目「5 节 1300」按行列填入价格', () => {
    const matrix = buildBatteryMatrixSeed([
      { name: '5 节 1300', price: 11 },
      { name: '15 节 2000', price: 42 },
      { name: '随便写的', price: 3 },
    ]);
    expect(matrix.capacities).toEqual([1300, 1500, 2000]);
    expect(matrix.packCounts).toEqual([5, 10, 15, 20]);
    expect(matrix.prices[matrix.capacities.indexOf(1300)][matrix.packCounts.indexOf(5)]).toBe(11);
    expect(matrix.prices[matrix.capacities.indexOf(2000)][matrix.packCounts.indexOf(15)]).toBe(42);
  });

  it('电池矩阵清洗与选项：非法行列剔除、价格保留两位、只出已定价单元格', () => {
    expect(
      normalizeBatteryMatrix({ capacities: [1300, -1, 1300, 'x'], packCounts: [5, 0], prices: [[9.999]] }),
    ).toEqual({ capacities: [1300], packCounts: [5], prices: [[10]] });
    expect(
      batteryMatrixOptions({ capacities: [1300], packCounts: [5, 10], prices: [[11, 0]] }),
    ).toEqual([{ id: 'cell-0-0', name: '5 节 1300 电池', price: 11 }]);
  });

  it('电池矩阵可见范围：没设范围的行列对谁都可见，设了范围的只对命中分类可见', () => {
    const matrix = normalizeBatteryMatrix({
      capacities: [1100, 1300],
      packCounts: [3, 5],
      prices: [[7, 8], [9, 10]],
      capacityScopes: [['电钻'], []],
      packCountScopes: [[], ['扳手']],
    });
    expect(matrix.capacityScopes).toEqual([['电钻'], []]);
    expect(matrix.packCountScopes).toEqual([[], ['扳手']]);

    // 电钻：看得见 1100 行（限定电钻）与 3 节列（未限定）；1300 行通用、5 节列限定扳手 → 5 节对电钻不可见。
    expect(batteryMatrixForProduct(matrix, ['电钻'])).toMatchObject({
      capacities: [1100, 1300],
      packCounts: [3],
      prices: [[7], [9]],
    });
    // 扳手：1100 行限定电钻 → 整行不出现；5 节列限定扳手 → 保留。
    expect(batteryMatrixForProduct(matrix, ['扳手'])).toMatchObject({
      capacities: [1300],
      packCounts: [3, 5],
      prices: [[9, 10]],
    });
    // 没填分类的产品只看到通用的行列。
    expect(batteryMatrixForProduct(matrix, [])).toMatchObject({
      capacities: [1300],
      packCounts: [3],
      prices: [[9]],
    });
    // 分类名两端空格不影响命中。
    expect(batteryMatrixForProduct(matrix, [' 电钻 ']).capacities).toEqual([1100, 1300]);
  });

  it('电池矩阵可见范围：清洗非法分类、老数据不凭空多出字段', () => {
    const cleaned = normalizeBatteryMatrix({
      capacities: [1300],
      packCounts: [5],
      prices: [[1]],
      capacityScopes: [[' 电钻 ', '', '电钻', 42, 'x'.repeat(60)]],
    });
    expect(cleaned.capacityScopes).toEqual([['电钻', 'x'.repeat(30)]]);
    // 范围全空（或没传）时两个字段都不写出，老数据读回来的形状不变。
    expect(Object.keys(normalizeBatteryMatrix({ capacities: [1300], packCounts: [5], prices: [[1]] }))).toEqual(['capacities', 'packCounts', 'prices']);
    expect(Object.keys(normalizeBatteryMatrix({ capacities: [1300], packCounts: [5], prices: [[1]], capacityScopes: [[], []] }))).toEqual(['capacities', 'packCounts', 'prices']);
  });

  it('旧配件文本按行拆分：行尾「6元」「0.03/根」作价格，其余作名称', () => {
    expect(
      parseLegacyAccessoriesText('套筒9件套（10 11 12  13 14 15 17 3/8转1/4  75mm加长杆 ） 6元\n3.2 4.0 4.8拉嘴+扳手（标配）\n铆钉 0.03/根\n\n'),
    ).toEqual([
      { id: '', name: '套筒9件套（10 11 12  13 14 15 17 3/8转1/4  75mm加长杆 ）', price: 6 },
      { id: '', name: '3.2 4.0 4.8拉嘴+扳手（标配）', price: 0 },
      { id: '', name: '铆钉', price: 0.03 },
    ]);
  });

  it('同名合并保留先出现的条目，价格为空时用新值补上', () => {
    expect(
      mergeAccessoryPrices([{ id: 'a1', name: '钻头', price: 0 }], [{ id: '', name: '钻头', price: 3 }, { id: '', name: '锯片', price: 4.5 }]),
    ).toEqual([
      { id: 'a1', name: '钻头', price: 3 },
      { id: '', name: '锯片', price: 4.5 },
    ]);
  });
});
