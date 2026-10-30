import { ClipboardList, Edit3, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import SearchInput from '../components/SearchInput';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CompanySnapshot,
  PaymentStatus,
  SalesDocumentDetail,
  SalesDocumentStatus,
  SalesDocumentSummary,
  SalesReceipt,
} from '../../shared/documents';
import type { Customer, CustomerProduct, CustomerProductSaveInput, CustomerSaveInput } from '../../shared/customers';
import {
  createOrderFromSalesDocument,
  deleteSalesDocument,
  downloadSalesDocumentPdf,
  getCompanyProfile,
  getSalesDocument,
  listSalesDocuments,
  saveSalesDocument,
  setSalesDocumentStatus,
} from '../api';
import Modal from '../components/Modal';
import PdfDownloadButton from '../components/documents/PdfDownloadButton';
import SalesDocumentForm, { createEmptySalesDocumentDraft } from '../components/sales/SalesDocumentForm';
import type { SalesDocumentDraft } from '../documents/document-drafts';
import { salesDocumentDetailToDraft, salesDocumentDraftToFormData } from '../documents/document-drafts';
import { useIsNarrow } from '../use-is-narrow';
import { useHideOnScroll } from '../use-hide-on-scroll';

export interface SalesDocumentsPageProps {
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  customers: Customer[];
  onSaveCustomerProduct?: (customerId: number, input: CustomerProductSaveInput) => Promise<CustomerProduct>;
  onCreateCustomer?: (input: CustomerSaveInput) => Promise<Customer>;
  onOpenOrder?: (orderId: number) => void | Promise<void>;
}

const documentStatusLabels: Record<SalesDocumentStatus, string> = { draft: '草稿', issued: '已开单', void: '已作废' };
const paymentStatusLabels: Record<PaymentStatus, string> = { unpaid: '未付款', partial: '部分付款', paid: '已付清' };

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

export default function SalesDocumentsPage({ onNotify, customers, onSaveCustomerProduct, onCreateCustomer, onOpenOrder }: SalesDocumentsPageProps) {
  const [rows, setRows] = useState<SalesDocumentSummary[]>([]);
  const [query, setQuery] = useState('');
  const [documentStatus, setDocumentStatusFilter] = useState<'all' | SalesDocumentStatus>('all');
  const [paymentStatus, setPaymentStatusFilter] = useState<'all' | PaymentStatus>('all');
  const [company, setCompany] = useState<CompanySnapshot>();
  const [draft, setDraft] = useState<SalesDocumentDraft>(() => createEmptySalesDocumentDraft());
  const [receipts, setReceipts] = useState<SalesReceipt[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number>();
  const narrow = useIsNarrow();
  const [searchFocused, setSearchFocused] = useState(false);
  // 手机端搜索框悬浮在顶部：连续下滑收起，回滑展开；输入时锁住展开避免打字途中消失。
  const searchHidden = useHideOnScroll(narrow && !searchFocused);

  const notify = useCallback((message: string, tone: 'success' | 'error' | 'info' = 'info') => {
    onNotify?.(message, tone);
  }, [onNotify]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listSalesDocuments({
        q: query.trim(),
        documentStatus,
        paymentStatus,
        page: 1,
        pageSize: 100,
      });
      setRows(result.rows);
    } catch (error) {
      notify(errorMessage(error, '加载销售单失败'), 'error');
    } finally {
      setLoading(false);
    }
  }, [documentStatus, notify, paymentStatus, query]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void getCompanyProfile().then(setCompany).catch(() => undefined);
  }, []);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => (
      (documentStatus === 'all' || row.documentStatus === documentStatus)
      && (paymentStatus === 'all' || row.paymentStatus === paymentStatus)
      && (!needle || [row.number, row.customerName, row.purchaseOrderNo].join(' ').toLowerCase().includes(needle))
    ));
  }, [documentStatus, paymentStatus, query, rows]);

  const applyDetail = (detail: SalesDocumentDetail) => {
    setDraft(salesDocumentDetailToDraft(detail));
    setReceipts(detail.receipts);
  };

  const openNew = () => {
    setDraft(createEmptySalesDocumentDraft(company));
    setReceipts([]);
    setEditorOpen(true);
  };

  const openEdit = async (id: number) => {
    setBusyId(id);
    try {
      applyDetail(await getSalesDocument(id));
      setEditorOpen(true);
    } catch (error) {
      notify(errorMessage(error, '读取销售单失败'), 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  const refreshDetail = async () => {
    if (!draft.id) return;
    try {
      applyDetail(await getSalesDocument(draft.id));
      await load();
    } catch (error) {
      notify(errorMessage(error, '刷新销售单失败'), 'error');
    }
  };

  const save = async (nextDraft: SalesDocumentDraft) => {
    setSaving(true);
    try {
      const detail = await saveSalesDocument(salesDocumentDraftToFormData(nextDraft), nextDraft.id);
      applyDetail(detail);
      notify(nextDraft.id ? '销售单已保存' : `销售单 ${detail.number} 已创建，可继续添加收款`, 'success');
      await load();
    } catch (error) {
      notify(errorMessage(error, '保存销售单失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (row: SalesDocumentSummary, status: SalesDocumentStatus) => {
    if (row.documentStatus === status) return;
    if (status === 'void' && !window.confirm(`确定将销售单“${row.number}”标记为已作废吗？作废后将永久保留且不能编辑。`)) return;
    setBusyId(row.id);
    try {
      await setSalesDocumentStatus(row.id, status);
      notify(`销售单已更新为${documentStatusLabels[status]}`, 'success');
      await load();
    } catch (error) {
      notify(errorMessage(error, '更新销售单状态失败'), 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  const remove = async (row: SalesDocumentSummary) => {
    if (row.documentStatus === 'void') return;
    if (!window.confirm(`确定删除销售单“${row.number}”吗？`)) return;
    if (row.documentStatus === 'issued' && !window.confirm('该销售单已开单，请再次确认删除。')) return;
    setBusyId(row.id);
    try {
      await deleteSalesDocument(row.id, row.documentStatus === 'issued');
      notify('销售单已删除', 'success');
      await load();
    } catch (error) {
      notify(errorMessage(error, '删除销售单失败'), 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  const generateOrder = async (row: SalesDocumentSummary) => {
    if (!window.confirm(`确定根据销售单“${row.number}”生成订单吗？产品、单价、运费将带入新订单。`)) return;
    setBusyId(row.id);
    try {
      const order = await createOrderFromSalesDocument(row.id);
      notify(`订单 ${order.orderNo} 已生成`, 'success');
      await load();
    } catch (error) {
      notify(errorMessage(error, '生成订单失败'), 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  return <div className="page-shell sales-documents-page">
    <div className="sales-page-head">
      <div className="sales-heading-copy">
        <span className="page-breadcrumb">交易 / 销售单</span>
        <strong className="page-title">销售单</strong>
        <span className="page-subtitle">销售开单、收款跟踪，并可直接生成订单</span>
      </div>
    </div>
    <div className="page-toolbar sales-docs-toolbar">
      <SearchInput value={query} onChange={setQuery} className={searchHidden ? 'is-scroll-hidden' : undefined} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="搜索销售单号、客户、采购单号" />
      <div className="sales-doc-status-row">
        <select className="toolbar-select" aria-label="单据状态筛选" value={documentStatus} onChange={(event) => setDocumentStatusFilter(event.target.value as 'all' | SalesDocumentStatus)}>
          <option value="all">全部单据状态</option><option value="draft">草稿</option><option value="issued">已开单</option><option value="void">已作废</option>
        </select>
        <select className="toolbar-select" aria-label="付款状态筛选" value={paymentStatus} onChange={(event) => setPaymentStatusFilter(event.target.value as 'all' | PaymentStatus)}>
          <option value="all">全部付款状态</option><option value="unpaid">未付款</option><option value="partial">部分付款</option><option value="paid">已付清</option>
        </select>
      </div>
      <span className="toolbar-count">{visibleRows.length} 份</span>
      <button className="icon-button" type="button" title="刷新销售单列表" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /></button>
      <button className="button button-primary" type="button" title="独立新建销售单" onClick={openNew}><Plus size={15} />新建销售单</button>
    </div>

    <section className="table-panel sales-panel">
      <div className="table-scroll sales-doc-table-desktop"><table className="data-table sales-data-table">
        <thead><tr>{['销售单号', '日期', '客户', '采购单号', '含税合计', '已收', '未付', '单据状态', '付款状态', '更新时间', '操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead>
        <tbody>{visibleRows.map((row) => {
          const receivedCents = Math.max(0, row.totalCents - row.outstandingCents);
          return <tr key={row.id}>
              <td className="strong-cell" style={{ color: 'var(--color-accent)' }}>{row.number}{row.generatedOrderNo && <small style={{ display: 'block', color: 'var(--color-text-secondary)', fontWeight: 400 }} title="该销售单已生成的订单">订单 {row.generatedOrderNo}</small>}</td>
            <td>{row.documentDate}</td>
            <td className="strong-cell">{row.customerName || '-'}</td>
            <td>{row.purchaseOrderNo || '-'}</td>
            <td className="strong-cell">{formatMoney(row.totalCents)}</td>
            <td>{formatMoney(receivedCents)}</td>
            <td className="amount" style={{ color: row.outstandingCents > 0 ? 'var(--color-warning-text)' : 'var(--color-accent)' }}>{formatMoney(row.outstandingCents)}</td>
            <td><select className="toolbar-select" aria-label={`${row.number}单据状态`} value={row.documentStatus} disabled={busyId === row.id || row.documentStatus === 'void'} onChange={(event) => void changeStatus(row, event.target.value as SalesDocumentStatus)}><option value="draft">草稿</option><option value="issued">已开单</option><option value="void">已作废</option></select></td>
            <td><span className={`badge ${row.paymentStatus === 'paid' ? 'badge-success' : row.paymentStatus === 'partial' ? 'badge-warning' : 'badge-neutral'}`}>{paymentStatusLabels[row.paymentStatus]}</span></td>
            <td style={{ color: 'var(--color-text-secondary)' }}>{row.updatedAt.replace('T', ' ').slice(0, 16)}</td>
            <td><div className="row-actions">
              <button className="icon-button" type="button" title={row.documentStatus === 'void' ? '查看销售单' : '编辑销售单'} disabled={busyId === row.id} onClick={() => void openEdit(row.id)}><Edit3 size={14} /></button>
              <PdfDownloadButton number={row.number} download={() => downloadSalesDocumentPdf(row.id)} onError={(message) => notify(message, 'error')} disabled={busyId === row.id} />
              {row.documentStatus === 'issued' && !row.generatedOrderNo && <button className="icon-button" type="button" title="从本销售单生成订单" disabled={busyId === row.id} onClick={() => void generateOrder(row)}><ClipboardList size={14} /></button>}
              {row.generatedOrderId != null && row.generatedOrderNo && <button className="icon-button" type="button" title={`查看生成的订单 ${row.generatedOrderNo}`} disabled={busyId === row.id} onClick={() => void onOpenOrder?.(row.generatedOrderId!)}><ExternalLink size={14} /></button>}
              {row.documentStatus !== 'void' && <button className="icon-button danger" type="button" title="删除销售单" disabled={busyId === row.id} onClick={() => void remove(row)}><Trash2 size={14} /></button>}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      <div className="sales-doc-card-list">
        {visibleRows.map((row) => {
          const receivedCents = Math.max(0, row.totalCents - row.outstandingCents);
          return <article key={row.id} className="sales-doc-card">
            <div className="sales-doc-card-head">
              <div className="sales-doc-card-title">
                <strong>{row.number}</strong>
                <span>{row.documentDate} · 更新 {row.updatedAt.replace('T', ' ').slice(0, 16)}</span>
              </div>
              <span className={`badge ${row.paymentStatus === 'paid' ? 'badge-success' : row.paymentStatus === 'partial' ? 'badge-warning' : 'badge-neutral'}`}>{paymentStatusLabels[row.paymentStatus]}</span>
            </div>
            <div className="sales-doc-card-grid">
              <div className="sales-doc-card-field"><span>客户</span><strong>{row.customerName || '-'}</strong><em>{row.purchaseOrderNo ? `采购单 ${row.purchaseOrderNo}` : ''}</em></div>
              <div className="sales-doc-card-field"><span>含税合计</span><strong>{formatMoney(row.totalCents)}</strong></div>
              <div className="sales-doc-card-field"><span>已收</span><strong>{formatMoney(receivedCents)}</strong></div>
              <div className="sales-doc-card-field"><span>未付</span><strong style={row.outstandingCents > 0 ? { color: 'var(--color-warning-text)' } : { color: 'var(--color-accent)' }}>{formatMoney(row.outstandingCents)}</strong></div>
            </div>
            <div className="sales-doc-card-status">
              <select className="toolbar-select" aria-label={`${row.number}单据状态`} value={row.documentStatus} disabled={busyId === row.id || row.documentStatus === 'void'} onChange={(event) => void changeStatus(row, event.target.value as SalesDocumentStatus)}><option value="draft">草稿</option><option value="issued">已开单</option><option value="void">已作废</option></select>
            </div>
            <div className="row-actions">
              <button className="icon-button" type="button" title={row.documentStatus === 'void' ? '查看销售单' : '编辑销售单'} disabled={busyId === row.id} onClick={() => void openEdit(row.id)}><Edit3 size={14} /></button>
              <PdfDownloadButton number={row.number} download={() => downloadSalesDocumentPdf(row.id)} onError={(message) => notify(message, 'error')} disabled={busyId === row.id} />
              {row.documentStatus === 'issued' && !row.generatedOrderNo && <button className="icon-button" type="button" title="从本销售单生成订单" disabled={busyId === row.id} onClick={() => void generateOrder(row)}><ClipboardList size={14} /></button>}
              {row.generatedOrderId != null && row.generatedOrderNo && <button className="icon-button" type="button" title={`查看生成的订单 ${row.generatedOrderNo}`} disabled={busyId === row.id} onClick={() => void onOpenOrder?.(row.generatedOrderId!)}><ExternalLink size={14} /></button>}
              {row.documentStatus !== 'void' && <button className="icon-button danger" type="button" title="删除销售单" disabled={busyId === row.id} onClick={() => void remove(row)}><Trash2 size={14} /></button>}
            </div>
          </article>;
        })}
      </div>
      {loading && <div className="table-state">正在加载销售单...</div>}
      {!loading && !visibleRows.length && <div className="table-state">暂无符合条件的销售单，可独立新建或从已成交报价复制。</div>}
    </section>

    <Modal open={editorOpen} title={draft.number ? `销售单 · ${draft.number}` : '新建销售单'} onClose={() => setEditorOpen(false)} width={1200}>
      <SalesDocumentForm
        customers={customers}
        value={draft}
        receipts={receipts}
        saving={saving}
        onChange={setDraft}
        onSave={save}
        onCancel={() => setEditorOpen(false)}
        onRefreshReceipts={refreshDetail}
        onNotify={notify}
        onSaveCustomerProduct={onSaveCustomerProduct}
        onCreateCustomer={onCreateCustomer}
      />
    </Modal>
  </div>;
}
