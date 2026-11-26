import { Package } from 'lucide-react';
import { thumbUrl } from '../../image-urls';
import { boxesForQuantity, remainingQuantity } from '../../../shared/shipping';
import { useProductPreview } from '../ProductPreview';
import NumberField from '../NumberField';
import type { OrderItemDraft } from '../OrderForm';

export interface ShippingProductEditorProps {
  orderNo: string;
  items: OrderItemDraft[];
  quantities: Record<string, number>;
  onQuantityChange: (item: OrderItemDraft, value: number) => void;
}

function productImageUrl(item: OrderItemDraft): string {
  const path = item.imageRelativePath?.trim();
  if (!path) return '';
  return path.startsWith('/files/') ? path : `/files/${path}`;
}

/** 发货中产品行：产品图、剩余量、本次数量和箱数，直接可编辑。 */
export default function ShippingProductEditor({ orderNo, items, quantities, onQuantityChange }: ShippingProductEditorProps) {
  const { bind, previewElement } = useProductPreview();
  return <>
    <div className="shipping-product-editor">
      {items.map((item) => {
        const remaining = remainingQuantity(item);
        const quantity = Math.min(remaining, Math.max(0, Math.trunc(Number(quantities[item.id] ?? 0) || 0)));
        const boxes = boxesForQuantity(quantity, item.packSize);
        const imageUrl = productImageUrl(item);
        return <div className="order-shipping-item" key={item.id}>
          <span className="order-shipping-item-thumb" {...bind(imageUrl, item.name || '产品')}>
            {imageUrl ? <img src={thumbUrl(imageUrl, 240)} alt={`${item.name || '产品'}图片`} loading="lazy" decoding="async" /> : <Package size={16} aria-hidden="true" />}
          </span>
          <span className="order-shipping-item-copy">
            <strong title={item.name}>{item.name || '未填产品'}</strong>
            <span title={`${item.specification || '—'} · 剩余 ${remaining} 件 · ${item.packSize} 件/箱`}>{item.specification || '—'} · 剩余 {remaining} 件 · {item.packSize} 件/箱</span>
          </span>
          <NumberField min={0} max={remaining} integer ariaLabel={`${orderNo}-${item.name || '产品'}-本次发货数量`} value={quantity} onChange={(next) => onQuantityChange(item, next)} />
          <span className="order-shipping-item-boxes">{quantity > 0 ? `${boxes} 箱` : '—'}</span>
        </div>;
      })}
      {!items.length && <div className="table-state">该订单已全部发完</div>}
    </div>
    {previewElement}
  </>;
}
