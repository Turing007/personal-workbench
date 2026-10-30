import { Check, PackagePlus } from 'lucide-react';
import type { CustomerProduct, OrderItemDraft } from './OrderForm';

export interface ProductPickerProps {
  products: CustomerProduct[];
  selectedItems: OrderItemDraft[];
  onSelect: (product: CustomerProduct) => void;
  onAddNew?: () => void;
}

export default function ProductPicker({ products, selectedItems, onSelect, onAddNew }: ProductPickerProps) {
  return (
    <div style={{ display: 'grid', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
      {products.map((product) => {
        const selected = selectedItems.some((item) => item.productId === product.id);
        return <button key={product.id} type="button" onClick={() => onSelect(product)} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 7, textAlign: 'left', padding: '9px 10px', border: `1px solid ${selected ? '#99f6e4' : '#e2e8f0'}`, background: selected ? '#f0fdfa' : '#fff', borderRadius: 'var(--radius-ui)', color: '#334155', cursor: 'pointer' }}><span style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: 12, color: '#17212b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</strong><span style={{ display: 'block', marginTop: 3, color: '#64748b', fontSize: 11 }}>{product.sku || '无 SKU'} · {product.specification || '无规格'}</span></span>{selected ? <Check size={16} color="#0f766e" /> : <PackagePlus size={16} color="#94a3b8" />}</button>;
      })}
      {!products.length && <div style={{ display: 'grid', justifyItems: 'center', gap: 9, padding: 22, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 'var(--radius-ui)', color: '#94a3b8', fontSize: 12 }}><span>没有匹配产品</span>{onAddNew && <button type="button" onClick={onAddNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #0f766e', borderRadius: 'var(--radius-ui)', padding: '6px 10px', background: '#f0fdfa', color: '#0f766e', cursor: 'pointer', fontSize: 12 }}><PackagePlus size={14} />添加新品</button>}</div>}
    </div>
  );
}
