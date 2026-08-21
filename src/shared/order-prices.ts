import { calculateLineAmountCents } from './money.js';

export interface OrderPriceInput {
  quantity: number;
  unitPriceCents: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}必须是正整数`);
  }
}

export function calculateOrderLineAmountCents({ quantity, unitPriceCents }: OrderPriceInput): number {
  assertPositiveInteger(quantity, '数量');
  return calculateLineAmountCents(quantity, unitPriceCents);
}

export function calculateOrderTotalCents(items: readonly OrderPriceInput[]): number {
  const total = items.reduce(
    (sum, item) => sum + calculateOrderLineAmountCents(item),
    0,
  );
  if (!Number.isSafeInteger(total)) throw new RangeError('订单总额超出安全范围');
  return total;
}

export interface FreightInput {
  boxes: number;
  freightPerBoxCents?: number | null;
}

export function calculateFreightCents(items: readonly FreightInput[]): number {
  const total = items.reduce((sum, item) => {
    const freight = item.freightPerBoxCents ?? 0;
    if (!Number.isSafeInteger(item.boxes) || item.boxes < 0 || !Number.isSafeInteger(freight) || freight < 0) {
      throw new RangeError('箱数和运费必须是非负整数');
    }
    return sum + item.boxes * freight;
  }, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError('运费超出安全范围');
  return total;
}

export function calculateOrderAmountCents(items: readonly OrderPriceInput[], shippingCents = 0): number {
  if (!Number.isSafeInteger(shippingCents) || shippingCents < 0) {
    throw new RangeError('运费必须是非负整数分');
  }
  const amount = calculateOrderTotalCents(items) + shippingCents;
  if (!Number.isSafeInteger(amount)) throw new RangeError('订单总额超出安全范围');
  return amount;
}
