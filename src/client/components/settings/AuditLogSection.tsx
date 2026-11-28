import { History, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUDIT_CATEGORIES,
  auditEntityText,
  type AuditLogListResult,
  type AuditLogRow,
} from '../../../shared/audit';
import { formatDateTime } from '../../../shared/formatters';
import { listAuditLogs } from '../../api';

interface FilterDraft {
  q: string;
  category: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: FilterDraft = { q: '', category: 'all', from: '', to: '' };

/** 日期输入按本机时区取一天的起止，再转成 UTC ISO 传给服务端。 */
function startOfDayIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function endOfDayIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function detailText(row: AuditLogRow): string {
  if (!row.detail || Object.keys(row.detail).length === 0) return '';
  return JSON.stringify(row.detail, null, 2);
}

export default function AuditLogSection() {
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterDraft>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<AuditLogListResult>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadSeq = useRef(0);

  const load = useCallback(async (filters: FilterDraft, targetPage: number) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    try {
      const next = await listAuditLogs({
        q: filters.q.trim() || undefined,
        category: filters.category === 'all' ? undefined : filters.category,
        from: startOfDayIso(filters.from),
        to: endOfDayIso(filters.to),
        page: targetPage,
        pageSize: 20,
      });
      if (seq === loadSeq.current) setResult(next);
    } catch (reason) {
      if (seq === loadSeq.current) {
        setError((reason as { message?: string })?.message ?? '操作日志加载失败');
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied, page);
  }, [applied, page, reloadKey, load]);

  const applyFilters = () => {
    setPage(1);
    setApplied({ ...draft });
  };

  const total = result?.total ?? 0;
  const pageSize = result?.pageSize ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rows = result?.items ?? [];

  return <div className="settings-section card">
    <div className="settings-heading"><History size={18} /><strong>操作日志</strong></div>
    <p>记录订单、财务、单据、产品等关键写操作，便于事后追溯。仅管理员可见，日志只追加不修改。</p>

    <div className="audit-log-filters">
      <input
        className="input"
        placeholder="搜索摘要、账号、单号、对象..."
        value={draft.q}
        aria-label="搜索操作日志"
        onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
        onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }}
      />
      <select
        className="input"
        aria-label="日志分类"
        value={draft.category}
        onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
      >
        {AUDIT_CATEGORIES.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}
      </select>
      <input
        className="input"
        type="date"
        aria-label="开始日期"
        value={draft.from}
        onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
      />
      <input
        className="input"
        type="date"
        aria-label="结束日期"
        value={draft.to}
        onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
      />
      <button className="button button-primary" type="button" disabled={loading} onClick={applyFilters}><Search size={14} />查询</button>
      <button className="button button-secondary" type="button" disabled={loading} onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={14} />刷新</button>
    </div>

    {error && <p className="notice notice-error" role="alert">{error}</p>}

    {loading && !result ? <p>加载中...</p> : rows.length === 0 ? <p>没有符合条件的操作记录。</p> : <div className="audit-log-list">
      {rows.map((row) => {
        const entity = auditEntityText(row);
        const detail = detailText(row);
        return <div className="audit-log-row" key={row.id}>
          <div className="audit-log-row-main">
            <div className="audit-log-copy">
              <strong>{row.summary || `${row.method} ${row.path}`}</strong>
              <span>{entity}{entity && row.path ? ' · ' : ''}{row.path}</span>
              <small>
                {formatDateTime(row.occurredAt)} · {row.displayName || row.username || '未知账号'}
                {row.role === 'admin' ? '（管理员）' : ''} · IP {row.ip || '—'}
                {row.durationMs > 0 ? ` · ${row.durationMs}ms` : ''}
              </small>
            </div>
            <div className="audit-log-meta">
              <span className={`audit-log-method is-${row.method.toLowerCase()}`}>{row.method}</span>
              <span>{row.statusCode}</span>
            </div>
          </div>
          {detail && <details className="audit-log-detail">
            <summary>查看请求详情</summary>
            <pre>{detail}</pre>
          </details>}
        </div>;
      })}
    </div>}

    <div className="audit-log-pagination">
      <span>共 {total} 条 · 第 {result?.page ?? page} / {totalPages} 页</span>
      <button className="button button-secondary" type="button" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
      <button className="button button-secondary" type="button" disabled={loading || page >= totalPages} onClick={() => setPage((current) => current + 1)}>下一页</button>
    </div>
  </div>;
}
