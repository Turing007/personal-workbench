import { Package } from 'lucide-react';
import { thumbUrl } from '../../image-urls';
import { remainingQuantity } from '../../../shared/shipping';
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

/** 订单列表的产品摘要：图片、规格、数量和已发进度无需打开明细即可快速核对。 */
export default function OrderProductQuickList({ order, onOpen, className }: OrderProductQuickListProps) {
  const title = order.items
    .map((item) => `${item.name || '未填产品'} · ${item.specification || '规格未填写'} · ${item.quantity} 件`)
    .join('\n');

  return <button
    type="button"
    className={`order-product-quick-list${className ? ` ${className}` : ''}`}
    title={title || '查看产品明细'}
    onClick={onOpen}
  >
    {order.items.length ? order.items.map((item) => {
      const imageUrl = productImageUrl(item);
      const shipped = item.quantity - remainingQuantity(item);
      return <span className="order-product-quick-card" key={item.id}>
        <span className={`order-product-quick-thumb${imageUrl ? '' : ' is-empty'}`}>
          {imageUrl
            ? <img src={thumbUrl(imageUrl, 240)} alt={`${item.name || '产品'}图片`} loading="lazy" decoding="async" />
            : <Package size={20} aria-hidden="true" />}
        </span>
        <span className="order-product-quick-copy">
          <strong>{item.name || '未填产品'}</strong>
          <span className="order-product-quick-spec" title={`${item.specification || '—'} * ${item.quantity}`}>{item.specification || '—'} * {item.quantity}</span>
          {shipped > 0 && <span className="order-product-quick-shipped"><span>已发 {shipped}/{item.quantity}</span>{' '}<span>{remainingQuantity(item) > 0 ? `· 剩 ${remainingQuantity(item)}` : '· 已发完'}</span></span>}
        </span>
      </span>;
    }) : <span className="order-product-quick-empty">查看产品明细</span>}
  </button>;
}
