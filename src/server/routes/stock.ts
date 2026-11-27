import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StockPreparationService } from '../services/stock-service.js';
import { ApiError, sendFailure, sendSuccess } from './api-response.js';

interface StockRouteOptions {
  service: StockPreparationService;
}

async function safeRoute<T>(
  handler: () => T | Promise<T>,
  reply: FastifyReply,
): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : '服务器处理请求失败'));
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

export async function registerStockRoutes(app: FastifyInstance, options: StockRouteOptions): Promise<void> {
  app.get('/api/stock/preparation', async (
    request: FastifyRequest<{ Querystring: { date?: string; channel?: string } }>,
    reply,
  ) => safeRoute(() => {
    const preparation = options.service.getPreparation(parseScopeDate(request), parseChannel(request));
    return sendSuccess(reply, preparation);
  }, reply));
}
