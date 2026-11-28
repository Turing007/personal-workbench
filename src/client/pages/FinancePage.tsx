import { ArrowLeft, Building2, CalendarDays, ChevronLeft, ChevronRight, Columns3, Copy, Download, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../components/Modal';
import AnchoredPopover from '../components/AnchoredPopover';
import SearchInput from '../components/SearchInput';
import PaymentProofEditor from '../components/finance/PaymentProofEditor';
import RefundEditor from '../components/finance/RefundEditor';
import InvoiceEditor from '../components/finance/InvoiceEditor';
import CompanyManager from '../components/finance/CompanyManager';
import { badgeClass, errorText, money } from '../components/finance/finance-format';
import {
  getOrderFinance,
  listFinanceOrders,
  listCompanyBreakdown,
  getReconciliation,
  getCustomerStatement,
  downloadReconciliationPdf,
  type ApiFinanceDetail,
  type CustomerStatement,
  type ReconciliationCustomer,
  type ReconciliationSummary,
} from '../api';
import { saveFileOrDownload } from '../file-save';
import {
  FINANCE_PAYMENT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  PAYMENT_PROOF_STATUS_LABELS,
  currentMonth,
  type FinanceListResult,
} from '../../shared/finance';
import { buildCompanyInvoiceInfoText, companyDisplayName, type Company, type CompanyReceiptBreakdownRow } from '../../shared/companies';
import type { Customer } from '../../shared/customers';
import { invoiceDisplayLabel, isPersonalSettlement } from '../../shared/settlement';
import { useIsNarrow } from '../use-is-narrow';
import { useHideOnScroll } from '../use-hide-on-scroll';
import { copyText } from '../copy-text';
import { ORDER_STATUS_LABELS_WITH_DRAFT, type OrderChannel } from '../../shared/domain';

/** 按月偏移量平移 YYYY-MM，offset 为负表示往前翻 */
function shiftMonth(month: string, offset: number): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(year, (mon ?? 1) - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

interface FinancePageProps {
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  initialOrderId?: number;
  /** 跨模块跳转时带入渠道筛选。 */
  initialChannel?: OrderChannel;
  /** 从订单详情进入时传入来源订单；财务详情里显示「返回订单」。 */
  returnOrderId?: number;
  onReturnToOrder?: (orderId: number) => void;
  customers?: Customer[];
  companies?: Company[];
  onCompaniesChanged?: () => Promise<void> | void;
}

const orderStatusLabels: Record<string, string> = ORDER_STATUS_LABELS_WITH_DRAFT;

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

export default function FinancePage({ onNotify, initialOrderId, initialChannel, returnOrderId, onReturnToOrder, customers = [], companies = [], onCompaniesChanged }: FinancePageProps) {
  const [result, setResult] = useState<FinanceListResult>();
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState(() => currentMonth());
  const [date, setDate] = useState('');
  const [channel, setChannel] = useState<'all' | OrderChannel>(initialChannel ?? 'all');
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
  const [financeView, setFinanceView] = useState<'orders' | 'reconciliation'>('orders');
  const [reconciliation, setReconciliation] = useState<{ items: ReconciliationCustomer[]; totals: ReconciliationSummary }>();
  const [reconLoading, setReconLoading] = useState(false);
  const [statementCustomer, setStatementCustomer] = useState<ReconciliationCustomer>();
  const [statementFrom, setStatementFrom] = useState(() => `${currentMonth()}-01`);
  const [statementTo, setStatementTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [statement, setStatement] = useState<CustomerStatement>();
  const [statementBusy, setStatementBusy] = useState(false);

  const loadReconciliation = async () => {
    setReconLoading(true);
    try {
      setReconciliation(await getReconciliation());
    } catch (error) {
      onNotify?.(errorText(error, '对账数据加载失败'), 'error');
    } finally {
      setReconLoading(false);
    }
  };
  useEffect(() => {
    if (financeView === 'reconciliation') void loadReconciliation();
    // 切到对账页签时拉一次；对账单里的日期切换单独请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [financeView]);

  const loadStatement = async (customerId: number, from: string, to: string) => {
    if (from > to) {
      onNotify?.('开始日期不能晚于结束日期', 'error');
      return;
    }
    setStatementBusy(true);
    try {
      setStatement(await getCustomerStatement(customerId, from, to));
    } catch (error) {
      onNotify?.(errorText(error, '对账单加载失败'), 'error');
    } finally {
      setStatementBusy(false);
    }
  };

  const openStatement = (customer: ReconciliationCustomer) => {
    if (customer.customerId == null) return;
    setStatementCustomer(customer);
    setStatement(undefined);
    void loadStatement(customer.customerId, statementFrom, statementTo);
  };

  const exportStatement = async () => {
    if (!statementCustomer?.customerId) return;
    setStatementBusy(true);
    try {
      const blob = await downloadReconciliationPdf(statementCustomer.customerId, statementFrom, statementTo);
      await saveFileOrDownload(blob, `对账单-${statementCustomer.customerName || statementCustomer.customerId}-${statementFrom}-${statementTo}.pdf`);
    } catch (error) {
      onNotify?.(errorText(error, '对账单生成失败'), 'error');
    } finally {
      setStatementBusy(false);
    }
  };
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
  useEffect(() => { if (initialChannel) setChannel(initialChannel); }, [initialChannel]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await listFinanceOrders({
        q: query,
        month: month || undefined,
        date: date || undefined,
        channel: channel === 'all' ? undefined : channel,
        page: 1,
        pageSize: 100,
      }));
    } catch (error) { onNotify?.(errorText(error, '财务列表加载失败'), 'error'); }
    finally { setLoading(false); }
  }, [channel, date, month, onNotify, query]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (initialOrderId) setSelectedOrderId(initialOrderId); }, [initialOrderId]);
  const openDetail = async (orderId: number) => { setSelectedOrderId(orderId); try { setDetail(await getOrderFinance(orderId)); } catch (error) { onNotify?.(errorText(error, '财务详情加载失败'), 'error'); } };
  useEffect(() => { if (selectedOrderId) void openDetail(selectedOrderId); }, [selectedOrderId]);
  const refreshDetail = async () => { if (!selectedOrderId) return; setDetail(await getOrderFinance(selectedOrderId)); await load(); };
  const openCompanyBreakdown = async () => {
    setCompanyOpen(true);
    setCompanyLoading(true);
    try { setCompanyRows((await listCompanyBreakdown(month || undefined, channel === 'all' ? undefined : channel)).items); }
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
  // 分组表头的 colSpan 要与实际可见列一致：同时考虑响应式收列和用户列设置。
  const hiddenColumnIndexes = useMemo(() => {
    const indexes = new Set<number>();
    const add = (values: number[]) => values.forEach((value) => indexes.add(value));
    if (viewportWidth > 900 && viewportWidth <= 1199) add([3, 4, 6, 9, 10, 11]);
    else if (viewportWidth >= 1200 && viewportWidth <= 1419) add([5, 8, 9, 10]);
    hiddenColumns.forEach((key) => add(FINANCE_COLUMN_INDEXES[key]));
    return indexes;
  }, [hiddenColumns, viewportWidth]);
  const financeTableClass = `data-table finance-table${hiddenColumns.map((key) => ` hide-col-${key}`).join('')}`;
  const toggleFinanceColumn = (key: FinanceColumnKey, checked: boolean) => {
    setHiddenColumns((current) => checked ? current.filter((item) => item !== key) : [...current, key]);
  };

  return <div className="page-shell finance-page">
    <div className="page-toolbar finance-page-head">
      <div className="finance-heading-copy">
        <span className="page-breadcrumb">履约 / 财务</span>
        <strong className="page-title">财务工作台</strong>
        <span className="page-subtitle">跟应收、水单、发票与收款进度</span>
      </div>
      <button className="button button-secondary" type="button" onClick={() => setCompanyManagerOpen(true)}><Building2 size={14} />公司档案</button>
    </div>
    <section className="table-panel finance-panel">
      <div className="finance-view-tabs" role="tablist" aria-label="财务视图">
        <button type="button" role="tab" aria-selected={financeView === 'orders'} className={financeView === 'orders' ? 'is-active' : undefined} onClick={() => setFinanceView('orders')}>订单应收</button>
        <button type="button" role="tab" aria-selected={financeView === 'reconciliation'} className={financeView === 'reconciliation' ? 'is-active' : undefined} onClick={() => setFinanceView('reconciliation')}>客户对账</button>
      </div>
      <div className="finance-stat-grid" style={financeView === 'reconciliation' ? { display: 'none' } : undefined}><div><span>本期应收</span><strong>{money(stats?.receivableCents ?? 0)}</strong></div><button type="button" className="finance-stat-clickable" title="点击查看按公司收款明细" onClick={() => void openCompanyBreakdown()}><span>已收金额</span><strong className="finance-positive">{money(stats?.receivedCents ?? 0)}</strong>{stats && stats.refundedCents > 0 && <small>已退 {money(stats.refundedCents)}</small>}</button><div><span>未收金额</span><strong className="finance-warning">{money(Math.max(0, stats?.outstandingCents ?? 0))}</strong>{stats && stats.overpaidCents > 0 && <small>超收 {money(stats.overpaidCents)}</small>}</div><div><span>本期毛利</span><strong className={!stats || stats.profitOrderCount === 0 ? '' : stats.profitCents < 0 ? 'finance-warning' : 'finance-positive'}>{stats && stats.profitOrderCount > 0 ? money(stats.profitCents) : '—'}</strong><small>{stats ? `已核算 ${stats.profitOrderCount} 单 · 待补 ${stats.costPendingOrderCount} 单` : '成本待补'}</small></div><div><span>待审核水单</span><strong>{stats?.pendingProofCount ?? 0}<small> 张</small></strong></div><div><span>待处理发票</span><strong>{stats?.pendingInvoiceCount ?? 0}<small> 笔</small></strong></div></div>
      <div className="page-toolbar finance-toolbar" style={financeView === 'reconciliation' ? { display: 'none' } : undefined}><SearchInput value={query} onChange={setQuery} className={searchHidden ? 'is-scroll-hidden' : undefined} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="搜索订单号或客户" /><div className="month-control" role="group" aria-label="按下单月份筛选">{month ? <button className="icon-button" type="button" title="上一月" onClick={() => { setMonth(shiftMonth(month, -1)); setDate(''); }}><ChevronLeft size={15} /></button> : null}<input type="month" className="toolbar-select month-input" aria-label="按下单月份筛选" value={month} onChange={(event) => { setMonth(event.target.value); setDate(''); }} />{month ? <button className="icon-button" type="button" title="下一月" onClick={() => { setMonth(shiftMonth(month, 1)); setDate(''); }}><ChevronRight size={15} /></button> : null}<button className="button button-secondary month-scope-button" type="button" title={month ? '显示全部月份' : '回到当前月'} onClick={() => { setMonth((value) => (value ? '' : currentMonth())); setDate(''); }}>{month ? <X size={14} /> : <CalendarDays size={14} />}{month ? '全部' : '本月'}</button></div><div className="date-control"><input type="date" className="toolbar-select date-input" aria-label="按下单日期筛选" title="按订单日期筛选（有日期时忽略月份）" value={date} onChange={(event) => { setDate(event.target.value); if (event.target.value) setMonth(''); }} />{date && <button className="icon-button" type="button" title="清除日期筛选" onClick={() => setDate('')}><X size={15} /></button>}</div><span className="finance-month-hint" style={{ color: 'var(--tone-text-faint)', fontSize: 11, whiteSpace: 'nowrap' }}>按下单日期/月份</span><select className="toolbar-select" aria-label="订单渠道筛选" value={channel} onChange={(event) => setChannel(event.target.value as 'all' | OrderChannel)}><option value="all">全部渠道</option><option value="online">线上订单</option><option value="offline">线下订单</option></select><button className="button button-secondary finance-company-mobile-button" type="button" onClick={() => setCompanyManagerOpen(true)}><Building2 size={14} />公司档案</button><button ref={columnsButtonRef} className="button button-secondary finance-columns-button" type="button" title="显示列设置" aria-haspopup="dialog" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((open) => !open)}><Columns3 size={14} />列设置</button>{columnsOpen && columnsButtonRef.current && <AnchoredPopover anchor={columnsButtonRef.current} width={250} maxHeight={420} onClose={() => setColumnsOpen(false)}><div className="finance-column-panel" role="dialog" aria-label="列设置"><div className="finance-column-panel-head"><strong>显示列</strong><button type="button" onClick={() => setHiddenColumns([])}><RotateCcw size={12} />恢复默认</button></div>{FINANCE_COLUMN_OPTIONS.map(([key, label]) => <label key={key} className="finance-column-option"><input type="checkbox" checked={!hiddenColumns.includes(key)} onChange={(event) => toggleFinanceColumn(key, event.target.checked)} /><span>{label}</span></label>)}<p>订单号和操作列固定显示，不能隐藏。</p></div></AnchoredPopover>}<button className="icon-button" type="button" title="刷新财务列表" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /></button></div>
      <div className="table-scroll finance-table-desktop" style={financeView === 'reconciliation' ? { display: 'none' } : undefined}><table className={financeTableClass}><thead><tr className="finance-table-groups">{FINANCE_GROUPS.map((group) => { const count = group.indexes.filter((index) => !hiddenColumnIndexes.has(index)).length; return count ? <th key={group.key} colSpan={count} className={`finance-group-th finance-group-${group.key}`}>{group.label}</th> : null; })}</tr><tr className="finance-column-head">{['订单号', '客户', '公司', '日期', '应收', '已收', '未收', '付款', '水单', '发票', '物流', '操作'].map((title) => <th key={title} className={['应收', '已收', '未收'].includes(title) ? 'is-right' : undefined}>{title}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.orderId}><td className="strong-cell finance-order-number">{row.orderNo}</td><td>{row.customerName || '—'}</td><td className={row.companyName ? undefined : 'finance-warning'}>{row.companyName || '未分配'}</td><td>{row.orderDate}</td><td className="is-right">{money(row.receivableCents)}</td><td className="is-right">{money(row.receivedCents)}</td><td className={`is-right ${row.outstandingCents > 0 || row.overpaidCents > 0 ? 'finance-warning' : 'finance-positive'}`} title={row.overpaidCents > 0 ? `客户多付 ${money(row.overpaidCents)}，可在财务详情中退款` : undefined}>{row.overpaidCents > 0 ? `超收 ${money(row.overpaidCents)}` : money(row.outstandingCents)}</td><td><span className={badgeClass(row.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[row.paymentStatus]}</span></td><td><span className={badgeClass(row.proofStatus)}>{PAYMENT_PROOF_STATUS_LABELS[row.proofStatus]}</span></td><td><span className={isPersonalSettlement(row.settlementType) ? 'badge badge-neutral' : badgeClass(row.invoiceStatus)}>{invoiceDisplayLabel(row.settlementType, row.invoiceStatus)}</span></td><td>{orderStatusLabels[row.orderStatus] ?? row.orderStatus}</td><td className="finance-ops-cell"><button className="button button-ghost" type="button" onClick={() => void openDetail(row.orderId)}>查看财务</button></td></tr>)}</tbody></table></div><div className="finance-card-list" style={financeView === 'reconciliation' ? { display: 'none' } : undefined} aria-label="财务卡片列表">{rows.map((row) => <article key={row.orderId} className="finance-card"><div className="order-card-head"><div className="order-card-title"><strong className="finance-order-number">{row.orderNo}</strong><span>{row.customerName || '未填客户'} · {row.orderDate}</span></div><span className={badgeClass(row.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[row.paymentStatus]}</span></div><div className="finance-card-amounts"><div><span>应收</span><strong>{money(row.receivableCents)}</strong></div><div><span>{row.overpaidCents > 0 ? '超收' : '未收'}</span><strong className={row.outstandingCents > 0 || row.overpaidCents > 0 ? 'finance-warning' : 'finance-positive'}>{row.overpaidCents > 0 ? money(row.overpaidCents) : money(row.outstandingCents)}</strong></div><div><span>物流</span><strong>{orderStatusLabels[row.orderStatus] ?? row.orderStatus}</strong></div></div><div className="order-card-meta">公司 {row.companyName || '未分配'} · 水单 {PAYMENT_PROOF_STATUS_LABELS[row.proofStatus]} · 发票 {invoiceDisplayLabel(row.settlementType, row.invoiceStatus)}</div><div className="row-actions">{row.companyId != null && <button className="button button-ghost" type="button" onClick={() => void copyCompanyInvoiceInfo(row.companyId)}><Copy size={13} />复制开票</button>}<button className="button button-ghost" type="button" onClick={() => void openDetail(row.orderId)}>查看财务</button></div></article>)}</div>{financeView === 'orders' && loading && <div className="table-state">正在加载财务数据...</div>}{financeView === 'orders' && !loading && !rows.length && <div className="table-state">暂无符合条件的财务记录。订单创建后会自动生成应收记录。</div>}
      {financeView === 'reconciliation' && <div className="finance-recon">
        <div className="finance-recon-summary">
          <div><span>账期未收</span><strong>{money(reconciliation?.totals.outstandingCents ?? 0)}</strong></div>
          <div><span>其中逾期</span><strong className={(reconciliation?.totals.overdueCents ?? 0) > 0 ? 'finance-warning' : 'finance-positive'}>{money(reconciliation?.totals.overdueCents ?? 0)}</strong></div>
          <div><span>逾期最久</span><strong>{reconciliation?.totals.oldestOverdueDays ? `${reconciliation.totals.oldestOverdueDays} 天` : '—'}</strong></div>
        </div>
        {reconLoading && <div className="table-state">正在加载对账数据...</div>}
        {!reconLoading && !reconciliation?.items.length && <div className="table-state">暂无账期未收。把客户的付款方式设为「账期」后，发货的订单会在这里按客户汇总。</div>}
        {!!reconciliation?.items.length && <div className="finance-recon-list">
          {reconciliation.items.map((item) => <button type="button" className="finance-recon-row" key={item.customerId ?? item.customerName} onClick={() => openStatement(item)}>
            <div className="finance-recon-main">
              <strong>{item.customerName}</strong>
              <span>{item.orderCount} 单 · 未到期 {money(item.notDueCents)}{item.oldestOverdueDays > 0 ? ` · 逾期最久 ${item.oldestOverdueDays} 天` : ''}</span>
            </div>
            <div className="finance-recon-amount">
              <strong className={item.overdueCents > 0 ? 'finance-warning' : undefined}>{money(item.outstandingCents)}</strong>
              <span>{item.overdueCents > 0 ? `逾期 ${money(item.overdueCents)}` : item.creditLimitCents > 0 ? `额度 ${money(item.creditLimitCents)}` : '未逾期'}</span>
            </div>
          </button>)}
        </div>}
      </div>}
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
        <div><span>已收金额</span><strong className="finance-positive">{money(detail.finance.receivedCents)}</strong>{detail.finance.refundedCents > 0 && <small>已退 {money(detail.finance.refundedCents)}</small>}</div>
        <div><span>{detail.finance.overpaidCents > 0 ? '超收金额' : '未收金额'}</span><strong className={detail.finance.outstandingCents > 0 || detail.finance.overpaidCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(detail.finance.overpaidCents > 0 ? detail.finance.overpaidCents : detail.finance.outstandingCents)}</strong>{detail.finance.overpaidCents > 0 && <small>客户多付，可在下方退款</small>}</div>
        <div><span>成本合计</span><strong>{detail.profit.costComplete ? money(detail.profit.totalCostCents ?? 0) : '成本待补'}</strong>{!detail.profit.costComplete && <small>{detail.profit.missingItemCount} 行产品未确认</small>}</div>
        <div><span>订单毛利</span><strong className={!detail.profit.costComplete ? 'finance-warning' : (detail.profit.profitCents ?? 0) < 0 ? 'finance-warning' : 'finance-positive'}>{detail.profit.costComplete ? money(detail.profit.profitCents ?? 0) : '—'}</strong>{detail.profit.costComplete && detail.profit.marginPercent != null && <small>毛利率 {detail.profit.marginPercent}%</small>}</div>
        <div><span>付款状态</span><b className={badgeClass(detail.finance.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[detail.finance.paymentStatus]}</b></div>
        <div><span>收款/开票公司</span><strong>{String(detail.order.company_name ?? '') || '未分配'}</strong>{detailCompany && <button className="button button-ghost finance-copy-invoice-button" type="button" onClick={() => void copyCompanyInvoiceInfo(detailCompany.id)}><Copy size={13} />复制开票信息</button>}</div>
      </div>
      <PaymentProofEditor detail={detail} onRefresh={refreshDetail} onNotify={onNotify} />
      <RefundEditor detail={detail} onRefresh={refreshDetail} onNotify={onNotify} />
      <InvoiceEditor detail={detail} customer={detailCustomer} onRefresh={refreshDetail} onNotify={onNotify} />
    </div>}</Modal>
    <Modal open={Boolean(statementCustomer)} title={statementCustomer ? `对账单 · ${statementCustomer.customerName}` : '对账单'} onClose={() => { setStatementCustomer(undefined); setStatement(undefined); }} width={900} variant="drawer">
      <div className="finance-statement">
        <div className="finance-statement-range">
          <label>开始日期<input type="date" className="toolbar-select" value={statementFrom} onChange={(event) => { setStatementFrom(event.target.value); if (statementCustomer?.customerId != null) void loadStatement(statementCustomer.customerId, event.target.value, statementTo); }} /></label>
          <label>结束日期<input type="date" className="toolbar-select" value={statementTo} onChange={(event) => { setStatementTo(event.target.value); if (statementCustomer?.customerId != null) void loadStatement(statementCustomer.customerId, statementFrom, event.target.value); }} /></label>
          <button type="button" className="button button-secondary" disabled={statementBusy || !statementCustomer?.customerId} onClick={() => { if (statementCustomer?.customerId != null) void loadStatement(statementCustomer.customerId, statementFrom, statementTo); }}>刷新</button>
          <button type="button" className="button button-primary" disabled={statementBusy || !statementCustomer?.customerId} onClick={() => void exportStatement()}><Download size={14} />下载对账单 PDF</button>
        </div>
        {statementBusy && <div className="table-state">正在生成对账单...</div>}
        {!statementBusy && statement && <>
          <div className="finance-recon-summary">
            <div><span>期初未收</span><strong>{money(statement.openingCents)}</strong></div>
            <div><span>本期应收</span><strong>{money(statement.periodReceivableCents)}</strong></div>
            <div><span>本期收款</span><strong className="finance-positive">{money(statement.periodReceiptCents)}</strong></div>
            <div><span>期末未收</span><strong>{money(statement.closingCents)}</strong></div>
            <div><span>其中逾期</span><strong className={statement.overdueCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(statement.overdueCents)}</strong></div>
          </div>
          <div className="finance-statement-section">本期发货订单</div>
          <div className="finance-statement-table-wrap"><table className="data-table finance-statement-table">
            <thead><tr><th>订单号</th><th>发货日期</th><th className="is-right">应收</th><th className="is-right">已收</th><th className="is-right">未收</th><th>到期日</th><th>状态</th></tr></thead>
            <tbody>{statement.orders.map((order) => <tr key={order.orderId}>
              <td className="strong-cell">{order.orderNo}</td>
              <td>{order.lastShippedAt.slice(0, 10)}</td>
              <td className="is-right">{money(order.receivableCents)}</td>
              <td className="is-right">{money(order.receivedCents)}</td>
              <td className="is-right">{money(order.outstandingCents)}</td>
              <td>{order.dueDate || '—'}</td>
              <td className={order.overdueDays < 0 ? 'finance-warning' : undefined}>{order.overdueDays < 0 ? `逾期 ${-order.overdueDays} 天` : '未到期'}</td>
            </tr>)}{!statement.orders.length && <tr><td colSpan={7} className="table-state">本期没有发货订单</td></tr>}</tbody>
          </table></div>
          <div className="finance-statement-section">本期收款</div>
          <div className="finance-statement-table-wrap"><table className="data-table finance-statement-table">
            <thead><tr><th>收款日期</th><th>订单号</th><th>方式</th><th>备注</th><th className="is-right">金额</th></tr></thead>
            <tbody>{statement.receipts.map((receipt) => <tr key={`${receipt.orderId}-${receipt.receivedAt}-${receipt.amountCents}`}>
              <td>{receipt.receivedAt.slice(0, 10)}</td>
              <td>{receipt.orderNo}</td>
              <td className={receipt.kind === 'refund' ? 'finance-warning' : undefined}>{receipt.kind === 'refund' ? '退款' : (receipt.paymentMethod || '—')}</td>
              <td>{receipt.note || ''}</td>
              <td className={`is-right ${receipt.kind === 'refund' ? 'finance-warning' : ''}`}>{money(receipt.amountCents)}</td>
            </tr>)}{!statement.receipts.length && <tr><td colSpan={5} className="table-state">本期没有收款</td></tr>}</tbody>
          </table></div>
        </>}
      </div>
    </Modal>
    <Modal open={companyOpen} title={month ? `已收金额 · 按公司（${month}，按下单月份）` : '已收金额 · 按公司（全部月份）'} onClose={() => setCompanyOpen(false)} width={560}>
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
  </div>;
}
