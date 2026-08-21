import type { SalesDocumentServiceDetail } from '../services/sales-document-service.js';
import { escapeHtml } from './quotation-template.js';

export interface SalesDocumentTemplateOptions {
  readFile?: (relativePath: string) => Promise<Buffer>;
}

type SalesItem = SalesDocumentServiceDetail['items'][number];

interface ColumnDefinition {
  key: keyof SalesDocumentServiceDetail['displayConfig']['columns'];
  label: string;
  className?: string;
  render: (item: SalesItem) => string;
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
  readFile: SalesDocumentTemplateOptions['readFile'],
): Promise<string | undefined> {
  if (!relativePath || !readFile) return undefined;
  const content = await readFile(relativePath);
  return `data:${mimeTypeForPath(relativePath)};base64,${content.toString('base64')}`;
}

function detailRow(label: string, value: string): string {
  if (!value) return '';
  return `<div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

const columns: readonly ColumnDefinition[] = [
  { key: 'productCode', label: '产品编号', render: (item) => escapeHtml(item.productCode) },
  { key: 'productName', label: '品名', render: (item) => escapeHtml(item.name) },
  { key: 'specification', label: '规格', render: (item) => escapeHtml(item.specification) },
  { key: 'quantity', label: '数量', className: 'number', render: (item) => escapeHtml(item.quantity) },
  { key: 'unitPrice', label: '单价', className: 'money', render: (item) => escapeHtml(formatMoney(item.unitPriceCents)) },
  { key: 'amount', label: '金额', className: 'money', render: (item) => escapeHtml(formatMoney(item.amountCents)) },
  { key: 'remark', label: '备注', render: (item) => escapeHtml(item.remark) },
];

export async function renderSalesDocumentHtml(
  document: SalesDocumentServiceDetail,
  options: SalesDocumentTemplateOptions = {},
): Promise<string> {
  const enabledColumns = columns.filter((column) => document.displayConfig.columns[column.key]);
  const imageDataUrls = new Map<number, string>();
  if (document.displayConfig.showProductImages && options.readFile) {
    await Promise.all(document.items.map(async (item) => {
      const dataUrl = await readDataUrl(item.imageRelativePath, options.readFile);
      if (dataUrl) imageDataUrls.set(item.id, dataUrl);
    }));
  }

  const logoDataUrl = document.displayConfig.showLogo
    ? await readDataUrl(document.companySnapshot.logoRelativePath, options.readFile)
    : undefined;
  const tableHeader = [
    document.displayConfig.showProductImages ? '<th class="image-column">图片</th>' : '',
    ...enabledColumns.map((column) => `<th class="${column.className ?? ''}">${escapeHtml(column.label)}</th>`),
  ].join('');
  const tableRows = document.items.map((item) => {
    const imageCell = document.displayConfig.showProductImages
      ? `<td class="image-column">${imageDataUrls.get(item.id)
        ? `<img class="product-image" src="${escapeHtml(imageDataUrls.get(item.id))}" alt="${escapeHtml(item.name)}">`
        : '<span class="image-placeholder">-</span>'}</td>`
      : '';
    const cells = enabledColumns
      .map((column) => `<td class="${column.className ?? ''}">${column.render(item)}</td>`)
      .join('');
    return `<tr>${imageCell}${cells}</tr>`;
  }).join('');

  const companyMeta = [
    document.displayConfig.showCompanyPhone ? detailRow('电话', document.companySnapshot.phone) : '',
    document.displayConfig.showCompanyAddress ? detailRow('地址', document.companySnapshot.address) : '',
  ].join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(document.number)} 销售单</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #15181c; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; font-size: 10.5pt; }
    header { display: grid; grid-template-columns: 28mm 1fr 50mm; align-items: center; min-height: 25mm; padding-bottom: 4mm; border-bottom: 2px solid #1f2933; }
    .logo { width: 24mm; max-height: 20mm; object-fit: contain; }
    .company { text-align: center; }
    .company h1 { margin: 0; font-size: 21pt; }
    .company h2 { margin: 2mm 0 0; font-size: 16pt; }
    .company-meta { font-size: 8.5pt; }
    .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.8mm 7mm; padding: 4mm 0; }
    .detail { display: grid; grid-template-columns: auto 1fr; gap: 2mm; min-width: 0; }
    .detail span { color: #58616c; white-space: nowrap; }
    .detail strong { min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; table-layout: auto; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #68717b; padding: 2.1mm 1.7mm; vertical-align: middle; overflow-wrap: anywhere; }
    th { background: #eef1f3; font-size: 9.5pt; white-space: nowrap; }
    td.number, td.money, th.number, th.money { text-align: right; white-space: nowrap; }
    .image-column { width: 22mm; text-align: center; }
    .product-image { display: block; width: 18mm; height: 18mm; margin: auto; object-fit: contain; }
    .image-placeholder { color: #9aa1a8; }
    .summary { width: 88mm; margin: 4mm 0 0 auto; }
    .summary div { display: flex; justify-content: space-between; gap: 8mm; padding: 1.3mm 0; }
    .summary .grand-total { border-top: 1px solid #303841; margin-top: 1mm; padding-top: 2mm; font-size: 12pt; }
    .summary .outstanding { color: #b42318; font-weight: 700; }
    .uppercase { margin-top: 2mm; text-align: right; font-size: 9pt; }
    .footer { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 7mm; margin-top: 5mm; padding-top: 3mm; border-top: 1px solid #a4aab0; }
    .remark { grid-column: 1 / -1; white-space: pre-wrap; }
  </style>
</head>
<body>
  <header>
    <div>${logoDataUrl ? `<img class="logo" src="${escapeHtml(logoDataUrl)}" alt="公司标志">` : ''}</div>
    <div class="company"><h1>${escapeHtml(document.companySnapshot.name)}</h1><h2>销售单</h2></div>
    <div class="company-meta">${companyMeta}</div>
  </header>
  <section class="meta-grid">
    ${detailRow('销售单号', document.number)}
    ${detailRow('开单日期', document.documentDate)}
    ${detailRow('客户名称', document.customerName)}
    ${detailRow('联系人', document.contactName)}
    ${detailRow('联系电话', document.contactPhone)}
    ${detailRow('客户单号', document.purchaseOrderNo)}
    ${detailRow('客户地址', document.customerAddress)}
  </section>
  <table><thead><tr>${tableHeader}</tr></thead><tbody>${tableRows}</tbody></table>
  <section class="summary">
    <div><span>产品小计</span><strong>${escapeHtml(formatMoney(document.subtotalCents))}</strong></div>
    <div><span>运费</span><strong>${escapeHtml(formatMoney(document.shippingCents))}</strong></div>
    <div><span>税率（${escapeHtml(formatTaxRate(document.taxRateBps))}）</span><strong>${escapeHtml(formatMoney(document.taxCents))}</strong></div>
    <div class="grand-total"><span>含税合计</span><strong>${escapeHtml(formatMoney(document.totalCents))}</strong></div>
    <div><span>已收金额</span><strong>${escapeHtml(formatMoney(document.receivedCents))}</strong></div>
    <div class="outstanding"><span>未付款</span><strong>${escapeHtml(formatMoney(document.outstandingCents))}</strong></div>
  </section>
  <div class="uppercase">未付款大写：${escapeHtml(document.outstandingUppercase)}</div>
  <footer class="footer">
    ${detailRow('开单人', document.issuer)}
    ${detailRow('收货人', document.consignee)}
    ${document.remark ? `<div class="detail remark"><span>备注</span><strong>${escapeHtml(document.remark)}</strong></div>` : ''}
  </footer>
</body>
</html>`;
}

export const createSalesDocumentHtml = renderSalesDocumentHtml;
