import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { Readable } from 'node:stream';
import type { CreateOrderInput, DatabaseRepositories, PackagingInput } from '../db/repositories.js';
import { CustomerProductRepository } from '../db/customer-product-repository.js';
import { CustomerRepository } from '../db/customer-repository.js';
import { FileStore, FileStoreError } from '../files/file-store.js';
import {
  ApiError,
  asRecord,
  finiteNumber,
  mapDatabaseError,
  optionalText,
  parseId,
  positiveInteger,
  requiredText,
  sendFailure,
  sendSuccess,
} from './api-response.js';
import { normalizeOrderStatus, OrderCustomerError, OrderService } from '../services/order-service.js';
import { orderDateKey } from '../services/order-number-service.js';
import { isSettlementType } from '../../shared/settlement.js';
import { assertMultipartFileNotTruncated, contractPartsOptions, imagePartsOptions } from './multipart-limits.js';
import { PdfRenderer, PdfRendererError } from '../documents/pdf-renderer.js';
import { renderContractHtml } from '../documents/contract-template.js';
import type { SettingsRepository } from '../db/settings-repository.js';

interface OrderRouteOptions {
  repositories: DatabaseRepositories;
  customerRepository?: CustomerRepository;
  customerProductRepository?: CustomerProductRepository;
  fileStore?: FileStore;
  service?: OrderService;
  settingsRepository?: SettingsRepository;
  pdfRenderer?: Pick<PdfRenderer, 'render'>;
}

interface IdParams {
  id: string;
}

function parsePackaging(value: unknown, field = 'packaging'): PackagingInput[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', '包装方案不能为空', field);
  return value.map((raw, index) => {
    const item = asRecord(raw);
    const prefix = `${field}[${index}]`;
    return {
      name: optionalText(item.name, `${prefix}.name`, '包装名称'),
      innerSize: optionalText(item.innerSize, `${prefix}.innerSize`, '内盒尺寸'),
      innerWeight: finiteNumber(item.innerWeight, `${prefix}.innerWeight`, '内盒重量'),
      outerSize: optionalText(item.outerSize, `${prefix}.outerSize`, '外箱尺寸'),
      outerLength: finiteNumber(item.outerLength, `${prefix}.outerLength`, '外箱长度'),
      outerWidth: finiteNumber(item.outerWidth, `${prefix}.outerWidth`, '外箱宽度'),
      outerHeight: finiteNumber(item.outerHeight, `${prefix}.outerHeight`, '外箱高度'),
      outerWeight: finiteNumber(item.outerWeight, `${prefix}.outerWeight`, '外箱重量'),
      packCount: positiveInteger(item.packCount, `${prefix}.packCount`, '装箱数'),
    };
  });
}

function optionalId(value: unknown, field: string): number | null | undefined {
  if (value === undefined || value === null || value === '') return value === null ? null : undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'ID 必须是正整数', field);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, field: string, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return positiveInteger(value, field, label);
}

function optionalCents(value: unknown, field: string, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label}必须是非负整数分`, field);
  }
  return value;
}

function parseRequirementAttachments(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ApiError(400, 'VALIDATION_ERROR', '客户资料附件必须是数组', field);
  return value.map((raw, index) => {
    const item = asRecord(raw);
    const prefix = `${field}[${index}]`;
    const relativePath = requiredText(item.relativePath ?? item.relative_path, `${prefix}.relativePath`, '附件路径');
    if (!relativePath.startsWith('order-item-requirements/') && !relativePath.startsWith('customer-product-attachments/')) {
      throw new ApiError(400, 'VALIDATION_ERROR', '订单产品资料路径无效', `${prefix}.relativePath`);
    }
    const category = optionalText(item.category, `${prefix}.category`, '附件类型') || 'other';
    if (!['label', 'instruction', 'packaging', 'other'].includes(category)) {
      throw new ApiError(400, 'VALIDATION_ERROR', '订单产品资料类型无效', `${prefix}.category`);
    }
    return {
      category: category as 'label' | 'instruction' | 'packaging' | 'other',
      relativePath,
      originalName: optionalText(item.originalName ?? item.original_name, `${prefix}.originalName`, '附件名称'),
      mimeType: optionalText(item.mimeType ?? item.mime_type, `${prefix}.mimeType`, '附件类型'),
      size: Math.max(0, Number(item.size ?? item.size_bytes ?? 0)),
      // 必须保留来源客户产品：服务端靠它复用已归档的附件、并避免编辑时误删磁盘文件。
      sourceCustomerProductId: optionalId(item.sourceCustomerProductId ?? item.source_customer_product_id, `${prefix}.sourceCustomerProductId`),
    };
  });
}

function parseSettlementType(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!isSettlementType(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '结算方式必须是对公或对私', 'settlementType');
  }
  return value;
}

function parseOrderInput(value: unknown, options: { allowEmptyOrderNo?: boolean } = {}): CreateOrderInput {
  const body = asRecord(value);
  if (!Array.isArray(body.items)) throw new ApiError(400, 'VALIDATION_ERROR', '订单至少需要一行产品', 'items');
  // 草稿允许收件人暂缺，由服务层在发布时强制校验。
  const isDraft = body.isDraft === true || body.isDraft === 'true';
  return {
    orderNo: options.allowEmptyOrderNo
      ? optionalText(body.orderNo, 'orderNo', '订单号')
      : requiredText(body.orderNo, 'orderNo', '订单号'),
    orderedAt: requiredText(body.orderedAt, 'orderedAt', '下单时间'),
    isDraft: isDraft || undefined,
    customerId: optionalId(body.customerId, 'customerId'),
    customerName: optionalText(body.customerName, 'customerName', '客户名称'),
    customerContactName: optionalText(body.customerContactName, 'customerContactName', '客户联系人'),
    customerContactPhone: optionalText(body.customerContactPhone, 'customerContactPhone', '客户联系电话'),
    customerShippingInfo: optionalText(body.customerShippingInfo, 'customerShippingInfo', '客户常用收件信息'),
    recipientName: isDraft
      ? optionalText(body.recipientName, 'recipientName', '收件人名称')
      : requiredText(body.recipientName, 'recipientName', '收件人名称'),
    recipientInfo: optionalText(body.recipientInfo, 'recipientInfo', '收件信息'),
    amount: finiteNumber(body.amount, 'amount', '订单金额'),
    amountCents: optionalCents(body.amountCents, 'amountCents', '订单金额'),
    shippingCents: optionalCents(body.shippingCents, 'shippingCents', '运费'),
    trackingNo: optionalText(body.trackingNo, 'trackingNo', '物流单号'),
    paymentNote: optionalText(body.paymentNote, 'paymentNote', '付款备注'),
    orderDetail: optionalText(body.orderDetail, 'orderDetail', '订单详情'),
    remark: optionalText(body.remark, 'remark', '订单备注'),
    settlementType: parseSettlementType(body.settlementType ?? body.settlement_type),
    orderAttachments: parseRequirementAttachments(body.orderAttachments, 'orderAttachments'),
    items: body.items.map((raw, index) => {
      const item = asRecord(raw);
      const prefix = `items[${index}]`;
      return {
        customerProductId: optionalId(item.customerProductId, `${prefix}.customerProductId`),
        name: optionalText(item.name, `${prefix}.name`, '产品品名'),
        sku: optionalText(item.sku, `${prefix}.sku`, 'SKU'),
        specification: optionalText(item.specification, `${prefix}.specification`, '规格'),
        packagingName: optionalText(item.packagingName, `${prefix}.packagingName`, '包装名称'),
        packCount: optionalPositiveInteger(item.packCount, `${prefix}.packCount`, '装箱数'),
        quantity: positiveInteger(item.quantity, `${prefix}.quantity`, '产品数量'),
        unitPriceCents: optionalCents(item.unitPriceCents, `${prefix}.unitPriceCents`, '单价'),
        freightPerBoxCents: optionalCents(item.freightPerBoxCents, `${prefix}.freightPerBoxCents`, '运费/箱'),
        packaging: parsePackaging(item.packaging, `${prefix}.packaging`),
        remark: optionalText(item.remark, `${prefix}.remark`, '产品备注'),
        labelRequirement: optionalText(item.labelRequirement, `${prefix}.labelRequirement`, '箱唛要求'),
      };
    }),
  };
}

function serviceError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof PdfRendererError) return new ApiError(500, error.code, error.message);
  if (error instanceof FileStoreError) {
    if (error.code === 'UNSUPPORTED_CONTRACT_TYPE') return new ApiError(415, error.code, error.message, 'file');
    if (error.code === 'CONTRACT_TOO_LARGE') return new ApiError(413, error.code, error.message, 'file');
    if (error.code === 'UNSUPPORTED_IMAGE_TYPE') return new ApiError(415, error.code, error.message, 'file');
    if (error.code === 'IMAGE_TOO_LARGE') return new ApiError(413, error.code, error.message, 'file');
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed.*orders\.order_no/i.test(message)) {
    return new ApiError(409, 'ORDER_NO_EXISTS', '订单号已存在', 'orderNo');
  }
  if (error instanceof OrderCustomerError) {
    const status = error.code === 'CUSTOMER_NOT_FOUND' || error.code === 'CUSTOMER_PRODUCT_NOT_FOUND' ? 404 : 409;
    return new ApiError(status, error.code, error.message);
  }
  if (/UNIQUE constraint failed|CHECK constraint failed|FOREIGN KEY constraint failed/i.test(message)) return mapDatabaseError(error);
  return new ApiError(400, 'VALIDATION_ERROR', message || '请求数据无效');
}

async function safeRoute<T>(handler: () => Promise<T> | T, reply: Parameters<typeof sendFailure>[0]): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, serviceError(error));
  }
}

function mapProofs(proofs: ReturnType<OrderService['listPaymentProofs']>) {
  return proofs.map((proof) => ({
    id: proof.id,
    orderId: proof.orderId,
    relativePath: proof.relativePath,
    originalName: proof.originalName,
    mimeType: proof.mimeType,
    size: proof.size,
    note: proof.note,
    createdAt: proof.createdAt,
    url: `/files/${proof.relativePath}`,
  }));
}

function mapContracts(contracts: ReturnType<OrderService['listContracts']>) {
  return contracts.map((contract) => ({
    id: contract.id,
    orderId: contract.orderId,
    relativePath: contract.relativePath,
    originalName: contract.originalName,
    mimeType: contract.mimeType,
    size: contract.size,
    createdAt: contract.createdAt,
    category: contract.category,
    sourceCustomerProductId: contract.sourceCustomerProductId,
    url: `/files/${contract.relativePath}`,
  }));
}

function mapOrderDetailImages(images: ReturnType<OrderService['listOrderDetailImages']>) {
  return images.map((image) => ({
    id: image.id,
    orderId: image.orderId,
    relativePath: image.relativePath,
    originalName: image.originalName,
    mimeType: image.mimeType,
    size: image.size,
    createdAt: image.createdAt,
    url: `/files/${image.relativePath}`,
  }));
}

function multipartFieldText(part: MultipartFile, fieldName: string): string {
  const field = part.fields[fieldName];
  if (!field || Array.isArray(field) || field.type !== 'field') return '';
  return String(field.value ?? '').trim();
}

export async function registerOrderRoutes(app: FastifyInstance, options: OrderRouteOptions): Promise<void> {
  const service = options.service ?? new OrderService(options);
  const pdfRenderer = options.pdfRenderer ?? new PdfRenderer();
  const settingsRepository = options.settingsRepository;

  app.get('/api/orders', async (request, reply) =>
    safeRoute(() => {
      const query = request.query as Record<string, string | undefined>;
      return sendSuccess(reply, service.list({
        status: query.status,
        q: query.q,
        query: query.query,
        page: query.page ? Number(query.page) : undefined,
        pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      }));
    }, reply),
  );

  app.post('/api/orders', async (request, reply) =>
    safeRoute(async () => {
      const input = parseOrderInput(request.body, { allowEmptyOrderNo: true });
      // 创建人来自会话，而非请求体，保证留痕可信。
      const order = await service.create({ ...input, createdBy: request.user?.username ?? '' });
      return sendSuccess(reply, order, 201);
    }, reply),
  );

  app.get('/api/orders/next-number', async (_request, reply) =>
    safeRoute(() => sendSuccess(reply, {
      number: options.repositories.previewNextOrderNumber(),
      date: orderDateKey(new Date()),
    }), reply),
  );

  app.get('/api/orders/:id/contracts', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const orderId = parseId(request.params.id);
      if (!service.get(orderId)) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      return sendSuccess(reply, { items: mapContracts(service.listContracts(orderId)) });
    }, reply),
  );

  app.post('/api/orders/:id/contracts', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(async () => {
      const orderId = parseId(request.params.id);
      if (!service.get(orderId)) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      let uploaded: Awaited<ReturnType<OrderService['uploadContract']>> | undefined;
      let fileSeen = false;
      for await (const part of request.parts(contractPartsOptions)) {
        if (part.type !== 'file') continue;
        if (fileSeen) throw new ApiError(400, 'FILE_COUNT_INVALID', '一次只能上传一个合同文件');
        fileSeen = true;
        if (part.fieldname !== 'file') throw new ApiError(400, 'FILE_FIELD_INVALID', '合同文件字段必须是 file', 'file');
        const fileBuffer = await part.toBuffer();
        // throwFileSizeLimit 关掉了：超限文件会被截断，直接流式存库就是一条“看起来正常”的损坏附件。
        assertMultipartFileNotTruncated(part, 'contract');
        uploaded = await service.uploadContract(orderId, Readable.from(fileBuffer), part.filename, part.mimetype);
      }
      if (!fileSeen || !uploaded) throw new ApiError(400, 'FILE_REQUIRED', '请选择合同文件', 'file');
      return sendSuccess(reply, { ...uploaded, url: `/files/${uploaded.relativePath}` }, 201);
    }, reply),
  );

  app.post('/api/orders/:id/contracts/generate', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(async () => {
      if (!settingsRepository) throw new ApiError(500, 'SETTINGS_UNAVAILABLE', '设置存储尚未配置');
      const orderId = parseId(request.params.id);
      const detail = options.repositories.getOrderDetail(orderId);
      if (!detail) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      // getOrderDetail 返回扁平结构：订单列在顶层，items/labels 等作为附加字段。
      const orderRow = detail as unknown as Record<string, unknown>;
      // 按当前模板渲染合同 PDF，并归档一份到订单合同附件，方便后续重复下载。
      const html = renderContractHtml({
        template: settingsRepository.getContractTemplate(),
        company: settingsRepository.getCompanyProfile(),
        order: orderRow,
        items: detail.items as Record<string, unknown>[],
        generatedAt: new Date().toISOString(),
      });
      const pdf = await pdfRenderer.render(html);
      const filename = `${String(orderRow.order_no ?? orderId)}-购销合同.pdf`;
      await service.uploadContract(orderId, Readable.from(pdf), filename, 'application/pdf');
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="contract-${orderId}.pdf"`)
        .send(pdf);
    }, reply),
  );

  app.get('/api/orders/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const order = service.get(parseId(request.params.id));
      if (!order) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      return sendSuccess(reply, order);
    }, reply),
  );

  app.get('/api/orders/:id/detail', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const orderId = parseId(request.params.id);
      const order = service.get(orderId);
      if (!order) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      const financeRow = options.repositories.getOrderFinanceSummary(orderId) as Record<string, unknown> | undefined;
      const financeSummary = financeRow ? {
        orderId: Number(financeRow.order_id),
        receivableCents: Number(financeRow.receivable_cents ?? 0),
        receivedCents: Number(financeRow.received_cents ?? 0),
        outstandingCents: Number(financeRow.outstanding_cents ?? 0),
        paymentStatus: String(financeRow.payment_status ?? 'unpaid'),
        proofStatus: String(financeRow.proof_status ?? 'none'),
        invoiceStatus: String(financeRow.invoice_status ?? 'not_requested'),
        updatedAt: String(financeRow.updated_at ?? ''),
      } : null;
      return sendSuccess(reply, {
        ...order,
        paymentNote: String((order as Record<string, unknown>).payment_note ?? ''),
        paymentProofs: mapProofs(service.listPaymentProofs(orderId)),
        contracts: mapContracts(service.listContracts(orderId)),
        orderDetailImages: mapOrderDetailImages(service.listOrderDetailImages(orderId)),
        financeSummary,
      });
    }, reply),
  );

  app.put('/api/orders/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(async () => {
      const order = await service.update(parseId(request.params.id), parseOrderInput(request.body));
      if (!order) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      return sendSuccess(reply, order);
    }, reply),
  );

  // 发布草稿订单：draft → pending_stock，进入正式流程。
  app.post('/api/orders/:id/publish', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const order = service.publish(parseId(request.params.id));
      if (!order) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      return sendSuccess(reply, order);
    }, reply),
  );

  app.delete('/api/orders/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(async () => {
      if (!await service.delete(parseId(request.params.id))) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      return sendSuccess(reply, null);
    }, reply),
  );

  app.post('/api/orders/:id/status', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const body = asRecord(request.body);
      const reason = body.reason === undefined ? 'manual' : body.reason;
      if (reason !== 'manual' && reason !== 'first-print') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'reason 必须是 manual 或 first-print', 'reason');
      }
      const order = service.transition(
        parseId(request.params.id),
        normalizeOrderStatus(body.to),
        reason,
        body.trackingNo == null ? undefined : optionalText(body.trackingNo, 'trackingNo', '物流单号'),
      );
      if (!order) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      return sendSuccess(reply, order);
    }, reply),
  );

  // 只回填物流单号，不推进状态：发货工作区允许给还没到「待发货」的订单先把单号存下来。
  app.patch('/api/orders/:id/tracking', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const orderId = parseId(request.params.id);
      if (!service.get(orderId)) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      const trackingNo = optionalText(asRecord(request.body).trackingNo, 'trackingNo', '物流单号');
      options.repositories.updateOrderTracking(orderId, trackingNo);
      return sendSuccess(reply, { id: orderId, trackingNo });
    }, reply),
  );

  app.get('/api/orders/:id/payment-proofs', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const orderId = parseId(request.params.id);
      if (!service.get(orderId)) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      return sendSuccess(reply, { items: mapProofs(service.listPaymentProofs(orderId)) });
    }, reply),
  );

  app.post('/api/orders/:id/payment-proofs', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(async () => {
      const orderId = parseId(request.params.id);
      if (!service.get(orderId)) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      let file: MultipartFile | undefined;
      let fileBuffer: Buffer | undefined;
      let note = '';
      for await (const part of request.parts(imagePartsOptions)) {
        if (part.type === 'file') {
          if (file) throw new ApiError(400, 'FILE_COUNT_INVALID', '一次只能上传一个付款凭证');
          file = part;
          fileBuffer = await part.toBuffer();
          assertMultipartFileNotTruncated(file, 'image');
        } else if (part.fieldname === 'note') {
          note = String(part.value ?? '').trim();
        }
      }
      if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择付款凭证', 'file');
      const proof = await service.uploadPaymentProof(orderId, Readable.from(fileBuffer ?? Buffer.alloc(0)), file.filename, file.mimetype, note);
      return sendSuccess(reply, {
        ...proof,
        url: `/files/${proof.relativePath}`,
      }, 201);
    }, reply),
  );

  app.get('/api/orders/:id/detail-images', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const orderId = parseId(request.params.id);
      if (!service.get(orderId)) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      return sendSuccess(reply, { items: mapOrderDetailImages(service.listOrderDetailImages(orderId)) });
    }, reply),
  );

  app.get('/api/orders/:id/items-images', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const orderId = parseId(request.params.id);
      return sendSuccess(reply, { itemImages: options.repositories.getOrderItemImages(orderId) });
    }, reply),
  );

  app.post('/api/orders/:id/detail-images', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(async () => {
      const orderId = parseId(request.params.id);
      if (!service.get(orderId)) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      let file: MultipartFile | undefined;
      let fileBuffer: Buffer | undefined;
      for await (const part of request.parts(imagePartsOptions)) {
        if (part.type !== 'file') continue;
        if (file) throw new ApiError(400, 'FILE_COUNT_INVALID', '一次只能上传一张订单详情图片');
        if (part.fieldname !== 'file') throw new ApiError(400, 'FILE_FIELD_INVALID', '图片字段必须是 file', 'file');
        file = part;
        fileBuffer = await part.toBuffer();
        assertMultipartFileNotTruncated(file, 'image');
      }
      if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择订单详情图片', 'file');
      const image = await service.uploadOrderDetailImage(orderId, Readable.from(fileBuffer ?? Buffer.alloc(0)), file.filename, file.mimetype);
      return sendSuccess(reply, { ...image, url: `/files/${image.relativePath}` }, 201);
    }, reply),
  );

  app.delete('/api/order-contracts/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(async () => {
      const deleted = await service.deleteContract(parseId(request.params.id));
      if (!deleted) throw new ApiError(404, 'NOT_FOUND', '合同附件不存在');
      return sendSuccess(reply, { ...deleted, url: `/files/${deleted.relativePath}` });
    }, reply),
  );

  app.delete('/api/order-detail-images/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(async () => {
      const deleted = await service.deleteOrderDetailImage(parseId(request.params.id));
      if (!deleted) throw new ApiError(404, 'NOT_FOUND', '订单详情图片不存在');
      return sendSuccess(reply, { ...deleted, url: `/files/${deleted.relativePath}` });
    }, reply),
  );
}

export async function registerPaymentProofDeleteRoute(app: FastifyInstance, options: OrderRouteOptions): Promise<void> {
  const service = new OrderService(options);
  app.delete('/api/payment-proofs/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(async () => {
      const deleted = await service.deletePaymentProof(parseId(request.params.id));
      if (!deleted) throw new ApiError(404, 'NOT_FOUND', '付款凭证不存在');
      return sendSuccess(reply, deleted);
    }, reply),
  );
}

export const orderRoutes = registerOrderRoutes;
