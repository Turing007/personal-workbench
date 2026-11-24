import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseRepositories } from '../db/repositories.js';
import { ApiError, parseId, sendFailure, sendSuccess } from './api-response.js';
import { PdfRenderer, PdfRendererError } from '../documents/pdf-renderer.js';
import { renderReconciliationHtml } from '../documents/reconciliation-template.js';
import { ReconciliationService } from '../services/reconciliation-service.js';
import type { CompanySnapshot } from '../../shared/documents.js';
import type { FileStore } from '../files/file-store.js';

interface ReconciliationRouteOptions {
  repositories: DatabaseRepositories;
  pdfRenderer?: Pick<PdfRenderer, 'render'>;
  settingsRepository?: { getCompanyProfile(): CompanySnapshot };
  fileStore?: Pick<FileStore, 'readFile'>;
}

interface StatementQuery {
  from?: string;
  to?: string;
}

function todayText(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseDate(value: string | undefined, fallback: string, field: string): string {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, 'VALIDATION_ERROR', '日期格式必须是 YYYY-MM-DD', field);
  return value;
}

function statementRange(query: StatementQuery): { from: string; to: string } {
  const today = todayText();
  const from = parseDate(query.from, `${today.slice(0, 7)}-01`, 'from');
  const to = parseDate(query.to, today, 'to');
  if (from > to) throw new ApiError(400, 'VALIDATION_ERROR', '开始日期不能晚于结束日期', 'from');
  return { from, to };
}

async function loadLetterhead(options: ReconciliationRouteOptions): Promise<{ companyName?: string; logoDataUrl?: string }> {
  const profile = options.settingsRepository?.getCompanyProfile();
  const relativePath = String(profile?.logoRelativePath ?? '');
  if (!options.fileStore || !relativePath) return { companyName: profile?.name };
  try {
    const buffer = await options.fileStore.readFile(relativePath);
    const mime = /\.jpe?g$/i.test(relativePath) ? 'image/jpeg' : /\.webp$/i.test(relativePath) ? 'image/webp' : 'image/png';
    return { companyName: profile?.name, logoDataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
  } catch {
    return { companyName: profile?.name };
  }
}

export async function registerReconciliationRoutes(app: FastifyInstance, options: ReconciliationRouteOptions): Promise<void> {
  const service = new ReconciliationService({ repositories: options.repositories });
  const pdfRenderer = options.pdfRenderer ?? new PdfRenderer();

  app.get('/api/finance/reconciliation', async (_request, reply) => sendSuccess(reply, service.list()));

  app.get('/api/finance/reconciliation/:customerId', async (request: FastifyRequest<{ Params: { customerId: string }; Querystring: StatementQuery }>, reply) => {
    try {
      const { from, to } = statementRange(request.query);
      return sendSuccess(reply, service.statement(parseId(request.params.customerId, 'customerId'), from, to));
    } catch (error) {
      if (error instanceof PdfRendererError) return sendFailure(reply, new ApiError(500, error.code, error.message));
      return sendFailure(reply, error instanceof ApiError ? error : new ApiError(400, 'VALIDATION_ERROR', error instanceof Error ? error.message : '对账单生成失败'));
    }
  });

  app.get('/api/finance/reconciliation/:customerId/pdf', async (request: FastifyRequest<{ Params: { customerId: string }; Querystring: StatementQuery }>, reply) => {
    try {
      const { from, to } = statementRange(request.query);
      const customerId = parseId(request.params.customerId, 'customerId');
      const statement = service.statement(customerId, from, to);
      const letterhead = await loadLetterhead(options);
      const pdf = await pdfRenderer.render(renderReconciliationHtml(statement, {
        generatedAt: new Date().toISOString(),
        ...letterhead,
      }));
      const filename = `对账单-${statement.customerName || customerId}-${from}-${to}.pdf`;
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="statement.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .send(pdf);
    } catch (error) {
      if (error instanceof PdfRendererError) return sendFailure(reply, new ApiError(500, error.code, error.message));
      return sendFailure(reply, error instanceof ApiError ? error : new ApiError(400, 'VALIDATION_ERROR', error instanceof Error ? error.message : '对账单生成失败'));
    }
  });
}

export const reconciliationRoutes = registerReconciliationRoutes;
