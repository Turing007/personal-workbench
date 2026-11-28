import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Download,
  Edit3,
  History,
  PackageSearch,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompanySnapshot, QuotationStatus, QuotationSummary } from '../../shared/documents';
import type { Customer, CustomerSaveInput } from '../../shared/customers';
import * as api from '../api';
import { saveFileOrDownload } from '../file-save';
import { pageWindow, totalPages } from '../pagination';
import { quotationDetailToDraft, quotationDraftToFormData, type QuotationDraft } from '../documents/document-drafts';
import Modal from '../components/Modal';
import DocumentVersionModal from '../components/documents/DocumentVersionModal';
import SearchInput from '../components/SearchInput';
import QuotationForm, { createEmptyQuotationDraft } from '../components/quotations/QuotationForm';
import QuotationProductDetailModal from '../components/quotations/QuotationProductDetailModal';
import QuotationSyncModal from '../components/quotations/QuotationSyncModal';
import { formatMoney } from '../components/quotations/quotation-lines';
import { useIsNarrow } from '../use-is-narrow';
import { useHideOnScroll } from '../use-hide-on-scroll';

export interface QuotationPageProps {
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onOpenSalesDocument?: (salesDocumentId?: number) => void;
  onOpenCustomerProducts?: (customerId: number) => void;
  onSaveCustomerProduct?: (customerId: number, input: import('../../shared/customers').CustomerProductSaveInput) => Promise<import('../../shared/customers').CustomerProduct>;
  onCreateCustomer?: (input: CustomerSaveInput) => Promise<Customer>;
  /** 工作台快捷入口：进入页面后直接新建报价。 */
  startCreate?: boolean;
  onStartCreateConsumed?: () => void;
}

/** 服务端分页页大小：报价单持续增长，列表不再一次性拉全量。 */
const PAGE_SIZE = 50;

const statusLabels: Record<QuotationStatus, string> = { draft: '草稿', sent: '已发送', won: '已成交', expired: '已失效' };
const statusOptions: Array<{ value: 'all' | QuotationStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'sent', label: '已发送' },
  { value: 'won', label: '已成交' },
  { value: 'expired', label: '已失效' },
];

export default function QuotationPage({ onNotify, onOpenSalesDocument, onOpenCustomerProducts, onSaveCustomerProduct, onCreateCustomer, startCreate, onStartCreateConsumed }: QuotationPageProps) {
  const [rows, setRows] = useState<QuotationSummary[]>([]);
  /** 手机端「加载更多」累积行；桌面表格始终只渲染当前页 rows。 */
  const [mobileRows, setMobileRows] = useState<QuotationSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
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
  const [versionQuotation, setVersionQuotation] = useState<QuotationSummary | null>(null);
  const narrow = useIsNarrow();
  const [searchFocused, setSearchFocused] = useState(false);
  // 手机端搜索框悬浮在顶部：连续下滑收起，回滑展开；输入时锁住展开避免打字途中消失。
  const searchHidden = useHideOnScroll(narrow && !searchFocused);
  // 搜索/翻页连续触发时，只认最后一次请求的结果，避免旧响应覆盖新响应。
  const loadSeq = useRef(0);

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

  // 搜索与筛选以服务端为准（覆盖单号/客户/联系人/电话/地址/产品名/SKU/规格），前端不再二次过滤。
  const load = useCallback(async (targetPage: number, mode: 'replace' | 'append' = 'replace') => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const params = { status: filter, q: query.trim(), pageSize: PAGE_SIZE };
      let result = await api.listQuotations({ ...params, page: targetPage });
      let landedPage = targetPage;
      // 删除后当前页可能变空：回退一页，避免停在空白页。
      if (!result.rows.length && result.total > 0 && targetPage > 1) {
        landedPage = targetPage - 1;
        result = await api.listQuotations({ ...params, page: landedPage });
      }
      if (seq !== loadSeq.current) return;
      setPage(landedPage);
      setTotal(result.total);
      setRows(result.rows);
      setMobileRows((current) => (mode === 'append' ? [...current, ...result.rows] : result.rows));
    } catch (error) {
      if (seq !== loadSeq.current) return;
      notify(error instanceof Error ? error.message : '加载报价单失败', 'error');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [filter, notify, query]);

  // 筛选/搜索词变化：回到第 1 页重新拉取。
  useEffect(() => { void load(1); }, [load]);
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
  useEffect(() => {
    if (!startCreate) return;
    void openNew();
    onStartCreateConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCreate]);
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
      await load(page);
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存报价单失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };
  const setStatus = async (row: QuotationSummary, status: QuotationStatus) => {
    if (row.status === status) return;
    setBusyId(row.id);
    try {
      await api.setQuotationStatus(row.id, status);
      notify(`报价单已更新为${statusLabels[status]}`, 'success');
      await load(page);
    } catch (error) {
      notify(error instanceof Error ? error.message : '更新状态失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };
  const remove = async (row: QuotationSummary) => {
    const warning = row.status === 'won' ? `“${row.number}”已成交，删除后仍无法恢复。确定继续吗？` : `确定删除报价单“${row.number}”吗？`;
    if (!window.confirm(warning)) return;
    if (row.status === 'won' && !window.confirm('请再次确认：确实要删除这份已成交报价单？')) return;
    setBusyId(row.id);
    try {
      await api.deleteQuotation(row.id, row.status === 'won');
      notify('报价单已删除', 'success');
      await load(page);
    } catch (error) {
      notify(error instanceof Error ? error.message : '删除报价单失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };
  const exportPdf = async (row: QuotationSummary) => {
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
  const copyToSales = async (row: QuotationSummary) => {
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

  const pageCount = totalPages(total, PAGE_SIZE);
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return <div className="page-shell quotation-page">
    <div className="quotation-page-head">
      <div className="quotation-heading-copy">
        <span className="page-breadcrumb">交易 / 报价单</span>
        <strong className="page-title">报价单</strong>
        <span className="page-subtitle">选品报价、发送客户，成交后转销售单</span>
      </div>
    </div>
    <div className="page-toolbar quotation-toolbar">
      <SearchInput value={query} onChange={setQuery} className={searchHidden ? 'is-scroll-hidden' : undefined} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="搜索单号、客户、联系人、产品" />
      <div className="segmented">{statusOptions.map((option) => <button key={option.value} className={`segmented-item${filter === option.value ? ' is-active' : ''}`} type="button" title={`筛选${option.label}报价单`} onClick={() => setFilter(option.value)}>{option.label}</button>)}</div>
      <span className="toolbar-count">{total} 份</span>
      <button className="icon-button" type="button" title="刷新报价列表" disabled={loading} onClick={() => void load(page)}><RefreshCw size={15} /></button>
      <button className="button button-primary" type="button" title="新建报价单" onClick={() => { void openNew(); }}><Plus size={15} />新建报价</button>
    </div>

    <section className="table-panel quotation-panel">
      <div className="table-scroll quotation-table-desktop"><table className="data-table quotation-data-table"><thead><tr>{['报价单号', '日期', '客户', '产品数', '金额', '状态', '更新时间', '操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td className="strong-cell" style={{ color: 'var(--color-accent)' }}>{row.number}</td>
          <td>{row.quotationDate}</td>
          <td><strong style={{ display: 'block' }}>{row.customerName || '-'}</strong><small style={{ color: 'var(--color-text-secondary)' }}>{[row.contactName, row.contactPhone].filter(Boolean).join(' · ')}</small></td>
          <td>{row.itemCount}</td>
          <td className="quotation-amount-cell">{formatMoney(row.totalCents)}</td>
          <td><select className="toolbar-select" aria-label={`${row.number}状态`} value={row.status} disabled={busyId === row.id} onChange={(event) => void setStatus(row, event.target.value as QuotationStatus)}><option value="draft">草稿</option><option value="sent">已发送</option><option value="won">已成交</option><option value="expired">已失效</option></select></td>
          <td style={{ color: 'var(--color-text-secondary)' }}>{row.updatedAt.replace('T', ' ').slice(0, 16)}</td>
          <td><div className="row-actions">
            <button className="icon-button" type="button" title="产品详情" disabled={busyId === row.id} onClick={() => setProductDetailId(row.id)}><PackageSearch size={14} /></button>
            <button className="icon-button" type="button" title="编辑报价单" disabled={busyId === row.id} onClick={() => void openEdit(row.id)}><Edit3 size={14} /></button>
            <button className="icon-button" type="button" title="导出报价 PDF" disabled={busyId === row.id} onClick={() => void exportPdf(row)}><Download size={14} /></button>
            <button className="icon-button" type="button" title="查看版本记录" disabled={busyId === row.id} onClick={() => setVersionQuotation(row)}><History size={14} /></button>
            <button className="icon-button" type="button" title="同步到客户产品库" disabled={busyId === row.id} onClick={() => { if (!row.customerId) notify('这份报价单还没有选择正式客户，无法同步到客户产品库', 'error'); else setSyncQuotationId(row.id); }}><RefreshCw size={14} /></button>
            {row.status === 'draft' && <button className="icon-button" type="button" title="标记为已发送" disabled={busyId === row.id} onClick={() => void setStatus(row, 'sent')}><Send size={14} /></button>}
            {row.status === 'sent' && <button className="icon-button" type="button" title="标记为已成交" disabled={busyId === row.id} onClick={() => void setStatus(row, 'won')}><CheckCircle2 size={14} /></button>}
            {row.status !== 'expired' && row.status !== 'won' && <button className="icon-button" type="button" title="标记为已失效" disabled={busyId === row.id} onClick={() => void setStatus(row, 'expired')}><XCircle size={14} /></button>}
            {row.status === 'won' && <button className="icon-button" type="button" title="复制为销售开单" disabled={busyId === row.id} onClick={() => void copyToSales(row)}><CopyPlus size={14} /></button>}
            <button className="icon-button danger" type="button" title="删除报价单" disabled={busyId === row.id} onClick={() => void remove(row)}><Trash2 size={14} /></button>
          </div></td>
        </tr>)}</tbody></table></div>
      <div className="quotation-card-list">
        {mobileRows.map((row) => <article key={row.id} className="quotation-card">
          <div className="quotation-card-head">
            <div className="quotation-card-title">
              <strong>{row.number}</strong>
              <span>{row.quotationDate} · 更新 {row.updatedAt.replace('T', ' ').slice(0, 16)}</span>
            </div>
            <select className="toolbar-select" aria-label={`${row.number}状态`} value={row.status} disabled={busyId === row.id} onChange={(event) => void setStatus(row, event.target.value as QuotationStatus)}><option value="draft">草稿</option><option value="sent">已发送</option><option value="won">已成交</option><option value="expired">已失效</option></select>
          </div>
          <div className="quotation-card-grid">
            <div className="quotation-card-field is-wide"><span>客户</span><strong>{row.customerName || '-'}</strong><em>{[row.contactName, row.contactPhone].filter(Boolean).join(' · ')}</em></div>
            <div className="quotation-card-field"><span>产品数</span><strong>{row.itemCount}</strong></div>
            <div className="quotation-card-field"><span>金额</span><strong>{formatMoney(row.totalCents)}</strong></div>
          </div>
          <div className="row-actions">
            <button className="icon-button" type="button" title="产品详情" disabled={busyId === row.id} onClick={() => setProductDetailId(row.id)}><PackageSearch size={14} /></button>
            <button className="icon-button" type="button" title="编辑报价单" disabled={busyId === row.id} onClick={() => void openEdit(row.id)}><Edit3 size={14} /></button>
            <button className="icon-button" type="button" title="导出报价 PDF" disabled={busyId === row.id} onClick={() => void exportPdf(row)}><Download size={14} /></button>
            <button className="icon-button" type="button" title="查看版本记录" disabled={busyId === row.id} onClick={() => setVersionQuotation(row)}><History size={14} /></button>
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
      {!loading && total === 0 && <div className="table-state">暂无符合条件的报价单，点击“新建报价”开始。</div>}
      {!narrow && total > 0 && <div className="quotation-pagination">
        <span>第 {rangeStart}-{rangeEnd} 条</span>
        <div className="quotation-pagination-controls">
          <div className="quotation-pager">
            <button className="icon-button quotation-page-step" type="button" aria-label="上一页" title="上一页" disabled={page <= 1 || loading} onClick={() => void load(page - 1)}><ChevronLeft size={14} /></button>
            {pageWindow(page, pageCount).map((entry, index) => entry === 'gap'
              ? <span className="quotation-page-gap" key={`gap-${index}`}>…</span>
              : <button className={entry === page ? 'quotation-page-button is-current' : 'quotation-page-button'} key={entry} type="button" aria-current={entry === page ? 'page' : undefined} disabled={loading} onClick={() => void load(entry)}>{entry}</button>)}
            <button className="icon-button quotation-page-step" type="button" aria-label="下一页" title="下一页" disabled={page >= pageCount || loading} onClick={() => void load(page + 1)}><ChevronRight size={14} /></button>
          </div>
          <span>第 {page} / {pageCount} 页</span>
        </div>
      </div>}
      {narrow && mobileRows.length < total && <div className="quotation-load-more">
        <button className="button" type="button" disabled={loading} onClick={() => void load(page + 1, 'append')}>{loading ? '正在加载…' : `加载更多（还有 ${total - mobileRows.length} 份）`}</button>
      </div>}
    </section>

    <Modal open={editorOpen} title={draft.number ? `编辑报价 · ${draft.number}` : '新建报价单'} onClose={() => setEditorOpen(false)} width={1200}>
      <QuotationForm customers={customers} value={draft} saving={busyId === (draft.id ?? -1)} onChange={setDraft} onSave={save} onCancel={() => setEditorOpen(false)} onSaveCustomerProduct={onSaveCustomerProduct} onCreateCustomer={createCustomer} onDownloadPdf={draft.id != null ? () => api.downloadQuotationPdf(draft.id as number) : undefined} />
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
    <DocumentVersionModal
      open={versionQuotation != null}
      title={versionQuotation ? `报价单 ${versionQuotation.number} · 版本记录` : '版本记录'}
      onClose={() => setVersionQuotation(null)}
      loadVersions={() => api.listQuotationVersions(versionQuotation!.id)}
      loadVersion={(versionNo) => api.getQuotationVersion(versionQuotation!.id, versionNo)}
    />
  </div>;
}
