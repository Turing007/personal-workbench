import { Check, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  QuotationCustomerProductSyncPreview,
  QuotationCustomerProductSyncResult,
} from '../../../shared/customers';
import * as api from '../../api';
import Modal from '../Modal';

export interface QuotationSyncModalProps {
  open: boolean;
  quotationId: number | null;
  onClose: () => void;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onOpenCustomerProducts?: (customerId: number) => void;
}

const actionLabels = { create: '新增', update: '更新报价', unchanged: '无变化' } as const;
const resultLabels = { created: '已新增', updated: '已更新', unchanged: '无变化', failed: '失败' } as const;

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default function QuotationSyncModal({ open, quotationId, onClose, onNotify, onOpenCustomerProducts }: QuotationSyncModalProps) {
  const [preview, setPreview] = useState<QuotationCustomerProductSyncPreview | null>(null);
  const [result, setResult] = useState<QuotationCustomerProductSyncResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || quotationId == null) return;
    let cancelled = false;
    setPreview(null);
    setResult(null);
    setSelectedIds([]);
    setError('');
    setLoading(true);
    void api.previewQuotationCustomerProductSync(quotationId).then((next) => {
      if (cancelled) return;
      setPreview(next);
      setSelectedIds(next.items.map((item) => item.quotationItemId));
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '读取同步预览失败');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, quotationId]);

  const allSelected = Boolean(preview?.items.length) && selectedIds.length === preview?.items.length;
  const selectedCount = selectedIds.length;
  const summary = useMemo(() => result?.summary ?? { created: 0, updated: 0, unchanged: 0, failed: 0 }, [result]);

  const toggleAll = () => {
    if (!preview) return;
    setSelectedIds(allSelected ? [] : preview.items.map((item) => item.quotationItemId));
  };

  const sync = async () => {
    if (quotationId == null || !selectedIds.length) return;
    setSyncing(true);
    setError('');
    try {
      const next = await api.syncQuotationCustomerProducts(quotationId, selectedIds);
      setResult(next);
      onNotify?.(`客户产品同步完成：新增 ${next.summary.created}，更新 ${next.summary.updated}`, 'success');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '同步客户产品失败';
      setError(message);
      onNotify?.(message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  return <Modal
    open={open}
    title="同步到客户产品库"
    onClose={syncing ? () => undefined : onClose}
    width={820}
    footer={<>
      <button type="button" className="button button-secondary" disabled={syncing} onClick={onClose}><X size={14} />关闭</button>
      {result && <button type="button" className="button" onClick={() => onOpenCustomerProducts?.(result.customerId)}>进入客户产品库</button>}
      {!result && <button type="button" className="button button-primary" disabled={loading || syncing || !selectedCount} onClick={() => { void sync(); }}><RefreshCw size={14} />{syncing ? '同步中…' : `确认同步${selectedCount ? `（${selectedCount}）` : ''}`}</button>}
    </>}
  >
    <div style={{ display: 'grid', gap: 10 }}>
      {error && <div role="alert" style={{ padding: '8px 10px', border: '1px solid #fecaca', borderRadius: 'var(--radius-ui)', background: '#fef2f2', color: '#b91c1c', fontSize: 12 }}>{error}</div>}
      {loading && <div className="table-state">正在生成同步预览…</div>}
      {!loading && preview && !result && <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 12 }}>
          <span>报价产品默认全部勾选；只会把勾选的产品同步到当前客户。</span>
          <button type="button" className="button button-secondary" onClick={toggleAll}>{allSelected ? '取消全选' : '全选产品'}</button>
        </div>
        <div className="sticky-thead" style={{ overflow: 'auto', maxHeight: 'min(50vh, 420px)', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-ui)' }}>
          <table className="data-table" style={{ minWidth: 680 }}><thead><tr><th style={{ width: 38 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选同步产品" /></th><th>产品</th><th>规格</th><th>本次报价</th><th>同步预判</th></tr></thead>
            <tbody>{preview.items.map((item) => <tr key={item.quotationItemId}>
              <td><input type="checkbox" checked={selectedIds.includes(item.quotationItemId)} onChange={() => setSelectedIds((current) => current.includes(item.quotationItemId) ? current.filter((id) => id !== item.quotationItemId) : [...current, item.quotationItemId])} aria-label={`选择${item.name}`} /></td>
              <td><strong>{item.name || '-'}</strong></td><td>{item.specification || '-'}</td><td>{money(item.unitPriceCents)}</td><td><span style={{ color: item.action === 'create' ? '#0f766e' : item.action === 'update' ? '#b45309' : '#64748b' }}>{actionLabels[item.action]}</span></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!preview.items.length && <div className="table-state">这份报价单没有可同步的产品。</div>}
      </>}
      {result && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 7 }}>
          {([['created', '新增'], ['updated', '更新'], ['unchanged', '无变化'], ['failed', '失败']] as const).map(([key, label]) => <div key={key} style={{ padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-ui)', background: '#f8fafc' }}><small style={{ color: '#64748b' }}>{label}</small><strong style={{ display: 'block', marginTop: 3, fontSize: 18, color: key === 'failed' ? '#b91c1c' : '#17212b' }}>{summary[key]}</strong></div>)}
        </div>
        <div className="sticky-thead" style={{ overflow: 'auto', maxHeight: 'min(50vh, 420px)', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-ui)' }}><table className="data-table"><thead><tr><th>产品</th><th>结果</th><th>说明</th></tr></thead><tbody>{result.items.map((item) => {
          const source = preview?.items.find((candidate) => candidate.quotationItemId === item.quotationItemId);
          return <tr key={item.quotationItemId}><td>{source?.name ?? `产品行 ${item.quotationItemId}`}</td><td><span style={{ color: item.status === 'failed' ? '#b91c1c' : '#0f766e' }}>{resultLabels[item.status]}</span></td><td>{item.error || '-'}</td></tr>;
        })}</tbody></table></div>
      </>}
    </div>
  </Modal>;
}
