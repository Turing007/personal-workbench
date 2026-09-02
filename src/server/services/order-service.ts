import type { Readable } from 'node:stream';
import type { DatabaseRepositories, CreateOrderInput, UpdateOrderInput } from '../db/repositories.js';
import { CustomerProductRepository } from '../db/customer-product-repository.js';
import { CustomerRepository } from '../db/customer-repository.js';
import { FileStore } from '../files/file-store.js';
import { calculateLineAmountCents } from '../../shared/money.js';
import { calculateOrderAmountCents } from '../../shared/order-prices.js';
import type { CustomerProduct } from '../../shared/customers.js';

import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_SEQUENCE,
  canTransition,
  getTransitionError,
  isDraftStatus,
  type OrderStatus,
  type TransitionReason,
} from '../../shared/domain.js';

export const DB_ORDER_STATUS_LABELS = ORDER_STATUS_LABELS;

const STATUS_ALIASES: Record<string, OrderStatus | 'draft'> = {
  draft: 'draft',
  草稿: 'draft',
  label_pending: 'label_pending',
  pending_stock: 'pending_stock',
  stock_reported: 'stock_reported',
  pending_packing: 'pending_packing',
  ship_pending: 'ship_pending',
  shipped: 'shipped',
  待打印箱唛: 'label_pending',
  待备货: 'pending_stock',
  已备货: 'stock_reported',
  待打包: 'pending_packing',
  待发货: 'ship_pending',
  已发货: 'shipped',
};

export interface OrderServiceOptions {
  repositories: DatabaseRepositories;
  customerRepository?: CustomerRepository;
  customerProductRepository?: CustomerProductRepository;
  fileStore?: FileStore;
}

export interface PaymentProofRecord {
  id: number;
  orderId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  note: string;
  createdAt: string;
}

export interface OrderContractRecord {
  id: number;
  orderId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  category: string;
  sourceCustomerProductId: number | null;
}

export interface OrderDetailImageRecord {
  id: number;
  orderId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

const REQUIREMENT_CATEGORIES = new Set(['label', 'instruction', 'packaging', 'other']);

type RequirementCategory = 'label' | 'instruction' | 'packaging' | 'other';

interface RequirementAttachmentInput {
  category: RequirementCategory;
  sourceCustomerProductId?: number | null;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export class OrderCustomerError extends Error {
  constructor(
    public readonly code: 'CUSTOMER_NOT_FOUND' | 'CUSTOMER_INACTIVE' | 'CUSTOMER_PRODUCT_NOT_FOUND' | 'CUSTOMER_PRODUCT_CUSTOMER_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'OrderCustomerError';
  }
}

function integer(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value);
}

export function normalizeOrderDate(value: unknown): string {
  if (typeof value !== 'string') throw new Error('下单时间无效');
  const input = value.trim();
  // 用 String.match 而非 RegExp.exec：语义相同，且避免静态扫描器把 .exec 误报为命令执行 sink
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})(T.*)?$/);
  if (!match) throw new Error('下单时间无效');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) throw new Error('下单时间无效');
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!) throw new Error('下单时间无效');
  if (match[4] && Number.isNaN(Date.parse(input))) throw new Error('下单时间无效');
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function mapPaymentProof(row: Record<string, unknown> | undefined): PaymentProofRecord | undefined {
  if (!row) return undefined;
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    relativePath: String(row.relative_path ?? ''),
    originalName: String(row.original_name ?? ''),
    mimeType: String(row.mime_type ?? ''),
    size: Number(row.size_bytes ?? 0),
    note: String(row.note ?? ''),
    createdAt: String(row.created_at ?? ''),
  };
}

function mapContract(row: Record<string, unknown> | undefined): OrderContractRecord | undefined {
  if (!row) return undefined;
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    relativePath: String(row.relative_path ?? ''),
    originalName: String(row.original_name ?? ''),
    mimeType: String(row.mime_type ?? ''),
    size: Number(row.size_bytes ?? 0),
    createdAt: String(row.created_at ?? ''),
    category: String(row.category ?? 'other'),
    sourceCustomerProductId: row.source_customer_product_id == null ? null : Number(row.source_customer_product_id),
  };
}

function mapOrderDetailImage(row: Record<string, unknown> | undefined): OrderDetailImageRecord | undefined {
  if (!row) return undefined;
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    relativePath: String(row.relative_path ?? ''),
    originalName: String(row.original_name ?? ''),
    mimeType: String(row.mime_type ?? ''),
    size: Number(row.size_bytes ?? 0),
    createdAt: String(row.created_at ?? ''),
  };
}

export function normalizeOrderStatus(value: unknown): OrderStatus {
  const normalized = typeof value === 'string' ? STATUS_ALIASES[value.trim()] : undefined;
  if (!normalized || normalized === 'draft') throw new Error(`订单状态无效，可选值：${ORDER_STATUS_SEQUENCE.join('、')}`);
  return normalized;
}

/** 接受包括 draft 在内的全部订单状态（列表筛选用）。 */
export function normalizeAnyOrderStatus(value: unknown): OrderStatus | 'draft' {
  const normalized = typeof value === 'string' ? STATUS_ALIASES[value.trim()] : undefined;
  if (!normalized) throw new Error(`订单状态无效，可选值：draft、${ORDER_STATUS_SEQUENCE.join('、')}`);
  return normalized;
}

export class OrderService {
  readonly repositories: DatabaseRepositories;
  readonly customerRepository?: CustomerRepository;
  readonly customerProductRepository?: CustomerProductRepository;
  readonly fileStore?: FileStore;

  constructor(options: OrderServiceOptions) {
    this.repositories = options.repositories;
    this.customerRepository = options.customerRepository;
    this.customerProductRepository = options.customerProductRepository;
    this.fileStore = options.fileStore;
  }

  list(filters: { status?: string; query?: string; q?: string; page?: number; pageSize?: number } = {}) {
    return this.repositories.listOrders({
      ...filters,
      status: filters.status ? normalizeAnyOrderStatus(filters.status) : undefined,
    });
  }

  get(orderId: number) {
    return this.repositories.getOrderDetail(orderId);
  }

  async create(input: CreateOrderInput) {
    const isDraft = Boolean(input.isDraft);
    const normalized = this.normalizeInput(input);
    let withCustomerProducts: CreateOrderInput | undefined;
    try {
      withCustomerProducts = await this.validateCustomerProductReferences(normalized, true, undefined, { draft: isDraft });
      this.validateInput(withCustomerProducts, { allowEmptyOrderNo: true, draft: isDraft });
      return this.repositories.createOrder(withCustomerProducts);
    } catch (error) {
      if (withCustomerProducts) await this.deleteCopiedRequirementFiles(withCustomerProducts);
      throw error;
    }
  }

  async update(orderId: number, input: UpdateOrderInput) {
    if (!this.repositories.getOrderDetail(orderId)) return undefined;
    const previous = this.repositories.getOrderDetail(orderId) as Record<string, unknown> | undefined;
    const wasDraft = isDraftStatus(previous?.status);
    const isDraft = input.isDraft === undefined ? wasDraft : Boolean(input.isDraft);
    const normalized = this.normalizeInput(input);
    const previousPaths = this.getOrderRequirementPaths(orderId);
    let withCustomerProducts: CreateOrderInput | undefined;
    let updated;
    try {
      withCustomerProducts = await this.validateCustomerProductReferences(normalized, false, new Set(previousPaths), { draft: isDraft });
      this.validateInput(withCustomerProducts, { draft: isDraft });
      updated = this.repositories.updateOrder(orderId, withCustomerProducts);
    } catch (error) {
      if (withCustomerProducts) await this.deleteCopiedRequirementFiles(withCustomerProducts, new Set(previousPaths));
      throw error;
    }
    if (updated && this.fileStore && previousPaths.length) {
      const retainedPaths = new Set((withCustomerProducts.orderAttachments ?? []).filter((attachment) => attachment.sourceCustomerProductId != null).map((attachment) => attachment.relativePath));
      await Promise.all(previousPaths.filter((path) => !retainedPaths.has(path)).map((path) => this.fileStore!.deleteFile(path).catch(() => undefined)));
    }
    return updated;
  }

  async delete(orderId: number): Promise<boolean> {
    const result = this.repositories.deleteOrder(orderId);
    if (!result.deleted) return false;
    if (this.fileStore) {
      await Promise.all(result.filePaths.map((path) => this.fileStore!.deleteFile(path).catch(() => undefined)));
    }
    return true;
  }

  /**
   * 发布草稿：draft → pending_stock，并按正式订单标准补全校验。
   * 校验失败时抛出错误，草稿保持不变，便于继续编辑。
   */
  publish(orderId: number) {
    const order = this.repositories.getOrderDetail(orderId) as (Record<string, unknown> & { status?: unknown }) | undefined;
    if (!order) return undefined;
    if (!isDraftStatus(order.status)) throw new Error('只有草稿订单可以发布');

    // 以库内数据重建完整输入做正式校验，确保发布后的订单信息完整。
    const input = this.buildInputFromDetail(order);
    const normalized = this.normalizeInput(input);
    this.validateInput(normalized);
    if (normalized.items.length === 0) throw new Error('订单至少需要一行产品');
    if (!normalized.recipientName?.trim()) throw new Error('收件人名称不能为空');

    if (!this.repositories.updateOrderStatusWithTracking(orderId, 'pending_stock', String(order.tracking_no ?? ''))) {
      return undefined;
    }
    return this.repositories.getOrderDetail(orderId);
  }

  private buildInputFromDetail(detail: Record<string, unknown>): CreateOrderInput {
    const items = Array.isArray(detail.items) ? detail.items as Array<Record<string, unknown>> : [];
    return {
      orderNo: String(detail.order_no ?? ''),
      orderedAt: String(detail.ordered_at ?? ''),
      customerId: detail.customer_id == null ? null : Number(detail.customer_id),
      customerName: String(detail.customer_name ?? ''),
      customerContactName: String(detail.customer_contact_name ?? ''),
      customerContactPhone: String(detail.customer_contact_phone ?? ''),
      customerShippingInfo: String(detail.customer_shipping_info ?? ''),
      recipientName: String(detail.recipient_name ?? ''),
      recipientInfo: String(detail.recipient_info ?? ''),
      amount: Number(detail.amount ?? 0),
      amountCents: Number(detail.amount_cents ?? Math.round(Number(detail.amount ?? 0) * 100)),
      shippingCents: Number(detail.shipping_cents ?? 0),
      trackingNo: String(detail.tracking_no ?? ''),
      paymentNote: String(detail.payment_note ?? ''),
      orderDetail: String(detail.order_detail ?? ''),
      remark: String(detail.remark ?? ''),
      items: items.map((item) => ({
        customerProductId: item.customer_product_id == null ? null : Number(item.customer_product_id),
        name: String(item.name ?? ''),
        sku: String(item.sku ?? ''),
        specification: String(item.specification ?? ''),
        packagingName: String(item.packaging_name ?? ''),
        packCount: Number(item.pack_count ?? 1),
        quantity: Number(item.quantity ?? 1),
        unitPriceCents: Number(item.unit_price_cents ?? 0),
        amountCents: Number(item.amount_cents ?? 0),
        freightPerBoxCents: Number(item.freight_per_box_cents ?? 0),
        remark: String(item.remark ?? ''),
      })),
    };
  }

  transition(orderId: number, toValue: unknown, reason: TransitionReason = 'manual', trackingNo?: string | null) {
    const order = this.repositories.getOrderDetail(orderId) as (Record<string, unknown> & {
      status?: unknown;
      tracking_no?: unknown;
    }) | undefined;
    if (!order) return undefined;

    const from = normalizeOrderStatus(order.status);
    const to = normalizeOrderStatus(toValue);
    const nextTrackingNo = trackingNo == null ? String(order.tracking_no ?? '') : trackingNo;
    const error = getTransitionError(from, to, { reason, trackingNo: nextTrackingNo });
    if (error || !canTransition(from, to, { reason, trackingNo: nextTrackingNo })) {
      throw new Error(error ?? '订单状态不能推进');
    }

    const changed = to === 'shipped'
      ? this.repositories.updateOrderStatusWithTracking(orderId, to, nextTrackingNo)
      : this.repositories.updateOrderStatus(orderId, to);
    if (!changed) return undefined;
    return this.repositories.getOrderDetail(orderId);
  }

  listPaymentProofs(orderId: number): PaymentProofRecord[] {
    if (!this.repositories.getOrderDetail(orderId)) return [];
    return this.repositories.listPaymentProofs(orderId).map((row) => mapPaymentProof(row)!).filter(Boolean);
  }

  async uploadPaymentProof(
    orderId: number,
    stream: Readable,
    originalName: string,
    mimeType: string,
    note = '',
  ): Promise<PaymentProofRecord> {
    if (!this.repositories.getOrderDetail(orderId)) throw new Error('订单不存在');
    if (!this.fileStore) throw new Error('附件存储尚未配置');

    const stored = await this.fileStore.saveImage(stream, 'payment', originalName, mimeType);
    try {
      const proof = this.repositories.addPaymentProof(orderId, { ...stored, note: note.trim() });
      const mapped = mapPaymentProof(proof);
      if (!mapped) throw new Error('付款凭证保存失败');
      return mapped;
    } catch (error) {
      await this.fileStore.deleteFile(stored.relativePath);
      throw error;
    }
  }

  async deletePaymentProof(proofId: number): Promise<PaymentProofRecord | undefined> {
    const proof = this.repositories.getPaymentProof(proofId);
    if (!proof) return undefined;
    const mapped = mapPaymentProof(proof);
    const deleted = this.repositories.deletePaymentProof(proofId);
    if (deleted && this.fileStore) await this.fileStore.deleteFile(deleted.relativePath);
    return mapped;
  }

  listContracts(orderId: number): OrderContractRecord[] {
    if (!this.repositories.getOrderDetail(orderId)) return [];
    return this.repositories.listOrderContracts(orderId).map((row) => mapContract(row)!).filter(Boolean);
  }

  async uploadContract(
    orderId: number,
    stream: Readable,
    originalName: string,
    mimeType: string,
  ): Promise<OrderContractRecord> {
    if (!this.repositories.getOrderDetail(orderId)) throw new Error('订单不存在');
    if (!this.fileStore) throw new Error('附件存储尚未配置');

    const stored = await this.fileStore.saveFile(stream, 'order-contract', originalName, mimeType);
    try {
      const contract = this.repositories.addOrderContract(orderId, stored);
      const mapped = mapContract(contract);
      if (!mapped) throw new Error('合同保存失败');
      return mapped;
    } catch (error) {
      await this.fileStore.deleteFile(stored.relativePath);
      throw error;
    }
  }

  async deleteContract(contractId: number): Promise<OrderContractRecord | undefined> {
    const contract = this.repositories.getOrderContract(contractId);
    if (!contract) return undefined;
    const mapped = mapContract(contract);
    const deleted = this.repositories.deleteOrderContract(contractId);
    if (deleted && this.fileStore) await this.fileStore.deleteFile(deleted.relativePath).catch(() => undefined);
    return mapped;
  }

  listOrderDetailImages(orderId: number): OrderDetailImageRecord[] {
    if (!this.repositories.getOrderDetail(orderId)) return [];
    return this.repositories.listOrderDetailImages(orderId).map((row) => mapOrderDetailImage(row)!).filter(Boolean);
  }

  async uploadOrderDetailImage(
    orderId: number,
    stream: Readable,
    originalName: string,
    mimeType: string,
  ): Promise<OrderDetailImageRecord> {
    if (!this.repositories.getOrderDetail(orderId)) throw new Error('订单不存在');
    if (!this.fileStore) throw new Error('附件存储尚未配置');
    const stored = await this.fileStore.saveImage(stream, 'order-detail', originalName, mimeType);
    try {
      const image = this.repositories.addOrderDetailImage(orderId, stored);
      const mapped = mapOrderDetailImage(image);
      if (!mapped) throw new Error('订单详情图片保存失败');
      return mapped;
    } catch (error) {
      await this.fileStore.deleteFile(stored.relativePath);
      throw error;
    }
  }

  async deleteOrderDetailImage(imageId: number): Promise<OrderDetailImageRecord | undefined> {
    const image = this.repositories.getOrderDetailImage(imageId);
    if (!image) return undefined;
    const mapped = mapOrderDetailImage(image);
    const deleted = this.repositories.deleteOrderDetailImage(imageId);
    if (deleted && this.fileStore) await this.fileStore.deleteFile(deleted.relativePath).catch(() => undefined);
    return mapped;
  }

  private async validateCustomerProductReferences(
    input: CreateOrderInput,
    isCreate: boolean,
    preservedPaths = new Set<string>(),
    options: { draft?: boolean } = {},
  ): Promise<CreateOrderInput> {
    const customer = input.customerId == null
      ? undefined
      : this.customerRepository?.get(input.customerId);
    if (input.customerId != null && !customer) throw new OrderCustomerError('CUSTOMER_NOT_FOUND', '客户不存在');

    // 草稿订单不强制客户有效状态，发布时才要求。
    if (!options.draft && isCreate && customer && !customer.isActive) {
      throw new OrderCustomerError('CUSTOMER_INACTIVE', '客户已停用，不能新建订单');
    }

    const normalizedItems: CreateOrderInput['items'] = [];
    const copiedPaths: string[] = [];
    const orderAttachments = (input.orderAttachments ?? [])
      .filter((attachment) => attachment.relativePath.startsWith('order-item-requirements/'));
    try {
      for (const item of input.items) {
      if (item.customerProductId == null) {
        normalizedItems.push({
          ...item,
          amountCents: calculateLineAmountCents(item.quantity, item.unitPriceCents ?? 0),
        });
        continue;
      }
      const product = this.customerProductRepository?.getById(item.customerProductId);
      if (!product) throw new OrderCustomerError('CUSTOMER_PRODUCT_NOT_FOUND', `客户产品不存在：${item.customerProductId}`);
      if (input.customerId == null || product.customerId !== input.customerId) {
        throw new OrderCustomerError('CUSTOMER_PRODUCT_CUSTOMER_MISMATCH', '客户产品不属于当前客户');
      }
      const unitPriceCents = item.unitPriceCents ?? product.finalPriceCents ?? 0;
      const productAttachments = !isCreate && orderAttachments.some((attachment) => attachment.sourceCustomerProductId === product.id && attachment.relativePath.startsWith('order-item-requirements/'))
        ? orderAttachments.filter((attachment) => attachment.sourceCustomerProductId === product.id)
        : await this.copyCustomerProductAttachments(product.attachments, product.id);
      if (!isCreate) {
        const retained = new Set(productAttachments.map((attachment) => attachment.relativePath));
        orderAttachments.splice(0, orderAttachments.length, ...orderAttachments.filter((attachment) => !attachment.sourceCustomerProductId || attachment.sourceCustomerProductId !== product.id || retained.has(attachment.relativePath)));
      } else {
        orderAttachments.push(...productAttachments);
      }
      copiedPaths.push(...productAttachments.filter((attachment) => attachment.relativePath.startsWith('order-item-requirements/')).map((attachment) => attachment.relativePath));
      normalizedItems.push({
        ...item,
        name: item.name.trim() || product.name,
        sku: item.sku?.trim() || product.sku,
        specification: item.specification?.trim() || product.specification,
        packCount: item.packCount ?? product.packCount ?? 1,
        unitPriceCents,
        amountCents: calculateLineAmountCents(item.quantity, unitPriceCents),
        freightPerBoxCents: item.freightPerBoxCents ?? product.freightPerBoxCents ?? 0,
        remark: item.remark?.trim() || product.remark,
      });
      }
    } catch (error) {
      if (this.fileStore) await Promise.all(copiedPaths.map((path) => this.fileStore!.deleteFile(path).catch(() => undefined)));
      throw error;
    }

    const amountCents = calculateOrderAmountCents(
      normalizedItems.map((item) => ({
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents ?? 0,
      })),
      input.shippingCents ?? 0,
    );

    return {
      ...input,
      amount: amountCents / 100,
      amountCents,
      ...(customer ? {
        customerName: input.customerName?.trim() || customer.name,
        customerContactName: input.customerContactName?.trim() || customer.contactName,
        customerContactPhone: input.customerContactPhone?.trim() || customer.contactPhone,
        customerShippingInfo: input.customerShippingInfo?.trim() || customer.shippingInfo,
      } : {}),
      items: normalizedItems,
      orderAttachments,
    };
  }

  private async copyCustomerProductAttachments(attachments: CustomerProduct['attachments'], customerProductId: number): Promise<RequirementAttachmentInput[]> {
    if (!attachments.length || !this.fileStore) {
      if (!this.fileStore) return [];
      return attachments.map((attachment) => ({
        category: REQUIREMENT_CATEGORIES.has(attachment.category) ? attachment.category : 'other',
        relativePath: attachment.relativePath,
        sourceCustomerProductId: customerProductId,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
      }));
    }
    const copied: RequirementAttachmentInput[] = [];
    try {
      for (const attachment of attachments) {
        const category = REQUIREMENT_CATEGORIES.has(attachment.category) ? attachment.category : 'other';
        const stored = await this.fileStore.copyFile(
          attachment.relativePath,
          'order-item-requirement',
          attachment.originalName,
          attachment.mimeType,
        );
        copied.push({ ...stored, category, sourceCustomerProductId: customerProductId });
      }
      return copied;
    } catch (error) {
      await Promise.all(copied.map((attachment) => this.fileStore!.deleteFile(attachment.relativePath).catch(() => undefined)));
      throw error;
    }
  }

  private getOrderRequirementPaths(orderId: number): string[] {
    return this.repositories.listOrderContracts(orderId)
      .filter((attachment) => attachment.source_customer_product_id != null)
      .map((attachment) => String(attachment.relative_path ?? ''))
      .filter((path) => path.startsWith('order-item-requirements/'));
  }

  private async deleteCopiedRequirementFiles(input: CreateOrderInput, preservePaths = new Set<string>()): Promise<void> {
    if (!this.fileStore) return;
    const paths = (input.orderAttachments ?? []).map((attachment) => attachment.relativePath);
    await Promise.all(paths.filter((path) => path.startsWith('order-item-requirements/') && !preservePaths.has(path)).map((path) => this.fileStore!.deleteFile(path).catch(() => undefined)));
  }

  private normalizeInput(input: CreateOrderInput): CreateOrderInput {
    if (!input || typeof input !== 'object') throw new Error('订单数据无效');
    return { ...input, orderedAt: normalizeOrderDate(input.orderedAt) };
  }

  private validateInput(input: CreateOrderInput, options: { allowEmptyOrderNo?: boolean; draft?: boolean } = {}): void {
    if (!input || typeof input !== 'object') throw new Error('订单数据无效');
    if (!options.allowEmptyOrderNo && !input.orderNo?.trim()) throw new Error('订单号不能为空');
    normalizeOrderDate(input.orderedAt);
    if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('订单至少需要一行产品');
    if (input.amount != null && (!Number.isFinite(input.amount) || input.amount < 0)) throw new Error('订单金额必须是非负数字');
    if (input.amountCents != null && (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0)) {
      throw new Error('订单金额必须是非负整数分');
    }
    if (input.shippingCents != null && (!Number.isSafeInteger(input.shippingCents) || input.shippingCents < 0)) {
      throw new Error('运费必须是非负整数分');
    }
    // 草稿允许收件人为空，发布时才强制。
    if (!options.draft && !input.recipientName?.trim()) throw new Error('收件人名称不能为空');

    input.items.forEach((item, index) => {
      if (!item.name?.trim()) {
        // 草稿行允许品名暂缺，正式订单必须填写。
        if (!options.draft) throw new Error(`第 ${index + 1} 行产品品名不能为空`);
      }
      if (!integer(item.quantity) || item.quantity <= 0) throw new Error(`第 ${index + 1} 行产品数量必须是正整数`);
      if (item.packCount != null && (!integer(item.packCount) || item.packCount <= 0)) throw new Error(`第 ${index + 1} 行装箱数必须是正整数`);
      if (item.unitPriceCents != null && (!integer(item.unitPriceCents) || item.unitPriceCents < 0)) throw new Error(`第 ${index + 1} 行单价必须是非负整数分`);
      if (item.freightPerBoxCents != null && (!integer(item.freightPerBoxCents) || item.freightPerBoxCents < 0)) throw new Error(`第 ${index + 1} 行运费/箱必须是非负整数分`);
      if (item.packaging != null) {
        if (!Array.isArray(item.packaging) || item.packaging.length === 0) throw new Error(`第 ${index + 1} 行包装方案不能为空`);
        item.packaging.forEach((packaging, packagingIndex) => {
          if (!integer(packaging.packCount) || packaging.packCount <= 0) {
            throw new Error(`第 ${index + 1} 行第 ${packagingIndex + 1} 个包装装箱数必须是正整数`);
          }
          for (const value of [packaging.outerLength, packaging.outerWidth, packaging.outerHeight, packaging.outerWeight]) {
            if (value != null && (!Number.isFinite(value) || value < 0)) throw new Error('包装外箱数据必须是非负数字');
          }
        });
      }
    });
  }
}

export function createOrderService(options: OrderServiceOptions): OrderService {
  return new OrderService(options);
}
