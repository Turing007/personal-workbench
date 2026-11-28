import { History, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DocumentVersionDetail, DocumentVersionSummary } from '../../../shared/document-versions';
import { DOCUMENT_VERSION_ACTION_LABELS } from '../../../shared/document-versions';
import Modal from '../Modal';

export interface DocumentVersionModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  loadVersions: () => Promise<DocumentVersionSummary[]>;
  loadVersion: (versionNo: number) => Promise<DocumentVersionDetail>;
}

const statusLabels: Record<string, string> = {
  draft: '草稿',
  issued: '已开单',
  void: '已作废',
  sent: '已发送',
  won: '已成交',
  expired: '已失效',
};

function formatMoney(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function text(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return value === null || value === undefined ? '' : String(value);
}

function cents(source: Record<string, unknown>, key: string): number {
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : 0;
}

function itemRows(snapshot: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(snapshot.items)
    ? snapshot.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function errorText(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

/** 只读的单据版本历史：左侧版本列表，右侧版本快照。 */
export default function DocumentVersionModal({
  open,
  title,
  onClose,
  loadVersions,
  loadVersion,
}: DocumentVersionModalProps) {
  const [versions, setVersions] = useState<DocumentVersionSummary[]>([]);
  const [selectedVersionNo, setSelectedVersionNo] = useState<number>();
  const [detail, setDetail] = useState<DocumentVersionDetail>();
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const versionsRef = useRef(loadVersions);
  const versionRef = useRef(loadVersion);
  const detailSeq = useRef(0);
  versionsRef.current = loadVersions;
  versionRef.current = loadVersion;

  const openVersion = async (versionNo: number) => {
    const seq = ++detailSeq.current;
    setSelectedVersionNo(versionNo);
    setLoadingDetail(true);
    setError('');
    try {
      const next = await versionRef.current(versionNo);
      if (seq === detailSeq.current) setDetail(next);
    } catch (reason) {
      if (seq === detailSeq.current) {
        setDetail(undefined);
        setError(errorText(reason, '读取版本快照失败'));
      }
    } finally {
      if (seq === detailSeq.current) setLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    detailSeq.current += 1;
    setVersions([]);
    setSelectedVersionNo(undefined);
    setDetail(undefined);
    setError('');
    setLoading(true);
    // 上一份单据的快照请求可能还在路上，必须一并复位，否则新单据没有版本时会一直停在“读取快照”。
    setLoadingDetail(false);
    void (async () => {
      try {
        const rows = await versionsRef.current();
        if (cancelled) return;
        setVersions(rows);
        if (rows[0]) await openVersion(rows[0].versionNo);
      } catch (reason) {
        if (!cancelled) setError(errorText(reason, '读取版本记录失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const snapshot = detail?.snapshot ?? {};
  const items = itemRows(snapshot);
  const hasQuantity = items.some((item) => item.quantity !== undefined);
  const isSalesDocument = detail?.documentType === 'sales_document';

  return <Modal open={open} title={title} onClose={onClose} width={1040}>
    <div className="document-version-modal">
      <aside className="document-version-list" aria-label="版本列表">
        <div className="document-version-list-head">
          <History size={15} />
          <strong>版本记录</strong>
          <span>{versions.length} 个版本</span>
        </div>
        {loading && <div className="document-version-state"><Loader2 size={15} className="spin" />正在读取版本…</div>}
        {!loading && !versions.length && !error && <div className="document-version-state">
          暂无版本记录。升级后每次创建、编辑保存或状态变更都会自动保留快照；升级前的历史单据无法补录。
        </div>}
        {versions.map((version) => <button
          key={version.id}
          type="button"
          className={`document-version-item${selectedVersionNo === version.versionNo ? ' is-active' : ''}`}
          aria-current={selectedVersionNo === version.versionNo ? 'true' : undefined}
          onClick={() => void openVersion(version.versionNo)}
        >
          <span className="document-version-item-title">
            <strong>V{version.versionNo}</strong>
            <span>{DOCUMENT_VERSION_ACTION_LABELS[version.action] ?? version.action}</span>
          </span>
          <span>{statusLabels[version.documentStatus] ?? version.documentStatus} · {formatMoney(version.totalCents)}</span>
          <small>{version.createdAt.replace('T', ' ').slice(0, 16)}{version.createdBy ? ` · ${version.createdBy}` : ''}</small>
        </button>)}
      </aside>

      <section className="document-version-detail" aria-live="polite">
        {error && <div className="notice notice-danger">{error}</div>}
        {loadingDetail && <div className="document-version-state"><Loader2 size={15} className="spin" />正在读取版本快照…</div>}
        {!loadingDetail && detail && <>
          <header className="document-version-detail-head">
            <div>
              <small>版本快照 · 只读</small>
              <strong>{detail.documentNumber} · V{detail.versionNo}</strong>
              <span>{DOCUMENT_VERSION_ACTION_LABELS[detail.action] ?? detail.action} · {detail.createdAt.replace('T', ' ').slice(0, 16)}{detail.createdBy ? ` · ${detail.createdBy}` : ''}</span>
            </div>
            <span className="badge">{statusLabels[detail.documentStatus] ?? detail.documentStatus}</span>
          </header>

          <dl className="document-version-meta">
            <div><dt>单据日期</dt><dd>{text(snapshot, 'documentDate') || text(snapshot, 'quotationDate') || detail.documentDate}</dd></div>
            <div><dt>客户</dt><dd>{text(snapshot, 'customerName') || '—'}</dd></div>
            <div><dt>联系人</dt><dd>{[text(snapshot, 'contactName'), text(snapshot, 'contactPhone')].filter(Boolean).join(' · ') || '—'}</dd></div>
            {cents(snapshot, 'shippingCents') > 0 && <div><dt>运费</dt><dd>{formatMoney(cents(snapshot, 'shippingCents'))}</dd></div>}
            {cents(snapshot, 'taxCents') > 0 && <div><dt>税额</dt><dd>{formatMoney(cents(snapshot, 'taxCents'))}</dd></div>}
            <div><dt>合计</dt><dd>{formatMoney(detail.totalCents)}</dd></div>
            {isSalesDocument && <>
              <div><dt>已收</dt><dd>{formatMoney(cents(snapshot, 'receivedCents'))}</dd></div>
              <div><dt>未收</dt><dd>{formatMoney(cents(snapshot, 'outstandingCents'))}</dd></div>
              <div><dt>收款笔数</dt><dd>{Array.isArray(snapshot.receipts) ? `${snapshot.receipts.length} 笔` : '0 笔'}</dd></div>
            </>}
            {text(snapshot, 'remark') && <div className="is-wide"><dt>备注</dt><dd>{text(snapshot, 'remark')}</dd></div>}
          </dl>

          <div className="document-version-items">
            <table>
              <thead>
                <tr>
                  <th>品名</th>
                  <th>规格</th>
                  {hasQuantity && <th className="is-number">数量</th>}
                  <th className="is-number">单价</th>
                  <th className="is-number">金额</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const unitPrice = cents(item, 'unitPriceCents');
                  const quantity = hasQuantity ? Number(item.quantity ?? 0) : null;
                  const amount = item.amountCents !== undefined ? cents(item, 'amountCents') : unitPrice * (quantity ?? 1);
                  return <tr key={String(item.id ?? index)}>
                    <td>{text(item, 'name') || '—'}</td>
                    <td>{[text(item, 'specification'), text(item, 'parameters')].filter(Boolean).join(' · ') || '—'}</td>
                    {hasQuantity && <td className="is-number">{quantity}</td>}
                    <td className="is-number">{formatMoney(unitPrice)}</td>
                    <td className="is-number">{formatMoney(amount)}</td>
                  </tr>;
                })}
                {!items.length && <tr><td colSpan={hasQuantity ? 5 : 4} className="is-empty">该版本没有产品行</td></tr>}
              </tbody>
            </table>
          </div>
        </>}
        {!loading && !loadingDetail && !detail && !error && versions.length > 0 && <div className="document-version-placeholder">选择左侧版本查看当时的单据内容。</div>}
      </section>
    </div>
  </Modal>;
}
