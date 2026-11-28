import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  FilePlus2,
  HandCoins,
  PackageCheck,
  PackageOpen,
  Plus,
  ReceiptText,
  RefreshCw,
  Truck,
  WalletCards,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OrderStatus } from '../components/OrderForm';
import type { CompanyStatsRow } from '../../shared/companies';
import {
  currentMonth,
  type FinanceListStats,
  type FinanceProofListRow,
  type PaymentProofStatus,
} from '../../shared/finance';
import { ORDER_CHANNEL_LABELS, ORDER_STATUS_LABELS_WITH_DRAFT, ORDER_STATUS_SEQUENCE, type OrderChannel } from '../../shared/domain';
import { getOrderStats, getOrders, listCompanyStats, listFinanceOrders, listFinanceProofs, type ApiOrderRow, type OrderListStats } from '../api';
import { money } from '../components/finance/finance-format';

export interface DashboardPageProps {
  onOpenOrders: (status?: OrderStatus, channel?: OrderChannel) => void;
  onOpenFinance: (channel?: OrderChannel) => void;
  onOpenWaterSlips: (status?: PaymentProofStatus, channel?: OrderChannel) => void;
  onNewOrder: (channel?: OrderChannel) => void;
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

function orderDateLabel(value: string): string {
  return value.length > 10 ? value.slice(5, 16).replace('T', ' ') : value;
}

/** 列表行没有财务汇总，按订单金额分转分展示即可。 */
function orderRowAmountCents(order: ApiOrderRow): number {
  if (order.amount_cents != null) return Math.max(0, Math.trunc(Number(order.amount_cents)));
  const amount = Number(order.amount);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
}

export default function DashboardPage({
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
  const [orderStats, setOrderStats] = useState<OrderListStats>();
  const [recentOrders, setRecentOrders] = useState<ApiOrderRow[]>([]);
  const [channel, setChannel] = useState<'all' | OrderChannel>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const channelFilter = channel === 'all' ? undefined : channel;
  // 快速切换渠道时先发后至的旧响应不能覆盖新渠道数据。
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    try {
      const [finance, companies, proofs, stats, recent] = await Promise.all([
        listFinanceOrders({ pageSize: 1, channel: channelFilter }),
        listCompanyStats(currentMonth(), channelFilter),
        listFinanceProofs({ limit: 6, channel: channelFilter }),
        getOrderStats({ channel: channelFilter }),
        // 工作台只要最近 6 单：直接从服务端按时间倒序取，不再依赖整张订单表。
        // 草稿也属于「最近订单」（与 counts.all 口径一致），否则刚存的草稿不会出现。
        getOrders({ channel: channelFilter, statuses: [...ORDER_STATUS_SEQUENCE, 'draft'], page: 1, pageSize: 6 }),
      ]);
      if (seq !== loadSeq.current) return;
      setFinanceStats(finance.stats);
      setCompanyStats(companies.items);
      setRecentProofs(proofs.items);
      setOrderStats(stats);
      setRecentOrders(recent.rows);
    } catch (reason) {
      if (seq !== loadSeq.current) return;
      // request() 抛出的是 { code, message } 普通对象，不能只认 Error。
      setError((reason as { message?: string })?.message ?? '工作台数据加载失败');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [channelFilter]);

  useEffect(() => { void load(); }, [load]);

  const todayOrderCount = orderStats?.todayOrderCount ?? 0;
  const todaySalesCents = orderStats?.todaySalesCents ?? 0;
  const outstandingCents = financeStats?.outstandingCents ?? 0;
  const receivedThisMonthCents = useMemo(
    () => companyStats.reduce((sum, row) => sum + row.receivedCents, 0),
    [companyStats],
  );
  const unassignedCompanyCount = orderStats?.unassignedCompanyCount ?? 0;
  const counts: Partial<Record<'all' | OrderStatus, number>> = orderStats?.counts ?? {};

  const tasks: Array<{
    label: string;
    hint: string;
    count: number;
    icon: typeof PackageOpen;
    tone?: 'warning' | 'danger';
    onClick: () => void;
  }> = [
    { label: '待备货', hint: '等待供应商备货', count: counts.pending_stock ?? 0, icon: PackageOpen, onClick: () => onOpenOrders('pending_stock', channelFilter) },
    { label: '已备货', hint: '备货完成，等待开始打包', count: counts.stock_reported ?? 0, icon: PackageCheck, onClick: () => onOpenOrders('stock_reported', channelFilter) },
    { label: '待打包', hint: '打包中，完成后进入待发货', count: counts.pending_packing ?? 0, icon: PackageCheck, onClick: () => onOpenOrders('pending_packing', channelFilter) },
    { label: '待发货', hint: '打包完成等待发出', count: counts.ship_pending ?? 0, icon: Truck, onClick: () => onOpenOrders('ship_pending', channelFilter) },
    { label: '发货中', hint: '已开始发货，待回填单号/确认', count: counts.shipping ?? 0, icon: Truck, onClick: () => onOpenOrders('shipping', channelFilter) },
    { label: '待审核水单', hint: '确认后计入已收', count: financeStats?.pendingProofCount ?? 0, icon: HandCoins, tone: 'warning', onClick: () => onOpenWaterSlips('pending', channelFilter) },
    { label: '待开票', hint: '对公订单待开票', count: financeStats?.pendingInvoiceCount ?? 0, icon: ReceiptText, tone: 'warning', onClick: () => onOpenFinance(channelFilter) },
    { label: '未分配公司', hint: '补公司后才能汇总', count: unassignedCompanyCount, icon: WalletCards, tone: unassignedCompanyCount > 0 ? 'danger' : undefined, onClick: () => onOpenOrders(undefined, channelFilter) },
  ];

  const companyRows = useMemo(
    () => companyStats
      .filter((row) => row.receivedCents || row.pendingCents || row.pendingInvoiceCents || row.receivedCount || row.pendingCount || row.pendingInvoiceCount)
      .sort((a, b) => b.receivedCents - a.receivedCents)
      .slice(0, 6),
    [companyStats],
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
        <select className="toolbar-select" aria-label="订单渠道筛选" value={channel} onChange={(event) => setChannel(event.target.value as 'all' | OrderChannel)}><option value="all">全部渠道</option><option value="online">{ORDER_CHANNEL_LABELS.online}订单</option><option value="offline">{ORDER_CHANNEL_LABELS.offline}订单</option></select>
        <button type="button" className="button button-primary" onClick={() => onNewOrder(channelFilter)}><Plus size={14} />新建订单</button>
        <button type="button" className="button button-secondary" onClick={onNewQuotation}><FilePlus2 size={14} />新建报价</button>
        <button type="button" className="button button-secondary" onClick={onNewProduct}><PackageOpen size={14} />新建产品</button>
        <button type="button" className="icon-button" title="刷新工作台" disabled={loading} onClick={() => { void load(); void onRefresh?.(); }}><RefreshCw size={15} /></button>
      </div>
    </div>

    {error && <div className="dashboard-error" role="alert">{error}</div>}

    <div className="dashboard-metrics">
      <div><span>今日订单</span><strong>{todayOrderCount}<small> 单</small></strong><em>今天新下的订单</em></div>
      <div><span>今日销售额</span><strong className="finance-positive">{money(todaySalesCents)}</strong><em>按订单金额统计</em></div>
      <div><span>本月已收</span><strong className="finance-positive">{money(receivedThisMonthCents)}</strong><em>{currentMonth()} 按收款日期</em></div>
      <div><span>未收款</span><strong className={outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(Math.max(0, outstandingCents))}</strong><em>{financeStats && financeStats.overpaidCents > 0 ? `全部订单未收合计 · 超收 ${money(financeStats.overpaidCents)}` : '全部订单未收合计'}</em></div>
    </div>

    <section className="dashboard-section">
      <div className="dashboard-section-head"><div><strong>待办</strong><span>数量为 0 时保留入口，方便确认已处理完</span></div><button type="button" className="button button-ghost" onClick={() => onOpenOrders(undefined, channelFilter)}>全部订单<ArrowRight size={13} /></button></div>
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
        <div className="dashboard-section-head"><div><strong>按公司收款</strong><span>{currentMonth()} · 已入账与待确认</span></div><button type="button" className="button button-ghost" onClick={() => onOpenWaterSlips(undefined, channelFilter)}>水单收款<ArrowRight size={13} /></button></div>
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
      <div className="dashboard-section-head"><div><strong>最近订单</strong><span>按订单状态继续处理</span></div><button type="button" className="button button-ghost" onClick={() => onOpenOrders(undefined, channelFilter)}>全部订单<ArrowRight size={13} /></button></div>
      {recentOrders.length ? <div className="dashboard-order-list">
        {recentOrders.map((order) => <button type="button" className="dashboard-order-row" key={order.id ?? order.order_no} onClick={() => onOpenOrders(order.status as OrderStatus, order.channel === 'online' || order.channel === 'offline' ? order.channel : undefined)}>
          <div><strong>{order.order_no}</strong><span>{order.customer_name || '未填客户'} · {orderDateLabel(order.ordered_at)}</span></div>
          <div><strong>{money(orderRowAmountCents(order))}</strong><span>{order.status ? ORDER_STATUS_LABELS_WITH_DRAFT[order.status] : '—'}</span></div>
        </button>)}
      </div> : <div className="dashboard-empty">还没有订单。</div>}
    </section>
  </div>;
}
