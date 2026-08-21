import { Readable } from 'node:stream';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ALLOWED_IMAGE_MIME_TYPES } from '../config.js';
import { DocumentAssetError } from '../documents/document-assets.js';
import { PdfRenderer, PdfRendererError } from '../documents/pdf-renderer.js';
import { renderSalesDocumentHtml } from '../documents/sales-document-template.js';
import type { FileStore } from '../files/file-store.js';
import { FileStoreError } from '../files/file-store.js';
import {
  SalesDocumentService,
  SalesDocumentServiceError,
  type SalesDocumentInput,
  type SalesDocumentItemInput,
  type SalesReceiptInput,
} from '../services/sales-document-service.js';
import { DocumentValidationError } from '../../shared/document-validation.js';
import type { PaymentStatus, SalesDocumentStatus } from '../../shared/documents.js';
import { ApiError, asRecord, parseId, sendFailure, sendSuccess } from './api-response.js';
import { assertMultipartFileNotTruncated, imageFileOptions, imagePartsOptions } from './multipart-limits.js';

interface IdParams { id: string }

export interface SalesDocumentRouteOptions {
  service: SalesDocumentService;
  fileStore?: Pick<FileStore, 'readFile' | 'stageImage'>;
  pdfRenderer?: Pick<PdfRenderer, 'render'>;
}

interface BufferedUpload {
  filename: string;
  mimetype: string;
  content: Buffer;
}

function salesError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DocumentValidationError) return new ApiError(400, 'VALIDATION_ERROR', error.message, error.field);
  if (error instanceof SalesDocumentServiceError) {
    const statusCode = error.code === 'SALES_DOCUMENT_NOT_FOUND' || error.code === 'RECEIPT_NOT_FOUND' || error.code === 'QUOTATION_NOT_FOUND' || error.code === 'CUSTOMER_NOT_FOUND' || error.code === 'CUSTOMER_PRODUCT_NOT_FOUND'
      ? 404
      : error.code === 'CONFIRMATION_REQUIRED' || error.code === 'QUOTATION_NOT_WON' || error.code === 'VOID_DOCUMENT_PRESERVED' || error.code === 'CUSTOMER_INACTIVE' || error.code === 'CUSTOMER_PRODUCT_CUSTOMER_MISMATCH'
        ? 409
        : error.code === 'ASSET_MANAGER_REQUIRED' || error.code === 'RECEIPT_FILE_STORE_REQUIRED'
          ? 503
          : 400;
    return new ApiError(statusCode, error.code, error.message, error.field);
  }
  if (error instanceof FileStoreError) {
    const statusCode = error.code === 'IMAGE_TOO_LARGE' ? 413 : error.code === 'UNSUPPORTED_IMAGE_TYPE' ? 415 : 400;
    return new ApiError(statusCode, error.code, error.message);
  }
  if (error instanceof DocumentAssetError) return new ApiError(400, error.code, error.message);
  if (error instanceof PdfRendererError) return new ApiError(500, error.code, error.message);
  return new ApiError(500, 'INTERNAL_ERROR', '服务器处理请求失败');
}

async function safeRoute<T>(handler: () => Promise<T> | T, reply: FastifyReply): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, salesError(error));
  }
}

function parseJsonPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_JSON', 'payload 必须是 JSON 文本', 'payload');
  try {
    return asRecord(JSON.parse(value));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON', 'payload 不是有效的 JSON', 'payload');
  }
}

function assertImageType(file: MultipartFile): void {
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
    throw new ApiError(415, 'UNSUPPORTED_IMAGE_TYPE', '只允许上传 PNG、JPEG 或 WebP 图片', file.fieldname);
  }
}

async function parseMultipartInput(request: FastifyRequest): Promise<SalesDocumentInput> {
  let payload: Record<string, unknown> | undefined;
  const uploads = new Map<string, BufferedUpload>();
  for await (const part of request.parts(imagePartsOptions)) {
    if (part.type === 'field') {
      if (part.fieldname !== 'payload') throw new ApiError(400, 'VALIDATION_ERROR', `不支持的表单字段：${part.fieldname}`, part.fieldname);
      if (payload) throw new ApiError(400, 'VALIDATION_ERROR', 'payload 只能提交一次', 'payload');
      payload = parseJsonPayload(part.value);
      continue;
    }
    const match = /^itemImage\.(.+)$/.exec(part.fieldname);
    if (!match?.[1]) {
      await part.toBuffer();
      throw new ApiError(400, 'VALIDATION_ERROR', `不支持的文件字段：${part.fieldname}`, part.fieldname);
    }
    const clientKey = match[1].trim();
    if (!clientKey || uploads.has(clientKey)) {
      await part.toBuffer();
      throw new ApiError(400, 'FILE_COUNT_INVALID', '每行产品最多上传一张图片', part.fieldname);
    }
    assertImageType(part);
    const content = await part.toBuffer();
    assertMultipartFileNotTruncated(part, 'image');
    uploads.set(clientKey, { filename: part.filename, mimetype: part.mimetype, content });
  }
  if (!payload) throw new ApiError(400, 'VALIDATION_ERROR', '缺少 payload 字段', 'payload');
  if (!Array.isArray(payload.items)) throw new ApiError(400, 'VALIDATION_ERROR', '销售单至少需要一行产品', 'items');
  const usedUploads = new Set<string>();
  const items = payload.items.map((rawItem) => {
    const item = asRecord(rawItem);
    const clientKey = typeof item.clientKey === 'string' ? item.clientKey.trim() : '';
    const upload = clientKey ? uploads.get(clientKey) : undefined;
    if (upload) usedUploads.add(clientKey);
    return {
      ...item,
      ...(clientKey ? { clientKey } : {}),
      ...(upload ? { imageUpload: { stream: Readable.from(upload.content), originalName: upload.filename, mimeType: upload.mimetype } } : {}),
    } as unknown as SalesDocumentItemInput;
  });
  const orphan = [...uploads.keys()].find((key) => !usedUploads.has(key));
  if (orphan) throw new ApiError(400, 'VALIDATION_ERROR', '上传图片未关联到销售产品行', `itemImage.${orphan}`);
  return { ...payload, items } as unknown as SalesDocumentInput;
}

async function parseSalesInput(request: FastifyRequest): Promise<SalesDocumentInput> {
  return request.isMultipart()
    ? parseMultipartInput(request)
    : asRecord(request.body) as unknown as SalesDocumentInput;
}

function parseConfirmed(body: unknown): boolean {
  if (body == null) return false;
  const value = asRecord(body).confirmed;
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', 'confirmed 必须是布尔值', 'confirmed');
  return value;
}

export async function registerSalesDocumentRoutes(app: FastifyInstance, options: SalesDocumentRouteOptions): Promise<void> {
  const pdfRenderer = options.pdfRenderer ?? new PdfRenderer();

  app.get('/api/sales-documents', async (request, reply) => safeRoute(() => {
    const query = request.query as Record<string, string | undefined>;
    return sendSuccess(reply, options.service.list({
      documentStatus: query.documentStatus as SalesDocumentStatus | undefined,
      paymentStatus: query.paymentStatus as PaymentStatus | undefined,
      q: query.q,
      query: query.query,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    }));
  }, reply));

  app.post('/api/sales-documents', async (request, reply) => safeRoute(async () => (
    sendSuccess(reply, await options.service.create(await parseSalesInput(request)), 201)
  ), reply));

  app.get('/api/sales-documents/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    const detail = options.service.get(parseId(request.params.id));
    if (!detail) throw new ApiError(404, 'NOT_FOUND', '销售单不存在');
    return sendSuccess(reply, detail);
  }, reply));

  app.put('/api/sales-documents/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const detail = await options.service.update(parseId(request.params.id), await parseSalesInput(request));
    if (!detail) throw new ApiError(404, 'NOT_FOUND', '销售单不存在');
    return sendSuccess(reply, detail);
  }, reply));

  app.patch('/api/sales-documents/:id/status', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    const detail = options.service.updateStatus(parseId(request.params.id), asRecord(request.body).status);
    if (!detail) throw new ApiError(404, 'NOT_FOUND', '销售单不存在');
    return sendSuccess(reply, detail);
  }, reply));

  app.delete('/api/sales-documents/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const deleted = await options.service.delete(parseId(request.params.id), parseConfirmed(request.body));
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', '销售单不存在');
    return sendSuccess(reply, null);
  }, reply));

  app.get('/api/sales-documents/:id/pdf', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const detail = options.service.get(parseId(request.params.id));
    if (!detail) throw new ApiError(404, 'NOT_FOUND', '销售单不存在');
    const html = await renderSalesDocumentHtml(detail, {
      readFile: options.fileStore ? (path) => options.fileStore!.readFile(path) : undefined,
    });
    const pdf = await pdfRenderer.render(html);
    return reply.header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${detail.number}.pdf"`)
      .send(pdf);
  }, reply));

  app.post('/api/sales-documents/:id/receipts', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => (
    sendSuccess(reply, options.service.addReceipt(parseId(request.params.id), asRecord(request.body) as unknown as SalesReceiptInput), 201)
  ), reply));

  app.put('/api/sales-receipts/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => (
    sendSuccess(reply, options.service.updateReceipt(parseId(request.params.id), asRecord(request.body) as unknown as SalesReceiptInput))
  ), reply));

  app.delete('/api/sales-receipts/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const deleted = await options.service.deleteReceipt(parseId(request.params.id));
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', '收款记录不存在');
    return sendSuccess(reply, null);
  }, reply));

  app.post('/api/sales-receipts/:id/files', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    if (!options.fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
    const file = await request.file(imageFileOptions);
    if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择付款凭证', 'file');
    assertImageType(file);
    assertMultipartFileNotTruncated(file, 'image');
    const staged = await options.fileStore.stageImage(file.file, 'sales-receipt', file.filename, file.mimetype);
    return sendSuccess(reply, await options.service.addReceiptFile(parseId(request.params.id), staged), 201);
  }, reply));

  app.delete('/api/sales-receipt-files/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const deleted = await options.service.deleteReceiptFile(parseId(request.params.id));
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', '付款凭证不存在');
    return sendSuccess(reply, null);
  }, reply));
}

export const salesDocumentRoutes = registerSalesDocumentRoutes;
