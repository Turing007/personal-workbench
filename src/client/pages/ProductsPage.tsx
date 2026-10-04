import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, Edit3, Eye, EyeOff, FileDown, Image as ImageIcon, Images, List, Plus, RefreshCw, Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getPackagingPresets } from '../api';
import type { PackagingPreset } from '../../shared/packaging-presets';
import type { ProductStatus } from '../../shared/product-status';
import { CATALOG_DENSITY_OPTIONS, DEFAULT_CATALOG_DENSITY, type CatalogDensity } from '../../shared/product-catalog';
import Modal from '../components/Modal';
import { initialProductsView, saveProductsView, type ProductsView } from '../products-view';
import ProductEditor, { type ProductRecord } from '../components/ProductEditor';
import ToolbarMenu from '../components/ToolbarMenu';
import { compareProductByName } from '../product-sort';
import { PAGE_SIZES, clampPage, pageWindow, readStoredPageSize, rememberPageSize, slicePage, totalPages } from '../pagination';
import ProductDetailModal from '../components/ProductDetailModal';
import ProductImagesModal from '../components/ProductImagesModal';
import ProductParametersModal from '../components/ProductParametersModal';
import { cloneProductForNew } from '../product-copy';
import { thumbUrl } from '../image-urls';
import { packagingDisplay } from '../packaging-display';
import { copyText } from '../copy-text';
import { useIsNarrow } from '../use-is-narrow';
import { useHideOnScroll } from '../use-hide-on-scroll';

type StatusFilter = 'all' | ProductStatus;

export interface ProductsPageProps {
  products: ProductRecord[];
  loading?: boolean;
  onSave: (product: ProductRecord, mode: 'draft' | 'active') => Promise<void> | void;
  /** 保存与图片/附件同步进行中：编辑器底部的保存按钮要禁用，避免连点重跑同一份差异。 */
  saving?: boolean;
  onDelete: (product: ProductRecord) => Promise<void> | void;
  /** 详情页里的停售 / 恢复在售。 */
  onUpdateSaleStatus?: (product: ProductRecord, next: 'active' | 'discontinued') => void;
  onExport: () => Promise<void> | void;
  /** 图册导出：只交给父层 id 与密度，页面自己决定当前筛选结果。 */
  onCatalog: (ids: number[], density: CatalogDensity) => Promise<void>;
  onDownloadTemplate: () => Promise<void> | void;
  onImport: (file: File) => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  /** 编辑器里点「管理预设 ›」时跳到设置页维护包装预设。 */
  onManagePresets?: () => void;
  /** 有文件正在后台上传的产品 id：列表上给这些产品打「图片上传中」标记。 */
  uploadingProductIds?: string[];
}

const statusFilterLabels: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部产品' },
  { value: 'active', label: '在售产品' },
  { value: 'discontinued', label: '停售产品' },
  { value: 'draft', label: '草稿' },
];

// 分类筛选的两个特殊选项：全部 / 没有填分类的产品。
const CATEGORY_ALL = '__all__';
const CATEGORY_UNCATEGORIZED = '__none__';

/** 在售不加标（列表保持干净），停售灰标、草稿橙标。 */
function statusBadge(product: ProductRecord) {
  if (product.status === 'draft') return <span className="badge badge-warning">草稿</span>;
  if (product.status === 'discontinued') return <span className="badge badge-neutral">停售</span>;
  return null;
}

/** 还有文件在后台上传：必须标出来，否则用户会以为刚存的图丢了。 */
function uploadBadge(product: ProductRecord, uploadingIds: Set<string>) {
  if (!uploadingIds.has(String(product.id))) return null;
  return <span className="badge badge-info" title="图片与附件正在后台上传，传完会自动出现在这里">图片上传中</span>;
}

/** 采购价存成 0 表示没填，显示占位符而不是「¥0」。 */
function purchasePriceLabel(value: string) {
  return Number(value) > 0 ? `¥${value}` : '—';
}

/** 还有别的档时加一个 +N，提示去详情看全部；单档产品不加装饰。 */
function extraQuoteCount(product: ProductRecord) {
  return Math.max(0, (product.purchaseQuotes?.length ?? 0) - 1);
}

export default function ProductsPage({ products, loading, onSave, saving, onDelete, onUpdateSaleStatus, onExport, onCatalog, onDownloadTemplate, onImport, onRefresh, onManagePresets, uploadingProductIds }: ProductsPageProps) {
  const uploadingIds = new Set(uploadingProductIds ?? []);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pageSize, setPageSize] = useState(readStoredPageSize);
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  // 每次打开编辑器重新拉一次预设：在设置页改完回来就能拿到最新的一套。
  const [packagingPresets, setPackagingPresets] = useState<PackagingPreset[]>([]);
  useEffect(() => {
    if (!editorOpen) return;
    let cancelled = false;
    getPackagingPresets().then((items) => { if (!cancelled) setPackagingPresets(items); }).catch(() => { if (!cancelled) setPackagingPresets([]); });
    return () => { cancelled = true; };
  }, [editorOpen]);
  const [editing, setEditing] = useState<ProductRecord>();
  const [copying, setCopying] = useState(false);
  const [detailProduct, setDetailProduct] = useState<ProductRecord>();
  const [imagesProduct, setImagesProduct] = useState<ProductRecord>();
  const [copiedPackagingId, setCopiedPackagingId] = useState<string>();
  const [expandedPackagingId, setExpandedPackagingId] = useState<string>();
  const [parametersProduct, setParametersProduct] = useState<ProductRecord>();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogDensity, setCatalogDensity] = useState<CatalogDensity>(DEFAULT_CATALOG_DENSITY);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const narrow = useIsNarrow();
  // 列表 / 大图两种浏览方式，默认大图；手动切过一次就记住。
  const [view, setView] = useState<ProductsView>(initialProductsView);
  const toggleView = () => {
    const next: ProductsView = view === 'gallery' ? 'list' : 'gallery';
    setView(next);
    saveProductsView(next);
  };
  const [searchFocused, setSearchFocused] = useState(false);
  // 供应商与采购价默认显示，工具条小眼睛用于临时收起（例如给人看屏幕时）；不记住上次的选择。
  const [showSensitive, setShowSensitive] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState(CATEGORY_ALL);
  // 手机端搜索框悬浮在顶部：连续下滑收起，回滑展开；输入时锁住展开避免打字途中消失。
  const searchHidden = useHideOnScroll(narrow && !searchFocused);
  // 分类候选直接来自现有产品，出现次数多的排前面；空分类归进「未分类」。
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
  // 采购报价的候选：库里用过的供应商与名目，按出现次数排。
  const quoteOptions = useMemo(() => {
    const suppliers = new Map<string, number>();
    const variants = new Map<string, number>();
    const bump = (map: Map<string, number>, key: string) => {
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    };
    for (const product of products) {
      bump(suppliers, product.supplier?.trim() ?? '');
      for (const quote of product.purchaseQuotes ?? []) {
        bump(suppliers, quote.supplier);
        bump(variants, quote.variant);
      }
    }
    const rank = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
    return { suppliers: rank(suppliers), variants: rank(variants) };
  }, [products]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products
      .filter((product) => {
        if (statusFilter !== 'all' && (product.status ?? 'active') !== statusFilter) return false;
        const category = product.category?.trim() ?? '';
        if (categoryFilter === CATEGORY_UNCATEGORIZED) {
          if (category) return false;
        } else if (categoryFilter !== CATEGORY_ALL && category !== categoryFilter) {
          return false;
        }
        if (!needle) return true;
        return [product.name, product.sku, product.supplier, product.category].join(' ').toLowerCase().includes(needle);
      })
      // 列表按品名的拼音序展示：同名的按 SKU、id 兜底，保证翻页时顺序稳定。
      .sort(compareProductByName);
  }, [products, query, statusFilter, categoryFilter]);
  // 换了搜索词、状态或分类筛选后结果集会整个变，留在原页码会看到不相干的一页，所以回到第 1 页。
  useEffect(() => { setPage(1); }, [query, statusFilter, categoryFilter]);
  const pageCount = totalPages(filtered.length, pageSize);
  const currentPage = clampPage(page, filtered.length, pageSize);
  const visible = slicePage(filtered, currentPage, pageSize);
  const rangeStart = filtered.length ? (currentPage - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min(filtered.length, currentPage * pageSize);
  const changePageSize = (next: number) => { setPageSize(next); rememberPageSize(next); setPage(1); };

  const openNew = () => { setEditing(undefined); setCopying(false); setEditorOpen(true); };
  const openEdit = (product: ProductRecord) => { setEditing(product); setCopying(false); setEditorOpen(true); };
  const openCopy = (product: ProductRecord) => { setEditing(cloneProductForNew(product)); setCopying(true); setEditorOpen(true); };
  const save = async (product: ProductRecord, mode: 'draft' | 'active') => {
    try {
      await onSave(product, mode);
      setEditorOpen(false);
      setEditing(undefined);
      setCopying(false);
    } catch {
      // 保存失败时保持编辑器打开，让用户重试；错误原因已由上层 toast 提示。
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  // 图册导出的是「当前筛选结果」：先筛再导，省掉逐个勾选。失败时弹窗保持打开，父层已弹提示。
  const generateCatalog = async () => {
    if (!filtered.length) return;
    setCatalogBusy(true);
    try {
      await onCatalog(filtered.map((product) => Number(product.id)), catalogDensity);
      setCatalogOpen(false);
    } finally {
      setCatalogBusy(false);
    }
  };

  const copyPackaging = async (item: ProductRecord['packaging'][number]) => {
    const display = packagingDisplay(item);
    const text = [
      `名称：${display.name}`,
      `内盒尺寸：${display.innerSize}`,
      `内盒重量：${display.innerWeight}`,
      `外箱尺寸：${display.outerSize}`,
      `外箱重量：${display.outerWeight}`,
      `装箱数量：${display.count}`,
    ].join('\n');
    const copied = await copyText(text);
    setCopiedPackagingId(copied ? item.id : undefined);
    if (copied) window.setTimeout(() => setCopiedPackagingId((current) => current === item.id ? undefined : current), 1600);
  };

  const closeDetail = () => setDetailProduct(undefined);
  const closeImages = () => setImagesProduct(undefined);

  return <div className="page-shell products-page">
    <div className="page-toolbar">
      <div className={`search-control${searchHidden ? ' is-scroll-hidden' : ''}`}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="按品名、SKU、供应商、分类筛选" /></div>
      <select aria-label="产品状态筛选" className="toolbar-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
        {statusFilterLabels.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <select aria-label="产品分类筛选" className="toolbar-select products-category-filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
        <option value={CATEGORY_ALL}>全部分类</option>
        {categoryOptions.named.map((category) => <option key={category} value={category}>{category}</option>)}
        {categoryOptions.hasUncategorized && <option value={CATEGORY_UNCATEGORIZED}>未分类</option>}
      </select>
      <span className="toolbar-count">{filtered.length} 个产品</span>
      <button className="button button-secondary products-view-toggle" type="button" aria-pressed={view === 'gallery'} aria-label={view === 'gallery' ? '切换到列表视图' : '切换到大图浏览'} title={view === 'gallery' ? '切换到列表视图' : '切换到大图浏览'} onClick={toggleView}>{view === 'gallery' ? <List size={15} /> : <Images size={15} />}<span className="products-mobile-hidden">{view === 'gallery' ? '列表' : '大图'}</span></button>
      <button className="icon-button products-sensitive-toggle" type="button" aria-pressed={showSensitive} aria-label={showSensitive ? '隐藏供应商与价格' : '显示供应商与价格'} title={showSensitive ? '隐藏供应商与价格' : '显示供应商与价格'} onClick={() => setShowSensitive((current) => !current)}>{showSensitive ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      <button className="button button-secondary products-refresh-button" type="button" onClick={() => void refresh()} disabled={refreshing} aria-label="刷新" title="重新加载产品库"><RefreshCw size={15} /><span className="products-mobile-hidden">刷新</span></button>
      <ToolbarMenu
        className="products-mobile-hidden"
        label="导入导出"
        title="导出产品库、下载 Excel 模板、导入 Excel"
        items={[
          { key: 'export', label: '导出产品库', icon: <Download size={15} />, onSelect: () => void onExport() },
          { key: 'catalog', label: '导出产品图册', icon: <Images size={15} />, separated: true, onSelect: () => setCatalogOpen(true) },
          { key: 'template', label: '下载导入模板', icon: <FileDown size={15} />, onSelect: () => void onDownloadTemplate() },
          { key: 'import', label: '导入 Excel', icon: <Upload size={15} />, separated: true, onSelect: () => importInputRef.current?.click() },
        ]}
      />
      <input ref={importInputRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void onImport(file); }} />
      <button className="button button-primary" type="button" onClick={openNew}><Plus size={15} /><span>添加<span className="products-mobile-hidden">产品</span></span></button>
    </div>
    <section className="table-panel">
      {view === 'gallery' && <div className="products-gallery">
        {visible.map((product) => <div className="product-gallery-card" key={product.id}>
          {/* 图片看图片、名称和 SKU 看详情：两件事分开，大图模式下想直接看图就不用先开弹窗再点图片。 */}
          {product.images.length
            ? <button className="product-gallery-image-button" type="button" onClick={() => setImagesProduct(product)} title="查看全部图片"><span className="product-gallery-image"><img src={thumbUrl(product.images[0].url, 480)} alt={product.images[0].name} loading="lazy" decoding="async" /></span></button>
            : <span className="product-gallery-image"><span className="product-gallery-placeholder"><ImageIcon size={22} /><span>无图片</span></span></span>}
          <button className="product-gallery-open" type="button" onClick={() => setDetailProduct(product)} title="查看产品详情">
            <span className="product-gallery-name">{product.name || (product.status === 'draft' ? '（未命名草稿）' : '—')}{statusBadge(product)}</span>
            {/* 「图片上传中」不能放进 .product-gallery-name：那是两行截断 + overflow:hidden 的容器，
                名字一长就把标记裁掉，只剩一条边。放在它外面自成一行才看得见。 */}
            {uploadBadge(product, uploadingIds)}
            <span className="product-gallery-meta">
              <span className="product-gallery-sku">{product.sku || '—'}</span>
              {showSensitive && <span className="product-gallery-price">{purchasePriceLabel(product.purchasePrice)}{extraQuoteCount(product) > 0 && <span className="price-tier-count" title={`还有 ${extraQuoteCount(product)} 档报价`}>+{extraQuoteCount(product)}</span>}</span>}
            </span>
          </button>
          <div className="row-actions product-gallery-actions">
            <button className="icon-button" type="button" title={product.status === 'draft' ? '继续编辑草稿' : '编辑产品'} onClick={() => openEdit(product)}><Edit3 size={14} /></button>
            <button className="icon-button" type="button" title="复制产品为新建产品" onClick={() => openCopy(product)}><Copy size={14} /></button>
            
          </div>
        </div>)}
      </div>}
      {view === 'list' && <div className="table-scroll products-table-desktop"><table className="data-table products-data-table"><thead><tr>{['SKU', '图片', '品名', '颜色', '插脚', '参数', '包装信息', '备注', ...(showSensitive ? ['供应商', '价格'] : []), '操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead>
        <tbody>{visible.map((product) => <tr key={product.id}>
          <td className="strong-cell"><button className="product-sku-button" type="button" onClick={() => setDetailProduct(product)} title="查看产品详情">{product.sku || '查看详情'}</button></td>
          <td>{product.images.length ? <button className="product-image-button" type="button" onClick={() => setImagesProduct(product)} title="查看全部图片"><span className="product-image-thumb"><img src={thumbUrl(product.images[0].url, 240)} alt={product.images[0].name} loading="lazy" decoding="async" /></span><span className="image-count"><ImageIcon size={13} />{product.images.length}</span></button> : <span className="product-no-image">—</span>}</td>
          <td className="product-name-cell"><span className="product-name-text">{product.name || (product.status === 'draft' ? '（未命名草稿）' : '—')}</span>{statusBadge(product)}{uploadBadge(product, uploadingIds)}</td><td>{product.colors.join('、') || '—'}</td><td>{product.batteryPlugs.join('、') || '—'}</td>
          <td className="product-parameters-cell">{product.parameters?.trim() ? <button className="product-parameters-trigger" type="button" onClick={() => setParametersProduct(product)} title="查看完整参数"><span>查看详情</span><Copy size={13} /></button> : <span>—</span>}</td>
          <td className="product-packaging-cell"><div className="product-packaging-lines">{product.packaging.length ? <>
            {(expandedPackagingId === product.id ? product.packaging : product.packaging.slice(0, 1)).map((item) => {
              const display = packagingDisplay(item);
              return <div className="product-packaging-line" key={item.id}>
                <strong>{display.name}{display.price ? `--${display.price}` : ''}<button className="icon-button product-packaging-copy-button" type="button" title={copiedPackagingId === item.id ? '已复制包装详情' : '复制包装详情'} onClick={() => void copyPackaging(item)}>{copiedPackagingId === item.id ? <Check size={12} /> : <Copy size={12} />}</button></strong>
                <span>内盒 {display.innerSize} {display.innerWeight}</span><span>外箱 {display.outerSize} {display.outerWeight}</span><span>{display.count}</span>
                {!!item.images?.length && <span className="product-packaging-image-count"><ImageIcon size={12} />{item.images.length}</span>}
              </div>;
            })}
            {product.packaging.length > 1 && <button className="product-packaging-expand" type="button" onClick={() => setExpandedPackagingId((current) => current === product.id ? undefined : product.id)}>{expandedPackagingId === product.id ? <><ChevronUp size={13} />收起</> : <><ChevronDown size={13} />... 还有 {product.packaging.length - 1} 个包装</>}</button>}
          </> : <span>—</span>}</div></td>
          <td className="product-remark-cell">{product.remark || '—'}</td>{showSensitive && <><td>{product.supplier || '—'}</td><td>{purchasePriceLabel(product.purchasePrice)}{extraQuoteCount(product) > 0 && <span className="price-tier-count" title={`还有 ${extraQuoteCount(product)} 档报价`}>+{extraQuoteCount(product)}</span>}</td></>}
          <td><div className="row-actions"><button className="icon-button" title={product.status === 'draft' ? '继续编辑草稿' : '编辑产品'} type="button" onClick={() => openEdit(product)}><Edit3 size={14} /></button><button className="icon-button" title="复制产品为新建产品" type="button" onClick={() => openCopy(product)}><Copy size={14} /></button></div></td>
        </tr>)}</tbody></table></div>}
      {view === 'list' && <div className="products-card-list">
        {visible.map((product) => <article key={product.id} className="product-card">
          <div className="product-card-head">
            {product.images.length ? <button className="product-image-button" type="button" onClick={() => setImagesProduct(product)} title="查看全部图片"><span className="product-image-thumb"><img src={thumbUrl(product.images[0].url, 240)} alt={product.images[0].name} loading="lazy" decoding="async" /></span><span className="image-count"><ImageIcon size={13} />{product.images.length}</span></button> : <span className="product-no-image">—</span>}
            <div className="product-card-title">
              <strong>{product.name || (product.status === 'draft' ? '（未命名草稿）' : '—')}{statusBadge(product)}{uploadBadge(product, uploadingIds)}</strong>
              <button className="product-sku-button" type="button" onClick={() => setDetailProduct(product)} title="查看产品详情">{product.sku || '查看详情'}</button>
            </div>
          </div>
          <div className="product-card-grid">
            <div className="product-card-field"><span>颜色 / 插脚</span><strong>{[product.colors.join('、'), product.batteryPlugs.join('、')].filter(Boolean).join(' · ') || '—'}</strong></div>
            {showSensitive && <div className="product-card-field"><span>供应商 / 采购价</span><strong>{[product.supplier || '—', purchasePriceLabel(product.purchasePrice)].join(' · ')}{extraQuoteCount(product) > 0 && <span className="price-tier-count" title={`还有 ${extraQuoteCount(product)} 档报价`}>+{extraQuoteCount(product)}</span>}</strong></div>}
          </div>
          {product.parameters?.trim() && <button className="product-parameters-trigger" type="button" onClick={() => setParametersProduct(product)} title="查看完整参数"><span>参数详情</span><Copy size={13} /></button>}
          {product.packaging.length > 0 && <div className="product-card-packaging">{product.packaging.slice(0, 1).map((item) => {
            const display = packagingDisplay(item);
            return <div className="product-card-packaging-line" key={item.id}><strong>{display.name}</strong><span>内盒 {display.innerSize} / 外箱 {display.outerSize}</span></div>;
          })}{product.packaging.length > 1 && <span className="product-card-packaging-more">… 共 {product.packaging.length} 个包装</span>}</div>}
          <div className="row-actions">
            <button className="icon-button" title={product.status === 'draft' ? '继续编辑草稿' : '编辑产品'} type="button" onClick={() => openEdit(product)}><Edit3 size={14} /></button>
            <button className="icon-button" title="复制产品为新建产品" type="button" onClick={() => openCopy(product)}><Copy size={14} /></button>
            
          </div>
        </article>)}</div>}
      {!!filtered.length && <div className="products-pagination">
        <span className="products-pagination-summary">共 {filtered.length} 个产品 · 第 {rangeStart}-{rangeEnd} 条</span>
        <div className="products-pagination-controls">
          <label className="products-page-size"><span>每页</span>
            <select aria-label="每页显示条数" className="toolbar-select" value={pageSize} onChange={(event) => changePageSize(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select>
            <span>条</span>
          </label>
          <div className="products-pager">
            <button className="icon-button products-page-step" type="button" aria-label="上一页" title="上一页" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></button>
            {pageWindow(currentPage, pageCount).map((entry, index) => entry === 'gap'
              ? <span className="products-page-gap" key={`gap-${index}`}>…</span>
              : <button className={entry === currentPage ? 'products-page-button is-current' : 'products-page-button'} key={entry} type="button" aria-current={entry === currentPage ? 'page' : undefined} onClick={() => setPage(entry)}>{entry}</button>)}
            <button className="icon-button products-page-step" type="button" aria-label="下一页" title="下一页" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></button>
          </div>
          <span className="products-pagination-page">第 {currentPage} / {pageCount} 页</span>
        </div>
      </div>}
      {loading && <div className="table-state">正在加载产品...</div>}
      {!loading && !filtered.length && <div className="table-state">暂无产品，点击“添加产品”开始维护。</div>}
    </section>
    <ProductEditor key={editing?.id ?? 'new'} open={editorOpen} saving={saving} product={editing} copyMode={copying} packagingPresets={packagingPresets} productCategories={categoryOptions.named} supplierOptions={quoteOptions.suppliers} variantOptions={quoteOptions.variants} onManagePresets={onManagePresets} onClose={() => { setEditorOpen(false); setEditing(undefined); setCopying(false); }} onSave={save} />
    <Modal
      open={catalogOpen}
      title="导出产品图册"
      width={420}
      onClose={() => setCatalogOpen(false)}
      footer={<>
        <button className="button button-secondary" type="button" disabled={catalogBusy} onClick={() => setCatalogOpen(false)}>取消</button>
        <button className="button button-primary" type="button" disabled={catalogBusy || !filtered.length} onClick={() => void generateCatalog()}>
          {catalogBusy ? '排版中…' : `生成 ${filtered.length} 个产品的图册`}
        </button>
      </>}
    >
      <div className="field">
        <span className="field-label">每页排几个产品</span>
        <select className="toolbar-select" aria-label="图册每页产品数" value={catalogDensity} onChange={(event) => setCatalogDensity(event.target.value as CatalogDensity)}>
          {CATALOG_DENSITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.hint}</option>)}
        </select>
        <span className="field-hint">图册排主图、参数、颜色/插脚与包装尺寸；发给客户的版本不含供应商与价格。</span>
      </div>
    </Modal>
    <ProductParametersModal open={Boolean(parametersProduct)} productName={parametersProduct?.name} parameters={parametersProduct?.parameters} onClose={() => setParametersProduct(undefined)} />
    <ProductDetailModal open={Boolean(detailProduct)} product={detailProduct} showSensitive={showSensitive} onClose={closeDetail} onOpenImages={(product) => { closeDetail(); setImagesProduct(product); }} onUpdateSaleStatus={onUpdateSaleStatus} onDelete={onDelete} />
    <ProductImagesModal open={Boolean(imagesProduct)} productName={imagesProduct?.name} images={imagesProduct?.images ?? []} onClose={closeImages} />
  </div>;
}
