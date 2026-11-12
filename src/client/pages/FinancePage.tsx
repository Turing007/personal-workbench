import { ArrowLeft, Building2, CalendarDays, ChevronLeft, ChevronRight, Columns3, Copy, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../components/Modal';
import AnchoredPopover from '../components/AnchoredPopover';
import SearchInput from '../components/SearchInput';
import PaymentProofEditor from '../components/finance/PaymentProofEditor';
import InvoiceEditor from '../components/finance/InvoiceEditor';
import CompanyManager from '../components/finance/CompanyManager';
import FilterRail, { FilterCheckList } from '../components/FilterRail';
import { useFilterRailOpen, useSavedFilterViews } from '../filter-views';
import { badgeClass, errorText, money } from '../components/finance/finance-format';
import {
  getOrderFinance,
  listFinanceOrders,
  listCompanyBreakdown,
  type ApiFinanceDetail,
} from '../api';
import {
  FINANCE_PAYMENT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  PAYMENT_PROOF_STATUS_LABELS,
  currentMonth,
  type FinanceListResult,
  type FinancePaymentStatus,
  type FinanceProofStatus,
  type InvoiceStatus,
} from '../../shared/finance';
import { buildCompanyInvoiceInfoText, companyDisplayName, type Company, type CompanyReceiptBreakdownRow } from '../../shared/companies';
import type { Customer } from '../../shared/customers';
import { invoiceDisplayLabel, isPersonalSettlement } from '../../shared/settlement';
import { useIsNarrow } from '../use-is-narrow';
import { useHideOnScroll } from '../use-hide-on-scroll';
import { copyText } from '../copy-text';

/** 按月偏移量平移 YYYY-MM，offset 为负表示往前翻 */
function shiftMonth(month: string, offset: number): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(year, (mon ?? 1) - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

interface FinancePageProps {
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  initialOrderId?: number;
  /** 从订单详情进入时传入来源订单；财务详情里显示「返回订单」。 */
  returnOrderId?: number;
  onReturnToOrder?: (orderId: number) => void;
  customers?: Customer[];
  companies?: Company[];
  onCompaniesChanged?: () => Promise<void> | void;
}

const orderStatusLabels: Record<string, string> = { label_pending: '待打印箱唛', pending_stock: '待备货', stock_reported: '已备货', pending_packing: '待打包', ship_pending: '待发货', shipped: '已发货' };

type FinanceColumnKey = 'customer' | 'company' | 'date' | 'amounts' | 'payment' | 'proof' | 'invoice' | 'logistics';
const FINANCE_COLUMN_OPTIONS: Array<[FinanceColumnKey, string]> = [
  ['customer', '客户'],
  ['company', '公司'],
  ['date', '日期'],
  ['amounts', '金额（应收/已收/未收）'],
  ['payment', '付款状态'],
  ['proof', '水单状态'],
  ['invoice', '发票状态'],
  ['logistics', '物流'],
];
const FINANCE_COLUMNS_STORAGE_KEY = 'workbench:finance-columns';
const FINANCE_COLUMN_KEYS = new Set<FinanceColumnKey>(FINANCE_COLUMN_OPTIONS.map(([key]) => key));
/** 12 列的顺序：基础 1–4、金额 5–7、进度 8–10、履约 11、操作 12。 */
const FINANCE_COLUMN_INDEXES: Record<FinanceColumnKey, number[]> = {
  customer: [2],
  company: [3],
  date: [4],
  amounts: [5, 6, 7],
  payment: [8],
  proof: [9],
  invoice: [10],
  logistics: [11],
};
const FINANCE_GROUPS = [
  { key: 'basic', label: '基础', indexes: [1, 2, 3, 4] },
  { key: 'amount', label: '金额', indexes: [5, 6, 7] },
  { key: 'progress', label: '进度', indexes: [8, 9, 10] },
  { key: 'fulfillment', label: '履约', indexes: [11] },
  { key: 'ops', label: '操作', indexes: [12] },
];

function loadHiddenFinanceColumns(): FinanceColumnKey[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FINANCE_COLUMNS_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is FinanceColumnKey => typeof value === 'string' && FINANCE_COLUMN_KEYS.has(value as FinanceColumnKey)) : [];
  } catch {
    return [];
  }
}

export default function FinancePage({ onNotify, initialOrderId, returnOrderId, onReturnToOrder, customers = [], companies = [], onCompaniesChanged }: FinancePageProps) {
  const [result, setResult] = useState<FinanceListResult>();
  const [query, setQuery] = useState('');
  const [paymentStatuses, setPaymentStatuses] = useState<FinancePaymentStatus[]>([]);
  const [proofStatuses, setProofStatuses] = useState<FinanceProofStatus[]>([]);
  const [invoiceStatuses, setInvoiceStatuses] = useState<InvoiceStatus[]>([]);
  const [companyFilters, setCompanyFilters] = useState<string[]>([]);
  const [month, setMonth] = useState(() => currentMonth());
  const [selectedOrderId, setSelectedOrderId] = useState<number>();
  const [detail, setDetail] = useState<ApiFinanceDetail>();
  const [loading, setLoading] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [companyRows, setCompanyRows] = useState<CompanyReceiptBreakdownRow[]>();
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyManagerOpen, setCompanyManagerOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<FinanceColumnKey[]>(loadHiddenFinanceColumns);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsButtonRef = useRef<HTMLButtonElement>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const narrow = useIsNarrow();
  const [searchFocused, setSearchFocused] = useState(false);
  // 手机端搜索框悬浮在顶部：连续下滑收起，回滑展开；输入时锁住展开避免打字途中消失。
  const searchHidden = useHideOnScroll(narrow && !searchFocused);

  useEffect(() => {
    try { window.localStorage.setItem(FINANCE_COLUMNS_STORAGE_KEY, JSON.stringify(hiddenColumns)); } catch { /* 存储失败不影响表格使用 */ }
  }, [hiddenColumns]);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await listFinanceOrders({
        q: query,
        month: month || undefined,
        paymentStatuses,
        proofStatuses,
        invoiceStatuses,
        companyIds: companyFilters.filter((value) => value !== 'unassigned').map(Number),
        includeUnassignedCompany: companyFilters.includes('unassigned'),
        page: 1,
        pageSize: 100,
      }));
    } catch (error) { onNotify?.(errorText(error, '财务列表加载失败'), 'error'); }
    finally { setLoading(false); }
  }, [companyFilters, invoiceStatuses, month, onNotify, paymentStatuses, proofStatuses, query]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (initialOrderId) setSelectedOrderId(initialOrderId); }, [initialOrderId]);
  const openDetail = async (orderId: number) => { setSelectedOrderId(orderId); try { setDetail(await getOrderFinance(orderId)); } catch (error) { onNotify?.(errorText(error, '财务详情加载失败'), 'error'); } };
  useEffect(() => { if (selectedOrderId) void openDetail(selectedOrderId); }, [selectedOrderId]);
  const refreshDetail = async () => { if (!selectedOrderId) return; setDetail(await getOrderFinance(selectedOrderId)); await load(); };
  const openCompanyBreakdown = async () => {
    setCompanyOpen(true);
    setCompanyLoading(true);
    try { setCompanyRows((await listCompanyBreakdown(month || undefined)).items); }
    catch (error) { onNotify?.(errorText(error, '收款明细加载失败'), 'error'); setCompanyOpen(false); }
    finally { setCompanyLoading(false); }
  };
  const stats = result?.stats;
  const rows = useMemo(() => result?.rows ?? [], [result]);
  const companySummary = useMemo(() => ({
    amountCents: (companyRows ?? []).reduce((sum, row) => sum + row.amountCents, 0),
    receiptCount: (companyRows ?? []).reduce((sum, row) => sum + row.receiptCount, 0),
    companyCount: companyRows?.length ?? 0,
  }), [companyRows]);
  const detailCustomer = useMemo(() => {
    const raw = detail?.order.customer_id ?? detail?.order.customerId;
    const numeric = Number(raw);
    if (!detail || !Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return customers.find((customer) => customer.id === numeric);
  }, [customers, detail]);
  const detailCompany = useMemo(() => {
    const raw = detail?.order.company_id ?? detail?.order.companyId;
    const numeric = Number(raw);
    if (!detail || !Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return companies.find((company) => company.id === numeric);
  }, [companies, detail]);
  const copyCompanyInvoiceInfo = async (companyId: number | null | undefined) => {
    const company = companyId == null ? undefined : companies.find((item) => item.id === companyId);
    if (!company) {
      onNotify?.('该订单还没有分配公司，无法复制开票信息', 'error');
      return;
    }
    const copied = await copyText(buildCompanyInvoiceInfoText(company));
    onNotify?.(
      copied ? `已复制「${companyDisplayName(company)}」开票信息，可直接发给客户` : '复制失败，请手动选择文字复制',
      copied ? 'success' : 'error',
    );
  };
  const closeDetail = () => { setDetail(undefined); setSelectedOrderId(undefined); };
  const canReturnToOrder = Boolean(returnOrderId && onReturnToOrder && selectedOrderId === returnOrderId);
  const financeFilters = useMemo(() => ({
    companies: companyFilters,
    payments: paymentStatuses,
    proofs: proofStatuses,
    invoices: invoiceStatuses,
    month,
  }), [companyFilters, paymentStatuses, proofStatuses, invoiceStatuses, month]);
  const applyFinanceFilters = (next: typeof financeFilters) => {
    setCompanyFilters(next.companies);
    setPaymentStatuses(next.payments);
    setProofStatuses(next.proofs);
    setInvoiceStatuses(next.invoices);
    setMonth(next.month);
  };
  const savedFilters = useSavedFilterViews('finance', financeFilters, applyFinanceFilters);
  const filterRail = useFilterRailOpen('finance');
  const companyFilterOptions = [
    ...companies.map((company) => ({ value: String(company.id), label: companyDisplayName(company) })),
    { value: 'unassigned', label: '未分配公司' },
  ];
  const paymentFilterOptions = (Object.entries(FINANCE_PAYMENT_STATUS_LABELS) as [FinancePaymentStatus, string][]).map(([value, label]) => ({ value, label }));
  const proofFilterOptions = (Object.entries(PAYMENT_PROOF_STATUS_LABELS) as [FinanceProofStatus, string][]).map(([value, label]) => ({ value, label }));
  const invoiceFilterOptions = (Object.entries(INVOICE_STATUS_LABELS) as [InvoiceStatus, string][]).map(([value, label]) => ({ value, label }));
  const resetFinanceFilters = () => {
    applyFinanceFilters({ companies: [], payments: [], proofs: [], invoices: [], month: currentMonth() });
    savedFilters.clearActive();
  };
  // 分组表头的 colSpan 要与实际可见列一致：同时考虑响应式收列和用户列设置。
  const hiddenColumnIndexes = useMemo(() => {
    const indexes = new Set<number>();
    const add = (values: number[]) => values.forEach((value) => indexes.add(value));
    if (viewportWidth > 900 && viewportWidth <= 1199) add([3, 4, 6, 9, 10, 11]);
    else if (viewportWidth >= 1200 && viewportWidth <= 1419) add([5, 8, 9, 10]);
    else if (viewportWidth >= 1440 && viewportWidth <= 1561 && filterRail.open) add([4, 11]);
    hiddenColumns.forEach((key) => add(FINANCE_COLUMN_INDEXES[key]));
    return indexes;
  }, [filterRail.open, hiddenColumns, viewportWidth]);
  const financeTableClass = `data-table finance-table${hiddenColumns.map((key) => ` hide-col-${key}`).join('')}`;
  const toggleFinanceColumn = (key: FinanceColumnKey, checked: boolean) => {
    setHiddenColumns((current) => checked ? current.filter((item) => item !== key) : [...current, key]);
  };

  return <div className="page-shell finance-page">
    <div className="filter-rail-layout">
      <FilterRail
        open={filterRail.open}
        onToggle={filterRail.toggle}
        views={savedFilters.views}
        activeViewId={savedFilters.activeViewId}
        modified={savedFilters.modified}
        onApplyView={savedFilters.applyView}
        onClearActive={savedFilters.clearActive}
        onSaveView={savedFilters.saveView}
        onUpdateView={savedFilters.updateView}
        onRenameView={savedFilters.renameView}
        onDeleteView={savedFilters.deleteView}
        onReset={resetFinanceFilters}
      >
        <FilterCheckList title="收款公司" options={companyFilterOptions} selected={companyFilters} onChange={setCompanyFilters} searchable={companyFilterOptions.length > 7} />
        <FilterCheckList title="付款状态" options={paymentFilterOptions} selected={paymentStatuses} onChange={setPaymentStatuses} searchable={false} />
        <FilterCheckList title="水单状态" options={proofFilterOptions} selected={proofStatuses} onChange={setProofStatuses} searchable={false} />
        <FilterCheckList title="发票状态" options={invoiceFilterOptions} selected={invoiceStatuses} onChange={setInvoiceStatuses} searchable={false} />
      </FilterRail>
      <div className="filter-rail-main">
    <div className="page-toolbar finance-page-head">
      <div className="finance-heading-copy">
        <span className="page-breadcrumb">履约 / 财务</span>
        <strong className="page-title">财务工作台</strong>
        <span className="page-subtitle">跟应收、水单、发票与收款进度</span>
      </div>
      <button className="button button-secondary" type="button" onClick={() => setCompanyManagerOpen(true)}><Building2 size={14} />公司档案</button>
    </div>
    <section className="table-panel finance-panel">
      <div className="finance-stat-grid"><div><span>本期应收</span><strong>{money(stats?.receivableCents ?? 0)}</strong></div><button type="button" className="finance-stat-clickable" title="点击查看按公司收款明细" onClick={() => void openCompanyBreakdown()}><span>已收金额</span><strong className="finance-positive">{money(stats?.receivedCents ?? 0)}</strong></button><div><span>未收金额</span><strong className="finance-warning">{money(stats?.outstandingCents ?? 0)}</strong></div><div><span>待审核水单</span><strong>{stats?.pendingProofCount ?? 0}<small> 张</small></strong></div><div><span>待处理发票</span><strong>{stats?.pendingInvoiceCount ?? 0}<small> 笔</small></strong></div></div>
      <div className="page-toolbar finance-toolbar"><SearchInput value={query} onChange={setQuery} className={searchHidden ? 'is-scroll-hidden' : undefined} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="搜索订单号或客户" /><div className="month-control" role="group" aria-label="按月筛选">{month ? <button className="icon-button" type="button" title="上一月" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></button> : null}<input type="month" className="toolbar-select month-input" aria-label="筛选月份" value={month} onChange={(event) => setMonth(event.target.value)} />{month ? <button className="icon-button" type="button" title="下一月" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></button> : null}<button className="button button-secondary month-scope-button" type="button" title={month ? '显示全部月份' : '回到当前月'} onClick={() => setMonth((value) => (value ? '' : currentMonth()))}>{month ? <X size={14} /> : <CalendarDays size={14} />}{month ? '全部' : '本月'}</button></div><div className="finance-status-row"><select className="toolbar-select" aria-label="收款公司" value={companyFilters.length === 1 ? companyFilters[0] : ''} onChange={(event) => setCompanyFilters(event.target.value ? [event.target.value] : [])}><option value="">全部公司</option>{companies.map((company) => <option value={company.id} key={company.id}>{companyDisplayName(company)}{company.isActive ? '' : '（已停用）'}</option>)}<option value="unassigned">未分配公司</option></select><select className="toolbar-select" aria-label="付款状态" value={paymentStatuses.length === 1 ? paymentStatuses[0] : ''} onChange={(event) => setPaymentStatuses(event.target.value ? [event.target.value as FinancePaymentStatus] : [])}><option value="">全部付款</option>{paymentFilterOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><select className="toolbar-select" aria-label="水单状态" value={proofStatuses.length === 1 ? proofStatuses[0] : ''} onChange={(event) => setProofStatuses(event.target.value ? [event.target.value as FinanceProofStatus] : [])}><option value="">全部水单</option>{proofFilterOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><select className="toolbar-select" aria-label="发票状态" value={invoiceStatuses.length === 1 ? invoiceStatuses[0] : ''} onChange={(event) => setInvoiceStatuses(event.target.value ? [event.target.value as InvoiceStatus] : [])}><option value="">全部发票</option>{invoiceFilterOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><button className="button button-secondary finance-company-mobile-button" type="button" onClick={() => setCompanyManagerOpen(true)}><Building2 size={14} />公司档案</button></div><button ref={columnsButtonRef} className="button button-secondary finance-columns-button" type="button" title="显示列设置" aria-haspopup="dialog" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((open) => !open)}><Columns3 size={14} />列设置</button>{columnsOpen && columnsButtonRef.current && <AnchoredPopover anchor={columnsButtonRef.current} width={250} maxHeight={420} onClose={() => setColumnsOpen(false)}><div className="finance-column-panel" role="dialog" aria-label="列设置"><div className="finance-column-panel-head"><strong>显示列</strong><button type="button" onClick={() => setHiddenColumns([])}><RotateCcw size={12} />恢复默认</button></div>{FINANCE_COLUMN_OPTIONS.map(([key, label]) => <label key={key} className="finance-column-option"><input type="checkbox" checked={!hiddenColumns.includes(key)} onChange={(event) => toggleFinanceColumn(key, event.target.checked)} /><span>{label}</span></label>)}<p>订单号和操作列固定显示，不能隐藏。</p></div></AnchoredPopover>}<button className="icon-button" type="button" title="刷新财务列表" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /></button></div>
      <div className="table-scroll finance-table-desktop"><table className={financeTableClass}><thead><tr className="finance-table-groups">{FINANCE_GROUPS.map((group) => { const count = group.indexes.filter((index) => !hiddenColumnIndexes.has(index)).length; return count ? <th key={group.key} colSpan={count} className={`finance-group-th finance-group-${group.key}`}>{group.label}</th> : null; })}</tr><tr className="finance-column-head">{['订单号', '客户', '公司', '日期', '应收', '已收', '未收', '付款', '水单', '发票', '物流', '操作'].map((title) => <th key={title} className={['应收', '已收', '未收'].includes(title) ? 'is-right' : undefined}>{title}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.orderId}><td className="strong-cell finance-order-number">{row.orderNo}</td><td>{row.customerName || '—'}</td><td className={row.companyName ? undefined : 'finance-warning'}>{row.companyName || '未分配'}</td><td>{row.orderDate}</td><td className="is-right">{money(row.receivableCents)}</td><td className="is-right">{money(row.receivedCents)}</td><td className={`is-right ${row.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}`}>{money(row.outstandingCents)}</td><td><span className={badgeClass(row.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[row.paymentStatus]}</span></td><td><span className={badgeClass(row.proofStatus)}>{PAYMENT_PROOF_STATUS_LABELS[row.proofStatus]}</span></td><td><span className={isPersonalSettlement(row.settlementType) ? 'badge badge-neutral' : badgeClass(row.invoiceStatus)}>{invoiceDisplayLabel(row.settlementType, row.invoiceStatus)}</span></td><td>{orderStatusLabels[row.orderStatus] ?? row.orderStatus}</td><td className="finance-ops-cell"><button className="button button-ghost" type="button" onClick={() => void openDetail(row.orderId)}>查看财务</button></td></tr>)}</tbody></table></div><div className="finance-card-list" aria-label="财务卡片列表">{rows.map((row) => <article key={row.orderId} className="finance-card"><div className="order-card-head"><div className="order-card-title"><strong className="finance-order-number">{row.orderNo}</strong><span>{row.customerName || '未填客户'} · {row.orderDate}</span></div><span className={badgeClass(row.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[row.paymentStatus]}</span></div><div className="finance-card-amounts"><div><span>应收</span><strong>{money(row.receivableCents)}</strong></div><div><span>未收</span><strong className={row.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(row.outstandingCents)}</strong></div><div><span>物流</span><strong>{orderStatusLabels[row.orderStatus] ?? row.orderStatus}</strong></div></div><div className="order-card-meta">公司 {row.companyName || '未分配'} · 水单 {PAYMENT_PROOF_STATUS_LABELS[row.proofStatus]} · 发票 {invoiceDisplayLabel(row.settlementType, row.invoiceStatus)}</div><div className="row-actions">{row.companyId != null && <button className="button button-ghost" type="button" onClick={() => void copyCompanyInvoiceInfo(row.companyId)}><Copy size={13} />复制开票</button>}<button className="button button-ghost" type="button" onClick={() => void openDetail(row.orderId)}>查看财务</button></div></article>)}</div>{loading && <div className="table-state">正在加载财务数据...</div>}{!loading && !rows.length && <div className="table-state">暂无符合条件的财务记录。订单创建后会自动生成应收记录。</div>}
    </section>
    <Modal
      open={Boolean(detail)}
      title={detail ? `财务详情 · ${String(detail.order.order_no ?? '')}` : '财务详情'}
      onClose={closeDetail}
      width={900}
      variant="drawer"
      className="finance-detail-drawer"
      footer={canReturnToOrder ? <>
        <button className="button button-secondary" type="button" onClick={closeDetail}><X size={14} />关闭</button>
        <button className="button button-primary" type="button" onClick={() => { if (returnOrderId != null) onReturnToOrder?.(returnOrderId); }}><ArrowLeft size={14} />返回订单</button>
      </> : undefined}
    >{detail && <div className="finance-detail">
      <div className="finance-detail-summary">
        <div><span>应收金额</span><strong>{money(detail.finance.receivableCents)}</strong></div>
        <div><span>已收金额</span><strong className="finance-positive">{money(detail.finance.receivedCents)}</strong></div>
        <div><span>未收金额</span><strong className={detail.finance.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(detail.finance.outstandingCents)}</strong></div>
        <div><span>付款状态</span><b className={badgeClass(detail.finance.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[detail.finance.paymentStatus]}</b></div>
        <div><span>收款/开票公司</span><strong>{String(detail.order.company_name ?? '') || '未分配'}</strong>{detailCompany && <button className="button button-ghost finance-copy-invoice-button" type="button" onClick={() => void copyCompanyInvoiceInfo(detailCompany.id)}><Copy size={13} />复制开票信息</button>}</div>
      </div>
      <PaymentProofEditor detail={detail} onRefresh={refreshDetail} onNotify={onNotify} />
      <InvoiceEditor detail={detail} customer={detailCustomer} onRefresh={refreshDetail} onNotify={onNotify} />
    </div>}</Modal>
    <Modal open={companyOpen} title={month ? `已收金额 · 按公司（${month}）` : '已收金额 · 按公司（全部月份）'} onClose={() => setCompanyOpen(false)} width={560}>
      {companyLoading ? <div className="table-state">正在加载收款明细...</div> : companyRows && companyRows.length > 0 ? <div className="finance-payee-breakdown">
        <div className="finance-payee-summary">
          <div><span>{month ? '本期收款合计' : '收款合计'}</span><strong className="finance-positive">{money(companySummary.amountCents)}</strong></div>
          <div><span>收款笔数</span><strong>{companySummary.receiptCount}<small> 笔</small></strong></div>
          <div><span>公司数</span><strong>{companySummary.companyCount}<small> 家</small></strong></div>
        </div>
        {companyRows.map((row) => <div className="finance-receipt-row" key={row.companyId ?? 'unassigned'}>
          <Building2 size={15} />
          <div className="finance-receipt-main"><strong>{row.companyName}</strong><span>{row.receiptCount} 笔收款</span></div>
          <strong className="finance-positive">{money(row.amountCents)}</strong>
        </div>)}
      </div> : <div className="table-state">{month ? `${month} 暂无收款记录。水单审核入账后可在此查看按公司的分布。` : '暂无收款记录。水单审核入账后可在此查看按公司的分布。'}</div>}
    </Modal>
    <CompanyManager open={companyManagerOpen} companies={companies} onClose={() => setCompanyManagerOpen(false)} onChanged={async () => { await onCompaniesChanged?.(); await load(); }} onNotify={onNotify} />
      </div>
    </div>
  </div>;
}
