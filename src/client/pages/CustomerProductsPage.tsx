import {
  Edit3,
  Plus,
  RefreshCw,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Customer, CustomerProduct, CustomerProductSaveInput } from '../../shared/customers';
import type { ProductRecord } from '../components/ProductEditor';
import {
  createCustomer,
  deleteCustomer,
  deleteCustomerProduct,
  deleteCustomerProducts,
  getCustomerProducts,
  importCustomerProductWithInput,
  saveCustomerProduct,
  setCustomerActive,
  updateCustomer,
  updateCustomerProduct,
  uploadCustomerProductImage,
  deleteCustomerProductImage,
  uploadCustomerProductAttachment,
  deleteCustomerProductAttachment,
  updateCustomerProductAttachmentCategory,
} from '../api';
import CustomerEditorModal from '../components/customers/CustomerEditorModal';
import CustomerProductEditorModal, { type CustomerProductAttachmentDraft } from '../components/customer-products/CustomerProductEditorModal';
import type { ToastKind } from '../components/OrderForm';

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

function money(cents: number | null): string {
  return cents == null ? '-' : `¥${(cents / 100).toFixed(2)}`;
}

function customerProductKey(product: CustomerProduct): string {
  return String(product.id);
}

export default function CustomerProductsPage({ customers, systemProducts, initialCustomerId, loading, onCustomersChanged, onNotify }: CustomerProductsPageProps) {
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(initialCustomerId ?? customers.find((customer) => customer.isActive)?.id ?? customers[0]?.id ?? null);
  const [products, setProducts] = useState<CustomerProduct[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [productStatus, setProductStatus] = useState<'all' | 'complete' | 'incomplete'>('all');
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [customerEditorOpen, setCustomerEditorOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [productEditorOpen, setProductEditorOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CustomerProduct | null>(null);
  const appliedInitialCustomerId = useRef<number | undefined>(undefined);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;

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

  const saveProduct = async (input: CustomerProductSaveInput, imageFile?: File, attachmentDrafts: CustomerProductAttachmentDraft[] = []) => {
    if (!selectedCustomerId) throw new Error('请先选择客户');
    const previousAttachments = editingProduct?.attachments ?? [];
    const saved = editingProduct
      ? await updateCustomerProduct(editingProduct.id, input)
      : input.systemProductId
        ? await importCustomerProductWithInput(selectedCustomerId, input.systemProductId, input)
        : await saveCustomerProduct(selectedCustomerId, input);
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
    setProductEditorOpen(false);
    setEditingProduct(null);
    await loadCustomerProducts(selectedCustomerId);
    await onCustomersChanged();
    onNotify(editingProduct ? '客户产品已更新' : '客户产品已添加', 'success');
    return undefined;
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

  return <div className="page-shell customer-products-page">
    <div className="page-toolbar customer-products-toolbar">
      <div className="page-title customer-products-title"><UserRound size={17} />客户产品库</div>
      <div className="search-control customer-search-control"><Search size={15} /><input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="搜索客户名称、联系人、电话" /></div>
      <span className="toolbar-count">{filteredCustomers.length} 个客户</span>
      <button className="icon-button" type="button" title="刷新客户资料" disabled={loading} onClick={() => void onCustomersChanged()}><RefreshCw size={15} /></button>
      <button className="button button-primary" type="button" title="新增客户" onClick={() => { setEditingCustomer(null); setCustomerEditorOpen(true); }}><Plus size={15} />新增客户</button>
    </div>

    <div className="customer-products-layout" style={{ minHeight: 0, display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 10 }}>
      <section className="table-panel card customer-list-panel" style={{ minHeight: 420 }}>
        <div className="section-box-header customer-list-header"><span className="section-box-title">客户档案</span></div>
        <div className="customer-list-scroll" style={{ maxHeight: 'calc(100vh - 190px)' }}>
          {filteredCustomers.map((customer) => <button key={customer.id} className={`customer-list-item${customer.id === selectedCustomerId ? ' is-selected' : ''}`} type="button" onClick={() => setSelectedCustomerId(customer.id)} style={{ width: '100%', display: 'grid', gap: 5, padding: '11px 12px', border: 0, borderBottom: '1px solid #edf0f2', borderLeft: `3px solid ${customer.id === selectedCustomerId ? '#0f766e' : 'transparent'}`, background: customer.id === selectedCustomerId ? '#f0fdfa' : '#fff', textAlign: 'left', cursor: 'pointer', opacity: customer.isActive ? 1 : .62 }}>
            <div className="customer-list-item-heading"><strong>{customer.name}</strong><span className={`badge ${customer.isActive ? 'badge-success' : 'badge-neutral'}`}>{customer.isActive ? '启用' : '停用'}</span></div>
            <small className="customer-list-meta">{[customer.contactName, customer.contactPhone].filter(Boolean).join(' · ') || '暂无联系人信息'}</small>
            <small className={`customer-list-count${customer.incompleteProductCount ? ' is-incomplete' : ''}`}>{customer.productCount} 个产品 · {customer.incompleteProductCount} 个待完善</small>
          </button>)}
          {!filteredCustomers.length && <div className="empty-state">暂无匹配客户</div>}
        </div>
      </section>

      <section className="table-panel customer-products-panel" style={{ minWidth: 0, padding: 0, overflow: 'hidden' }}>
        <div className="customer-products-header">
          <div className="customer-products-heading"><strong>{selectedCustomer?.name ?? '请选择客户'}</strong>{selectedCustomer && <small>{[selectedCustomer.contactName, selectedCustomer.contactPhone].filter(Boolean).join(' · ') || '暂无联系人'} · {selectedCustomer.shippingInfo ? '已填写收件信息' : '未填写收件信息'}</small>}</div>
          {selectedCustomer && <div className="row-actions"><button className="icon-button" type="button" title="编辑客户资料" onClick={() => { setEditingCustomer(selectedCustomer); setCustomerEditorOpen(true); }}><Edit3 size={14} /></button><button className="icon-button" type="button" title={selectedCustomer.isActive ? '停用客户' : '启用客户'} onClick={() => { void toggleCustomer(selectedCustomer); }}>{selectedCustomer.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}</button><button className="icon-button danger" type="button" title="删除客户" onClick={() => { void removeCustomer(selectedCustomer); }}><Trash2 size={14} /></button></div>}
        </div>
        <div className="customer-products-toolbar">
          <div className="search-control customer-product-search"><Search size={15} /><input disabled={!selectedCustomer} value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="按品名、客户 SKU、规格筛选" /></div>
          <select aria-label="客户产品状态筛选" className="toolbar-select customer-product-status-select" disabled={!selectedCustomer} value={productStatus} onChange={(event) => setProductStatus(event.target.value as typeof productStatus)}><option value="all">全部状态</option><option value="complete">已完善</option><option value="incomplete">待完善</option></select>
          {selectedProductIds.length > 0 && <button className="button button-secondary" type="button" onClick={() => { void batchRemoveProducts(); }}><Trash2 size={14} />删除选中</button>}
          <button className="button button-primary" type="button" disabled={!activeCustomer} title="添加客户新品" onClick={() => { setEditingProduct(null); setProductEditorOpen(true); }}><Plus size={14} />添加客户产品</button>
        </div>
        <div className="table-scroll"><table className="data-table customer-products-table" style={{ minWidth: 1240 }}><thead><tr><th style={{ width: 34 }}><input type="checkbox" disabled={!products.length} checked={allVisibleSelected} onChange={() => setSelectedProductIds(allVisibleSelected ? [] : products.map((product) => product.id))} aria-label="全选客户产品" /></th>{['状态', '图片', '品名', '规格', '客户 SKU', '包装', '装箱数', '成本价', '最近报价', '最终价格', '运费/箱', '备注', '附件', '来源', '更新时间', '操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead><tbody>
          {products.map((product) => <tr key={product.id}>
            <td><input type="checkbox" checked={selectedProductIds.includes(product.id)} onChange={() => setSelectedProductIds((current) => current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id])} aria-label={`选择${product.name}`} /></td>
            <td><span style={{ display: 'inline-block', padding: '3px 6px', borderRadius: 4, background: product.completionStatus === 'complete' ? '#ecfdf5' : '#fff7ed', color: product.completionStatus === 'complete' ? '#047857' : '#b45309', whiteSpace: 'nowrap' }}>{product.completionStatus === 'complete' ? '已完善' : '待完善'}</span></td>
            <td>{product.imageRelativePath ? <img src={imageUrl(product.imageRelativePath)} alt={product.name} style={{ width: 42, height: 36, objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: 4 }} /> : <span style={{ color: '#cbd5e1' }}>-</span>}</td>
            <td className="strong-cell">{product.name || '-'}</td><td>{product.specification || '-'}</td><td>{product.sku || <span style={{ color: '#b45309' }}>待完善</span>}</td><td>{product.packaging.length ? product.packaging[0].name || `${product.packaging.length} 种` : '-'}</td><td>{product.packCount == null ? <span style={{ color: '#b45309' }}>待完善</span> : `${product.packCount} 个/箱`}</td><td>{money(product.costPriceCents)}</td><td>{money(product.latestQuoteCents)}</td><td className="strong-cell">{money(product.finalPriceCents)}</td><td>{product.freightPerBoxCents == null ? <span style={{ color: '#b45309' }}>未设置</span> : `¥${(product.freightPerBoxCents / 100).toFixed(2)}/箱`}</td><td className="customer-product-remark-cell" title={product.remark}>{product.remark || '-'}</td><td>{product.attachments.length ? `${product.attachments.length} 个` : '-'}</td><td><span style={{ color: product.systemProductId == null ? '#64748b' : '#0f766e' }}>{product.systemProductId == null ? '临时添加' : '系统产品库'}</span></td><td style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{formatTime(product.updatedAt)}</td>
            <td><div className="row-actions"><button className="icon-button" type="button" title="编辑客户产品" onClick={() => { setEditingProduct(product); setProductEditorOpen(true); }}><Edit3 size={14} /></button><button className="icon-button danger" type="button" title="删除客户产品" onClick={() => { void removeProduct(product); }}><Trash2 size={14} /></button></div></td>
          </tr>)}
        </tbody></table></div>
        {(loading || productLoading) && <div className="table-state">正在加载客户产品...</div>}
        {!loading && !productLoading && !products.length && <div className="table-state">{productError || (selectedCustomer ? '当前客户暂无产品，可从系统产品库导入或直接添加新品。' : '请先在左侧选择客户。')}</div>}
      </section>
    </div>

    <CustomerEditorModal open={customerEditorOpen} customer={editingCustomer} busy={customerBusy} onClose={() => { setCustomerEditorOpen(false); setEditingCustomer(null); }} onSave={saveCustomerProfile} />
    <CustomerProductEditorModal open={productEditorOpen} product={editingProduct} systemProducts={systemProducts} enableAttachments onClose={() => { setProductEditorOpen(false); setEditingProduct(null); }} onSave={saveProduct} />
  </div>;
}
