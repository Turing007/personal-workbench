import {
  ChevronLeft,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Customer, CustomerProduct, CustomerProductBatchSaveInput, CustomerProductSaveInput } from '../../shared/customers';
import { customerProductStandardCostCents } from '../../shared/customers';
import type { ProductRecord } from '../components/ProductEditor';
import SearchInput from '../components/SearchInput';
import {
  createCustomer,
  deleteCustomer,
  deleteCustomerProduct,
  deleteCustomerProducts,
  getCustomerProducts,
  importCustomerProductWithInput,
  linkCustomerProductToSystem,
  saveCustomerProduct,
  saveCustomerProductsBatch,
  setCustomerActive,
  updateCustomer,
  updateCustomerProduct,
  uploadCustomerProductImage,
  deleteCustomerProductImage,
  uploadCustomerProductAttachment,
  deleteCustomerProductAttachment,
  updateCustomerProductAttachmentCategory,
} from '../api';
import Modal from '../components/Modal';
import CustomerEditorModal from '../components/customers/CustomerEditorModal';
import { paymentPolicySummary } from '../../shared/payment-policy';
import CustomerProductEditorModal, { type CustomerProductAttachmentDraft } from '../components/customer-products/CustomerProductEditorModal';
import CustomerProductStickerModal from '../components/customer-products/CustomerProductStickerModal';
import CustomerProductRemarkModal from '../components/customer-products/CustomerProductRemarkModal';
import CustomerProductAttachmentsModal from '../components/customer-products/CustomerProductAttachmentsModal';
import { cloneCustomerProductForNew } from '../customer-product-copy';
import { thumbUrl } from '../image-urls';
import type { ToastKind } from '../components/OrderForm';
import { useProductPreview } from '../components/ProductPreview';

/** 附件数量不含「备注图片」：备注里的截图单独在备注弹窗管理。 */
function attachmentFileCount(product: CustomerProduct): number {
  return product.attachments.filter((attachment) => attachment.category !== 'remark').length;
}

export interface CustomerProductsPageProps {
  customers: Customer[];
  systemProducts: ProductRecord[];
  initialCustomerId?: number;
  loading?: boolean;
  onCustomersChanged: () => Promise<void>;
  onNotify: (message: string, kind?: ToastKind) => void;
}

function formatTime(value: string | null): string {
  if (!value) return '-';
  return value.replace('T', ' ').slice(0, 16);
}

function imageUrl(relativePath: string | null): string {
  return relativePath ? `/files/${relativePath}` : '';
}

/** 列表用小图尺寸；点开大图仍用 imageUrl 原图。 */
function thumbnailUrl(relativePath: string | null): string {
  return thumbUrl(imageUrl(relativePath), 240);
}

function money(cents: number | null): string {
  return cents == null ? '-' : `¥${(cents / 100).toFixed(2)}`;
}

function customerProductKey(product: CustomerProduct): string {
  return String(product.id);
}

export default function CustomerProductsPage({ customers, systemProducts, initialCustomerId, loading, onCustomersChanged, onNotify }: CustomerProductsPageProps) {
  const { bind, previewElement } = useProductPreview();
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(initialCustomerId ?? customers.find((customer) => customer.isActive)?.id ?? customers[0]?.id ?? null);
  // 客户列表走左侧抽屉：点「N 个客户」滑出，选中客户后自动收起。
  const [customerDrawerOpen, setCustomerDrawerOpen] = useState(false);
  // 桌面端客户档案是浮在产品区上方的可收起面板：默认展开，选中客户或点收起后留一个左侧标签。
  const [customerPanelOpen, setCustomerPanelOpen] = useState(true);
  const [products, setProducts] = useState<CustomerProduct[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [productStatus, setProductStatus] = useState<'all' | 'complete' | 'incomplete'>('all');
  /** 成本价默认收起：给客户看屏幕/投屏时不暴露进货成本，和产品库的小眼睛同一套交互。 */
  const [showCostPrice, setShowCostPrice] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [customerEditorOpen, setCustomerEditorOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [productEditorOpen, setProductEditorOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CustomerProduct | null>(null);
  const [stickerProduct, setStickerProduct] = useState<CustomerProduct>();
  const [remarkProduct, setRemarkProduct] = useState<CustomerProduct>();
  const [attachmentProduct, setAttachmentProduct] = useState<CustomerProduct>();
  const [copyDraft, setCopyDraft] = useState<CustomerProduct | null>(null);
  const [copySource, setCopySource] = useState<CustomerProduct | null>(null);
  const appliedInitialCustomerId = useRef<number | undefined>(undefined);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;

  /** 弹窗保存后的静默刷新：不闪加载态、不清空勾选。 */
  const refreshProductsSilently = async () => {
    if (!selectedCustomerId) return;
    try {
      setProducts(await getCustomerProducts(selectedCustomerId, { search: productQuery, status: productStatus }));
    } catch {
      // 列表刷新失败不打断弹窗操作，下一次筛选/切换客户会重新拉取。
    }
  };

  const filteredCustomers = useMemo(() => {
    const needle = customerQuery.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => [customer.name, customer.contactName, customer.contactPhone].join(' ').toLowerCase().includes(needle));
  }, [customerQuery, customers]);

  const loadCustomerProducts = async (customerId: number | null = selectedCustomerId) => {
    if (!customerId) {
      setProducts([]);
      setSelectedProductIds([]);
      return;
    }
    setProductLoading(true);
    setProductError('');
    try {
      const next = await getCustomerProducts(customerId, { search: productQuery, status: productStatus });
      setProducts(next);
      setSelectedProductIds([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '客户产品加载失败';
      setProductError(message);
      onNotify(message, 'error');
    } finally {
      setProductLoading(false);
    }
  };

  useEffect(() => {
    if (initialCustomerId != null && appliedInitialCustomerId.current !== initialCustomerId && customers.some((customer) => customer.id === initialCustomerId)) {
      appliedInitialCustomerId.current = initialCustomerId;
      setSelectedCustomerId(initialCustomerId);
      setProductStatus('incomplete');
    }
  }, [customers, initialCustomerId]);

  useEffect(() => {
    if (selectedCustomerId != null && !customers.some((customer) => customer.id === selectedCustomerId)) {
      setSelectedCustomerId(customers.find((customer) => customer.isActive)?.id ?? customers[0]?.id ?? null);
    }
  }, [customers, selectedCustomerId]);

  useEffect(() => {
    void loadCustomerProducts(selectedCustomerId);
    // The selected customer, search and status are the complete server-side list key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerId, productQuery, productStatus]);

  const saveCustomerProfile = async (input: Parameters<typeof createCustomer>[0]) => {
    setCustomerBusy(true);
    try {
      const saved = editingCustomer ? await updateCustomer(editingCustomer.id, input) : await createCustomer(input);
      await onCustomersChanged();
      setSelectedCustomerId(saved.id);
      setCustomerEditorOpen(false);
      setEditingCustomer(null);
      onNotify(editingCustomer ? '客户资料已更新' : '客户已添加', 'success');
    } finally {
      setCustomerBusy(false);
    }
  };

  const toggleCustomer = async (customer: Customer) => {
    try {
      await setCustomerActive(customer.id, !customer.isActive);
      await onCustomersChanged();
      onNotify(customer.isActive ? '客户已停用，历史单据仍保留' : '客户已启用', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : '客户状态更新失败', 'error');
    }
  };

  const removeCustomer = async (customer: Customer) => {
    if (!window.confirm(`确定删除客户“${customer.name}”吗？如果已有订单或产品引用，系统会保留客户并改为停用。`)) return;
    try {
      await deleteCustomer(customer.id);
      await onCustomersChanged();
      onNotify('客户已删除或停用', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : '客户删除失败', 'error');
    }
  };

  const closeProductEditor = () => {
    setProductEditorOpen(false);
    setEditingProduct(null);
    setCopyDraft(null);
    setCopySource(null);
  };
  const openNewProduct = () => {
    setEditingProduct(null);
    setCopyDraft(null);
    setCopySource(null);
    setProductEditorOpen(true);
  };
  const openEditProduct = (product: CustomerProduct) => {
    setCopyDraft(null);
    setCopySource(null);
    setEditingProduct(product);
    setProductEditorOpen(true);
  };
  const openCopyProduct = (product: CustomerProduct) => {
    setEditingProduct(null);
    setCopyDraft(cloneCustomerProductForNew(product));
    setCopySource(product);
    setProductEditorOpen(true);
  };

  const saveProduct = async (input: CustomerProductSaveInput, imageFile?: File, attachmentDrafts: CustomerProductAttachmentDraft[] = []) => {
    if (!selectedCustomerId) throw new Error('请先选择客户');
    const previousAttachments = editingProduct?.attachments ?? [];
    const saved = editingProduct
      ? await updateCustomerProduct(editingProduct.id, input)
      : input.systemProductId
        ? await importCustomerProductWithInput(selectedCustomerId, input.systemProductId, input)
        : await saveCustomerProduct(selectedCustomerId, input);
    const previousSystemProductId = editingProduct?.systemProductId ?? null;
    const nextSystemProductId = input.systemProductId ?? null;
    if (editingProduct && nextSystemProductId !== previousSystemProductId) {
      await linkCustomerProductToSystem(saved.id, nextSystemProductId, input.supplierProductName ?? '');
    }
    if (imageFile) await uploadCustomerProductImage(saved.id, imageFile);
    if (!imageFile && input.imageRelativePath === null) await deleteCustomerProductImage(saved.id);
    const keptAttachmentIds = new Set(
      attachmentDrafts.filter((attachment) => !attachment.file && Number.isSafeInteger(Number(attachment.id))).map((attachment) => Number(attachment.id)),
    );
    for (const attachment of previousAttachments) {
      if (!keptAttachmentIds.has(attachment.id)) await deleteCustomerProductAttachment(saved.id, attachment.id);
    }
    for (const attachment of attachmentDrafts.filter((item) => item.file)) {
      await uploadCustomerProductAttachment(saved.id, attachment.file!, attachment.category);
    }
    for (const attachment of attachmentDrafts.filter((item) => !item.file && Number.isSafeInteger(Number(item.id)))) {
      const previous = previousAttachments.find((entry) => entry.id === Number(attachment.id));
      if (previous && previous.category !== attachment.category) {
        await updateCustomerProductAttachmentCategory(saved.id, previous.id, attachment.category);
      }
    }
    closeProductEditor();
    await loadCustomerProducts(selectedCustomerId);
    await onCustomersChanged();
    onNotify(editingProduct ? '客户产品已更新' : copyDraft ? '已复制为新客户产品' : '客户产品已添加', 'success');
    return undefined;
  };

  const saveProductsBatch = async (input: CustomerProductBatchSaveInput, imageFiles: Array<File | undefined> = []) => {
    if (!selectedCustomerId) throw new Error('请先选择客户');
    const created = await saveCustomerProductsBatch(selectedCustomerId, input);
    let failedImages = 0;
    for (let index = 0; index < created.length; index += 1) {
      const file = imageFiles[index];
      if (!file) continue;
      try {
        await uploadCustomerProductImage(created[index].id, file);
      } catch {
        failedImages += 1;
      }
    }
    closeProductEditor();
    await loadCustomerProducts(selectedCustomerId);
    await onCustomersChanged();
    onNotify(
      failedImages
        ? `已批量创建 ${created.length} 个客户产品，${failedImages} 张图片上传失败，可在编辑中重新上传`
        : `已批量创建 ${created.length} 个客户产品`,
      failedImages ? 'error' : 'success',
    );
  };

  const removeProduct = async (product: CustomerProduct) => {
    if (!window.confirm(`确定删除客户产品“${product.name}”吗？历史订单不会受影响。`)) return;
    try {
      await deleteCustomerProduct(product.id);
      await loadCustomerProducts(selectedCustomerId);
      await onCustomersChanged();
      onNotify('客户产品已删除', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : '客户产品删除失败', 'error');
    }
  };

  const batchRemoveProducts = async () => {
    if (!selectedCustomerId || !selectedProductIds.length) return;
    if (!window.confirm(`确定删除选中的 ${selectedProductIds.length} 个客户产品吗？历史订单不会受影响。`)) return;
    try {
      await deleteCustomerProducts(selectedCustomerId, selectedProductIds);
      await loadCustomerProducts(selectedCustomerId);
      await onCustomersChanged();
      onNotify('选中的客户产品已删除', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : '批量删除失败', 'error');
    }
  };


  const activeCustomer = Boolean(selectedCustomer?.isActive);
  const allVisibleSelected = products.length > 0 && products.every((product) => selectedProductIds.includes(product.id));

  return <div className="page-shell customer-products-page">{previewElement}
    <div className="customer-products-page-head">
      <div className="customer-products-heading-copy">
        <span className="page-breadcrumb">资料 / 客户</span>
        <strong className="page-title"><UserRound size={17} />客户产品库</strong>
        <span className="page-subtitle">维护客户专属产品、SKU、包装与报价</span>
      </div>
    </div>
    <div className="page-toolbar customer-products-toolbar">
      <button className="customer-list-trigger" type="button" title="打开客户列表" aria-haspopup="dialog" aria-expanded={customerDrawerOpen} onClick={() => setCustomerDrawerOpen(true)}><Users size={15} />{filteredCustomers.length} 个客户</button>
      <button className="icon-button" type="button" title="刷新客户资料" disabled={loading} onClick={() => void onCustomersChanged()}><RefreshCw size={15} /></button>
    </div>

    <section className={`table-panel customer-products-workspace${customerPanelOpen ? '' : ' is-customer-collapsed'}`}>
      {customerPanelOpen ? <div className="customer-list-panel" aria-label="客户档案">
        <div className="section-box-header customer-list-header"><span className="section-box-title">客户档案</span><span className="customer-panel-count">{filteredCustomers.length} 个客户</span><button className="icon-button" type="button" title="收起客户列表" aria-label="收起客户列表" onClick={() => setCustomerPanelOpen(false)}><ChevronLeft size={16} /></button></div>
        <div className="customer-panel-tools">
          <SearchInput value={customerQuery} onChange={setCustomerQuery} className="customer-panel-search" placeholder="搜索客户名称、联系人、电话" />
          <div className="customer-panel-actions">
            <button className="button button-primary" type="button" title="新增客户" onClick={() => { setEditingCustomer(null); setCustomerEditorOpen(true); }}><Plus size={14} />新增客户</button>
            <button className="icon-button" type="button" title="刷新客户资料" disabled={loading} onClick={() => void onCustomersChanged()}><RefreshCw size={15} /></button>
          </div>
        </div>
        <div className="customer-list-scroll">
          {filteredCustomers.map((customer) => <button key={customer.id} className={`customer-list-item${customer.id === selectedCustomerId ? ' is-selected' : ''}`} type="button" onClick={() => { setSelectedCustomerId(customer.id); setCustomerPanelOpen(false); }}>
            <div className="customer-list-item-heading"><strong>{customer.name}</strong><span className={`badge ${customer.isActive ? 'badge-success' : 'badge-neutral'}`}>{customer.isActive ? '启用' : '停用'}</span>{customer.paymentPolicy !== 'before_ship' && <span className={`badge ${customer.paymentPolicy === 'credit' ? 'badge-info' : 'badge-neutral'}`}>{paymentPolicySummary(customer.paymentPolicy, customer.depositPercent, customer.creditDays)}</span>}</div>
            <small className="customer-list-meta">{[customer.contactName, customer.contactPhone].filter(Boolean).join(' · ') || '暂无联系人信息'}</small>
            <small className={`customer-list-count${customer.incompleteProductCount ? ' is-incomplete' : ''}`}>{customer.productCount} 个产品 · {customer.incompleteProductCount} 个待完善</small>
          </button>)}
          {!filteredCustomers.length && <div className="empty-state">暂无匹配客户</div>}
        </div>
      </div> : <button className="customer-panel-tab" type="button" title="展开客户列表" aria-label="展开客户列表" aria-expanded={false} onClick={() => setCustomerPanelOpen(true)}><Users size={14} /><span>客户</span></button>}

      <div className="customer-products-panel">
        <div className="customer-products-header">
          <div className="customer-products-heading"><strong>{selectedCustomer?.name ?? '请选择客户'}</strong>{selectedCustomer && <small>{[selectedCustomer.contactName, selectedCustomer.contactPhone].filter(Boolean).join(' · ') || '暂无联系人'} · {selectedCustomer.shippingInfo ? '已填写收件信息' : '未填写收件信息'}</small>}</div>
          {selectedCustomer && <div className="row-actions"><button className="icon-button" type="button" title="编辑客户资料" onClick={() => { setEditingCustomer(selectedCustomer); setCustomerEditorOpen(true); }}><Edit3 size={14} /></button><button className="icon-button" type="button" title={selectedCustomer.isActive ? '停用客户' : '启用客户'} onClick={() => { void toggleCustomer(selectedCustomer); }}>{selectedCustomer.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}</button><button className="icon-button danger" type="button" title="删除客户" onClick={() => { void removeCustomer(selectedCustomer); }}><Trash2 size={14} /></button></div>}
        </div>
        <div className="customer-products-toolbar">
          <SearchInput value={productQuery} onChange={setProductQuery} className="customer-product-search" disabled={!selectedCustomer} placeholder="按品名、客户 SKU、规格筛选" />
          <select aria-label="客户产品状态筛选" className="toolbar-select customer-product-status-select" disabled={!selectedCustomer} value={productStatus} onChange={(event) => setProductStatus(event.target.value as typeof productStatus)}><option value="all">全部状态</option><option value="complete">已完善</option><option value="incomplete">待完善</option></select>
          <button className="icon-button products-sensitive-toggle" type="button" disabled={!selectedCustomer} aria-pressed={showCostPrice} aria-label={showCostPrice ? '隐藏成本价' : '显示成本价'} title={showCostPrice ? '隐藏成本价' : '显示成本价'} onClick={() => setShowCostPrice((current) => !current)}>{showCostPrice ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          {selectedProductIds.length > 0 && <button className="button button-secondary" type="button" onClick={() => { void batchRemoveProducts(); }}><Trash2 size={14} />删除选中</button>}
          <button className="button button-primary" type="button" disabled={!activeCustomer} title="添加客户新品" onClick={openNewProduct}><Plus size={14} />添加客户产品</button>
        </div>
        <div className="table-scroll customer-products-table-desktop"><table className={`data-table customer-products-table${showCostPrice ? ' has-cost' : ''}`}><thead><tr><th style={{ width: 34 }}><input type="checkbox" disabled={!products.length} checked={allVisibleSelected} onChange={() => setSelectedProductIds(allVisibleSelected ? [] : products.map((product) => product.id))} aria-label="全选客户产品" /></th>{['状态', '图片', '品名', '规格', '客户 SKU', '包装', '装箱数', ...(showCostPrice ? ['成本价'] : []), '剩余标贴数量', '最终价格', '运费/箱', '备注', '附件', '来源', '更新时间', '操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead><tbody>
          {products.map((product) => <tr key={product.id}>
            <td><input type="checkbox" checked={selectedProductIds.includes(product.id)} onChange={() => setSelectedProductIds((current) => current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id])} aria-label={`选择${product.name}`} /></td>
            <td><span style={{ display: 'inline-block', padding: '3px 6px', borderRadius: 'var(--radius-ui)', background: product.completionStatus === 'complete' ? 'var(--color-success-soft)' : 'var(--color-warning-soft)', color: product.completionStatus === 'complete' ? 'var(--color-success)' : 'var(--color-warning-text)', whiteSpace: 'nowrap' }}>{product.completionStatus === 'complete' ? '已完善' : '待完善'}</span></td>
            <td>{product.imageRelativePath ? <img {...bind(imageUrl(product.imageRelativePath), product.name)} src={thumbnailUrl(product.imageRelativePath)} alt={product.name} loading="lazy" decoding="async" style={{ width: 42, height: 36, objectFit: 'contain', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)' }} /> : <span style={{ color: 'var(--color-text-muted)' }}>-</span>}</td>
            <td className="strong-cell customer-product-name-cell" title={product.name || undefined}><span className="customer-product-name">{product.name || '-'}</span></td><td>{product.specification || '-'}</td><td>{product.sku || <span style={{ color: 'var(--color-warning-text)' }}>待完善</span>}</td><td>{product.packaging.length ? product.packaging[0].name || `${product.packaging.length} 种` : '-'}</td><td>{product.packCount == null ? <span style={{ color: 'var(--color-warning-text)' }}>待完善</span> : `${product.packCount} 个/箱`}</td>{showCostPrice && <td>{product.costConfirmed ? money(customerProductStandardCostCents(product)) : <span style={{ color: 'var(--color-warning-text)' }}>未核对成本</span>}</td>}<td><button type="button" className="customer-sticker-link" title="管理标贴库存" aria-label={`管理标贴库存：${product.name}`} onClick={() => setStickerProduct(product)}>{product.stickerEnabled ? <strong className={product.stickerRemaining < 0 ? 'finance-warning' : undefined}>{product.stickerRemaining}</strong> : '-'}</button></td><td className="strong-cell">{money(product.finalPriceCents)}{product.finalPriceIncludesTax ? <small style={{ marginLeft: 4, color: 'var(--color-text-secondary)', fontWeight: 400 }}>{product.finalPriceIncludesTax === 'inc' ? '含税' : '不含税'}</small> : null}</td><td>{product.freightPerBoxCents == null ? <span style={{ color: 'var(--color-warning-text)' }}>未设置</span> : `¥${(product.freightPerBoxCents / 100).toFixed(2)}/箱`}</td><td className="customer-product-remark-cell"><button type="button" className={`customer-remark-link${product.remark?.trim() ? '' : ' is-empty'}`} title={product.remark?.trim() || '点击编辑备注'} aria-label={`编辑备注：${product.name}`} onClick={() => setRemarkProduct(product)}>{product.remark?.trim() || '点击添加'}</button></td><td><button type="button" className="customer-attachment-link" title="管理附件" aria-label={`管理附件：${product.name}`} onClick={() => setAttachmentProduct(product)}>{attachmentFileCount(product) ? `${attachmentFileCount(product)} 个` : '上传'}</button></td><td><span style={{ color: product.systemProductId == null ? 'var(--color-text-secondary)' : 'var(--color-accent)' }}>{product.systemProductId == null ? '临时添加' : '系统产品库'}</span></td><td style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{formatTime(product.updatedAt)}</td>
            <td><div className="row-actions"><button className="icon-button" type="button" title="编辑客户产品" onClick={() => openEditProduct(product)}><Edit3 size={14} /></button><button className="icon-button" type="button" title={activeCustomer ? '复制为客户新品' : '客户已停用，不能复制新品'} disabled={!activeCustomer} onClick={() => openCopyProduct(product)}><Copy size={14} /></button><button className="icon-button danger" type="button" title="删除客户产品" onClick={() => { void removeProduct(product); }}><Trash2 size={14} /></button></div></td>
          </tr>)}
        </tbody></table></div>
        <div className="customer-product-card-list">
          {products.map((product) => <article key={product.id} className="customer-product-card">
            <div className="customer-product-card-head">
              <input type="checkbox" checked={selectedProductIds.includes(product.id)} onChange={() => setSelectedProductIds((current) => current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id])} aria-label={`选择${product.name}`} />
              {product.imageRelativePath ? <img className="customer-product-card-image" {...bind(imageUrl(product.imageRelativePath), product.name)} src={thumbnailUrl(product.imageRelativePath)} alt={product.name} loading="lazy" decoding="async" /> : <span className="product-no-image">—</span>}
              <div className="customer-product-card-title">
                <strong className="customer-product-card-name" title={product.name || undefined}>{product.name || '-'}</strong>
                <span>{product.specification || '-'}</span>
              </div>
              <span className={`badge ${product.completionStatus === 'complete' ? 'badge-success' : 'badge-warning'}`}>{product.completionStatus === 'complete' ? '已完善' : '待完善'}</span>
            </div>
            <div className="customer-product-card-grid">
              <div className="customer-product-card-field"><span>客户 SKU</span><strong style={!product.sku ? { color: 'var(--color-warning-text)' } : undefined}>{product.sku || '待完善'}</strong></div>
              <div className="customer-product-card-field"><span>包装 / 装箱数</span><strong>{product.packaging.length ? product.packaging[0].name || `${product.packaging.length} 种` : '-'}{product.packCount == null ? <em style={{ color: 'var(--color-warning-text)' }}>待完善</em> : ` · ${product.packCount} 个/箱`}</strong></div>
              {showCostPrice && <div className="customer-product-card-field"><span>成本价</span><strong style={product.costConfirmed ? undefined : { color: 'var(--color-warning-text)' }}>{product.costConfirmed ? money(customerProductStandardCostCents(product)) : '未核对成本'}</strong></div>}
              <button type="button" className="customer-product-card-field customer-product-field-button" title="管理标贴库存" aria-label={`管理标贴库存：${product.name}`} onClick={() => setStickerProduct(product)}><span>剩余标贴</span><strong className={product.stickerEnabled && product.stickerRemaining < 0 ? 'finance-warning' : undefined}>{product.stickerEnabled ? product.stickerRemaining : '-'}</strong></button>
              <div className="customer-product-card-field"><span>最终价格</span><strong>{money(product.finalPriceCents)}{product.finalPriceIncludesTax ? <small style={{ marginLeft: 4, color: 'var(--color-text-secondary)', fontWeight: 400 }}>{product.finalPriceIncludesTax === 'inc' ? '含税' : '不含税'}</small> : null}</strong></div>
              <div className="customer-product-card-field"><span>运费/箱</span><strong style={product.freightPerBoxCents == null ? { color: 'var(--color-warning-text)' } : undefined}>{product.freightPerBoxCents == null ? '未设置' : `¥${(product.freightPerBoxCents / 100).toFixed(2)}`}</strong></div>
            </div>
            <div className="customer-product-card-meta">
              <span style={{ color: product.systemProductId == null ? 'var(--color-text-secondary)' : 'var(--color-accent)' }}>{product.systemProductId == null ? '临时添加' : '系统产品库'}</span>
              <button type="button" className="customer-product-meta-link" title="管理附件" aria-label={`管理附件：${product.name}`} onClick={() => setAttachmentProduct(product)}>{attachmentFileCount(product) ? `${attachmentFileCount(product)} 个附件` : '添加附件'}</button>
              <span>{formatTime(product.updatedAt)}</span>
            </div>
            <button type="button" className={`customer-product-card-remark${product.remark?.trim() ? '' : ' is-empty'}`} title="编辑备注" aria-label={`编辑备注：${product.name}`} onClick={() => setRemarkProduct(product)}>{product.remark?.trim() || '点击添加备注'}</button>
            <div className="row-actions">
              <button className="icon-button" type="button" title="编辑客户产品" onClick={() => openEditProduct(product)}><Edit3 size={14} /></button>
              <button className="icon-button" type="button" title={activeCustomer ? '复制为客户新品' : '客户已停用，不能复制新品'} disabled={!activeCustomer} onClick={() => openCopyProduct(product)}><Copy size={14} /></button>
              <button className="icon-button danger" type="button" title="删除客户产品" onClick={() => { void removeProduct(product); }}><Trash2 size={14} /></button>
            </div>
          </article>)}
        </div>
        {(loading || productLoading) && <div className="table-state">正在加载客户产品...</div>}
        {!loading && !productLoading && !products.length && <div className="table-state">{productError || (selectedCustomer ? '当前客户暂无产品，可从系统产品库导入或直接添加新品。' : '请先在左侧选择客户。')}</div>}
      </div>
    </section>

    <Modal className="customer-list-drawer-panel" open={customerDrawerOpen} variant="drawer" drawerSide="left" title="客户档案" width={400} onClose={() => setCustomerDrawerOpen(false)}>
      <div className="customer-drawer">
        <SearchInput value={customerQuery} onChange={setCustomerQuery} className="customer-drawer-search" placeholder="搜索客户名称、联系人、电话" />
        <div className="customer-drawer-actions"><span>{filteredCustomers.length} 个客户</span><button className="button button-primary" type="button" onClick={() => { setEditingCustomer(null); setCustomerEditorOpen(true); }}><Plus size={14} />新增客户</button></div>
        <div className="customer-list-scroll">
          {filteredCustomers.map((customer) => <button key={customer.id} className={`customer-list-item${customer.id === selectedCustomerId ? ' is-selected' : ''}`} type="button" onClick={() => { setSelectedCustomerId(customer.id); setCustomerDrawerOpen(false); }} style={{ width: '100%', display: 'grid', gap: 5, padding: '11px 12px', border: 0, borderBottom: '1px solid var(--color-border)', borderLeft: `3px solid ${customer.id === selectedCustomerId ? 'var(--color-accent)' : 'transparent'}`, background: customer.id === selectedCustomerId ? 'var(--color-accent-soft)' : 'var(--color-surface)', textAlign: 'left', cursor: 'pointer', opacity: customer.isActive ? 1 : .62 }}>
            <div className="customer-list-item-heading"><strong>{customer.name}</strong><span className={`badge ${customer.isActive ? 'badge-success' : 'badge-neutral'}`}>{customer.isActive ? '启用' : '停用'}</span></div>
            <small className="customer-list-meta">{[customer.contactName, customer.contactPhone].filter(Boolean).join(' · ') || '暂无联系人信息'}</small>
            <small className={`customer-list-count${customer.incompleteProductCount ? ' is-incomplete' : ''}`}>{customer.productCount} 个产品 · {customer.incompleteProductCount} 个待完善</small>
          </button>)}
          {!filteredCustomers.length && <div className="empty-state">暂无匹配客户</div>}
        </div>
      </div>
    </Modal>

    <CustomerProductStickerModal open={Boolean(stickerProduct)} product={stickerProduct} onClose={() => setStickerProduct(undefined)} onChanged={() => { void refreshProductsSilently(); }} onNotify={onNotify} />
    <CustomerProductRemarkModal open={Boolean(remarkProduct)} product={remarkProduct} onClose={() => setRemarkProduct(undefined)} onChanged={() => { void refreshProductsSilently(); }} onNotify={onNotify} />
    <CustomerProductAttachmentsModal open={Boolean(attachmentProduct)} product={attachmentProduct} onClose={() => setAttachmentProduct(undefined)} onChanged={() => { void refreshProductsSilently(); }} onNotify={onNotify} />
    <CustomerEditorModal open={customerEditorOpen} customer={editingCustomer} busy={customerBusy} onClose={() => { setCustomerEditorOpen(false); setEditingCustomer(null); }} onSave={saveCustomerProfile} />
    <CustomerProductEditorModal open={productEditorOpen} product={editingProduct ?? copyDraft} copyMode={Boolean(copyDraft)} copyFromImageURL={copySource?.imageRelativePath ? `/files/${copySource.imageRelativePath}` : null} systemProducts={systemProducts} enableAttachments onClose={closeProductEditor} onSave={saveProduct} onBatchSave={saveProductsBatch} />
  </div>;
}
