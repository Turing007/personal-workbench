import { useEffect, useState } from 'react';
import type { QuotationDetail, QuotationPriceTier } from '../../../shared/documents';
import { QUOTATION_PRICING_BASIS_LABELS } from '../../../shared/quotation-config';
import * as api from '../../api';
import Modal from '../Modal';
import { formatMoney } from './quotation-lines';

export interface QuotationProductDetailModalProps {
  open: boolean;
  quotationId: number | null;
  onClose: () => void;
}

const fieldStyle = {
  color: 'var(--color-text-secondary)',
  fontSize: 12,
};

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString('zh-CN', { maximumFractionDigits: 4 });
}

function renderTiers(tiers: QuotationPriceTier[] | undefined): string {
  const sorted = [...(tiers ?? [])].sort((a, b) => a.minQuantity - b.minQuantity);
  if (!sorted.length) return '-';
  return sorted.map((tier) => {
    const range = tier.maxQuantity == null
      ? `${formatQuantity(tier.minQuantity)}+`
      : `${formatQuantity(tier.minQuantity)}~${formatQuantity(tier.maxQuantity)}`;
    return `${range} ${formatMoney(tier.unitPriceCents)}`;
  }).join('\n');
}

/** 报价单列表的“产品详情”弹窗：只读展示一份报价单里的全部产品信息。 */
export default function QuotationProductDetailModal({ open, quotationId, onClose }: QuotationProductDetailModalProps) {
  const [detail, setDetail] = useState<QuotationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || quotationId == null) return undefined;
    let active = true;
    setDetail(null);
    setError('');
    setLoading(true);
    api.getQuotation(quotationId).then((loaded) => {
      if (active) setDetail(loaded);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '读取报价单产品信息失败');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [open, quotationId]);

  return <Modal
    open={open}
    title={detail ? `产品详情 · ${detail.number}` : '产品详情'}
    width={1080}
    onClose={onClose}
    footer={<button type="button" className="button button-primary" onClick={onClose}>关闭</button>}
  >
    <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
      {error && <div role="alert" style={{ color: 'var(--color-danger)', background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-ui)', padding: '8px 10px' }}>{error}</div>}
      {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>正在加载产品信息...</div>}
      {detail && <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, ...fieldStyle }}>
          <span>客户：<strong style={{ color: 'var(--color-text)' }}>{detail.customerName || '-'}</strong></span>
          <span>报价日期：{detail.quotationDate}</span>
          <span>价格口径：{QUOTATION_PRICING_BASIS_LABELS[detail.pricingBasis]}</span>
          <span>产品数：{detail.items.length}</span>
        </div>
        {detail.items.length ? <div className="sticky-thead" style={{ overflow: 'auto', maxHeight: 'min(56vh, 480px)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)' }}>
          <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: 'var(--color-surface-subtle)', color: 'var(--color-text-secondary)', textAlign: 'left' }}>
              <th style={{ padding: 7, width: 30 }}>#</th><th style={{ padding: 7, width: 64 }}>图片</th><th style={{ padding: 7, minWidth: 200 }}>品名</th><th style={{ padding: 7, width: 120 }}>规格</th><th style={{ padding: 7, width: 100 }}>单价</th><th style={{ padding: 7, width: 170 }}>数量区间价</th><th style={{ padding: 7, minWidth: 120 }}>备注</th>
            </tr></thead>
            <tbody>{detail.items.map((item, index) => <tr key={item.id} style={{ borderTop: '1px solid var(--color-border)', verticalAlign: 'top' }}>
              <td style={{ padding: 7, color: 'var(--color-text-muted)' }}>{index + 1}</td>
              <td style={{ padding: 7 }}><span style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface)', overflow: 'hidden' }}>{item.imageRelativePath
                ? <img src={`/files/${item.imageRelativePath}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ color: 'var(--color-text-muted)' }}>-</span>}</span></td>
              <td style={{ padding: 7, fontWeight: 550 }}>{item.name || '-'}{item.configuration?.label && <div style={{ marginTop: 3, color: 'var(--color-accent)', fontSize: 11, fontWeight: 400 }}>{item.configuration.label}</div>}</td>
              <td style={{ padding: 7, color: 'var(--color-text-secondary)' }}>{item.specification || '-'}</td>
              <td style={{ padding: 7, fontWeight: 650, whiteSpace: 'nowrap' }}>{formatMoney(item.unitPriceCents)}</td>
              <td style={{ padding: 7, whiteSpace: 'pre-line', color: 'var(--color-text-secondary)' }}>{renderTiers(item.priceTiers)}</td>
              <td style={{ padding: 7, color: 'var(--color-text-secondary)' }}>{item.remark || '-'}</td>
            </tr>)}</tbody>
          </table>
        </div> : <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>这份报价单还没有产品。</div>}
      </>}
    </div>
  </Modal>;
}
