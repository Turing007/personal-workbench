import type { DatabaseSync } from 'node:sqlite';
import { AUDIT_CATEGORIES, type AuditLogFilters, type AuditLogListResult, type AuditLogRow } from '../../shared/audit.js';

type SqlRow = Record<string, unknown>;

export interface AuditLogInsert {
  occurredAt: string;
  userId: number | null;
  username: string;
  displayName: string;
  role: string;
  method: string;
  path: string;
  route: string;
  statusCode: number;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  summary: string;
  ip: string;
  userAgent: string;
  durationMs: number;
  detailJson: string;
}

function stringValue(row: SqlRow, key: string, fallback = ''): string {
  const value = row[key];
  return value === null || value === undefined ? fallback : String(value);
}

function numberValue(row: SqlRow, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function parseDetail(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapRow(row: SqlRow): AuditLogRow {
  return {
    id: numberValue(row, 'id'),
    occurredAt: stringValue(row, 'occurred_at'),
    userId: row.user_id == null ? null : numberValue(row, 'user_id'),
    username: stringValue(row, 'username'),
    displayName: stringValue(row, 'display_name'),
    role: stringValue(row, 'role'),
    method: stringValue(row, 'method'),
    path: stringValue(row, 'path'),
    route: stringValue(row, 'route'),
    statusCode: numberValue(row, 'status_code'),
    action: stringValue(row, 'action'),
    entityType: stringValue(row, 'entity_type'),
    entityId: stringValue(row, 'entity_id'),
    entityLabel: stringValue(row, 'entity_label'),
    summary: stringValue(row, 'summary'),
    ip: stringValue(row, 'ip'),
    userAgent: stringValue(row, 'user_agent'),
    durationMs: numberValue(row, 'duration_ms'),
    detail: parseDetail(row.detail_json),
  };
}

function normalizePage(value: number | undefined): number {
  const page = Math.trunc(Number(value));
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function normalizePageSize(value: number | undefined): number {
  const size = Math.trunc(Number(value));
  if (!Number.isSafeInteger(size) || size <= 0) return 20;
  return Math.min(100, Math.max(1, size));
}

/** 操作审计日志的数据访问：只追加，不修改。 */
export class AuditLogRepository {
  constructor(private readonly database: DatabaseSync) {}

  insert(input: AuditLogInsert): void {
    this.database
      .prepare(
        `INSERT INTO audit_logs
          (occurred_at, user_id, username, display_name, role, method, path, route, status_code,
           action, entity_type, entity_id, entity_label, summary, ip, user_agent, duration_ms, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.occurredAt,
        input.userId,
        input.username,
        input.displayName,
        input.role,
        input.method,
        input.path,
        input.route,
        input.statusCode,
        input.action,
        input.entityType,
        input.entityId,
        input.entityLabel,
        input.summary,
        input.ip,
        input.userAgent,
        input.durationMs,
        input.detailJson,
      );
  }

  list(filters: AuditLogFilters): AuditLogListResult {
    const page = normalizePage(filters.page);
    const pageSize = normalizePageSize(filters.pageSize);
    const conditions: string[] = [];
    const values: Array<string | number> = [];

    const q = filters.q?.trim();
    if (q) {
      const like = `%${q}%`;
      conditions.push(`(
        summary LIKE ? OR username LIKE ? OR display_name LIKE ? OR entity_label LIKE ?
        OR entity_id LIKE ? OR path LIKE ? OR action LIKE ?
      )`);
      values.push(like, like, like, like, like, like, like);
    }
    if (filters.action?.trim()) {
      conditions.push('action = ?');
      values.push(filters.action.trim());
    }
    if (filters.category && filters.category !== 'all') {
      const category = AUDIT_CATEGORIES.find((item) => item.key === filters.category);
      if (category && category.actionPrefixes.length) {
        conditions.push(`(${category.actionPrefixes.map(() => 'action LIKE ?').join(' OR ')})`);
        values.push(...category.actionPrefixes.map((prefix) => `${prefix}%`));
      }
    }
    if (filters.username?.trim()) {
      conditions.push('username = ?');
      values.push(filters.username.trim());
    }
    if (filters.entityType?.trim()) {
      conditions.push('entity_type = ?');
      values.push(filters.entityType.trim());
    }
    if (filters.entityId?.trim()) {
      conditions.push('entity_id = ?');
      values.push(filters.entityId.trim());
    }
    if (filters.from?.trim()) {
      conditions.push('occurred_at >= ?');
      values.push(filters.from.trim());
    }
    if (filters.to?.trim()) {
      conditions.push('occurred_at <= ?');
      values.push(filters.to.trim());
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(
      this.database.prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`).get(...values)?.count ?? 0,
    );
    const rows = this.database
      .prepare(
        `SELECT * FROM audit_logs ${where}
         ORDER BY occurred_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, pageSize, (page - 1) * pageSize) as SqlRow[];

    return { items: rows.map(mapRow), total, page, pageSize };
  }
}
