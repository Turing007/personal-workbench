import type { CustomerStatement } from '../services/reconciliation-service.js';
import { escapeHtml } from './quotation-template.js';

export interface ReconciliationTemplateOptions {
  companyName?: string;
  logoDataUrl?: string;
  generatedAt?: string;
}

function money(cents: number): string {
  return `¥${(Number(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateText(value: string): string {
  return value ? value.slice(0, 10) : '—';
}

function overdueText(days: number): string {
  return days < 0 ? `逾期 ${-days} 天` : '未到期';
}

export function renderReconciliationHtml(statement: CustomerStatement, options: ReconciliationTemplateOptions = {}): string {
  const companyName = String(options.companyName ?? '').trim();
  const orderRows = statement.orders.map((order) => `<tr>
    <td>${escapeHtml(order.orderNo)}</td>
    <td>${dateText(order.lastShippedAt)}</td>
    <td class="number">${money(order.receivableCents)}</td>
    <td class="number">${money(order.receivedCents)}</td>
    <td class="number">${money(order.outstandingCents)}</td>
    <td>${escapeHtml(order.dueDate || '—')}</td>
    <td class="${order.overdueDays < 0 ? 'overdue' : ''}">${overdueText(order.overdueDays)}</td>
  </tr>`).join('');
  const receiptRows = statement.receipts.map((receipt) => `<tr>
    <td>${dateText(receipt.receivedAt)}</td>
    <td>${escapeHtml(receipt.orderNo)}</td>
    <td>${escapeHtml(receipt.paymentMethod || '—')}</td>
    <td>${escapeHtml(receipt.note || '')}</td>
    <td class="number">${money(receipt.amountCents)}</td>
  </tr>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>对账单 ${escapeHtml(statement.customerName)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #15181c; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; font-size: 10.5pt; }
    header { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; padding-bottom: 4mm; border-bottom: 2px solid #1f2933; }
    .letterhead { display: flex; align-items: center; gap: 5mm; min-width: 0; }
    .logo { display: block; max-width: 30mm; max-height: 18mm; object-fit: contain; }
    h1 { margin: 0; font-size: 18pt; }
    h2 { margin: 1.5mm 0 0; font-size: 15pt; font-weight: 500; }
    .document-no { color: #45505b; font-size: 10pt; white-space: nowrap; text-align: right; }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2mm 7mm; padding: 4mm 0; }
    .detail { display: grid; grid-template-columns: auto 1fr; gap: 2mm; min-width: 0; }
    .detail span { color: #58616c; white-space: nowrap; }
    .detail strong { min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
    .section-title { margin: 5mm 0 2mm; font-size: 11pt; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #68717b; padding: 2mm 1.6mm; vertical-align: middle; overflow-wrap: anywhere; }
    th { background: #eef1f3; font-size: 9.5pt; white-space: nowrap; }
    .number { text-align: right; white-space: nowrap; }
    .overdue { color: #b42318; }
    .empty { color: #7b848d; text-align: center; }
    footer { display: flex; justify-content: space-between; margin-top: 10mm; color: #45505b; }
    .generated { margin-top: 3mm; color: #7b848d; font-size: 8.5pt; text-align: right; }
  </style>
</head>
<body>
  <header>
    <div class="letterhead">
      ${options.logoDataUrl ? `<img class="logo" src="${escapeHtml(options.logoDataUrl)}" alt="公司标志">` : ''}
      <div>
        <h1>${escapeHtml(companyName || '对账单')}</h1>
        <h2>客户对账单</h2>
      </div>
    </div>
    <div class="document-no">
      <div>客户：${escapeHtml(statement.customerName || '—')}</div>
      <div>账期：${escapeHtml(statement.from)} 至 ${escapeHtml(statement.to)}</div>
    </div>
  </header>
  <div class="meta">
    <div class="detail"><span>账期额度</span><strong>${statement.creditLimitCents > 0 ? money(statement.creditLimitCents) : '不限额'}</strong></div>
    <div class="detail"><span>期初未收</span><strong>${money(statement.openingCents)}</strong></div>
    <div class="detail"><span>本期发货应收</span><strong>${money(statement.periodReceivableCents)}</strong></div>
    <div class="detail"><span>本期收款</span><strong>${money(statement.periodReceiptCents)}</strong></div>
    <div class="detail"><span>期末未收</span><strong>${money(statement.closingCents)}</strong></div>
    <div class="detail"><span>当前逾期</span><strong class="${statement.overdueCents > 0 ? 'overdue' : ''}">${money(statement.overdueCents)}</strong></div>
  </div>
  <div class="section-title">本期发货订单</div>
  <table>
    <thead><tr><th>订单号</th><th>发货日期</th><th class="number">应收</th><th class="number">已收</th><th class="number">未收</th><th>到期日</th><th>状态</th></tr></thead>
    <tbody>${orderRows || '<tr><td colspan="7" class="empty">本期没有发货订单</td></tr>'}</tbody>
  </table>
  <div class="section-title">本期收款</div>
  <table>
    <thead><tr><th>收款日期</th><th>订单号</th><th>方式</th><th>备注</th><th class="number">金额</th></tr></thead>
    <tbody>${receiptRows || '<tr><td colspan="5" class="empty">本期没有收款</td></tr>'}</tbody>
  </table>
  <footer>
    <div>客户确认：____________________</div>
    <div>制单人：____________________</div>
    <div>日期：____________________</div>
  </footer>
  <div class="generated">打印时间：${escapeHtml((options.generatedAt ?? new Date().toISOString()).replace('T', ' ').slice(0, 16))}</div>
</body>
</html>`;
}
