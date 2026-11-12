import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { Readable } from 'node:stream';
import { FinanceService, FinanceServiceError, type FinanceInvoiceInput, type FinanceProofInput } from '../services/finance-service.js';
import type { FinanceListFilters } from '../../shared/finance.js';
import type { FileStore } from '../files/file-store.js';
import { FileStoreError } from '../files/file-store.js';
import { ApiError, asRecord, parseId, sendFailure, sendSuccess } from './api-response.js';
import { assertMultipartFileNotTruncated, contractPartsOptions, imagePartsOptions } from './multipart-limits.js';

interface IdParams { id: string }
interface OrderParams { orderId: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function listValues(value?: string): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function listIds(value?: string): number[] {
  return listValues(value)
    .map((item) => Number(item))
    .filter((item) => Number.isSafeInteger(item) && item > 0);
}

function parseOptionalNumber(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function financeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof FinanceServiceError) {
    const notFound = new Set(['FINANCE_ORDER_NOT_FOUND', 'PROOF_NOT_FOUND', 'INVOICE_NOT_FOUND']);
    const conflict = new Set([
      'PROOF_ALREADY_REVIEWED', 'PROOF_ALREADY_VOID', 'PROOF_TRANSACTION_EXISTS', 'RECEIPT_EXISTS',
      'RECEIPT_EXCEEDS_ORDER', 'INVOICE_AMOUNT_EXCEEDS_ORDER', 'INVOICE_ALREADY_VOID', 'INVALID_FINANCE_STATUS',
    ]);
    return new ApiError(notFound.has(error.code) ? 404 : conflict.has(error.code) ? 409 : error.code === 'FILE_STORE_REQUIRED' ? 503 : 400, error.code, error.message);
  }
  if (error instanceof FileStoreError) {
    const status = error.code === 'INVOICE_TOO_LARGE' || error.code === 'IMAGE_TOO_LARGE' ? 413 : 415;
    return new ApiError(status, error.code, error.message);
  }
  return new ApiError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : '服务器处理请求失败');
}

async function safeRoute<T>(handler: () => Promise<T> | T, reply: Parameters<typeof sendFailure>[0]): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, financeError(error));
  }
}

function mapProof(proof: unknown) {
  const item = (proof && typeof proof === 'object' ? proof : {}) as Record<string, unknown>;
  const relativePath = String(item.relativePath ?? item.relative_path ?? '');
  return { ...item, url: `/files/${relativePath}` };
}

function mapInvoice(invoice: unknown) {
  const item = (invoice && typeof invoice === 'object' ? invoice : {}) as Record<string, unknown>;
  const files = Array.isArray(item.files) ? item.files : [];
  return {
    ...item,
    files: files.map((rawFile) => {
      const file = (rawFile && typeof rawFile === 'object' ? rawFile : {}) as Record<string, unknown>;
      return { ...file, url: `/files/${String(file.relativePath ?? file.relative_path ?? '')}` };
    }),
  };
}

function proofInputFromRecord(body: Record<string, unknown>): FinanceProofInput {
  return {
    paymentDate: body.paymentDate ?? body.payment_date,
    amountCents: parseOptionalNumber(body.amountCents ?? body.amount_cents),
    paymentMethod: body.paymentMethod ?? body.payment_method,
    payerName: body.payerName ?? body.payer_name,
    transactionNo: body.transactionNo ?? body.transaction_no,
    note: body.note,
  };
}

function invoiceInputFromRecord(body: Record<string, unknown>): FinanceInvoiceInput {
  return {
    invoiceType: body.invoiceType ?? body.invoice_type,
    title: body.title,
    taxNo: body.taxNo ?? body.tax_no,
    recipientEmail: body.recipientEmail ?? body.recipient_email,
    recipientAddress: body.recipientAddress ?? body.recipient_address,
    amountCents: parseOptionalNumber(body.amountCents ?? body.amount_cents),
    taxRateBps: parseOptionalNumber(body.taxRateBps ?? body.tax_rate_bps),
    taxCents: parseOptionalNumber(body.taxCents ?? body.tax_cents),
    invoiceCode: body.invoiceCode ?? body.invoice_code,
    invoiceNo: body.invoiceNo ?? body.invoice_no,
    issuedAt: body.issuedAt ?? body.issued_at,
    sentAt: body.sentAt ?? body.sent_at,
    remark: body.remark,
  };
}

function fieldValue(value: unknown): string {
  if (!value || Array.isArray(value) || typeof value !== 'object' || !('type' in value)) return '';
  const field = value as { type?: string; value?: unknown };
  return field.type === 'field' ? String(field.value ?? '').trim() : '';
}

async function parseProofMultipart(request: FastifyRequest): Promise<{ file: MultipartFile; buffer: Buffer<ArrayBufferLike>; input: FinanceProofInput }> {
  let file: MultipartFile | undefined;
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const fields: Record<string, string> = {};
  for await (const part of request.parts(imagePartsOptions)) {
    if (part.type === 'field') {
      fields[part.fieldname] = String(part.value ?? '').trim();
      continue;
    }
    if (file) throw new ApiError(400, 'FILE_COUNT_INVALID', '一次只能上传一张水单');
    if (part.fieldname !== 'file') throw new ApiError(400, 'FILE_FIELD_INVALID', '水单文件字段必须是 file', 'file');
    file = part;
    buffer = await part.toBuffer();
    assertMultipartFileNotTruncated(part, 'image');
  }
  if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择水单文件', 'file');
  return {
    file,
    buffer,
    input: {
      paymentDate: fields.paymentDate,
      amountCents: parseOptionalNumber(fields.amountCents),
      paymentMethod: fields.paymentMethod,
      payerName: fields.payerName,
      transactionNo: fields.transactionNo,
      note: fields.note,
    },
  };
}

async function parseInvoiceFile(request: FastifyRequest): Promise<{ file: MultipartFile; buffer: Buffer<ArrayBufferLike> }> {
  let file: MultipartFile | undefined;
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  for await (const part of request.parts(contractPartsOptions)) {
    if (part.type === 'field') continue;
    if (file) throw new ApiError(400, 'FILE_COUNT_INVALID', '一次只能上传一个发票文件');
    if (part.fieldname !== 'file') throw new ApiError(400, 'FILE_FIELD_INVALID', '发票文件字段必须是 file', 'file');
    file = part;
    buffer = await part.toBuffer();
    assertMultipartFileNotTruncated(part, 'contract');
  }
  if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择发票文件', 'file');
  return { file, buffer };
}

export interface FinanceRouteOptions {
  service: FinanceService;
  fileStore?: Pick<FileStore, 'saveFile'>;
}

export async function registerFinanceRoutes(app: FastifyInstance, options: FinanceRouteOptions): Promise<void> {
  const service = options.service;

  app.get('/api/finance/orders', async (request, reply) => safeRoute(() => {
    const query = request.query as Record<string, string | undefined>;
    const filters: FinanceListFilters = {
      query: query.q ?? query.query,
      orderNo: query.orderNo,
      customerName: query.customerName,
      month: query.month,
      paymentStatus: query.paymentStatus as FinanceListFilters['paymentStatus'],
      proofStatus: query.proofStatus as FinanceListFilters['proofStatus'],
      invoiceStatus: query.invoiceStatus as FinanceListFilters['invoiceStatus'],
      orderStatus: query.orderStatus,
      companyId: query.companyId === 'unassigned'
        ? 'unassigned'
        : query.companyId && Number.isSafeInteger(Number(query.companyId)) && Number(query.companyId) > 0
          ? Number(query.companyId)
          : undefined,
      companyIds: listIds(query.companyIds),
      includeUnassignedCompany: query.includeUnassignedCompany === '1' || query.includeUnassignedCompany === 'true',
      paymentStatuses: listValues(query.paymentStatuses) as FinanceListFilters['paymentStatuses'],
      proofStatuses: listValues(query.proofStatuses) as FinanceListFilters['proofStatuses'],
      invoiceStatuses: listValues(query.invoiceStatuses) as FinanceListFilters['invoiceStatuses'],
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    };
    return sendSuccess(reply, service.list(filters));
  }, reply));

  app.get('/api/finance/orders/:orderId', async (request: FastifyRequest<{ Params: OrderParams }>, reply) => safeRoute(() => {
    const detail = service.get(parseId(request.params.orderId, 'orderId'));
    if (!detail) throw new FinanceServiceError('FINANCE_ORDER_NOT_FOUND', '订单不存在');
    return sendSuccess(reply, {
      ...detail,
      proofs: detail.proofs.map(mapProof),
      invoices: detail.invoices.map(mapInvoice),
    });
  }, reply));

  app.get('/api/finance/proofs', async (request, reply) => safeRoute(() => {
    const query = request.query as Record<string, string | undefined>;
    return sendSuccess(reply, {
      items: service.listProofs({
        month: query.month,
        status: query.status as import('../../shared/finance.js').PaymentProofStatus | undefined,
        companyId: query.companyId === 'unassigned'
          ? 'unassigned'
          : query.companyId && Number.isSafeInteger(Number(query.companyId)) && Number(query.companyId) > 0
            ? Number(query.companyId)
            : undefined,
        companyIds: listIds(query.companyIds),
        includeUnassignedCompany: query.includeUnassignedCompany === '1' || query.includeUnassignedCompany === 'true',
        statuses: listValues(query.statuses) as import('../../shared/finance.js').PaymentProofStatus[],
        query: query.q ?? query.query,
        limit: query.limit ? Number(query.limit) : undefined,
      }),
    });
  }, reply));

  app.get('/api/finance/orders/:orderId/proofs', async (request: FastifyRequest<{ Params: OrderParams }>, reply) => safeRoute(() => {
    const detail = service.get(parseId(request.params.orderId, 'orderId'));
    if (!detail) throw new FinanceServiceError('FINANCE_ORDER_NOT_FOUND', '订单不存在');
    return sendSuccess(reply, { items: detail.proofs.map(mapProof) });
  }, reply));

  app.post('/api/finance/orders/:orderId/proofs', async (request: FastifyRequest<{ Params: OrderParams }>, reply) => safeRoute(async () => {
    const orderId = parseId(request.params.orderId, 'orderId');
    const parsed = await parseProofMultipart(request);
    const proof = await service.uploadProof(orderId, Readable.from(parsed.buffer), parsed.file.filename, parsed.file.mimetype, parsed.input);
    return sendSuccess(reply, mapProof(proof as unknown as Record<string, unknown>), 201);
  }, reply));

  app.put('/api/finance/proofs/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    const proof = service.updateProof(parseId(request.params.id), proofInputFromRecord(asRecord(request.body)));
    return sendSuccess(reply, mapProof(proof as unknown as Record<string, unknown>));
  }, reply));

  app.post('/api/finance/proofs/:id/approve', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    const body = request.body == null ? {} : asRecord(request.body);
    const detail = service.approveProof(parseId(request.params.id), text(body.payeeName ?? body.payee_name));
    return sendSuccess(reply, { ...detail, proofs: detail.proofs.map(mapProof), invoices: detail.invoices.map(mapInvoice) });
  }, reply));

  app.get('/api/finance/receipts/by-payee', async (request, reply) => safeRoute(() => {
    const query = request.query as Record<string, string | undefined>;
    return sendSuccess(reply, { items: service.listPayeeBreakdown(query.month) });
  }, reply));

  app.get('/api/finance/receipts/by-company', async (request, reply) => safeRoute(() => {
    const query = request.query as Record<string, string | undefined>;
    return sendSuccess(reply, { items: service.listCompanyBreakdown(query.month) });
  }, reply));

  app.get('/api/finance/companies/stats', async (request, reply) => safeRoute(() => {
    const query = request.query as Record<string, string | undefined>;
    return sendSuccess(reply, { items: service.listCompanyStats(query.month) });
  }, reply));

  app.get('/api/finance/orders/lookup', async (request, reply) => safeRoute(() => {
    const query = request.query as Record<string, string | undefined>;
    return sendSuccess(reply, { items: service.lookupOrders(query.orderNo ?? '') });
  }, reply));

  app.post('/api/finance/proofs/:id/reject', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    const body = asRecord(request.body);
    const detail = service.rejectProof(parseId(request.params.id), text(body.note ?? body.reviewNote));
    return sendSuccess(reply, { ...detail, proofs: detail.proofs.map(mapProof), invoices: detail.invoices.map(mapInvoice) });
  }, reply));

  app.post('/api/finance/proofs/:id/void', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    const body = request.body == null ? {} : asRecord(request.body);
    const detail = service.voidProof(parseId(request.params.id), text(body.note));
    return sendSuccess(reply, { ...detail, proofs: detail.proofs.map(mapProof), invoices: detail.invoices.map(mapInvoice) });
  }, reply));

  app.delete('/api/finance/proofs/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const proof = await service.deleteProof(parseId(request.params.id));
    return sendSuccess(reply, mapProof(proof as unknown as Record<string, unknown>));
  }, reply));

  app.get('/api/finance/orders/:orderId/invoices', async (request: FastifyRequest<{ Params: OrderParams }>, reply) => safeRoute(() => {
    const detail = service.get(parseId(request.params.orderId, 'orderId'));
    if (!detail) throw new FinanceServiceError('FINANCE_ORDER_NOT_FOUND', '订单不存在');
    return sendSuccess(reply, { items: detail.invoices.map(mapInvoice) });
  }, reply));

  app.post('/api/finance/orders/:orderId/invoices', async (request: FastifyRequest<{ Params: OrderParams }>, reply) => safeRoute(() => {
    const invoice = service.createInvoice(parseId(request.params.orderId, 'orderId'), invoiceInputFromRecord(asRecord(request.body)));
    return sendSuccess(reply, mapInvoice(invoice as unknown as Record<string, unknown>), 201);
  }, reply));

  app.put('/api/finance/invoices/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    const invoice = service.updateInvoice(parseId(request.params.id), invoiceInputFromRecord(asRecord(request.body)));
    return sendSuccess(reply, mapInvoice(invoice as unknown as Record<string, unknown>));
  }, reply));

  app.post('/api/finance/invoices/:id/submit', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => sendSuccess(reply, mapInvoice(service.submitInvoice(parseId(request.params.id)) as unknown as Record<string, unknown>)), reply));
  app.post('/api/finance/invoices/:id/issue', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => sendSuccess(reply, mapInvoice(service.issueInvoice(parseId(request.params.id), invoiceInputFromRecord(asRecord(request.body))) as unknown as Record<string, unknown>)), reply));
  app.post('/api/finance/invoices/:id/send', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => sendSuccess(reply, mapInvoice(service.sendInvoice(parseId(request.params.id)) as unknown as Record<string, unknown>)), reply));
  app.post('/api/finance/invoices/:id/void', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    const body = request.body == null ? {} : asRecord(request.body);
    return sendSuccess(reply, mapInvoice(service.voidInvoice(parseId(request.params.id), text(body.note)) as unknown as Record<string, unknown>));
  }, reply));

  app.post('/api/finance/invoices/:id/files', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const parsed = await parseInvoiceFile(request);
    const file = await service.uploadInvoiceFile(parseId(request.params.id), Readable.from(parsed.buffer), parsed.file.filename, parsed.file.mimetype);
    return sendSuccess(reply, { ...file, url: `/files/${file.relativePath}` }, 201);
  }, reply));

  app.delete('/api/finance/invoice-files/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const file = await service.deleteInvoiceFile(parseId(request.params.id));
    return sendSuccess(reply, { ...file, url: `/files/${file.relativePath}` });
  }, reply));
}
