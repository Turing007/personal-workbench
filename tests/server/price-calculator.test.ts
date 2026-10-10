import { describe, expect, it } from 'vitest';
import {
  normalizePricePlanItems,
  planItemAmount,
  planMargin,
  planSalePrice,
  planTotalCost,
  pricePlanMarkup,
  round2,
} from '../../src/shared/price-calculator';
import { normalizeAccessoryPrices } from '../../src/shared/accessory-prices';

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
});
