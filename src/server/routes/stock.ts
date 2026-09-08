import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as XLSX from 'xlsx';
import { formatStockItemLine } from '../../shared/stock.js';
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
function parseScopeDate(request: FastifyRequest<{ Querystring: { date?: string } }>): string | null {
  const raw = request.query?.date?.trim() ?? '';
  if (!raw || raw === 'all') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '日期格式应为 YYYY-MM-DD 或 all', 'date');
  }
  return raw;
}

/** Excel 首行标题文本：日期范围显示为「9月8日」，全部待备货显示汇总说明。 */
function scopeTitle(date: string | null): string {
  if (!date) return '备货表（全部待备货）';
  const [, month, day] = date.split('-').map((part) => Number(part));
  return `${month}月${day}日`;
}

function preparationWorkbookBuffer(preparation: ReturnType<StockPreparationService['getPreparation']>): Buffer {
  const rows: Array<[string, string]> = [
    [scopeTitle(preparation.scope === 'all' ? null : preparation.scope), ''],
    ['供应商', '备货明细'],
  ];
  for (const group of preparation.groups) {
    rows.push([group.title, group.items.map(formatStockItemLine).join('\n')]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 16 }, { wch: 90 }];
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '备货表');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export async function registerStockRoutes(app: FastifyInstance, options: StockRouteOptions): Promise<void> {
  app.get('/api/stock/preparation', async (
    request: FastifyRequest<{ Querystring: { date?: string } }>,
    reply,
  ) => safeRoute(() => {
    const preparation = options.service.getPreparation(parseScopeDate(request));
    return sendSuccess(reply, preparation);
  }, reply));

  app.get('/api/stock/preparation/export', async (
    request: FastifyRequest<{ Querystring: { date?: string } }>,
    reply,
  ) => safeRoute(() => {
    const preparation = options.service.getPreparation(parseScopeDate(request));
    const datePart = preparation.scope === 'all' ? '全部待备货' : preparation.scope;
    const fileName = `备货表-${datePart}.xlsx`;
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="stock-preparation.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .send(preparationWorkbookBuffer(preparation));
  }, reply));
}
