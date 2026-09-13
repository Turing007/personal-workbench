import { Fragment, useEffect, useState } from 'react';
import { calculateOrderLineAmountCents } from '../../shared/order-prices';
import { getOrderItemImages } from '../api';
import type { OrderDraft } from './OrderForm';

export interface OrderItemsTableProps {
  order: OrderDraft;
}

function packagingSize(item: { outerSize?: string; length?: string; width?: string; height?: string }) {
  if (item.outerSize) return item.outerSize;
  const dimensions = [item.length, item.width, item.height].filter(Boolean);
  return dimensions.length ? dimensions.join(' × ') : '未填写';
}

export default function OrderItemsTable({ order }: OrderItemsTableProps) {
  const [itemImages, setItemImages] = useState<Record<number, Array<{ url: string; name: string; mimeType: string }>>>({});

  useEffect(() => {
    if (!order.id) return undefined;
    let cancelled = false;
    void getOrderItemImages(order.id).then((result) => {
      if (!cancelled) setItemImages(result.itemImages);
    }).catch(() => { /* 图片加载失败不打断明细展示 */ });
    return () => { cancelled = true; };
  }, [order.id]);

  return (
    <div className="sticky-thead" style={{ overflow: 'auto', maxHeight: 'min(56vh, 480px)', border: '1px solid var(--tone-border-soft)', borderRadius: 6 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
        <thead><tr style={{ background: 'var(--tone-surface-frost)', textAlign: 'left', color: 'var(--tone-text-soft)' }}>{['品名', 'SKU', '规格', '数量', '装箱数', '箱数', '单价', '金额', '运费/箱', '运费小计', '备注'].map((title) => <th key={title} style={{ padding: '8px 9px', fontWeight: 600 }}>{title}</th>)}</tr></thead>
        <tbody>
          {order.items.length ? order.items.map((item) => {
            const unitPriceCents = item.unitPriceCents ?? 0;
            const amountCents = item.amountCents ?? calculateOrderLineAmountCents({ quantity: item.quantity, unitPriceCents });
            const packaging = item.packaging ?? [];
            const images = itemImages[Number(item.id)] ?? [];
            return <Fragment key={item.id}><tr style={{ borderTop: '1px solid #edf0f2', verticalAlign: 'top' }}>
              <td style={{ padding: '8px 9px', minWidth: 120 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{images.length ? <a href={images[0]!.url} target="_blank" rel="noreferrer" title="查看原图"><img src={images[0]!.url} alt={images[0]!.name} style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--tone-border-soft)', flexShrink: 0 }} /></a> : null}<span>{item.name}</span></div></td>
              <td style={{ padding: '8px 9px' }}>{item.sku}</td>
              <td style={{ padding: '8px 9px' }}>{item.specification}</td>
              <td style={{ padding: '8px 9px' }}>{item.quantity}</td>
              <td style={{ padding: '8px 9px' }}>{item.packSize}</td>
              <td style={{ padding: '8px 9px' }}>{item.boxes}</td>
              <td style={{ padding: '8px 9px', color: '#0f766e', fontWeight: 650 }}>{`¥ ${(unitPriceCents / 100).toFixed(2)}`}</td>
              <td style={{ padding: '8px 9px', color: '#0f766e', fontWeight: 650 }}>{`¥ ${(amountCents / 100).toFixed(2)}`}</td>
              <td style={{ padding: '8px 9px' }}>{`¥ ${((item.freightPerBoxCents ?? 0) / 100).toFixed(2)}`}</td>
              <td style={{ padding: '8px 9px' }}>{`¥ ${(((item.freightPerBoxCents ?? 0) * item.boxes) / 100).toFixed(2)}`}</td>
              <td style={{ padding: '8px 9px', whiteSpace: 'pre-wrap' }}>{item.remark || '—'}</td>
            </tr>{packaging.length > 0 && <tr style={{ borderTop: '1px dashed var(--tone-border-soft)' }}><td colSpan={11} style={{ padding: '0 9px 8px', color: 'var(--tone-text-soft)', fontSize: 11 }}>包装快照：{packaging.map((pack) => `${pack.name || '未命名包装'} · ${packagingSize(pack)} · ${pack.outerWeight || '未填写'} · ${pack.packSize} 件/箱`).join('；')}</td></tr>}</Fragment>;
          }) : <tr><td colSpan={11} style={{ padding: 14, textAlign: 'center', color: 'var(--tone-text-faint)' }}>暂无产品明细</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
