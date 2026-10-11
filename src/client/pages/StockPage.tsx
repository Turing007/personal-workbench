import { CalendarDays, ChevronDown, ChevronRight, Copy, Download, Link2, PackageOpen, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  advanceOrderStatus,
  exportStockPreparation,
  getStockPreparation,
  linkCustomerProductToSystem,
} from '../api';
import { errorText } from '../components/finance/finance-format';
import { copyText } from '../copy-text';
import { saveFileOrDownload } from '../file-save';
import Modal from '../components/Modal';
import SystemProductOptionRow from '../components/SystemProductOptionRow';
import type { ProductRecord } from '../components/ProductEditor';
import {
  formatStockItemLine,
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

function itemKey(group: StockPreparationGroup, item: StockPreparationItem): string {
  return `${group.kind}:${group.title}:${item.systemProductId ?? `cp${item.customerProductId}`}`;
}

/** 复制文本：首行日期，其后每个供应商一段，明细行与备货表一致。 */
function buildCopyText(preparation: StockPreparation, groups: StockPreparationGroup[]): string {
  const blocks = groups.map((group) => `【${group.title}】\n${group.items.map(formatStockItemLine).join('\n')}`);
  return [scopeTitle(preparation.scope), ...blocks].filter(Boolean).join('\n');
}

export default function StockPage({ onNotify, systemProducts = [] }: StockPageProps) {
  const [scope, setScope] = useState<'date' | 'all'>('date');
  const [date, setDate] = useState(todayISO);
  const [preparation, setPreparation] = useState<StockPreparation>();
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [confirmMarkOpen, setConfirmMarkOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<StockPreparationItem | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const scopeParam = scope === 'all' ? 'all' : (date || todayISO());
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPreparation(await getStockPreparation(scopeParam));
      setExpandedKeys(new Set());
    } catch (error) {
      onNotify?.(errorText(error, '备货表加载失败'), 'error');
    } finally {
      setLoading(false);
    }
  }, [scopeParam, onNotify]);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => preparation?.groups ?? [], [preparation]);
  const warningGroups = useMemo(() => groups.filter((group) => group.kind !== 'supplier'), [groups]);
  const orderIds = useMemo(() => {
    const ids = new Set<number>();
    for (const group of groups) {
      for (const item of group.items) {
        for (const source of item.sources) ids.add(source.orderId);
      }
    }
    return [...ids];
  }, [groups]);

  const copyStockText = async (text: string) => {
    if (!await copyText(text)) {
      onNotify?.('复制失败，请手动选择文本复制', 'error');
      return;
    }
    onNotify?.('已复制到剪贴板', 'success');
  };

  const exportExcel = async () => {
    try {
      const blob = await exportStockPreparation(scopeParam);
      // App 壳里由原生写进手机「下载」并弹分享；浏览器里回退 blob 链接下载。
      await saveFileOrDownload(blob, `备货表-${scopeParam === 'all' ? '全部待备货' : scopeParam}.xlsx`);
    } catch (error) {
      onNotify?.(errorText(error, '备货表导出失败'), 'error');
    }
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

  const toggleExpanded = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return <div className="page-shell stock-page">
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
      <button className="icon-button" type="button" title="刷新备货表" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /></button>
      <div className="stock-action-row">
        <button className="button button-secondary" type="button" disabled={loading || !groups.length} onClick={() => void exportExcel()}><Download size={14} />导出 Excel</button>
        <button className="button button-secondary" type="button" disabled={!groups.length || !preparation} onClick={() => { if (preparation) void copyStockText(buildCopyText(preparation, groups)); }}><Copy size={14} />复制全部</button>
        <button className="button button-primary" type="button" disabled={marking || !orderIds.length} onClick={() => setConfirmMarkOpen(true)}><PackageOpen size={14} />标记已备货</button>
      </div>
    </div>
    <div className="stock-stat-grid">
      <div><span>待备货订单</span><strong>{preparation?.orderCount ?? 0}<small> 单</small></strong></div>
      <div><span>供应商</span><strong>{preparation?.supplierCount ?? 0}<small> 家</small></strong></div>
      <div><span>产品项</span><strong>{preparation?.itemCount ?? 0}<small> 项</small></strong></div>
      <div><span>合计数量</span><strong>{preparation?.totalQuantity ?? 0}</strong></div>
    </div>
    {warningGroups.length > 0 && <div className="stock-warning-bar" role="status">
      <TriangleAlert size={15} />
      <span>{warningGroups.map((group) => `${group.title} ${group.items.length} 项`).join('、')}：未关联或未填供应商的产品不会发给对应供应商，请先补全再报备。</span>
    </div>}
    {loading && <div className="table-state">正在生成备货表...</div>}
    {!loading && !groups.length && <section className="table-panel"><div className="table-state">当前范围没有待备货订单。订单发布后会自动出现在这里。</div></section>}
    {!loading && groups.map((group) => <StockGroupCard
      key={`${group.kind}:${group.title}`}
      group={group}
      expandedKeys={expandedKeys}
      onToggleExpanded={toggleExpanded}
      onCopyGroup={(text) => void copyStockText(text)}
      onLink={(item) => setLinkTarget(item)}
      systemProductCount={systemProducts.length}
    />)}

    <Modal open={confirmMarkOpen} title="标记已备货" onClose={() => setConfirmMarkOpen(false)} width={420}>
      <div style={{ display: 'grid', gap: 12, fontSize: 13, color: '#334155' }}>
        <span>将把当前范围内的 <strong>{orderIds.length}</strong> 张待备货订单推进到「已备货」，订单会离开备货表。确认继续？</span>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="button button-secondary" type="button" disabled={marking} onClick={() => setConfirmMarkOpen(false)}>取消</button>
          <button className="button button-primary" type="button" disabled={marking} onClick={() => void markStocked()}>{marking ? '处理中…' : '确认标记'}</button>
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
  </div>;
}

function StockGroupCard({ group, expandedKeys, onToggleExpanded, onCopyGroup, onLink, systemProductCount }: {
  group: StockPreparationGroup;
  expandedKeys: Set<string>;
  onToggleExpanded: (key: string) => void;
  onCopyGroup: (text: string) => void;
  onLink: (item: StockPreparationItem) => void;
  systemProductCount: number;
}) {
  const warning = group.kind !== 'supplier';
  return <section className={`table-panel stock-group${warning ? ' stock-group-warning' : ''}`}>
    <div className="stock-group-head">
      <strong className="stock-group-title">{group.title}</strong>
      <span className="badge badge-neutral">{group.items.length} 项 / {group.items.reduce((sum, item) => sum + item.quantity, 0)} 件</span>
      <div className="row-actions">
        {warning && <span className="stock-group-hint">{group.kind === 'unlinked' ? '未关联系统产品' : '系统产品未填供应商'}</span>}
        <button className="icon-button" type="button" title="复制该供应商备货明细" onClick={() => onCopyGroup(`【${group.title}】\n${group.items.map(formatStockItemLine).join('\n')}`)}><Copy size={14} /></button>
      </div>
    </div>
    <div className="table-scroll">
      <table className="data-table stock-table">
        <tbody>
          {group.items.map((item) => {
            const key = itemKey(group, item);
            const expanded = expandedKeys.has(key);
            return <Fragment key={key}>
              <tr className={warning ? 'stock-row-warning' : undefined}>
                <td className="stock-item-name">
                  {item.sources.length > 1 && <button className="icon-button" type="button" title={expanded ? '收起订单构成' : '展开订单构成'} onClick={() => onToggleExpanded(key)}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>}
                  <span className="stock-item-display">{item.displayName}</span>
                  <strong className="stock-item-quantity">*{item.quantity}</strong>
                  {item.remarks.map((remark) => <span key={remark} className="stock-item-remark">{remark}</span>)}
                </td>
                <td className="stock-item-actions">
                  {group.kind === 'unlinked' && <button className="button button-ghost" type="button"
                    disabled={!systemProductCount || item.customerProductId == null}
                    title={item.customerProductId == null
                      ? '该明细未挂客户产品，请编辑订单选择客户产品后再来关联'
                      : systemProductCount ? '关联系统产品并填写报供名称' : '产品库为空，请先添加系统产品'}
                    onClick={() => onLink(item)}
                  ><Link2 size={13} />关联产品</button>}
                </td>
              </tr>
              {expanded && item.sources.map((source) => <tr key={`${key}:${source.orderId}`} className="stock-source-row">
                <td colSpan={2}>{source.orderNo} · {source.customerName || '未填客户'} · 数量 {source.quantity}{source.remark ? ` · ${source.remark}` : ''}</td>
              </tr>)}
            </Fragment>;
          })}
        </tbody>
      </table>
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
      <div style={{ color: '#475569', fontSize: 12 }}>订单明细：<strong>{target.displayName}</strong>{target.quantity ? `*${target.quantity}` : ''}</div>
      <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>搜索系统产品
        <span style={{ position: 'relative', display: 'block' }}>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(null); }} placeholder="输入品名、规格、SKU或供应商搜索" style={{ width: '100%', border: '1px solid #dbe3ea', borderRadius: 5, padding: query ? '8px 28px 8px 9px' : '8px 9px', font: 'inherit', fontSize: 12 }} />
          {!!query && <button type="button" aria-label="清空搜索" title="清空" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(''); setSelectedId(null); }} style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, border: 0, borderRadius: '50%', padding: 0, color: '#94a3b8', background: 'transparent', cursor: 'pointer' }}><X size={13} /></button>}
        </span>
      </label>
      <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
        {filtered.map((item) => <button
          key={item.id}
          type="button"
          onClick={() => {
            setSelectedId(Number(item.id));
            setSupplierName(item.name || supplierName);
          }}
          disabled={busy}
          style={{ display: 'block', width: '100%', padding: '8px 10px', border: 0, borderBottom: '1px solid #edf0f2', color: '#334155', background: Number(item.id) === selectedId ? '#f0fdfa' : '#fff', cursor: 'pointer', textAlign: 'left' }}
        >
          <SystemProductOptionRow product={item} />
        </button>)}
        {!filtered.length && <div style={{ padding: 12, color: '#94a3b8', textAlign: 'center', fontSize: 12 }}>没有匹配的系统产品</div>}
      </div>
      <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>供应商产品名称
        <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="报给供应商的名称，留空则按系统产品名报供" style={{ width: '100%', border: '1px solid #dbe3ea', borderRadius: 5, padding: '8px 9px', font: 'inherit', fontSize: 12 }} />
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="button button-primary" type="button" disabled={busy || !selected} onClick={() => void submit()}>{busy ? '保存中…' : '保存关联'}</button>
      </div>
    </div>}
  </Modal>;
}
