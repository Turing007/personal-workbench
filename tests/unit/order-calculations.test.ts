import { describe, expect, it } from 'vitest';
import { calculateOrderBoxes, sumOrderBoxes } from '../../src/shared/order-calculations';

describe('订单箱数计算', () => {
  it('按数量除以本单装箱数向上取整', () => {
    expect(calculateOrderBoxes(100, 24)).toBe(5);
    expect(calculateOrderBoxes(48, 24)).toBe(2);
    expect(calculateOrderBoxes(1, 24)).toBe(1);
  });

  it('拒绝非正整数数量或装箱数', () => {
    expect(() => calculateOrderBoxes(0, 24)).toThrow('数量必须是正整数');
    expect(() => calculateOrderBoxes(10, 0)).toThrow('装箱数必须是正整数');
    expect(() => calculateOrderBoxes(1.5, 24)).toThrow('数量必须是正整数');
  });

  it('多行订单总箱数是每行箱数之和', () => {
    expect(sumOrderBoxes([{ quantity: 100, packCount: 24 }, { quantity: 25, packCount: 12 }])).toBe(8);
  });
});
