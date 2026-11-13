import { ExternalLink, Package, Pencil, Printer, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FINANCE_PAYMENT_STATUS_LABELS, INVOICE_STATUS_LABELS, PAYMENT_PROOF_STATUS_LABELS } from '../../../shared/finance';
import { getOrderItemImages } from '../../api';
import { thumbUrl } from '../../image-urls';
import { money } from '../finance/finance-format';
import type { OrderDraft } from '../OrderForm';

export interface OrderExpandPanelProps {
  order: OrderDraft;
  onOpenDetail: () => void;
  onEdit: () => void;
  onOpenFinance?: () => void;
  onOpenLabels?: () => void;
  onPublish?: () => void;
}

/** 订单行内展开：产品、收件信息、财务摘要和常用操作；桌面表格与手机卡片共用。 */
export default function OrderExpandPanel({ order, onOpenDetail, onEdit, onOpenFinance, onOpenLabels, onPublish }: OrderExpandPanelProps) {
  const summary = order.financeSummary;
  const isDraft = order.status === 'draft';
  const [itemImages, setItemImages] = useState<Record<number, Array<{ url: string; name: string; mimeType: string }>>>({});
  useEffect(() => {
    if (!order.id) return undefined;
    let cancelled = false;
    void getOrderItemImages(order.id).then((result) => {
      if (!cancelled) setItemImages(result.itemImages);
    }).catch(() => { /* 图片加载失败不阻断明细 */ });
    return () => { cancelled = true; };
  }, [order.id]);
  return <div className="order-expand-panel">
    <section className="order-expand-products">
      <div className="order-expand-section-head"><strong>产品明细</strong><span>{order.items.length} 项 · {order.items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0)} 件</span></div>
      <div className="order-expand-product-list">
        {order.items.length ? order.items.map((item) => {
          const unitPriceCents = item.unitPriceCents ?? 0;
          const amountCents = item.amountCents ?? unitPriceCents * item.quantity;
          const image = itemImages[Number(item.id)]?.[0];
          return <div className="order-expand-product-row" key={item.id}>
            <div className="order-expand-product-thumb">
              {image
                ? <a href={image.url} target="_blank" rel="noreferrer" title="查看产品图"><img src={thumbUrl(image.url, 240)} alt={image.name || item.name} loading="lazy" decoding="async" /></a>
                : <span title="暂无产品图"><Package size={16} /></span>}
            </div>
            <div className="order-expand-product-name">
              <strong>{item.name || '未填产品'}</strong>
              <span>{[item.sku, item.specification].filter(Boolean).join(' · ') || '未填规格'}</span>
              {item.remark && <small>{item.remark}</small>}
            </div>
            <span className="order-expand-qty">{item.quantity} 件 × {money(unitPriceCents)}</span>
            <strong className="order-expand-amount">{money(amountCents)}</strong>
          </div>;
        }) : <div className="order-expand-empty">暂无产品明细</div>}
      </div>
    </section>

    <div className="order-expand-side">
      <section className="order-expand-info">
        <div className="order-expand-section-head"><strong>收件信息</strong></div>
        <div className="order-expand-info-grid">
          <div><span>收件人</span><strong>{order.recipientName || '未填写'}</strong></div>
          <div><span>收件地址</span><strong>{order.recipientInfo || '未填写'}</strong></div>
          <div><span>结算方式</span><strong>{order.settlementType === 'personal' ? '对私（无需开票）' : '对公（需开票）'} · {order.companyName || '未分配公司'}</strong></div>
          <div><span>物流单号</span><strong>{order.trackingNo || '未填写'}</strong></div>
        </div>
      </section>

      <section className="order-expand-finance">
        <div className="order-expand-section-head"><strong>财务摘要</strong>{summary && <span className={summary.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{summary.outstandingCents > 0 ? `未收 ${money(summary.outstandingCents)}` : '已收清'}</span>}</div>
        {summary ? <div className="order-expand-finance-body">
          <div className="order-expand-metrics">
            <div><span>应收</span><strong>{money(summary.receivableCents)}</strong></div>
            <div><span>已收</span><strong className="finance-positive">{money(summary.receivedCents)}</strong></div>
            <div><span>未收</span><strong className={summary.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(summary.outstandingCents)}</strong></div>
          </div>
          <div className="order-expand-badges">
            <span className="badge badge-neutral">{FINANCE_PAYMENT_STATUS_LABELS[summary.paymentStatus]}</span>
            <span className="badge badge-neutral">水单 {PAYMENT_PROOF_STATUS_LABELS[summary.proofStatus]}</span>
            <span className="badge badge-neutral">发票 {INVOICE_STATUS_LABELS[summary.invoiceStatus]}</span>
          </div>
        </div> : <div className="order-expand-empty">该订单暂无财务数据</div>}
      </section>
    </div>

    <div className="order-expand-actions">
      <button type="button" className="button button-secondary button-sm" onClick={onOpenDetail}><ScrollText size={14} />查看详情</button>
      <button type="button" className="button button-secondary button-sm" onClick={onEdit}><Pencil size={14} />编辑订单</button>
      {onOpenFinance && <button type="button" className="button button-secondary button-sm" onClick={onOpenFinance}><ExternalLink size={14} />财务详情</button>}
      {isDraft
        ? (onPublish && <button type="button" className="button button-primary button-sm" onClick={onPublish}><ScrollText size={14} />发布草稿</button>)
        : (onOpenLabels && <button type="button" className="button button-secondary button-sm" onClick={onOpenLabels}><Printer size={14} />打印箱唛</button>)}
    </div>
  </div>;
}
