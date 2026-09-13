import type { FastifyReply } from 'fastify';

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    field?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function sendSuccess<T>(reply: FastifyReply, data: T, statusCode = 200): FastifyReply {
  return reply.status(statusCode).send({ ok: true, data } satisfies ApiSuccess<T>);
}

export function sendFailure(reply: FastifyReply, error: unknown, statusCode = 500): FastifyReply {
  const apiError = error instanceof ApiError
    ? error
    : new ApiError(statusCode, 'INTERNAL_ERROR', error instanceof Error ? error.message : '服务器处理请求失败');
  const body: ApiFailure = {
    ok: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.field ? { field: apiError.field } : {}),
    },
  };
  return reply.status(apiError.statusCode).send(body);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_JSON', '请求体必须是 JSON 对象');
  }
  return value as Record<string, unknown>;
}

export function requiredText(value: unknown, field: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label}不能为空`, field);
  }
  return value.trim();
}

export function optionalText(value: unknown, field: string, label: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label}必须是文本`, field);
  }
  return value.trim();
}

export function positiveInteger(value: unknown, field: string, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label}必须是正整数`, field);
  }
  return value;
}

export function finiteNumber(value: unknown, field: string, label: string, defaultValue = 0): number {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label}必须是数字`, field);
  }
  return value;
}

export function parseId(value: string | undefined, field = 'id'): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new ApiError(400, 'INVALID_ID', '资源 ID 无效', field);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError(400, 'INVALID_ID', '资源 ID 无效', field);
  }
  return id;
}

export function mapDatabaseError(error: unknown): ApiError {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(message)) {
    return new ApiError(409, 'CONFLICT', '资源已存在');
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return new ApiError(409, 'CONFLICT', '存在关联数据，操作被拒绝');
  }
  if (/CHECK constraint failed/i.test(message)) {
    return new ApiError(400, 'VALIDATION_ERROR', '提交的数据不符合约束');
  }
  if (error instanceof ApiError) return error;
  return new ApiError(500, 'INTERNAL_ERROR', '服务器处理请求失败');
}
