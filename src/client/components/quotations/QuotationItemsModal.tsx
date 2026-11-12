import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Copy,
  ChevronDown,
  Image as ImageIcon,
  Library,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { QuotationDisplayConfig } from '../../../shared/documents';
import type { CustomerProduct, CustomerProductSaveInput } from '../../../shared/customers';
import type { AccessoryPrice } from '../../../shared/accessory-prices';
import type { BatteryPriceMatrix } from '../../../shared/battery-prices';
import type { QuotationItemConfiguration, QuotationPricingBasis } from '../../../shared/quotation-config';
import {
  createDocumentClientKey,
  type DocumentItemPriceTierDraft,
} from '../../documents/document-drafts';
import { getBatteryPriceMatrix, getCategoryAccessoryPrices, getChargerPrices, getProduct, getVolumeDivisor } from '../../api';
import { rememberedMarkup, rememberedShippingUnitPrice } from '../../price-calc-memory';
import {
  batteryOptionsForProduct,
  batteryOptionValue,
  buildQuotationConfiguration,
  productAccessoryList,
  quotationConfigWeights,
  recalculateQuotationConfiguration,
  type QuotationConfigSelection,
  type QuotationConfigSettings,
} from '../../quotation-config';
import { useIsNarrow } from '../../use-is-narrow';
import Modal from '../Modal';
import AnchoredPopover from '../AnchoredPopover';
import DocumentColumnSettings from '../documents/DocumentColumnSettings';
import LibraryProductPicker, { type LibraryProductSelection } from '../documents/LibraryProductPicker';
import CustomerProductPicker from '../customer-products/CustomerProductPicker';
import CustomerProductEditorModal from '../customer-products/CustomerProductEditorModal';
import type { ProductRecord } from '../ProductEditor';
import { emptyLine, parseNonNegative, type QuotationLineDraft } from './quotation-lines';

const fieldStyle = {
  width: '100%',
  minWidth: 0,
  border: '1px solid var(--control-border)',
  borderRadius: 'var(--radius-control)',
  padding: '6px 7px',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 11.5,
  background: 'var(--control-bg)',
};

const compactButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 30,
  padding: '0 7px',
  border: '1px solid var(--control-border)',
  borderRadius: 'var(--radius-control)',
  background: 'var(--control-bg)',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 11,
  whiteSpace: 'nowrap' as const,
};

interface AnchoredPopoverState {
  lineKey: string;
  anchor: HTMLElement;
}

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
  onSaveCustomerProduct?: (customerId: number, input: CustomerProductSaveInput) => Promise<CustomerProduct>;
}

function money(cents: number): string {
  return `¥${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function selectionOf(config: QuotationItemConfiguration | undefined): QuotationConfigSelection {
  return {
    mode: config?.mode ?? 'bare',
    packCount: config?.battery?.packCount,
    capacity: config?.battery?.capacity,
    batteryCount: config?.battery?.batteryCount,
    chargerId: config?.battery?.chargerName,
    packagingId: config?.packaging?.id,
    accessoryNames: config?.accessoryNames ?? [],
    markupPercent: config?.markupPercent ?? (Number(rememberedMarkup()) || 20),
    otherCostCents: config?.otherCostCents ?? 0,
  };
}

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
  const [picker, setPicker] = useState<AnchoredPopoverState>();
  const [customerPicker, setCustomerPicker] = useState<AnchoredPopoverState>();
  const [accessoryPicker, setAccessoryPicker] = useState<AnchoredPopoverState>();
  const [customerEditorLineKey, setCustomerEditorLineKey] = useState<string>();
  const [showColumns, setShowColumns] = useState(false);
  const [extraRows, setExtraRows] = useState<Set<string>>(new Set());
  const [productDetails, setProductDetails] = useState<Record<number, ProductRecord>>({});
  const [loadingProducts, setLoadingProducts] = useState<Record<number, boolean>>({});
  const [batteryMatrix, setBatteryMatrix] = useState<BatteryPriceMatrix | null>(null);
  const [chargerPrices, setChargerPrices] = useState<AccessoryPrice[]>([]);
  const [volumeDivisor, setVolumeDivisor] = useState(8000);
  const [categoryAccessories, setCategoryAccessories] = useState<Record<string, AccessoryPrice[]>>({});
  const loadedProductIds = useRef(new Set<number>());
  const loadedCategories = useRef(new Set<string>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const narrow = useIsNarrow();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getBatteryPriceMatrix().then((matrix) => { if (!cancelled) setBatteryMatrix(matrix); }).catch(() => undefined);
    void getChargerPrices().then((items) => { if (!cancelled) setChargerPrices(items); }).catch(() => undefined);
    void getVolumeDivisor().then((divisor) => { if (!cancelled) setVolumeDivisor(divisor); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ids = [...new Set(items.map((item) => item.productId).filter((id): id is number => Number.isSafeInteger(id) && (id as number) > 0))];
    for (const id of ids) {
      if (loadedProductIds.current.has(id)) continue;
      loadedProductIds.current.add(id);
      setLoadingProducts((current) => ({ ...current, [id]: true }));
      void getProduct(String(id)).then((product) => {
        setProductDetails((current) => ({ ...current, [id]: product }));
      }).catch(() => undefined).finally(() => {
        setLoadingProducts((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      });
    }
  }, [items, open]);

  useEffect(() => {
    const categories = [...new Set(Object.values(productDetails).map((product) => product.category?.trim()).filter((category): category is string => Boolean(category)))];
    for (const category of categories) {
      if (loadedCategories.current.has(category)) continue;
      loadedCategories.current.add(category);
      void getCategoryAccessoryPrices(category).then((items) => {
        setCategoryAccessories((current) => ({ ...current, [category]: items.filter((item) => item.name.trim()) }));
      }).catch(() => undefined);
    }
  }, [productDetails]);

  const settings = useMemo<QuotationConfigSettings>(() => ({
    batteryMatrix,
    chargerPrices,
    volumeDivisor,
    categoryAccessories,
    taxRateBps,
    pricingBasis,
    shippingUnitPrice: Number(rememberedShippingUnitPrice()) || 1.5,
  }), [batteryMatrix, chargerPrices, volumeDivisor, categoryAccessories, taxRateBps, pricingBasis]);

  // 价格口径/税率/矩阵变化后，重算已有配置行的成本、重量和单价。
  useEffect(() => {
    if (!open) return;
    let changed = false;
    const next = items.map((item) => {
      const product = item.productId == null ? undefined : productDetails[item.productId];
      if (!item.configuration || !product) return item;
      const recalculated = recalculateQuotationConfiguration(item.configuration, product, settings);
      const price = item.configuration.priceOverridden ? item.unitPrice : (recalculated.computedSalePriceCents / 100).toFixed(2);
      if (JSON.stringify(recalculated) === JSON.stringify(item.configuration) && price === item.unitPrice) return item;
      changed = true;
      return { ...item, configuration: recalculated, unitPrice: price };
    });
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, productDetails, open]);

  const togglePicker = (lineKey: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    const anchor = event.currentTarget;
    setCustomerPicker(undefined);
    setAccessoryPicker(undefined);
    setPicker((current) => current?.lineKey === lineKey ? undefined : { lineKey, anchor });
  };
  const toggleCustomerPicker = (lineKey: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    const anchor = event.currentTarget;
    setPicker(undefined);
    setAccessoryPicker(undefined);
    setCustomerPicker((current) => current?.lineKey === lineKey ? undefined : { lineKey, anchor });
  };
  const toggleAccessoryPicker = (lineKey: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    const anchor = event.currentTarget;
    setPicker(undefined);
    setCustomerPicker(undefined);
    setAccessoryPicker((current) => current?.lineKey === lineKey ? undefined : { lineKey, anchor });
  };
  const updateLine = (clientKey: string, patch: Partial<QuotationLineDraft>) => {
    const next = itemsRef.current.map((item) => item.clientKey === clientKey ? { ...item, ...patch } : item);
    itemsRef.current = next;
    onChange(next);
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
    const duplicate = {
      ...source,
      id: undefined,
      clientKey: createDocumentClientKey('quotation-line'),
      priceTiers: (source.priceTiers ?? []).map((tier) => ({ ...tier })),
      configuration: source.configuration ? JSON.parse(JSON.stringify(source.configuration)) as QuotationItemConfiguration : undefined,
      image: { ...source.image, file: undefined },
    };
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
    void getProduct(String(product.id)).then((detail) => {
      setProductDetails((current) => ({ ...current, [product.id]: detail }));
      const config = buildQuotationConfiguration(detail, {
        mode: 'bare',
        markupPercent: Number(rememberedMarkup()) || 20,
        packagingId: String(detail.packaging[0]?.id ?? ''),
      }, settings);
      updateLine(lineKey, { configuration: config, unitPrice: (config.computedSalePriceCents / 100).toFixed(2) });
    }).catch(() => undefined);
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

  const applySelection = (item: QuotationLineDraft, patch: Partial<QuotationConfigSelection>) => {
    const product = item.productId == null ? undefined : productDetails[item.productId];
    if (!product) return;
    const nextSelection = { ...selectionOf(item.configuration), ...patch };
    const config = buildQuotationConfiguration(product, nextSelection, settings);
    const overridden = item.configuration?.priceOverridden ?? false;
    updateLine(item.clientKey, {
      configuration: { ...config, priceOverridden: overridden },
      unitPrice: overridden ? item.unitPrice : (config.computedSalePriceCents / 100).toFixed(2),
    });
  };

  const setConfigMode = (item: QuotationLineDraft, value: string) => {
    if (value === 'none') {
      updateLine(item.clientKey, { configuration: undefined });
      return;
    }
    if (value === 'bare') {
      applySelection(item, { mode: 'bare' });
      return;
    }
    const option = item.productId == null ? undefined : batteryOptionsForProduct(productDetails[item.productId], batteryMatrix).find((candidate) => candidate.value === value);
    if (!option) return;
    applySelection(item, { mode: 'battery', packCount: option.packCount, capacity: option.capacity, batteryCount: option.batteryCount });
  };

  const updateUnitPrice = (item: QuotationLineDraft, value: string) => {
    updateLine(item.clientKey, {
      unitPrice: value,
      ...(item.configuration ? { configuration: { ...item.configuration, priceOverridden: true } } : {}),
    });
  };

  const restoreAutoPrice = (item: QuotationLineDraft) => {
    if (!item.configuration || item.productId == null) return;
    const product = productDetails[item.productId];
    if (!product) return;
    const config = recalculateQuotationConfiguration({ ...item.configuration, priceOverridden: false }, product, settings);
    updateLine(item.clientKey, { configuration: config, unitPrice: (config.computedSalePriceCents / 100).toFixed(2) });
  };

  const renderProductCell = (item: QuotationLineDraft) => {
    const imageUrl = item.image.previewUrl ?? (item.image.relativePath ? `/files/${item.image.relativePath}` : undefined);
    return <div style={{ display: 'grid', gridTemplateColumns: '38px minmax(0, 1fr) auto', gap: 5, alignItems: 'center' }}>
      <button type="button" title={imageUrl ? '更换产品图片' : '添加产品图片'} onClick={() => fileInputs.current[item.clientKey]?.click()} style={{ width: 38, height: 38, padding: 0, border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface)', display: 'grid', placeItems: 'center', overflow: 'hidden', cursor: 'pointer' }}>{imageUrl ? <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon size={15} color="var(--color-text-muted)" />}</button>
      <input value={item.name} onChange={(event) => updateLine(item.clientKey, { name: event.target.value, isTemporary: item.productId == null })} style={fieldStyle} placeholder="品名" aria-label="产品名称" />
      <div style={{ display: 'inline-flex', gap: 2 }}>
        <button type="button" className="icon-button" title="从客户产品库选择" onClick={(event) => toggleCustomerPicker(item.clientKey, event)}><span style={{ fontSize: 11, fontWeight: 700 }}>客</span></button>
        <button type="button" className="icon-button" title="从系统产品库选择" onClick={(event) => togglePicker(item.clientKey, event)}><Library size={14} /></button>
      </div>
      <input ref={(node) => { fileInputs.current[item.clientKey] = node; }} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; updateLine(item.clientKey, { image: { relativePath: null, originalName: file.name, mimeType: file.type, file, previewUrl: URL.createObjectURL(file) }, isTemporary: true }); event.target.value = ''; }} />
    </div>;
  };

  const renderBatterySelect = (item: QuotationLineDraft) => {
    const product = item.productId == null ? undefined : productDetails[item.productId];
    const options = product ? batteryOptionsForProduct(product, batteryMatrix) : [];
    const value = item.configuration ? batteryOptionValue(item.configuration) : 'none';
    return <select aria-label="电池配置" value={value} disabled={!product || loadingProducts[item.productId ?? 0]} onChange={(event) => setConfigMode(item, event.target.value)} style={fieldStyle}>
      <option value="none">{product ? '未配置（手填价）' : loadingProducts[item.productId ?? 0] ? '加载中…' : '—'}</option>
      {product && <option value="bare">裸机</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
  };

  const renderChargerSelect = (item: QuotationLineDraft) => {
    const isBattery = item.configuration?.mode === 'battery';
    const value = item.configuration?.battery?.chargerName ?? chargerPrices[0]?.name ?? '';
    return <select aria-label="充电器" value={value} disabled={!isBattery} onChange={(event) => applySelection(item, { chargerId: event.target.value })} style={{ ...fieldStyle, opacity: isBattery ? 1 : 0.5 }}>
      {!chargerPrices.length && <option value="">未配置充电器</option>}
      {chargerPrices.map((charger) => <option key={charger.id} value={charger.name}>{charger.name}</option>)}
    </select>;
  };

  const renderPackagingSelect = (item: QuotationLineDraft) => {
    const product = item.productId == null ? undefined : productDetails[item.productId];
    const packaging = product?.packaging ?? [];
    const value = item.configuration?.packaging?.id ?? String(packaging[0]?.id ?? '');
    return <select aria-label="包装" value={value} disabled={!product} onChange={(event) => applySelection(item, { packagingId: event.target.value })} style={fieldStyle}>
      {!packaging.length && <option value="">无包装</option>}
      {packaging.map((row) => <option key={String(row.id)} value={String(row.id)}>{row.name?.trim() || '未命名包装'}</option>)}
    </select>;
  };

  const renderAccessoryButton = (item: QuotationLineDraft) => {
    const product = item.productId == null ? undefined : productDetails[item.productId];
    const options = product ? productAccessoryList(product, categoryAccessories) : [];
    const selected = item.configuration?.accessoryNames ?? [];
    return <button type="button" title="选择配件" disabled={!product} onClick={(event) => toggleAccessoryPicker(item.clientKey, event)} style={{ ...compactButtonStyle, width: '100%', justifyContent: 'space-between', opacity: product ? 1 : 0.5 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected.length ? `${selected.length} 项` : '选择配件'}</span>
      {selected.length > 0 && <span style={{ color: 'var(--color-accent)' }}>{money(item.configuration?.accessoryPriceCents ?? 0)}</span>}
    </button>;
  };

  const renderWeightCell = (item: QuotationLineDraft) => {
    const product = item.productId == null ? undefined : productDetails[item.productId];
    if (!product || !item.configuration) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
    const weights = quotationConfigWeights(product, item.configuration, settings);
    return <span title="实重 / 计费重"><strong style={{ display: 'block' }}>{weights.actualWeightKg.toFixed(2)} kg</strong><small style={{ color: 'var(--color-text-muted)' }}>计费 {weights.chargeableWeightKg.toFixed(2)} kg</small></span>;
  };

  const renderCostCell = (item: QuotationLineDraft) => {
    if (!item.configuration) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
    const c = item.configuration;
    const battery = c.battery ? `${c.battery.batteryCount} × 电池 ${money(c.battery.batteryUnitPriceCents)}` : '裸机';
    return <span title={`采购 ${money(c.baseCostCents)} · 包装 ${money(c.packaging?.costCents ?? 0)} · 配件 ${money(c.accessoryPriceCents)} · ${battery} · 充电器 ${money(c.battery?.chargerPriceCents ?? 0)} · 运费 ${money(c.shippingCostCents)} · 税 ${c.taxPercent}%`}>
      <strong style={{ display: 'block' }}>{money(c.totalCostCents)}</strong>
      <small style={{ color: 'var(--color-text-muted)' }}>成本</small>
    </span>;
  };

  const renderPriceCell = (item: QuotationLineDraft) => {
    const overridden = item.configuration?.priceOverridden;
    return <div style={{ display: 'grid', gap: 2 }}>
      <input type="number" min="0" step="0.01" aria-label="单价" value={item.unitPrice} onChange={(event) => updateUnitPrice(item, event.target.value)} style={{ ...fieldStyle, borderColor: parseNonNegative(item.unitPrice) === null ? 'var(--color-danger-strong)' : 'var(--color-border-control)' }} />
      {overridden && <button type="button" title="恢复自动价" onClick={() => restoreAutoPrice(item)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: 0, background: 'transparent', color: 'var(--color-warning-text)', padding: 0, cursor: 'pointer', fontSize: 10 }}><RotateCcw size={11} />已手改 · 恢复</button>}
    </div>;
  };

  const renderTierCell = (item: QuotationLineDraft) => <div style={{ display: 'grid', gap: 4 }}>
    {(item.priceTiers ?? []).map((tier, tierIndex) => <div key={tierIndex} style={{ display: 'grid', gridTemplateColumns: '48px 10px 48px 56px 22px', gap: 3, alignItems: 'center' }}>
      <input type="number" min="0" step="any" aria-label="区间起始数量" placeholder="≥" value={tier.minQuantity} onChange={(event) => updateTier(item.clientKey, tierIndex, { minQuantity: event.target.value })} style={fieldStyle} />
      <span style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>~</span>
      <input type="number" min="0" step="any" aria-label="区间截止数量" placeholder="不限" value={tier.maxQuantity} onChange={(event) => updateTier(item.clientKey, tierIndex, { maxQuantity: event.target.value })} style={fieldStyle} />
      <input type="number" min="0" step="0.01" aria-label="区间单价（元）" placeholder="单价" value={tier.unitPrice} onChange={(event) => updateTier(item.clientKey, tierIndex, { unitPrice: event.target.value })} style={fieldStyle} />
      <button type="button" className="icon-button danger" title="删除数量区间" onClick={() => removeTier(item.clientKey, tierIndex)}><X size={12} /></button>
    </div>)}
    <button type="button" title="添加数量区间报价" onClick={() => addTier(item.clientKey)} style={{ justifySelf: 'start', ...compactButtonStyle, minHeight: 26, padding: '0 6px' }}><Plus size={11} />区间价</button>
  </div>;

  const toggleExtra = (lineKey: string) => {
    setExtraRows((current) => {
      const next = new Set(current);
      if (next.has(lineKey)) next.delete(lineKey);
      else next.add(lineKey);
      return next;
    });
  };

  const renderActions = (item: QuotationLineDraft, index: number, showExtra = true) => <div style={{ display: 'flex', gap: 2 }}>
    {showExtra && <button type="button" className="icon-button" title="数量区间价 / 备注" onClick={() => toggleExtra(item.clientKey)} style={{ transform: extraRows.has(item.clientKey) ? 'rotate(180deg)' : undefined }}><ChevronDown size={14} /></button>}
    <button type="button" className="icon-button" title="上移产品行" disabled={index === 0} onClick={() => moveLine(index, -1)}><ArrowUp size={14} /></button>
    <button type="button" className="icon-button" title="下移产品行" disabled={index === items.length - 1} onClick={() => moveLine(index, 1)}><ArrowDown size={14} /></button>
    <button type="button" className="icon-button" title="复制产品行" onClick={() => duplicateLine(index)}><Copy size={14} /></button>
    <button type="button" className="icon-button danger" title="删除产品行" onClick={() => onChange(items.filter((line) => line.clientKey !== item.clientKey))}><Trash2 size={14} /></button>
  </div>;

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
          <button type="button" className="button" title="添加临时产品" onClick={() => onChange([...items, emptyLine()])}><Plus size={14} />临时产品</button>
        </div>
      </div>
      {showColumns && <div style={{ padding: 8, background: 'var(--color-surface-subtle)', borderRadius: 'var(--radius-ui)' }}><DocumentColumnSettings kind="quotation" value={columns} onChange={(next) => onColumnsChange(next as QuotationDisplayConfig['columns'])} /></div>}

      {!narrow && <div className="quotation-config-table-scroll">
        <table className="quotation-config-table">
          <thead><tr>{['#', '产品', '电池配置', '充电器', '包装', '配件', '重量', '成本', '毛利率', '单价', '操作'].map((title) => <th key={title} className={title === '产品' ? 'is-sticky-left' : title === '操作' ? 'is-sticky-right' : undefined}>{title}</th>)}</tr></thead>
          <tbody>{items.map((item, index) => {
            const product = item.productId == null ? undefined : productDetails[item.productId];
            return <Fragment key={item.clientKey}>
              <tr>
                <td className="quotation-config-index">{index + 1}</td>
                <td className="quotation-config-product is-sticky-left">{renderProductCell(item)}</td>
                <td style={{ minWidth: 168 }}>{renderBatterySelect(item)}</td>
                <td style={{ minWidth: 112 }}>{renderChargerSelect(item)}</td>
                <td style={{ minWidth: 120 }}>{renderPackagingSelect(item)}</td>
                <td style={{ minWidth: 110 }}>{renderAccessoryButton(item)}</td>
                <td style={{ minWidth: 90 }}>{renderWeightCell(item)}</td>
                <td style={{ minWidth: 84 }}>{renderCostCell(item)}</td>
                <td style={{ minWidth: 70 }}><input type="number" min="0" step="0.01" aria-label="毛利率" value={item.configuration?.markupPercent ?? ''} disabled={!product || !item.configuration} onChange={(event) => applySelection(item, { markupPercent: Number(event.target.value) || 0 })} style={fieldStyle} /></td>
                <td style={{ minWidth: 100 }}>{renderPriceCell(item)}</td>
                <td className="quotation-config-actions is-sticky-right">{renderActions(item, index)}</td>
              </tr>
              {extraRows.has(item.clientKey) && <tr className="quotation-config-extra-row">
                <td colSpan={11}>
                  <div className="quotation-config-extra">
                    <div><span>数量区间价</span>{renderTierCell(item)}</div>
                    <label><span>备注</span><input value={item.remark} onChange={(event) => updateLine(item.clientKey, { remark: event.target.value })} style={fieldStyle} aria-label="备注" /></label>
                  </div>
                </td>
              </tr>}
            </Fragment>;
          })}</tbody>
        </table>
        {!items.length && <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>暂无产品，点击“临时产品”添加或从系统产品库调用。</div>}
      </div>}

      {narrow && <div className="quotation-config-card-list">
        {items.map((item, index) => {
          const product = item.productId == null ? undefined : productDetails[item.productId];
          return <article className="quotation-config-card" key={item.clientKey}>
            <div className="quotation-config-card-head"><span>{index + 1}</span>{renderProductCell(item)}</div>
            <div className="quotation-config-card-actions">{renderActions(item, index, false)}</div>
            <div className="quotation-config-card-grid">
              <label><span>电池配置</span>{renderBatterySelect(item)}</label>
              <label><span>充电器</span>{renderChargerSelect(item)}</label>
              <label><span>包装</span>{renderPackagingSelect(item)}</label>
              <label><span>配件</span>{renderAccessoryButton(item)}</label>
              <label><span>重量</span>{renderWeightCell(item)}</label>
              <label><span>成本</span>{renderCostCell(item)}</label>
              <label><span>毛利率 %</span><input type="number" min="0" step="0.01" aria-label="毛利率" value={item.configuration?.markupPercent ?? ''} disabled={!product || !item.configuration} onChange={(event) => applySelection(item, { markupPercent: Number(event.target.value) || 0 })} style={fieldStyle} /></label>
              <label><span>单价</span>{renderPriceCell(item)}</label>
            </div>
            <div className="quotation-config-card-extra"><span>数量区间价</span>{renderTierCell(item)}</div>
            <label className="quotation-config-card-remark"><span>备注</span><input value={item.remark} onChange={(event) => updateLine(item.clientKey, { remark: event.target.value })} style={fieldStyle} aria-label="备注" /></label>
          </article>;
        })}
        {!items.length && <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>暂无产品，点击“临时产品”添加或从系统产品库调用。</div>}
      </div>}

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
      {accessoryPicker && (() => {
        const line = items.find((item) => item.clientKey === accessoryPicker.lineKey);
        const product = line?.productId == null ? undefined : productDetails[line.productId];
        if (!line || !product) return null;
        const options = productAccessoryList(product, categoryAccessories);
        const selected = new Set(line.configuration?.accessoryNames ?? []);
        return <AnchoredPopover anchor={accessoryPicker.anchor} width={340} maxHeight={320} onClose={() => setAccessoryPicker(undefined)}>
          <div style={{ display: 'grid', gap: 6 }}>
            <strong style={{ fontSize: 12 }}>选择配件（每项计 1 件）</strong>
            {options.length ? options.map((option) => <label key={option.name} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.has(option.name)} onChange={() => {
                const names = selected.has(option.name) ? [...selected].filter((name) => name !== option.name) : [...selected, option.name];
                applySelection(line, { accessoryNames: names });
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
