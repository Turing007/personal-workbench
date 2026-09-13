import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseRepositories } from '../db/repositories.js';
import {
  ApiError,
  asRecord,
  mapDatabaseError,
  parseId,
  positiveInteger,
  sendFailure,
  sendSuccess,
} from './api-response.js';
import { LabelService, type LabelInput, type PrintHistoryLabelInput } from '../services/label-service.js';

interface LabelRouteOptions {
  repositories: DatabaseRepositories;
}

interface IdParams {
  id: string;
}

function serviceError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed|CHECK constraint failed/i.test(message)) return mapDatabaseError(error);
  return new ApiError(400, 'VALIDATION_ERROR', message || '箱唛数据无效');
}

async function safeRoute<T>(handler: () => Promise<T> | T, reply: Parameters<typeof sendFailure>[0]): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, serviceError(error));
  }
}

function labelInputs(value: unknown): LabelInput[] {
  if (!Array.isArray(value)) throw new ApiError(400, 'VALIDATION_ERROR', 'labels 必须是数组', 'labels');
  return value.map((entry) => asRecord(entry) as LabelInput);
}

function parseLabelIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 2) throw new ApiError(400, 'VALIDATION_ERROR', '至少选择两个箱唛', 'labelIds');
  return value.map((id, index) => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', '箱唛 ID 必须是正整数', `labelIds[${index}]`);
    }
    return id;
  });
}

export async function registerLabelRoutes(app: FastifyInstance, options: LabelRouteOptions): Promise<void> {
  const service = new LabelService(options);

  app.get('/api/orders/:id/labels', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const labels = service.getOrderLabels(parseId(request.params.id));
      if (!labels) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      return sendSuccess(reply, { labels });
    }, reply),
  );

  app.put('/api/orders/:id/labels', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const body = asRecord(request.body);
      const labels = service.saveOrderLabels(parseId(request.params.id), labelInputs(body.labels));
      if (!labels) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      return sendSuccess(reply, { labels });
    }, reply),
  );

  app.get('/api/carton-labels/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const label = service.repositories.getCartonLabel(parseId(request.params.id));
      if (!label) throw new ApiError(404, 'NOT_FOUND', '箱唛不存在');
      const labels = service.getOrderLabels(Number(label.order_id));
      const result = labels?.find((entry) => entry.id === Number(label.id));
      if (!result) throw new ApiError(404, 'NOT_FOUND', '箱唛不存在');
      return sendSuccess(reply, result);
    }, reply),
  );

  app.put('/api/carton-labels/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) =>
    safeRoute(() => {
      const result = service.updateLabel(parseId(request.params.id), asRecord(request.body) as LabelInput);
      if (!result) throw new ApiError(404, 'NOT_FOUND', '箱唛不存在');
      return sendSuccess(reply, { labels: result });
    }, reply),
  );

  app.post('/api/carton-labels/merge', async (request, reply) =>
    safeRoute(() => {
      const body = asRecord(request.body);
      const orderId = body.orderId;
      if (typeof orderId !== 'number' || !Number.isSafeInteger(orderId) || orderId <= 0) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'orderId 必须是正整数', 'orderId');
      }
      const labels = service.mergeLabels(orderId, parseLabelIds(body.labelIds));
      if (!labels) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
      return sendSuccess(reply, { labels });
    }, reply),
  );

  app.post('/api/labels/print-history', async (request, reply) =>
    safeRoute(() => {
      const body = asRecord(request.body);
      const rawOrderIds = body.orderIds;
      const orderIds = rawOrderIds === undefined ? undefined : (() => {
        if (!Array.isArray(rawOrderIds)) throw new ApiError(400, 'VALIDATION_ERROR', 'orderIds 必须是数组', 'orderIds');
        return rawOrderIds.map((id, index) => {
          if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new ApiError(400, 'VALIDATION_ERROR', '订单 ID 必须是正整数', `orderIds[${index}]`);
          return id;
        });
      })();
      const rawLabels = body.labels;
      const labels = rawLabels === undefined ? undefined : (() => {
        if (!Array.isArray(rawLabels)) throw new ApiError(400, 'VALIDATION_ERROR', 'labels 必须是数组', 'labels');
        return rawLabels.map((label) => asRecord(label) as PrintHistoryLabelInput);
      })();
      const rawActionType = body.actionType;
      if (rawActionType !== undefined && rawActionType !== 'print' && rawActionType !== 'first-print') {
        throw new ApiError(400, 'VALIDATION_ERROR', '打印动作类型无效', 'actionType');
      }
      return sendSuccess(reply, service.recordPrintHistory({
        actionType: rawActionType as 'print' | 'first-print' | undefined,
        orderIds,
        labels,
      }), 201);
    }, reply),
  );

  app.get('/api/labels/print-history', async (request, reply) =>
    safeRoute(() => {
      const query = request.query as Record<string, string | undefined>;
      return sendSuccess(reply, { items: service.listPrintHistory(query.orderId ? parseId(query.orderId, 'orderId') : undefined) });
    }, reply),
  );
}

export const labelRoutes = registerLabelRoutes;
