import { describe, expect, it } from 'vitest';
import {
  boxesForQuantity,
  buildShippingSheetLine,
  getOrderFulfillmentProgress,
  groupShippingOrders,
  normalizeRecipientKey,
  remainingQuantity,
} from '../../src/shared/shipping';

describe('订单发货进度', () => {
  it('未发货、部分发货和全部发完', () => {
    expect(getOrderFulfillmentProgress([{ quantity: 10, shippedQuantity: 0 }])).toMatchObject({
      shippedQuantity: 0, remainingQuantity: 10, isPartiallyShipped: false, isFullyShipped: false,
    });
    expect(getOrderFulfillmentProgress([{ quantity: 10, shippedQuantity: 4 }, { quantity: 5, shippedQuantity: 0 }])).toMatchObject({
      totalQuantity: 15, shippedQuantity: 4, remainingQuantity: 11, shippedItems: 0, isPartiallyShipped: true, isFullyShipped: false,
    });
    expect(getOrderFulfillmentProgress([{ quantity: 10, shippedQuantity: 10 }, { quantity: 5, shippedQuantity: 5 }])).toMatchObject({
      totalQuantity: 15, shippedQuantity: 15, remainingQuantity: 0, shippedItems: 2, isPartiallyShipped: false, isFullyShipped: true,
    });
  });

  it('已发数量不会超过订单数量', () => {
    expect(getOrderFulfillmentProgress([{ quantity: 3, shippedQuantity: 5 }])).toMatchObject({
      shippedQuantity: 3, remainingQuantity: 0, isFullyShipped: true,
    });
  });
});

describe('剩余数量与箱数折算', () => {
  it('剩余数量按订单数量减已发，最少 0', () => {
    expect(remainingQuantity({ quantity: 10, shippedQuantity: 4 })).toBe(6);
    expect(remainingQuantity({ quantity: 10, shippedQuantity: 10 })).toBe(0);
    expect(remainingQuantity({ quantity: 3, shippedQuantity: 5 })).toBe(0);
    expect(remainingQuantity({ quantity: 10 })).toBe(10);
  });

  it('本次数量按装箱数向上取整，0 件不发箱', () => {
    expect(boxesForQuantity(0, 10)).toBe(0);
    expect(boxesForQuantity(4, 10)).toBe(1);
    expect(boxesForQuantity(10, 10)).toBe(1);
    expect(boxesForQuantity(11, 10)).toBe(2);
    expect(boxesForQuantity(5, 0)).toBe(5);
  });
});

describe('发货中同地址合并', () => {
  const orders = [
    { id: 1, orderNo: 'SO-1', recipientName: '张三', recipientInfo: '深圳市 宝安区 A 栋' },
    { id: 2, orderNo: 'SO-2', recipientName: '张三', recipientInfo: '深圳市宝安区A栋' },
    { id: 3, orderNo: 'SO-3', recipientName: '李四', recipientInfo: '' },
    { id: 4, orderNo: 'SO-4', recipientName: '王五', recipientInfo: '广州市天河区' },
  ];

  it('地址去空白后相同就合并，空地址不合并', () => {
    expect(normalizeRecipientKey(' 深圳市\n宝安区 ')).toBe('深圳市宝安区');
    const groups = groupShippingOrders(orders);
    expect(groups.map((group) => group.orders.map((order) => order.orderNo))).toEqual([
      ['SO-1', 'SO-2'],
      ['SO-3'],
      ['SO-4'],
    ]);
    expect(groups[0]?.recipientInfo).toBe('深圳市 宝安区 A 栋');
  });

  it('拆开地址组后每单独立，且保持原顺序', () => {
    const groups = groupShippingOrders(orders, ['深圳市宝安区A栋']);
    expect(groups.map((group) => group.orders.map((order) => order.orderNo))).toEqual([
      ['SO-1'],
      ['SO-2'],
      ['SO-3'],
      ['SO-4'],
    ]);
    expect(groups[0]?.split).toBe(true);
    expect(groups[2]?.split).toBe(false);
  });

  it('组内按订单 ID 升序，箱数拆解不随列表倒序变化', () => {
    const groups = groupShippingOrders([...orders].reverse());
    const merged = groups.find((group) => group.orders.length === 2);
    expect(merged?.orders.map((order) => order.orderNo)).toEqual(['SO-1', 'SO-2']);
  });
});

describe('发货表行', () => {
  it('箱数保留每单拆解，单位只写在最后并附合计', () => {
    expect(buildShippingSheetLine({
      recipientName: '张三',
      recipientInfo: '深圳市宝安区 A 栋',
      entries: [{ boxes: 2 }, { boxes: 3 }, { boxes: 5 }],
    })).toBe('2+3+5=10箱 深圳市宝安区 A 栋');
  });

  it('单订单只显示自身箱数，0 箱不发一行', () => {
    expect(buildShippingSheetLine({ recipientName: '张三', entries: [{ boxes: 2 }] })).toBe('2箱 张三');
    expect(buildShippingSheetLine({ recipientName: '张三', entries: [{ boxes: 0 }] })).toBe('');
  });
});
