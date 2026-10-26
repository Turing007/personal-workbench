import type { FastifyInstance } from 'fastify';
import { FileStore, FileStoreError } from '../files/file-store.js';
import type { SupplierCatalogRepository, SupplierCatalogRecord } from '../db/supplier-catalog-repository.js';
import { ApiError, asRecord, mapDatabaseError, parseId, sendFailure, sendSuccess } from './api-response.js';
import { contractFileOptions } from './multipart-limits.js';

/** 一条供应商图册最多放 20 个文件：够装总册 + 若干细节图，也不会把单条记录做得过重。 */
const MAX_FILES_PER_CATALOG = 20;
const MAX_SUPPLIER_LENGTH = 80;
const MAX_NAME_LENGTH = 80;
const MAX_REMARK_LENGTH = 500;

interface SupplierCatalogRouteOptions {
  repository: SupplierCatalogRepository;
  fileStore?: FileStore;
}

function mapFile(file: SupplierCatalogRecord['files'][number]) {
  return {
    id: file.id,
    relativePath: file.relativePath,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt,
    url: `/files/${file.relativePath}`,
  };
}

function mapCatalog(catalog: SupplierCatalogRecord) {
  return {
    id: catalog.id,
    supplier: catalog.supplier,
    name: catalog.name,
    receivedAt: catalog.receivedAt,
    remark: catalog.remark,
    createdAt: catalog.createdAt,
    updatedAt: catalog.updatedAt,
    files: catalog.files.map(mapFile),
  };
}

function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof FileStoreError) {
    switch (error.code) {
      case 'UNSUPPORTED_SUPPLIER_CATALOG_TYPE':
        return new ApiError(415, error.code, error.message, 'file');
      case 'SUPPLIER_CATALOG_TOO_LARGE':
        return new ApiError(413, error.code, error.message, 'file');
      case 'INVALID_FILE_NAME':
      case 'INVALID_FILE_PATH':
      case 'INVALID_STAGED_FILE':
        return new ApiError(400, error.code, error.message, 'file');
      default:
        return new ApiError(500, error.code, error.message);
    }
  }
  if (error instanceof Error && error.message === '附件存储尚未配置') {
    return new ApiError(503, 'FILE_STORE_UNAVAILABLE', error.message);
  }
  return mapDatabaseError(error);
}

async function safeRoute<T>(
  handler: () => Promise<T> | T,
  reply: Parameters<typeof sendFailure>[0],
): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, mapError(error));
  }
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label}不能为空`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label}不能超过 ${maxLength} 个字`);
  }
  return trimmed;
}

function optionalText(value: unknown, label: string, maxLength: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', `${label}必须是文本`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label}不能超过 ${maxLength} 个字`);
  }
  return trimmed;
}

function shanghaiToday(): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function validDate(value: unknown): string {
  if (value === undefined || value === null || value === '') return shanghaiToday();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '收到日期格式应为 YYYY-MM-DD', 'receivedAt');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, 'VALIDATION_ERROR', '收到日期无效', 'receivedAt');
  }
  return value;
}

function parseCreate(body: Record<string, unknown>): { supplier: string; name: string; receivedAt: string; remark: string } {
  return {
    supplier: text(body.supplier, '供应商名称', MAX_SUPPLIER_LENGTH),
    name: text(body.name, '图册名称', MAX_NAME_LENGTH),
    receivedAt: validDate(body.receivedAt),
    remark: optionalText(body.remark, '备注', MAX_REMARK_LENGTH),
  };
}

function parseUpdate(body: Record<string, unknown>): { supplier?: string; name?: string; receivedAt?: string; remark?: string } {
  const changes: { supplier?: string; name?: string; receivedAt?: string; remark?: string } = {};
  if ('supplier' in body) changes.supplier = text(body.supplier, '供应商名称', MAX_SUPPLIER_LENGTH);
  if ('name' in body) changes.name = text(body.name, '图册名称', MAX_NAME_LENGTH);
  if ('receivedAt' in body) changes.receivedAt = validDate(body.receivedAt);
  if ('remark' in body) changes.remark = optionalText(body.remark, '备注', MAX_REMARK_LENGTH);
  return changes;
}

export async function registerSupplierCatalogRoutes(app: FastifyInstance, options: SupplierCatalogRouteOptions): Promise<void> {
  const { repository, fileStore } = options;

  app.get('/api/supplier-catalogs', async (_request, reply) =>
    safeRoute(() => sendSuccess(reply, { items: repository.list().map(mapCatalog) }), reply),
  );

  app.post('/api/supplier-catalogs', async (request, reply) =>
    safeRoute(() => {
      const input = parseCreate(asRecord(request.body));
      return sendSuccess(reply, mapCatalog(repository.get(repository.create(input))!), 201);
    }, reply),
  );

  app.put('/api/supplier-catalogs/:id', async (request, reply) =>
    safeRoute(() => {
      const id = parseId((request.params as { id?: string }).id);
      if (!repository.get(id)) throw new ApiError(404, 'NOT_FOUND', '供应商图册不存在');
      repository.update(id, parseUpdate(asRecord(request.body)));
      return sendSuccess(reply, mapCatalog(repository.get(id)!));
    }, reply),
  );

  app.delete('/api/supplier-catalogs/:id', async (request, reply) =>
    safeRoute(async () => {
      if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
      const id = parseId((request.params as { id?: string }).id);
      const paths = repository.delete(id);
      if (!paths) throw new ApiError(404, 'NOT_FOUND', '供应商图册不存在');
      await Promise.allSettled(paths.map((path) => fileStore.deleteFile(path)));
      return sendSuccess(reply, { deleted: true });
    }, reply),
  );

  app.post('/api/supplier-catalogs/:id/files', async (request, reply) =>
    safeRoute(async () => {
      if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
      const id = parseId((request.params as { id?: string }).id);
      if (!repository.get(id)) throw new ApiError(404, 'NOT_FOUND', '供应商图册不存在');
      if (repository.countFiles(id) >= MAX_FILES_PER_CATALOG) {
        throw new ApiError(400, 'FILE_LIMIT', `一条图册最多 ${MAX_FILES_PER_CATALOG} 个文件，请先删除不用的文件`);
      }
      const file = await request.file(contractFileOptions);
      if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择要上传的图册文件', 'file');
      const stored = await fileStore.saveFile(file.file, 'supplier-catalog', file.filename, file.mimetype);
      try {
        const saved = repository.addFile(id, stored);
        return sendSuccess(reply, mapFile(saved), 201);
      } catch (error) {
        await fileStore.deleteFile(stored.relativePath);
        throw error;
      }
    }, reply),
  );

  app.delete('/api/supplier-catalogs/:id/files/:fileId', async (request, reply) =>
    safeRoute(async () => {
      if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
      const id = parseId((request.params as { id?: string }).id);
      const fileId = parseId((request.params as { fileId?: string }).fileId, 'fileId');
      const path = repository.deleteFile(id, fileId);
      if (!path) throw new ApiError(404, 'NOT_FOUND', '图册文件不存在');
      await fileStore.deleteFile(path);
      return sendSuccess(reply, { deleted: true });
    }, reply),
  );
}
