import type { DatabaseSync } from 'node:sqlite';
import type {
  DocumentVersionAction,
  DocumentVersionDetail,
  DocumentVersionSummary,
  DocumentVersionType,
} from '../../shared/document-versions.js';

type SqlRow = Record<string, unknown>;

export interface DocumentVersionInsert {
  documentType: DocumentVersionType;
  documentId: number;
  action: DocumentVersionAction;
  documentStatus: string;
  documentNumber: string;
  documentDate: string;
  totalCents: number;
  snapshotJson: string;
  createdBy: string;
  createdAt: string;
}

function stringValue(row: SqlRow, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? '' : String(value);
}

function numberValue(row: SqlRow, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function mapSummary(row: SqlRow): DocumentVersionSummary {
  return {
    id: numberValue(row, 'id'),
    documentType: stringValue(row, 'document_type') as DocumentVersionType,
    documentId: numberValue(row, 'document_id'),
    versionNo: numberValue(row, 'version_no'),
    action: stringValue(row, 'action') as DocumentVersionAction,
    documentStatus: stringValue(row, 'document_status'),
    documentNumber: stringValue(row, 'document_number'),
    documentDate: stringValue(row, 'document_date'),
    totalCents: numberValue(row, 'total_cents'),
    createdBy: stringValue(row, 'created_by'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function parseSnapshot(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 单据版本快照：只追加，不提供更新/删除接口。 */
export class DocumentVersionRepository {
  constructor(private readonly database: DatabaseSync) {}

  insert(input: DocumentVersionInsert): { id: number; versionNo: number } {
    const row = this.database.prepare(`
      INSERT INTO document_versions
        (document_type, document_id, version_no, action, document_status, document_number,
         document_date, total_cents, snapshot_json, created_by, created_at)
      VALUES (?, ?, (
        SELECT COALESCE(MAX(version_no), 0) + 1 FROM document_versions
        WHERE document_type = ? AND document_id = ?
      ), ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, version_no
    `).get(
      input.documentType,
      input.documentId,
      input.documentType,
      input.documentId,
      input.action,
      input.documentStatus,
      input.documentNumber,
      input.documentDate,
      input.totalCents,
      input.snapshotJson,
      input.createdBy,
      input.createdAt,
    ) as SqlRow;
    return { id: numberValue(row, 'id'), versionNo: numberValue(row, 'version_no') };
  }

  /**
   * 单据被删除后其快照不再有读取入口（版本接口以单据存在为前提），
   * 因此在删除单据的同一事务里清掉，避免备份被永远读不到的记录越撑越大。
   */
  deleteAll(documentType: DocumentVersionType, documentId: number): void {
    this.database
      .prepare('DELETE FROM document_versions WHERE document_type = ? AND document_id = ?')
      .run(documentType, documentId);
  }

  /**
   * 历史快照只保存附件的相对路径，文件本身仍存在附件目录里。
   * 编辑单据替换图片/删除收款凭证前先查快照，避免把历史版本引用的文件物理删掉。
   */
  isAssetReferenced(relativePath: string): boolean {
    if (!relativePath) return false;
    return Boolean(this.database
      .prepare('SELECT 1 FROM document_versions WHERE instr(snapshot_json, ?) > 0 LIMIT 1')
      .get(`"${relativePath}"`));
  }

  list(documentType: DocumentVersionType, documentId: number): DocumentVersionSummary[] {
    const rows = this.database.prepare(`
      SELECT id, document_type, document_id, version_no, action, document_status,
             document_number, document_date, total_cents, created_by, created_at
      FROM document_versions
      WHERE document_type = ? AND document_id = ?
      ORDER BY version_no DESC
    `).all(documentType, documentId) as SqlRow[];
    return rows.map(mapSummary);
  }

  get(documentType: DocumentVersionType, documentId: number, versionNo: number): DocumentVersionDetail | undefined {
    const row = this.database.prepare(`
      SELECT id, document_type, document_id, version_no, action, document_status,
             document_number, document_date, total_cents, snapshot_json, created_by, created_at
      FROM document_versions
      WHERE document_type = ? AND document_id = ? AND version_no = ?
    `).get(documentType, documentId, versionNo) as SqlRow | undefined;
    if (!row) return undefined;
    return { ...mapSummary(row), snapshot: parseSnapshot(row.snapshot_json) };
  }
}
