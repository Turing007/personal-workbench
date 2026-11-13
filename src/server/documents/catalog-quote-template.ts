import { escapeHtml } from './quotation-template.js';
import type { PublicCatalogQuote } from '../services/catalog-service.js';

function formatCents(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateInChina(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export interface CatalogQuoteRenderOptions {
  /** 公司 Logo 的 data URL；没有就不排 Logo 位。 */
  logoDataUrl?: string;
  /** 产品主图的 JPEG data URL，按产品 ID 索引；缺图时那一格显示「—」。 */
  imageDataUrls?: Map<number, string>;
  now?: Date;
}

/** 免登录图册选品报价：只有公司、选品、数量、起价与合计，不含任何成本字段。 */
export function renderCatalogQuoteHtml(quote: PublicCatalogQuote, options: CatalogQuoteRenderOptions = {}): string {
  const company = quote.company;
  const companyName = company.name.trim() || quote.catalogName;
  const date = dateInChina(options.now ?? new Date());
  const rows = quote.lines.map((line, index) => {
    const meta = [line.sku, line.spec].filter(Boolean).join(' · ');
    const image = options.imageDataUrls?.get(line.productId);
    return `<tr>
      <td class="num">${index + 1}</td>
      <td><div class="item-name">${escapeHtml(line.name)}</div>${meta ? `<div class="item-meta">${escapeHtml(meta)}</div>` : ''}</td>
      <td class="item-image">${image ? `<img src="${image}" alt="">` : '<span class="no-image">—</span>'}</td>
      <td class="num">${line.quantity}</td>
      <td class="num">${line.unitPriceCents == null ? '<span class="inquiry">询价</span>' : `${formatCents(line.unitPriceCents)} 起`}</td>
      <td class="num">${line.amountCents == null ? '—' : formatCents(line.amountCents)}</td>
      <td class="item-note">${line.note ? escapeHtml(line.note) : '—'}</td>
    </tr>`;
  }).join('');
  const totalLabel = quote.inquiryCount
    ? `已计价合计（含 ${quote.inquiryCount} 项询价，未计入）`
    : '合计';
  const contact = [company.phone.trim(), company.address.trim()].filter(Boolean).join(' · ');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(quote.catalogName)} · 选品报价</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; color: #1f2937; font-family: "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 12px; }
  .head { display: flex; justify-content: space-between; gap: 20px; padding-bottom: 12px; border-bottom: 2px solid #0f766e; }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .logo { width: 56px; height: 56px; flex: none; display: grid; place-items: center; }
  .logo img { width: 100%; height: 100%; object-fit: contain; }
  h1 { margin: 0; color: #111827; font-size: 19px; line-height: 1.35; }
  .company { margin-top: 3px; color: #6b7280; font-size: 11px; }
  .title { flex: none; text-align: right; }
  .title h2 { margin: 0 0 4px; color: #0f766e; font-size: 20px; }
  .meta { color: #6b7280; font-size: 10.5px; line-height: 1.7; }
  table { width: 100%; margin-top: 16px; border-collapse: collapse; }
  thead th { padding: 8px; border-bottom: 1px solid #99f6e4; background: #f0fdfa; color: #0f766e; font-size: 10.5px; font-weight: 600; text-align: left; }
  tbody td { padding: 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr { break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  thead th.num { text-align: right; }
  .item-name { color: #111827; font-size: 12px; font-weight: 600; line-height: 1.4; }
  .item-meta { margin-top: 2px; color: #6b7280; font-size: 10px; line-height: 1.45; }
  .item-image { text-align: center; vertical-align: middle; }
  .item-image img { width: 52px; height: 52px; object-fit: contain; border: 1px solid #e5e7eb; border-radius: 4px; background: #fff; }
  .no-image { color: #b3b9bf; font-size: 10px; }
  .item-note { color: #4b5563; font-size: 10px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .inquiry { color: #b45309; }
  .total-row td { padding-top: 10px; border-top: 2px solid #0f766e; border-bottom: 0; font-size: 13px; font-weight: 700; }
  .notes { margin-top: 10px; padding: 9px 11px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; color: #4b5563; font-size: 10px; line-height: 1.7; }
  .foot { display: flex; justify-content: space-between; gap: 16px; margin-top: 18px; padding-top: 9px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 10px; }
</style></head>
<body>
  <header class="head">
    <div class="brand">
      ${options.logoDataUrl ? `<div class="logo"><img src="${options.logoDataUrl}" alt=""></div>` : ''}
      <div>
        <h1>${escapeHtml(companyName)}</h1>
        <div class="company">${escapeHtml(quote.catalogName)} · 选品报价</div>
      </div>
    </div>
    <div class="title">
      <h2>选品报价单</h2>
      <div class="meta">日期：${date}<br>共 ${quote.lines.length} 项 · ${quote.lines.reduce((sum, line) => sum + line.quantity, 0)} 件</div>
    </div>
  </header>
  <table>
    <thead><tr><th class="num" style="width:4%">#</th><th style="width:37%">产品</th><th style="width:10%;text-align:center">图片</th><th class="num" style="width:7%">数量</th><th class="num" style="width:14%">单价</th><th class="num" style="width:14%">金额</th><th style="width:14%">备注</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="total-row"><td colspan="5">${escapeHtml(totalLabel)}</td><td class="num">${formatCents(quote.totalCents)}</td><td></td></tr></tfoot>
  </table>
  <div class="notes">
    1. 单价为图册最低配置起价（裸机或电池套装中的最低售价），实际价格按最终确认的电池配置、包装与运费计算。<br>
    2. 报价不含税费与运费；含询价产品的行未计入合计，请与我们确认后再报价。<br>
    3. 本清单由图册自助生成，最终以双方确认的订单为准。
  </div>
  <footer class="foot">
    <span>${contact ? escapeHtml(contact) : '联系方式请咨询图册发送人'}</span>
    <span>${escapeHtml(companyName)} · ${date}</span>
  </footer>
</body></html>`;
}

export function renderCatalogQuoteErrorPage(message: string, token?: string): string {
  const back = token ? `<a href="/c/${escapeHtml(token)}">返回图册</a>` : '';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>无法生成报价单</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f7;color:#4b5563;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}div{max-width:360px;display:grid;gap:10px;text-align:center}h1{margin:0;font-size:18px;color:#111827}p{margin:0;font-size:13px;line-height:1.6}a{justify-self:center;padding:8px 18px;border-radius:999px;background:#0f766e;color:#fff;text-decoration:none;font-size:13px}</style></head><body><div><h1>无法生成报价单</h1><p>${escapeHtml(message)}</p>${back}</div></body></html>`;
}
