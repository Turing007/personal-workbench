import { Readable } from 'node:stream';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ALLOWED_IMAGE_MIME_TYPES } from '../config.js';
import { DocumentAssetError } from '../documents/document-assets.js';
import { PdfRenderer, PdfRendererError } from '../documents/pdf-renderer.js';
import { renderQuotationHtml } from '../documents/quotation-template.js';
import type { FileStore } from '../files/file-store.js';
import { FileStoreError } from '../files/file-store.js';
import {
  QuotationService,
  QuotationServiceError,
  type QuotationInput,
  type QuotationItemInput,
} from '../services/quotation-service.js';
import {
  QuotationCustomerProductSyncError,
  QuotationCustomerProductSyncService,
} from '../services/quotation-customer-product-sync-service.js';
import { DocumentValidationError } from '../../shared/document-validation.js';
import type { QuotationStatus } from '../../shared/documents.js';
import { ApiError, asRecord, parseId, sendFailure, sendSuccess } from './api-response.js';
import { assertMultipartFileNotTruncated, imagePartsOptions } from './multipart-limits.js';

interface IdParams {
  id: string;
}

interface CopyQuotationToSales {
  (quotationId: number): Promise<unknown> | unknown;
}

export interface QuotationRouteOptions {
  service: QuotationService;
  fileStore?: Pick<FileStore, 'readFile'>;
  pdfRenderer?: Pick<PdfRenderer, 'render'>;
  copyQuotationToSales?: CopyQuotationToSales;
  customerProductSyncService?: QuotationCustomerProductSyncService;
}

interface BufferedUpload {
  clientKey: string;
  filename: string;
  mimetype: string;
  content: Buffer;
}

function quotationError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DocumentValidationError) {
    return new ApiError(400, 'VALIDATION_ERROR', error.message, error.field);
  }
  if (error instanceof QuotationServiceError) {
    const statusCode = error.code === 'QUOTATION_NOT_FOUND' || error.code === 'CUSTOMER_NOT_FOUND' || error.code === 'CUSTOMER_PRODUCT_NOT_FOUND'
      ? 404
      : error.code === 'CONFIRMATION_REQUIRED' || error.code === 'CUSTOMER_INACTIVE' || error.code === 'CUSTOMER_PRODUCT_CUSTOMER_MISMATCH'
        ? 409
        : error.code === 'ASSET_MANAGER_REQUIRED'
          ? 503
          : 400;
    return new ApiError(statusCode, error.code, error.message, error.field);
  }
  if (error instanceof QuotationCustomerProductSyncError) {
    const statusCode = error.code === 'QUOTATION_NOT_FOUND' || error.code === 'CUSTOMER_NOT_FOUND'
      ? 404
      : error.code === 'CUSTOMER_INACTIVE' || error.code === 'QUOTATION_CUSTOMER_REQUIRED'
        ? 409
        : 400;
    return new ApiError(statusCode, error.code, error.message);
  }
  if (error instanceof FileStoreError) {
    const statusCode = error.code === 'IMAGE_TOO_LARGE' ? 413 : error.code === 'UNSUPPORTED_IMAGE_TYPE' ? 415 : 400;
    return new ApiError(statusCode, error.code, error.message);
  }
  if (error instanceof DocumentAssetError) {
    return new ApiError(400, error.code, error.message);
  }
  if (error instanceof PdfRendererError) {
    return new ApiError(500, error.code, error.message);
  }
  return new ApiError(500, 'INTERNAL_ERROR', '服务器处理请求失败');
}

async function safeRoute<T>(handler: () => Promise<T> | T, reply: FastifyReply): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, quotationError(error));
  }
}

function parseJsonPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_JSON', 'payload 必须是 JSON 文本', 'payload');
  }
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

async function parseMultipartInput(request: FastifyRequest): Promise<QuotationInput> {
  let payload: Record<string, unknown> | undefined;
  const uploads = new Map<string, BufferedUpload>();

  for await (const part of request.parts(imagePartsOptions)) {
    if (part.type === 'field') {
      if (part.fieldname !== 'payload') {
        throw new ApiError(400, 'VALIDATION_ERROR', `不支持的表单字段：${part.fieldname}`, part.fieldname);
      }
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
    if (!clientKey) {
      await part.toBuffer();
      throw new ApiError(400, 'VALIDATION_ERROR', '产品图片关联标识不能为空', part.fieldname);
    }
    if (uploads.has(clientKey)) {
      await part.toBuffer();
      throw new ApiError(400, 'FILE_COUNT_INVALID', '每行产品最多上传一张图片', part.fieldname);
    }
    assertImageType(part);
    const content = await part.toBuffer();
    assertMultipartFileNotTruncated(part, 'image');
    uploads.set(clientKey, {
      clientKey,
      filename: part.filename,
      mimetype: part.mimetype,
      content,
    });
  }

  if (!payload) throw new ApiError(400, 'VALIDATION_ERROR', '缺少 payload 字段', 'payload');
  if (!Array.isArray(payload.items)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '报价单至少需要一行产品', 'items');
  }

  const usedUploads = new Set<string>();
  const items = payload.items.map((rawItem, index) => {
    const item = asRecord(rawItem);
    const clientKey = typeof item.clientKey === 'string' ? item.clientKey.trim() : '';
    const upload = clientKey ? uploads.get(clientKey) : undefined;
    if (upload) usedUploads.add(clientKey);
    return {
      ...item,
      ...(clientKey ? { clientKey } : {}),
      ...(upload ? {
        imageUpload: {
          stream: Readable.from(upload.content),
          originalName: upload.filename,
          mimeType: upload.mimetype,
        },
      } : {}),
    } as unknown as QuotationItemInput;
  });

  const orphan = [...uploads.keys()].find((clientKey) => !usedUploads.has(clientKey));
  if (orphan) {
    throw new ApiError(400, 'VALIDATION_ERROR', '上传图片未关联到报价产品行', `itemImage.${orphan}`);
  }
  return { ...payload, items } as unknown as QuotationInput;
}

async function parseQuotationInput(request: FastifyRequest): Promise<QuotationInput> {
  if (request.isMultipart()) return parseMultipartInput(request);
  return asRecord(request.body) as unknown as QuotationInput;
}

function parseOptionalBoolean(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', `${field} 必须是布尔值`, field);
  return value;
}

export async function registerQuotationRoutes(
  app: FastifyInstance,
  options: QuotationRouteOptions,
): Promise<void> {
  const { service } = options;
  const pdfRenderer = options.pdfRenderer ?? new PdfRenderer();
  const customerProductSyncService = options.customerProductSyncService;

  app.get('/api/quotations', async (request, reply) => safeRoute(() => {
    const query = request.query as Record<string, string | undefined>;
    return sendSuccess(reply, service.list({
      status: query.status as QuotationStatus | undefined,
      q: query.q,
      query: query.query,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    }));
  }, reply));

  app.post('/api/quotations', async (request, reply) => safeRoute(async () => (
    sendSuccess(reply, await service.create(await parseQuotationInput(request)), 201)
  ), reply));

  app.get('/api/quotations/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    const quotation = service.get(parseId(request.params.id));
    if (!quotation) throw new ApiError(404, 'NOT_FOUND', '报价单不存在');
    return sendSuccess(reply, quotation);
  }, reply));

  app.put('/api/quotations/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const quotation = await service.update(parseId(request.params.id), await parseQuotationInput(request));
    if (!quotation) throw new ApiError(404, 'NOT_FOUND', '报价单不存在');
    return sendSuccess(reply, quotation);
  }, reply));

  app.patch('/api/quotations/:id/status', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    const body = asRecord(request.body);
    const quotation = service.updateStatus(parseId(request.params.id), body.status);
    if (!quotation) throw new ApiError(404, 'NOT_FOUND', '报价单不存在');
    return sendSuccess(reply, quotation);
  }, reply));

  app.delete('/api/quotations/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const body = request.body == null ? {} : asRecord(request.body);
    const deleted = await service.delete(
      parseId(request.params.id),
      parseOptionalBoolean(body.confirmed, 'confirmed'),
    );
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', '报价单不存在');
    return sendSuccess(reply, null);
  }, reply));

  app.post('/api/quotations/:id/customer-products/preview', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    if (!customerProductSyncService) throw new ApiError(503, 'CUSTOMER_PRODUCT_SYNC_UNAVAILABLE', '客户产品同步服务尚未配置');
    return sendSuccess(reply, customerProductSyncService.preview(parseId(request.params.id)));
  }, reply));

  app.post('/api/quotations/:id/customer-products/sync', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    if (!customerProductSyncService) throw new ApiError(503, 'CUSTOMER_PRODUCT_SYNC_UNAVAILABLE', '客户产品同步服务尚未配置');
    const body = request.body == null ? {} : asRecord(request.body);
    const ids = body.quotationItemIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id)))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'quotationItemIds 必须是整数数组', 'quotationItemIds');
    }
    return sendSuccess(reply, customerProductSyncService.sync(
      parseId(request.params.id),
      ids as number[] | undefined,
    ));
  }, reply));

  app.get('/api/quotations/:id/pdf', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const quotation = service.get(parseId(request.params.id));
    if (!quotation) throw new ApiError(404, 'NOT_FOUND', '报价单不存在');
    const html = await renderQuotationHtml(quotation, {
      readFile: options.fileStore
        ? (relativePath) => options.fileStore!.readFile(relativePath)
        : undefined,
    });
    const pdf = await pdfRenderer.render(html);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${quotation.number}.pdf"`)
      .send(pdf);
  }, reply));

  app.post('/api/quotations/:id/copy-to-sales', async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(async () => {
    const id = parseId(request.params.id);
    const quotation = service.get(id);
    if (!quotation) throw new ApiError(404, 'NOT_FOUND', '报价单不存在');
    if (quotation.status !== 'won') {
      throw new ApiError(409, 'QUOTATION_NOT_WON', '只有已成交报价单才能复制为销售单');
    }
    if (!options.copyQuotationToSales) {
      throw new ApiError(503, 'SALES_SERVICE_UNAVAILABLE', '销售开单服务尚未配置');
    }
    return sendSuccess(reply, await options.copyQuotationToSales(id), 201);
  }, reply));
}

export const quotationRoutes = registerQuotationRoutes;
