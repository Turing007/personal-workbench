import { CircleDollarSign } from 'lucide-react';
import { centsToChineseUppercase } from '../../../shared/money';

export interface DocumentTotalsProps {
  subtotalCents: number;
  taxRateBps?: number;
  taxCents?: number;
  shippingCents?: number;
  totalCents: number;
  receivedCents?: number;
  outstandingCents?: number;
  showTax?: boolean;
  showOutstanding?: boolean;
  /** 单价已含税时，税额只展示“其中税额”，不再加到合计。 */
  taxIncluded?: boolean;
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2 }).format(Math.max(0, cents) / 100);
}

export default function DocumentTotals({ subtotalCents, taxRateBps = 0, taxCents = 0, shippingCents = 0, totalCents, receivedCents = 0, outstandingCents = Math.max(0, totalCents - receivedCents), showTax = true, showOutstanding = false, taxIncluded = false }: DocumentTotalsProps) {
  const rows: Array<[string, string, boolean?]> = [['小计', formatMoney(subtotalCents)]];
  if (shippingCents > 0) rows.push(['运费', formatMoney(shippingCents)]);
  if (showTax) rows.push([`${taxIncluded ? '其中税额' : '税额'}（${(taxRateBps / 100).toFixed(2)}%）`, formatMoney(taxCents)]);
  rows.push(['含税合计', formatMoney(totalCents), true]);
  if (showOutstanding) {
    rows.push(['已收金额', formatMoney(receivedCents)]);
    rows.push(['未付款', formatMoney(outstandingCents), true]);
  }
  return <div style={{ minWidth: 280, display: 'grid', gap: 7, justifySelf: 'end' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600 }}><CircleDollarSign size={15} />金额合计</div>
    {rows.map(([label, amount, strong]) => <div key={label} style={{ display: 'grid', gridTemplateColumns: '1fr 118px', gap: 18, alignItems: 'center', fontSize: strong ? 13 : 12, color: strong ? 'var(--color-text)' : 'var(--color-text-secondary)', fontWeight: strong ? 700 : 400 }}><span>{label}</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{amount}</span></div>)}
    {showOutstanding && <div style={{ paddingTop: 6, borderTop: '1px solid var(--color-border)', textAlign: 'right', color: 'var(--color-text-secondary)', fontSize: 11 }}>未付款大写：{centsToChineseUppercase(Math.max(0, outstandingCents))}</div>}
  </div>;
}
