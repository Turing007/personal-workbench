import type { PaymentStatus } from './documents.js';

const CENTS_PER_YUAN = 100;
const BASIS_POINTS_PER_RATE = 10_000;
const UPPERCASE_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const GROUP_UNITS = ['', '万', '亿', '兆', '京'];

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label}必须是有效数字`);
}

function assertNonNegativeCents(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label}必须是整数分`);
  if (value < 0) throw new RangeError(`${label}不能小于 0`);
}

function assertQuantity(quantity: number): void {
  assertFiniteNumber(quantity, '数量');
  if (quantity < 0) throw new RangeError('数量不能小于 0');
}

export function yuanToCents(value: number): number {
  assertFiniteNumber(value, '金额');
  const cents = Math.round((value + Number.EPSILON) * CENTS_PER_YUAN);
  assertNonNegativeCents(cents, '金额');
  return cents;
}

export function centsToYuan(value: number): number {
  assertNonNegativeCents(value, '金额');
  return value / CENTS_PER_YUAN;
}

export function calculateLineAmountCents(quantity: number, unitPriceCents: number): number {
  assertQuantity(quantity);
  assertNonNegativeCents(unitPriceCents, '单价');
  const amount = Math.round(quantity * unitPriceCents);
  assertNonNegativeCents(amount, '行金额');
  return amount;
}

export function calculateDocumentTotals(
  lines: readonly { quantity: number; unitPriceCents: number }[],
  taxRateBps: number,
  shippingCents = 0,
): { subtotalCents: number; taxCents: number; shippingCents: number; totalCents: number } {
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > BASIS_POINTS_PER_RATE) {
    throw new RangeError('税率基点必须在 0 到 10000 之间');
  }
  assertNonNegativeCents(shippingCents, '运费');
  const subtotalCents = lines.reduce(
    (subtotal, line) => subtotal + calculateLineAmountCents(line.quantity, line.unitPriceCents),
    0,
  );
  if (!Number.isSafeInteger(subtotalCents)) throw new RangeError('合计金额超出安全范围');
  const roundedTax =
    (BigInt(subtotalCents) * BigInt(taxRateBps) + BigInt(BASIS_POINTS_PER_RATE / 2)) /
    BigInt(BASIS_POINTS_PER_RATE);
  const taxCents = Number(roundedTax);
  if (!Number.isSafeInteger(taxCents)) throw new RangeError('税额超出安全范围');
  const totalCents = subtotalCents + taxCents + shippingCents;
  if (!Number.isSafeInteger(totalCents)) throw new RangeError('合计金额超出安全范围');
  return { subtotalCents, taxCents, shippingCents, totalCents };
}

export function calculateOutstandingCents(totalCents: number, receivedCents: number): number {
  assertNonNegativeCents(totalCents, '应付金额');
  assertNonNegativeCents(receivedCents, '已收金额');
  return Math.max(0, totalCents - receivedCents);
}

export function derivePaymentStatus(totalCents: number, receivedCents: number): PaymentStatus {
  assertNonNegativeCents(totalCents, '应付金额');
  assertNonNegativeCents(receivedCents, '已收金额');
  if (receivedCents >= totalCents) return 'paid';
  if (receivedCents > 0) return 'partial';
  return 'unpaid';
}

function convertFourDigits(value: number): string {
  const digits = [Math.floor(value / 1000) % 10, Math.floor(value / 100) % 10, Math.floor(value / 10) % 10, value % 10];
  const units = ['仟', '佰', '拾', ''];
  let result = '';
  let zeroPending = false;
  digits.forEach((digit, index) => {
    if (digit === 0) {
      if (result) zeroPending = true;
      return;
    }
    if (zeroPending) result += '零';
    result += UPPERCASE_DIGITS[digit] + units[index];
    zeroPending = false;
  });
  return result;
}

function integerToChinese(value: bigint): string {
  if (value === 0n) return '零';
  const groups: number[] = [];
  let remaining = value;
  while (remaining > 0n) {
    groups.unshift(Number(remaining % 10_000n));
    remaining /= 10_000n;
  }
  if (groups.length > GROUP_UNITS.length) throw new RangeError('金额超出中文大写支持范围');

  let result = '';
  let zeroGroupPending = false;
  groups.forEach((group, index) => {
    if (group === 0) {
      if (result) zeroGroupPending = true;
      return;
    }
    if (result && (zeroGroupPending || group < 1000)) result += '零';
    result += convertFourDigits(group) + GROUP_UNITS[groups.length - index - 1];
    zeroGroupPending = false;
  });
  return result;
}

export function centsToChineseUppercase(cents: number): string {
  assertNonNegativeCents(cents, '金额');
  const value = BigInt(cents);
  const integerPart = value / 100n;
  const decimalPart = Number(value % 100n);
  const jiao = Math.floor(decimalPart / 10);
  const fen = decimalPart % 10;
  let result = `${integerToChinese(integerPart)}元`;
  if (jiao > 0) result += `${UPPERCASE_DIGITS[jiao]}角`;
  if (fen > 0) {
    if (jiao === 0) result += '零';
    result += `${UPPERCASE_DIGITS[fen]}分`;
  }
  return jiao === 0 && fen === 0 ? `${result}整` : result;
}
