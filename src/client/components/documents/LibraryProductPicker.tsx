import { Check, Image as ImageIcon, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { thumbUrl } from '../../image-urls';
import { formatPurchasePrice } from '../SystemProductOptionRow';

export interface LibraryProductImage {
  id: number | string;
  relativePath?: string;
  url?: string;
  originalName?: string;
}

export interface LibraryProductOption {
  id: number;
  name: string;
  sku: string;
  specification: string;
  parameters?: string;
  images: LibraryProductImage[];
  /** 供应商与采购价：接口原样带回，用于在列表里判断是哪款（数字或字符串都可能）。 */
  supplier?: string;
  purchasePrice?: string | number | null;
}

export interface LibraryProductSelection {
  product: LibraryProductOption;
  image: LibraryProductImage | null;
}

export interface LibraryProductPickerProps {
  onSelect: (selection: LibraryProductSelection) => void;
  selectedProductId?: number | null;
  loadProducts?: (filters: { name: string; sku: string; specification: string }) => Promise<LibraryProductOption[]>;
  disabled?: boolean;
}

const fieldStyle = { width: '100%', minWidth: 0, border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: '8px 9px', font: 'inherit', fontSize: 12 };

function imageUrl(image: LibraryProductImage | null | undefined): string {
  if (!image) return '';
  return thumbUrl(image.url ?? (image.relativePath ? `/files/${image.relativePath}` : ''), 240);
}

async function defaultLoadProducts(filters: { name: string; sku: string; specification: string }): Promise<LibraryProductOption[]> {
  // 报价/销售单只可选在售产品：草稿与已停售的都不对外提供。
  const query = new URLSearchParams({ pageSize: '100', status: 'active' });
  if (filters.name.trim()) query.set('name', filters.name.trim());
  if (filters.sku.trim()) query.set('sku', filters.sku.trim());
  if (filters.specification.trim()) query.set('specification', filters.specification.trim());
  const response = await fetch(`/api/products?${query.toString()}`);
  const payload = await response.json() as { ok?: boolean; data?: { items?: LibraryProductOption[] }; error?: { message?: string } };
  if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? '产品库加载失败');
  return payload.data?.items ?? [];
}

export default function LibraryProductPicker({ onSelect, selectedProductId, loadProducts = defaultLoadProducts, disabled }: LibraryProductPickerProps) {
  const [filters, setFilters] = useState({ name: '', sku: '', specification: '' });
  const [products, setProducts] = useState<LibraryProductOption[]>([]);
  const [selectedImages, setSelectedImages] = useState<Record<number, number | string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const filterKey = useMemo(() => `${filters.name}\u0000${filters.sku}\u0000${filters.specification}`, [filters]);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void loadProducts(filters).then((items) => {
        if (currentRequest !== requestId.current) return;
        setProducts(items);
        setSelectedImages((current) => {
          const next = { ...current };
          items.forEach((product) => {
            if (next[product.id] == null && product.images[0]) next[product.id] = product.images[0].id;
          });
          return next;
        });
      }).catch((reason) => {
        if (currentRequest === requestId.current) setError(reason instanceof Error ? reason.message : '产品库加载失败');
      }).finally(() => {
        if (currentRequest === requestId.current) setLoading(false);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filterKey, loadProducts]);

  const setFilter = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const chooseProduct = (product: LibraryProductOption) => {
    const selectedId = selectedImages[product.id];
    const image = product.images.find((item) => item.id === selectedId) ?? product.images[0] ?? null;
    onSelect({ product, image });
  };

  return <div style={{ display: 'grid', gap: 9 }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1.2fr', gap: 8 }}>
      {([['name', '品名'], ['sku', 'SKU'], ['specification', '规格']] as const).map(([key, label]) => <label key={key} style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--color-text-secondary)' }}>{label}<span style={{ position: 'relative' }}>{key === 'name' && <Search size={13} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--color-text-muted)' }} />}<input disabled={disabled} value={filters[key]} onChange={(event) => setFilter(key, event.target.value)} placeholder={`筛选${label}`} style={{ ...fieldStyle, ...(key === 'name' ? { paddingLeft: 27 } : {}) }} /></span></label>)}
    </div>
    <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)' }}>
      {products.map((product) => {
        const selectedImageId = selectedImages[product.id] ?? product.images[0]?.id;
        const selectedImage = product.images.find((image) => image.id === selectedImageId) ?? product.images[0];
        const priceText = formatPurchasePrice(product.purchasePrice);
        return <div key={product.id} style={{ display: 'grid', gridTemplateColumns: '58px minmax(0,1fr) auto', gap: 9, alignItems: 'center', padding: 8, borderBottom: '1px solid var(--color-border)', background: selectedProductId === product.id ? 'var(--color-accent-soft)' : 'var(--color-surface)' }}>
          <div style={{ width: 58, height: 48, display: 'grid', placeItems: 'center', overflow: 'hidden', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface-subtle)' }}>{selectedImage ? <img src={imageUrl(selectedImage)} alt={selectedImage.originalName ?? product.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <ImageIcon size={18} color="var(--color-text-muted)" />}</div>
          <div style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: 12, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</strong><span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.sku || '无 SKU'} · {product.specification || '无规格'}{product.supplier?.trim() ? ` · ${product.supplier.trim()}` : ''}{priceText && <> · <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{priceText}</span></>}</span>{product.images.length > 1 && <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>{product.images.map((image) => <button key={image.id} type="button" title={`选择图片：${image.originalName ?? image.id}`} onClick={() => setSelectedImages((current) => ({ ...current, [product.id]: image.id }))} style={{ width: 28, height: 24, padding: 1, border: `1px solid ${selectedImageId === image.id ? 'var(--color-accent)' : 'var(--color-border-control)'}`, borderRadius: 'var(--radius-ui)', background: 'var(--color-surface)', cursor: 'pointer' }}><img src={imageUrl(image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></button>)}</div>}</div>
          <button disabled={disabled} type="button" title="选择产品" onClick={() => chooseProduct(product)} style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', border: `1px solid ${selectedProductId === product.id ? 'var(--color-accent)' : 'var(--color-border-control)'}`, borderRadius: 'var(--radius-ui)', color: selectedProductId === product.id ? 'var(--color-accent)' : 'var(--color-text-secondary)', background: 'var(--color-surface)', cursor: disabled ? 'not-allowed' : 'pointer' }}><Check size={15} /></button>
        </div>;
      })}
      {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>正在查询产品库...</div>}
      {!loading && !products.length && <div style={{ padding: 20, textAlign: 'center', color: error ? 'var(--color-danger)' : 'var(--color-text-muted)', fontSize: 12 }}>{error || '没有匹配产品，可改用临时产品'}</div>}
    </div>
  </div>;
}
