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
        return <button key={product.id} type="button" onClick={() => onSelect(product)} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 7, textAlign: 'left', padding: '9px 10px', border: `1px solid ${selected ? 'var(--color-accent-border)' : 'var(--color-border)'}`, background: selected ? 'var(--color-accent-soft)' : 'var(--color-surface)', borderRadius: 'var(--radius-ui)', color: 'var(--color-text)', cursor: 'pointer' }}><span style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: 12, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</strong><span style={{ display: 'block', marginTop: 3, color: 'var(--color-text-secondary)', fontSize: 11 }}>{product.sku || '无 SKU'} · {product.specification || '无规格'}</span></span>{selected ? <Check size={16} color="var(--color-accent)" /> : <PackagePlus size={16} color="var(--color-text-muted)" />}</button>;
      })}
      {!products.length && <div style={{ display: 'grid', justifyItems: 'center', gap: 9, padding: 22, textAlign: 'center', border: '1px dashed var(--color-border-control)', borderRadius: 'var(--radius-ui)', color: 'var(--color-text-muted)', fontSize: 12 }}><span>没有匹配产品</span>{onAddNew && <button type="button" onClick={onAddNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-ui)', padding: '6px 10px', background: 'var(--color-accent-soft)', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 12 }}><PackagePlus size={14} />添加新品</button>}</div>}
    </div>
  );
}
