import type { FastifyInstance } from 'fastify';
import { AUDIT_CATEGORIES, type AuditLogFilters } from '../../shared/audit.js';
import type { AuditLogRepository } from '../db/audit-repository.js';
import { ApiError, sendFailure, sendSuccess } from './api-response.js';
import { requireAdmin } from './auth.js';

export interface AuditRouteOptions {
  repository: AuditLogRepository;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > maxLength) {
    throw new ApiError(400, 'VALIDATION_ERROR', '查询条件过长', 'q');
  }
  return text;
}

function optionalIsoDate(value: unknown, field: string): string | undefined {
  const text = optionalText(value, 40);
  if (!text) return undefined;
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '日期格式无效', field);
  }
  return new Date(timestamp).toISOString();
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', '分页参数必须是正整数', field);
  }
  return parsed;
}

/** 操作审计日志查询：仅管理员可见。 */
export async function registerAuditRoutes(app: FastifyInstance, options: AuditRouteOptions): Promise<void> {
  app.get('/api/audit-logs', async (request, reply) => {
    try {
      requireAdmin(request);
      const query = request.query as Record<string, string | undefined>;
      const category = optionalText(query.category, 40);
      if (category && category !== 'all' && !AUDIT_CATEGORIES.some((item) => item.key === category)) {
        throw new ApiError(400, 'VALIDATION_ERROR', '日志分类无效', 'category');
      }
      const action = optionalText(query.action, 80);
      if (action && !/^[a-z0-9_.]+$/.test(action)) {
        throw new ApiError(400, 'VALIDATION_ERROR', '操作类型格式无效', 'action');
      }
      const from = optionalIsoDate(query.from, 'from');
      const to = optionalIsoDate(query.to, 'to');
      if (from && to && from > to) {
        throw new ApiError(400, 'VALIDATION_ERROR', '开始时间不能晚于结束时间', 'from');
      }
      const pageSize = optionalPositiveInteger(query.pageSize, 'pageSize');
      if (pageSize !== undefined && pageSize > 100) {
        throw new ApiError(400, 'VALIDATION_ERROR', '每页最多 100 条', 'pageSize');
      }
      const filters: AuditLogFilters = {
        q: optionalText(query.q ?? query.query, 100),
        action,
        category,
        username: optionalText(query.username, 32),
        entityType: optionalText(query.entityType, 40),
        entityId: optionalText(query.entityId, 40),
        from,
        to,
        page: optionalPositiveInteger(query.page, 'page'),
        pageSize,
      };
      return sendSuccess(reply, options.repository.list(filters));
    } catch (error) {
      return sendFailure(reply, error);
    }
  });
}
