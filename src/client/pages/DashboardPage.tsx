import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  FilePlus2,
  HandCoins,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  Plus,
  ReceiptText,
  RefreshCw,
  Truck,
  WalletCards,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OrderDraft, OrderStatus } from '../components/OrderForm';
import type { CompanyStatsRow } from '../../shared/companies';
import {
  currentMonth,
  type FinanceListStats,
  type FinanceProofListRow,
  type PaymentProofStatus,
} from '../../shared/finance';
import { ORDER_STATUS_LABELS_WITH_DRAFT } from '../../shared/domain';
import { listCompanyStats, listFinanceOrders, listFinanceProofs } from '../api';
import { money } from '../components/finance/finance-format';

export interface DashboardPageProps {
  orders: OrderDraft[];
  statusCounts?: Partial<Record<'all' | OrderStatus, number>>;
  onOpenOrders: (status?: OrderStatus) => void;
  onOpenFinance: () => void;
  onOpenWaterSlips: (status?: PaymentProofStatus) => void;
  onNewOrder: () => void;
  onNewQuotation: () => void;
  onNewProduct: () => void;
  onRefresh?: () => Promise<void> | void;
}

const proofStatusLabels: Record<PaymentProofStatus, string> = {
  pending: '待确认',
  approved: '已入账',
  rejected: '已驳回',
  void: '已作废',
};

function todayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function orderAmountCents(order: OrderDraft): number {
  if (order.financeSummary?.receivableCents != null) return order.financeSummary.receivableCents;
  const amount = Number(order.amount);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
}

function orderDateLabel(value: string): string {
  return value.length > 10 ? value.slice(5, 16).replace('T', ' ') : value;
}

export default function DashboardPage({
  orders,
  statusCounts,
  onOpenOrders,
  onOpenFinance,
  onOpenWaterSlips,
  onNewOrder,
  onNewQuotation,
  onNewProduct,
  onRefresh,
}: DashboardPageProps) {
  const [financeStats, setFinanceStats] = useState<FinanceListStats>();
  const [companyStats, setCompanyStats] = useState<CompanyStatsRow[]>([]);
  const [recentProofs, setRecentProofs] = useState<FinanceProofListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [finance, companies, proofs] = await Promise.all([
        listFinanceOrders({ pageSize: 1 }),
        listCompanyStats(currentMonth()),
        listFinanceProofs({ limit: 6 }),
      ]);
      setFinanceStats(finance.stats);
      setCompanyStats(companies.items);
      setRecentProofs(proofs.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工作台数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const today = todayString();
  const nonDraftOrders = useMemo(() => orders.filter((order) => order.status !== 'draft'), [orders]);
  const todayOrders = useMemo(
    () => nonDraftOrders.filter((order) => order.orderedAt.slice(0, 10) === today),
    [nonDraftOrders, today],
  );
  const todaySalesCents = useMemo(() => todayOrders.reduce((sum, order) => sum + orderAmountCents(order), 0), [todayOrders]);
  const outstandingCents = financeStats?.outstandingCents
    ?? nonDraftOrders.reduce((sum, order) => sum + (order.financeSummary?.outstandingCents ?? 0), 0);
  const receivedThisMonthCents = useMemo(
    () => companyStats.reduce((sum, row) => sum + row.receivedCents, 0),
    [companyStats],
  );
  const unassignedCompanyCount = useMemo(
    () => nonDraftOrders.filter((order) => order.companyId == null).length,
    [nonDraftOrders],
  );
  const counts = useMemo<Partial<Record<OrderStatus, number>>>(() => {
    const computed: Partial<Record<OrderStatus, number>> = {};
    for (const order of nonDraftOrders) {
      if (!order.status) continue;
      computed[order.status] = (computed[order.status] ?? 0) + 1;
    }
    return { ...computed, ...statusCounts } as Partial<Record<OrderStatus, number>>;
  }, [nonDraftOrders, statusCounts]);

  const tasks: Array<{
    label: string;
    hint: string;
    count: number;
    icon: typeof PackageOpen;
    tone?: 'warning' | 'danger';
    onClick: () => void;
  }> = [
    { label: '待打印箱唛', hint: '打印后进入备货', count: counts.label_pending ?? 0, icon: PackageSearch, onClick: () => onOpenOrders('label_pending') },
    { label: '待备货', hint: '等待供应商备货', count: counts.pending_stock ?? 0, icon: PackageOpen, onClick: () => onOpenOrders('pending_stock') },
    { label: '待打包', hint: '备货完成等待打包', count: counts.pending_packing ?? 0, icon: PackageCheck, onClick: () => onOpenOrders('pending_packing') },
    { label: '待发货', hint: '打包完成等待发出', count: counts.ship_pending ?? 0, icon: Truck, onClick: () => onOpenOrders('ship_pending') },
    { label: '待审核水单', hint: '确认后计入已收', count: financeStats?.pendingProofCount ?? 0, icon: HandCoins, tone: 'warning', onClick: () => onOpenWaterSlips('pending') },
    { label: '待开票', hint: '对公订单待开票', count: financeStats?.pendingInvoiceCount ?? 0, icon: ReceiptText, tone: 'warning', onClick: onOpenFinance },
    { label: '未分配公司', hint: '补公司后才能汇总', count: unassignedCompanyCount, icon: WalletCards, tone: unassignedCompanyCount > 0 ? 'danger' : undefined, onClick: () => onOpenOrders() },
  ];

  const companyRows = useMemo(
    () => companyStats
      .filter((row) => row.receivedCents || row.pendingCents || row.pendingInvoiceCents || row.receivedCount || row.pendingCount || row.pendingInvoiceCount)
      .sort((a, b) => b.receivedCents - a.receivedCents)
      .slice(0, 6),
    [companyStats],
  );
  const recentOrders = useMemo(
    () => [...nonDraftOrders].sort((a, b) => b.orderedAt.localeCompare(a.orderedAt)).slice(0, 6),
    [nonDraftOrders],
  );
  const dateText = useMemo(() => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()), []);

  return <div className="page-shell dashboard-page">
    <div className="page-toolbar dashboard-head">
      <div className="dashboard-heading">
        <span className="page-breadcrumb">工作台</span>
        <strong className="page-title">工作台</strong>
        <span className="page-subtitle"><CalendarDays size={13} />{dateText} · 今天要处理的事都在这里</span>
      </div>
      <div className="dashboard-actions">
        <button type="button" className="button button-primary" onClick={onNewOrder}><Plus size={14} />新建订单</button>
        <button type="button" className="button button-secondary" onClick={onNewQuotation}><FilePlus2 size={14} />新建报价</button>
        <button type="button" className="button button-secondary" onClick={onNewProduct}><PackageOpen size={14} />新建产品</button>
        <button type="button" className="icon-button" title="刷新工作台" disabled={loading} onClick={() => { void load(); void onRefresh?.(); }}><RefreshCw size={15} /></button>
      </div>
    </div>

    {error && <div className="dashboard-error" role="alert">{error}</div>}

    <div className="dashboard-metrics">
      <div><span>今日订单</span><strong>{todayOrders.length}<small> 单</small></strong><em>今天新下的订单</em></div>
      <div><span>今日销售额</span><strong className="finance-positive">{money(todaySalesCents)}</strong><em>按订单金额统计</em></div>
      <div><span>本月已收</span><strong className="finance-positive">{money(receivedThisMonthCents)}</strong><em>{currentMonth()} 水单入账</em></div>
      <div><span>未收款</span><strong className={outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(outstandingCents)}</strong><em>全部订单未收合计</em></div>
    </div>

    <section className="dashboard-section">
      <div className="dashboard-section-head"><div><strong>待办</strong><span>数量为 0 时保留入口，方便确认已处理完</span></div><button type="button" className="button button-ghost" onClick={() => onOpenOrders()}>全部订单<ArrowRight size={13} /></button></div>
      <div className="dashboard-task-grid">
        {tasks.map((task) => {
          const Icon = task.icon;
          return <button key={task.label} type="button" className={`dashboard-task${task.tone ? ` is-${task.tone}` : ''}${task.count === 0 ? ' is-empty' : ''}`} onClick={task.onClick}>
            <span className="dashboard-task-icon"><Icon size={17} /></span>
            <span className="dashboard-task-copy"><strong>{task.label}</strong><small>{task.hint}</small></span>
            <b>{task.count}</b>
          </button>;
        })}
      </div>
    </section>

    <div className="dashboard-columns">
      <section className="dashboard-panel">
        <div className="dashboard-section-head"><div><strong>按公司收款</strong><span>{currentMonth()} · 已入账与待确认</span></div><button type="button" className="button button-ghost" onClick={() => onOpenWaterSlips()}>水单收款<ArrowRight size={13} /></button></div>
        {companyRows.length ? <div className="dashboard-company-list">
          {companyRows.map((row) => <button type="button" className="dashboard-company-row" key={row.companyId ?? 'unassigned'} onClick={() => onOpenWaterSlips()}>
            <div><strong>{row.companyName}</strong><span>{row.receivedCount} 笔已入账 · {row.pendingCount} 笔待确认</span></div>
            <div><strong className="finance-positive">{money(row.receivedCents)}</strong><span>待确认 {money(row.pendingCents)}</span>{row.pendingInvoiceCents > 0 && <span>待开票 {money(row.pendingInvoiceCents)}</span>}</div>
          </button>)}
        </div> : <div className="dashboard-empty">本月还没有收款记录。</div>}
      </section>

      <section className="dashboard-panel">
        <div className="dashboard-section-head"><div><strong>最近水单</strong><span>最近收到的客户付款凭证</span></div><button type="button" className="button button-ghost" onClick={() => onOpenWaterSlips()}>全部水单<ArrowRight size={13} /></button></div>
        {recentProofs.length ? <div className="dashboard-recent-list">
          {recentProofs.map((proof) => <button type="button" className="dashboard-recent-row" key={proof.id} onClick={() => onOpenWaterSlips()}>
            <div><strong>{proof.orderNo}</strong><span>{proof.companyName || '未分配公司'} · {proof.paymentDate || '未填日期'}</span></div>
            <div><strong>{proof.amountCents == null ? '待补金额' : money(proof.amountCents)}</strong><span className={proof.status === 'pending' ? 'finance-warning' : proof.status === 'approved' ? 'finance-positive' : undefined}>{proofStatusLabels[proof.status]}</span></div>
          </button>)}
        </div> : <div className="dashboard-empty">还没有水单记录。</div>}
      </section>
    </div>

    <section className="dashboard-panel dashboard-recent-orders">
      <div className="dashboard-section-head"><div><strong>最近订单</strong><span>按订单状态继续处理</span></div><button type="button" className="button button-ghost" onClick={() => onOpenOrders()}>全部订单<ArrowRight size={13} /></button></div>
      {recentOrders.length ? <div className="dashboard-order-list">
        {recentOrders.map((order) => <button type="button" className="dashboard-order-row" key={order.id ?? order.orderNo} onClick={() => onOpenOrders()}>
          <div><strong>{order.orderNo}</strong><span>{order.customerName || '未填客户'} · {orderDateLabel(order.orderedAt)}</span></div>
          <div><strong>{money(orderAmountCents(order))}</strong><span>{order.status ? ORDER_STATUS_LABELS_WITH_DRAFT[order.status] : '—'}</span></div>
        </button>)}
      </div> : <div className="dashboard-empty">还没有订单。</div>}
    </section>
  </div>;
}
