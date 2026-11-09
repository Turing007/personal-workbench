import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CompanyRepository } from '../db/company-repository.js';
import { CompanyRepositoryError } from '../db/company-repository.js';
import { ApiError, asRecord, parseId, sendFailure, sendSuccess } from './api-response.js';

interface IdParams { id: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function companyInput(body: Record<string, unknown>) {
  const rawActive = body.isActive ?? body.is_active;
  return {
    shortName: text(body.shortName ?? body.short_name),
    fullName: text(body.fullName ?? body.full_name),
    taxNo: text(body.taxNo ?? body.tax_no),
    bankName: text(body.bankName ?? body.bank_name),
    bankAccount: text(body.bankAccount ?? body.bank_account),
    address: text(body.address),
    phone: text(body.phone),
    contactName: text(body.contactName ?? body.contact_name),
    remark: text(body.remark),
    isActive: rawActive == null ? undefined : !(rawActive === false || rawActive === 'false' || rawActive === 0 || rawActive === '0'),
  };
}

function companyError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof CompanyRepositoryError) {
    const status = error.code === 'COMPANY_NOT_FOUND' ? 404 : error.code === 'COMPANY_IN_USE' || error.code === 'COMPANY_NAME_EXISTS' ? 409 : 400;
    return new ApiError(status, error.code, error.message);
  }
  return new ApiError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : '公司档案处理失败');
}

async function safeRoute<T>(handler: () => T, reply: Parameters<typeof sendFailure>[0]): Promise<unknown> {
  try {
    return sendSuccess(reply, handler());
  } catch (error) {
    return sendFailure(reply, companyError(error));
  }
}

export interface CompanyRouteOptions {
  repository: CompanyRepository;
}

export async function registerCompanyRoutes(app: FastifyInstance, options: CompanyRouteOptions): Promise<void> {
  app.get('/api/finance/companies', async (request, reply) => safeRoute(() => {
    const query = request.query as Record<string, string | undefined>;
    return { items: options.repository.list(query.includeInactive === '1' || query.includeInactive === 'true') };
  }, reply));

  app.post('/api/finance/companies', async (request, reply) => safeRoute(() => {
    return options.repository.create(companyInput(asRecord(request.body)));
  }, reply));

  app.put('/api/finance/companies/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    return options.repository.update(parseId(request.params.id), companyInput(asRecord(request.body)));
  }, reply));

  app.delete('/api/finance/companies/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    options.repository.remove(parseId(request.params.id));
    return { id: Number(request.params.id) };
  }, reply));
}
