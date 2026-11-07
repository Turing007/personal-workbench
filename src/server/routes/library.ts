import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import type { MultipartFile } from '@fastify/multipart';
import { FileStore, FileStoreError } from '../files/file-store.js';
import type { LibraryFileRecord, LibraryRepository } from '../db/library-repository.js';
import { isLibraryCategory, isLibrarySort, type LibraryCategory } from '../../shared/library.js';
import { ApiError, asRecord, mapDatabaseError, parseId, sendFailure, sendSuccess } from './api-response.js';
import { contractFileOptions } from './multipart-limits.js';

const MAX_TITLE_LENGTH = 120;
const MAX_NOTE_LENGTH = 1000;
const MAX_TAG_COUNT = 10;
const MAX_TAG_LENGTH = 20;

interface LibraryRouteOptions {
  repository: LibraryRepository;
  fileStore?: FileStore;
}

function mapFile(file: LibraryFileRecord) {
  return {
    id: file.id,
    title: file.title,
    category: file.category,
    customerId: file.customerId,
    customerName: file.customerName,
    tags: file.tags,
    note: file.note,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    relativePath: file.relativePath,
    url: `/files/${file.relativePath}`,
    createdBy: file.createdBy,
    deletedAt: file.deletedAt,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof FileStoreError) {
    switch (error.code) {
      case 'UNSUPPORTED_LIBRARY_TYPE':
        return new ApiError(415, error.code, error.message, 'file');
      case 'LIBRARY_FILE_TOO_LARGE':
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

function multipartFieldText(part: MultipartFile, fieldName: string): string {
  const field = part.fields[fieldName];
  if (!field || Array.isArray(field) || field.type !== 'field') return '';
  return String(field.value ?? '').trim();
}

function parseCategory(value: unknown): LibraryCategory {
  if (!isLibraryCategory(value)) throw new ApiError(400, 'VALIDATION_ERROR', '资料分类无效', 'category');
  return value;
}

function optionalCustomerId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', '客户无效', 'customerId');
  }
  return numeric;
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeTags(value);
  }
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return normalizeTags(parsed);
  } catch {
    /* 不是 JSON 就按逗号分隔处理 */
  }
  return normalizeTags(text.split(/[,，、]/));
}

function normalizeTags(values: unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const tag = String(value ?? '').trim();
    if (!tag || result.includes(tag)) continue;
    if (tag.length > MAX_TAG_LENGTH) throw new ApiError(400, 'VALIDATION_ERROR', `单个标签不能超过 ${MAX_TAG_LENGTH} 个字`, 'tags');
    result.push(tag);
    if (result.length >= MAX_TAG_COUNT) break;
  }
  return result;
}

function text(value: unknown, label: string, maxLength: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new ApiError(400, 'VALIDATION_ERROR', `${label}不能为空`);
    return '';
  }
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', `${label}必须是文本`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ApiError(400, 'VALIDATION_ERROR', `${label}不能为空`);
  if (trimmed.length > maxLength) throw new ApiError(400, 'VALIDATION_ERROR', `${label}不能超过 ${maxLength} 个字`);
  return trimmed;
}

function ensureCustomer(repository: LibraryRepository, customerId: number | null): void {
  if (customerId != null && !repository.customerExists(customerId)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '客户不存在', 'customerId');
  }
}

function ensureLabelCustomer(category: LibraryCategory, customerId: number | null): void {
  if (category === 'label' && customerId == null) {
    throw new ApiError(400, 'VALIDATION_ERROR', '客户标贴必须选择客户', 'customerId');
  }
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function registerLibraryRoutes(app: FastifyInstance, options: LibraryRouteOptions): Promise<void> {
  const { repository, fileStore } = options;

  app.get('/api/library', async (request, reply) =>
    safeRoute(async () => {
      if (fileStore) {
        const expired = repository.purgeExpired(30);
        await Promise.allSettled(expired.map((path) => fileStore.deleteFile(path)));
      }
      const query = request.query as Record<string, unknown>;
      const category = query.category && query.category !== 'all' ? parseCategory(query.category) : undefined;
      const customerId = query.customerId ? (optionalCustomerId(query.customerId) ?? undefined) : undefined;
      const sort = query.sort && isLibrarySort(query.sort) ? query.sort : undefined;
      const page = query.page == null ? undefined : Number(query.page);
      const pageSize = query.pageSize == null ? undefined : Number(query.pageSize);
      const trash = query.trash === '1' || query.trash === 'true';
      const result = repository.list({
        q: typeof query.q === 'string' ? query.q : undefined,
        category,
        customerId,
        sort,
        page,
        pageSize,
        trash,
      });
      return sendSuccess(reply, { ...result, items: result.items.map(mapFile) });
    }, reply),
  );

  app.post('/api/library', async (request, reply) =>
    safeRoute(async () => {
      if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
      const part = await request.file(contractFileOptions);
      if (!part) throw new ApiError(400, 'FILE_REQUIRED', '请选择要上传的文件', 'file');

      const category = parseCategory(multipartFieldText(part, 'category') || 'other');
      const customerId = optionalCustomerId(multipartFieldText(part, 'customerId'));
      ensureCustomer(repository, customerId);
      ensureLabelCustomer(category, customerId);
      const title = text(multipartFieldText(part, 'title') || part.filename, '资料名称', MAX_TITLE_LENGTH, true);
      const note = text(multipartFieldText(part, 'note'), '备注', MAX_NOTE_LENGTH);
      const tags = parseTags(multipartFieldText(part, 'tags'));
      const allowDuplicate = ['1', 'true'].includes(multipartFieldText(part, 'allowDuplicate').toLowerCase());

      const stored = await fileStore.saveFile(part.file, 'library', part.filename, part.mimetype);
      try {
        const bytes = await fileStore.readFile(stored.relativePath);
        const contentHash = hashBuffer(bytes);
        const duplicate = repository.findDuplicate(contentHash);
        if (duplicate && !allowDuplicate) {
          await fileStore.deleteFile(stored.relativePath);
          throw new ApiError(409, 'DUPLICATE_FILE', `资料库里已有相同文件${duplicate.title ? `「${duplicate.title}」` : ''}`, 'file');
        }
        const id = repository.create({
          title,
          category,
          customerId,
          tags,
          note,
          originalName: stored.originalName,
          relativePath: stored.relativePath,
          mimeType: stored.mimeType,
          size: stored.size,
          contentHash,
          createdBy: request.user?.username ?? '',
        });
        return sendSuccess(reply, mapFile(repository.get(id)!), 201);
      } catch (error) {
        await fileStore.deleteFile(stored.relativePath);
        throw error;
      }
    }, reply),
  );

  app.put('/api/library/:id', async (request, reply) =>
    safeRoute(() => {
      const id = parseId((request.params as { id?: string }).id);
      const current = repository.get(id);
      if (!current) throw new ApiError(404, 'NOT_FOUND', '资料不存在');
      const body = asRecord(request.body);
      const category = 'category' in body ? parseCategory(body.category) : current.category;
      const customerId = 'customerId' in body ? optionalCustomerId(body.customerId) : current.customerId;
      ensureCustomer(repository, customerId);
      ensureLabelCustomer(category, customerId);
      repository.update(id, {
        ...(('title' in body) ? { title: text(body.title, '资料名称', MAX_TITLE_LENGTH, true) } : {}),
        category,
        customerId,
        ...(('tags' in body) ? { tags: parseTags(body.tags) } : {}),
        ...(('note' in body) ? { note: text(body.note, '备注', MAX_NOTE_LENGTH) } : {}),
      });
      return sendSuccess(reply, mapFile(repository.get(id)!));
    }, reply),
  );

  app.delete('/api/library/:id', async (request, reply) =>
    safeRoute(() => {
      const id = parseId((request.params as { id?: string }).id);
      if (!repository.softDelete(id)) throw new ApiError(404, 'NOT_FOUND', '资料不存在或已在回收站');
      return sendSuccess(reply, { deleted: true });
    }, reply),
  );

  app.post('/api/library/:id/restore', async (request, reply) =>
    safeRoute(() => {
      const id = parseId((request.params as { id?: string }).id);
      if (!repository.restore(id)) throw new ApiError(404, 'NOT_FOUND', '资料不存在或不在回收站');
      return sendSuccess(reply, mapFile(repository.get(id)!));
    }, reply),
  );

  app.delete('/api/library/:id/purge', async (request, reply) =>
    safeRoute(async () => {
      if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
      const id = parseId((request.params as { id?: string }).id);
      const path = repository.purge(id);
      if (path === undefined) throw new ApiError(404, 'NOT_FOUND', '资料不存在或不在回收站');
      await fileStore.deleteFile(path);
      return sendSuccess(reply, { deleted: true });
    }, reply),
  );
}
