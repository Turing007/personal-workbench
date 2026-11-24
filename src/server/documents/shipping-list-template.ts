import type { ShipmentRecord } from '../../shared/shipping.js';
import { escapeHtml } from './quotation-template.js';

export interface ShippingListTemplateOptions {
  generatedAt?: string;
  /** 抬头公司名：优先用设置里的公司资料，缺省时退回发货记录上的公司。 */
  companyName?: string;
  /** 设置里公司资料的内联 logo（data URL）；没有时只出公司名。 */
  logoDataUrl?: string;
}

/** 库里存的是 UTC 时间，直接截取会比北京时间少 8 小时。 */
function formatDateTime(value: string): string {
  if (!value) return '';
  return new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function detail(label: string, value: string): string {
  return `<div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`;
}

function renderShipment(shipment: ShipmentRecord, companyName: string, logoDataUrl?: string): string {
  const totalQuantity = shipment.items.reduce((sum, item) => sum + item.quantity, 0);
  const rows = shipment.items.map((item, index) => `<tr>
    <td class="index">${index + 1}</td>
    <td>${escapeHtml(item.name)}</td>
    <td>${escapeHtml(item.sku || '—')}</td>
    <td>${escapeHtml(item.specification || '—')}</td>
    <td class="number">${item.quantity}</td>
    <td class="number">${item.remainingAfter}</td>
    <td class="number">${item.boxes}</td>
    <td>${escapeHtml(item.remark || '')}</td>
  </tr>`).join('');
  return `<section class="sheet">
    <header>
      <div class="letterhead">
        ${logoDataUrl ? `<img class="logo" src="${escapeHtml(logoDataUrl)}" alt="公司标志">` : ''}
        <div>
          <h1>${escapeHtml(companyName || '发货清单')}</h1>
          ${companyName ? '<h2>发货清单</h2>' : ''}
        </div>
      </div>
      <div class="document-no">${escapeHtml(shipment.shipmentNo)}</div>
    </header>
    <div class="meta">
      ${detail('订单号', shipment.orderNo)}
      ${detail('发货日期', formatDateTime(shipment.shippedAt))}
      ${detail('客户', shipment.customerName)}
      ${detail('收件人', shipment.recipientName)}
      ${detail('物流单号', shipment.trackingNo)}
      ${detail('批次号', shipment.batchNo)}
      <div class="detail wide"><span>收件信息</span><strong>${escapeHtml(shipment.recipientInfo || '—')}</strong></div>
    </div>
    <table>
      <thead><tr><th class="index">序号</th><th>品名</th><th>SKU</th><th>规格</th><th class="number">本次数量</th><th class="number">剩余数量</th><th class="number">箱数</th><th>备注</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="empty">无发货明细</td></tr>'}</tbody>
    </table>
    <div class="totals">
      <span>本次合计数量：<strong>${totalQuantity}</strong></span>
      <span>本次合计箱数：<strong>${shipment.totalBoxes}</strong></span>
    </div>
    <footer>
      <div>发货人：____________________</div>
      <div>收货人：____________________</div>
      <div>日期：____________________</div>
    </footer>
  </section>`;
}

export function renderShippingListHtml(shipments: ShipmentRecord[], options: ShippingListTemplateOptions = {}): string {
  const profileName = String(options.companyName ?? '').trim();
  const logoDataUrl = String(options.logoDataUrl ?? '').trim();
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>发货清单</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #15181c; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; font-size: 10.5pt; }
    .sheet + .sheet { break-before: page; }
    header { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; padding-bottom: 4mm; border-bottom: 2px solid #1f2933; }
    .letterhead { display: flex; align-items: center; gap: 5mm; min-width: 0; }
    .logo { display: block; max-width: 30mm; max-height: 18mm; object-fit: contain; }
    h1 { margin: 0; font-size: 18pt; }
    h2 { margin: 1.5mm 0 0; font-size: 15pt; font-weight: 500; }
    .document-no { color: #45505b; font-size: 10pt; white-space: nowrap; }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2mm 7mm; padding: 4mm 0; }
    .detail { display: grid; grid-template-columns: auto 1fr; gap: 2mm; min-width: 0; }
    .detail.wide { grid-column: 1 / -1; }
    .detail span { color: #58616c; white-space: nowrap; }
    .detail strong { min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #68717b; padding: 2.1mm 1.7mm; vertical-align: middle; overflow-wrap: anywhere; }
    th { background: #eef1f3; font-size: 9.5pt; white-space: nowrap; }
    .index { width: 11mm; text-align: center; }
    .number { text-align: right; white-space: nowrap; }
    .empty { color: #7b848d; text-align: center; }
    .totals { display: flex; justify-content: flex-end; gap: 10mm; margin-top: 4mm; padding-top: 2.5mm; border-top: 1px solid #a4aab0; }
    footer { display: flex; justify-content: space-between; gap: 8mm; margin-top: 12mm; color: #45505b; }
    .generated { margin-top: 3mm; color: #7b848d; font-size: 8.5pt; text-align: right; }
  </style>
</head>
<body>
  ${shipments.map((shipment) => renderShipment(shipment, profileName || shipment.companyName.trim(), logoDataUrl)).join('')}
  <div class="generated">打印时间：${escapeHtml(formatDateTime(options.generatedAt ?? new Date().toISOString()))}</div>
</body>
</html>`;
}
