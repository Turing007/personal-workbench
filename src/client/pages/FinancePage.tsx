import { ChevronLeft, ChevronRight, RefreshCw, Search, Wallet, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../components/Modal';
import PaymentProofEditor from '../components/finance/PaymentProofEditor';
import InvoiceEditor from '../components/finance/InvoiceEditor';
import { badgeClass, errorText, money } from '../components/finance/finance-format';
import {
  getOrderFinance,
  listFinanceOrders,
  listReceivedByPayee,
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
  type PayeeBreakdownRow,
} from '../../shared/finance';
import type { Customer } from '../../shared/customers';

/** 按月偏移量平移 YYYY-MM，offset 为负表示往前翻 */
function shiftMonth(month: string, offset: number): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(year, (mon ?? 1) - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

interface FinancePageProps {
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  initialOrderId?: number;
  customers?: Customer[];
}

const orderStatusLabels: Record<string, string> = { label_pending: '待打印箱唛', pending_stock: '待备货', stock_reported: '已备货', pending_packing: '待打包', ship_pending: '待发货', shipped: '已发货' };

export default function FinancePage({ onNotify, initialOrderId, customers = [] }: FinancePageProps) {
  const [result, setResult] = useState<FinanceListResult>();
  const [query, setQuery] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [proofStatus, setProofStatus] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const [month, setMonth] = useState(() => currentMonth());
  const [selectedOrderId, setSelectedOrderId] = useState<number>();
  const [detail, setDetail] = useState<ApiFinanceDetail>();
  const [loading, setLoading] = useState(false);
  const [payeeOpen, setPayeeOpen] = useState(false);
  const [payeeRows, setPayeeRows] = useState<PayeeBreakdownRow[]>();
  const [payeeLoading, setPayeeLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setResult(await listFinanceOrders({ q: query, month: month || undefined, paymentStatus: paymentStatus as FinancePaymentStatus || undefined, proofStatus: proofStatus as FinanceProofStatus || undefined, invoiceStatus: invoiceStatus as InvoiceStatus || undefined, page: 1, pageSize: 100 })); }
    catch (error) { onNotify?.(errorText(error, '财务列表加载失败'), 'error'); }
    finally { setLoading(false); }
  }, [invoiceStatus, month, onNotify, paymentStatus, proofStatus, query]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (initialOrderId) setSelectedOrderId(initialOrderId); }, [initialOrderId]);
  const openDetail = async (orderId: number) => { setSelectedOrderId(orderId); try { setDetail(await getOrderFinance(orderId)); } catch (error) { onNotify?.(errorText(error, '财务详情加载失败'), 'error'); } };
  useEffect(() => { if (selectedOrderId) void openDetail(selectedOrderId); }, [selectedOrderId]);
  const refreshDetail = async () => { if (!selectedOrderId) return; setDetail(await getOrderFinance(selectedOrderId)); await load(); };
  const openPayeeBreakdown = async () => {
    setPayeeOpen(true);
    setPayeeLoading(true);
    try { setPayeeRows((await listReceivedByPayee(month || undefined)).items); }
    catch (error) { onNotify?.(errorText(error, '收款明细加载失败'), 'error'); setPayeeOpen(false); }
    finally { setPayeeLoading(false); }
  };
  const stats = result?.stats;
  const rows = useMemo(() => result?.rows ?? [], [result]);
  const payeeSummary = useMemo(() => ({
    amountCents: (payeeRows ?? []).reduce((sum, row) => sum + row.amountCents, 0),
    receiptCount: (payeeRows ?? []).reduce((sum, row) => sum + row.receiptCount, 0),
    payeeCount: payeeRows?.length ?? 0,
  }), [payeeRows]);
  const detailCustomer = useMemo(() => {
    const raw = detail?.order.customer_id ?? detail?.order.customerId;
    const numeric = Number(raw);
    if (!detail || !Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return customers.find((customer) => customer.id === numeric);
  }, [customers, detail]);

  return <div className="page-shell finance-page">
    <div className="page-toolbar finance-toolbar"><div><strong className="page-title">财务管理</strong><span className="page-subtitle">核验客户水单、登记收款并跟踪发票</span></div><div className="search-control"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索订单号或客户" /></div><div className="month-control" role="group" aria-label="按月筛选">{month ? <button className="icon-button" type="button" title="上一月" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></button> : null}<input type="month" className="toolbar-select month-input" aria-label="筛选月份" value={month} onChange={(event) => setMonth(event.target.value)} />{month ? <button className="icon-button" type="button" title="下一月" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></button> : null}<button className="icon-button" type="button" title={month ? '显示全部月份' : '回到当前月'} onClick={() => setMonth((value) => (value ? '' : currentMonth()))}>{month ? <X size={15} /> : '全部'}</button></div><select className="toolbar-select" aria-label="付款状态" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}><option value="">全部付款</option>{Object.entries(FINANCE_PAYMENT_STATUS_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><select className="toolbar-select" aria-label="水单状态" value={proofStatus} onChange={(event) => setProofStatus(event.target.value)}><option value="">全部水单</option>{Object.entries(PAYMENT_PROOF_STATUS_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><select className="toolbar-select" aria-label="发票状态" value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value)}><option value="">全部发票</option>{Object.entries(INVOICE_STATUS_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><button className="icon-button" type="button" title="刷新财务列表" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /></button></div>
    <div className="finance-stat-grid"><div><span>本期应收</span><strong>{money(stats?.receivableCents ?? 0)}</strong></div><button type="button" className="finance-stat-clickable" title="点击查看按收款人明细" onClick={() => void openPayeeBreakdown()}><span>已收金额</span><strong className="finance-positive">{money(stats?.receivedCents ?? 0)}</strong></button><div><span>未收金额</span><strong className="finance-warning">{money(stats?.outstandingCents ?? 0)}</strong></div><div><span>待审核水单</span><strong>{stats?.pendingProofCount ?? 0}<small> 张</small></strong></div><div><span>待处理发票</span><strong>{stats?.pendingInvoiceCount ?? 0}<small> 笔</small></strong></div></div>
    <section className="table-panel"><div className="table-scroll finance-table-desktop"><table className="data-table finance-table"><thead><tr>{['订单号', '客户', '日期', '应收', '已收', '未收', '付款', '水单', '发票', '物流', '操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.orderId}><td className="strong-cell finance-order-number">{row.orderNo}</td><td>{row.customerName || '—'}</td><td>{row.orderDate}</td><td>{money(row.receivableCents)}</td><td>{money(row.receivedCents)}</td><td className={row.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(row.outstandingCents)}</td><td><span className={badgeClass(row.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[row.paymentStatus]}</span></td><td><span className={badgeClass(row.proofStatus)}>{PAYMENT_PROOF_STATUS_LABELS[row.proofStatus]}</span></td><td><span className={badgeClass(row.invoiceStatus)}>{INVOICE_STATUS_LABELS[row.invoiceStatus]}</span></td><td>{orderStatusLabels[row.orderStatus] ?? row.orderStatus}</td><td><button className="button button-ghost" type="button" onClick={() => void openDetail(row.orderId)}>查看财务</button></td></tr>)}</tbody></table></div><div className="finance-card-list" aria-label="财务卡片列表">{rows.map((row) => <article key={row.orderId} className="finance-card"><div className="order-card-head"><div className="order-card-title"><strong className="finance-order-number">{row.orderNo}</strong><span>{row.customerName || '未填客户'} · {row.orderDate}</span></div><span className={badgeClass(row.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[row.paymentStatus]}</span></div><div className="order-card-grid"><div className="order-card-field"><span>应收</span><strong>{money(row.receivableCents)}</strong></div><div className="order-card-field"><span>已收</span><strong className="finance-positive">{money(row.receivedCents)}</strong></div><div className="order-card-field"><span>未收</span><strong className={row.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(row.outstandingCents)}</strong></div><div className="order-card-field"><span>物流</span><strong>{orderStatusLabels[row.orderStatus] ?? row.orderStatus}</strong></div></div><div className="order-card-meta">水单 {PAYMENT_PROOF_STATUS_LABELS[row.proofStatus]} · 发票 {INVOICE_STATUS_LABELS[row.invoiceStatus]}</div><div className="row-actions"><button className="button button-ghost" type="button" onClick={() => void openDetail(row.orderId)}>查看财务</button></div></article>)}</div>{loading && <div className="table-state">正在加载财务数据...</div>}{!loading && !rows.length && <div className="table-state">暂无符合条件的财务记录。订单创建后会自动生成应收记录。</div>}</section>
    <Modal open={Boolean(detail)} title={detail ? `财务详情 · ${String(detail.order.order_no ?? '')}` : '财务详情'} onClose={() => { setDetail(undefined); setSelectedOrderId(undefined); }} width={1120}>{detail && <div className="finance-detail">
      <div className="finance-detail-summary">
        <div><span>应收金额</span><strong>{money(detail.finance.receivableCents)}</strong></div>
        <div><span>已收金额</span><strong className="finance-positive">{money(detail.finance.receivedCents)}</strong></div>
        <div><span>未收金额</span><strong className={detail.finance.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(detail.finance.outstandingCents)}</strong></div>
        <div><span>付款状态</span><b className={badgeClass(detail.finance.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[detail.finance.paymentStatus]}</b></div>
      </div>
      <PaymentProofEditor detail={detail} onRefresh={refreshDetail} onNotify={onNotify} />
      <InvoiceEditor detail={detail} customer={detailCustomer} onRefresh={refreshDetail} onNotify={onNotify} />
    </div>}</Modal>
    <Modal open={payeeOpen} title={month ? `已收金额 · 按收款人（${month}）` : '已收金额 · 按收款人（全部月份）'} onClose={() => setPayeeOpen(false)} width={560}>
      {payeeLoading ? <div className="table-state">正在加载收款明细...</div> : payeeRows && payeeRows.length > 0 ? <div className="finance-payee-breakdown">
        <div className="finance-payee-summary">
          <div><span>{month ? '本期收款合计' : '收款合计'}</span><strong className="finance-positive">{money(payeeSummary.amountCents)}</strong></div>
          <div><span>收款笔数</span><strong>{payeeSummary.receiptCount}<small> 笔</small></strong></div>
          <div><span>收款人数</span><strong>{payeeSummary.payeeCount}<small> 人</small></strong></div>
        </div>
        {payeeRows.map((row) => <div className="finance-receipt-row" key={row.payeeName}>
          <Wallet size={15} />
          <div className="finance-receipt-main"><strong>{row.payeeName}</strong><span>{row.receiptCount} 笔收款</span></div>
          <strong className="finance-positive">{money(row.amountCents)}</strong>
        </div>)}
      </div> : <div className="table-state">{month ? `${month} 暂无收款记录。水单审核入账后可在此查看按收款人的分布。` : '暂无收款记录。水单审核入账后可在此查看按收款人的分布。'}</div>}
    </Modal>
  </div>;
}
