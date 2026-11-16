import { Columns3, Plus, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { QuotationDisplayConfig } from '../../../shared/documents';
import type { CustomerProductSaveInput } from '../../../shared/customers';
import type { QuotationPricingBasis } from '../../../shared/quotation-config';
import { productAccessoryList } from '../../../shared/product-pricing';
import Modal from '../Modal';
import AnchoredPopover from '../AnchoredPopover';
import DocumentColumnSettings from '../documents/DocumentColumnSettings';
import LibraryProductPicker from '../documents/LibraryProductPicker';
import CustomerProductPicker from '../customer-products/CustomerProductPicker';
import CustomerProductEditorModal from '../customer-products/CustomerProductEditorModal';
import type { QuotationLineDraft } from './quotation-lines';
import { formatCentsPlain } from './quotation-lines';
import { useQuotationConfigData } from './items/use-config-data';
import { useQuotationLineActions } from './items/use-line-actions';
import { useQuotationConfigRecalc } from './items/use-config-recalc';
import { QuotationItemCard, QuotationItemRow, type PickerKind } from './items/QuotationItemRow';
import { useIsNarrow } from '../../use-is-narrow';

export interface QuotationItemsModalProps {
  open: boolean;
  customerId: number | null;
  items: QuotationLineDraft[];
  error?: string;
  columns: QuotationDisplayConfig['columns'];
  pricingBasis: QuotationPricingBasis;
  taxRateBps: number;
  onColumnsChange: (columns: QuotationDisplayConfig['columns']) => void;
  onChange: (items: QuotationLineDraft[]) => void;
  onClose: () => void;
  onSaveCustomerProduct?: (customerId: number, input: CustomerProductSaveInput) => Promise<import('../../../shared/customers').CustomerProduct>;
}

interface PickerState {
  lineKey: string;
  kind: PickerKind;
  anchor: HTMLElement;
}

function money(cents: number): string {
  return formatCentsPlain(cents);
}

/**
 * 产品明细弹窗壳：布局、工具栏、三个选择弹层的调度。
 * 数据获取在 use-config-data，行操作在 use-line-actions，重算在 use-config-recalc，
 * 行渲染在 memo 化的 QuotationItemRow / QuotationItemCard。
 */
export default function QuotationItemsModal({
  open,
  customerId,
  items,
  error,
  columns,
  pricingBasis,
  taxRateBps,
  onColumnsChange,
  onChange,
  onClose,
  onSaveCustomerProduct,
}: QuotationItemsModalProps) {
  const [picker, setPicker] = useState<PickerState>();
  const [customerEditorLineKey, setCustomerEditorLineKey] = useState<string>();
  const [showColumns, setShowColumns] = useState(false);
  const [extraRows, setExtraRows] = useState<Set<string>>(new Set());
  const narrow = useIsNarrow();

  const { settings, productDetails, loadingProducts, fetchProduct } = useQuotationConfigData(open, items, pricingBasis, taxRateBps);
  const actions = useQuotationLineActions(items, onChange, settings, productDetails, fetchProduct);
  useQuotationConfigRecalc(open, items, settings, productDetails, onChange);

  const openPicker = useCallback((lineKey: string, kind: PickerKind, anchor: HTMLElement) => {
    setPicker((current) => (current?.lineKey === lineKey && current.kind === kind ? undefined : { lineKey, kind, anchor }));
  }, []);

  const toggleExtra = useCallback((lineKey: string) => {
    setExtraRows((current) => {
      const next = new Set(current);
      if (next.has(lineKey)) next.delete(lineKey);
      else next.add(lineKey);
      return next;
    });
  }, []);

  const saveNewCustomerProduct = async (input: CustomerProductSaveInput) => {
    if (!customerId) throw new Error('请先选择客户');
    if (!onSaveCustomerProduct) throw new Error('当前页面暂不支持添加客户新品');
    const saved = await onSaveCustomerProduct(customerId, input);
    if (customerEditorLineKey) actions.selectCustomerProduct(customerEditorLineKey, saved);
    setCustomerEditorLineKey(undefined);
  };

  const rowProps = (item: QuotationLineDraft, index: number) => ({
    item,
    index,
    count: items.length,
    product: item.productId == null ? undefined : productDetails[item.productId],
    productLoading: Boolean(loadingProducts[item.productId ?? 0]),
    settings,
    extraOpen: extraRows.has(item.clientKey),
    actions,
    onToggleExtra: toggleExtra,
    onOpenPicker: openPicker,
  });

  const pickerLine = picker ? items.find((item) => item.clientKey === picker.lineKey) : undefined;
  const pickerProduct = pickerLine?.productId == null ? undefined : productDetails[pickerLine.productId];

  return <Modal open={open} title="产品明细" width="min(96vw, 1500px)" layer={40} onClose={onClose} footer={
    <>
      <span style={{ marginRight: 'auto', color: 'var(--color-text-muted)', fontSize: 12 }}>共 {items.length} 行产品 · 配置变化实时更新单价</span>
      <button type="button" className="button button-primary" title="完成产品明细编辑" onClick={onClose}>完成</button>
    </>
  }>
    <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
      {error && <div role="alert" style={{ color: 'var(--color-danger)', background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-ui)', padding: '8px 10px' }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>配置报价表<span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--color-text-secondary)' }}>先选产品，再选电池、充电器、包装和配件；重量与单价自动带出</span></strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="icon-button" title="设置报价单显示列" onClick={() => setShowColumns((current) => !current)}><Columns3 size={15} /></button>
          <button type="button" className="button" title="添加临时产品" onClick={actions.addLine}><Plus size={14} />临时产品</button>
        </div>
      </div>
      {showColumns && <div style={{ padding: 8, background: 'var(--color-surface-subtle)', borderRadius: 'var(--radius-ui)' }}><DocumentColumnSettings kind="quotation" value={columns} onChange={(next) => onColumnsChange(next as QuotationDisplayConfig['columns'])} /></div>}

      {!narrow && <div className="quotation-config-table-scroll">
        <table className="quotation-config-table">
          <thead><tr>{['#', '产品', '电池配置', '充电器', '包装', '配件', '重量', '成本', '毛利率', '单价', '备注', '操作'].map((title) => <th key={title} className={title === '产品' ? 'is-sticky-left' : title === '操作' ? 'is-sticky-right' : undefined}>{title}</th>)}</tr></thead>
          <tbody>{items.map((item, index) => <QuotationItemRow key={item.clientKey} {...rowProps(item, index)} />)}</tbody>
        </table>
        {!items.length && <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>暂无产品，点击“临时产品”添加或从系统产品库调用。</div>}
      </div>}

      {narrow && <div className="quotation-config-card-list">
        {items.map((item, index) => <QuotationItemCard key={item.clientKey} {...rowProps(item, index)} />)}
        {!items.length && <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>暂无产品，点击“临时产品”添加或从系统产品库调用。</div>}
      </div>}

      {picker && pickerLine && picker.kind === 'customer' && <AnchoredPopover anchor={picker.anchor} width={430} maxHeight={340} onClose={() => setPicker(undefined)}>
        <CustomerProductPicker customerId={customerId} value={pickerLine.customerProductId} onSelect={(product) => { actions.selectCustomerProduct(pickerLine.clientKey, product); setPicker(undefined); }} onAddNew={() => { setPicker(undefined); setCustomerEditorLineKey(pickerLine.clientKey); }} />
      </AnchoredPopover>}
      {picker && pickerLine && picker.kind === 'library' && <AnchoredPopover anchor={picker.anchor} width={390} maxHeight={300} onClose={() => setPicker(undefined)}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 5 }}><button type="button" className="icon-button" title="关闭产品库" onClick={() => setPicker(undefined)}><X size={14} /></button></div>
        <LibraryProductPicker selectedProductId={pickerLine.productId} onSelect={(selection) => { actions.selectProduct(pickerLine.clientKey, selection); setPicker(undefined); }} />
      </AnchoredPopover>}
      {picker && pickerLine && picker.kind === 'accessory' && pickerProduct && (() => {
        if (!pickerLine || !pickerProduct) return null;
        const options = productAccessoryList(pickerProduct, settings.categoryAccessories);
        const selected = new Set(pickerLine.configuration?.accessoryNames ?? []);
        return <AnchoredPopover anchor={picker.anchor} width={340} maxHeight={320} onClose={() => setPicker(undefined)}>
          <div style={{ display: 'grid', gap: 6 }}>
            <strong style={{ fontSize: 12 }}>选择配件（每项计 1 件）</strong>
            {options.length ? options.map((option) => <label key={option.name} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.has(option.name)} onChange={() => {
                const names = selected.has(option.name) ? [...selected].filter((name) => name !== option.name) : [...selected, option.name];
                actions.applySelection(pickerLine, { accessoryNames: names });
              }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.name}</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>{money(Math.round(option.price * 100))}</span>
            </label>) : <span style={{ color: 'var(--color-text-muted)' }}>该产品还没有配件清单</span>}
          </div>
        </AnchoredPopover>;
      })()}
    </div>
    <CustomerProductEditorModal open={customerEditorLineKey != null} product={null} layer={60} onClose={() => setCustomerEditorLineKey(undefined)} onSave={saveNewCustomerProduct} />
  </Modal>;
}