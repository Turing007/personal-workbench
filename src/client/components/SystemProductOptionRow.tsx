import { Fragment } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { thumbUrl } from '../image-urls';

/**
 * 系统产品选择列表里的统一行：缩略图 + 品名 + 「规格 · SKU · 供应商 · 采购价」。
 * 客户产品编辑器、备货关联、报价/销售单的产品库选择共用这一套，避免到处"只看名字猜产品"。
 */
export interface SystemProductOptionData {
  name?: string;
  specification?: string;
  sku?: string;
  supplier?: string;
  /** 原始接口给数字（分转元后的值），前端映射层给字符串，两种都要兜住。 */
  purchasePrice?: string | number | null;
  images?: Array<{ url?: string; relativePath?: string; name?: string; originalName?: string }>;
}

export function systemProductImageUrl(images: SystemProductOptionData['images']): string | undefined {
  const image = images?.[0];
  if (!image) return undefined;
  const url = image.url ?? (image.relativePath ? `/files/${image.relativePath}` : '');
  return url ? thumbUrl(url, 240) : undefined;
}

/** 采购价文案：数字与数字字符串统一两位小数；空值返回空串（调用方据此整段不排）。 */
export function formatPurchasePrice(value: SystemProductOptionData['purchasePrice']): string {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? `¥ ${value.toFixed(2)}` : '';
  const text = value.trim();
  if (!text) return '';
  return /^\d+(\.\d+)?$/.test(text) ? `¥ ${Number(text).toFixed(2)}` : `¥ ${text}`;
}

export default function SystemProductOptionRow({ product, thumbSize = 40 }: { product: SystemProductOptionData; thumbSize?: number }) {
  const imageUrl = systemProductImageUrl(product.images);
  const pieces = [product.specification, product.sku, product.supplier].map((part) => part?.trim()).filter(Boolean) as string[];
  const price = formatPurchasePrice(product.purchasePrice);
  return (
    <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
      <span style={{ width: thumbSize, height: thumbSize, flexShrink: 0, display: 'grid', placeItems: 'center', overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-ui)', background: '#f8fafc' }}>
        {imageUrl ? <img src={imageUrl} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <ImageIcon size={16} color="#94a3b8" />}
      </span>
      <span style={{ minWidth: 0, flex: 1, display: 'grid', gap: 2 }}>
        <strong style={{ fontSize: 12, color: '#17212b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name || '未命名产品'}</strong>
        {(pieces.length > 0 || price) && <span style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pieces.map((part, index) => <Fragment key={part}>{index > 0 ? ' · ' : ''}{part}</Fragment>)}
          {price && <>{pieces.length > 0 ? ' · ' : ''}<span style={{ color: '#0f766e', fontWeight: 600 }}>{price}</span></>}
        </span>}
      </span>
    </span>
  );
}
