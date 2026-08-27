import { ArrowDown, ArrowUp, Copy, Image as ImageIcon, Library, Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CompanySnapshot,
  SalesDocumentDisplayConfig,
  SalesReceipt,
} from '../../../shared/documents';
import type { Customer, CustomerProduct, CustomerProductSaveInput, CustomerSaveInput } from '../../../shared/customers';
import { calculateDocumentTotals } from '../../../shared/money';
import { calculateFreightCents } from '../../../shared/order-prices';
import type { DocumentItemDraft, SalesDocumentDraft } from '../../documents/document-drafts';
import { createDocumentClientKey } from '../../documents/document-drafts';
import CompanySnapshotFields from '../documents/CompanySnapshotFields';
import DocumentColumnSettings, { DEFAULT_SALES_COLUMNS } from '../documents/DocumentColumnSettings';
import DocumentTotals from '../documents/DocumentTotals';
import LibraryProductPicker, { type LibraryProductSelection } from '../documents/LibraryProductPicker';
import CustomerSelector from '../customers/CustomerSelector';
import CustomerProductPicker from '../customer-products/CustomerProductPicker';
import CustomerProductEditorModal from '../customer-products/CustomerProductEditorModal';
import ReceiptEditor from './ReceiptEditor';

export interface SalesDocumentFormProps {
  customers: Customer[];
  value: SalesDocumentDraft;
  receipts: SalesReceipt[];
  saving?: boolean;
  onChange: (value: SalesDocumentDraft) => void;
  onSave: (value: SalesDocumentDraft) => Promise<void> | void;
  onCancel: () => void;
  onRefreshReceipts: () => Promise<void> | void;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onSaveCustomerProduct?: (customerId: number, input: CustomerProductSaveInput) => Promise<CustomerProduct>;
  onCreateCustomer?: (input: CustomerSaveInput) => Promise<Customer>;
}

const fieldStyle = {
  width: '100%',
  minWidth: 0,
  border: '1px solid var(--control-border)',
  borderRadius: 'var(--radius-control)',
  padding: '7px 8px',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 'var(--text-xs)',
  background: 'var(--control-bg)',
};

const sectionStyle = {
  display: 'grid',
  gap: 'var(--space-4)',
  padding: 'var(--space-5)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-control)',
  background: 'var(--color-surface)',
};

const statusLabels = { draft: '草稿', issued: '已开单', void: '已作废' } as const;

function emptyLine(isTemporary = true): DocumentItemDraft {
  return {
    clientKey: createDocumentClientKey('sales-line'),
    productId: null,
    customerProductId: null,
    isTemporary,
    productCode: '',
    name: '',
    sku: '',
    specification: '',
    parameters: '',
    packCount: '',
    quantity: '1',
    unitPrice: '',
    remark: '',
    freightPerBoxCents: null,
    image: { relativePath: null, originalName: '', mimeType: '' },
  };
}

function parseNonNegative(value: string): number | null {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function lineBoxCount(quantity: number, packCount: string): number | null {
  const boxes = Number(packCount);
  if (quantity <= 0 || !Number.isFinite(boxes) || boxes < 1) return null;
  return Math.ceil(quantity / boxes);
}

function lineFreightCents(item: DocumentItemDraft): { boxes: number; freightPerBoxCents: number } | null {
  if (item.freightPerBoxCents == null) return null;
  const quantity = parseNonNegative(item.quantity);
  if (quantity === null) return null;
  const boxes = lineBoxCount(quantity, item.packCount);
  return boxes == null ? null : { boxes, freightPerBoxCents: item.freightPerBoxCents };
}

export function createEmptySalesDocumentDraft(company?: CompanySnapshot): SalesDocumentDraft {
  const companySnapshot = company ?? { name: '', logoRelativePath: null, phone: '', address: '', defaultIssuer: '' };
  return {
    number: '',
    documentStatus: 'draft',
    documentDate: new Date().toISOString().slice(0, 10),
    customerId: null,
    customerName: '',
    contactName: '',
    contactPhone: '',
    customerAddress: '',
    purchaseOrderNo: '',
    shipping: '0.00',
    taxRate: '0.00',
    subtotal: '0.00',
    tax: '0.00',
    total: '0.00',
    received: '0.00',
    outstanding: '0.00',
    issuer: companySnapshot.defaultIssuer,
    consignee: '',
    remark: '',
    companySnapshot: { ...companySnapshot },
    displayConfig: {
      showLogo: Boolean(companySnapshot.logoRelativePath),
      showCompanyPhone: Boolean(companySnapshot.phone),
      showCompanyAddress: Boolean(companySnapshot.address),
      showProductImages: true,
      columns: { ...DEFAULT_SALES_COLUMNS },
    },
    sourceQuotationId: null,
    items: [emptyLine()],
  };
}

export default function SalesDocumentForm({
  customers,
  value,
  receipts,
  saving,
  onChange,
  onSave,
  onCancel,
  onRefreshReceipts,
  onNotify,
  onSaveCustomerProduct,
  onCreateCustomer,
}: SalesDocumentFormProps) {
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showCustomerProductPicker, setShowCustomerProductPicker] = useState(false);
  const [customerProductEditorOpen, setCustomerProductEditorOpen] = useState(false);
  const [error, setError] = useState('');
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const localImageUrls = useMemo(() => new Map(
    value.items
      .filter((item): item is DocumentItemDraft & { image: DocumentItemDraft['image'] & { file: File } } => Boolean(item.image.file))
      .map((item) => [item.clientKey, URL.createObjectURL(item.image.file)]),
  ), [value.items]);

  useEffect(() => () => {
    localImageUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [localImageUrls]);

  const [shippingOverridden, setShippingOverridden] = useState(Boolean(value.id));
  const calculatedFreightCents = useMemo(() => {
    const freightLines = value.items
      .map(lineFreightCents)
      .filter((line): line is { boxes: number; freightPerBoxCents: number } => line != null);
    if (!freightLines.length) return 0;
    try {
      return calculateFreightCents(freightLines);
    } catch {
      return 0;
    }
  }, [value.items]);

  const setDraft = <K extends keyof SalesDocumentDraft>(key: K, next: SalesDocumentDraft[K]) => {
    onChange({ ...value, [key]: next });
  };
  const updateLine = (clientKey: string, patch: Partial<DocumentItemDraft>) => {
    setDraft('items', value.items.map((line) => line.clientKey === clientKey ? { ...line, ...patch } : line));
  };
  const moveLine = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= value.items.length) return;
    const next = [...value.items];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft('items', next);
  };
  const duplicateLine = (index: number) => {
    const source = value.items[index];
    const duplicate: DocumentItemDraft = {
      ...source,
      id: undefined,
      clientKey: createDocumentClientKey('sales-line'),
      image: { ...source.image, file: undefined },
    };
    setDraft('items', [...value.items.slice(0, index + 1), duplicate, ...value.items.slice(index + 1)]);
  };
  const addLibraryProduct = ({ product, image }: LibraryProductSelection) => {
    const line: DocumentItemDraft = {
      ...emptyLine(false),
      productId: product.id,
      isTemporary: false,
      productCode: product.sku,
      name: product.name,
      sku: product.sku,
      specification: product.specification,
      parameters: product.parameters ?? '',
      image: {
        relativePath: image?.relativePath ?? null,
        originalName: image?.originalName ?? '',
        mimeType: '',
      },
    };
    const replaceEmpty = value.items.length === 1 && !value.items[0].name.trim();
    setDraft('items', replaceEmpty ? [line] : [...value.items, line]);
    setShowProductPicker(false);
  };

  const addCustomerProduct = (product: CustomerProduct) => {
    const line: DocumentItemDraft = {
      ...emptyLine(product.systemProductId == null),
      productId: product.systemProductId,
      customerProductId: product.id,
      isTemporary: product.systemProductId == null,
      productCode: product.sku,
      name: product.name,
      sku: product.sku,
      specification: product.specification,
      packCount: product.packCount == null ? '' : String(product.packCount),
      unitPrice: product.finalPriceCents == null ? '' : (product.finalPriceCents / 100).toFixed(2),
      freightPerBoxCents: product.freightPerBoxCents ?? null,
      image: { relativePath: product.imageRelativePath, originalName: '', mimeType: '' },
    };
    const replaceEmpty = value.items.length === 1 && !value.items[0].name.trim();
    setDraft('items', replaceEmpty ? [line] : [...value.items, line]);
    setShowCustomerProductPicker(false);
  };

  const chooseCustomer = (customerId: number | null, customer?: Customer) => {
    onChange({
      ...value,
      customerId,
      customerName: customer?.name ?? '',
      contactName: customer?.contactName ?? '',
      contactPhone: customer?.contactPhone ?? '',
      customerAddress: customer?.shippingInfo ?? '',
      items: value.items.map((item) => ({ ...item, customerProductId: null, freightPerBoxCents: null })),
    });
    setShowCustomerProductPicker(false);
  };

  const saveNewCustomerProduct = async (input: CustomerProductSaveInput) => {
    if (!value.customerId) throw new Error('请先选择客户');
    if (!onSaveCustomerProduct) throw new Error('当前页面暂不支持添加客户新品');
    const saved = await onSaveCustomerProduct(value.customerId, input);
    addCustomerProduct(saved);
    setCustomerProductEditorOpen(false);
  };

  const totals = useMemo(() => {
    const lines = value.items.map((item) => ({
      quantity: parseNonNegative(item.quantity) ?? 0,
      unitPriceCents: Math.round((parseNonNegative(item.unitPrice) ?? 0) * 100),
    }));
    const shipping = Math.round((parseNonNegative(value.shipping) ?? 0) * 100);
    const taxRate = Math.round((parseNonNegative(value.taxRate) ?? 0) * 100);
    try {
      return calculateDocumentTotals(lines, taxRate, shipping);
    } catch {
      return { subtotalCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0 };
    }
  }, [value.items, value.shipping, value.taxRate]);

  const receivedCents = receipts.reduce((sum, receipt) => sum + receipt.amountCents, 0);
  const outstandingCents = Math.max(0, totals.totalCents - receivedCents);

  useEffect(() => {
    if (shippingOverridden) return;
    const current = Math.round((parseNonNegative(value.shipping) ?? 0) * 100);
    if (current !== calculatedFreightCents) setDraft('shipping', (calculatedFreightCents / 100).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculatedFreightCents, shippingOverridden, value.shipping]);

  const validate = (): boolean => {
    if (!value.documentDate) return setError('请选择开单日期'), false;
    if (!value.customerName.trim()) return setError('请填写客户名称'), false;
    if (!value.items.length) return setError('至少需要一行产品'), false;
    const invalidLine = value.items.findIndex((line) => (
      !line.name.trim()
      || parseNonNegative(line.quantity) === null
      || parseNonNegative(line.unitPrice) === null
    ));
    if (invalidLine >= 0) return setError(`第 ${invalidLine + 1} 行产品信息、数量或单价无效`), false;
    const shipping = parseNonNegative(value.shipping);
    if (shipping === null) return setError('运费不能小于 0'), false;
    const taxRate = parseNonNegative(value.taxRate);
    if (taxRate === null || taxRate > 100) return setError('税率必须在 0% 到 100% 之间'), false;
    if (receivedCents > totals.totalCents) return setError('当前销售单合计不能小于已收金额'), false;
    setError('');
    return true;
  };

  return <div className="sales-document-form" style={{ display: 'grid', gap: 10, fontSize: 12 }}>
    <section style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>单据信息</strong>
        <span title="请在销售单列表中变更状态" style={{ padding: '5px 9px', border: '1px solid #dbe3ea', borderRadius: 5, color: '#475569', background: '#f8fafc' }}>{statusLabels[value.documentStatus]}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        <label>开单日期<input type="date" value={value.documentDate} onChange={(event) => setDraft('documentDate', event.target.value)} style={fieldStyle} /></label>
        <label>采购单号<input value={value.purchaseOrderNo} onChange={(event) => setDraft('purchaseOrderNo', event.target.value)} style={fieldStyle} /></label>
        <label>开单人<input value={value.issuer} onChange={(event) => setDraft('issuer', event.target.value)} style={fieldStyle} /></label>
        <label>收货人<input value={value.consignee} onChange={(event) => setDraft('consignee', event.target.value)} style={fieldStyle} /></label>
      </div>
      <CustomerSelector value={value.customerId} customers={customers} onChange={chooseCustomer} onCreateCustomer={onCreateCustomer} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <label>客户名称<input value={value.customerName} onChange={(event) => setDraft('customerName', event.target.value)} style={fieldStyle} /></label>
        <label>联系人<input value={value.contactName} onChange={(event) => setDraft('contactName', event.target.value)} style={fieldStyle} /></label>
        <label>联系电话<input value={value.contactPhone} onChange={(event) => setDraft('contactPhone', event.target.value)} style={fieldStyle} /></label>
      </div>
      <label>客户地址/收件信息<textarea rows={2} value={value.customerAddress} onChange={(event) => setDraft('customerAddress', event.target.value)} style={{ ...fieldStyle, resize: 'vertical' }} /></label>
    </section>

    <section style={sectionStyle}>
      <strong style={{ fontSize: 13 }}>公司显示</strong>
      <CompanySnapshotFields
        value={value.companySnapshot}
        onChange={(companySnapshot) => setDraft('companySnapshot', companySnapshot)}
        display={value.displayConfig}
        onDisplayChange={(display) => setDraft('displayConfig', { ...value.displayConfig, ...display })}
      />
    </section>

    <section style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>产品明细</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="button" title="按当前客户调用产品" onClick={() => setShowCustomerProductPicker((current) => !current)}><span style={{ fontSize: 11, fontWeight: 700 }}>客</span>客户产品库</button>
          <button type="button" className="button" title="从系统产品库添加" onClick={() => setShowProductPicker((current) => !current)}><Library size={14} />产品库</button>
          <button type="button" className="button" title="添加临时产品" onClick={() => setDraft('items', [...value.items, emptyLine()])}><Plus size={14} />临时产品</button>
        </div>
      </div>
      {showCustomerProductPicker && <div style={{ padding: 10, border: '1px solid #99f6e4', borderRadius: 6, background: '#f0fdfa' }}><CustomerProductPicker customerId={value.customerId} onSelect={addCustomerProduct} onAddNew={() => setCustomerProductEditorOpen(true)} /></div>}
      {showProductPicker && <div style={{ padding: 10, border: '1px solid #cbd5e1', borderRadius: 6, background: '#f8fafc' }}><LibraryProductPicker onSelect={addLibraryProduct} /></div>}
      <DocumentColumnSettings
        kind="sales"
        value={value.displayConfig.columns}
        onChange={(columns) => setDraft('displayConfig', { ...value.displayConfig, columns: { ...value.displayConfig.columns, ...columns } })}
        showProductImages={value.displayConfig.showProductImages}
        onShowProductImagesChange={(showProductImages) => setDraft('displayConfig', { ...value.displayConfig, showProductImages })}
      />
      <div className="sticky-thead" style={{ overflow: 'auto', maxHeight: 'min(56vh, 480px)', border: '1px solid #e2e8f0', borderRadius: 5 }}>
        <table style={{ width: '100%', minWidth: 1060, borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}>
            <th style={{ padding: 7, width: 30 }}>#</th><th style={{ padding: 7, width: 120 }}>产品代码</th><th style={{ padding: 7, minWidth: 180 }}>产品名称</th><th style={{ padding: 7, width: 150 }}>规格</th><th style={{ padding: 7, width: 76 }}>数量</th><th style={{ padding: 7, width: 105 }}>单价</th><th style={{ padding: 7, width: 110 }}>金额</th><th style={{ padding: 7, minWidth: 140 }}>备注</th><th style={{ padding: 7, width: 145 }}>操作</th>
          </tr></thead>
          <tbody>{value.items.map((item, index) => {
            const quantity = parseNonNegative(item.quantity);
            const unitPrice = parseNonNegative(item.unitPrice);
            const amount = Math.round((quantity ?? 0) * (unitPrice ?? 0) * 100);
            const preview = localImageUrls.get(item.clientKey) ?? (item.image.relativePath ? `/files/${item.image.relativePath}` : '');
            return <tr key={item.clientKey} style={{ borderTop: '1px solid #edf0f2', verticalAlign: 'top' }}>
              <td style={{ padding: 7, color: '#94a3b8' }}>{index + 1}</td>
              <td style={{ padding: 7 }}><input value={item.productCode} onChange={(event) => updateLine(item.clientKey, { productCode: event.target.value, sku: event.target.value })} style={fieldStyle} /></td>
              <td style={{ padding: 7 }}><div style={{ display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr)', gap: 6, alignItems: 'center' }}>
                <button type="button" title={preview ? '更换产品图片' : '添加产品图片'} onClick={() => fileInputs.current[item.clientKey]?.click()} style={{ width: 36, height: 36, padding: 0, border: '1px solid #dbe3ea', borderRadius: 4, background: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden', cursor: 'pointer' }}>{preview ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon size={15} color="#94a3b8" />}</button>
                <input value={item.name} onChange={(event) => updateLine(item.clientKey, { name: event.target.value, isTemporary: item.productId == null })} style={fieldStyle} placeholder="品名" />
                <input ref={(node) => { fileInputs.current[item.clientKey] = node; }} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; updateLine(item.clientKey, { image: { relativePath: null, originalName: file.name, mimeType: file.type, file } }); event.target.value = ''; }} />
              </div></td>
              <td style={{ padding: 7 }}><input value={item.specification} onChange={(event) => updateLine(item.clientKey, { specification: event.target.value })} style={fieldStyle} /></td>
              <td style={{ padding: 7 }}><input type="number" min="0" step="any" value={item.quantity} onChange={(event) => updateLine(item.clientKey, { quantity: event.target.value })} style={{ ...fieldStyle, borderColor: quantity === null ? '#dc2626' : '#dbe3ea' }} /></td>
              <td style={{ padding: 7 }}><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateLine(item.clientKey, { unitPrice: event.target.value })} style={{ ...fieldStyle, borderColor: unitPrice === null ? '#dc2626' : '#dbe3ea' }} />{item.customerProductId != null && !item.unitPrice.trim() && <small style={{ display: 'block', marginTop: 3, color: '#b45309' }}>客户价格待完善</small>}</td>
              <td style={{ padding: 10, fontWeight: 650, whiteSpace: 'nowrap' }}>¥{(amount / 100).toFixed(2)}</td>
              <td style={{ padding: 7 }}><input value={item.remark} onChange={(event) => updateLine(item.clientKey, { remark: event.target.value })} style={fieldStyle} /></td>
              <td style={{ padding: 7 }}><div style={{ display: 'flex', gap: 3 }}>
                <button type="button" className="icon-button" title="上移产品行" disabled={index === 0} onClick={() => moveLine(index, -1)}><ArrowUp size={14} /></button>
                <button type="button" className="icon-button" title="下移产品行" disabled={index === value.items.length - 1} onClick={() => moveLine(index, 1)}><ArrowDown size={14} /></button>
                <button type="button" className="icon-button" title="复制产品行" onClick={() => duplicateLine(index)}><Copy size={14} /></button>
                <button type="button" className="icon-button danger" title="删除产品行" onClick={() => setDraft('items', value.items.filter((line) => line.clientKey !== item.clientKey))}><Trash2 size={14} /></button>
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>

    <section style={{ ...sectionStyle, gridTemplateColumns: 'minmax(0, 1fr) 300px', alignItems: 'start' }}>
      <label>备注<textarea rows={4} value={value.remark} onChange={(event) => setDraft('remark', event.target.value)} style={{ ...fieldStyle, resize: 'vertical' }} placeholder="交货、付款或其他说明" /></label>
      <div style={{ display: 'grid', gap: 8 }}>
        <label style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center', gap: 8 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>运费{!shippingOverridden && <small style={{ color: '#0f766e' }}>自动</small>}</span><input type="number" min="0" step="0.01" value={value.shipping} onChange={(event) => { setShippingOverridden(true); setDraft('shipping', event.target.value); }} style={fieldStyle} /></label>
        <label style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center', gap: 8 }}>税率（%）<input type="number" min="0" max="100" step="0.01" value={value.taxRate} onChange={(event) => setDraft('taxRate', event.target.value)} style={fieldStyle} /></label>
        <DocumentTotals {...totals} receivedCents={receivedCents} outstandingCents={outstandingCents} showOutstanding />
      </div>
    </section>

    <ReceiptEditor documentId={value.id} receipts={receipts} disabled={value.documentStatus === 'void'} onRefresh={onRefreshReceipts} onNotify={onNotify} />

    <CustomerProductEditorModal open={customerProductEditorOpen} product={null} layer={40} onClose={() => setCustomerProductEditorOpen(false)} onSave={saveNewCustomerProduct} />

    {error && <div role="alert" style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, padding: '8px 10px' }}>{error}</div>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, position: 'sticky', bottom: -18, padding: '10px 0', background: '#fff' }}>
      <button type="button" className="button" title="取消编辑" onClick={onCancel}><X size={15} />关闭</button>
      <button type="button" className="button button-primary" title="保存销售单" disabled={saving || value.documentStatus === 'void'} onClick={() => { if (validate()) void onSave(value); }}><Save size={15} />{saving ? '正在保存' : value.id ? '保存修改' : '保存并继续收款'}</button>
    </div>
  </div>;
}
