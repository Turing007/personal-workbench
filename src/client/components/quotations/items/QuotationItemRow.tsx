import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Image as ImageIcon,
  Library,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { Fragment, memo, useMemo, useRef } from 'react';
import {
  batteryOptionsForProduct,
  batteryOptionValue,
  productAccessoryList,
  quotationConfigWeights,
  type QuotationConfigSettings,
} from '../../../../shared/product-pricing';
import type { ProductRecord } from '../../ProductEditor';
import { formatCentsPlain, parseNonNegative, type QuotationLineDraft } from '../quotation-lines';
import type { QuotationLineActions } from './use-line-actions';

export type PickerKind = 'library' | 'customer' | 'accessory';

export interface QuotationItemRowProps {
  item: QuotationLineDraft;
  index: number;
  count: number;
  product: ProductRecord | undefined;
  productLoading: boolean;
  settings: QuotationConfigSettings;
  extraOpen: boolean;
  actions: QuotationLineActions;
  onToggleExtra: (lineKey: string) => void;
  onOpenPicker: (lineKey: string, kind: PickerKind, anchor: HTMLElement) => void;
}

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

function money(cents: number): string {
  return formatCentsPlain(cents);
}

/** 单元格渲染：桌面行与手机卡片共用，保证两端字段与口径一致。 */
function useCells(props: QuotationItemRowProps) {
  const { item, product, productLoading, settings, actions, onOpenPicker } = props;
  const fileInput = useRef<HTMLInputElement | null>(null);
  const batteryOptions = useMemo(
    () => (product ? batteryOptionsForProduct(product, settings.batteryMatrix) : []),
    [product, settings.batteryMatrix],
  );

  const productCell = (
    <div style={{ display: 'grid', gridTemplateColumns: '38px minmax(0, 1fr) auto', gap: 5, alignItems: 'center' }}>
      <button type="button" title={item.image.previewUrl || item.image.relativePath ? '更换产品图片' : '添加产品图片'} onClick={() => fileInput.current?.click()} style={{ width: 38, height: 38, padding: 0, border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface)', display: 'grid', placeItems: 'center', overflow: 'hidden', cursor: 'pointer' }}>{item.image.previewUrl || item.image.relativePath ? <img src={item.image.previewUrl ?? `/files/${item.image.relativePath}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon size={15} color="var(--color-text-muted)" />}</button>
      <input value={item.name} onChange={(event) => actions.updateLine(item.clientKey, { name: event.target.value, isTemporary: item.productId == null })} style={fieldStyle} placeholder="品名" aria-label="产品名称" />
      <div style={{ display: 'inline-flex', gap: 2 }}>
        <button type="button" className="icon-button" title="从客户产品库选择" onClick={(event) => onOpenPicker(item.clientKey, 'customer', event.currentTarget)}><span style={{ fontSize: 11, fontWeight: 700 }}>客</span></button>
        <button type="button" className="icon-button" title="从系统产品库选择" onClick={(event) => onOpenPicker(item.clientKey, 'library', event.currentTarget)}><Library size={14} /></button>
      </div>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; actions.setLineImage(item.clientKey, file); event.target.value = ''; }} />
    </div>
  );

  const batterySelect = (
    <select aria-label="电池配置" value={item.configuration ? batteryOptionValue(item.configuration) : 'none'} disabled={!product || productLoading} onChange={(event) => actions.setConfigMode(item, event.target.value)} style={fieldStyle}>
      <option value="none">{product ? '未配置（手填价）' : productLoading ? '加载中…' : '—'}</option>
      {product && <option value="bare">裸机</option>}
      {batteryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );

  const isBattery = item.configuration?.mode === 'battery';
  const chargerValue = item.configuration?.battery?.chargerName ?? settings.chargerPrices[0]?.name ?? '';
  const chargerSelect = (
    <select aria-label="充电器" value={chargerValue} disabled={!isBattery} onChange={(event) => actions.applySelection(item, { chargerId: event.target.value })} style={{ ...fieldStyle, opacity: isBattery ? 1 : 0.5 }}>
      {!settings.chargerPrices.length && <option value="">未配置充电器</option>}
      {settings.chargerPrices.map((charger) => <option key={charger.id} value={charger.name}>{charger.name}</option>)}
    </select>
  );

  const packaging = product?.packaging ?? [];
  const packagingValue = item.configuration?.packaging?.id ?? String(packaging[0]?.id ?? '');
  const packagingSelect = (
    <select aria-label="包装" value={packagingValue} disabled={!product} onChange={(event) => actions.applySelection(item, { packagingId: event.target.value })} style={fieldStyle}>
      {!packaging.length && <option value="">无包装</option>}
      {packaging.map((row) => <option key={String(row.id)} value={String(row.id)}>{row.name?.trim() || '未命名包装'}</option>)}
    </select>
  );

  const accessoryOptions = product ? productAccessoryList(product, settings.categoryAccessories) : [];
  const selectedAccessories = item.configuration?.accessoryNames ?? [];
  const accessoryButton = (
    <button type="button" title="选择配件" disabled={!product} onClick={(event) => onOpenPicker(item.clientKey, 'accessory', event.currentTarget)} style={{ ...compactButtonStyle, width: '100%', justifyContent: 'space-between', opacity: product ? 1 : 0.5 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedAccessories.length ? `${selectedAccessories.length} 项` : '选择配件'}</span>
      {selectedAccessories.length > 0 && <span style={{ color: 'var(--color-accent)' }}>{money(item.configuration?.accessoryPriceCents ?? 0)}</span>}
    </button>
  );

  let weightCell = <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  if (product && item.configuration) {
    const weights = quotationConfigWeights(product, item.configuration, settings);
    weightCell = <span title="实重 / 计费重"><strong style={{ display: 'block' }}>{weights.actualWeightKg.toFixed(2)} kg</strong><small style={{ color: 'var(--color-text-muted)' }}>计费 {weights.chargeableWeightKg.toFixed(2)} kg</small></span>;
  }

  let costCell = <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  if (item.configuration) {
    const c = item.configuration;
    const battery = c.battery ? `${c.battery.batteryCount} × 电池 ${money(c.battery.batteryUnitPriceCents)}` : '裸机';
    costCell = <span title={`采购 ${money(c.baseCostCents)} · 包装 ${money(c.packaging?.costCents ?? 0)} · 配件 ${money(c.accessoryPriceCents)} · ${battery} · 充电器 ${money(c.battery?.chargerPriceCents ?? 0)} · 运费 ${money(c.shippingCostCents)} · 税 ${c.taxPercent}%`}>
      <strong style={{ display: 'block' }}>{money(c.totalCostCents)}</strong>
      <small style={{ color: 'var(--color-text-muted)' }}>成本</small>
    </span>;
  }

  const priceCell = (
    <div style={{ display: 'grid', gap: 2 }}>
      <input type="number" min="0" step="0.01" aria-label="单价" value={item.unitPrice} onChange={(event) => actions.updateUnitPrice(item, event.target.value)} style={{ ...fieldStyle, borderColor: parseNonNegative(item.unitPrice) === null ? 'var(--color-danger-strong)' : 'var(--color-border-control)' }} />
      {item.configuration?.priceOverridden && <button type="button" title="恢复自动价" onClick={() => actions.restoreAutoPrice(item)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: 0, background: 'transparent', color: 'var(--color-warning-text)', padding: 0, cursor: 'pointer', fontSize: 10 }}><RotateCcw size={11} />已手改 · 恢复</button>}
    </div>
  );

  const markupInput = (
    <input type="number" min="0" step="0.01" aria-label="毛利率" value={item.configuration?.markupPercent ?? ''} disabled={!product || !item.configuration} onChange={(event) => actions.applySelection(item, { markupPercent: Number(event.target.value) || 0 })} style={fieldStyle} />
  );

  const tierCell = (
    <div style={{ display: 'grid', gap: 4 }}>
      {(item.priceTiers ?? []).map((tier, tierIndex) => <div key={tierIndex} style={{ display: 'grid', gridTemplateColumns: '48px 10px 48px 56px 22px', gap: 3, alignItems: 'center' }}>
        <input type="number" min="0" step="any" aria-label="区间起始数量" placeholder="≥" value={tier.minQuantity} onChange={(event) => actions.updateTier(item.clientKey, tierIndex, { minQuantity: event.target.value })} style={fieldStyle} />
        <span style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>~</span>
        <input type="number" min="0" step="any" aria-label="区间截止数量" placeholder="不限" value={tier.maxQuantity} onChange={(event) => actions.updateTier(item.clientKey, tierIndex, { maxQuantity: event.target.value })} style={fieldStyle} />
        <input type="number" min="0" step="0.01" aria-label="区间单价（元）" placeholder="单价" value={tier.unitPrice} onChange={(event) => actions.updateTier(item.clientKey, tierIndex, { unitPrice: event.target.value })} style={fieldStyle} />
        <button type="button" className="icon-button danger" title="删除数量区间" onClick={() => actions.removeTier(item.clientKey, tierIndex)}><X size={12} /></button>
      </div>)}
      <button type="button" title="添加数量区间报价" onClick={() => actions.addTier(item.clientKey)} style={{ justifySelf: 'start', ...compactButtonStyle, minHeight: 26, padding: '0 6px' }}><Plus size={11} />区间价</button>
    </div>
  );

  const remarkInput = (
    <input value={item.remark} onChange={(event) => actions.updateLine(item.clientKey, { remark: event.target.value })} style={fieldStyle} aria-label="备注" />
  );

  return { productCell, batterySelect, chargerSelect, packagingSelect, accessoryButton, weightCell, costCell, priceCell, markupInput, tierCell, remarkInput, accessoryOptions };
}

function RowActions({ item, index, count, actions, extraOpen, onToggleExtra, showExtra }: {
  item: QuotationLineDraft;
  index: number;
  count: number;
  actions: QuotationLineActions;
  extraOpen: boolean;
  onToggleExtra: (lineKey: string) => void;
  showExtra: boolean;
}) {
  return <div style={{ display: 'flex', gap: 2 }}>
    {showExtra && <button type="button" className="icon-button" title="数量区间价" onClick={() => onToggleExtra(item.clientKey)} style={{ transform: extraOpen ? 'rotate(180deg)' : undefined }}><ChevronDown size={14} /></button>}
    <button type="button" className="icon-button" title="上移产品行" disabled={index === 0} onClick={() => actions.moveLine(index, -1)}><ArrowUp size={14} /></button>
    <button type="button" className="icon-button" title="下移产品行" disabled={index === count - 1} onClick={() => actions.moveLine(index, 1)}><ArrowDown size={14} /></button>
    <button type="button" className="icon-button" title="复制产品行" onClick={() => actions.duplicateLine(index)}><Copy size={14} /></button>
    <button type="button" className="icon-button danger" title="删除产品行" onClick={() => actions.removeLine(item.clientKey)}><Trash2 size={14} /></button>
  </div>;
}

/** 桌面宽表行：memo 后只有本行数据/设置变化才重渲染。 */
export const QuotationItemRow = memo(function QuotationItemRow(props: QuotationItemRowProps) {
  const { item, index, count, extraOpen, actions, onToggleExtra } = props;
  const cells = useCells(props);
  return <Fragment>
    <tr>
      <td className="quotation-config-index">{index + 1}</td>
      <td className="quotation-config-product is-sticky-left">{cells.productCell}</td>
      <td style={{ minWidth: 168 }}>{cells.batterySelect}</td>
      <td style={{ minWidth: 112 }}>{cells.chargerSelect}</td>
      <td style={{ minWidth: 120 }}>{cells.packagingSelect}</td>
      <td style={{ minWidth: 110 }}>{cells.accessoryButton}</td>
      <td style={{ minWidth: 90 }}>{cells.weightCell}</td>
      <td style={{ minWidth: 84 }}>{cells.costCell}</td>
      <td style={{ minWidth: 70 }}>{cells.markupInput}</td>
      <td style={{ minWidth: 100 }}>{cells.priceCell}</td>
      <td style={{ minWidth: 140 }}>{cells.remarkInput}</td>
      <td className="quotation-config-actions is-sticky-right">
        <RowActions item={item} index={index} count={count} actions={actions} extraOpen={extraOpen} onToggleExtra={onToggleExtra} showExtra />
      </td>
    </tr>
    {extraOpen && <tr className="quotation-config-extra-row">
      <td colSpan={12}>
        <div className="quotation-config-extra">
          <div><span>数量区间价</span>{cells.tierCell}</div>
        </div>
      </td>
    </tr>}
  </Fragment>;
});

/** 手机卡片：与桌面行同一套单元格，单列/两列排布。 */
export const QuotationItemCard = memo(function QuotationItemCard(props: QuotationItemRowProps) {
  const { item, index, count, actions, onToggleExtra, extraOpen } = props;
  const cells = useCells(props);
  return <article className="quotation-config-card">
    <div className="quotation-config-card-head"><span>{index + 1}</span>{cells.productCell}</div>
    <div className="quotation-config-card-actions">
      <RowActions item={item} index={index} count={count} actions={actions} extraOpen={extraOpen} onToggleExtra={onToggleExtra} showExtra={false} />
    </div>
    <div className="quotation-config-card-grid">
      <label><span>电池配置</span>{cells.batterySelect}</label>
      <label><span>充电器</span>{cells.chargerSelect}</label>
      <label><span>包装</span>{cells.packagingSelect}</label>
      <label><span>配件</span>{cells.accessoryButton}</label>
      <label><span>重量</span>{cells.weightCell}</label>
      <label><span>成本</span>{cells.costCell}</label>
      <label><span>毛利率 %</span>{cells.markupInput}</label>
      <label><span>单价</span>{cells.priceCell}</label>
    </div>
    <div className="quotation-config-card-extra"><span>数量区间价</span>{cells.tierCell}</div>
    <label className="quotation-config-card-remark"><span>备注</span>{cells.remarkInput}</label>
  </article>;
});