import { Check, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CustomerProduct } from '../../../shared/customers';
import { getCustomerProducts } from '../../api';

export interface CustomerProductPickerProps {
  customerId: number | null;
  value?: number | null;
  onSelect: (product: CustomerProduct) => void;
  onAddNew?: () => void;
  disabled?: boolean;
}

export default function CustomerProductPicker({ customerId, value, onSelect, onAddNew, disabled }: CustomerProductPickerProps) {
  const [products, setProducts] = useState<CustomerProduct[]>([]);
  const [status, setStatus] = useState<'complete' | 'incomplete' | 'all'>('complete');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!customerId) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void getCustomerProducts(customerId, { status }).then((items) => {
      if (!cancelled) setProducts(items);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '客户产品加载失败');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [customerId, status]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? products.filter((product) => [product.name, product.sku, product.specification].join(' ').toLowerCase().includes(needle)) : products;
  }, [products, query]);

  if (!customerId) return <div style={{ padding: 18, border: '1px dashed #cbd5e1', borderRadius: 6, color: '#94a3b8', textAlign: 'center', fontSize: 12 }}>请先选择客户，再调用对应的客户产品。</div>;

  return <div style={{ display: 'grid', gap: 8 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 7 }}><label style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 8, top: 8, color: '#94a3b8' }} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按品名、SKU、规格筛选" style={{ width: '100%', border: '1px solid #dbe3ea', borderRadius: 5, padding: query ? '7px 28px 7px 27px' : '7px 8px 7px 27px', fontSize: 12 }} />{!!query && <button type="button" aria-label="清空筛选" title="清空" onMouseDown={(event) => event.preventDefault()} onClick={() => setQuery('')} style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, border: 0, borderRadius: '50%', padding: 0, color: '#94a3b8', background: 'transparent', cursor: 'pointer' }}><X size={13} /></button>}</label><select aria-label="客户产品完善状态" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} style={{ border: '1px solid #dbe3ea', borderRadius: 5, padding: '0 7px', background: '#fff', color: '#475569', fontSize: 12 }}><option value="complete">已完善</option><option value="incomplete">待完善</option><option value="all">全部</option></select>{onAddNew && <button type="button" className="button button-secondary" disabled={disabled} title="添加客户新品" onClick={onAddNew}><Plus size={13} />添加新品</button>}</div>
    <div style={{ maxHeight: 280, overflowY: 'auto', display: 'grid', gap: 5 }}>
      {filtered.map((product) => <button key={product.id} type="button" disabled={disabled} onClick={() => onSelect(product)} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '8px 10px', border: `1px solid ${value === product.id ? '#99f6e4' : '#e2e8f0'}`, borderRadius: 6, background: value === product.id ? '#f0fdfa' : '#fff', color: '#334155', textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer' }}><span style={{ minWidth: 0 }}><strong style={{ display: 'block', color: '#17212b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</strong><small style={{ display: 'block', marginTop: 3, color: '#64748b' }}>{product.sku || '无客户 SKU'} · {product.specification || '无规格'} · {product.packCount ? `${product.packCount} 个/箱` : '装箱数待完善'}{product.finalPriceCents != null ? ` · ¥${(product.finalPriceCents / 100).toFixed(2)}` : ' · 价格待完善'}{product.remark.trim() || product.attachments.length ? ' · 已配置备注/附件' : ''}</small></span>{value === product.id ? <Check size={16} color="#0f766e" /> : <span style={{ color: product.completionStatus === 'complete' ? '#0f766e' : '#b45309', fontSize: 11 }}>{product.completionStatus === 'complete' ? '已完善' : '待完善'}</span>}</button>)}
      {loading && <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>正在加载客户产品…</div>}
      {!loading && !filtered.length && <div style={{ display: 'grid', gap: 7, padding: 18, border: '1px dashed #cbd5e1', borderRadius: 6, color: error ? '#b91c1c' : '#94a3b8', textAlign: 'center', fontSize: 12 }}><span>{error || '没有匹配的客户产品'}</span>{onAddNew && <button type="button" className="button button-secondary" onClick={onAddNew}>添加新品</button>}</div>}
    </div>
  </div>;
}
