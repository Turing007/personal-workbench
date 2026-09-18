import { Check, ChevronDown, ChevronUp, Copy, Download, Edit3, Eye, EyeOff, FileDown, Image as ImageIcon, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import ProductEditor, { type ProductRecord } from '../components/ProductEditor';
import { compareProductByNewest } from '../product-sort';
import ProductDetailModal from '../components/ProductDetailModal';
import ProductImagesModal from '../components/ProductImagesModal';
import ProductParametersModal from '../components/ProductParametersModal';
import { cloneProductForNew } from '../product-copy';
import { thumbUrl } from '../image-urls';
import { packagingDisplay } from '../packaging-display';
import { copyText } from '../copy-text';
import { useIsNarrow } from '../use-is-narrow';
import { useHideOnScroll } from '../use-hide-on-scroll';

type StatusFilter = 'all' | 'active' | 'draft';

export interface ProductsPageProps {
  products: ProductRecord[];
  loading?: boolean;
  onSave: (product: ProductRecord, mode: 'draft' | 'active') => Promise<void> | void;
  onDelete: (product: ProductRecord) => Promise<void> | void;
  onExport: () => Promise<void> | void;
  onDownloadTemplate: () => Promise<void> | void;
  onImport: (file: File) => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
}

const statusFilterLabels: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部产品' },
  { value: 'active', label: '正式产品' },
  { value: 'draft', label: '草稿' },
];

export default function ProductsPage({ products, loading, onSave, onDelete, onExport, onDownloadTemplate, onImport, onRefresh }: ProductsPageProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRecord>();
  const [copying, setCopying] = useState(false);
  const [detailProduct, setDetailProduct] = useState<ProductRecord>();
  const [imagesProduct, setImagesProduct] = useState<ProductRecord>();
  const [copiedPackagingId, setCopiedPackagingId] = useState<string>();
  const [expandedPackagingId, setExpandedPackagingId] = useState<string>();
  const [parametersProduct, setParametersProduct] = useState<ProductRecord>();
  const importInputRef = useRef<HTMLInputElement>(null);
  const narrow = useIsNarrow();
  const [searchFocused, setSearchFocused] = useState(false);
  // 供应商与采购价属于对外不能随便看的信息，默认隐藏；每次进页面都从隐藏开始，不记住上次的选择。
  const [showSensitive, setShowSensitive] = useState(false);
  // 手机端搜索框悬浮在顶部：连续下滑收起，回滑展开；输入时锁住展开避免打字途中消失。
  const searchHidden = useHideOnScroll(narrow && !searchFocused);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products
      .filter((product) => {
        if (statusFilter !== 'all' && (product.status ?? 'active') !== statusFilter) return false;
        if (!needle) return true;
        return [product.name, product.sku, product.supplier, product.category].join(' ').toLowerCase().includes(needle);
      })
      // 列表按「最新」展示：最近更新的排最上面（同时间的按 id 倒序，批量导入不会乱序）。
      .sort(compareProductByNewest);
  }, [products, query, statusFilter]);

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
      <span className="toolbar-count">{filtered.length} 个产品</span>
      <button className="icon-button products-sensitive-toggle" type="button" aria-pressed={showSensitive} aria-label={showSensitive ? '隐藏供应商与价格' : '显示供应商与价格'} title={showSensitive ? '隐藏供应商与价格' : '显示供应商与价格'} onClick={() => setShowSensitive((current) => !current)}>{showSensitive ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      <button className="button button-secondary products-refresh-button" type="button" onClick={() => void refresh()} disabled={refreshing} aria-label="刷新" title="重新加载产品库"><RefreshCw size={15} /><span className="products-mobile-hidden">刷新</span></button>
      <button className="button button-secondary products-mobile-hidden" type="button" onClick={() => void onExport()} title="导出产品库"><Download size={15} />导出</button>
      <button className="button button-secondary products-mobile-hidden" type="button" onClick={() => void onDownloadTemplate()} title="下载 Excel 导入模板"><FileDown size={15} />下载模板</button>
      <button className="button button-secondary products-mobile-hidden" type="button" onClick={() => importInputRef.current?.click()} title="导入 Excel 产品库"><Upload size={15} />导入</button>
      <input ref={importInputRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void onImport(file); }} />
      <button className="button button-primary" type="button" onClick={openNew}><Plus size={15} /><span>添加<span className="products-mobile-hidden">产品</span></span></button>
    </div>
    <section className="table-panel">
      <div className="table-scroll products-table-desktop"><table className="data-table products-data-table"><thead><tr>{['SKU', '图片', '品名', '颜色', '插脚', '参数', '包装信息', '备注', ...(showSensitive ? ['供应商', '价格'] : []), '操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead>
        <tbody>{filtered.map((product) => <tr key={product.id}>
          <td className="strong-cell"><button className="product-sku-button" type="button" onClick={() => setDetailProduct(product)} title="查看产品详情">{product.sku || '查看详情'}</button></td>
          <td>{product.images.length ? <button className="product-image-button" type="button" onClick={() => setImagesProduct(product)} title="查看全部图片"><span className="product-image-thumb"><img src={thumbUrl(product.images[0].url, 240)} alt={product.images[0].name} loading="lazy" decoding="async" /></span><span className="image-count"><ImageIcon size={13} />{product.images.length}</span></button> : <span className="product-no-image">—</span>}</td>
          <td>{product.status === 'draft' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="product-name-text" style={{ minWidth: 0, maxWidth: 220, overflow: 'hidden', display: 'inline-block', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{product.name || '（未命名草稿）'}</span><span className="badge badge-warning">草稿</span></span> : (product.name || '—')}</td><td>{product.colors.join('、') || '—'}</td><td>{product.batteryPlugs.join('、') || '—'}</td>
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
          <td className="product-remark-cell">{product.remark || '—'}</td>{showSensitive && <><td>{product.supplier || '—'}</td><td>{product.purchasePrice ? `¥${product.purchasePrice}` : '—'}</td></>}
          <td><div className="row-actions"><button className="icon-button" title={product.status === 'draft' ? '继续编辑草稿' : '编辑产品'} type="button" onClick={() => openEdit(product)}><Edit3 size={14} /></button><button className="icon-button" title="复制产品为新建产品" type="button" onClick={() => openCopy(product)}><Copy size={14} /></button><button className="icon-button danger" title="删除产品" type="button" onClick={() => { if (window.confirm(`确定删除产品“${product.name || '未命名草稿'}”吗？`)) void onDelete(product); }}><Trash2 size={14} /></button></div></td>
        </tr>)}</tbody></table></div>
      <div className="products-card-list">
        {filtered.map((product) => <article key={product.id} className="product-card">
          <div className="product-card-head">
            {product.images.length ? <button className="product-image-button" type="button" onClick={() => setImagesProduct(product)} title="查看全部图片"><span className="product-image-thumb"><img src={thumbUrl(product.images[0].url, 240)} alt={product.images[0].name} loading="lazy" decoding="async" /></span><span className="image-count"><ImageIcon size={13} />{product.images.length}</span></button> : <span className="product-no-image">—</span>}
            <div className="product-card-title">
              <strong>{product.status === 'draft' ? <>{product.name || '（未命名草稿）'}<span className="badge badge-warning">草稿</span></> : (product.name || '—')}</strong>
              <button className="product-sku-button" type="button" onClick={() => setDetailProduct(product)} title="查看产品详情">{product.sku || '查看详情'}</button>
            </div>
          </div>
          <div className="product-card-grid">
            <div className="product-card-field"><span>颜色 / 插脚</span><strong>{[product.colors.join('、'), product.batteryPlugs.join('、')].filter(Boolean).join(' · ') || '—'}</strong></div>
            {showSensitive && <div className="product-card-field"><span>供应商 / 采购价</span><strong>{[product.supplier || '—', product.purchasePrice ? `¥${product.purchasePrice}` : ''].filter(Boolean).join(' · ')}</strong></div>}
          </div>
          {product.parameters?.trim() && <button className="product-parameters-trigger" type="button" onClick={() => setParametersProduct(product)} title="查看完整参数"><span>参数详情</span><Copy size={13} /></button>}
          {product.packaging.length > 0 && <div className="product-card-packaging">{product.packaging.slice(0, 1).map((item) => {
            const display = packagingDisplay(item);
            return <div className="product-card-packaging-line" key={item.id}><strong>{display.name}</strong><span>内盒 {display.innerSize} / 外箱 {display.outerSize}</span></div>;
          })}{product.packaging.length > 1 && <span className="product-card-packaging-more">… 共 {product.packaging.length} 个包装</span>}</div>}
          <div className="row-actions">
            <button className="icon-button" title={product.status === 'draft' ? '继续编辑草稿' : '编辑产品'} type="button" onClick={() => openEdit(product)}><Edit3 size={14} /></button>
            <button className="icon-button" title="复制产品为新建产品" type="button" onClick={() => openCopy(product)}><Copy size={14} /></button>
            <button className="icon-button danger" title="删除产品" type="button" onClick={() => { if (window.confirm(`确定删除产品“${product.name || '未命名草稿'}”吗？`)) void onDelete(product); }}><Trash2 size={14} /></button>
          </div>
        </article>)}
      </div>
      {loading && <div className="table-state">正在加载产品...</div>}
      {!loading && !filtered.length && <div className="table-state">暂无产品，点击“添加产品”开始维护。</div>}
    </section>
    <ProductEditor key={editing?.id ?? 'new'} open={editorOpen} product={editing} copyMode={copying} onClose={() => { setEditorOpen(false); setEditing(undefined); setCopying(false); }} onSave={save} />
    <ProductParametersModal open={Boolean(parametersProduct)} productName={parametersProduct?.name} parameters={parametersProduct?.parameters} onClose={() => setParametersProduct(undefined)} />
    <ProductDetailModal open={Boolean(detailProduct)} product={detailProduct} showSensitive={showSensitive} onClose={closeDetail} onOpenImages={(product) => { closeDetail(); setImagesProduct(product); }} />
    <ProductImagesModal open={Boolean(imagesProduct)} productName={imagesProduct?.name} images={imagesProduct?.images ?? []} onClose={closeImages} />
  </div>;
}
