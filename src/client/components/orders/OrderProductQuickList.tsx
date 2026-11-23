import { Package } from 'lucide-react';
import { thumbUrl } from '../../image-urls';
import type { OrderDraft, OrderItemDraft } from '../OrderForm';

export interface OrderProductQuickListProps {
  order: OrderDraft;
  onOpen: () => void;
  className?: string;
}

function productImageUrl(item: OrderItemDraft): string {
  const path = item.imageRelativePath?.trim();
  if (!path) return '';
  return path.startsWith('/files/') ? path : `/files/${path}`;
}

/** 按 11px 字号估算标题宽度；超过两列两行的容量就整单改为单列。 */
function estimatedTextWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    if (/\s/.test(char)) width += 3;
    else if ((char.codePointAt(0) ?? 0) > 0x2e80) width += 11;
    else width += 6;
  }
  return width;
}

/** 订单列表收起态的产品摘要：让图片、规格和数量无需打开明细即可快速核对。 */
export default function OrderProductQuickList({ order, onOpen, className }: OrderProductQuickListProps) {
  const title = order.items
    .map((item) => `${item.name || '未填产品'} · ${item.specification || '规格未填写'} · ${item.quantity} 件`)
    .join('\n');
  const hasLongTitle = order.items.some((item) => estimatedTextWidth(item.name || '未填产品') > 150);
  const singleColumn = order.items.length === 1 || hasLongTitle;

  return <button
    type="button"
    className={`order-product-quick-list${singleColumn ? ' is-single' : ''}${className ? ` ${className}` : ''}`}
    title={title || '查看产品明细'}
    onClick={onOpen}
  >
    {order.items.length ? order.items.map((item) => {
      const imageUrl = productImageUrl(item);
      return <span className="order-product-quick-card" key={item.id}>
        <span className={`order-product-quick-thumb${imageUrl ? '' : ' is-empty'}`}>
          {imageUrl
            ? <img src={thumbUrl(imageUrl, 240)} alt={`${item.name || '产品'}图片`} loading="lazy" decoding="async" />
            : <Package size={20} aria-hidden="true" />}
        </span>
        <span className="order-product-quick-copy">
          <strong>{item.name || '未填产品'}</strong>
          <span className="order-product-quick-spec" title={`${item.specification || '—'} * ${item.quantity}`}>{item.specification || '—'} * {item.quantity}</span>
        </span>
      </span>;
    }) : <span className="order-product-quick-empty">查看产品明细</span>}
  </button>;
}
