export interface OrderBoxInput {
  quantity: number;
  packCount: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}必须是正整数`);
  }
}

export function calculateOrderBoxes(quantity: number, packCount: number): number {
  assertPositiveInteger(quantity, '数量');
  assertPositiveInteger(packCount, '装箱数');
  return Math.ceil(quantity / packCount);
}

export function sumOrderBoxes(items: readonly OrderBoxInput[]): number {
  return items.reduce(
    (total, item) => total + calculateOrderBoxes(item.quantity, item.packCount),
    0,
  );
}
