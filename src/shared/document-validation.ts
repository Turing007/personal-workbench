export interface DocumentLineValidationInput {
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export class DocumentValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'DocumentValidationError';
  }
}

function requireFiniteNumber(value: number, message: string, field: string): void {
  if (!Number.isFinite(value)) throw new DocumentValidationError(message, field);
}

export function validateDocumentLines(lines: readonly DocumentLineValidationInput[]): void {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new DocumentValidationError('至少需要一行产品', 'items');
  }

  lines.forEach((line, index) => {
    const fieldPrefix = `items.${index}`;
    if (typeof line.name !== 'string' || !line.name.trim()) {
      throw new DocumentValidationError('产品名称不能为空', `${fieldPrefix}.name`);
    }
    requireFiniteNumber(line.quantity, '数量必须是有效数字', `${fieldPrefix}.quantity`);
    if (line.quantity < 0) {
      throw new DocumentValidationError('数量不能小于 0', `${fieldPrefix}.quantity`);
    }
    requireFiniteNumber(line.unitPriceCents, '单价必须是有效数字', `${fieldPrefix}.unitPriceCents`);
    if (!Number.isSafeInteger(line.unitPriceCents)) {
      throw new DocumentValidationError('单价必须是整数分', `${fieldPrefix}.unitPriceCents`);
    }
    if (line.unitPriceCents < 0) {
      throw new DocumentValidationError('单价不能小于 0', `${fieldPrefix}.unitPriceCents`);
    }
  });
}

export function validateTaxRateBps(taxRateBps: number): number {
  if (!Number.isFinite(taxRateBps) || !Number.isInteger(taxRateBps)) {
    throw new DocumentValidationError('税率必须是整数基点', 'taxRateBps');
  }
  if (taxRateBps < 0) throw new DocumentValidationError('税率不能小于 0', 'taxRateBps');
  if (taxRateBps > 10_000) throw new DocumentValidationError('税率不能超过 100%', 'taxRateBps');
  return taxRateBps;
}

export function validateNonNegativeCents(value: number, field: string, label = '金额'): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new DocumentValidationError(`${label}必须是整数分`, field);
  }
  if (value < 0) throw new DocumentValidationError(`${label}不能小于 0`, field);
  return value;
}

export function validateReceiptAmount(amountCents: number): number {
  return validateNonNegativeCents(amountCents, 'amountCents', '收款金额');
}
