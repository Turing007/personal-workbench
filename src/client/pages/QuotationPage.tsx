import {
  CheckCircle2,
  CopyPlus,
  Download,
  Edit3,
  PackageSearch,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanySnapshot, QuotationStatus, QuotationSummary } from '../../shared/documents';
import type { Customer, CustomerSaveInput } from '../../shared/customers';
import * as api from '../api';
import { saveFileOrDownload } from '../file-save';
import { quotationDetailToDraft, quotationDraftToFormData, type QuotationDraft } from '../documents/document-drafts';
import Modal from '../components/Modal';
import SearchInput from '../components/SearchInput';
import QuotationForm, { createEmptyQuotationDraft } from '../components/quotations/QuotationForm';
import QuotationProductDetailModal from '../components/quotations/QuotationProductDetailModal';
import QuotationSyncModal from '../components/quotations/QuotationSyncModal';
import { useIsNarrow } from '../use-is-narrow';
import { useHideOnScroll } from '../use-hide-on-scroll';

export interface QuotationPageProps {
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onOpenSalesDocument?: (salesDocumentId?: number) => void;
  onOpenCustomerProducts?: (customerId: number) => void;
  onSaveCustomerProduct?: (customerId: number, input: import('../../shared/customers').CustomerProductSaveInput) => Promise<import('../../shared/customers').CustomerProduct>;
  onCreateCustomer?: (input: CustomerSaveInput) => Promise<Customer>;
}

interface QuotationListRow extends QuotationSummary {
  itemCount?: number;
  subtotalCents?: number;
}

const statusLabels: Record<QuotationStatus, string> = { draft: '草稿', sent: '已发送', won: '已成交', expired: '已失效' };
const statusOptions: Array<{ value: 'all' | QuotationStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'sent', label: '已发送' },
  { value: 'won', label: '已成交' },
  { value: 'expired', label: '已失效' },
];

export default function QuotationPage({ onNotify, onOpenSalesDocument, onOpenCustomerProducts, onSaveCustomerProduct, onCreateCustomer }: QuotationPageProps) {
  const [rows, setRows] = useState<QuotationListRow[]>([]);
  const [filter, setFilter] = useState<'all' | QuotationStatus>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [companyProfile, setCompanyProfile] = useState<CompanySnapshot | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [draft, setDraft] = useState<QuotationDraft>(() => createEmptyQuotationDraft());
  const [syncQuotationId, setSyncQuotationId] = useState<number | null>(null);
  const [productDetailId, setProductDetailId] = useState<number | null>(null);
  const narrow = useIsNarrow();
  const [searchFocused, setSearchFocused] = useState(false);
  // 手机端搜索框悬浮在顶部：连续下滑收起，回滑展开；输入时锁住展开避免打字途中消失。
  const searchHidden = useHideOnScroll(narrow && !searchFocused);

  const notify = useCallback((message: string, tone: 'success' | 'error' | 'info' = 'info') => {
    onNotify?.(message, tone);
  }, [onNotify]);

  // 弹窗内快速新增客户后，同步进本页客户列表，避免清空后搜索不到新客户
  const createCustomer = useCallback(async (input: CustomerSaveInput) => {
    if (!onCreateCustomer) throw new Error('客户创建服务未配置');
    const customer = await onCreateCustomer(input);
    setCustomers((current) => (current.some((item) => item.id === customer.id) ? current : [...current, customer]));
    return customer;
  }, [onCreateCustomer]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listQuotations({ status: filter, q: query.trim(), page: 1, pageSize: 100 });
      setRows(result.rows);
    } catch (error) {
      notify(error instanceof Error ? error.message : '加载报价单失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [filter, notify, query]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    void api.getCompanyProfile().then((company) => {
      if (active) setCompanyProfile(company);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    void api.getCustomers(false).then((items) => {
      if (active) setCustomers(items);
    }).catch((error) => notify(error instanceof Error ? error.message : '加载客户档案失败', 'error'));
    return () => { active = false; };
  }, [notify]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => (filter === 'all' || row.status === filter) && (!needle || [row.number, row.customerName, row.contactName, row.contactPhone].join(' ').toLowerCase().includes(needle)));
  }, [filter, query, rows]);

  const openNew = async () => {
    let profile = companyProfile;
    try {
      // Refresh on every new document so changes made in Settings are used immediately.
      profile = await api.getCompanyProfile();
      setCompanyProfile(profile);
    } catch (error) {
      if (!profile) notify(error instanceof Error ? error.message : '读取公司资料失败', 'error');
    }
    setDraft(createEmptyQuotationDraft(profile ?? undefined));
    setEditorOpen(true);
  };
  const openEdit = async (id: number) => {
    setBusyId(id);
    try {
      setDraft(quotationDetailToDraft(await api.getQuotation(id)));
      setEditorOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : '读取报价单失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };
  const save = async (nextDraft: QuotationDraft) => {
    setBusyId(nextDraft.id ?? -1);
    try {
      const body = quotationDraftToFormData(nextDraft);
      const saved = nextDraft.id ? await api.updateQuotation(nextDraft.id, body) : await api.createQuotation(body);
      setDraft(quotationDetailToDraft(saved));
      notify('报价单已保存', 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存报价单失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };
  const setStatus = async (row: QuotationListRow, status: QuotationStatus) => {
    if (row.status === status) return;
    setBusyId(row.id);
    try {
      await api.setQuotationStatus(row.id, status);
      notify(`报价单已更新为${statusLabels[status]}`, 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : '更新状态失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };
  const remove = async (row: QuotationListRow) => {
    const warning = row.status === 'won' ? `“${row.number}”已成交，删除后仍无法恢复。确定继续吗？` : `确定删除报价单“${row.number}”吗？`;
    if (!window.confirm(warning)) return;
    if (row.status === 'won' && !window.confirm('请再次确认：确实要删除这份已成交报价单？')) return;
    setBusyId(row.id);
    try {
      await api.deleteQuotation(row.id, row.status === 'won');
      notify('报价单已删除', 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : '删除报价单失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };
  const exportPdf = async (row: QuotationListRow) => {
    setBusyId(row.id);
    try {
      // App 壳里由原生写进手机「下载」并弹分享；浏览器里回退 blob 链接下载。
      await saveFileOrDownload(await api.downloadQuotationPdf(row.id), `${row.number}.pdf`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '导出 PDF 失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };
  const copyToSales = async (row: QuotationListRow) => {
    if (row.status !== 'won') return;
    setBusyId(row.id);
    try {
      const sales = await api.copyQuotationToSales(row.id);
      notify(`已生成销售单 ${sales.number}`, 'success');
      onOpenSalesDocument?.(sales.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : '复制销售开单失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  return <div className="page-shell quotation-page">
    <div className="page-toolbar quotation-toolbar">
      <SearchInput value={query} onChange={setQuery} className={searchHidden ? 'is-scroll-hidden' : undefined} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="搜索单号、客户、联系人、电话" />
      <div className="segmented">{statusOptions.map((option) => <button key={option.value} className={`segmented-item${filter === option.value ? ' is-active' : ''}`} type="button" title={`筛选${option.label}报价单`} onClick={() => setFilter(option.value)}>{option.label}</button>)}</div>
      <span className="toolbar-count">{visibleRows.length} 份</span>
      <button className="icon-button" type="button" title="刷新报价列表" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /></button>
      <button className="button button-primary" type="button" title="新建报价单" onClick={() => { void openNew(); }}><Plus size={15} />新建报价</button>
    </div>

    <section className="table-panel">
      <div className="table-scroll quotation-table-desktop"><table className="data-table" style={{ minWidth: 900 }}><thead><tr>{['报价单号', '日期', '客户', '产品数', '状态', '更新时间', '操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead>
        <tbody>{visibleRows.map((row) => <tr key={row.id}>
          <td className="strong-cell" style={{ color: '#0f766e' }}>{row.number}</td>
          <td>{row.quotationDate}</td>
          <td><strong style={{ display: 'block' }}>{row.customerName || '-'}</strong><small style={{ color: '#64748b' }}>{[row.contactName, row.contactPhone].filter(Boolean).join(' · ')}</small></td>
          <td>{row.itemCount ?? '-'}</td>
          <td><select className="toolbar-select" aria-label={`${row.number}状态`} value={row.status} disabled={busyId === row.id} onChange={(event) => void setStatus(row, event.target.value as QuotationStatus)}><option value="draft">草稿</option><option value="sent">已发送</option><option value="won">已成交</option><option value="expired">已失效</option></select></td>
          <td style={{ color: '#64748b' }}>{row.updatedAt.replace('T', ' ').slice(0, 16)}</td>
          <td><div className="row-actions">
            <button className="icon-button" type="button" title="产品详情" disabled={busyId === row.id} onClick={() => setProductDetailId(row.id)}><PackageSearch size={14} /></button>
            <button className="icon-button" type="button" title="编辑报价单" disabled={busyId === row.id} onClick={() => void openEdit(row.id)}><Edit3 size={14} /></button>
            <button className="icon-button" type="button" title="导出报价 PDF" disabled={busyId === row.id} onClick={() => void exportPdf(row)}><Download size={14} /></button>
            <button className="icon-button" type="button" title="同步到客户产品库" disabled={busyId === row.id} onClick={() => { if (!row.customerId) notify('这份报价单还没有选择正式客户，无法同步到客户产品库', 'error'); else setSyncQuotationId(row.id); }}><RefreshCw size={14} /></button>
            {row.status === 'draft' && <button className="icon-button" type="button" title="标记为已发送" disabled={busyId === row.id} onClick={() => void setStatus(row, 'sent')}><Send size={14} /></button>}
            {row.status === 'sent' && <button className="icon-button" type="button" title="标记为已成交" disabled={busyId === row.id} onClick={() => void setStatus(row, 'won')}><CheckCircle2 size={14} /></button>}
            {row.status !== 'expired' && row.status !== 'won' && <button className="icon-button" type="button" title="标记为已失效" disabled={busyId === row.id} onClick={() => void setStatus(row, 'expired')}><XCircle size={14} /></button>}
            {row.status === 'won' && <button className="icon-button" type="button" title="复制为销售开单" disabled={busyId === row.id} onClick={() => void copyToSales(row)}><CopyPlus size={14} /></button>}
            <button className="icon-button danger" type="button" title="删除报价单" disabled={busyId === row.id} onClick={() => void remove(row)}><Trash2 size={14} /></button>
          </div></td>
        </tr>)}</tbody></table></div>
      <div className="quotation-card-list">
        {visibleRows.map((row) => <article key={row.id} className="quotation-card">
          <div className="quotation-card-head">
            <div className="quotation-card-title">
              <strong>{row.number}</strong>
              <span>{row.quotationDate} · 更新 {row.updatedAt.replace('T', ' ').slice(0, 16)}</span>
            </div>
            <select className="toolbar-select" aria-label={`${row.number}状态`} value={row.status} disabled={busyId === row.id} onChange={(event) => void setStatus(row, event.target.value as QuotationStatus)}><option value="draft">草稿</option><option value="sent">已发送</option><option value="won">已成交</option><option value="expired">已失效</option></select>
          </div>
          <div className="quotation-card-grid">
            <div className="quotation-card-field"><span>客户</span><strong>{row.customerName || '-'}</strong><em>{[row.contactName, row.contactPhone].filter(Boolean).join(' · ')}</em></div>
            <div className="quotation-card-field"><span>产品数</span><strong>{row.itemCount ?? '-'}</strong></div>
          </div>
          <div className="row-actions">
            <button className="icon-button" type="button" title="产品详情" disabled={busyId === row.id} onClick={() => setProductDetailId(row.id)}><PackageSearch size={14} /></button>
            <button className="icon-button" type="button" title="编辑报价单" disabled={busyId === row.id} onClick={() => void openEdit(row.id)}><Edit3 size={14} /></button>
            <button className="icon-button" type="button" title="导出报价 PDF" disabled={busyId === row.id} onClick={() => void exportPdf(row)}><Download size={14} /></button>
            <button className="icon-button" type="button" title="同步到客户产品库" disabled={busyId === row.id} onClick={() => { if (!row.customerId) notify('这份报价单还没有选择正式客户，无法同步到客户产品库', 'error'); else setSyncQuotationId(row.id); }}><RefreshCw size={14} /></button>
            {row.status === 'draft' && <button className="icon-button" type="button" title="标记为已发送" disabled={busyId === row.id} onClick={() => void setStatus(row, 'sent')}><Send size={14} /></button>}
            {row.status === 'sent' && <button className="icon-button" type="button" title="标记为已成交" disabled={busyId === row.id} onClick={() => void setStatus(row, 'won')}><CheckCircle2 size={14} /></button>}
            {row.status !== 'expired' && row.status !== 'won' && <button className="icon-button" type="button" title="标记为已失效" disabled={busyId === row.id} onClick={() => void setStatus(row, 'expired')}><XCircle size={14} /></button>}
            {row.status === 'won' && <button className="icon-button" type="button" title="复制为销售开单" disabled={busyId === row.id} onClick={() => void copyToSales(row)}><CopyPlus size={14} /></button>}
            <button className="icon-button danger" type="button" title="删除报价单" disabled={busyId === row.id} onClick={() => void remove(row)}><Trash2 size={14} /></button>
          </div>
        </article>)}
      </div>
      {loading && <div className="table-state">正在加载报价单...</div>}
      {!loading && !visibleRows.length && <div className="table-state">暂无符合条件的报价单，点击“新建报价”开始。</div>}
    </section>

    <Modal open={editorOpen} title={draft.number ? `编辑报价 · ${draft.number}` : '新建报价单'} onClose={() => setEditorOpen(false)} width={1240}>
      <QuotationForm customers={customers} value={draft} saving={busyId === (draft.id ?? -1)} onChange={setDraft} onSave={save} onCancel={() => setEditorOpen(false)} onSaveCustomerProduct={onSaveCustomerProduct} onCreateCustomer={createCustomer} />
    </Modal>
    <QuotationSyncModal
      open={syncQuotationId != null}
      quotationId={syncQuotationId}
      onClose={() => setSyncQuotationId(null)}
      onNotify={notify}
      onOpenCustomerProducts={(customerId) => {
        setSyncQuotationId(null);
        onOpenCustomerProducts?.(customerId);
      }}
    />
    <QuotationProductDetailModal open={productDetailId != null} quotationId={productDetailId} onClose={() => setProductDetailId(null)} />
  </div>;
}
