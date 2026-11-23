import { ChevronLeft, ChevronRight, Package, ZoomIn } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { calculateOrderLineAmountCents } from '../../shared/order-prices';
import { getOrderItemImages } from '../api';
import { thumbUrl } from '../image-urls';
import Modal from './Modal';
import type { OrderDraft, OrderItemDraft } from './OrderForm';

export interface OrderItemCardsProps {
  order: OrderDraft;
  showPackaging?: boolean;
}

interface ItemImage {
  url: string;
  name: string;
  mimeType: string;
}

function packagingSize(item: { outerSize?: string; length?: string; width?: string; height?: string }) {
  if (item.outerSize) return item.outerSize;
  const dimensions = [item.length, item.width, item.height].filter(Boolean);
  return dimensions.length ? dimensions.join(' × ') : '未填写';
}

function money(cents = 0) {
  return `¥ ${(cents / 100).toFixed(2)}`;
}

export default function OrderItemCards({ order, showPackaging = true }: OrderItemCardsProps) {
  const [itemImages, setItemImages] = useState<Record<number, ItemImage[]>>({});
  const [viewerItemId, setViewerItemId] = useState<string>();
  const [viewerIndex, setViewerIndex] = useState(0);

  useEffect(() => {
    if (!order.id) return undefined;
    let cancelled = false;
    void getOrderItemImages(order.id).then((result) => {
      if (!cancelled) setItemImages(result.itemImages);
    }).catch(() => { /* 图片加载失败不打断明细展示 */ });
    return () => { cancelled = true; };
  }, [order.id]);

  const viewerItem = useMemo(
    () => order.items.find((item) => item.id === viewerItemId),
    [order.items, viewerItemId],
  );
  const viewerImages = viewerItem ? itemImages[Number(viewerItem.id)] ?? [] : [];
  const viewerImage = viewerImages[Math.min(viewerIndex, viewerImages.length - 1)];

  const openViewer = (item: OrderItemDraft, index: number) => {
    setViewerItemId(item.id);
    setViewerIndex(index);
  };

  const stepViewer = (offset: number) => {
    setViewerIndex((index) => Math.min(Math.max(index + offset, 0), viewerImages.length - 1));
  };

  return <>
    <div className="order-detail-cards">
      {order.items.length ? order.items.map((item) => {
        const unitPriceCents = item.unitPriceCents ?? 0;
        const amountCents = item.amountCents ?? calculateOrderLineAmountCents({ quantity: item.quantity, unitPriceCents });
        const images = itemImages[Number(item.id)] ?? [];
        const firstImage = images[0];
        const freightPerBoxCents = item.freightPerBoxCents ?? 0;
        const freightCents = freightPerBoxCents * item.boxes;
        return <article className="order-detail-card" key={item.id}>
          {firstImage ? (
            <button type="button" className="order-detail-card-media" title="放大查看产品图片" aria-label={`放大查看${item.name || '产品'}图片`} onClick={() => openViewer(item, 0)}>
              <img src={thumbUrl(firstImage.url, 480)} alt={firstImage.name} loading="lazy" decoding="async" />
              <span className="order-detail-card-media-zoom" aria-hidden="true"><ZoomIn size={13} />{images.length > 1 ? `${images.length} 图` : '查看'}</span>
            </button>
          ) : (
            <span className="order-detail-card-media is-empty" aria-hidden="true"><Package size={22} /></span>
          )}
          <div className="order-detail-card-info">
            <div className="order-detail-card-title">
              <strong>{item.name || '未填产品'}</strong>
              <span className="order-detail-card-quantity">× {item.quantity}</span>
            </div>
            <dl className="order-detail-card-facts">
              <div><dt>规格</dt><dd>{item.specification || '—'}</dd></div>
              <div><dt>SKU</dt><dd>{item.sku || '—'}</dd></div>
              <div><dt>装箱</dt><dd>{item.packSize || '—'} 件/箱 · {item.boxes} 箱</dd></div>
              {(item.shippedQuantity ?? 0) > 0 && <div><dt>发货</dt><dd>已发 {item.shippedQuantity}/{item.quantity} · {item.quantity - (item.shippedQuantity ?? 0) > 0 ? `剩 ${item.quantity - (item.shippedQuantity ?? 0)}` : '已发完'}</dd></div>}
            </dl>
            <div className="order-detail-card-money">
              <span>单价 <b>{money(unitPriceCents)}</b></span>
              <span>金额 <b>{money(amountCents)}</b></span>
              {freightCents > 0 && <span>运费 <b>{money(freightCents)}</b>（{money(freightPerBoxCents)}/箱）</span>}
            </div>
            {item.remark?.trim() && <p className="order-detail-card-remark">{item.remark}</p>}
            {showPackaging && item.packaging && item.packaging.length > 0 && <p className="order-detail-card-packaging">包装快照：{item.packaging.map((pack) => `${pack.name || '未命名包装'} · ${packagingSize(pack)} · ${pack.outerWeight || '未填写'} · ${pack.packSize} 件/箱`).join('；')}</p>}
          </div>
        </article>;
      }) : <div className="table-state order-detail-cards-empty">暂无产品明细</div>}
    </div>
    <Modal
      open={Boolean(viewerItem && viewerImage)}
      title={viewerItem ? `${viewerItem.name || '产品'} · 产品图片` : '产品图片'}
      onClose={() => setViewerItemId(undefined)}
      width={960}
      layer={30}
      className="order-item-image-modal"
    >
      {viewerImage && <div className="order-item-image-viewer">
        <div className="order-item-image-stage">
          <img src={thumbUrl(viewerImage.url, 960)} alt={viewerImage.name} decoding="async" />
        </div>
        <div className="order-item-image-bar">
          <span className="order-item-image-counter">{Math.min(viewerIndex, viewerImages.length - 1) + 1} / {viewerImages.length}</span>
          <span className="order-item-image-name" title={viewerImage.name}>{viewerImage.name}</span>
          <button type="button" className="button button-secondary button-sm" disabled={viewerIndex <= 0} onClick={() => stepViewer(-1)}><ChevronLeft size={15} />上一张</button>
          <button type="button" className="button button-secondary button-sm" disabled={viewerIndex >= viewerImages.length - 1} onClick={() => stepViewer(1)}>下一张<ChevronRight size={15} /></button>
        </div>
      </div>}
    </Modal>
  </>;
}
