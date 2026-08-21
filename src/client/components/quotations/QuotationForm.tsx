import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Copy,
  Image as ImageIcon,
  Library,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type {
  CompanySnapshot,
  QuotationDisplayConfig,
  QuotationStatus,
} from '../../../shared/documents';
import type { Customer, CustomerProduct, CustomerProductSaveInput, CustomerSaveInput } from '../../../shared/customers';
import { calculateDocumentTotals } from '../../../shared/money';
import type { DocumentImageDraft, DocumentItemDraft, QuotationDraft as SharedQuotationDraft } from '../../documents/document-drafts';
import { createDocumentClientKey } from '../../documents/document-drafts';
import CompanySnapshotFields from '../documents/CompanySnapshotFields';
import DocumentColumnSettings from '../documents/DocumentColumnSettings';
import DocumentTotals from '../documents/DocumentTotals';
import LibraryProductPicker, { type LibraryProductSelection } from '../documents/LibraryProductPicker';
import CustomerSelector from '../customers/CustomerSelector';
import CustomerProductPicker from '../customer-products/CustomerProductPicker';
import CustomerProductEditorModal from '../customer-products/CustomerProductEditorModal';

export interface QuotationLineDraft extends DocumentItemDraft {
  image: DocumentImageDraft & { previewUrl?: string };
}

export interface QuotationCustomFieldDraft {
  clientKey?: string;
  id?: number;
  placement: 'header' | 'footer';
  label: string;
  value: string;
}

export interface QuotationDraft extends Omit<SharedQuotationDraft, 'items' | 'customFields'> {
  items: QuotationLineDraft[];
  customFields: QuotationCustomFieldDraft[];
}

export interface QuotationFormProps {
  customers: Customer[];
  value: QuotationDraft;
  saving?: boolean;
  onChange: (value: QuotationDraft) => void;
  onSave: (value: QuotationDraft) => Promise<void> | void;
  onCancel: () => void;
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

function emptyLine(): QuotationLineDraft {
  return {
    clientKey: createDocumentClientKey('quotation-line'),
    productId: null,
    customerProductId: null,
    isTemporary: true,
    productCode: '',
    name: '',
    sku: '',
    specification: '',
    parameters: '',
    packCount: '',
    image: { relativePath: null, originalName: '', mimeType: '' },
    quantity: '1',
    unitPrice: '',
    remark: '',
  };
}

function parseNonNegative(value: string): number | null {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
}

export default function QuotationForm({ customers, value, saving, onChange, onSave, onCancel, onSaveCustomerProduct, onCreateCustomer }: QuotationFormProps) {
  const [pickerLineKey, setPickerLineKey] = useState<string>();
  const [customerPickerLineKey, setCustomerPickerLineKey] = useState<string>();
  const [customerEditorLineKey, setCustomerEditorLineKey] = useState<string>();
  const [showColumns, setShowColumns] = useState(false);
  const [error, setError] = useState('');
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const setDraft = <K extends keyof QuotationDraft>(key: K, next: QuotationDraft[K]) => {
    onChange({ ...value, [key]: next });
  };
  const updateLine = (clientKey: string, patch: Partial<QuotationLineDraft>) => {
    setDraft('items', value.items.map((item) => item.clientKey === clientKey ? { ...item, ...patch } : item));
  };
  const updateField = (clientKey: string, patch: Partial<QuotationCustomFieldDraft>) => {
    setDraft('customFields', value.customFields.map((field) => (field.clientKey ?? String(field.id)) === clientKey ? { ...field, ...patch } : field));
  };
  const moveLine = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= value.items.length) return;
    const items = [...value.items];
    [items[index], items[target]] = [items[target], items[index]];
    setDraft('items', items);
  };
  const duplicateLine = (index: number) => {
    const source = value.items[index];
    const duplicate = { ...source, id: undefined, clientKey: createDocumentClientKey('quotation-line'), image: { ...source.image, file: undefined } };
    setDraft('items', [...value.items.slice(0, index + 1), duplicate, ...value.items.slice(index + 1)]);
  };
  const selectProduct = (lineKey: string, selection: LibraryProductSelection) => {
    const { product, image } = selection;
    updateLine(lineKey, {
      productId: product.id,
      customerProductId: null,
      isTemporary: false,
      name: product.name,
      sku: product.sku,
      specification: product.specification,
      parameters: product.parameters ?? '',
      image: {
        relativePath: image?.relativePath ?? null,
        originalName: image?.originalName ?? '',
        mimeType: '',
        previewUrl: image?.url,
      },
    });
    setPickerLineKey(undefined);
  };

  const selectCustomerProduct = (lineKey: string, product: CustomerProduct) => {
    updateLine(lineKey, {
      productId: product.systemProductId,
      customerProductId: product.id,
      isTemporary: product.systemProductId == null,
      productCode: product.sku,
      name: product.name,
      sku: product.sku,
      specification: product.specification,
      packCount: product.packCount == null ? '' : String(product.packCount),
      unitPrice: product.finalPriceCents == null ? '' : (product.finalPriceCents / 100).toFixed(2),
      image: { relativePath: product.imageRelativePath, originalName: '', mimeType: '' },
    });
    setCustomerPickerLineKey(undefined);
  };

  const chooseCustomer = (customerId: number | null, customer?: Customer) => {
    onChange({
      ...value,
      customerId,
      customerName: customer?.name ?? '',
      contactName: customer?.contactName ?? '',
      contactPhone: customer?.contactPhone ?? '',
      customerAddress: customer?.shippingInfo ?? '',
      items: value.items.map((item) => ({ ...item, customerProductId: null })),
    });
    setCustomerPickerLineKey(undefined);
  };

  const saveNewCustomerProduct = async (input: CustomerProductSaveInput) => {
    if (!value.customerId) throw new Error('请先选择客户');
    if (!onSaveCustomerProduct) throw new Error('当前页面暂不支持添加客户新品');
    const saved = await onSaveCustomerProduct(value.customerId, input);
    if (customerEditorLineKey) selectCustomerProduct(customerEditorLineKey, saved);
    setCustomerEditorLineKey(undefined);
  };

  const totals = useMemo(() => {
    const lines = value.items.map((item) => ({
      quantity: parseNonNegative(item.quantity) ?? 0,
      unitPriceCents: Math.max(0, Math.round((parseNonNegative(item.unitPrice) ?? 0) * 100)),
    }));
    const taxRate = parseNonNegative(value.taxRate);
    try {
      return calculateDocumentTotals(lines, Math.round((taxRate ?? 0) * 100));
    } catch {
      return { subtotalCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0 };
    }
  }, [value.items, value.taxRate]);

  const validate = (): boolean => {
    if (!value.customerName.trim()) return setError('请填写客户名称'), false;
    if (!value.quotationDate) return setError('请选择报价日期'), false;
    if (!value.items.length) return setError('至少需要一行产品'), false;
    const invalidIndex = value.items.findIndex((item) => !item.name.trim() || parseNonNegative(item.quantity) === null || parseNonNegative(item.unitPrice) === null);
    if (invalidIndex >= 0) return setError(`第 ${invalidIndex + 1} 行产品信息或金额无效`), false;
    const taxRate = parseNonNegative(value.taxRate);
    if (taxRate === null || taxRate > 100) return setError('税率必须在 0% 到 100% 之间'), false;
    setError('');
    return true;
  };

  const submit = () => {
    if (validate()) void onSave(value);
  };

  return <div className="quotation-form" style={{ display: 'grid', gap: 10, fontSize: 12 }}>
    <section style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>单据信息</strong>
        <select aria-label="报价状态" value={value.status} onChange={(event) => setDraft('status', event.target.value as QuotationStatus)} style={{ ...fieldStyle, width: 112 }}>
          <option value="draft">草稿</option><option value="sent">已发送</option><option value="won">已成交</option><option value="expired">已失效</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <label>报价日期<input type="date" value={value.quotationDate} onChange={(event) => setDraft('quotationDate', event.target.value)} style={fieldStyle} /></label>
        <label>有效期至<input type="date" value={value.validUntil} onChange={(event) => setDraft('validUntil', event.target.value)} style={fieldStyle} /></label>
      </div>
      <CustomerSelector value={value.customerId} customers={customers} onChange={chooseCustomer} onCreateCustomer={onCreateCustomer} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <label>客户名称<input value={value.customerName} onChange={(event) => setDraft('customerName', event.target.value)} style={fieldStyle} placeholder="可手动补充" /></label>
        <label>联系人<input value={value.contactName} onChange={(event) => setDraft('contactName', event.target.value)} style={fieldStyle} /></label>
        <label>联系电话<input value={value.contactPhone} onChange={(event) => setDraft('contactPhone', event.target.value)} style={fieldStyle} /></label>
      </div>
      <label>客户地址/收件信息<textarea rows={2} value={value.customerAddress} onChange={(event) => setDraft('customerAddress', event.target.value)} style={{ ...fieldStyle, resize: 'vertical' }} /></label>
    </section>

    <section style={sectionStyle}>
      <strong style={{ fontSize: 13 }}>公司显示</strong>
      <CompanySnapshotFields value={value.companySnapshot} onChange={(companySnapshot) => setDraft('companySnapshot', companySnapshot)} display={{ showLogo: value.displayConfig.showLogo, showCompanyPhone: value.displayConfig.showCompanyPhone, showCompanyAddress: value.displayConfig.showCompanyAddress }} onDisplayChange={(display) => setDraft('displayConfig', { ...value.displayConfig, ...display })} />
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><input type="checkbox" checked={value.displayConfig.showContactPhone} onChange={(event) => setDraft('displayConfig', { ...value.displayConfig, showContactPhone: event.target.checked })} />显示客户联系电话</label>
    </section>

    <section style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>产品明细</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="icon-button" title="设置报价单显示列" onClick={() => setShowColumns((current) => !current)}><Columns3 size={15} /></button>
          <button type="button" className="button" title="添加临时产品" onClick={() => setDraft('items', [...value.items, emptyLine()])}><Plus size={14} />临时产品</button>
        </div>
      </div>
      {showColumns && <div style={{ padding: 8, background: '#f8fafc', borderRadius: 5 }}><DocumentColumnSettings kind="quotation" value={value.displayConfig.columns} onChange={(columns) => setDraft('displayConfig', { ...value.displayConfig, columns: columns as QuotationDisplayConfig['columns'] })} /></div>}
      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 5 }}>
        <table style={{ width: '100%', minWidth: 1000, borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}>
            <th style={{ padding: 7, width: 30 }}>#</th><th style={{ padding: 7, minWidth: 170 }}>产品</th><th style={{ padding: 7, width: 120 }}>SKU</th><th style={{ padding: 7, width: 150 }}>规格</th><th style={{ padding: 7, width: 72 }}>数量</th><th style={{ padding: 7, width: 100 }}>单价</th><th style={{ padding: 7, width: 105 }}>金额</th><th style={{ padding: 7, minWidth: 130 }}>备注</th><th style={{ padding: 7, width: 154 }}>操作</th>
          </tr></thead>
          <tbody>{value.items.map((item, index) => {
            const quantity = parseNonNegative(item.quantity);
            const unitPrice = parseNonNegative(item.unitPrice);
            const amount = Math.round((quantity ?? 0) * (unitPrice ?? 0) * 100);
            const imageUrl = item.image.previewUrl ?? (item.image.relativePath ? `/files/${item.image.relativePath}` : undefined);
            return <tr key={item.clientKey} style={{ borderTop: '1px solid #edf0f2', verticalAlign: 'top' }}>
              <td style={{ padding: 7, color: '#94a3b8' }}>{index + 1}</td>
              <td style={{ padding: 7 }}><div style={{ display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) 28px', gap: 5, alignItems: 'center' }}>
                <button type="button" title={imageUrl ? '更换产品图片' : '添加产品图片'} onClick={() => fileInputs.current[item.clientKey]?.click()} style={{ width: 36, height: 36, padding: 0, border: '1px solid #dbe3ea', borderRadius: 4, background: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden', cursor: 'pointer' }}>{imageUrl ? <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon size={15} color="#94a3b8" />}</button>
                <input value={item.name} onChange={(event) => updateLine(item.clientKey, { name: event.target.value, isTemporary: item.productId == null })} style={fieldStyle} placeholder="品名" />
                <div style={{ display: 'inline-flex', gap: 2 }}>
                  <button type="button" className="icon-button" title="从客户产品库选择" onClick={() => setCustomerPickerLineKey(customerPickerLineKey === item.clientKey ? undefined : item.clientKey)}><span style={{ fontSize: 11, fontWeight: 700 }}>客</span></button>
                  <button type="button" className="icon-button" title="从系统产品库选择" onClick={() => setPickerLineKey(pickerLineKey === item.clientKey ? undefined : item.clientKey)}><Library size={14} /></button>
                </div>
                <input ref={(node) => { fileInputs.current[item.clientKey] = node; }} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; updateLine(item.clientKey, { image: { relativePath: null, originalName: file.name, mimeType: file.type, file, previewUrl: URL.createObjectURL(file) }, isTemporary: true }); event.target.value = ''; }} />
              </div>
              {customerPickerLineKey === item.clientKey && <div style={{ position: 'relative' }}><div style={{ position: 'absolute', zIndex: 6, top: 5, left: 0, width: 430, maxHeight: 340, overflow: 'auto', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', boxShadow: '0 12px 28px rgba(15,23,42,.16)', padding: 8 }}>
                <CustomerProductPicker customerId={value.customerId} value={item.customerProductId} onSelect={(product) => selectCustomerProduct(item.clientKey, product)} onAddNew={() => setCustomerEditorLineKey(item.clientKey)} />
              </div></div>}
              {pickerLineKey === item.clientKey && <div style={{ position: 'relative' }}><div style={{ position: 'absolute', zIndex: 5, top: 5, left: 0, width: 390, maxHeight: 260, overflow: 'auto', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', boxShadow: '0 12px 28px rgba(15,23,42,.16)', padding: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 5 }}><button type="button" className="icon-button" title="关闭产品库" onClick={() => setPickerLineKey(undefined)}><X size={14} /></button></div>
                <LibraryProductPicker selectedProductId={item.productId} onSelect={(selection) => selectProduct(item.clientKey, selection)} />
              </div></div>}
              </td>
              <td style={{ padding: 7 }}><input value={item.sku} onChange={(event) => updateLine(item.clientKey, { sku: event.target.value })} style={fieldStyle} /></td>
              <td style={{ padding: 7 }}><input value={item.specification} onChange={(event) => updateLine(item.clientKey, { specification: event.target.value })} style={fieldStyle} /></td>
              <td style={{ padding: 7 }}><input type="number" min="0" step="any" value={item.quantity} onChange={(event) => updateLine(item.clientKey, { quantity: event.target.value })} style={{ ...fieldStyle, borderColor: quantity === null ? '#dc2626' : '#dbe3ea' }} /></td>
              <td style={{ padding: 7 }}><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateLine(item.clientKey, { unitPrice: event.target.value })} style={{ ...fieldStyle, borderColor: unitPrice === null ? '#dc2626' : '#dbe3ea' }} /></td>
              <td style={{ padding: 10, fontWeight: 650, whiteSpace: 'nowrap' }}>{formatMoney(amount)}</td>
              <td style={{ padding: 7 }}><input value={item.remark} onChange={(event) => updateLine(item.clientKey, { remark: event.target.value })} style={fieldStyle} /></td>
              <td style={{ padding: 7 }}><div style={{ display: 'flex', gap: 3 }}><button type="button" className="icon-button" title="上移产品行" disabled={index === 0} onClick={() => moveLine(index, -1)}><ArrowUp size={14} /></button><button type="button" className="icon-button" title="下移产品行" disabled={index === value.items.length - 1} onClick={() => moveLine(index, 1)}><ArrowDown size={14} /></button><button type="button" className="icon-button" title="复制产品行" onClick={() => duplicateLine(index)}><Copy size={14} /></button><button type="button" className="icon-button danger" title="删除产品行" onClick={() => setDraft('items', value.items.filter((line) => line.clientKey !== item.clientKey))}><Trash2 size={14} /></button></div></td>
            </tr>;
          })}</tbody>
        </table>
        {!value.items.length && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>暂无产品，点击“临时产品”添加或从系统产品库调用。</div>}
      </div>
    </section>

    <section style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong style={{ fontSize: 13 }}>自定义字段</strong><button type="button" className="icon-button" title="添加自定义字段" onClick={() => setDraft('customFields', [...value.customFields, { clientKey: createDocumentClientKey('quotation-field'), placement: 'footer', label: '', value: '' }])}><Plus size={15} /></button></div>
      {value.customFields.map((field) => { const fieldKey = field.clientKey ?? String(field.id); return <div key={fieldKey} style={{ display: 'grid', gridTemplateColumns: '100px 180px 1fr 30px', gap: 6 }}><select aria-label="字段位置" value={field.placement} onChange={(event) => updateField(fieldKey, { placement: event.target.value as 'header' | 'footer' })} style={fieldStyle}><option value="header">顶部</option><option value="footer">底部</option></select><input aria-label="字段名称" value={field.label} onChange={(event) => updateField(fieldKey, { label: event.target.value })} placeholder="字段名称" style={fieldStyle} /><input aria-label="字段内容" value={field.value} onChange={(event) => updateField(fieldKey, { value: event.target.value })} placeholder="字段内容" style={fieldStyle} /><button type="button" className="icon-button danger" title="删除自定义字段" onClick={() => setDraft('customFields', value.customFields.filter((item) => (item.clientKey ?? String(item.id)) !== fieldKey))}><Trash2 size={14} /></button></div>; })}
      {!value.customFields.length && <span style={{ color: '#94a3b8' }}>没有自定义字段</span>}
    </section>

    <section style={{ ...sectionStyle, gridTemplateColumns: 'minmax(0, 1fr) 280px', alignItems: 'start' }}>
      <label>报价备注<textarea rows={4} value={value.remark} onChange={(event) => setDraft('remark', event.target.value)} style={{ ...fieldStyle, resize: 'vertical' }} placeholder="付款方式、交期或其他说明" /></label>
      <div style={{ display: 'grid', gap: 7 }}>
        <label style={{ display: 'grid', gridTemplateColumns: '1fr 90px', alignItems: 'center', gap: 8 }}>税率（%）<input type="number" min="0" max="100" step="0.01" value={value.taxRate} onChange={(event) => setDraft('taxRate', event.target.value)} style={fieldStyle} /></label>
        <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={value.displayConfig.showTax} onChange={(event) => setDraft('displayConfig', { ...value.displayConfig, showTax: event.target.checked })} />PDF 显示税额</label>
        <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={value.displayConfig.showTaxIncludedTotal} onChange={(event) => setDraft('displayConfig', { ...value.displayConfig, showTaxIncludedTotal: event.target.checked })} />PDF 显示含税合计</label>
        <DocumentTotals subtotalCents={totals.subtotalCents} taxRateBps={Math.round((parseNonNegative(value.taxRate) ?? 0) * 100)} taxCents={totals.taxCents} totalCents={totals.totalCents} showTax={value.displayConfig.showTax} />
      </div>
    </section>

    {error && <div role="alert" style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, padding: '8px 10px' }}>{error}</div>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, position: 'sticky', bottom: -18, padding: '10px 0', background: '#fff' }}>
      <button type="button" className="button" title="取消编辑" onClick={onCancel}><X size={15} />取消</button>
      <button type="button" className="button button-primary" title="保存报价单" disabled={saving} onClick={submit}><Save size={15} />{saving ? '正在保存' : '保存报价单'}</button>
    </div>
    <CustomerProductEditorModal open={customerEditorLineKey != null} product={null} layer={40} onClose={() => setCustomerEditorLineKey(undefined)} onSave={saveNewCustomerProduct} />
  </div>;
}

export function createEmptyQuotationDraft(companySnapshot?: CompanySnapshot): QuotationDraft {
  const today = new Date().toISOString().slice(0, 10);
  const validUntil = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  return {
    number: '',
    status: 'draft',
    quotationDate: today,
    customerId: null,
    customerName: '',
    contactName: '',
    contactPhone: '',
    customerAddress: '',
    validUntil,
    remark: '',
    taxRate: '0',
    subtotal: '0.00',
    tax: '0.00',
    total: '0.00',
    companySnapshot: companySnapshot ?? { name: '', logoRelativePath: null, phone: '', address: '', defaultIssuer: '' },
    displayConfig: {
      showLogo: true,
      showCompanyPhone: true,
      showCompanyAddress: true,
      showContactPhone: true,
      showTax: true,
      showTaxIncludedTotal: true,
      columns: { image: true, name: true, sku: true, specification: true, quantity: true, unitPrice: true, amount: true, remark: true },
    },
    items: [emptyLine()],
    customFields: [],
  };
}
