import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { StockConfirmationInput } from '../../shared/stock.js';
import { StockPreparationError, StockPreparationService } from '../services/stock-service.js';
import { ApiError, asRecord, sendFailure, sendSuccess } from './api-response.js';

interface StockRouteOptions {
  service: StockPreparationService;
}

function stockError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof StockPreparationError) {
    return new ApiError(error.code === 'CONFIRMATION_UNAVAILABLE' ? 503 : 409, error.code, error.message);
  }
  return new ApiError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : '服务器处理请求失败');
}

async function safeRoute<T>(
  handler: () => T | Promise<T>,
  reply: FastifyReply,
): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, stockError(error));
  }
}

/** 解析 scope 查询参数：缺省或 'all' 表示全部待备货，否则必须是 YYYY-MM-DD。 */
function parseScopeDate(request: FastifyRequest<{ Querystring: { date?: string; channel?: string } }>): string | null {
  const raw = request.query?.date?.trim() ?? '';
  if (!raw || raw === 'all') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '日期格式应为 YYYY-MM-DD 或 all', 'date');
  }
  return raw;
}

function parseChannel(request: FastifyRequest<{ Querystring: { date?: string; channel?: string } }>): string | undefined {
  const raw = request.query?.channel?.trim();
  if (!raw) return undefined;
  if (raw !== 'online' && raw !== 'offline') {
    throw new ApiError(400, 'VALIDATION_ERROR', '订单渠道必须是线上或线下', 'channel');
  }
  return raw;
}

function parseSupplier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', '供应商不能为空', 'supplier');
  }
  const supplier = value.trim();
  if (supplier.length > 80) {
    throw new ApiError(400, 'VALIDATION_ERROR', '供应商名称不能超过 80 个字', 'supplier');
  }
  return supplier;
}

function parseNote(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', '备注必须是文本', 'note');
  const note = value.trim();
  if (note.length > 200) throw new ApiError(400, 'VALIDATION_ERROR', '备注不能超过 200 个字', 'note');
  return note;
}

export async function registerStockRoutes(app: FastifyInstance, options: StockRouteOptions): Promise<void> {
  app.get('/api/stock/preparation', async (
    request: FastifyRequest<{ Querystring: { date?: string; channel?: string } }>,
    reply,
  ) => safeRoute(() => {
    const preparation = options.service.getPreparation(parseScopeDate(request), parseChannel(request));
    return sendSuccess(reply, preparation);
  }, reply));

  app.get('/api/stock/confirmations', async (
    request: FastifyRequest<{ Querystring: { date?: string; channel?: string; supplier?: string; limit?: string } }>,
    reply,
  ) => safeRoute(() => {
    const rawSupplier = request.query.supplier?.trim();
    const rawLimit = request.query.limit?.trim();
    let limit = 50;
    if (rawLimit) {
      if (!/^\d+$/.test(rawLimit)) throw new ApiError(400, 'VALIDATION_ERROR', 'limit 必须是正整数', 'limit');
      limit = Number(rawLimit);
    }
    const rawDate = request.query.date?.trim();
    let scope: string | undefined;
    if (rawDate && rawDate !== 'all') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        throw new ApiError(400, 'VALIDATION_ERROR', '日期格式应为 YYYY-MM-DD 或 all', 'date');
      }
      scope = rawDate;
    } else if (rawDate === 'all') {
      scope = 'all';
    }
    return sendSuccess(reply, options.service.listConfirmations({
      scope,
      channel: parseChannel(request),
      supplier: rawSupplier || undefined,
      limit,
    }));
  }, reply));

  app.post('/api/stock/confirmations', async (
    request: FastifyRequest<{ Body: Record<string, unknown> }>,
    reply,
  ) => safeRoute(() => {
    const body = asRecord(request.body);
    const rawDate = body.date === undefined || body.date === null ? 'all' : body.date;
    if (typeof rawDate !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', '日期格式应为 YYYY-MM-DD 或 all', 'date');
    const date = rawDate.trim() || 'all';
    if (date !== 'all' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError(400, 'VALIDATION_ERROR', '日期格式应为 YYYY-MM-DD 或 all', 'date');
    }
    const rawChannel = body.channel;
    let channel: StockConfirmationInput['channel'];
    if (rawChannel !== undefined && rawChannel !== null && rawChannel !== '') {
      if (rawChannel !== 'online' && rawChannel !== 'offline') {
        throw new ApiError(400, 'VALIDATION_ERROR', '订单渠道必须是线上或线下', 'channel');
      }
      channel = rawChannel;
    }
    const input: StockConfirmationInput = {
      date,
      channel,
      supplier: parseSupplier(body.supplier),
      note: parseNote(body.note),
    };
    const result = options.service.confirmSupplier(input, request.user?.username ?? '');
    return sendSuccess(reply, result, 201);
  }, reply));
}
