import { Check, Package, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { customerProductStandardCostCents, type CustomerProduct } from '../../../shared/customers';
import { getCustomerProducts } from '../../api';
import { thumbUrl } from '../../image-urls';

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
  const [preview, setPreview] = useState<{ url: string; name: string; left: number; top: number; size: number } | null>(null);

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

  useEffect(() => {
    if (!preview) return undefined;
    const close = () => setPreview(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [preview]);

  const showPreview = (target: HTMLElement, product: CustomerProduct, url: string) => {
    const rect = target.getBoundingClientRect();
    const size = Math.min(340, window.innerWidth - 24, window.innerHeight - 24);
    const gap = 12;
    const left = rect.right + gap + size <= window.innerWidth - gap
      ? rect.right + gap
      : Math.max(gap, rect.left - size - gap);
    const top = Math.min(Math.max(gap, rect.top), window.innerHeight - size - gap);
    setPreview({ url, name: product.name, left, top, size });
  };

  if (!customerId) return <div style={{ padding: 18, border: '1px dashed var(--color-border-control)', borderRadius: 'var(--radius-ui)', color: 'var(--color-text-muted)', textAlign: 'center', fontSize: 12 }}>请先选择客户，再调用对应的客户产品。</div>;

  return <>
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 7 }}><label style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--color-text-muted)' }} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按品名、SKU、规格筛选" style={{ width: '100%', border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: query ? '7px 28px 7px 27px' : '7px 8px 7px 27px', fontSize: 12 }} />{!!query && <button type="button" aria-label="清空筛选" title="清空" onMouseDown={(event) => event.preventDefault()} onClick={() => setQuery('')} style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, border: 0, borderRadius: '50%', padding: 0, color: 'var(--color-text-muted)', background: 'transparent', cursor: 'pointer' }}><X size={13} /></button>}</label><select aria-label="客户产品完善状态" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} style={{ border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: '0 7px', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: 12 }}><option value="complete">已完善</option><option value="incomplete">待完善</option><option value="all">全部</option></select>{onAddNew && <button type="button" className="button button-secondary" disabled={disabled} title="添加客户新品" onClick={onAddNew}><Plus size={13} />添加新品</button>}</div>
      <div style={{ maxHeight: 280, overflowY: 'auto', display: 'grid', gap: 5 }}>
        {filtered.map((product) => {
          const imagePath = product.imageRelativePath
            ? (product.imageRelativePath.startsWith('/files/') ? product.imageRelativePath : `/files/${product.imageRelativePath}`)
            : '';
          const image = imagePath ? thumbUrl(imagePath, 240) : '';
          const standardCost = customerProductStandardCostCents(product);
          return <button key={product.id} type="button" disabled={disabled} onClick={() => onSelect(product)} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) auto', alignItems: 'center', gap: 8, padding: '8px 10px', border: `1px solid ${value === product.id ? 'var(--color-accent-border)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-ui)', background: value === product.id ? 'var(--color-accent-soft)' : 'var(--color-surface)', color: 'var(--color-text)', textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer' }}>
            <span
              style={{ display: 'grid', width: 44, height: 44, placeItems: 'center', overflow: 'hidden', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface-subtle)', color: 'var(--color-text-muted)' }}
              title={image ? '悬停查看大图' : undefined}
              onMouseEnter={image ? (event) => showPreview(event.currentTarget, product, imagePath) : undefined}
              onMouseLeave={image ? () => setPreview(null) : undefined}
            >
              {image ? <img src={image} alt={`${product.name}图片`} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Package size={18} aria-hidden="true" />}
            </span>
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: 'block', color: 'var(--color-text)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</strong>
              <small style={{ display: 'block', marginTop: 3, color: 'var(--color-text-secondary)' }}>{product.sku || '无客户 SKU'} · {product.specification || '无规格'} · {product.packCount ? `${product.packCount} 个/箱` : '装箱数待完善'}{product.finalPriceCents != null ? ` · ¥${(product.finalPriceCents / 100).toFixed(2)}` : ' · 价格待完善'}{product.remark.trim() || product.attachments.length ? ' · 已配置备注/附件' : ''}</small>
              <small style={{ display: 'block', marginTop: 2, color: 'var(--color-text-secondary)' }}>供应商：{product.supplier?.trim() || '未填'} · 成本价：{standardCost == null ? '未核对成本' : `¥${(standardCost / 100).toFixed(2)}`}</small>
            </span>
            {value === product.id ? <Check size={16} color="var(--color-accent)" /> : <span style={{ color: product.completionStatus === 'complete' ? 'var(--color-accent)' : 'var(--color-warning-text)', fontSize: 11 }}>{product.completionStatus === 'complete' ? '已完善' : '待完善'}</span>}
          </button>;
        })}
        {loading && <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>正在加载客户产品…</div>}
        {!loading && !filtered.length && <div style={{ display: 'grid', gap: 7, padding: 18, border: '1px dashed var(--color-border-control)', borderRadius: 'var(--radius-ui)', color: error ? 'var(--color-danger)' : 'var(--color-text-muted)', textAlign: 'center', fontSize: 12 }}><span>{error || '没有匹配的客户产品'}</span>{onAddNew && <button type="button" className="button button-secondary" onClick={onAddNew}>添加新品</button>}</div>}
      </div>
    </div>
    {preview && createPortal(
      <div className="customer-product-picker-preview" role="tooltip" style={{ left: preview.left, top: preview.top, width: preview.size, height: preview.size }}>
        <img src={thumbUrl(preview.url, 960)} alt={`${preview.name}大图`} decoding="async" />
      </div>,
      document.body,
    )}
  </>;
}
