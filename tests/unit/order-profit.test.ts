import { describe, expect, it } from 'vitest';
import {
  ORDER_ITEM_COST_FIELDS,
  calculateOrderItemCostCents,
  calculateOrderProfit,
  normalizeOptionalCostCents,
  orderItemUnitCostCents,
  type OrderItemCostInput,
} from '../../src/shared/order-profit';

function makeItem(overrides: Partial<OrderItemCostInput> = {}): OrderItemCostInput {
  return {
    quantity: 1,
    machineCostCents: 1000,
    batteryCostCents: 200,
    chargerCostCents: 50,
    packagingCostCents: 30,
    accessoryCostCents: 20,
    otherCostCents: 5,
    costConfirmed: true,
    ...overrides,
  };
}

describe('订单利润计算', () => {
  it('订单行成本字段按固定顺序导出', () => {
    expect(ORDER_ITEM_COST_FIELDS).toEqual([
      'machineCostCents',
      'batteryCostCents',
      'chargerCostCents',
      'packagingCostCents',
      'accessoryCostCents',
      'otherCostCents',
    ]);
  });

  it('只把 null 和空字符串视为空成本，并拒绝非法分金额', () => {
    expect(normalizeOptionalCostCents(null)).toBeNull();
    expect(normalizeOptionalCostCents('')).toBeNull();
    expect(normalizeOptionalCostCents(0)).toBe(0);
    expect(normalizeOptionalCostCents(1999)).toBe(1999);

    expect(() => normalizeOptionalCostCents(-1)).toThrow();
    expect(() => normalizeOptionalCostCents(1.5)).toThrow();
    expect(() => normalizeOptionalCostCents(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => normalizeOptionalCostCents(Number.NaN)).toThrow();
    expect(() => normalizeOptionalCostCents('100')).toThrow();
  });

  it('已确认行把空成本按 0 汇总，未确认行返回 null', () => {
    expect(orderItemUnitCostCents(makeItem())).toBe(1305);
    expect(
      orderItemUnitCostCents(
        makeItem({
          batteryCostCents: null,
          chargerCostCents: '',
          packagingCostCents: null,
          accessoryCostCents: '',
          otherCostCents: '',
        }),
      ),
    ).toBe(1000);
    expect(orderItemUnitCostCents(makeItem({ costConfirmed: false }))).toBeNull();
    expect(
      orderItemUnitCostCents(
        makeItem({
          machineCostCents: null,
          batteryCostCents: null,
          chargerCostCents: null,
          packagingCostCents: null,
          accessoryCostCents: null,
          otherCostCents: null,
        }),
      ),
    ).toBe(0);
  });

  it('按数量计算订单行成本，未确认时不算 0', () => {
    expect(calculateOrderItemCostCents(makeItem({ quantity: 3 }))).toBe(3915);
    expect(calculateOrderItemCostCents(makeItem({ quantity: 2, costConfirmed: false }))).toBeNull();
    expect(
      calculateOrderItemCostCents(
        makeItem({
          quantity: 4,
          machineCostCents: 0,
          batteryCostCents: null,
          chargerCostCents: '',
          packagingCostCents: null,
          accessoryCostCents: '',
          otherCostCents: '',
        }),
      ),
    ).toBe(0);
  });

  it('成本完整时汇总商品、物流和其他整单费用并计算毛利', () => {
    const result = calculateOrderProfit({
      amountCents: 5000,
      items: [
        makeItem({ quantity: 2 }),
        makeItem({
          quantity: 1,
          machineCostCents: 500,
          batteryCostCents: null,
          chargerCostCents: null,
          packagingCostCents: null,
          accessoryCostCents: null,
          otherCostCents: null,
        }),
      ],
      logisticsCostCents: 200,
      labelCostCents: 10,
      otherCostCents: 80,
      costConfirmed: true,
    });

    expect(result).toEqual({
      costComplete: true,
      itemCostCents: 3110,
      recordedItemCostCents: 3110,
      totalCostCents: 3400,
      profitCents: 1600,
      marginPercent: 32,
      missingItemCount: 0,
    });
  });

  it('部分行未确认时整单不完整，但保留已确认行成本', () => {
    const result = calculateOrderProfit({
      amountCents: 5000,
      items: [
        makeItem({ quantity: 2 }),
        makeItem({
          quantity: 1,
          machineCostCents: 900,
          costConfirmed: false,
        }),
      ],
      logisticsCostCents: 200,
      otherCostCents: 80,
      costConfirmed: true,
    });

    expect(result).toEqual({
      costComplete: false,
      itemCostCents: null,
      recordedItemCostCents: 2610,
      totalCostCents: null,
      profitCents: null,
      marginPercent: null,
      missingItemCount: 1,
    });
  });

  it('订单级未确认时整单同样不完整', () => {
    const result = calculateOrderProfit({
      amountCents: 5000,
      items: [makeItem({ quantity: 2 })],
      logisticsCostCents: 0,
      otherCostCents: null,
      costConfirmed: false,
    });

    expect(result).toEqual({
      costComplete: false,
      itemCostCents: null,
      recordedItemCostCents: 2610,
      totalCostCents: null,
      profitCents: null,
      marginPercent: null,
      missingItemCount: 0,
    });
  });

  it('允许负毛利，订单级空费用在确认后按 0 计算', () => {
    const result = calculateOrderProfit({
      amountCents: 1000,
      items: [makeItem({ quantity: 1, machineCostCents: 1500 })],
      logisticsCostCents: null,
      labelCostCents: 5,
      otherCostCents: '',
      costConfirmed: true,
    });

    expect(result).toEqual({
      costComplete: true,
      itemCostCents: 1805,
      recordedItemCostCents: 1805,
      totalCostCents: 1810,
      profitCents: -810,
      marginPercent: -81,
      missingItemCount: 0,
    });
  });

  it('毛利率保留一位小数，收入不大于 0 时为 null', () => {
    expect(
      calculateOrderProfit({
        amountCents: 700,
        items: [
          makeItem({
            machineCostCents: 100,
            batteryCostCents: null,
            chargerCostCents: null,
            packagingCostCents: null,
            accessoryCostCents: null,
            otherCostCents: null,
          }),
        ],
        costConfirmed: true,
      }).marginPercent,
    ).toBe(85.7);

    expect(
      calculateOrderProfit({
        amountCents: 0,
        items: [makeItem({ machineCostCents: 100 })],
        costConfirmed: true,
      }).marginPercent,
    ).toBeNull();
  });
});
