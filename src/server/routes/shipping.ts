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

interface ShippingRouteOptions {
  repositories: DatabaseRepositories;
}

interface IdParams {
  id: string;
}

function serviceError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
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
}

export const shippingRoutes = registerShippingRoutes;
