import { autoPack, type PackedBox } from '../../shared/packing.js';
import type { DatabaseRepositories } from '../db/repositories.js';
import { OrderService } from './order-service.js';

export interface LabelServiceOptions {
  repositories: DatabaseRepositories;
  orderService?: OrderService;
}

export interface LabelLineInput {
  id?: number | string;
  orderItemId?: number | string | null;
  sku?: string;
  name?: string;
  productName?: string;
  specification?: string;
  spec?: string;
  packSize?: number;
  packCount?: number;
  quantity?: number;
  totalCount?: number;
  boxCount?: number;
  remark?: string;
}

export interface LabelInput {
  id?: number | string;
  boxNo?: number;
  cartonNo?: number;
  totalBoxes?: number;
  totalCartons?: number;
  manualEdited?: boolean;
  manuallyEdited?: boolean;
  items?: LabelLineInput[];
  lines?: LabelLineInput[];
}

export interface PrintHistoryInput {
  actionType?: string;
  orderIds?: number[];
  labels?: Array<{ id?: number | string; labelId?: number | string; orderId?: number | string }>;
}

function numberOr(value: unknown, fallback: number): number {
  const result = Number(value);
  return Number.isFinite(result) ? Math.trunc(result) : fallback;
}

function productKey(name: unknown, sku: unknown, specification: unknown): string {
  return `${String(name ?? '')}\u0000${String(sku ?? '')}\u0000${String(specification ?? '')}`;
}

function mapLine(
  row: Record<string, unknown>,
  index = 0,
  totalQuantityOverride?: number,
  boxCountOverride?: number,
) {
  const id = Number(row.id ?? index + 1);
  const name = String(row.name ?? '');
  const sku = String(row.sku ?? '');
  const specification = String(row.specification ?? '');
  const packSize = numberOr(row.packCount, 1);
  const quantity = numberOr(row.totalCount, 0);
  return {
    id,
    orderItemId: row.order_item_id == null ? (row.orderItemId == null ? null : Number(row.orderItemId)) : Number(row.order_item_id),
    name,
    productName: name,
    sku,
    specification,
    spec: specification,
    packCount: packSize,
    packSize,
    boxCount: boxCountOverride ?? numberOr(row.boxCount, 1),
    totalCount: quantity,
    quantity,
    totalQuantity: totalQuantityOverride ?? numberOr(row.totalQuantity, quantity),
    remark: String(row.remark ?? ''),
  };
}

function labelIsTail(items: Array<Record<string, unknown>>): boolean {
  return items.length > 1 || items.some((item) => numberOr(item.totalCount, 0) < numberOr(item.packCount, 0));
}

function mapLabel(order: Record<string, unknown>, row: Record<string, unknown>) {
  const items = Array.isArray(row.items) ? row.items as Array<Record<string, unknown>> : [];
  const productTotals = new Map<string, number>();
  const orderItems = Array.isArray(order.items) ? order.items as Array<Record<string, unknown>> : [];
  orderItems.forEach((item) => {
    const key = `${String(item.name ?? '')}\u0000${String(item.sku ?? '')}\u0000${String(item.specification ?? '')}`;
    productTotals.set(key, (productTotals.get(key) ?? 0) + numberOr(item.quantity, 0));
  });
  const mappedItems = items.map((item, index) => {
    const key = `${String(item.name ?? '')}\u0000${String(item.sku ?? '')}\u0000${String(item.specification ?? '')}`;
    return mapLine(item, index, productTotals.get(key) ?? numberOr(item.totalCount, 0));
  });
  return {
    ...row,
    id: Number(row.id),
    orderId: Number(order.id),
    orderNo: String(order.order_no ?? ''),
    recipientName: String(order.recipient_name ?? ''),
    boxNo: Number(row.box_no),
    cartonNo: Number(row.box_no),
    totalBoxes: Number(row.total_boxes),
    totalCartons: Number(row.total_boxes),
    manualEdited: Boolean(row.manualEdited ?? row.manual_edited),
    manuallyEdited: Boolean(row.manualEdited ?? row.manual_edited),
    isTail: labelIsTail(mappedItems),
    orderRemark: String(order.order_detail ?? ''),
    items: mappedItems,
    lines: mappedItems,
  };
}

function toRepositoryLabel(label: LabelInput): { boxNo: number; manualEdited: boolean; items: Array<Record<string, unknown>> } {
  const sourceItems = label.items ?? label.lines ?? [];
  if (!Array.isArray(sourceItems) || sourceItems.length === 0) throw new Error('每个箱唛至少需要一行产品');
  return {
    boxNo: numberOr(label.boxNo ?? label.cartonNo, 0),
    manualEdited: Boolean(label.manualEdited ?? label.manuallyEdited ?? true),
    items: sourceItems.map((item) => {
      const name = String(item.name ?? item.productName ?? '').trim();
      const sku = String(item.sku ?? '').trim();
      const specification = String(item.specification ?? item.spec ?? '').trim();
      const packCount = numberOr(item.packCount ?? item.packSize, 0);
      const totalCount = numberOr(item.totalCount ?? item.quantity, 0);
      if (!name || packCount <= 0 || totalCount <= 0) throw new Error('箱唛产品信息不完整');
      return {
        orderItemId: item.orderItemId == null ? null : numberOr(item.orderItemId, 0),
        name,
        sku,
        specification,
        packCount,
        boxCount: Math.max(1, numberOr(item.boxCount, 1)),
        totalCount,
        remark: String(item.remark ?? '').trim(),
      };
    }),
  };
}

export class LabelService {
  readonly repositories: DatabaseRepositories;
  readonly orderService: OrderService;

  constructor(options: LabelServiceOptions) {
    this.repositories = options.repositories;
    this.orderService = options.orderService ?? new OrderService({ repositories: options.repositories });
  }

  getOrderLabels(orderId: number) {
    const detail = this.repositories.getOrderDetail(orderId);
    if (!detail) return undefined;
    return detail.labels.map((label) => mapLabel(detail, label));
  }

  saveOrderLabels(orderId: number, input: LabelInput[]) {
    const detail = this.repositories.getOrderDetail(orderId) as (Record<string, unknown> & { items?: Array<Record<string, unknown>> }) | undefined;
    if (!detail) return undefined;
    if (!Array.isArray(input) || input.length === 0) throw new Error('至少需要一个箱唛');
    const validItemIds = new Set((detail.items ?? []).map((item) => Number(item.id)).filter((id) => Number.isSafeInteger(id) && id > 0));
    const labels = input.map(toRepositoryLabel);
    const boxNumbers = new Set<number>();
    labels.forEach((label, labelIndex) => {
      if (!Number.isSafeInteger(label.boxNo) || label.boxNo <= 0) throw new Error(`第 ${labelIndex + 1} 个箱唛箱号无效`);
      if (boxNumbers.has(label.boxNo)) throw new Error('箱唛箱号不能重复');
      boxNumbers.add(label.boxNo);
      label.items.forEach((item) => {
        const orderItemId = item.orderItemId == null ? null : numberOr(item.orderItemId, 0);
        if (orderItemId != null && (!Number.isSafeInteger(orderItemId) || !validItemIds.has(orderItemId))) {
          throw new Error('箱唛包含不属于当前订单的产品行');
        }
      });
    });
    this.repositories.saveCartonLabels(orderId, labels);
    return this.getOrderLabels(orderId);
  }

  updateLabel(labelId: number, input: LabelInput) {
    const label = this.repositories.getCartonLabel(labelId) as Record<string, unknown> | undefined;
    if (!label) return undefined;
    const current = this.getOrderLabels(Number(label.order_id));
    if (!current) return undefined;
    const target = current.find((entry) => entry.id === labelId);
    if (!target) return undefined;
    const replacement = {
      ...target,
      ...input,
      id: labelId,
      boxNo: target.boxNo,
      cartonNo: target.cartonNo,
      items: input.items ?? input.lines ?? target.items,
      lines: input.items ?? input.lines ?? target.lines,
      manualEdited: true,
      manuallyEdited: true,
    };
    const next = current.map((entry) => entry.id === labelId ? replacement : entry);
    return this.saveOrderLabels(Number(label.order_id), next);
  }

  mergeLabels(orderId: number, labelIds: number[]) {
    const detail = this.repositories.getOrderDetail(orderId);
    if (!detail) return undefined;
    const uniqueIds = [...new Set(labelIds)];
    if (uniqueIds.length < 2) throw new Error('至少选择两个箱唛进行合箱');
    const labels = detail.labels.map((label) => mapLabel(detail, label));
    const selected = labels.filter((label) => uniqueIds.includes(label.id));
    if (selected.length !== uniqueIds.length) throw new Error('只能合并同一订单内的箱唛');
    const productGroups = new Map<string, {
      name: string;
      sku: string;
      specification: string;
      quantity: number;
      packSize: number;
      orderItemId: number | null;
      remark: string;
    }>();
    selected.forEach((label) => label.items.forEach((line) => {
      const key = productKey(line.name, line.sku, line.specification);
      const current = productGroups.get(key);
      if (current) {
        current.quantity += line.quantity;
        current.packSize = Math.max(current.packSize, line.packSize);
        if (!current.remark && line.remark) current.remark = line.remark;
        return;
      }
      productGroups.set(key, {
        name: line.name,
        sku: line.sku,
        specification: line.specification,
        quantity: line.quantity,
        packSize: line.packSize,
        orderItemId: line.orderItemId == null ? null : line.orderItemId,
        remark: line.remark ?? '',
      });
    }));

    if (productGroups.size > 1 && selected.some((label) => !label.isTail)) {
      throw new Error('不同产品只能合并尾数箱');
    }

    const packed = autoPack([...productGroups.values()].map((group) => ({
      id: String(group.orderItemId ?? productKey(group.name, group.sku, group.specification)),
      orderId: String(orderId),
      productName: group.name,
      sku: group.sku,
      spec: group.specification,
      quantity: group.quantity,
      packSizes: [group.packSize],
      remark: group.remark,
      orderRemark: String((detail as Record<string, unknown>).order_detail ?? ''),
    })), { mergeTail: productGroups.size > 1 });
    const productBoxCounts = new Map<string, number>();
    packed.forEach((box) => {
      const lines = box.tailItems?.length ? box.tailItems : [{
        productName: box.productName,
        sku: box.sku,
        spec: box.spec,
      }];
      new Set(lines.map((line) => productKey(line.productName, line.sku, line.spec))).forEach((key) => {
        productBoxCounts.set(key, (productBoxCounts.get(key) ?? 0) + 1);
      });
    });
    const firstIndex = Math.min(...selected.map((label) => labels.findIndex((entry) => entry.id === label.id)));
    const selectedSet = new Set(uniqueIds);
    const merged = packed.map((box) => this.packedBoxToLabel(box, detail, productBoxCounts));
    const next: Array<Record<string, unknown>> = [];
    labels.forEach((label, index) => {
      if (index === firstIndex) next.push(...merged);
      if (!selectedSet.has(label.id)) next.push(label);
    });
    // The packing result is numbered from 1, while unselected labels keep
    // their old numbers. Normalize the complete result before validation so
    // merging boxes in the middle of an order cannot create duplicate boxNo.
    const renumbered = next.map((label, index) => ({
      ...label,
      boxNo: index + 1,
      cartonNo: index + 1,
      totalBoxes: next.length,
      totalCartons: next.length,
    }));
    return this.saveOrderLabels(orderId, renumbered as LabelInput[]);
  }

  recordPrintHistory(input: PrintHistoryInput): { id: number; labels: unknown[] } {
    const orderIds = [...new Set((input.orderIds ?? []).map(Number).filter(Number.isSafeInteger))];
    const requestedLabels = input.labels ?? [];
    const requestedLabelIds = new Set(
      requestedLabels
        .map((label) => Number(label.id ?? label.labelId))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    );
    const resolvedOrderIds = [...orderIds];
    requestedLabels.forEach((label) => {
      const orderId = Number(label.orderId);
      if (Number.isSafeInteger(orderId) && !resolvedOrderIds.includes(orderId)) resolvedOrderIds.push(orderId);
    });
    if (resolvedOrderIds.length === 0) throw new Error('打印请求至少需要一个订单');

    const snapshots: Array<{ labelId: number | null; orderId: number; orderNo: string; boxNo: number; totalBoxes: number; snapshot: unknown }> = [];
    if (input.actionType !== undefined && input.actionType !== 'print' && input.actionType !== 'first-print') {
      throw new Error('打印动作类型无效');
    }
    resolvedOrderIds.forEach((orderId) => {
      const detail = this.repositories.getOrderDetail(orderId) as (Record<string, unknown> & { status?: unknown; order_no?: unknown; recipient_name?: unknown; labels: Array<Record<string, unknown>> }) | undefined;
      if (!detail) throw new Error(`订单不存在：${orderId}`);
      const supplied = requestedLabels.filter((label) => Number(label.orderId) === orderId);
      if (supplied.length) {
        supplied.forEach((label) => {
          const id = Number(label.id ?? label.labelId);
          const persisted = detail.labels.find((entry) => Number(entry.id) === id);
          const source = persisted ? mapLabel(detail, persisted) : undefined;
          if (!source) throw new Error(`箱唛不存在：${id}`);
          snapshots.push({ labelId: source.id, orderId, orderNo: source.orderNo, boxNo: source.boxNo, totalBoxes: source.totalBoxes, snapshot: { orderId, orderNo: source.orderNo, recipientName: source.recipientName, cartonNo: source.cartonNo, totalCartons: source.totalCartons, items: source.items } });
        });
      } else if (requestedLabels.length === 0) {
        detail.labels
          .map((label) => mapLabel(detail, label))
          .filter((label) => requestedLabelIds.size === 0 || requestedLabelIds.has(label.id))
          .forEach((label) => snapshots.push({ labelId: label.id, orderId, orderNo: label.orderNo, boxNo: label.boxNo, totalBoxes: label.totalBoxes, snapshot: { orderId, orderNo: label.orderNo, recipientName: label.recipientName, cartonNo: label.cartonNo, totalCartons: label.totalCartons, items: label.items } }));
      }
    });
    if (snapshots.length === 0) throw new Error('没有可打印的箱唛');
    const snapshotOrderIds = new Set(snapshots.map((snapshot) => snapshot.orderId));
    const actionType = input.actionType ?? 'print';
    const id = this.repositories.recordPrintHistory({ actionType, orderIds: [...snapshotOrderIds], labels: snapshots });
    return { id, labels: snapshots };
  }

  listPrintHistory(orderId?: number) {
    return this.repositories.listPrintHistories(orderId);
  }

  private packedBoxToLabel(box: PackedBox, detail: Record<string, unknown>, productBoxCounts: Map<string, number>) {
    const sourceLines = box.tailItems?.length ? box.tailItems : [{
      sourceItemId: box.sourceItemIds[0],
      productName: box.productName,
      sku: box.sku,
      spec: box.spec,
      quantity: box.quantity,
      packSize: box.packSize,
      boxCount: box.boxCount ?? 1,
      totalQuantity: box.totalQuantity,
      remark: box.productRemark ?? box.remark,
    }];
    return {
      id: undefined,
      boxNo: box.cartonNo || 1,
      cartonNo: box.cartonNo || 1,
      totalBoxes: box.totalCartons || 1,
      totalCartons: box.totalCartons || 1,
      manualEdited: true,
      manuallyEdited: true,
      items: sourceLines.map((line) => ({
        orderItemId: line.sourceItemId == null || !Number.isSafeInteger(Number(line.sourceItemId)) ? null : Number(line.sourceItemId),
        name: line.productName,
        productName: line.productName,
        sku: line.sku,
        specification: line.spec,
        spec: line.spec,
        packCount: line.packSize,
        packSize: line.packSize,
        boxCount: productBoxCounts.get(productKey(line.productName, line.sku, line.spec)) ?? line.boxCount ?? 1,
        totalCount: line.quantity,
        quantity: line.quantity,
        remark: line.remark ?? '',
      })),
      orderId: Number(detail.id),
      orderNo: String(detail.order_no ?? ''),
      recipientName: String(detail.recipient_name ?? ''),
    };
  }
}

export function createLabelService(options: LabelServiceOptions): LabelService {
  return new LabelService(options);
}
