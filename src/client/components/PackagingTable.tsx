import { Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { PackagingOption } from './OrderForm';
import PackagingImagesModal from './PackagingImagesModal';

export interface PackagingTableProps {
  value: PackagingOption[];
  onChange: (value: PackagingOption[]) => void;
  compact?: boolean;
  showPurchasePrice?: boolean;
  showImages?: boolean;
}

const inputStyle = { width: '100%', minWidth: 0, fontSize: 12 };

export default function PackagingTable({ value, onChange, compact = false, showPurchasePrice = true, showImages = true }: PackagingTableProps) {
  const [imagesRowId, setImagesRowId] = useState<string>();
  const update = (id: string, patch: Partial<PackagingOption>) => onChange(value.map((row) => row.id === id ? { ...row, ...patch } : row));
  const add = () => onChange([...value, { id: `pack-${Date.now()}`, name: '彩盒包装', innerSize: '', innerWeight: '', outerSize: '', outerWeight: '', packSize: 1, purchasePrice: '', images: [] }]);
  const imagesRow = value.find((row) => row.id === imagesRowId);
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 12, fontWeight: 650, color: '#334155' }}>包装方式</span><button type="button" onClick={add} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, background: 'transparent', color: '#0f766e', cursor: 'pointer', fontSize: 12 }}><Plus size={14} />添加包装</button></div>
      <div className="packaging-table-shell">
        <table className="packaging-table" style={{ minWidth: compact ? 760 : 980 }}>
          <thead><tr>{['包装名称', '内盒尺寸', '内盒重量', '外箱尺寸', '外箱重量', '外箱装箱数', ...(showPurchasePrice ? ['包装采购价'] : []), ...(showImages ? ['包装图片'] : []), ''].map((title) => <th key={title}>{title}</th>)}</tr></thead>
          <tbody>{value.map((row) => <tr key={row.id}>
            <td><input className="input packaging-table-input" aria-label="包装名称" value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} style={inputStyle} /></td>
            <td style={{ padding: 5 }}><input aria-label="内盒尺寸" value={row.innerSize} onChange={(event) => update(row.id, { innerSize: event.target.value })} placeholder="35×28×20cm" style={inputStyle} /></td>
            <td style={{ padding: 5, width: 100 }}><input type="number" min={0} aria-label="内盒重量" value={row.innerWeight} onChange={(event) => update(row.id, { innerWeight: event.target.value })} placeholder="kg" style={inputStyle} /></td>
            <td style={{ padding: 5 }}><input aria-label="外箱尺寸" value={row.outerSize} onChange={(event) => update(row.id, { outerSize: event.target.value })} placeholder="40×30×25cm" style={inputStyle} /></td>
            <td style={{ padding: 5, width: 100 }}><input type="number" min={0} aria-label="外箱重量" value={row.outerWeight} onChange={(event) => update(row.id, { outerWeight: event.target.value })} placeholder="kg" style={inputStyle} /></td>
            <td style={{ padding: 5, width: 100 }}><input type="number" min={1} aria-label="外箱装箱数" value={row.packSize} onChange={(event) => update(row.id, { packSize: Math.max(1, Number(event.target.value) || 1) })} style={inputStyle} /></td>
            {showPurchasePrice && <td style={{ padding: 5, width: 110 }}><input type="number" min={0} step="0.01" aria-label="包装采购价" value={row.purchasePrice} onChange={(event) => update(row.id, { purchasePrice: event.target.value })} placeholder="元" style={inputStyle} /></td>}
            {showImages && <td style={{ padding: 5, width: 84 }}><button type="button" className="packaging-images-trigger" title="维护包装图片" onClick={() => setImagesRowId(row.id)}><ImageIcon size={14} />{row.images?.length ? <span>{row.images.length}张</span> : <span>添加</span>}</button></td>}
            <td style={{ padding: 5, width: 34 }}><button type="button" title="删除包装" onClick={() => onChange(value.filter((entry) => entry.id !== row.id))} style={{ border: 0, background: 'transparent', color: '#b91c1c', cursor: 'pointer', padding: 5 }}><Trash2 size={14} /></button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {!value.length && <div style={{ padding: 12, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>尚未添加包装方式</div>}
      {imagesRow && <PackagingImagesModal open={Boolean(imagesRow)} packagingName={imagesRow.name} value={imagesRow.images ?? []} onChange={(images) => update(imagesRow.id, { images })} onClose={() => setImagesRowId(undefined)} />}
    </div>
  );
}
