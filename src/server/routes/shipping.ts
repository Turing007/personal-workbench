import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseRepositories } from '../db/repositories.js';
import {
  ApiError,
  asRecord,
  mapDatabaseError,
  optionalText,
  parseId,
  sendFailure,
  sendSuccess,
} from './api-response.js';
import { ShippingService } from '../services/shipping-service.js';
import { PdfRenderer, PdfRendererError } from '../documents/pdf-renderer.js';
import { renderShippingListHtml } from '../documents/shipping-list-template.js';
import type { PartialShipmentEntryInput, ShipmentRecord } from '../../shared/shipping.js';

interface ShippingRouteOptions {
  repositories: DatabaseRepositories;
  pdfRenderer?: Pick<PdfRenderer, 'render'>;
}

interface IdParams {
  id: string;
}

function serviceError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof PdfRendererError) return new ApiError(500, error.code, error.message);
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed|CHECK constraint failed/i.test(message)) return mapDatabaseError(error);
  return new ApiError(400, 'VALIDATION_ERROR', message || '发货数据无效');
}

async function safeRoute<T>(handler: () => Promise<T> | T, reply: Parameters<typeof sendFailure>[0]): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, serviceError(error));
  }
}

function parseOrderIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'orderIds 必须至少包含一个订单', 'orderIds');
  return value.map((id, index) => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new ApiError(400, 'VALIDATION_ERROR', '订单 ID 必须是正整数', `orderIds[${index}]`);
    return id;
  });
}

function parseConfirmOrders(value: unknown): Array<{ orderId: number; trackingNo: string }> {
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'orders 必须至少包含一个订单', 'orders');
  return value.map((raw, index) => {
    const order = asRecord(raw);
    const orderId = Number(order.orderId);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new ApiError(400, 'VALIDATION_ERROR', '订单 ID 必须是正整数', `orders[${index}].orderId`);
    const trackingNo = optionalText(order.trackingNo, `orders[${index}].trackingNo`, '物流单号');
    if (!trackingNo) throw new ApiError(400, 'VALIDATION_ERROR', '物流单号不能为空', `orders[${index}].trackingNo`);
    return { orderId, trackingNo };
  });
}

function parsePartialEntries(value: unknown): PartialShipmentEntryInput[] {
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'orders 必须至少包含一个订单', 'orders');
  return value.map((raw, index) => {
    const entry = asRecord(raw);
    const orderId = Number(entry.orderId);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new ApiError(400, 'VALIDATION_ERROR', '订单 ID 必须是正整数', `orders[${index}].orderId`);
    const trackingNo = optionalText(entry.trackingNo, `orders[${index}].trackingNo`, '物流单号');
    if (!trackingNo) throw new ApiError(400, 'VALIDATION_ERROR', '物流单号不能为空', `orders[${index}].trackingNo`);
    if (!Array.isArray(entry.items) || entry.items.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', '每单至少选择一个发货产品', `orders[${index}].items`);
    return {
      orderId,
      trackingNo,
      items: entry.items.map((rawItem, itemIndex) => {
        const item = asRecord(rawItem);
        const orderItemId = Number(item.orderItemId);
        const quantity = Number(item.quantity);
        if (!Number.isSafeInteger(orderItemId) || orderItemId <= 0) throw new ApiError(400, 'VALIDATION_ERROR', '产品行 ID 必须是正整数', `orders[${index}].items[${itemIndex}].orderItemId`);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new ApiError(400, 'VALIDATION_ERROR', '本次发货数量必须是正整数', `orders[${index}].items[${itemIndex}].quantity`);
        const boxes = item.boxes == null ? undefined : Number(item.boxes);
        if (boxes != null && (!Number.isSafeInteger(boxes) || boxes <= 0)) throw new ApiError(400, 'VALIDATION_ERROR', '箱数必须是正整数', `orders[${index}].items[${itemIndex}].boxes`);
        return { orderItemId, quantity, boxes };
      }),
    };
  });
}

function mapShipment(shipment: ShipmentRecord) {
  return {
    id: shipment.id,
    shipmentNo: shipment.shipmentNo,
    orderId: shipment.orderId,
    orderNo: shipment.orderNo,
    batchId: shipment.batchId,
    batchNo: shipment.batchNo,
    trackingNo: shipment.trackingNo,
    shippedAt: shipment.shippedAt,
    totalBoxes: shipment.totalBoxes,
    customerName: shipment.customerName,
    recipientName: shipment.recipientName,
    recipientInfo: shipment.recipientInfo,
    remark: shipment.remark,
    companyName: shipment.companyName,
    items: shipment.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      name: item.name,
      sku: item.sku,
      specification: item.specification,
      packCount: item.packCount,
      quantity: item.quantity,
      boxes: item.boxes,
      remainingAfter: item.remainingAfter,
      remark: item.remark,
    })),
  };
}

function mapBatch(batch: ReturnType<ShippingService['getBatch']>) {
  if (!batch) return undefined;
  const rawBatch = batch as unknown as {
    id: unknown;
    batch_no: unknown;
    status: unknown;
    created_at: unknown;
    confirmed_at: unknown;
    orders: Array<Record<string, unknown>>;
  };
  return {
    id: Number(rawBatch.id),
    batchNo: String(rawBatch.batch_no),
    status: String(rawBatch.status),
    createdAt: String(rawBatch.created_at),
    confirmedAt: rawBatch.confirmed_at == null ? null : String(rawBatch.confirmed_at),
    orders: rawBatch.orders.map((order) => ({
      batchOrderId: Number(order.batch_order_id),
      orderId: Number(order.order_id),
      orderNo: String(order.order_no),
      status: String(order.status),
      trackingNo: String(order.tracking_no ?? ''),
      totalBoxes: Math.max(1, Number(order.total_boxes)),
      recipientInfo: String(order.recipient_info ?? ''),
      sortOrder: Number(order.sort_order),
    })),
  };
}

export async function registerShippingRoutes(app: FastifyInstance, options: ShippingRouteOptions): Promise<void> {
  const service = new ShippingService(options);
  const pdfRenderer = options.pdfRenderer ?? new PdfRenderer();

  app.get('/api/shipping/eligible-orders', async (_request, reply) =>
    safeRoute(() => sendSuccess(reply, service.eligibleOrders()), reply),
  );

  app.post('/api/shipping/batches', async (request, reply) =>
    safeRoute(() => {
      const body = asRecord(request.body);
      const batch = service.createBatch(parseOrderIds(body.orderIds));
      return sendSuccess(reply, mapBatch(batch), 201);
    }, reply),
  );

  app.get('/api/shipping/batches/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const batch = service.getBatch(parseId(request.params.id));
      if (!batch) throw new ApiError(404, 'NOT_FOUND', '发货批次不存在');
      return sendSuccess(reply, mapBatch(batch));
    }, reply),
  );

  app.put('/api/shipping/batches/:id/orders/:orderId', async (request: FastifyRequest<{ Params: { id: string; orderId: string } }>, reply) =>
    safeRoute(() => {
      const body = asRecord(request.body);
      const batch = service.updateTracking(
        parseId(request.params.id),
        parseId(request.params.orderId, 'orderId'),
        optionalText(body.trackingNo, 'trackingNo', '物流单号'),
      );
      if (!batch) throw new ApiError(404, 'NOT_FOUND', '发货批次不存在');
      return sendSuccess(reply, mapBatch(batch));
    }, reply),
  );

  app.get('/api/shipping/batches/:id/text', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const text = service.getText(parseId(request.params.id));
      if (text === undefined) throw new ApiError(404, 'NOT_FOUND', '发货批次不存在');
      return sendSuccess(reply, { text });
    }, reply),
  );

  app.post('/api/shipping/batches/:id/confirm', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const batch = service.confirm(parseId(request.params.id));
      if (!batch) throw new ApiError(404, 'NOT_FOUND', '发货批次不存在');
      return sendSuccess(reply, mapBatch(batch));
    }, reply),
  );

  // 发货工作区直接确认：建批次、写单号、确认发货在一个事务里完成。
  app.post('/api/shipping/confirm', async (request, reply) =>
    safeRoute(() => {
      const batch = service.confirmDirect(parseConfirmOrders(asRecord(request.body).orders));
      return sendSuccess(reply, mapBatch(batch), 201);
    }, reply),
  );

  app.post('/api/shipping/partial', async (request, reply) =>
    safeRoute(() => {
      const batch = service.confirmPartial(parsePartialEntries(asRecord(request.body).orders));
      return sendSuccess(reply, { batchId: batch.id, shipments: batch.shipments.map(mapShipment) }, 201);
    }, reply),
  );

  app.get('/api/shipping/orders/:orderId/shipments', async (request: FastifyRequest<{ Params: { orderId: string } }>, reply) =>
    safeRoute(() => sendSuccess(reply, service.listOrderShipments(parseId(request.params.orderId, 'orderId')).map(mapShipment)), reply),
  );

  app.delete('/api/shipping/shipments/:shipmentId', async (request: FastifyRequest<{ Params: { shipmentId: string } }>, reply) =>
    safeRoute(() => {
      const result = service.voidShipment(parseId(request.params.shipmentId, 'shipmentId'));
      if (!result) throw new ApiError(404, 'NOT_FOUND', '发货记录不存在');
      return sendSuccess(reply, result);
    }, reply),
  );

  app.get('/api/shipping/shipments/:shipmentId/pdf', async (request: FastifyRequest<{ Params: { shipmentId: string } }>, reply) => safeRoute(async () => {
    const shipment = service.getShipment(parseId(request.params.shipmentId, 'shipmentId'));
    if (!shipment) throw new ApiError(404, 'NOT_FOUND', '发货记录不存在');
    const pdf = await pdfRenderer.render(renderShippingListHtml([shipment], { generatedAt: new Date().toISOString() }));
    const filename = `${shipment.shipmentNo || shipment.orderNo}-发货清单.pdf`;
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="shipping-list.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(pdf);
  }, reply));

  app.get('/api/shipping/batches/:batchId/pdf', async (request: FastifyRequest<{ Params: { batchId: string } }>, reply) => safeRoute(async () => {
    const batchId = parseId(request.params.batchId, 'batchId');
    const shipments = service.listBatchShipments(batchId);
    if (!shipments.length) throw new ApiError(404, 'NOT_FOUND', '该批次没有发货记录');
    const pdf = await pdfRenderer.render(renderShippingListHtml(shipments, { generatedAt: new Date().toISOString() }));
    const filename = `发货清单-${shipments[0]!.batchNo || batchId}.pdf`;
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="shipping-batch.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(pdf);
  }, reply));
}

export const shippingRoutes = registerShippingRoutes;
