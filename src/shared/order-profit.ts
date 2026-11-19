export const ORDER_ITEM_COST_FIELDS = [
  'machineCostCents',
  'batteryCostCents',
  'chargerCostCents',
  'packagingCostCents',
  'accessoryCostCents',
  'otherCostCents',
] as const;

export type OrderItemCostField = (typeof ORDER_ITEM_COST_FIELDS)[number];
export type CostCentsInput = number | string | null | undefined;

export type OrderItemCostFieldsInput = {
  [Field in OrderItemCostField]?: CostCentsInput;
} & {
  costConfirmed?: boolean;
};

export interface OrderItemCostInput extends OrderItemCostFieldsInput {
  quantity: number;
}

export interface OrderProfitInput {
  amountCents: number;
  items: readonly OrderItemCostInput[];
  logisticsCostCents?: CostCentsInput;
  labelCostCents?: CostCentsInput;
  otherCostCents?: CostCentsInput;
  costConfirmed?: boolean;
}

export interface OrderProfitSummary {
  costComplete: boolean;
  itemCostCents: number | null;
  recordedItemCostCents: number;
  totalCostCents: number | null;
  profitCents: number | null;
  marginPercent: number | null;
  missingItemCount: number;
}

function assertSafeCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label}必须是安全整数分`);
  }
}

function addSafeCents(total: number, value: number, label: string): number {
  const next = total + value;
  assertSafeCents(next, label);
  return next;
}

function assertQuantity(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('数量必须是正整数');
  }
}

function roundToOneDecimal(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

export function normalizeOptionalCostCents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('成本必须是非负安全整数分');
  }
  return value;
}

export function orderItemUnitCostCents(item: OrderItemCostFieldsInput): number | null {
  if (item.costConfirmed !== true) return null;

  let total = 0;
  for (const field of ORDER_ITEM_COST_FIELDS) {
    const cost = normalizeOptionalCostCents(item[field]) ?? 0;
    total = addSafeCents(total, cost, '单件成本合计');
  }
  return total;
}

export function calculateOrderItemCostCents(item: OrderItemCostInput): number | null {
  const unitCostCents = orderItemUnitCostCents(item);
  if (unitCostCents === null) return null;

  assertQuantity(item.quantity);
  const lineCostCents = unitCostCents * item.quantity;
  assertSafeCents(lineCostCents, '订单行成本');
  return lineCostCents;
}

export function calculateOrderProfit(input: OrderProfitInput): OrderProfitSummary {
  assertSafeCents(input.amountCents, '订单金额');

  const logisticsCostCents = normalizeOptionalCostCents(input.logisticsCostCents);
  const labelCostCents = normalizeOptionalCostCents(input.labelCostCents);
  const otherCostCents = normalizeOptionalCostCents(input.otherCostCents);

  let recordedItemCostCents = 0;
  let missingItemCount = 0;

  for (const item of input.items) {
    const itemCostCents = calculateOrderItemCostCents(item);
    if (itemCostCents === null) {
      missingItemCount += 1;
      continue;
    }
    recordedItemCostCents = addSafeCents(
      recordedItemCostCents,
      itemCostCents,
      '已确认行成本合计',
    );
  }

  const costComplete = missingItemCount === 0 && input.costConfirmed === true;
  if (!costComplete) {
    return {
      costComplete: false,
      itemCostCents: null,
      recordedItemCostCents,
      totalCostCents: null,
      profitCents: null,
      marginPercent: null,
      missingItemCount,
    };
  }

  const itemCostCents = recordedItemCostCents;
  let totalCostCents = addSafeCents(
    itemCostCents,
    logisticsCostCents ?? 0,
    '订单总成本',
  );
  totalCostCents = addSafeCents(totalCostCents, labelCostCents ?? 0, '订单总成本');
  totalCostCents = addSafeCents(totalCostCents, otherCostCents ?? 0, '订单总成本');

  const profitCents = input.amountCents - totalCostCents;
  assertSafeCents(profitCents, '订单利润');

  return {
    costComplete: true,
    itemCostCents,
    recordedItemCostCents,
    totalCostCents,
    profitCents,
    marginPercent:
      input.amountCents > 0
        ? roundToOneDecimal((profitCents / input.amountCents) * 100)
        : null,
    missingItemCount,
  };
}
