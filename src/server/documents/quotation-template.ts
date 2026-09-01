import type { QuotationServiceDetail } from '../services/quotation-service.js';
import { QUOTATION_PRICE_TYPE_LABELS } from '../../shared/documents.js';

export interface QuotationTemplateOptions {
  readFile?: (relativePath: string) => Promise<Buffer>;
}

type QuotationItem = QuotationServiceDetail['items'][number];

interface ColumnDefinition {
  key: keyof QuotationServiceDetail['displayConfig']['columns'];
  label: string;
  className?: string;
  render: (item: QuotationItem, imageDataUrl: string | undefined) => string;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatMoney(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTaxRate(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
}

function mimeTypeForPath(relativePath: string): string {
  const path = relativePath.toLowerCase();
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

async function readDataUrl(
  relativePath: string | null | undefined,
  readFile: QuotationTemplateOptions['readFile'],
): Promise<string | undefined> {
  if (!relativePath || !readFile) return undefined;
  const content = await readFile(relativePath);
  return `data:${mimeTypeForPath(relativePath)};base64,${content.toString('base64')}`;
}

function companyTitleFontSize(name: string): string {
  // 页头中间列约 112mm，21pt 全角字符约 7.4mm 宽，最多容纳 15 个全角字符；超出时按比例缩小
  const units = [...name].reduce((sum, char) => sum + (/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char) ? 1 : 0.55), 0);
  if (units <= 15) return '21pt';
  return `${Math.max(13, Math.round((15 / units) * 210) / 10)}pt`;
}

function detailRow(label: string, value: string, className = ''): string {
  if (!value) return '';
  return `<div class="detail ${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderCustomFields(
  quotation: QuotationServiceDetail,
  placement: 'header' | 'footer',
): string {
  return quotation.customFields
    .filter((field) => field.placement === placement && (field.label || field.value))
    .map((field) => detailRow(field.label, field.value))
    .join('');
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString('zh-CN', { maximumFractionDigits: 4 });
}

function renderPriceTiers(item: QuotationItem): string {
  const tiers = [...(item.priceTiers ?? [])].sort((a, b) => a.minQuantity - b.minQuantity);
  if (!tiers.length) return '<span class="image-placeholder">-</span>';
  return tiers.map((tier) => {
    const range = tier.maxQuantity == null
      ? `${formatQuantity(tier.minQuantity)}+`
      : `${formatQuantity(tier.minQuantity)}~${formatQuantity(tier.maxQuantity)}`;
    return `<div class="tier-row"><span>${escapeHtml(range)}</span><strong>${escapeHtml(formatMoney(tier.unitPriceCents))}</strong></div>`;
  }).join('');
}

const columns: readonly ColumnDefinition[] = [
  {
    key: 'image',
    label: '图片',
    className: 'image-column',
    render: (item, imageDataUrl) => imageDataUrl
      ? `<img class="product-image" src="${escapeHtml(imageDataUrl)}" alt="${escapeHtml(item.name)}">`
      : '<span class="image-placeholder">-</span>',
  },
  { key: 'name', label: '品名', render: (item) => escapeHtml(item.name) },
  { key: 'specification', label: '规格', render: (item) => escapeHtml(item.specification) },
  { key: 'unitPrice', label: '单价', className: 'money', render: (item) => escapeHtml(formatMoney(item.unitPriceCents)) },
  { key: 'tierPrice', label: '数量区间价', className: 'tier-price', render: (item) => renderPriceTiers(item) },
  { key: 'remark', label: '备注', render: (item) => escapeHtml(item.remark) },
];

export async function renderQuotationHtml(
  quotation: QuotationServiceDetail,
  options: QuotationTemplateOptions = {},
): Promise<string> {
  const enabledColumns = columns.filter((column) => quotation.displayConfig.columns[column.key]);
  const imageDataUrls = new Map<number, string>();

  if (quotation.displayConfig.columns.image && options.readFile) {
    await Promise.all(quotation.items.map(async (item) => {
      const dataUrl = await readDataUrl(item.imageRelativePath, options.readFile);
      if (dataUrl) imageDataUrls.set(item.id, dataUrl);
    }));
  }

  const logoDataUrl = quotation.displayConfig.showLogo
    ? await readDataUrl(quotation.companySnapshot.logoRelativePath, options.readFile)
    : undefined;
  const companyDetails = [
    quotation.displayConfig.showCompanyPhone
      ? detailRow('电话', quotation.companySnapshot.phone, 'company-detail')
      : '',
    quotation.displayConfig.showCompanyAddress
      ? detailRow('地址', quotation.companySnapshot.address, 'company-detail')
      : '',
  ].join('');
  const contactPhone = quotation.displayConfig.showContactPhone
    ? detailRow('联系电话', quotation.contactPhone)
    : '';
  const headerFields = renderCustomFields(quotation, 'header');
  const footerFields = renderCustomFields(quotation, 'footer');
  const tableHeader = enabledColumns
    .map((column) => `<th class="${column.className ?? ''}">${escapeHtml(column.label)}</th>`)
    .join('');
  const tableRows = quotation.items.map((item) => {
    const cells = enabledColumns.map((column) => (
      `<td class="${column.className ?? ''}">${column.render(item, imageDataUrls.get(item.id))}</td>`
    )).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  const taxRows = quotation.displayConfig.showTax
    ? `<div><span>税率（${escapeHtml(formatTaxRate(quotation.taxRateBps))}）</span><strong>${escapeHtml(formatMoney(quotation.taxCents))}</strong></div>`
    : '';
  const totalRow = quotation.displayConfig.showTaxIncludedTotal
    ? `<div class="grand-total"><span>价税合计</span><strong>${escapeHtml(formatMoney(quotation.totalCents))}</strong></div>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(quotation.number)} 报价单</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #15181c; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; font-size: 10.5pt; }
    header { display: grid; grid-template-columns: 28mm 1fr 50mm; align-items: center; min-height: 25mm; border-bottom: 2px solid #1f2933; padding-bottom: 4mm; }
    .logo { width: 24mm; max-height: 20mm; object-fit: contain; justify-self: start; }
    .company { text-align: center; }
    .company h1 { margin: 0; font-size: ${companyTitleFontSize(quotation.companySnapshot.name)}; font-weight: 700; white-space: nowrap; }
    .company h2 { margin: 2mm 0 0; font-size: 16pt; }
    .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.8mm 7mm; padding: 4mm 0; }
    .detail { display: grid; grid-template-columns: auto 1fr; gap: 2mm; min-width: 0; }
    .detail span { color: #58616c; white-space: nowrap; }
    .detail strong { min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
    .company-detail { font-size: 8.5pt; }
    table { width: 100%; border-collapse: collapse; table-layout: auto; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #68717b; padding: 2.1mm 1.7mm; vertical-align: middle; overflow-wrap: anywhere; }
    th { background: #eef1f3; font-size: 9.5pt; white-space: nowrap; }
    td.number, td.money, th.number, th.money { text-align: right; white-space: nowrap; }
    .tier-price .tier-row { display: flex; justify-content: space-between; gap: 3mm; white-space: nowrap; }
    .tier-price .tier-row + .tier-row { margin-top: 0.8mm; }
    .tier-price .tier-row span { color: #58616c; }
    .tier-price .tier-row strong { font-weight: 600; }
    .image-column { width: 22mm; text-align: center; }
    .product-image { display: block; width: 18mm; height: 18mm; margin: auto; object-fit: contain; }
    .image-placeholder { color: #9aa1a8; }
    .summary { width: 76mm; margin: 4mm 0 0 auto; }
    .summary div { display: flex; justify-content: space-between; gap: 8mm; padding: 1.5mm 0; }
    .summary .grand-total { border-top: 1px solid #303841; margin-top: 1mm; padding-top: 2mm; font-size: 12pt; }
    .footer { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 7mm; margin-top: 5mm; padding-top: 3mm; border-top: 1px solid #a4aab0; }
    .remark { grid-column: 1 / -1; white-space: pre-wrap; }
  </style>
</head>
<body>
  <header>
    <div>${logoDataUrl ? `<img class="logo" src="${escapeHtml(logoDataUrl)}" alt="公司标志">` : ''}</div>
    <div class="company">
      <h1>${escapeHtml(quotation.companySnapshot.name)}</h1>
      <h2>报价单</h2>
    </div>
    <div class="company-meta">${companyDetails}</div>
  </header>
  <section class="meta-grid">
    ${detailRow('报价单号', quotation.number)}
    ${detailRow('报价日期', quotation.quotationDate)}
    ${detailRow('价格类型', QUOTATION_PRICE_TYPE_LABELS[quotation.priceType] ?? '')}
    ${detailRow('客户名称', quotation.customerName)}
    ${detailRow('联系人', quotation.contactName)}
    ${contactPhone}
    ${detailRow('有效期至', quotation.validUntil)}
    ${detailRow('客户地址', quotation.customerAddress)}
    ${headerFields}
  </section>
  <table>
    <thead><tr>${tableHeader}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <section class="summary">
    <div><span>产品小计</span><strong>${escapeHtml(formatMoney(quotation.subtotalCents))}</strong></div>
    ${taxRows}
    ${totalRow}
  </section>
  <footer class="footer">
    ${footerFields}
    ${quotation.remark ? `<div class="detail remark"><span>备注</span><strong>${escapeHtml(quotation.remark)}</strong></div>` : ''}
    ${detailRow('制单人', quotation.companySnapshot.defaultIssuer)}
  </footer>
</body>
</html>`;
}

export const createQuotationHtml = renderQuotationHtml;
