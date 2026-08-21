import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CustomerProductSaveInput } from '../../shared/customers.js';
import type { CustomerProductAttachment } from '../../shared/customers.js';
import type { CustomerProductAttachmentCategory } from '../../shared/customers.js';
import {
  CustomerNotFoundError,
  CustomerInactiveError,
  CustomerProductExistsError,
  CustomerProductNotFoundError,
  CustomerProductService,
  CustomerProductValidationError,
  SystemProductNotFoundError,
} from '../services/customer-product-service.js';
import {
  ApiError,
  asRecord,
  mapDatabaseError,
  parseId,
  sendFailure,
  sendSuccess,
} from './api-response.js';
import { FileStore, FileStoreError } from '../files/file-store.js';
import { contractFileOptions, imageFileOptions } from './multipart-limits.js';

interface CustomerProductRouteOptions {
  service: CustomerProductService;
  fileStore?: FileStore;
}

function customerProductError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof CustomerProductExistsError) {
    return new ApiError(409, 'CUSTOMER_PRODUCT_EXISTS', error.message);
  }
  if (error instanceof CustomerProductValidationError) {
    return new ApiError(400, 'VALIDATION_ERROR', error.message, error.field);
  }
  if (error instanceof CustomerNotFoundError) {
    return new ApiError(404, 'NOT_FOUND', error.message);
  }
  if (error instanceof CustomerInactiveError) {
    return new ApiError(409, 'CUSTOMER_INACTIVE', error.message);
  }
  if (error instanceof CustomerProductNotFoundError || error instanceof SystemProductNotFoundError) {
    return new ApiError(404, 'NOT_FOUND', error.message);
  }
  if (error instanceof FileStoreError) {
    const status = error.code === 'PRODUCT_ATTACHMENT_TOO_LARGE' || error.code === 'CONTRACT_TOO_LARGE'
      ? 413
      : error.code === 'UNSUPPORTED_PRODUCT_ATTACHMENT_TYPE' || error.code === 'UNSUPPORTED_CONTRACT_TYPE'
        ? 415
        : 400;
    return new ApiError(status, error.code, error.message, 'file');
  }
  const mapped = mapDatabaseError(error);
  if (mapped.code === 'CONFLICT') {
    return new ApiError(409, 'CUSTOMER_PRODUCT_EXISTS', '该客户已存在相同产品');
  }
  return mapped;
}

function mapAttachment(row: Record<string, unknown> | undefined): CustomerProductAttachment | null {
  if (!row) return null;
  const relativePath = String(row.relative_path ?? row.relativePath ?? '');
  return {
    id: Number(row.id),
    customerProductId: Number(row.customer_product_id ?? row.customerProductId),
    relativePath,
    originalName: String(row.original_name ?? row.originalName ?? ''),
    mimeType: String(row.mime_type ?? row.mimeType ?? ''),
    size: Number(row.size_bytes ?? row.size ?? 0),
    createdAt: String(row.created_at ?? row.createdAt ?? ''),
    url: relativePath ? `/files/${relativePath}` : '',
    category: ['label', 'instruction', 'packaging', 'other'].includes(String(row.category))
      ? String(row.category) as CustomerProductAttachmentCategory
      : 'other',
  };
}

async function safeRoute<T>(
  handler: () => T | Promise<T>,
  reply: Parameters<typeof sendFailure>[0],
): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, customerProductError(error));
  }
}

function parseProductInput(value: unknown): CustomerProductSaveInput {
  const body = asRecord(value);
  return {
    ...(Object.prototype.hasOwnProperty.call(body, 'systemProductId')
      ? { systemProductId: body.systemProductId as number | null }
      : {}),
    name: body.name as string,
    specification: body.specification as string,
    sku: body.sku as string,
    packCount: body.packCount as number | null,
    finalPriceCents: body.finalPriceCents as number | null,
    costPriceCents: body.costPriceCents as number | null,
    freightPerBoxCents: body.freightPerBoxCents as number | null,
    remark: body.remark as string | undefined,
    packaging: body.packaging as CustomerProductSaveInput['packaging'],
    imageRelativePath: body.imageRelativePath as string | null | undefined,
  };
}

export async function registerCustomerProductRoutes(
  app: FastifyInstance,
  options: CustomerProductRouteOptions,
): Promise<void> {
  app.get('/api/customers/:customerId/products', async (
    request: FastifyRequest<{ Params: { customerId: string }; Querystring: { q?: string; status?: string } }>,
    reply,
  ) => safeRoute(() => {
    const items = options.service.list(parseId(request.params.customerId, 'customerId'), {
      search: request.query.q,
      status: request.query.status as 'all' | 'incomplete' | 'complete' | undefined,
    });
    return sendSuccess(reply, { items });
  }, reply));

  app.post('/api/customers/:customerId/products', async (
    request: FastifyRequest<{ Params: { customerId: string } }>,
    reply,
  ) => safeRoute(() => sendSuccess(
    reply,
    options.service.create(
      parseId(request.params.customerId, 'customerId'),
      parseProductInput(request.body),
    ),
    201,
  ), reply));

  app.post('/api/customers/:customerId/products/from-library', async (
    request: FastifyRequest<{ Params: { customerId: string } }>,
    reply,
  ) => safeRoute(() => {
    const body = asRecord(request.body);
    return sendSuccess(
      reply,
      options.service.createFromSystemProduct(
        parseId(request.params.customerId, 'customerId'),
        body.systemProductId,
      ),
      201,
    );
  }, reply));

  app.post('/api/customers/:customerId/products/from-library/complete', async (
    request: FastifyRequest<{ Params: { customerId: string } }>,
    reply,
  ) => safeRoute(() => {
    const body = asRecord(request.body);
    return sendSuccess(reply, options.service.createFromSystemProductWithInput(
      parseId(request.params.customerId, 'customerId'),
      body.systemProductId,
      parseProductInput(body),
    ), 201);
  }, reply));

  app.post('/api/customers/:customerId/products/batch-delete', async (
    request: FastifyRequest<{ Params: { customerId: string } }>,
    reply,
  ) => safeRoute(async () => {
    const body = asRecord(request.body);
    const filePaths = Array.isArray(body.ids)
      ? body.ids
        .map((id) => Number(id))
        .filter((id) => Number.isSafeInteger(id) && id > 0)
        .flatMap((id) => {
          const product = options.service.get(id);
          return [product?.imageRelativePath, ...(product?.attachments ?? []).map((attachment) => attachment.relativePath)];
        })
        .filter((path): path is string => Boolean(
          path?.startsWith('customer-product-images/') || path?.startsWith('customer-product-attachments/'),
        ))
      : [];
    const deletedCount = options.service.deleteMany(
      parseId(request.params.customerId, 'customerId'),
      body.ids,
    );
    if (options.fileStore) {
      await Promise.all(filePaths.map((path) => options.fileStore!.deleteFile(path)));
    }
    return sendSuccess(reply, { deletedCount });
  }, reply));

  app.get('/api/customer-products/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => safeRoute(() => {
    const product = options.service.get(parseId(request.params.id));
    if (!product) throw new ApiError(404, 'NOT_FOUND', '客户产品不存在');
    return sendSuccess(reply, product);
  }, reply));

  app.put('/api/customer-products/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => safeRoute(async () => {
    const id = parseId(request.params.id);
    const input = parseProductInput(request.body);
    const existing = options.service.get(id);
    const product = options.service.update(id, input);
    if (!product) throw new ApiError(404, 'NOT_FOUND', '客户产品不存在');
    if (
      options.fileStore
      && input.imageRelativePath === null
      && existing?.imageRelativePath?.startsWith('customer-product-images/')
    ) {
      await options.fileStore.deleteFile(existing.imageRelativePath);
    }
    return sendSuccess(reply, product);
  }, reply));

  app.delete('/api/customer-products/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => safeRoute(async () => {
    const id = parseId(request.params.id);
    const existing = options.service.get(id);
    if (!options.service.remove(id)) {
      throw new ApiError(404, 'NOT_FOUND', '客户产品不存在');
    }
    if (options.fileStore && existing?.imageRelativePath?.startsWith('customer-product-images/')) {
      await options.fileStore.deleteFile(existing.imageRelativePath);
    }
    if (options.fileStore && existing) {
      await Promise.all((existing.attachments ?? []).map((attachment) => options.fileStore!.deleteFile(attachment.relativePath)));
    }
    return sendSuccess(reply, null);
  }, reply));

  app.post('/api/customer-products/:id/images', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => safeRoute(async () => {
    if (!options.fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
    const id = parseId(request.params.id);
    const existing = options.service.get(id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', '客户产品不存在');
    const file = await request.file(imageFileOptions);
    if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择客户产品图片', 'file');
    const stored = await options.fileStore.saveImage(file.file, 'customer-product', file.filename, file.mimetype);
    try {
      const saved = options.service.setImagePath(id, stored.relativePath);
      if (!saved) throw new ApiError(404, 'NOT_FOUND', '客户产品不存在');
      if (existing.imageRelativePath?.startsWith('customer-product-images/')) {
        await options.fileStore.deleteFile(existing.imageRelativePath);
      }
      return sendSuccess(reply, saved, 201);
    } catch (error) {
      await options.fileStore.deleteFile(stored.relativePath);
      throw error;
    }
  }, reply));

  app.delete('/api/customer-products/:id/images', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => safeRoute(async () => {
    if (!options.fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
    const id = parseId(request.params.id);
    const existing = options.service.get(id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', '客户产品不存在');
    const saved = options.service.setImagePath(id, null);
    if (existing.imageRelativePath?.startsWith('customer-product-images/')) {
      await options.fileStore.deleteFile(existing.imageRelativePath);
    }
    return sendSuccess(reply, saved ?? null);
  }, reply));

  app.post('/api/customer-products/:id/attachments', async (
    request: FastifyRequest<{ Params: { id: string }; Querystring: { category?: string } }>,
    reply,
  ) => safeRoute(async () => {
    if (!options.fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
    const id = parseId(request.params.id);
    if (!options.service.get(id)) throw new ApiError(404, 'NOT_FOUND', '客户产品不存在');
    const category = String(request.query?.category ?? 'other').trim();
    if (!['label', 'instruction', 'packaging', 'other'].includes(category)) {
      throw new ApiError(400, 'VALIDATION_ERROR', '客户产品附件类型无效', 'category');
    }
    const file = await request.file(contractFileOptions);
    if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择客户产品附件', 'file');
    const stored = await options.fileStore.saveFile(file.file, 'customer-product-attachment', file.filename, file.mimetype);
    try {
      const attachment = options.service.addAttachment(id, { ...stored, category: category as CustomerProductAttachmentCategory });
      return sendSuccess(reply, mapAttachment(attachment as Record<string, unknown>), 201);
    } catch (error) {
      await options.fileStore.deleteFile(stored.relativePath);
      throw error;
    }
  }, reply));

  app.delete('/api/customer-products/:id/attachments/:attachmentId', async (
    request: FastifyRequest<{ Params: { id: string; attachmentId: string } }>,
    reply,
  ) => safeRoute(async () => {
    if (!options.fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
    const id = parseId(request.params.id);
    const attachmentId = parseId(request.params.attachmentId, 'attachmentId');
    const relativePath = options.service.deleteAttachment(id, attachmentId);
    if (!relativePath) throw new ApiError(404, 'NOT_FOUND', '客户产品附件不存在');
    await options.fileStore.deleteFile(relativePath);
    return sendSuccess(reply, null);
  }, reply));

  app.patch('/api/customer-products/:id/attachments/:attachmentId', async (
    request: FastifyRequest<{ Params: { id: string; attachmentId: string } }>,
    reply,
  ) => safeRoute(() => {
    const id = parseId(request.params.id);
    const attachmentId = parseId(request.params.attachmentId, 'attachmentId');
    const category = String(asRecord(request.body).category ?? '').trim();
    if (!['label', 'instruction', 'packaging', 'other'].includes(category)) {
      throw new ApiError(400, 'VALIDATION_ERROR', '客户产品附件类型无效', 'category');
    }
    if (!options.service.updateAttachmentCategory(id, attachmentId, category as CustomerProductAttachmentCategory)) {
      throw new ApiError(404, 'NOT_FOUND', '客户产品附件不存在');
    }
    const attachment = options.service.get(id)?.attachments.find((item) => item.id === attachmentId);
    return sendSuccess(reply, attachment ?? null);
  }, reply));
}

export const customerProductRoutes = registerCustomerProductRoutes;
