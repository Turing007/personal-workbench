import { describe, expect, it } from 'vitest';
import {
  PackingError,
  autoPack,
  canMergeBoxes,
  mergeBoxes,
  renumberBoxes,
} from '../../src/shared/packing';

describe('autoPack', () => {
  it('支持多装箱数动态规划并优先最少箱数', () => {
    const tailPlan = autoPack({ quantity: 53, packSizes: [10, 15, 20] });
    expect(tailPlan.map((box) => box.quantity)).toEqual([20, 20, 13]);
    expect(tailPlan.map((box) => box.isTail)).toEqual([false, false, true]);

    const exactPlan = autoPack({ quantity: 45, packSizes: [10, 15, 20] });
    expect(exactPlan.map((box) => box.quantity)).toEqual([20, 15, 10]);
    expect(exactPlan.every((box) => !box.isTail)).toBe(true);
  });

  it('尾数箱保留标准容量与当前实际数量的区别', () => {
    const boxes = autoPack({ quantity: 53, packSizes: [10, 15, 20] });
    const tail = boxes.at(-1)!;
    expect(tail.isTail).toBe(true);
    expect(tail.packSize).toBe(20);
    expect(tail.quantity).toBe(13);
    expect(tail.tailItems?.[0]?.quantity).toBe(13);
  });
  it('可按订单合并不同 SKU 的尾数并保留多行', () => {
    const boxes = autoPack([
      { id: 'line-a', orderId: 'order-1', productName: 'A', sku: 'A', spec: 'S', quantity: 5, packSizes: [3] },
      { id: 'line-b', orderId: 'order-1', productName: 'B', sku: 'B', spec: 'S', quantity: 5, packSizes: [3] },
    ], { mergeTail: true });
    const tail = boxes.find((box) => box.isTail);
    expect(tail?.quantity).toBe(3);
    expect(tail?.tailItems?.map((item) => [item.sku, item.quantity])).toEqual([['A', 2], ['B', 1]]);
  });

  it('多产品尾数超过一箱容量时拆分并保持各产品数量守恒', () => {
    const boxes = autoPack([
      { id: 'line-a', orderId: 'order-1', productName: 'A', sku: 'A', spec: 'S', quantity: 5, packSizes: [3] },
      { id: 'line-b', orderId: 'order-1', productName: 'B', sku: 'B', spec: 'S', quantity: 5, packSizes: [3] },
    ], { mergeTail: true });
    expect(boxes).toHaveLength(4);
    expect(boxes.filter((box) => box.isTail).every((box) => (box.tailItems?.reduce((sum, line) => sum + line.quantity, 0) ?? 0) <= 3)).toBe(true);
    expect(boxes.filter((box) => box.sku === 'A' || box.tailItems?.some((line) => line.sku === 'A')).reduce((sum, box) => sum + (box.tailItems?.filter((line) => line.sku === 'A').reduce((lineSum, line) => lineSum + line.quantity, 0) ?? (box.sku === 'A' ? box.quantity : 0)), 0)).toBe(5);
    expect(boxes.filter((box) => box.sku === 'B' || box.tailItems?.some((line) => line.sku === 'B')).reduce((sum, box) => sum + (box.tailItems?.filter((line) => line.sku === 'B').reduce((lineSum, line) => lineSum + line.quantity, 0) ?? (box.sku === 'B' ? box.quantity : 0)), 0)).toBe(5);
  });
  it('优先使用较大的装箱数，并准确生成尾箱', () => {
    const boxes = autoPack({ quantity: 100, packSizes: [12, 24] });

    expect(boxes.map((box) => box.quantity)).toEqual([24, 24, 24, 24, 4]);
    expect(boxes.every((box) => box.packSize === 24)).toBe(true);
    expect(boxes.at(-1)?.isTail).toBe(true);
    expect(boxes.reduce((total, box) => total + box.quantity, 0)).toBe(100);
  });


  it('分别为不同规格装箱，不把不同规格合并到同一箱', () => {
    const boxes = autoPack([
      { id: 'line-a', productName: '电钻', sku: 'DRILL', spec: '12V', quantity: 25, packSizes: [12] },
      { id: 'line-b', productName: '电钻', sku: 'DRILL', spec: '20V', quantity: 13, packSizes: [12] },
    ]);

    expect(boxes.map((box) => [box.spec, box.quantity])).toEqual([
      ['12V', 12],
      ['12V', 12],
      ['12V', 1],
      ['20V', 12],
      ['20V', 1],
    ]);
    expect(boxes.filter((box) => box.spec === '12V').every((box) => box.sku === 'DRILL')).toBe(true);
    expect(boxes.filter((box) => box.spec === '20V').every((box) => box.sku === 'DRILL')).toBe(true);
  });

  it('SKU 为空时品名不同也分别装箱，不按规格合并', () => {
    const boxes = autoPack([
      { id: 'line-a', orderId: 'order-1', productName: '扳手', sku: '', spec: '8寸', quantity: 5, packSizes: [3] },
      { id: 'line-b', orderId: 'order-1', productName: '套筒', sku: '', spec: '8寸', quantity: 4, packSizes: [3] },
    ]);

    expect(boxes.map((box) => [box.productName, box.quantity])).toEqual([
      ['扳手', 3],
      ['扳手', 2],
      ['套筒', 3],
      ['套筒', 1],
    ]);
  });

  it('合并同一订单内相同 SKU 和规格的多行数量', () => {
    const boxes = autoPack([
      { id: 'line-a', orderId: 'order-1', productName: '电钻', sku: 'DRILL', spec: '12V', quantity: 7, packSizes: [12] },
      { id: 'line-b', orderId: 'order-1', productName: '电钻', sku: 'DRILL', spec: '12V', quantity: 8, packSizes: [12] },
    ]);

    expect(boxes).toHaveLength(2);
    expect(boxes.map((box) => box.quantity)).toEqual([12, 3]);
    expect(boxes[0]?.sourceItemIds).toEqual(['line-a', 'line-b']);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fraction', 1.5],
  ])('数量为%s时抛出 PackingError', (_caseName, quantity) => {
    expect(() => autoPack({ quantity, packSizes: [12] })).toThrow(PackingError);
  });
});

describe('manual box merging', () => {
  const boxA = autoPack({
    id: 'line-a',
    orderId: 'order-1',
    productName: '电钻',
    sku: 'DRILL',
    spec: '12V',
    quantity: 4,
    packSizes: [12],
  })[0]!;
  const boxB = autoPack({
    id: 'line-b',
    orderId: 'order-1',
    productName: '电钻',
    sku: 'DRILL',
    spec: '12V',
    quantity: 5,
    packSizes: [12],
  })[0]!;
  const differentSpecBox = autoPack({
    id: 'line-c',
    orderId: 'order-1',
    productName: '电钻',
    sku: 'DRILL',
    spec: '20V',
    quantity: 2,
    packSizes: [12],
  })[0]!;

  const differentNameBox = autoPack({
    id: 'line-d',
    orderId: 'order-1',
    productName: '冲击电钻',
    sku: 'DRILL',
    spec: '12V',
    quantity: 2,
    packSizes: [12],
  })[0]!;

  it('只允许同一订单内相同 SKU、品名和规格的箱合并', () => {
    expect(canMergeBoxes([boxA, boxB])).toBe(true);
    expect(canMergeBoxes([boxA, differentSpecBox])).toBe(false);
    expect(canMergeBoxes([boxA, differentNameBox])).toBe(false);
  });

  it('合箱超过容量时拆成多个箱，并重新编号', () => {
    const merged = mergeBoxes([
      { ...boxA, quantity: 8, quantityInCarton: 8 },
      { ...boxB, quantity: 7, quantityInCarton: 7 },
    ]);

    expect(merged.map((box) => box.quantity)).toEqual([12, 3]);
    expect(merged.map((box) => box.cartonNo)).toEqual([1, 2]);
    expect(merged.every((box) => box.totalCartons === 2)).toBe(true);
    expect(merged.reduce((total, box) => total + box.quantity, 0)).toBe(15);
  });

  it('renumberBoxes会按当前数组顺序更新箱号和总箱数', () => {
    const renumbered = renumberBoxes([boxB, boxA]);

    expect(renumbered.map((box) => box.cartonNo)).toEqual([1, 2]);
    expect(renumbered.map((box) => box.totalCartons)).toEqual([2, 2]);
    expect(renumbered.map((box) => box.id)).toEqual([boxB.id, boxA.id]);
  });
});
