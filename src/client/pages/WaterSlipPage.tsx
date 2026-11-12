import { AlertTriangle, Building2, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardPaste, ExternalLink, RefreshCw, Search, Upload, Wallet, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  approveFinanceProof,
  deleteFinanceProof,
  listCompanyStats,
  listFinanceProofs,
  lookupFinanceOrders,
  rejectFinanceProof,
  uploadFinanceProof,
  voidFinanceProof,
} from '../api';
import type { Company, CompanyStatsRow } from '../../shared/companies';
import {
  currentMonth,
  type FinanceOrderLookupRow,
  type FinanceProofListRow,
  type PaymentProofStatus,
} from '../../shared/finance';
import { badgeClass, errorText, money } from '../components/finance/finance-format';
import FilterRail, { FilterCheckList } from '../components/FilterRail';
import { useFilterRailOpen, useSavedFilterViews } from '../filter-views';
import { thumbUrl } from '../image-urls';
import { useFileDrop } from '../use-file-drop';
import { useIsNarrow } from '../use-is-narrow';

export interface WaterSlipPageProps {
  companies: Company[];
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onOpenOrder?: (orderId: number) => void;
  onOpenFinance?: (orderId: number) => void;
  /** 工作台跳转：进入页面后直接带出待确认/公司筛选。 */
  initialStatus?: PaymentProofStatus;
  initialCompanyId?: number;
  onInitialFiltersConsumed?: () => void;
}

const paymentMethods = ['银行转账', '微信', '支付宝', '其他'];
const proofStatusLabels: Record<PaymentProofStatus, string> = {
  pending: '待确认',
  approved: '已入账',
  rejected: '已驳回',
  void: '已作废',
};
const proofStatusOptions: Array<{ value: '' | PaymentProofStatus; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待确认' },
  { value: 'approved', label: '已入账' },
  { value: 'rejected', label: '已驳回' },
  { value: 'void', label: '已作废' },
];

function shiftMonth(month: string, offset: number): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(year, (mon ?? 1) - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function WaterSlipPage({ companies, onNotify, onOpenOrder, onOpenFinance, initialStatus, initialCompanyId, onInitialFiltersConsumed }: WaterSlipPageProps) {
  const [month, setMonth] = useState(() => currentMonth());
  const [companyFilters, setCompanyFilters] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<PaymentProofStatus[]>([]);
  useEffect(() => {
    if (!initialStatus && initialCompanyId == null) return;
    if (initialStatus) setStatusFilters([initialStatus]);
    if (initialCompanyId != null) setCompanyFilters([String(initialCompanyId)]);
    onInitialFiltersConsumed?.();
  }, [initialStatus, initialCompanyId, onInitialFiltersConsumed]);
  const [query, setQuery] = useState('');
  const [stats, setStats] = useState<CompanyStatsRow[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [proofs, setProofs] = useState<FinanceProofListRow[]>([]);
  const [proofsLoading, setProofsLoading] = useState(false);
  const [selectedProofIds, setSelectedProofIds] = useState<number[]>([]);
  const [expandedProofIds, setExpandedProofIds] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupRows, setLookupRows] = useState<FinanceOrderLookupRow[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<FinanceOrderLookupRow>();
  const [file, setFile] = useState<File>();
  const [fileUrl, setFileUrl] = useState('');
  const fileUrlRef = useRef('');
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentMethod, setPaymentMethod] = useState(paymentMethods[0]);
  const [payerName, setPayerName] = useState('');
  const [transactionNo, setTransactionNo] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyProofId, setBusyProofId] = useState<number>();
  const narrow = useIsNarrow();
  const amountRef = useRef<HTMLInputElement | null>(null);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats((await listCompanyStats(month || undefined)).items);
    } catch (error) {
      onNotify?.(errorText(error, '公司收款统计加载失败'), 'error');
    } finally {
      setStatsLoading(false);
    }
  }, [month, onNotify]);

  const loadProofs = useCallback(async () => {
    setProofsLoading(true);
    try {
      setProofs((await listFinanceProofs({
        month: month || undefined,
        companyIds: companyFilters.filter((value) => value !== 'unassigned').map(Number),
        includeUnassignedCompany: companyFilters.includes('unassigned'),
        statuses: statusFilters,
        query: query.trim() || undefined,
      })).items);
    } catch (error) {
      onNotify?.(errorText(error, '水单列表加载失败'), 'error');
    } finally {
      setProofsLoading(false);
    }
  }, [companyFilters, month, onNotify, query, statusFilters]);

  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProofs(); }, 220);
    return () => window.clearTimeout(timer);
  }, [loadProofs]);

  // 订单号输入：防抖查候选，完全匹配时直接带出订单卡。
  useEffect(() => {
    const trimmed = lookupQuery.trim();
    if (trimmed.length < 2) {
      setLookupRows([]);
      setLookupLoading(false);
      return;
    }
    let cancelled = false;
    setLookupLoading(true);
    const timer = window.setTimeout(() => {
      void lookupFinanceOrders(trimmed).then((result) => {
        if (cancelled) return;
        setLookupRows(result.items);
        const exact = result.items.find((row) => row.orderNo === trimmed);
        if (exact) setSelectedOrder(exact);
      }).catch((error) => {
        if (!cancelled) onNotify?.(errorText(error, '订单查询失败'), 'error');
      }).finally(() => {
        if (!cancelled) setLookupLoading(false);
      });
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [lookupQuery, onNotify]);

  const setProofFile = (next: File | undefined) => {
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
      fileUrlRef.current = '';
    }
    setFile(next);
    const url = next ? URL.createObjectURL(next) : '';
    setFileUrl(url);
    fileUrlRef.current = url;
  };

  useEffect(() => () => {
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const images = Array.from(event.clipboardData?.files ?? []).filter((item) => item.type.startsWith('image/'));
      if (!images.length) return;
      event.preventDefault();
      setProofFile(images[0]);
      amountRef.current?.focus();
      onNotify?.('已从剪贴板读取水单截图，请填写金额', 'info');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onNotify]);

  const { dragging, handlers: dropHandlers } = useFileDrop((files) => {
    const image = files.find((item) => item.type.startsWith('image/'));
    if (image) setProofFile(image);
  });

  const selectOrder = (order: FinanceOrderLookupRow) => {
    setSelectedOrder(order);
    setLookupRows([]);
    setLookupQuery(order.orderNo);
  };

  const clearOrder = () => {
    setSelectedOrder(undefined);
    setLookupRows([]);
    setLookupQuery('');
  };

  const save = async () => {
    if (!selectedOrder || !file || !amount || saving) return;
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      onNotify?.('请填写正确的付款金额', 'error');
      return;
    }
    setSaving(true);
    try {
      await uploadFinanceProof(selectedOrder.orderId, file, {
        paymentDate,
        amountCents,
        paymentMethod,
        payerName: payerName.trim(),
        transactionNo: transactionNo.trim(),
        note: note.trim(),
      });
      setProofFile(undefined);
      setAmount('');
      setTransactionNo('');
      setNote('');
      setPayerName('');
      await Promise.all([loadStats(), loadProofs()]);
      onNotify?.(`水单已保存到 ${selectedOrder.orderNo}，待财务确认后计入已收`, 'success');
    } catch (error) {
      onNotify?.(errorText(error, '水单保存失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const act = async (proof: FinanceProofListRow, action: 'approve' | 'reject' | 'void' | 'delete') => {
    if (busyProofId) return;
    if (action === 'delete' && !window.confirm(`确定删除水单“${proof.originalName}”吗？此操作不可恢复。`)) return;
    if (action === 'void' && !window.confirm('作废后会冲销这笔水单生成的收款记录，确定继续吗？')) return;
    let rejectNote = '';
    if (action === 'reject') {
      rejectNote = window.prompt('请填写驳回原因')?.trim() ?? '';
      if (!rejectNote) return;
    }
    setBusyProofId(proof.id);
    try {
      if (action === 'approve') await approveFinanceProof(proof.id);
      if (action === 'reject') await rejectFinanceProof(proof.id, rejectNote);
      if (action === 'void') await voidFinanceProof(proof.id, '水单页手动作废');
      if (action === 'delete') await deleteFinanceProof(proof.id);
      await Promise.all([loadStats(), loadProofs()]);
      onNotify?.(action === 'approve' ? '水单已确认入账' : action === 'reject' ? '水单已驳回' : action === 'void' ? '水单已作废' : '水单已删除', 'success');
    } catch (error) {
      onNotify?.(errorText(error, '水单操作失败'), 'error');
    } finally {
      setBusyProofId(undefined);
    }
  };

  const selectableProofs = useMemo(() => proofs.filter((proof) => proof.status === 'pending' || proof.status === 'rejected'), [proofs]);
  const selectedProofs = useMemo(() => selectableProofs.filter((proof) => selectedProofIds.includes(proof.id)), [selectableProofs, selectedProofIds]);
  const selectedAmountCents = selectedProofs.reduce((sum, proof) => sum + (proof.amountCents ?? 0), 0);
  const selectedMissingAmount = selectedProofs.filter((proof) => proof.amountCents == null).length;
  const allSelectableSelected = selectableProofs.length > 0 && selectableProofs.every((proof) => selectedProofIds.includes(proof.id));
  const toggleProofSelected = (id: number) => setSelectedProofIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const toggleAllSelectable = () => setSelectedProofIds((ids) => allSelectableSelected
    ? ids.filter((id) => !selectableProofs.some((proof) => proof.id === id))
    : [...new Set([...ids, ...selectableProofs.map((proof) => proof.id)])]);
  const toggleProofExpanded = (id: number) => setExpandedProofIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);

  // 列表刷新或状态变化后，已入账/已作废的水单自动退出勾选，避免批量操作出现无效行。
  useEffect(() => {
    setSelectedProofIds((ids) => {
      const next = ids.filter((id) => proofs.some((proof) => proof.id === id && (proof.status === 'pending' || proof.status === 'rejected')));
      return next.length === ids.length ? ids : next;
    });
  }, [proofs]);

  const batchApprove = async () => {
    if (!selectedProofs.length || bulkBusy) return;
    const lines = selectedProofs.map((proof) => `· ${proof.orderNo} ${proof.amountCents == null ? '待补金额' : money(proof.amountCents)}${proof.paymentDate ? '' : '（未填付款日期）'}`);
    const preview = lines.slice(0, 12).join('\n');
    if (!window.confirm([`确定批量确认入账 ${selectedProofs.length} 张水单吗？`, preview, lines.length > 12 ? `…另有 ${lines.length - 12} 张` : ''].filter(Boolean).join('\n'))) return;
    setBulkBusy(true);
    const failedIds: number[] = [];
    const failures: string[] = [];
    let success = 0;
    for (const proof of selectedProofs) {
      try {
        await approveFinanceProof(proof.id);
        success += 1;
      } catch (error) {
        failedIds.push(proof.id);
        failures.push(`${proof.orderNo}：${errorText(error, '确认失败')}`);
      }
    }
    setSelectedProofIds(failedIds);
    await Promise.all([loadStats(), loadProofs()]);
    setBulkBusy(false);
    if (!failures.length) onNotify?.(`已确认入账 ${success} 张水单`, 'success');
    else onNotify?.(`已确认 ${success} 张，${failures.length} 张失败：${failures.slice(0, 3).join('；')}${failures.length > 3 ? '…' : ''}`, 'error');
  };

  const batchReject = async () => {
    if (!selectedProofs.length || bulkBusy) return;
    const reason = window.prompt(`批量驳回所选 ${selectedProofs.length} 张水单，请填写统一原因`)?.trim();
    if (!reason) return;
    if (!window.confirm(`确定驳回 ${selectedProofs.length} 张水单吗？\n原因：${reason}`)) return;
    setBulkBusy(true);
    const failedIds: number[] = [];
    const failures: string[] = [];
    let success = 0;
    for (const proof of selectedProofs) {
      try {
        await rejectFinanceProof(proof.id, reason);
        success += 1;
      } catch (error) {
        failedIds.push(proof.id);
        failures.push(`${proof.orderNo}：${errorText(error, '驳回失败')}`);
      }
    }
    setSelectedProofIds(failedIds);
    await Promise.all([loadStats(), loadProofs()]);
    setBulkBusy(false);
    if (!failures.length) onNotify?.(`已驳回 ${success} 张水单`, 'success');
    else onNotify?.(`已驳回 ${success} 张，${failures.length} 张失败：${failures.slice(0, 3).join('；')}${failures.length > 3 ? '…' : ''}`, 'error');
  };

  const totals = useMemo(() => stats.reduce((sum, row) => ({
    receivedCents: sum.receivedCents + row.receivedCents,
    receivedCount: sum.receivedCount + row.receivedCount,
    pendingCents: sum.pendingCents + row.pendingCents,
    pendingCount: sum.pendingCount + row.pendingCount,
    pendingInvoiceCents: sum.pendingInvoiceCents + row.pendingInvoiceCents,
    pendingInvoiceCount: sum.pendingInvoiceCount + row.pendingInvoiceCount,
  }), { receivedCents: 0, receivedCount: 0, pendingCents: 0, pendingCount: 0, pendingInvoiceCents: 0, pendingInvoiceCount: 0 }), [stats]);
  const activeStats = useMemo(() => stats.filter((row) => row.receivedCents || row.receivedCount || row.pendingCents || row.pendingCount || row.pendingInvoiceCents || row.pendingInvoiceCount), [stats]);
  const companyOptions = companies;
  const selectedCompanyWarning = selectedOrder && !selectedOrder.companyName && selectedOrder.settlementType !== 'personal';
  const thumbToggle = (proof: FinanceProofListRow) => {
    const expanded = expandedProofIds.includes(proof.id);
    return <button
      type="button"
      className="water-slip-thumb water-slip-thumb-toggle"
      aria-expanded={expanded}
      aria-label={`${expanded ? '收起' : '展开'}水单 ${proof.orderNo}`}
      title={expanded ? '收起水单详情' : '展开水单详情'}
      onClick={() => toggleProofExpanded(proof.id)}
    >
      <img src={thumbUrl(proof.url ?? '', 240)} alt={proof.originalName} loading="lazy" decoding="async" />
      <span className="water-slip-thumb-chevron">{expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}</span>
    </button>;
  };

  const waterFilters = useMemo(() => ({ companies: companyFilters, statuses: statusFilters, month }), [companyFilters, statusFilters, month]);
  const applyWaterFilters = (next: typeof waterFilters) => {
    setCompanyFilters(next.companies);
    setStatusFilters(next.statuses);
    setMonth(next.month);
  };
  const savedFilters = useSavedFilterViews('water-slips', waterFilters, applyWaterFilters);
  const filterRail = useFilterRailOpen('water-slips');
  const companyFilterOptions = [
    ...companies.map((company) => ({ value: String(company.id), label: `${company.shortName}${company.isActive ? '' : '（已停用）'}` })),
    { value: 'unassigned', label: '未分配公司' },
  ];
  const statusFilterOptions = (Object.entries(proofStatusLabels) as [PaymentProofStatus, string][]).map(([value, label]) => ({ value, label }));
  const toggleCompanyFilter = (value: string) => {
    setCompanyFilters((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };
  const resetWaterFilters = () => {
    applyWaterFilters({ companies: [], statuses: [], month: currentMonth() });
    savedFilters.clearActive();
  };

  return <div className="page-shell water-slip-page">
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
        onReset={resetWaterFilters}
      >
        <FilterCheckList title="公司" options={companyFilterOptions} selected={companyFilters} onChange={setCompanyFilters} searchable={companyFilterOptions.length > 7} />
        <FilterCheckList title="水单状态" options={statusFilterOptions} selected={statusFilters} onChange={setStatusFilters} searchable={false} />
      </FilterRail>
      <div className="filter-rail-main">
    <div className="page-toolbar water-slip-head">
      <div>
        <span className="page-breadcrumb">履约 / 财务 / 水单</span>
        <strong className="page-title">水单收款</strong>
        <span className="page-subtitle">输入订单号带出公司和金额，保存水单后按公司统计</span>
      </div>
      <div className="water-slip-head-actions">
        <div className="month-control" role="group" aria-label="按收款月份筛选">
          <button className="icon-button" type="button" title="上一月" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></button>
          <input type="month" className="toolbar-select month-input" aria-label="收款月份" value={month} onChange={(event) => setMonth(event.target.value)} />
          <button className="icon-button" type="button" title="下一月" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></button>
          <button className="button button-secondary month-scope-button" type="button" onClick={() => setMonth((value) => value ? '' : currentMonth())}>{month ? <X size={14} /> : <CalendarDays size={14} />}{month ? '全部' : '本月'}</button>
        </div>
        <button className="icon-button" type="button" title="刷新水单和统计" disabled={statsLoading || proofsLoading} onClick={() => void Promise.all([loadStats(), loadProofs()])}><RefreshCw size={15} /></button>
      </div>
    </div>

    <div className="water-slip-stat-grid">
      <div><span>已入账</span><strong className="finance-positive">{money(totals.receivedCents)}</strong><small>{totals.receivedCount} 笔</small></div>
      <div><span>待确认</span><strong className="finance-warning">{money(totals.pendingCents)}</strong><small>{totals.pendingCount} 笔</small></div>
      <div><span>待开票</span><strong>{money(totals.pendingInvoiceCents)}</strong><small>{totals.pendingInvoiceCount} 个订单</small></div>
      <div><span>涉及公司</span><strong>{activeStats.filter((row) => row.receivedCount || row.pendingCount).length}<small> 家</small></strong><small>{month || '全部月份'}</small></div>
    </div>

    <section className={`water-slip-collect${dragging ? ' is-dragging' : ''}`} {...dropHandlers}>
      <div className="water-slip-collect-head">
        <div><strong>快速收集</strong><span>按订单号、客户、收件人或金额查找订单 → 自动带出公司 → 上传水单</span></div>
        {selectedOrder && <button className="button button-ghost" type="button" onClick={clearOrder}><X size={14} />换订单</button>}
      </div>
      <div className="water-slip-order-search">
        <Search size={15} />
        <input
          value={lookupQuery}
          onChange={(event) => {
            setLookupQuery(event.target.value);
            setLookupRows([]);
            if (selectedOrder && event.target.value !== selectedOrder.orderNo) setSelectedOrder(undefined);
          }}
          placeholder="输入订单号、客户、收件人或金额"
          aria-label="查找订单"
        />
        {lookupLoading && <span className="water-slip-search-hint">查询中…</span>}
        {!lookupLoading && lookupQuery.trim().length >= 2 && !selectedOrder && lookupRows.length === 0 && <span className="water-slip-search-hint">未找到订单</span>}
      </div>
      {!selectedOrder && lookupRows.length > 0 && <div className="water-slip-candidates">
        {lookupRows.map((row) => <button type="button" key={row.orderId} className="water-slip-candidate" onClick={() => selectOrder(row)}>
          <strong>{row.orderNo}</strong>
          <span>{row.customerName || '未填客户'}{row.recipientName ? ` · 收件人 ${row.recipientName}` : ''} · {row.companyName || '未分配公司'}</span>
          <small>金额 {money(row.amountCents)} · 未收 {money(row.outstandingCents)}</small>
        </button>)}
      </div>}
      {selectedOrder && <div className="water-slip-selected-order">
        <div className="water-slip-order-main">
          <div><strong>{selectedOrder.orderNo}</strong><span>{selectedOrder.customerName || '未填客户'}{selectedOrder.recipientName ? ` · 收件人 ${selectedOrder.recipientName}` : ''}</span></div>
          <span className={selectedOrder.companyName ? 'badge badge-neutral' : 'badge badge-warning'}><Building2 size={12} />{selectedOrder.companyName || '未分配公司'}</span>
        </div>
        <div className="water-slip-order-metrics">
          <div><span>应收</span><strong>{money(selectedOrder.receivableCents)}</strong></div>
          <div><span>已收</span><strong className="finance-positive">{money(selectedOrder.receivedCents)}</strong></div>
          <div><span>未收</span><strong className={selectedOrder.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(selectedOrder.outstandingCents)}</strong></div>
          <div><span>发票</span><strong>{selectedOrder.invoiceStatus === 'not_requested' ? '未申请' : selectedOrder.invoiceStatus === 'pending_issue' ? '待开票' : selectedOrder.invoiceStatus === 'issued' ? '已开票' : selectedOrder.invoiceStatus === 'sent' ? '已发送' : selectedOrder.invoiceStatus === 'void' ? '已作废' : '资料不完整'}</strong></div>
        </div>
        {selectedCompanyWarning && <div className="water-slip-warning"><AlertTriangle size={14} /><span>该对公订单还没有分配收款/开票公司，水单会先归到“未分配公司”；建议先分配公司再统计。</span>{onOpenOrder && <button className="button button-ghost" type="button" onClick={() => onOpenOrder(selectedOrder.orderId)}>去订单分配</button>}</div>}
      </div>}

      {selectedOrder && <div className="water-slip-upload">
        <div className="water-slip-file-zone">
          {file && fileUrl ? <a href={fileUrl} target="_blank" rel="noreferrer" className="water-slip-file-preview"><img src={fileUrl} alt={file.name} /></a> : <div className="water-slip-file-placeholder"><Upload size={22} /><span>选择水单图片</span><small>也可以直接 Ctrl+V 粘贴截图</small></div>}
          <div className="water-slip-file-actions">
            <label className="button button-secondary"><Upload size={14} />{file ? '重新选择' : '选择图片'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => setProofFile(event.target.files?.[0])} /></label>
            {file && <button className="button button-ghost" type="button" onClick={() => setProofFile(undefined)}>移除</button>}
            <span className="water-slip-paste-hint"><ClipboardPaste size={13} />支持粘贴截图</span>
          </div>
        </div>
        <div className="water-slip-form">
          <label>付款日期<input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
          <label>付款金额（元）<input ref={amountRef} type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="按水单实际金额填写" /></label>
          <label>付款方式<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></label>
          <label>付款人<input value={payerName} onChange={(event) => setPayerName(event.target.value)} placeholder="可选" /></label>
          <label>交易流水号<input value={transactionNo} onChange={(event) => setTransactionNo(event.target.value)} placeholder="可选" /></label>
          <label>备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选" /></label>
        </div>
        <div className="water-slip-save-row">
          <span>保存后状态为“待确认”，确认入账后才计入已收金额。</span>
          <button className="button button-primary" type="button" disabled={!file || !amount || saving} onClick={() => void save()}><Wallet size={14} />{saving ? '保存中…' : '保存水单'}</button>
        </div>
      </div>}
    </section>

    <section className="water-slip-company-stats">
      <div className="water-slip-section-head"><div><strong>按公司统计</strong><span>按水单付款日期统计；未分配公司的水单单独显示</span></div>{statsLoading && <span className="water-slip-search-hint">加载中…</span>}</div>
      {activeStats.length ? <div className="water-slip-company-grid">
        {activeStats.map((row) => <button type="button" key={row.companyId ?? 'unassigned'} className={`water-slip-company-card${companyFilters.includes(String(row.companyId ?? 'unassigned')) ? ' is-active' : ''}`} onClick={() => toggleCompanyFilter(String(row.companyId ?? 'unassigned'))}>
          <div className="water-slip-company-card-head"><Building2 size={15} /><strong>{row.companyName}</strong></div>
          <div className="water-slip-company-card-metrics">
            <div><span>已入账</span><strong className="finance-positive">{money(row.receivedCents)}</strong></div>
            <div><span>待确认</span><strong className="finance-warning">{money(row.pendingCents)}</strong></div>
            <div><span>待开票</span><strong>{money(row.pendingInvoiceCents)}</strong></div>
          </div>
          <small>{row.receivedCount} 笔已入账 · {row.pendingCount} 笔待确认 · {row.pendingInvoiceCount} 个待开票订单</small>
        </button>)}
      </div> : <div className="table-state">本月还没有水单记录。输入订单号开始收集。</div>}
    </section>

    <section className="table-panel water-slip-list-panel">
      <div className="water-slip-list-toolbar">
        <div className="water-slip-section-head"><div><strong>最近水单</strong><span>{month ? `${month} · 按付款日期` : '全部月份'}</span></div></div>
        <div className="water-slip-filters">
          <select className="toolbar-select" aria-label="公司筛选" value={companyFilters.length === 1 ? companyFilters[0] : ''} onChange={(event) => setCompanyFilters(event.target.value ? [event.target.value] : [])}>
            <option value="">全部公司</option>
            {companyOptions.map((company) => <option value={company.id} key={company.id}>{company.shortName}{company.isActive ? '' : '（已停用）'}</option>)}
            <option value="unassigned">未分配公司</option>
          </select>
          <select className="toolbar-select" aria-label="水单状态" value={statusFilters.length === 1 ? statusFilters[0] : ''} onChange={(event) => setStatusFilters(event.target.value ? [event.target.value as PaymentProofStatus] : [])}>
            {proofStatusOptions.map((option) => <option value={option.value} key={option.value || 'all'}>{option.label}</option>)}
          </select>
          <div className="water-slip-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索订单号/客户/付款人" aria-label="搜索水单" /></div>
        </div>
      </div>
      {proofsLoading ? <div className="table-state">正在加载水单...</div> : proofs.length ? <>
        {!narrow && <div className="table-scroll"><table className="data-table water-slip-table">
          <thead><tr><th className="water-slip-check-cell"><input type="checkbox" checked={allSelectableSelected} onChange={toggleAllSelectable} aria-label="选择当前列表可批量处理的水单" /></th>{['水单', '订单号', '客户', '公司', '付款日期', '金额', '状态', '操作'].map((title) => <th key={title} className={title === '金额' ? 'is-right' : undefined}>{title}</th>)}</tr></thead>
          <tbody>{proofs.map((proof) => {
            const selectable = proof.status === 'pending' || proof.status === 'rejected';
            const expanded = expandedProofIds.includes(proof.id);
            return <Fragment key={proof.id}>
              <tr className={expanded ? 'is-expanded' : undefined}>
                <td className="water-slip-check-cell"><input type="checkbox" disabled={!selectable} checked={selectable && selectedProofIds.includes(proof.id)} onChange={() => toggleProofSelected(proof.id)} aria-label={`选择水单${proof.orderNo}`} title={selectable ? undefined : '已入账或已作废的水单不能批量处理'} /></td>
                <td>{thumbToggle(proof)}</td>
                <td className="strong-cell">{proof.orderNo}</td>
                <td>{proof.customerName || '—'}</td>
                <td className={proof.companyName ? undefined : 'finance-warning'}>{proof.companyName || '未分配'}</td>
                <td>{proof.paymentDate || '未填日期'}</td>
                <td className="is-right">{proof.amountCents == null ? '待补金额' : money(proof.amountCents)}</td>
                <td><span className={badgeClass(proof.status)}>{proofStatusLabels[proof.status]}</span></td>
                <td><ProofActions proof={proof} busy={busyProofId === proof.id} onAct={act} onOpenFinance={onOpenFinance} compact /></td>
              </tr>
              {expanded && <tr className="water-proof-expand-row"><td colSpan={9}><WaterProofExpandPanel proof={proof} busy={busyProofId === proof.id} onAct={act} onOpenFinance={onOpenFinance} /></td></tr>}
            </Fragment>;
          })}</tbody>
        </table></div>}
        {narrow && <div className="water-slip-card-list">{proofs.map((proof) => {
          const selectable = proof.status === 'pending' || proof.status === 'rejected';
          const expanded = expandedProofIds.includes(proof.id);
          return <article className={`water-slip-card${expanded ? ' is-expanded' : ''}`} key={proof.id}>
            <div className="water-slip-card-head">
              <input className="water-slip-card-check" type="checkbox" disabled={!selectable} checked={selectable && selectedProofIds.includes(proof.id)} onChange={() => toggleProofSelected(proof.id)} aria-label={`选择水单${proof.orderNo}`} />
              {thumbToggle(proof)}
              <div><strong>{proof.orderNo}</strong><span>{proof.customerName || '未填客户'} · {proof.companyName || '未分配公司'}</span><small>{proof.paymentDate || '未填日期'} · {proof.amountCents == null ? '待补金额' : money(proof.amountCents)}</small></div>
              <span className={badgeClass(proof.status)}>{proofStatusLabels[proof.status]}</span>
            </div>
            {expanded && <WaterProofExpandPanel proof={proof} busy={busyProofId === proof.id} onAct={act} onOpenFinance={onOpenFinance} />}
            <div className="water-slip-card-actions"><ProofActions proof={proof} busy={busyProofId === proof.id} onAct={act} onOpenFinance={onOpenFinance} compact /></div>
          </article>;
        })}</div>}
        {selectedProofs.length > 0 && <div className="water-slip-bulk-bar" role="region" aria-label="水单批量操作">
          <span className="badge badge-accent">已选 {selectedProofs.length} 张 · 合计 {money(selectedAmountCents)}{selectedMissingAmount ? `（${selectedMissingAmount} 张待补金额）` : ''}</span>
          <button type="button" className="button button-primary button-sm" disabled={bulkBusy} onClick={() => void batchApprove()}><Check size={14} />{bulkBusy ? '处理中…' : '批量确认'}</button>
          <button type="button" className="button button-secondary button-sm" disabled={bulkBusy} onClick={() => void batchReject()}><X size={14} />批量驳回</button>
          <button type="button" className="button button-ghost button-sm" disabled={bulkBusy} onClick={() => setSelectedProofIds([])}>取消选择</button>
        </div>}
      </> : <div className="table-state">没有符合条件的水单。收到客户水单后，在上方输入订单号保存。</div>}
    </section>
      </div>
    </div>
  </div>;
}

function WaterProofExpandPanel({ proof, busy, onAct, onOpenFinance }: { proof: FinanceProofListRow; busy: boolean; onAct: (proof: FinanceProofListRow, action: 'approve' | 'reject' | 'void' | 'delete') => Promise<void>; onOpenFinance?: (orderId: number) => void }) {
  return <div className="water-proof-expand-panel">
    <a className="water-proof-expand-preview" href={proof.url} target="_blank" rel="noreferrer" title="打开原始水单">
      <img src={thumbUrl(proof.url ?? '', 480)} alt={proof.originalName} loading="lazy" decoding="async" />
      <span><ExternalLink size={12} />打开原图</span>
    </a>
    <div className="water-proof-expand-info">
      <div><span>付款人</span><strong>{proof.payerName || '未填写'}</strong></div>
      <div><span>交易流水号</span><strong>{proof.transactionNo || '未填写'}</strong></div>
      <div><span>付款方式</span><strong>{proof.paymentMethod || '未填写'}</strong></div>
      <div><span>付款日期</span><strong>{proof.paymentDate || '未填写'}</strong></div>
      <div><span>收款公司</span><strong>{proof.companyName || '未分配公司'}</strong></div>
      <div><span>订单号</span><strong>{proof.orderNo}</strong></div>
      <div><span>客户</span><strong>{proof.customerName || '未填写'}</strong></div>
      <div className="is-wide"><span>备注</span><strong>{proof.note || '—'}</strong></div>
      {proof.status === 'rejected' && <div className="is-wide"><span>驳回原因</span><strong className="finance-warning">{proof.reviewNote || '未填写'}</strong></div>}
    </div>
    <div className="water-proof-expand-actions"><ProofActions proof={proof} busy={busy} onAct={onAct} onOpenFinance={onOpenFinance} /></div>
  </div>;
}

function ProofActions({ proof, busy, onAct, onOpenFinance, compact = false }: { proof: FinanceProofListRow; busy: boolean; onAct: (proof: FinanceProofListRow, action: 'approve' | 'reject' | 'void' | 'delete') => Promise<void>; onOpenFinance?: (orderId: number) => void; compact?: boolean }) {
  return <>
    {onOpenFinance && <button className="button button-ghost" type="button" onClick={() => onOpenFinance(proof.orderId)}><ExternalLink size={13} />财务</button>}
    {proof.status === 'pending' && <><button className="button button-primary" type="button" disabled={busy} title={proof.amountCents == null || !proof.paymentDate ? '请先补录付款日期和金额' : '确认入账'} onClick={() => void onAct(proof, 'approve')}><Check size={13} />确认入账</button><button className="button button-ghost" type="button" disabled={busy} onClick={() => void onAct(proof, 'reject')}><X size={13} />驳回</button></>}
    {proof.status === 'approved' && <button className="button button-ghost danger-text" type="button" disabled={busy} onClick={() => void onAct(proof, 'void')}><X size={13} />作废</button>}
    {!compact && (proof.status === 'pending' || proof.status === 'rejected') && <button className="button button-ghost danger-text" type="button" disabled={busy} onClick={() => void onAct(proof, 'delete')}>删除</button>}
  </>;
}
