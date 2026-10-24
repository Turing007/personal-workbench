import { describe, expect, it } from 'vitest';
import {
  autoShippingCost,
  batteryPackWeightKg,
  chargeableWeightKg,
  CHARGER_WEIGHT_KG,
  comboShippingWeightKg,
  comboTotalCost,
  DEFAULT_SHIPPING_UNIT_PRICE,
  DEFAULT_VOLUME_DIVISOR,
  normalizePricePlanItems,
  normalizePricePlanParams,
  normalizeVolumeDivisor,
  parsePackagingVolumeCm3,
  planItemAmount,
  planMargin,
  planSalePrice,
  planTotalCost,
  priceInclusionLabel,
  pricePlanMarkup,
  round2,
  volumetricWeightKg,
  VOLUME_DIVISOR_MAX,
  VOLUME_DIVISOR_MIN,
} from '../../src/shared/price-calculator';
import { accessoryTotals, mergeAccessoryPrices, normalizeAccessoryPrices, parseLegacyAccessoriesText } from '../../src/shared/accessory-prices';
import {
  batteryMatrixOptions,
  buildBatteryMatrixSeed,
  moveBatteryCapacity,
  moveBatteryPackCount,
  normalizeBatteryMatrix,
} from '../../src/shared/battery-prices';

describe('售价计算（纯函数）', () => {
  it('复制价签口径：按实际计入的运费与税，给出含税运说明', () => {
    // 运费和税都没计入 → 不含税运
    expect(priceInclusionLabel(0, 0)).toBe('不含税运');
    // 只计入运费 → 含运不含税
    expect(priceInclusionLabel(1.88, 0)).toBe('含运不含税');
    // 只计入税 → 含税不含运
    expect(priceInclusionLabel(0, 13)).toBe('含税不含运');
    // 两者都计入 → 含税运
    expect(priceInclusionLabel(1.88, 13)).toBe('含税运');
    // 异常值按未计入处理
    expect(priceInclusionLabel(Number.NaN, Number.NaN)).toBe('不含税运');
  });

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
    // 产品配件是每台都带：所有组合都加进实重。
    expect(comboShippingWeightKg({ productWeightKg: 0.9, accessoryWeightKg: 0.4 })).toBe(1.3);
    expect(comboShippingWeightKg({ productWeightKg: 0.9, accessoryWeightKg: 0.4, batteryPackCount: 5, batteryCount: 1, hasCharger: true })).toBe(1.65);
    // 配件价计入成本，再整体乘税；不传配件时与旧口径一致。
    expect(comboTotalCost({ baseCost: 100, packaging: 2, shipping: 1.35, taxPercent: 10 })).toBe(113.69);
    expect(comboTotalCost({ baseCost: 100, packaging: 2, shipping: 1.35, taxPercent: 10, accessoryPrice: 10 })).toBe(124.69);
    expect(comboTotalCost({ baseCost: 100, packaging: 2, shipping: 1.35, taxPercent: 0, accessoryPrice: 10 })).toBe(113.35);
  });

  it('无电池组合不带充电器重量；产品重量为负按 0 兜底', () => {
    expect(comboShippingWeightKg({ productWeightKg: 1.2, batteryPackCount: 5, batteryCount: 0 })).toBe(1.2);
    expect(comboShippingWeightKg({ productWeightKg: -1 })).toBe(0);
  });

  it('体积重：外箱体积 ÷ 装箱数 ÷ 参数；实重与体积重取较大者', () => {
    // 包装尺寸文本解析：× / x / * 都认，带 cm 也认；缺一维或非数字返回 null。
    expect(parsePackagingVolumeCm3('40×30×25')).toBe(30000);
    expect(parsePackagingVolumeCm3('40x30x25')).toBe(30000);
    expect(parsePackagingVolumeCm3('40*30*25 cm')).toBe(30000);
    expect(parsePackagingVolumeCm3(' 47 × 48 × 36 ')).toBe(81216);
    expect(parsePackagingVolumeCm3('40×30')).toBeNull();
    expect(parsePackagingVolumeCm3('')).toBeNull();
    expect(parsePackagingVolumeCm3('abc')).toBeNull();

    // 单台体积重 = 外箱体积 ÷ 装箱数 ÷ 参数；没体积数据时为 0（只按实重）。
    expect(volumetricWeightKg(120000, 8000, 10)).toBe(1.5);
    expect(volumetricWeightKg(120000, 8000, 1)).toBe(15);
    expect(volumetricWeightKg(30000, 6000, 10)).toBe(0.5);
    expect(volumetricWeightKg(null, 8000, 10)).toBe(0);

    // 计费重量取大者。
    expect(chargeableWeightKg(0.5, 1.5)).toBe(1.5);
    expect(chargeableWeightKg(2, 1.5)).toBe(2);
    expect(chargeableWeightKg(0.9, 0)).toBe(0.9);

    // 参数清洗：默认 8000，越界夹紧，非法值回落。
    expect(DEFAULT_VOLUME_DIVISOR).toBe(8000);
    expect(normalizeVolumeDivisor(6000)).toBe(6000);
    expect(normalizeVolumeDivisor(0)).toBe(VOLUME_DIVISOR_MIN);
    expect(normalizeVolumeDivisor(99999)).toBe(VOLUME_DIVISOR_MAX);
    expect(normalizeVolumeDivisor('abc')).toBe(DEFAULT_VOLUME_DIVISOR);
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
      volumeDivisor: 6000,
    });
    expect(params.shippingMode).toBe('auto');
    expect(params.shippingUnitPrice).toBe(1.5);
    expect(params.volumeDivisor).toBe(6000);
    // 旧方案（没有这些字段）：模式回落到手动、运费保持原值、单价与体积参数补默认。
    const legacy = normalizePricePlanParams({ baseCost: 100, shipping: 7.5 });
    expect(legacy.shippingMode).toBe('manual');
    expect(legacy.shipping).toBe(7.5);
    expect(legacy.shippingUnitPrice).toBe(DEFAULT_SHIPPING_UNIT_PRICE);
    expect(legacy.volumeDivisor).toBe(DEFAULT_VOLUME_DIVISOR);
    // 非法模式值一律按手动。
    expect(normalizePricePlanParams({ shippingMode: 'weird' }).shippingMode).toBe('manual');
  });

  it('参数快照记包装与其他费用：旧方案不带这些字段时保持缺省', () => {
    const params = normalizePricePlanParams({
      packaging: 3.2,
      otherCost: 10,
      packagingId: ' pack-2 ',
      packagingName: ' 大箱 ',
    });
    expect(params.packaging).toBe(3.2);
    expect(params.otherCost).toBe(10);
    expect(params.packagingId).toBe('pack-2');
    expect(params.packagingName).toBe('大箱');
    // 旧方案没存过：不凭空写出字段，载入端按老口径折算。
    const legacy = normalizePricePlanParams({ packaging: 5 });
    expect('otherCost' in legacy).toBe(false);
    expect('packagingId' in legacy).toBe(false);
    expect('packagingName' in legacy).toBe(false);
  });

  it('参数快照记配件选择：按名称去空去重；旧方案不带该字段', () => {
    const params = normalizePricePlanParams({
      baseCost: 100,
      accessoryNames: [' 套筒 ', '', '套筒', 42, '说明书'],
    });
    expect(params.accessoryNames).toEqual(['套筒', '说明书']);
    // 明确「一个都不选」存空数组；旧方案没这个字段时保持缺省（载入按全选）。
    expect(normalizePricePlanParams({ accessoryNames: [] }).accessoryNames).toEqual([]);
    expect('accessoryNames' in normalizePricePlanParams({ baseCost: 100 })).toBe(false);
    expect('accessoryNames' in normalizePricePlanParams({ accessoryNames: '套筒' })).toBe(false);
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

  it('配件重量：保留两位、非法/负数归零、0 不写出；合计价格与重量', () => {
    expect(normalizeAccessoryPrices([
      { name: '套筒', price: 10, weight: 0.456 },
      { name: '扳手', price: 5, weight: -1 },
      { name: '钻头', price: 3, weight: 0 },
      { name: '锯片', price: 2, weight: 99999 },
    ])).toEqual([
      { id: 'acc-0', name: '套筒', price: 10, weight: 0.46 },
      { id: 'acc-1', name: '扳手', price: 5 },
      { id: 'acc-2', name: '钻头', price: 3 },
      { id: 'acc-3', name: '锯片', price: 2, weight: 1000 },
    ]);
    expect(accessoryTotals([
      { id: '1', name: '套筒', price: 10, weight: 0.46 },
      { id: '2', name: '扳手', price: 5.5, weight: 0.2 },
    ])).toEqual({ price: 15.5, weight: 0.66 });
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

  it('电池矩阵：旧版行/列隐藏字段读取时直接丢弃（眼睛功能已移除）', () => {
    const cleaned = normalizeBatteryMatrix({
      capacities: [1100, 1300],
      packCounts: [3, 5],
      prices: [[7, 8], [9, 10]],
      capacityHidden: ['yes', true],
      packCountHidden: [false, true],
      capacityScopes: [['电钻'], []],
      packCountScopes: [[], ['扳手']],
    });
    expect(cleaned).toEqual({
      capacities: [1100, 1300],
      packCounts: [3, 5],
      prices: [[7, 8], [9, 10]],
    });
    expect(Object.keys(cleaned)).toEqual(['capacities', 'packCounts', 'prices']);
  });

  it('电池矩阵排序：移动容量行/节数列时价格跟着走', () => {
    const matrix = normalizeBatteryMatrix({
      capacities: [1100, 1300, 1500],
      packCounts: [3, 5, 10],
      prices: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    });

    // 把 10 节列从最后移到最前：每一行的价格跟着列走。
    const movedColumn = moveBatteryPackCount(matrix, 2, 0);
    expect(movedColumn.packCounts).toEqual([10, 3, 5]);
    expect(movedColumn.prices).toEqual([[3, 1, 2], [6, 4, 5], [9, 7, 8]]);

    // 容量行同理：整行价格一起移动。
    const movedRow = moveBatteryCapacity(movedColumn, 1, 2);
    expect(movedRow.capacities).toEqual([1100, 1500, 1300]);
    expect(movedRow.prices).toEqual([[3, 1, 2], [9, 7, 8], [6, 4, 5]]);

    // 越界不动。
    expect(moveBatteryCapacity(matrix, 0, -1)).toBe(matrix);
    expect(moveBatteryPackCount(matrix, 2, 3)).toBe(matrix);
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
