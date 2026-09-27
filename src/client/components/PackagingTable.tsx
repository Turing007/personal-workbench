import { ChevronDown, ChevronRight, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { PackagingOption } from './OrderForm';
import type { PackagingPreset } from '../../shared/packaging-presets';
import { applyPackagingPreset, blankPackagingRow } from '../packaging-preset';
import PackagingImagesModal from './PackagingImagesModal';

export interface PackagingTableProps {
  value: PackagingOption[];
  onChange: (value: PackagingOption[]) => void;
  compact?: boolean;
  showPurchasePrice?: boolean;
  showImages?: boolean;
  /** 传入即启用「常用包装」一键填入，仅产品编辑器使用。 */
  presets?: PackagingPreset[];
  onManagePresets?: () => void;
  /** 只折叠「常用包装」预设条，填写用的表格始终摊开。 */
  collapsible?: boolean;
}

/** 预设卡片超过这个数量就先折叠，避免把编辑器顶部撑满。 */
const PRESET_COLLAPSE_AT = 6;

export default function PackagingTable({ value, onChange, compact = false, showPurchasePrice = true, showImages = true, presets = [], onManagePresets, collapsible = false }: PackagingTableProps) {
  const [imagesRowId, setImagesRowId] = useState<string>();
  const [presetsExpanded, setPresetsExpanded] = useState(false);
  const [presetsCollapsed, setPresetsCollapsed] = useState(collapsible);
  const update = (id: string, patch: Partial<PackagingOption>) => onChange(value.map((row) => row.id === id ? { ...row, ...patch } : row));
  const add = () => onChange([...value, blankPackagingRow()]);
  const imagesRow = value.find((row) => row.id === imagesRowId);
  const shownPresets = presetsExpanded ? presets : presets.slice(0, PRESET_COLLAPSE_AT);
  return (
    <div className="packaging-table-section">
      <div className="section-box-header">
        <span className="section-box-title">包装方式</span>
        <button type="button" className="link-button packaging-table-add" onClick={add}><Plus size={14} />添加包装</button>
      </div>
      {collapsible && !!presets.length && <button type="button" className="packaging-preset-toggle" aria-expanded={!presetsCollapsed} onClick={() => setPresetsCollapsed((current) => !current)}>
        {presetsCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        <span>常用包装</span>
        <span className="packaging-preset-toggle-count">{presets.length} 套</span>
      </button>}
      {(!collapsible || !presetsCollapsed) && !!presets.length && <div className="packaging-preset-bar">
        <div className="packaging-preset-list">
          {shownPresets.map((preset) => <button
            key={preset.id || `${preset.name}-${preset.innerSize}-${preset.outerSize}`}
            type="button"
            className="packaging-preset"
            title="点击填入这一套包装规格"
            onClick={() => onChange(applyPackagingPreset(value, preset))}
          >
            <strong>{preset.name || '未命名包装'}</strong>
            <span>{[preset.innerSize && `内盒 ${preset.innerSize}`, preset.outerSize && `外箱 ${preset.outerSize}`, `${preset.packSize} 台/箱`].filter(Boolean).join(' · ')}</span>
            {!!preset.purchasePrice && <span className="packaging-preset-price">包装采购价 ¥{preset.purchasePrice}</span>}
          </button>)}
          {presets.length > PRESET_COLLAPSE_AT && <button type="button" className="packaging-preset-more" onClick={() => setPresetsExpanded((current) => !current)}>{presetsExpanded ? '收起' : `展开其余 ${presets.length - PRESET_COLLAPSE_AT} 套`}</button>}
        </div>
        {onManagePresets && <button type="button" className="link-button packaging-preset-manage" onClick={onManagePresets}>管理预设 ›</button>}
      </div>}
      <div className="packaging-table-shell">
        <table className={`packaging-table${compact ? ' is-compact' : ''}`}>
          <thead><tr>{['包装名称', '内盒尺寸', '内盒重量', '外箱尺寸', '外箱重量', '外箱装箱数', ...(showPurchasePrice ? ['包装采购价'] : []), ...(showImages ? ['包装图片'] : []), ''].map((title) => <th key={title}>{title}</th>)}</tr></thead>
          <tbody>{value.map((row) => <tr key={row.id}>
            <td><input className="input packaging-table-input" aria-label="包装名称" value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} /></td>
            <td className="packaging-table-col-size"><input className="input packaging-table-input" aria-label="内盒尺寸" value={row.innerSize} onChange={(event) => update(row.id, { innerSize: event.target.value })} placeholder="35×28×20cm" /></td>
            <td className="packaging-table-col-number"><input className="input packaging-table-input" type="number" min={0} aria-label="内盒重量" value={row.innerWeight} onChange={(event) => update(row.id, { innerWeight: event.target.value })} placeholder="kg" /></td>
            <td className="packaging-table-col-size"><input className="input packaging-table-input" aria-label="外箱尺寸" value={row.outerSize} onChange={(event) => update(row.id, { outerSize: event.target.value })} placeholder="40×30×25cm" /></td>
            <td className="packaging-table-col-number"><input className="input packaging-table-input" type="number" min={0} aria-label="外箱重量" value={row.outerWeight} onChange={(event) => update(row.id, { outerWeight: event.target.value })} placeholder="kg" /></td>
            <td className="packaging-table-col-number"><input className="input packaging-table-input" type="number" min={1} aria-label="外箱装箱数" value={row.packSize} onChange={(event) => update(row.id, { packSize: Math.max(1, Number(event.target.value) || 1) })} /></td>
            {showPurchasePrice && <td className="packaging-table-col-price"><input className="input packaging-table-input" type="number" min={0} step="0.01" aria-label="包装采购价" value={row.purchasePrice} onChange={(event) => update(row.id, { purchasePrice: event.target.value })} placeholder="元" /></td>}
            {showImages && <td className="packaging-table-col-images"><button type="button" className="packaging-images-trigger" title="维护包装图片" onClick={() => setImagesRowId(row.id)}><ImageIcon size={14} />{row.images?.length ? <span>{row.images.length}张</span> : <span>添加</span>}</button></td>}
            <td className="packaging-table-col-actions"><button type="button" className="icon-button danger" title="删除包装" onClick={() => onChange(value.filter((entry) => entry.id !== row.id))}><Trash2 size={14} /></button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {!value.length && <div className="empty-state">尚未添加包装方式</div>}
      {imagesRow && <PackagingImagesModal open={Boolean(imagesRow)} packagingName={imagesRow.name} value={imagesRow.images ?? []} onChange={(images) => update(imagesRow.id, { images })} onClose={() => setImagesRowId(undefined)} />}
    </div>
  );
}
