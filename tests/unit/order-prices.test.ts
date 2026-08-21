import { describe, expect, it } from 'vitest';
import { calculateFreightCents, calculateOrderAmountCents, calculateOrderTotalCents } from '../../src/shared/order-prices';

describe('订单金额计算', () => {
  it('按每行数量乘以单价后汇总订单总额', () => {
    expect(calculateOrderTotalCents([
      { quantity: 2, unitPriceCents: 1299 },
      { quantity: 3, unitPriceCents: 2500 },
    ])).toBe(10098);
  });

  it('没有价格的产品按 0 元计入，保证录单时总额可实时显示', () => {
    expect(calculateOrderTotalCents([
      { quantity: 5, unitPriceCents: 0 },
      { quantity: 1, unitPriceCents: 1999 },
    ])).toBe(1999);
  });

  it('拒绝非正整数数量和负单价', () => {
    expect(() => calculateOrderTotalCents([{ quantity: 0, unitPriceCents: 100 }])).toThrow('数量必须是正整数');
    expect(() => calculateOrderTotalCents([{ quantity: 1, unitPriceCents: -1 }])).toThrow('单价不能小于 0');
  });

  it('按箱数汇总每箱运费', () => {
    expect(calculateFreightCents([
      { boxes: 2, freightPerBoxCents: 350 },
      { boxes: 3, freightPerBoxCents: 100 },
      { boxes: 1, freightPerBoxCents: null },
    ])).toBe(1000);
  });

  it('拒绝负数箱数或运费', () => {
    expect(() => calculateFreightCents([{ boxes: -1, freightPerBoxCents: 100 }])).toThrow('箱数和运费必须是非负整数');
  });

  it('订单金额 = 产品金额 + 运费', () => {
    const items = [{ quantity: 2, unitPriceCents: 1299 }];
    expect(calculateOrderAmountCents(items)).toBe(2598);
    expect(calculateOrderAmountCents(items, 1500)).toBe(4098);
  });

  it('拒绝负数或非整数运费', () => {
    expect(() => calculateOrderAmountCents([{ quantity: 1, unitPriceCents: 100 }], -1)).toThrow('运费必须是非负整数分');
    expect(() => calculateOrderAmountCents([{ quantity: 1, unitPriceCents: 100 }], 12.5)).toThrow('运费必须是非负整数分');
  });
});
