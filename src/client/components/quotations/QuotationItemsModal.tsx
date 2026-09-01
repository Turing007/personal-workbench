import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Copy,
  Image as ImageIcon,
  Library,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { QuotationDisplayConfig } from '../../../shared/documents';
import type { CustomerProduct, CustomerProductSaveInput } from '../../../shared/customers';
import type { DocumentItemPriceTierDraft } from '../../documents/document-drafts';
import { createDocumentClientKey } from '../../documents/document-drafts';
import Modal from '../Modal';
import DocumentColumnSettings from '../documents/DocumentColumnSettings';
import LibraryProductPicker, { type LibraryProductSelection } from '../documents/LibraryProductPicker';
import CustomerProductPicker from '../customer-products/CustomerProductPicker';
import CustomerProductEditorModal from '../customer-products/CustomerProductEditorModal';
import { emptyLine, parseNonNegative, type QuotationLineDraft } from './quotation-lines';

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

interface AnchoredPopoverState {
  lineKey: string;
  anchor: HTMLElement;
}

/**
 * 以 fixed 定位挂在 body 上的锚定弹层：脱离表格滚动容器（overflow: auto）的裁剪，
 * 保证“客户产品库 / 系统产品库”选择面板始终完整显示。空间不足时自动向上翻转。
 */
function AnchoredPopover({ anchor, width, maxHeight, onClose, children }: {
  anchor: HTMLElement;
  width: number;
  maxHeight: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties>();
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popoverWidth = Math.min(width, viewportWidth - 16);
    const left = Math.max(8, Math.min(rect.left, viewportWidth - popoverWidth - 8));
    const roomBelow = viewportHeight - rect.bottom - 8;
    const flipUp = roomBelow < Math.min(240, maxHeight);
    const top = flipUp ? Math.max(8, rect.top - 4 - Math.min(maxHeight, rect.top - 12)) : rect.bottom + 4;
    const height = Math.min(maxHeight, flipUp ? Math.max(120, rect.top - 12) : Math.max(120, roomBelow));
    setStyle({ position: 'fixed', left, top, width: popoverWidth, maxHeight: height, overflow: 'auto' });
  }, [anchor, width, maxHeight]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || anchor.contains(target)) return;
      onCloseRef.current();
    };
    // 捕获阶段拦截 Escape，避免把承载明细的整层弹窗一起关掉
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    // 任何容器滚动都会让锚点错位，直接关闭（弹层自身滚动除外）
    const handleScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      onCloseRef.current();
    };
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [anchor]);

  return createPortal(
    <div ref={popoverRef} style={{ zIndex: 50, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', boxShadow: '0 12px 28px rgba(15,23,42,.16)', padding: 8, ...style }}>
      {children}
    </div>,
    document.body,
  );
}

export interface QuotationItemsModalProps {
  open: boolean;
  customerId: number | null;
  items: QuotationLineDraft[];
  /** 由外部校验触发的错误提示（例如保存时发现明细有误），显示在弹窗顶部。 */
  error?: string;
  /** 报价单显示列配置，与 PDF 导出列共用。 */
  columns: QuotationDisplayConfig['columns'];
  onColumnsChange: (columns: QuotationDisplayConfig['columns']) => void;
  onChange: (items: QuotationLineDraft[]) => void;
  onClose: () => void;
  onSaveCustomerProduct?: (customerId: number, input: CustomerProductSaveInput) => Promise<CustomerProduct>;
}

export default function QuotationItemsModal({ open, customerId, items, error, columns, onColumnsChange, onChange, onClose, onSaveCustomerProduct }: QuotationItemsModalProps) {
  const [picker, setPicker] = useState<AnchoredPopoverState>();
  const [customerPicker, setCustomerPicker] = useState<AnchoredPopoverState>();
  const [customerEditorLineKey, setCustomerEditorLineKey] = useState<string>();
  const [showColumns, setShowColumns] = useState(false);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const togglePicker = (lineKey: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    const anchor = event.currentTarget;
    setCustomerPicker(undefined);
    setPicker((current) => current?.lineKey === lineKey ? undefined : { lineKey, anchor });
  };
  const toggleCustomerPicker = (lineKey: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    const anchor = event.currentTarget;
    setPicker(undefined);
    setCustomerPicker((current) => current?.lineKey === lineKey ? undefined : { lineKey, anchor });
  };
  const updateLine = (clientKey: string, patch: Partial<QuotationLineDraft>) => {
    onChange(items.map((item) => item.clientKey === clientKey ? { ...item, ...patch } : item));
  };
  const moveLine = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const duplicateLine = (index: number) => {
    const source = items[index];
    const duplicate = { ...source, id: undefined, clientKey: createDocumentClientKey('quotation-line'), priceTiers: (source.priceTiers ?? []).map((tier) => ({ ...tier })), image: { ...source.image, file: undefined } };
    onChange([...items.slice(0, index + 1), duplicate, ...items.slice(index + 1)]);
  };
  const updateTier = (lineKey: string, tierIndex: number, patch: Partial<DocumentItemPriceTierDraft>) => {
    onChange(items.map((item) => item.clientKey === lineKey
      ? { ...item, priceTiers: (item.priceTiers ?? []).map((tier, index) => index === tierIndex ? { ...tier, ...patch } : tier) }
      : item));
  };
  const addTier = (lineKey: string) => {
    onChange(items.map((item) => item.clientKey === lineKey
      ? { ...item, priceTiers: [...(item.priceTiers ?? []), { minQuantity: '', maxQuantity: '', unitPrice: '' }] }
      : item));
  };
  const removeTier = (lineKey: string, tierIndex: number) => {
    onChange(items.map((item) => item.clientKey === lineKey
      ? { ...item, priceTiers: (item.priceTiers ?? []).filter((_, index) => index !== tierIndex) }
      : item));
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
    setPicker(undefined);
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
    setCustomerPicker(undefined);
  };

  const saveNewCustomerProduct = async (input: CustomerProductSaveInput) => {
    if (!customerId) throw new Error('请先选择客户');
    if (!onSaveCustomerProduct) throw new Error('当前页面暂不支持添加客户新品');
    const saved = await onSaveCustomerProduct(customerId, input);
    if (customerEditorLineKey) selectCustomerProduct(customerEditorLineKey, saved);
    setCustomerEditorLineKey(undefined);
  };

  return <Modal open={open} title="产品明细" width={1240} layer={40} onClose={onClose} footer={
    <>
      <span style={{ marginRight: 'auto', color: '#94a3b8', fontSize: 12 }}>共 {items.length} 行产品，修改即时生效</span>
      <button type="button" className="button button-primary" title="完成产品明细编辑" onClick={onClose}>完成</button>
    </>
  }>
    <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
      {error && <div role="alert" style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, padding: '8px 10px' }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>编辑产品行</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="icon-button" title="设置报价单显示列" onClick={() => setShowColumns((current) => !current)}><Columns3 size={15} /></button>
          <button type="button" className="button" title="添加临时产品" onClick={() => onChange([...items, emptyLine()])}><Plus size={14} />临时产品</button>
        </div>
      </div>
      {showColumns && <div style={{ padding: 8, background: '#f8fafc', borderRadius: 5 }}><DocumentColumnSettings kind="quotation" value={columns} onChange={(next) => onColumnsChange(next as QuotationDisplayConfig['columns'])} /></div>}
      <div className="sticky-thead" style={{ overflow: 'auto', maxHeight: 'min(56vh, 480px)', border: '1px solid #e2e8f0', borderRadius: 5 }}>
        <table style={{ width: '100%', minWidth: 1040, borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}>
            <th style={{ padding: 7, width: 30 }}>#</th><th style={{ padding: 7, minWidth: 300 }}>产品</th><th style={{ padding: 7, width: 110 }}>规格</th><th style={{ padding: 7, width: 110 }}>单价</th><th style={{ padding: 7, width: 214 }}>数量区间价</th><th style={{ padding: 7, minWidth: 130 }}>备注</th><th style={{ padding: 7, width: 154 }}>操作</th>
          </tr></thead>
          <tbody>{items.map((item, index) => {
            const unitPrice = parseNonNegative(item.unitPrice);
            const imageUrl = item.image.previewUrl ?? (item.image.relativePath ? `/files/${item.image.relativePath}` : undefined);
            return <tr key={item.clientKey} style={{ borderTop: '1px solid #edf0f2', verticalAlign: 'top' }}>
              <td style={{ padding: 7, color: '#94a3b8' }}>{index + 1}</td>
              <td style={{ padding: 7 }}><div style={{ display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) auto', gap: 5, alignItems: 'center' }}>
                <button type="button" title={imageUrl ? '更换产品图片' : '添加产品图片'} onClick={() => fileInputs.current[item.clientKey]?.click()} style={{ width: 36, height: 36, padding: 0, border: '1px solid #dbe3ea', borderRadius: 4, background: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden', cursor: 'pointer' }}>{imageUrl ? <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon size={15} color="#94a3b8" />}</button>
                <input value={item.name} onChange={(event) => updateLine(item.clientKey, { name: event.target.value, isTemporary: item.productId == null })} style={fieldStyle} placeholder="品名" />
                <div style={{ display: 'inline-flex', gap: 2 }}>
                  <button type="button" className="icon-button" title="从客户产品库选择" onClick={(event) => toggleCustomerPicker(item.clientKey, event)}><span style={{ fontSize: 11, fontWeight: 700 }}>客</span></button>
                  <button type="button" className="icon-button" title="从系统产品库选择" onClick={(event) => togglePicker(item.clientKey, event)}><Library size={14} /></button>
                </div>
                <input ref={(node) => { fileInputs.current[item.clientKey] = node; }} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; updateLine(item.clientKey, { image: { relativePath: null, originalName: file.name, mimeType: file.type, file, previewUrl: URL.createObjectURL(file) }, isTemporary: true }); event.target.value = ''; }} />
              </div>
              </td>
              <td style={{ padding: 7 }}><input value={item.specification} onChange={(event) => updateLine(item.clientKey, { specification: event.target.value })} style={fieldStyle} /></td>
              <td style={{ padding: 7 }}><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateLine(item.clientKey, { unitPrice: event.target.value })} style={{ ...fieldStyle, borderColor: unitPrice === null ? '#dc2626' : '#dbe3ea' }} /></td>
              <td style={{ padding: 7 }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  {(item.priceTiers ?? []).map((tier, tierIndex) => <div key={tierIndex} style={{ display: 'grid', gridTemplateColumns: '56px 12px 56px 60px 24px', gap: 4, alignItems: 'center' }}>
                    <input type="number" min="0" step="any" aria-label="区间起始数量" placeholder="≥" value={tier.minQuantity} onChange={(event) => updateTier(item.clientKey, tierIndex, { minQuantity: event.target.value })} style={fieldStyle} />
                    <span style={{ textAlign: 'center', color: '#94a3b8' }}>~</span>
                    <input type="number" min="0" step="any" aria-label="区间截止数量" placeholder="不限" value={tier.maxQuantity} onChange={(event) => updateTier(item.clientKey, tierIndex, { maxQuantity: event.target.value })} style={fieldStyle} />
                    <input type="number" min="0" step="0.01" aria-label="区间单价（元）" placeholder="单价" value={tier.unitPrice} onChange={(event) => updateTier(item.clientKey, tierIndex, { unitPrice: event.target.value })} style={fieldStyle} />
                    <button type="button" className="icon-button danger" title="删除数量区间" onClick={() => removeTier(item.clientKey, tierIndex)}><X size={13} /></button>
                  </div>)}
                  <button type="button" title="添加数量区间报价" onClick={() => addTier(item.clientKey)} style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px dashed #cbd5e1', borderRadius: 4, background: '#f8fafc', padding: '3px 8px', cursor: 'pointer', color: '#475569', fontSize: 11 }}><Plus size={12} />区间价</button>
                </div>
              </td>
              <td style={{ padding: 7 }}><input value={item.remark} onChange={(event) => updateLine(item.clientKey, { remark: event.target.value })} style={fieldStyle} /></td>
              <td style={{ padding: 7 }}><div style={{ display: 'flex', gap: 3 }}><button type="button" className="icon-button" title="上移产品行" disabled={index === 0} onClick={() => moveLine(index, -1)}><ArrowUp size={14} /></button><button type="button" className="icon-button" title="下移产品行" disabled={index === items.length - 1} onClick={() => moveLine(index, 1)}><ArrowDown size={14} /></button><button type="button" className="icon-button" title="复制产品行" onClick={() => duplicateLine(index)}><Copy size={14} /></button><button type="button" className="icon-button danger" title="删除产品行" onClick={() => onChange(items.filter((line) => line.clientKey !== item.clientKey))}><Trash2 size={14} /></button></div></td>
            </tr>;
          })}</tbody>
        </table>
        {!items.length && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>暂无产品，点击“临时产品”添加或从系统产品库调用。</div>}
      </div>
      {customerPicker && (() => {
        const line = items.find((item) => item.clientKey === customerPicker.lineKey);
        if (!line) return null;
        return <AnchoredPopover anchor={customerPicker.anchor} width={430} maxHeight={340} onClose={() => setCustomerPicker(undefined)}>
          <CustomerProductPicker customerId={customerId} value={line.customerProductId} onSelect={(product) => selectCustomerProduct(line.clientKey, product)} onAddNew={() => { setCustomerPicker(undefined); setCustomerEditorLineKey(line.clientKey); }} />
        </AnchoredPopover>;
      })()}
      {picker && (() => {
        const line = items.find((item) => item.clientKey === picker.lineKey);
        if (!line) return null;
        return <AnchoredPopover anchor={picker.anchor} width={390} maxHeight={300} onClose={() => setPicker(undefined)}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 5 }}><button type="button" className="icon-button" title="关闭产品库" onClick={() => setPicker(undefined)}><X size={14} /></button></div>
          <LibraryProductPicker selectedProductId={line.productId} onSelect={(selection) => selectProduct(line.clientKey, selection)} />
        </AnchoredPopover>;
      })()}
    </div>
    <CustomerProductEditorModal open={customerEditorLineKey != null} product={null} layer={60} onClose={() => setCustomerEditorLineKey(undefined)} onSave={saveNewCustomerProduct} />
  </Modal>;
}
