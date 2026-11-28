import { CalendarDays, Copy, History, Link2, PackageOpen, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  advanceOrderStatus,
  confirmSupplierStock,
  getStockPreparation,
  linkCustomerProductToSystem,
} from '../api';
import { errorText } from '../components/finance/finance-format';
import StockConfirmationHistoryModal from '../components/stock/StockConfirmationHistoryModal';
import { copyText } from '../copy-text';
import Modal from '../components/Modal';
import SystemProductOptionRow from '../components/SystemProductOptionRow';
import type { ProductRecord } from '../components/ProductEditor';
import {
  formatStockItemLine,
  planSupplierStockConfirm,
  type StockPreparation,
  type StockPreparationGroup,
  type StockPreparationItem,
} from '../../shared/stock';

interface StockPageProps {
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  systemProducts?: ProductRecord[];
}

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD → 9月8日；全部待备货返回汇总标题。 */
function scopeTitle(scope: string): string {
  if (scope === 'all') return '全部待备货';
  const [, month, day] = scope.split('-').map(Number);
  return `${month}月${day}日`;
}

/** 复制全部：首行日期，其后每个供应商一段，保留供应商名便于区分。 */
function buildCopyAllText(preparation: StockPreparation, groups: StockPreparationGroup[]): string {
  const blocks = groups.map((group) => `【${group.title}】\n${group.items.map(formatStockItemLine).join('\n')}`);
  return [scopeTitle(preparation.scope), ...blocks].filter(Boolean).join('\n');
}

/** 单个供应商复制：直接发给供应商，不带供应商名。 */
function groupCopyText(group: StockPreparationGroup): string {
  return group.items.map(formatStockItemLine).join('\n');
}

export default function StockPage({ onNotify, systemProducts = [] }: StockPageProps) {
  const [scope, setScope] = useState<'date' | 'all'>('date');
  const [date, setDate] = useState(todayISO);
  const [channel, setChannel] = useState<'all' | import('../../shared/domain').OrderChannel>('all');
  const [preparation, setPreparation] = useState<StockPreparation>();
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [confirmMarkOpen, setConfirmMarkOpen] = useState(false);
  const [confirmSupplier, setConfirmSupplier] = useState<StockPreparationGroup | null>(null);
  const [confirmNote, setConfirmNote] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<StockPreparationItem | null>(null);

  const scopeParam = scope === 'all' ? 'all' : (date || todayISO());
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPreparation(await getStockPreparation(scopeParam, channel === 'all' ? undefined : channel));
    } catch (error) {
      onNotify?.(errorText(error, '备货表加载失败'), 'error');
    } finally {
      setLoading(false);
    }
  }, [scopeParam, channel, onNotify]);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => preparation?.groups ?? [], [preparation]);
  const warningGroups = useMemo(() => groups.filter((group) => group.kind !== 'supplier'), [groups]);
  const orderIds = useMemo(() => {
    const ids = new Set<number>();
    for (const group of groups) {
      for (const item of group.items) {
        for (const orderId of item.orderIds) ids.add(orderId);
      }
    }
    return [...ids];
  }, [groups]);
  const supplierPlan = useMemo(
    () => confirmSupplier ? planSupplierStockConfirm(groups, confirmSupplier) : { advanceOrderIds: [], pendingOrderIds: [] },
    [confirmSupplier, groups],
  );
  const unconfirmedSupplierGroups = useMemo(
    () => groups.filter((group) => group.kind === 'supplier' && !group.lastConfirmedAt),
    [groups],
  );

  const copyStockText = async (text: string) => {
    if (!await copyText(text)) {
      onNotify?.('复制失败，请手动选择文本复制', 'error');
      return;
    }
    onNotify?.('已复制到剪贴板', 'success');
  };

  const markStocked = async () => {
    if (!orderIds.length) return;
    setMarking(true);
    setConfirmMarkOpen(false);
    let failureCount = 0;
    for (const orderId of orderIds) {
      try {
        await advanceOrderStatus(orderId, 'stock_reported');
      } catch {
        failureCount += 1;
      }
    }
    setMarking(false);
    onNotify?.(failureCount ? `已备货标记完成，${failureCount} 张订单推进失败，请重试` : `已把 ${orderIds.length} 张订单标记为已备货`, failureCount ? 'error' : 'success');
    await load();
  };

  const markSupplierStocked = async () => {
    if (!confirmSupplier) return;
    const supplierTitle = confirmSupplier.title;
    setMarking(true);
    setConfirmSupplier(null);
    try {
      const result = await confirmSupplierStock({
        date: scope === 'all' ? 'all' : scopeParam,
        channel: channel === 'all' ? undefined : channel,
        supplier: supplierTitle,
        note: confirmNote.trim(),
      });
      const parts = [`已确认「${supplierTitle}」：${result.advancedOrderIds.length} 张订单推进到已备货`];
      if (result.pendingOrderIds.length) parts.push(`${result.pendingOrderIds.length} 张订单还涉及其他供应商，暂未推进`);
      if (result.failedOrderIds.length) parts.push(`${result.failedOrderIds.length} 张推进失败，请重试`);
      onNotify?.(parts.join('；'), result.failedOrderIds.length ? 'error' : 'success');
    } catch (error) {
      onNotify?.(errorText(error, '确认备货失败'), 'error');
    } finally {
      setMarking(false);
      setConfirmNote('');
      await load();
    }
  };

  return <div className="page-shell stock-page">
    <div className="stock-page-head">
      <div className="stock-heading-copy">
        <span className="page-breadcrumb">履约 / 备货</span>
        <strong className="page-title">备货工作台</strong>
        <span className="page-subtitle">按供应商生成备货卡片，补齐关联后可分供应商或整页确认备货</span>
      </div>
    </div>
    <section className="table-panel stock-panel">
      <div className="stock-stat-grid">
        <div><span>待备货订单</span><strong>{preparation?.orderCount ?? 0}<small> 单</small></strong></div>
        <div><span>供应商</span><strong>{preparation?.supplierCount ?? 0}<small> 家</small></strong></div>
        <div><span>产品项</span><strong>{preparation?.itemCount ?? 0}<small> 项</small></strong></div>
        <div><span>合计数量</span><strong>{preparation?.totalQuantity ?? 0}</strong></div>
      </div>
      <div className="page-toolbar stock-toolbar">
        <div className="month-control" role="group" aria-label="备货范围">
          <input
            type="date"
            className="toolbar-select"
            aria-label="按下单日期筛选"
            value={scope === 'date' ? date : ''}
            disabled={scope === 'all'}
            onChange={(event) => setDate(event.target.value || todayISO())}
          />
          <button className="button button-secondary month-scope-button" type="button" title={scope === 'date' ? '切换为全部待备货' : '回到按日期'} onClick={() => setScope((value) => (value === 'date' ? 'all' : 'date'))}>
            {scope === 'date' ? <X size={14} /> : <CalendarDays size={14} />}
            {scope === 'date' ? '全部' : '按日期'}
          </button>
        </div>
        <select className="toolbar-select" aria-label="订单渠道筛选" value={channel} onChange={(event) => setChannel(event.target.value as 'all' | import('../../shared/domain').OrderChannel)}><option value="all">全部渠道</option><option value="online">线上订单</option><option value="offline">线下订单</option></select>
        <button className="icon-button" type="button" title="刷新备货表" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /></button>
        <div className="stock-action-row">
          <button className="button button-secondary" type="button" onClick={() => setHistoryOpen(true)}><History size={14} />确认记录</button>
          <button className="button button-secondary" type="button" disabled={!groups.length || !preparation} onClick={() => { if (preparation) void copyStockText(buildCopyAllText(preparation, groups)); }}><Copy size={14} />复制全部</button>
          <button className="button button-primary" type="button" disabled={marking || !orderIds.length} onClick={() => setConfirmMarkOpen(true)}><PackageOpen size={14} />标记已备货</button>
        </div>
      </div>
      {warningGroups.length > 0 && <div className="stock-warning-bar" role="status">
        <TriangleAlert size={15} />
        <span>{warningGroups.map((group) => `${group.title} ${group.items.length} 项`).join('、')}：未关联或未填供应商的产品不会发给对应供应商，请先补全再报备。</span>
      </div>}
      <div className="stock-groups-scroll">
        {loading && <div className="table-state">正在生成备货表...</div>}
        {!loading && !groups.length && <div className="table-state">当前范围没有待备货订单。订单发布后会自动出现在这里。</div>}
        {!loading && groups.length > 0 && <div className="stock-groups-grid">
          {groups.map((group) => <StockGroupCard
            key={`${group.kind}:${group.title}`}
            group={group}
            onCopyGroup={(text) => void copyStockText(text)}
            onLink={(item) => setLinkTarget(item)}
            onConfirmSupplier={(target) => { setConfirmNote(''); setConfirmSupplier(target); }}
            marking={marking}
            systemProductCount={systemProducts.length}
          />)}
        </div>}
      </div>
    </section>

    <Modal open={confirmMarkOpen} title="标记已备货" onClose={() => setConfirmMarkOpen(false)} width={420} compact>
      <div style={{ display: 'grid', gap: 12, fontSize: 13, color: 'var(--color-text)' }}>
        <span>将把当前范围内的 <strong>{orderIds.length}</strong> 张待备货订单推进到「已备货」，订单会离开备货表。确认继续？</span>
        {warningGroups.length > 0 && <span style={{ color: 'var(--color-warning-text)' }}>
          当前还有 {warningGroups.reduce((sum, group) => sum + group.items.length, 0)} 项未关联产品或未填供应商，相关订单可能尚未报给供应商。请确认已线下处理后再继续。
        </span>}
        {unconfirmedSupplierGroups.length > 0 && <span style={{ color: 'var(--color-warning-text)' }}>
          还有 {unconfirmedSupplierGroups.length} 家供应商未单独确认：{unconfirmedSupplierGroups.map((group) => group.title).join('、')}。确认记录只会保留已确认的供应商。
        </span>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="button button-secondary" type="button" disabled={marking} onClick={() => setConfirmMarkOpen(false)}>取消</button>
          <button className="button button-primary" type="button" disabled={marking} onClick={() => void markStocked()}>{marking ? '处理中…' : warningGroups.length > 0 || unconfirmedSupplierGroups.length > 0 ? '仍然标记' : '确认标记'}</button>
        </div>
      </div>
    </Modal>

    <Modal open={Boolean(confirmSupplier)} title="确认备货" onClose={() => setConfirmSupplier(null)} width={460} compact>
      <div style={{ display: 'grid', gap: 12, fontSize: 13, color: 'var(--color-text)' }}>
        <span>确认供应商「<strong>{confirmSupplier?.title}</strong>」的备货已完成？</span>
        <span>将把 <strong>{supplierPlan.advanceOrderIds.length}</strong> 张只涉及该供应商的订单推进到「已备货」，这些订单会离开备货表。</span>
        {supplierPlan.pendingOrderIds.length > 0 && <span style={{ color: 'var(--color-warning-text)' }}>{supplierPlan.pendingOrderIds.length} 张订单还涉及其他供应商，暂不推进；等其余供应商备齐后请点整页「标记已备货」。</span>}
        {supplierPlan.advanceOrderIds.length === 0 && supplierPlan.pendingOrderIds.length > 0 && <span style={{ color: 'var(--color-warning-text)' }}>该供应商名下没有可单独推进的订单，确认后会留下记录。</span>}
        <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          备注（可选）
          <input
            value={confirmNote}
            maxLength={200}
            placeholder="例如：已电话确认，周五到货"
            onChange={(event) => setConfirmNote(event.target.value)}
            style={{ border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: '7px 8px', font: 'inherit', fontSize: 12, background: 'var(--color-surface)' }}
          />
        </label>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>确认后会在「确认记录」里保存操作人、时间和本次备货明细。</span>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="button button-secondary" type="button" disabled={marking} onClick={() => setConfirmSupplier(null)}>取消</button>
          <button className="button button-primary" type="button" disabled={marking || (supplierPlan.advanceOrderIds.length === 0 && supplierPlan.pendingOrderIds.length === 0)} onClick={() => void markSupplierStocked()}>{marking ? '处理中…' : supplierPlan.advanceOrderIds.length ? '确定' : '仅记录确认'}</button>
        </div>
      </div>
    </Modal>

    <LinkSystemProductModal
      target={linkTarget}
      systemProducts={systemProducts}
      onClose={() => setLinkTarget(null)}
      onNotify={onNotify}
      onLinked={async () => {
        setLinkTarget(null);
        await load();
      }}
    />

    <StockConfirmationHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
  </div>;
}

function StockGroupCard({ group, onCopyGroup, onLink, onConfirmSupplier, marking, systemProductCount }: {
  group: StockPreparationGroup;
  onCopyGroup: (text: string) => void;
  onLink: (item: StockPreparationItem) => void;
  onConfirmSupplier: (group: StockPreparationGroup) => void;
  marking: boolean;
  systemProductCount: number;
}) {
  const warning = group.kind !== 'supplier';
  const totalQuantity = group.items.reduce((sum, item) => sum + item.quantity, 0);
  return <section className={`stock-group${warning ? ' stock-group-warning' : ''}`}>
    <div className="stock-group-head">
      <strong className="stock-group-title">{group.title}</strong>
      <span className="stock-group-count">{group.items.length} 项 · {totalQuantity} 件</span>
      {warning && <span className="stock-group-hint">{group.kind === 'unlinked' ? '未关联系统产品' : '系统产品未填供应商'}</span>}
      {group.lastConfirmedAt && <span
        className="stock-group-confirmed"
        title={`${group.lastConfirmedBy || '未知操作人'} 于 ${group.lastConfirmedAt.replace('T', ' ').slice(0, 16)} 确认${group.lastConfirmedOrderCount ? `（${group.lastConfirmedOrderCount} 张订单）` : ''}`}
      >
        已确认 · {group.lastConfirmedAt.replace('T', ' ').slice(5, 16)}{group.lastConfirmedBy ? ` · ${group.lastConfirmedBy}` : ''}
      </span>}
      <div className="row-actions">
        {group.kind === 'supplier' && <button className="button button-secondary button-sm stock-confirm-button" type="button" disabled={marking} onClick={() => onConfirmSupplier(group)}>确认备货</button>}
        <button className="icon-button" type="button" title="复制备货明细" onClick={() => onCopyGroup(groupCopyText(group))}><Copy size={14} /></button>
      </div>
    </div>
    <div className="stock-group-items">
      {group.items.map((item, index) => <div className="stock-item" key={`${item.systemProductId ?? item.customerProductId ?? item.displayName}-${index}`}>
        <div className="stock-item-main">
          <span className="stock-item-display">{item.displayName}</span>
          <span className="stock-item-spec">（{item.specs.length
            ? item.specs.map((spec, specIndex) => <Fragment key={`${spec.specification}-${specIndex}`}>{specIndex > 0 ? '，' : ''}{spec.specification ? `${spec.specification} × ` : '× '}<strong className="stock-item-quantity">{spec.quantity}</strong></Fragment>)
            : <>× <strong className="stock-item-quantity">{item.quantity}</strong></>}）</span>
        </div>
        {group.kind === 'unlinked' && <button className="button button-ghost stock-item-link" type="button"
          disabled={!systemProductCount || item.customerProductId == null}
          title={item.customerProductId == null
            ? '该明细未挂客户产品，请编辑订单选择客户产品后再来关联'
            : systemProductCount ? '关联系统产品并填写报供名称' : '产品库为空，请先添加系统产品'}
          onClick={() => onLink(item)}
        ><Link2 size={13} />关联产品</button>}
      </div>)}
    </div>
  </section>;
}

function LinkSystemProductModal({ target, systemProducts, onClose, onLinked, onNotify }: {
  target: StockPreparationItem | null;
  systemProducts: ProductRecord[];
  onClose: () => void;
  onLinked: () => Promise<void> | void;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setQuery('');
    setSelectedId(null);
    setSupplierName(target.displayName);
    setBusy(false);
  }, [target]);

  const selectable = useMemo(() => systemProducts.filter((item) => item.status !== 'draft'), [systemProducts]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return selectable;
    return selectable.filter((item) => [item.name, item.specification, item.sku, item.supplier, String(item.id)].join(' ').toLowerCase().includes(needle));
  }, [query, selectable]);
  const selected = useMemo(() => selectable.find((item) => Number(item.id) === selectedId), [selectedId, selectable]);

  const submit = async () => {
    if (!target?.customerProductId || !selected) return;
    setBusy(true);
    try {
      await linkCustomerProductToSystem(target.customerProductId, Number(selected.id), supplierName.trim());
      onNotify?.(`已关联「${selected.name || '系统产品'}」`, 'success');
      await onLinked();
    } catch (error) {
      setBusy(false);
      onNotify?.(errorText(error, '关联失败'), 'error');
    }
  };

  return <Modal open={Boolean(target)} title="关联系统产品" onClose={busy ? () => undefined : onClose} width={560}>
    {target && <div style={{ display: 'grid', gap: 11 }}>
      <div style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>订单明细：<strong>{target.displayName}</strong>{target.quantity ? `*${target.quantity}` : ''}</div>
      <label style={{ display: 'grid', gap: 5, color: 'var(--color-text-secondary)', fontSize: 12 }}>搜索系统产品
        <span style={{ position: 'relative', display: 'block' }}>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(null); }} placeholder="输入品名、规格、SKU或供应商搜索" style={{ width: '100%', border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: query ? '8px 28px 8px 9px' : '8px 9px', font: 'inherit', fontSize: 12 }} />
          {!!query && <button type="button" aria-label="清空搜索" title="清空" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(''); setSelectedId(null); }} style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, border: 0, borderRadius: '50%', padding: 0, color: 'var(--color-text-muted)', background: 'transparent', cursor: 'pointer' }}><X size={13} /></button>}
        </span>
      </label>
      <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)' }}>
        {filtered.map((item) => <button
          key={item.id}
          type="button"
          onClick={() => {
            setSelectedId(Number(item.id));
            setSupplierName(item.name || supplierName);
          }}
          disabled={busy}
          style={{ display: 'block', width: '100%', padding: '8px 10px', border: 0, borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)', background: Number(item.id) === selectedId ? 'var(--color-accent-soft)' : 'var(--color-surface)', cursor: 'pointer', textAlign: 'left' }}
        >
          <SystemProductOptionRow product={item} />
        </button>)}
        {!filtered.length && <div style={{ padding: 12, color: 'var(--color-text-muted)', textAlign: 'center', fontSize: 12 }}>没有匹配的系统产品</div>}
      </div>
      <label style={{ display: 'grid', gap: 5, color: 'var(--color-text-secondary)', fontSize: 12 }}>供应商产品名称
        <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="报给供应商的名称，留空则按系统产品名报供" style={{ width: '100%', border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: '8px 9px', font: 'inherit', fontSize: 12 }} />
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="button button-primary" type="button" disabled={busy || !selected} onClick={() => void submit()}>{busy ? '保存中…' : '保存关联'}</button>
      </div>
    </div>}
  </Modal>;
}
