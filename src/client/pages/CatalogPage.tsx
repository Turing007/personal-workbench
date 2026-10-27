import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, ExternalLink, FileDown, FileText, Images, Image as ImageIcon, Pencil, Plus, Power, Trash2, Upload } from 'lucide-react';
import SearchInput from '../components/SearchInput';
import Modal from '../components/Modal';
import SupplierCatalogEditorModal, { formatFileSize } from '../components/SupplierCatalogEditorModal';
import {
  createCatalog,
  deleteSupplierCatalog,
  deleteSupplierCatalogFile,
  generateProductCatalog,
  getCatalog,
  listCatalogs,
  listSupplierCatalogs,
  updateCatalog,
  type CatalogSummary,
  type SupplierCatalog,
  type SupplierCatalogFile,
} from '../api';
import { thumbUrl } from '../image-urls';
import { CATALOG_DENSITY_OPTIONS, DEFAULT_CATALOG_DENSITY, type CatalogDensity } from '../../shared/product-catalog';
import { compareProductByName } from '../product-sort';
import { saveFileOrDownload } from '../file-save';
import { normalizeProductStatus, type ProductStatus } from '../../shared/product-status';
import type { ProductRecord } from '../components/ProductEditor';

const CATEGORY_UNCATEGORIZED = '__uncategorized__';

/** 选品结果筛选：全部 / 只看已选 / 只看未选。未选档用来找出「还没勾的产品」，补选时不必翻整个列表。 */
type PickFilter = 'all' | 'selected' | 'unselected';

const PICK_FILTER_LABELS: Record<PickFilter, string> = { all: '全部', selected: '已选', unselected: '未选' };

const STATUS_LABELS: Record<ProductStatus, string> = { active: '在售', draft: '草稿', discontinued: '停售' };

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatViewedAt(value: string | null): string {
  if (!value) return '还没人打开过';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `最近打开 ${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface CatalogPageProps {
  products: ProductRecord[];
  loading?: boolean;
  onNotify: (message: string, kind?: 'info' | 'success' | 'error') => void;
}

export default function CatalogPage({ products, loading: productsLoading, onNotify }: CatalogPageProps) {
  const [catalogs, setCatalogs] = useState<CatalogSummary[] | null>(null);
  const [view, setView] = useState<'list' | 'edit'>('list');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [markup, setMarkup] = useState('20');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [pickFilter, setPickFilter] = useState<PickFilter>('all');
  const [tab, setTab] = useState<'mine' | 'supplier'>('mine');
  const [supplierCatalogs, setSupplierCatalogs] = useState<SupplierCatalog[] | null>(null);
  const [supplierQuery, setSupplierQuery] = useState('');
  /** undefined = 未打开；null = 新建；对象 = 编辑已有记录。 */
  const [supplierEditor, setSupplierEditor] = useState<SupplierCatalog | null | undefined>(undefined);
  const [supplierBusy, setSupplierBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [exportTarget, setExportTarget] = useState<CatalogSummary | null>(null);
  const [exportDensity, setExportDensity] = useState<CatalogDensity>(DEFAULT_CATALOG_DENSITY);
  const [exportCover, setExportCover] = useState(true);

  const refresh = async () => {
    try {
      setCatalogs(await listCatalogs());
    } catch (error) {
      onNotify(errorText(error, '图册列表加载失败'), 'error');
      setCatalogs([]);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSupplierCatalogs = async () => {
    try {
      setSupplierCatalogs(await listSupplierCatalogs());
    } catch (error) {
      onNotify(errorText(error, '供应商图册加载失败'), 'error');
      setSupplierCatalogs([]);
    }
  };

  // 供应商图册按需加载：没切到该页签就不请求。
  useEffect(() => {
    if (tab === 'supplier' && supplierCatalogs === null) void refreshSupplierCatalogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, supplierCatalogs]);

  const filteredSupplierCatalogs = useMemo(() => {
    const needle = supplierQuery.trim().toLowerCase();
    if (!needle) return supplierCatalogs ?? [];
    return (supplierCatalogs ?? []).filter((catalog) => [catalog.supplier, catalog.name, catalog.remark, ...catalog.files.map((file) => file.originalName)].join(' ').toLowerCase().includes(needle));
  }, [supplierCatalogs, supplierQuery]);

  const deleteSupplierFile = async (catalog: SupplierCatalog, file: SupplierCatalogFile) => {
    if (!window.confirm(`确定从「${catalog.name}」删除文件「${file.originalName}」吗？文件会一并删除，不能恢复。`)) return;
    setSupplierBusy(true);
    try {
      await deleteSupplierCatalogFile(catalog.id, file.id);
      await refreshSupplierCatalogs();
      onNotify('图册文件已删除', 'success');
    } catch (error) {
      onNotify(errorText(error, '文件删除失败'), 'error');
    } finally {
      setSupplierBusy(false);
    }
  };

  const deleteSupplier = async (catalog: SupplierCatalog) => {
    if (!window.confirm(`确定删除供应商图册「${catalog.name}」吗？记录和全部 ${catalog.files.length} 个文件都会删除，不能恢复。`)) return;
    setSupplierBusy(true);
    try {
      await deleteSupplierCatalog(catalog.id);
      await refreshSupplierCatalogs();
      onNotify('供应商图册已删除', 'success');
    } catch (error) {
      onNotify(errorText(error, '删除失败'), 'error');
    } finally {
      setSupplierBusy(false);
    }
  };

  const publicUrl = (catalog: CatalogSummary) => `${window.location.origin}/c/${catalog.token}`;

  const copyLink = async (catalog: CatalogSummary) => {
    const url = publicUrl(catalog);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // 手机经 http 局域网访问时没有剪贴板 API，退回老办法。
      try {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      } catch {
        onNotify('复制失败，请长按链接手动复制', 'error');
        return;
      }
    }
    setCopiedId(catalog.id);
    window.setTimeout(() => setCopiedId((current) => (current === catalog.id ? null : current)), 2000);
  };

  const toggleEnabled = async (catalog: CatalogSummary) => {
    setBusy(true);
    try {
      await updateCatalog(catalog.id, { enabled: !catalog.enabled });
      onNotify(catalog.enabled ? '已停用，链接立即失效' : '已启用，链接恢复可访问', 'success');
      await refresh();
    } catch (error) {
      onNotify(errorText(error, '操作失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openEditor = async (catalog?: CatalogSummary) => {
    setBusy(true);
    try {
      if (catalog) {
        const detail = await getCatalog(catalog.id);
        setEditingId(catalog.id);
        setName(detail.name);
        setMarkup(String(detail.markupPercent ?? 0));
        setSelectedIds(new Set(detail.productIds.map(String)));
      } else {
        setEditingId(null);
        setName('');
        setMarkup('20');
        setSelectedIds(new Set());
      }
      setQuery('');
      setStatusFilter('active');
      setCategoryFilter('all');
      setPickFilter('all');
      setView('edit');
    } catch (error) {
      onNotify(errorText(error, '图册读取失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let uncategorized = 0;
    for (const product of products) {
      const category = product.category?.trim();
      if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
      else uncategorized += 1;
    }
    const named = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([category]) => category);
    return { named, hasUncategorized: uncategorized > 0 };
  }, [products]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products
      .filter((product) => {
        // 三档互斥：先按勾选状态过一道，再叠状态/分类/搜索词。
        const picked = selectedIds.has(String(product.id));
        if (pickFilter === 'selected' && !picked) return false;
        if (pickFilter === 'unselected' && picked) return false;
        if (statusFilter !== 'all' && normalizeProductStatus(product.status) !== statusFilter) return false;
        const category = product.category?.trim() ?? '';
        if (categoryFilter === CATEGORY_UNCATEGORIZED) {
          if (category) return false;
        } else if (categoryFilter !== 'all' && category !== categoryFilter) {
          return false;
        }
        if (!needle) return true;
        return [product.name, product.sku, product.supplier, product.category].join(' ').toLowerCase().includes(needle);
      })
      .sort(compareProductByName);
  }, [products, query, statusFilter, categoryFilter, pickFilter, selectedIds]);

  // 三档各自的数量：按除勾选状态以外的条件算，这样「已选 5 / 未选 25」不会因为当前在哪一档而变。
  const pickCounts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let selected = 0;
    let unselected = 0;
    for (const product of products) {
      if (statusFilter !== 'all' && normalizeProductStatus(product.status) !== statusFilter) continue;
      const category = product.category?.trim() ?? '';
      if (categoryFilter === CATEGORY_UNCATEGORIZED) {
        if (category) continue;
      } else if (categoryFilter !== 'all' && category !== categoryFilter) {
        continue;
      }
      if (needle && ![product.name, product.sku, product.supplier, product.category].join(' ').toLowerCase().includes(needle)) continue;
      if (selectedIds.has(String(product.id))) selected += 1;
      else unselected += 1;
    }
    return { all: selected + unselected, selected, unselected };
  }, [products, query, statusFilter, categoryFilter, selectedIds]);

  const toggleProduct = (product: ProductRecord) => {
    const key = String(product.id);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { onNotify('请填写图册名称', 'error'); return; }
    if (!selectedIds.size) { onNotify('请至少选择一个产品', 'error'); return; }
    setBusy(true);
    try {
      const productIds = [...selectedIds].map(Number);
      const markupPercent = Math.max(0, Math.min(1000, Number(markup) || 0));
      if (editingId == null) {
        await createCatalog({ name: trimmed, productIds, markupPercent });
        onNotify('图册已创建，链接已生成', 'success');
      } else {
        await updateCatalog(editingId, { name: trimmed, productIds, markupPercent });
        onNotify('已保存，链接内容立即更新', 'success');
      }
      await refresh();
      setView('list');
    } catch (error) {
      onNotify(errorText(error, '保存失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const runExport = async () => {
    if (!exportTarget) return;
    setBusy(true);
    try {
      const detail = await getCatalog(exportTarget.id);
      const blob = await generateProductCatalog(detail.productIds, exportDensity, exportCover);
      // App 壳里由原生写进手机「下载」并弹分享；浏览器里回退 blob 链接下载。
      await saveFileOrDownload(blob, `产品图册-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.pdf`);
      setExportTarget(null);
      onNotify('产品图册已生成', 'success');
    } catch (error) {
      onNotify(errorText(error, '图册生成失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (view === 'edit') {
    return <div className="page-shell catalog-page catalog-edit-page">
      <div className="page-toolbar">
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => setView('list')}><ArrowLeft size={15} />返回图册列表</button>
        <strong>{editingId == null ? '新建图册' : '选品编辑'}</strong>
      </div>
      <section className="table-panel catalog-edit-panel">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
          <label className="label" style={{ flex: '1 1 280px', maxWidth: 420 }}>图册名称
            <input className="input" disabled={busy} value={name} maxLength={40} placeholder="如：2026 主推图册 / 给王总的报价图册" onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="label" style={{ flex: '0 1 170px' }}>毛利率 %
            <input className="input" type="number" min={0} max={1000} step={0.1} aria-label="图册毛利率" disabled={busy} value={markup} onChange={(event) => setMarkup(event.target.value)} />
          </label>
        </div>
        <p className="label-hint" style={{ margin: 0 }}>图册报价 = 成本 ×（1 + 毛利率），人民币向上取整；成本含默认采购价、第一条包装与一个充电器，不含税运。填 0 或留空时不显示价格按钮；有毛利率但产品缺少采购价/电池价时显示「询价」。</p>
        <div className="page-toolbar table-toolbar" style={{ padding: 0 }}>
          <SearchInput value={query} onChange={setQuery} placeholder="搜品名、SKU、供应商、分类" />
          <select className="toolbar-select" aria-label="图册选品状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'active' | 'all')}>
            <option value="active">只看在售</option>
            <option value="all">全部（含停售与草稿）</option>
          </select>
          <select className="toolbar-select" aria-label="图册选品分类筛选" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">全部分类</option>
            {categoryOptions.named.map((category) => <option key={category} value={category}>{category}</option>)}
            {categoryOptions.hasUncategorized && <option value={CATEGORY_UNCATEGORIZED}>未分类</option>}
          </select>
          {/* 三档互斥切换：带数量，切档时不必再去看下面的统计才知道还剩多少没选。 */}
          <div className="pick-filter-group" role="group" aria-label="图册选品勾选状态筛选">
            {(['all', 'selected', 'unselected'] as const).map((option) => <button
              key={option}
              className={`pick-filter-button${pickFilter === option ? ' is-active' : ''}`}
              type="button"
              aria-pressed={pickFilter === option}
              onClick={() => setPickFilter(option)}
            >{PICK_FILTER_LABELS[option]} {pickCounts[option]}</button>)}
          </div>
          <span className="toolbar-count">共 {pickCounts.all} 个 · 已选 {pickCounts.selected} 个 · 未选 {pickCounts.unselected} 个</span>
          <button className="button button-secondary button-sm" type="button" onClick={() => setSelectedIds((current) => { const next = new Set(current); for (const product of filtered) next.add(String(product.id)); return next; })} disabled={!pickCounts.unselected} title="把当前筛选结果里还没勾的产品全部勾上">全选当前结果</button>
          <button className="button button-secondary button-sm" type="button" onClick={() => setSelectedIds(new Set())} disabled={!selectedIds.size}>清空选择</button>
        </div>
        <div className="catalog-pick-grid">
          {productsLoading && <div className="table-state">正在加载产品…</div>}
          {!productsLoading && !filtered.length && <div className="table-state">
            {pickFilter === 'selected'
              ? (selectedIds.size ? '当前筛选下没有已选产品，清空搜索或切到「全部」再看看' : '还没有选择产品')
              : pickFilter === 'unselected'
                ? '当前筛选下没有未选产品，都已经勾上了'
                : '没有符合条件的产品'}
          </div>}
          {filtered.map((product) => {
            const key = String(product.id);
            const status = normalizeProductStatus(product.status);
            const image = product.images[0];
            const category = product.category?.trim() || '未分类';
            const checked = selectedIds.has(key);
            return <label key={key} className={`catalog-pick-card${checked ? ' is-selected' : ''}`}>
              <span className="catalog-pick-check"><input type="checkbox" checked={checked} onChange={() => toggleProduct(product)} aria-label={`选择 ${product.name}`} /></span>
              <span className="catalog-pick-image">
                {image
                  ? <img src={thumbUrl(image.url, 480)} alt="" loading="lazy" decoding="async" />
                  : <span className="catalog-pick-placeholder"><ImageIcon size={24} /><em>无图</em></span>}
                {status !== 'active' && <span className={`catalog-pick-status badge ${status === 'draft' ? 'badge-warning' : 'badge-neutral'}`}>{STATUS_LABELS[status]}</span>}
              </span>
              <strong className="catalog-pick-name">{product.name}</strong>
              <span className="catalog-pick-meta">{[product.sku, category].filter(Boolean).join(' · ')}</span>
            </label>;
          })}
        </div>
      </section>
      <div className="page-toolbar" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--tone-text-faint)' }}>保存后链接内容立即更新，不用重新发链接。</span>
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => setView('list')}>取消</button>
        <button className="button button-primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : `保存（${selectedIds.size} 个产品）`}</button>
      </div>
    </div>;
  }

  return <div className="page-shell catalog-page" style={{ gap: 12, minHeight: '100%' }}>
    <div className="page-toolbar">
      <strong className="page-title">产品图册</strong>
      <span className="page-subtitle" style={{ flex: 1 }}>{tab === 'mine' ? '选好产品生成一条网址发给客户；改内容不用换链接' : '按供应商归档供应商发来的 PDF / 图片，只给自己看'}</span>
      {tab === 'mine'
        ? <button className="button button-primary" type="button" disabled={busy} onClick={() => void openEditor()}><Plus size={15} />新建图册</button>
        : <button className="button button-primary" type="button" onClick={() => setSupplierEditor(null)}><Upload size={15} />上传供应商图册</button>}
    </div>
    <div className="catalog-tabs" role="tablist" aria-label="图册类型">
      <button className={`catalog-tab${tab === 'mine' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>我的图册 <span>{catalogs?.length ?? 0}</span></button>
      <button className={`catalog-tab${tab === 'supplier' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={tab === 'supplier'} onClick={() => setTab('supplier')}>供应商图册 <span>{supplierCatalogs?.length ?? '—'}</span></button>
    </div>
    {tab === 'mine' ? <section className="table-panel" style={{ padding: 12, display: 'grid', gap: 10 }}>
      {catalogs === null && <div className="table-state">正在加载图册…</div>}
      {catalogs?.length === 0 && <div className="table-state">还没有图册：点右上角「新建图册」，选好产品就能生成一条链接。</div>}
      {catalogs?.map((catalog) => <article key={catalog.id} style={{ border: '1px solid var(--tone-border-soft)', borderRadius: 8, padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>{catalog.name}</strong>
          <span className={catalog.enabled ? 'badge badge-success' : 'badge badge-neutral'}>{catalog.enabled ? '在用' : '已停用'}</span>
          <span className="badge badge-neutral">{catalog.itemCount} 个产品</span>
          <span className={catalog.markupPercent > 0 ? 'badge badge-success' : 'badge badge-neutral'}>{catalog.markupPercent > 0 ? `毛利率 ${catalog.markupPercent}%` : '未报价'}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--tone-text-faint)' }}>打开 {catalog.viewCount} 次 · {formatViewedAt(catalog.lastViewedAt)}</span>
        </div>
        <code style={{ fontSize: 12, color: 'var(--tone-accent-text)', overflowWrap: 'anywhere', background: 'var(--tone-surface-frost)', border: '1px solid var(--tone-border-soft)', borderRadius: 5, padding: '5px 8px' }}>{publicUrl(catalog)}</code>
        <div className="row-actions" style={{ flexWrap: 'wrap' }}>
          <button className="button button-secondary button-sm" type="button" onClick={() => void copyLink(catalog)}>{copiedId === catalog.id ? <><Check size={14} />已复制</> : <><Copy size={14} />复制链接</>}</button>
          <button className="button button-secondary button-sm" type="button" onClick={() => window.open(publicUrl(catalog), '_blank', 'noopener')}><ExternalLink size={14} />预览</button>
          <button className="button button-secondary button-sm" type="button" disabled={busy} onClick={() => void openEditor(catalog)}><Images size={14} />选品编辑</button>
          <button className="button button-secondary button-sm" type="button" disabled={busy} onClick={() => setExportTarget(catalog)}><FileDown size={14} />导出 PDF</button>
          <button className="button button-secondary button-sm" type="button" disabled={busy} onClick={() => void toggleEnabled(catalog)}><Power size={14} />{catalog.enabled ? '停用' : '启用'}</button>
        </div>
      </article>)}
    </section> : <section className="table-panel supplier-catalog-panel" style={{ padding: 12, display: 'grid', gap: 10 }}>
      <div className="page-toolbar table-toolbar" style={{ padding: 0 }}>
        <SearchInput value={supplierQuery} onChange={setSupplierQuery} placeholder="搜供应商、图册名、文件名" />
        <span className="toolbar-count">共 {filteredSupplierCatalogs.length} 条 · {filteredSupplierCatalogs.reduce((sum, catalog) => sum + catalog.files.length, 0)} 个文件</span>
      </div>
      {supplierCatalogs === null && <div className="table-state">正在加载供应商图册…</div>}
      {supplierCatalogs !== null && !filteredSupplierCatalogs.length && <div className="table-state">
        {supplierQuery.trim() ? '没有符合条件的供应商图册' : '还没有供应商图册：点右上角「上传供应商图册」，把供应商发来的 PDF / 图片存进来。'}
      </div>}
      <div className="supplier-catalog-grid">
          {filteredSupplierCatalogs.map((catalog) => {
          const totalSize = catalog.files.reduce((sum, file) => sum + file.size, 0);
          return <article className="supplier-catalog-card" key={catalog.id}>
            <div className="supplier-catalog-card-head">
              <span className="badge badge-neutral supplier-catalog-supplier">{catalog.supplier}</span>
              <strong className="supplier-catalog-card-name" title={catalog.name}>{catalog.name}</strong>
            </div>
            <div className="supplier-catalog-card-meta">
              <span>{catalog.receivedAt}</span>
              <span aria-hidden="true">·</span>
              <span>{formatFileSize(totalSize)}</span>
              <div className="row-actions">
                <button className="button button-secondary button-sm" type="button" disabled={supplierBusy} onClick={() => setSupplierEditor(catalog)}><Pencil size={14} />编辑</button>
                <button className="button button-danger button-sm" type="button" disabled={supplierBusy} onClick={() => void deleteSupplier(catalog)}><Trash2 size={14} />删除</button>
              </div>
            </div>
            {!!catalog.remark && <p className="supplier-catalog-remark-text">{catalog.remark}</p>}
            {catalog.files.length ? <div className="supplier-catalog-card-files">
              {catalog.files.map((file) => <div className="supplier-catalog-file-row" key={file.id}>
                <span className="supplier-catalog-file-icon">{file.mimeType === 'application/pdf' ? <FileText size={16} /> : <ImageIcon size={16} />}</span>
                <span className="supplier-catalog-file-name" title={file.originalName}>{file.originalName}</span>
                <span className="supplier-catalog-file-meta">{formatFileSize(file.size)}</span>
                <a className="icon-button" href={file.url} target="_blank" rel="noreferrer" title="打开文件" aria-label={`打开 ${file.originalName}`}><ExternalLink size={14} /></a>
                <a className="icon-button" href={file.url} download={file.originalName} title="下载文件" aria-label={`下载 ${file.originalName}`}><Download size={14} /></a>
                <button className="icon-button danger" type="button" disabled={supplierBusy} title="删除文件" aria-label={`删除 ${file.originalName}`} onClick={() => void deleteSupplierFile(catalog, file)}><Trash2 size={14} /></button>
              </div>)}
            </div> : <div className="empty-state">这条图册还没有文件。</div>}
          </article>;
        })}
      </div>
    </section>}
    <Modal
      open={Boolean(exportTarget)}
      title={exportTarget ? `导出 PDF · ${exportTarget.name}` : '导出 PDF'}
      width={420}
      onClose={() => setExportTarget(null)}
      footer={<>
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => setExportTarget(null)}>取消</button>
        <button className="button button-primary" type="button" disabled={busy} onClick={() => void runExport()}>{busy ? '排版中…' : '生成 PDF'}</button>
      </>}
    >
      <div className="field">
        <span className="field-label">每页排几个产品</span>
        <select className="toolbar-select" aria-label="图册每页产品数" value={exportDensity} onChange={(event) => setExportDensity(event.target.value as CatalogDensity)}>
          {CATALOG_DENSITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.hint}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 13 }}>
          <input type="checkbox" checked={exportCover} onChange={(event) => setExportCover(event.target.checked)} />带封面（公司名 / 联系方式 / 微信二维码）
        </label>
        <span className="field-hint">图册排主图、参数、颜色/插脚与包装尺寸；发给客户的版本不含供应商与价格。数量多时排版会久一些，请耐心等下载。</span>
      </div>
    </Modal>
    <SupplierCatalogEditorModal
      open={supplierEditor !== undefined}
      catalog={supplierEditor ?? null}
      onClose={() => setSupplierEditor(undefined)}
      onChanged={refreshSupplierCatalogs}
      onNotify={onNotify}
    />
  </div>;
}
