import { Check, Image as ImageIcon, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { thumbUrl } from '../../image-urls';

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

const fieldStyle = { width: '100%', minWidth: 0, border: '1px solid #dbe3ea', borderRadius: 5, padding: '8px 9px', font: 'inherit', fontSize: 12 };

function imageUrl(image: LibraryProductImage | null | undefined): string {
  if (!image) return '';
  return thumbUrl(image.url ?? (image.relativePath ? `/files/${image.relativePath}` : ''), 240);
}

async function defaultLoadProducts(filters: { name: string; sku: string; specification: string }): Promise<LibraryProductOption[]> {
  // 报价/销售单只可选正式产品，草稿不对外提供。
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
      {([['name', '品名'], ['sku', 'SKU'], ['specification', '规格']] as const).map(([key, label]) => <label key={key} style={{ display: 'grid', gap: 4, fontSize: 11, color: '#64748b' }}>{label}<span style={{ position: 'relative' }}>{key === 'name' && <Search size={13} style={{ position: 'absolute', left: 8, top: 9, color: '#94a3b8' }} />}<input disabled={disabled} value={filters[key]} onChange={(event) => setFilter(key, event.target.value)} placeholder={`筛选${label}`} style={{ ...fieldStyle, ...(key === 'name' ? { paddingLeft: 27 } : {}) }} /></span></label>)}
    </div>
    <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
      {products.map((product) => {
        const selectedImageId = selectedImages[product.id] ?? product.images[0]?.id;
        const selectedImage = product.images.find((image) => image.id === selectedImageId) ?? product.images[0];
        return <div key={product.id} style={{ display: 'grid', gridTemplateColumns: '58px minmax(0,1fr) auto', gap: 9, alignItems: 'center', padding: 8, borderBottom: '1px solid #edf0f2', background: selectedProductId === product.id ? '#f0fdfa' : '#fff' }}>
          <div style={{ width: 58, height: 48, display: 'grid', placeItems: 'center', overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: 5, background: '#f8fafc' }}>{selectedImage ? <img src={imageUrl(selectedImage)} alt={selectedImage.originalName ?? product.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <ImageIcon size={18} color="#94a3b8" />}</div>
          <div style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: 12, color: '#17212b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</strong><span style={{ display: 'block', marginTop: 3, fontSize: 11, color: '#64748b' }}>{product.sku || '无 SKU'} · {product.specification || '无规格'}</span>{product.images.length > 1 && <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>{product.images.map((image) => <button key={image.id} type="button" title={`选择图片：${image.originalName ?? image.id}`} onClick={() => setSelectedImages((current) => ({ ...current, [product.id]: image.id }))} style={{ width: 28, height: 24, padding: 1, border: `1px solid ${selectedImageId === image.id ? '#0f766e' : '#cbd5e1'}`, borderRadius: 4, background: '#fff', cursor: 'pointer' }}><img src={imageUrl(image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></button>)}</div>}</div>
          <button disabled={disabled} type="button" title="选择产品" onClick={() => chooseProduct(product)} style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', border: `1px solid ${selectedProductId === product.id ? '#0f766e' : '#cbd5e1'}`, borderRadius: 5, color: selectedProductId === product.id ? '#0f766e' : '#64748b', background: '#fff', cursor: disabled ? 'not-allowed' : 'pointer' }}><Check size={15} /></button>
        </div>;
      })}
      {loading && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>正在查询产品库...</div>}
      {!loading && !products.length && <div style={{ padding: 20, textAlign: 'center', color: error ? '#b91c1c' : '#94a3b8', fontSize: 12 }}>{error || '没有匹配产品，可改用临时产品'}</div>}
    </div>
  </div>;
}
