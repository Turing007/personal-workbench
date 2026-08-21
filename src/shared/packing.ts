import type { OrderItemSnapshot } from './domain.js';

export class PackingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_QUANTITY'
      | 'INVALID_PACK_SIZE'
      | 'EMPTY_INPUT'
      | 'INCOMPATIBLE_BOXES',
  ) {
    super(message);
    this.name = 'PackingError';
  }
}

export interface PackItemInput {
  id?: string;
  orderId?: string;
  orderNo?: string;
  recipientName?: string;
  productName?: string;
  sku?: string;
  spec?: string;
  quantity: number;
  packSizes: readonly number[];
  remark?: string;
  orderRemark?: string;
}

export type PackInput = PackItemInput | readonly PackItemInput[];

export interface PackedBoxLine {
  sourceItemId?: string;
  productName: string;
  sku: string;
  spec: string;
  quantity: number;
  packSize: number;
  boxCount: number;
  totalQuantity: number;
  remark?: string;
}

export interface PackedBox {
  id: string;
  orderId?: string;
  orderNo?: string;
  recipientName?: string;
  sourceItemIds: string[];
  productName: string;
  sku: string;
  spec: string;
  quantity: number;
  packSize: number;
  isTail: boolean;
  cartonNo: number;
  totalCartons: number;
  totalQuantity: number;
  boxCount?: number;
  remark?: string;
  productRemark?: string;
  orderRemark?: string;
  tailItems?: PackedBoxLine[];
}

export interface AutoPackOptions {
  mergeTail?: boolean;
}

interface PackingPlanEntry {
  quantity: number;
  packSize: number;
  isTail: boolean;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `box-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizePackSizes(packSizes: readonly number[]): number[] {
  if (!Array.isArray(packSizes) || packSizes.length === 0) {
    throw new PackingError('至少需要一个有效装箱数', 'INVALID_PACK_SIZE');
  }

  const unique = [...new Set(packSizes)];
  if (unique.some((size) => !Number.isInteger(size) || size <= 0)) {
    throw new PackingError('装箱数必须是正整数', 'INVALID_PACK_SIZE');
  }
  return unique.sort((left, right) => right - left);
}

function validateQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new PackingError('产品数量必须是正整数', 'INVALID_QUANTITY');
  }
}

function normalizeItems(input: PackInput): Array<PackItemInput & { id: string; packSizes: number[] }> {
  const items = Array.isArray(input) ? [...input] : [input];
  if (items.length === 0) throw new PackingError('至少需要一行产品', 'EMPTY_INPUT');

  return items.map((item, index) => {
    validateQuantity(item.quantity);
    return {
      ...item,
      id: item.id?.trim() || `line-${index + 1}`,
      orderId: item.orderId?.trim() || undefined,
      orderNo: item.orderNo?.trim() || undefined,
      recipientName: item.recipientName?.trim() || undefined,
      productName: item.productName?.trim() ?? '',
      sku: item.sku?.trim() ?? '',
      spec: item.spec?.trim() ?? '',
      remark: item.remark?.trim() || undefined,
      orderRemark: item.orderRemark?.trim() || undefined,
      packSizes: normalizePackSizes(item.packSizes),
    };
  });
}

interface PackingGroup {
  orderId?: string;
  orderNo?: string;
  recipientName?: string;
  sourceItemIds: string[];
  productName: string;
  sku: string;
  spec: string;
  quantity: number;
  packSizes: number[];
  remark?: string;
  orderRemark?: string;
}

function orderKey(group: { orderId?: string; orderNo?: string; recipientName?: string }): string {
  return `${group.orderId ?? ''}\u0000${group.orderNo ?? ''}\u0000${group.recipientName ?? ''}`;
}

function groupItems(items: Array<PackItemInput & { id: string; packSizes: number[] }>): PackingGroup[] {
  const groups = new Map<string, PackingGroup>();
  for (const item of items) {
    // SKU、品名、规格任一不同都视为不同产品，SKU 为空时也不跨品名合并。
    const key = `${orderKey(item)}\u0000${item.productName ?? ''}\u0000${item.sku}\u0000${item.spec}`;
    const current = groups.get(key);
    if (current) {
      current.quantity += item.quantity;
      current.sourceItemIds.push(item.id);
      current.packSizes = normalizePackSizes([...current.packSizes, ...item.packSizes]);
      if (!current.remark && item.remark) current.remark = item.remark;
      if (!current.orderRemark && item.orderRemark) current.orderRemark = item.orderRemark;
      continue;
    }
    groups.set(key, {
      orderId: item.orderId,
      orderNo: item.orderNo,
      recipientName: item.recipientName,
      sourceItemIds: [item.id],
      productName: item.productName ?? '',
      sku: item.sku ?? '',
      spec: item.spec ?? '',
      quantity: item.quantity,
      packSizes: [...item.packSizes],
      remark: item.remark,
      orderRemark: item.orderRemark,
    });
  }
  return [...groups.values()];
}

function compareSizePlans(left: number[], right: number[]): number {
  const sortedLeft = [...left].sort((a, b) => b - a);
  const sortedRight = [...right].sort((a, b) => b - a);
  for (let index = 0; index < Math.max(sortedLeft.length, sortedRight.length); index += 1) {
    const difference = (sortedLeft[index] ?? 0) - (sortedRight[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function reachablePlans(quantity: number, sizes: number[], boxCount: number): Map<number, number[]> {
  let current = new Map<number, number[]>([[0, []]]);
  for (let index = 0; index < boxCount; index += 1) {
    const next = new Map<number, number[]>();
    for (const [total, chosen] of current) {
      for (const size of sizes) {
        const nextTotal = total + size;
        if (nextTotal > quantity) continue;
        const nextPlan = [...chosen, size];
        const previous = next.get(nextTotal);
        if (!previous || compareSizePlans(nextPlan, previous) > 0) next.set(nextTotal, nextPlan);
      }
    }
    current = next;
  }
  return current;
}

/**
 * Finds the fewest-box plan. Exact standard-box combinations win over a plan
 * with a tail; otherwise the fullest possible standard boxes leave one tail.
 */
export function packingPlan(quantity: number, packSizes: readonly number[]): PackingPlanEntry[] {
  validateQuantity(quantity);
  const sizes = normalizePackSizes(packSizes);
  const maxSize = sizes[0]!;
  const maxBoxCount = Math.ceil(quantity / maxSize) + 1;

  for (let boxCount = 1; boxCount <= maxBoxCount; boxCount += 1) {
    const exact = reachablePlans(quantity, sizes, boxCount).get(quantity);
    if (exact) return exact.map((size) => ({ quantity: size, packSize: size, isTail: false }));

    if (boxCount === 1) {
      if (quantity <= maxSize) return [{ quantity, packSize: maxSize, isTail: true }];
      continue;
    }

    const standardPlans = reachablePlans(quantity, sizes, boxCount - 1);
    let best: { total: number; plan: number[] } | undefined;
    for (const [total, plan] of standardPlans) {
      const tail = quantity - total;
      if (tail <= 0 || tail > maxSize) continue;
      if (!best || total > best.total || (total === best.total && compareSizePlans(plan, best.plan) > 0)) {
        best = { total, plan };
      }
    }
    if (best) {
      return [
        ...best.plan.map((size) => ({ quantity: size, packSize: size, isTail: false })),
        { quantity: quantity - best.total, packSize: maxSize, isTail: true },
      ];
    }
  }

  return [{ quantity, packSize: maxSize, isTail: true }];
}

function createLine(group: PackingGroup, quantity: number, packSize: number, boxCount: number): PackedBoxLine {
  return {
    sourceItemId: group.sourceItemIds[0],
    productName: group.productName,
    sku: group.sku,
    spec: group.spec,
    quantity,
    packSize,
    boxCount,
    totalQuantity: group.quantity,
    remark: group.remark,
  };
}

function createBox(group: PackingGroup, entry: PackingPlanEntry, boxCount: number): PackedBox {
  const line = createLine(group, entry.quantity, entry.packSize, boxCount);
  return {
    id: createId(),
    orderId: group.orderId,
    orderNo: group.orderNo,
    recipientName: group.recipientName,
    sourceItemIds: [...group.sourceItemIds],
    productName: group.productName,
    sku: group.sku,
    spec: group.spec,
    quantity: entry.quantity,
    packSize: entry.packSize,
    isTail: entry.isTail,
    cartonNo: 0,
    totalCartons: 0,
    totalQuantity: group.quantity,
    boxCount,
    remark: group.remark,
    productRemark: group.remark,
    orderRemark: group.orderRemark,
    tailItems: entry.isTail ? [line] : undefined,
  };
}

function packGroup(group: PackingGroup): PackedBox[] {
  const plan = packingPlan(group.quantity, group.packSizes);
  const fullCounts = new Map<number, number>();
  plan.filter((entry) => !entry.isTail).forEach((entry) => fullCounts.set(entry.packSize, (fullCounts.get(entry.packSize) ?? 0) + 1));
  return plan.map((entry) => createBox(group, entry, entry.isTail ? 1 : fullCounts.get(entry.packSize) ?? 1));
}

function mergeTailBoxes(groups: PackingGroup[], boxes: PackedBox[]): PackedBox[] {
  const byOrder = new Map<string, PackedBox[]>();
  for (const box of boxes) {
    if (!box.isTail) continue;
    const key = orderKey(box);
    const current = byOrder.get(key) ?? [];
    current.push(box);
    byOrder.set(key, current);
  }

  const mergedById = new Map<string, PackedBox[]>();
  for (const [key, tails] of byOrder) {
    const capacity = Math.max(...tails.map((box) => box.packSize));
    const currentItems: PackedBoxLine[] = [];
    let currentQuantity = 0;
    const result: PackedBox[] = [];
    const first = tails[0]!;
    const append = () => {
      if (!currentItems.length) return;
      const sourceItemIds = [...new Set(currentItems.flatMap((item) => item.sourceItemId ? [item.sourceItemId] : []))];
      result.push({
        id: createId(),
        orderId: first.orderId,
        orderNo: first.orderNo,
        recipientName: first.recipientName,
        sourceItemIds,
        productName: currentItems.map((item) => `${item.productName}(${item.quantity})`).join('+'),
        sku: currentItems.map((item) => `${item.sku || '-'}(${item.quantity})`).join('+'),
        spec: currentItems.map((item) => item.spec).filter(Boolean).join('+'),
        quantity: currentQuantity,
        packSize: capacity,
        isTail: true,
        cartonNo: 0,
        totalCartons: 0,
        totalQuantity: currentQuantity,
        boxCount: 1,
        remark: '尾数合并',
        orderRemark: first.orderRemark,
        tailItems: currentItems.map((item) => ({ ...item })),
      });
      currentItems.length = 0;
      currentQuantity = 0;
    };
    for (const tail of tails) {
      let remaining = tail.quantity;
      const source = tail.tailItems?.[0] ?? {
        sourceItemId: tail.sourceItemIds[0],
        productName: tail.productName,
        sku: tail.sku,
        spec: tail.spec,
        quantity: tail.quantity,
        packSize: tail.packSize,
        boxCount: 1,
        totalQuantity: tail.totalQuantity,
        remark: tail.productRemark ?? tail.remark,
      };
      while (remaining > 0) {
        const take = Math.min(remaining, capacity - currentQuantity);
        const previous = currentItems.find((item) => item.sourceItemId === source.sourceItemId && item.sku === source.sku && item.spec === source.spec);
        if (previous) previous.quantity += take;
        else currentItems.push({ ...source, quantity: take });
        currentQuantity += take;
        remaining -= take;
        if (currentQuantity === capacity) append();
      }
    }
    append();
    mergedById.set(key, result);
  }

  const mergedIds = new Set([...byOrder.values()].flat().map((box) => box.id));
  const output: PackedBox[] = [];
  const inserted = new Set<string>();
  for (const box of boxes) {
    if (!mergedIds.has(box.id)) {
      output.push(box);
      continue;
    }
    const key = orderKey(box);
    if (inserted.has(key)) continue;
    inserted.add(key);
    output.push(...(mergedById.get(key) ?? []));
  }
  return output;
}

export function renumberBoxes(boxes: readonly PackedBox[]): PackedBox[] {
  return boxes.map((box, index) => ({
    ...box,
    sourceItemIds: [...box.sourceItemIds],
    tailItems: box.tailItems?.map((item) => ({ ...item })),
    cartonNo: index + 1,
    totalCartons: boxes.length,
  }));
}

export function renumberBoxesByOrder(boxes: readonly PackedBox[]): PackedBox[] {
  const counts = new Map<string, number>();
  boxes.forEach((box) => counts.set(orderKey(box), (counts.get(orderKey(box)) ?? 0) + 1));
  const numbers = new Map<string, number>();
  return boxes.map((box) => {
    const key = orderKey(box);
    const cartonNo = (numbers.get(key) ?? 0) + 1;
    numbers.set(key, cartonNo);
    return {
      ...box,
      sourceItemIds: [...box.sourceItemIds],
      tailItems: box.tailItems?.map((item) => ({ ...item })),
      cartonNo,
      totalCartons: counts.get(key) ?? 0,
    };
  });
}

export function autoPack(input: PackInput, options: AutoPackOptions = {}): PackedBox[] {
  const groups = groupItems(normalizeItems(input));
  const packed = groups.flatMap(packGroup);
  const result = options.mergeTail ? mergeTailBoxes(groups, packed) : packed;
  return renumberBoxesByOrder(result);
}

function sameMergeKey(left: PackedBox, right: PackedBox): boolean {
  return orderKey(left) === orderKey(right)
    && left.productName === right.productName
    && left.sku === right.sku
    && left.spec === right.spec;
}

export function canMergeBoxes(boxes: readonly PackedBox[]): boolean {
  if (boxes.length < 2) return false;
  const [first] = boxes;
  return Boolean(first?.isTail) && boxes.every((box) => box.isTail && sameMergeKey(first!, box));
}

function mergedGroup(boxes: readonly PackedBox[], totalQuantity: number): PackingGroup {
  const first = boxes[0]!;
  return {
    orderId: first.orderId,
    orderNo: first.orderNo,
    recipientName: first.recipientName,
    sourceItemIds: [...new Set(boxes.flatMap((box) => box.sourceItemIds))],
    productName: first.productName,
    sku: first.sku,
    spec: first.spec,
    quantity: totalQuantity,
    packSizes: normalizePackSizes(boxes.map((box) => box.packSize)),
    remark: boxes.find((box) => box.remark)?.remark,
    orderRemark: first.orderRemark,
  };
}

export function mergeBoxes(boxes: readonly PackedBox[]): PackedBox[] {
  if (!canMergeBoxes(boxes)) {
    throw new PackingError('只能合并同一订单内相同 SKU 和规格的尾数箱', 'INCOMPATIBLE_BOXES');
  }
  const totalQuantity = boxes.reduce((total, box) => total + box.quantity, 0);
  return renumberBoxesByOrder(packGroup(mergedGroup(boxes, totalQuantity)));
}

export function toOrderItemSnapshot(boxes: readonly PackedBox[]): OrderItemSnapshot {
  const first = boxes[0];
  if (!first) throw new PackingError('没有可转换的箱唛内容', 'EMPTY_INPUT');
  return {
    productName: first.productName,
    sku: first.sku,
    spec: first.spec,
    packaging: [{ name: '自动装箱', packCount: first.packSize }],
    quantity: first.totalQuantity,
    packSizes: [...new Set(boxes.map((box) => box.packSize))],
    lineRemark: first.remark,
  };
}
