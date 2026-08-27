import type { CompanySnapshot } from '../../shared/documents.js';
import type { ContractTemplate } from '../../shared/contract.js';
import { centsToChineseUppercase } from '../../shared/money.js';
import { escapeHtml } from './quotation-template.js';

// 订单与明细行直接使用 getOrderDetail 返回的数据库行（snake_case 列名），避免再定义一层映射。
export type ContractOrderRow = Record<string, unknown>;
export type ContractItemRow = Record<string, unknown>;

export interface ContractRenderInput {
  template: ContractTemplate;
  company: CompanySnapshot;
  order: ContractOrderRow;
  items: ContractItemRow[];
  generatedAt?: string;
}

function formatMoney(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function rowText(row: ContractOrderRow | ContractItemRow, key: string): string {
  return String(row?.[key] ?? '').trim();
}

function rowCents(row: ContractOrderRow | ContractItemRow, key: string): number {
  const value = Number(row?.[key] ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function chineseNumber(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (!Number.isInteger(value) || value <= 0 || value >= 100) return String(value);
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  const tensText = tens === 0 ? '' : tens === 1 ? '十' : `${digits[tens]}十`;
  const onesText = ones === 0 ? '' : digits[ones]!;
  return `${tensText}${onesText}`;
}

const ITEM_COLUMNS: readonly { label: string; className?: string; render: (item: ContractItemRow, index: number) => string }[] = [
  { label: '序号', className: 'index', render: (_item, index) => escapeHtml(index + 1) },
  { label: '品名', render: (item) => escapeHtml(rowText(item, 'name')) },
  { label: '规格', render: (item) => escapeHtml(rowText(item, 'specification')) },
  { label: '装箱数', className: 'number', render: (item) => escapeHtml(rowCents(item, 'pack_count') || '') },
  { label: '数量', className: 'number', render: (item) => escapeHtml(rowCents(item, 'quantity') || '') },
  { label: '单价', className: 'money', render: (item) => escapeHtml(formatMoney(rowCents(item, 'unit_price_cents'))) },
  { label: '金额', className: 'money', render: (item) => escapeHtml(formatMoney(rowCents(item, 'amount_cents'))) },
  { label: '备注', render: (item) => escapeHtml(rowText(item, 'remark')) },
];

function buildProductTable(items: ContractItemRow[]): string {
  const header = ITEM_COLUMNS.map((column) => `<th class="${column.className ?? ''}">${escapeHtml(column.label)}</th>`).join('');
  const rows = items.map((item, index) => {
    const cells = ITEM_COLUMNS.map((column) => `<td class="${column.className ?? ''}">${column.render(item, index)}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table class="items"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function resolveContractPlaceholders(
  input: Pick<ContractRenderInput, 'template' | 'company' | 'order' | 'items' | 'generatedAt'>,
): Map<string, { html: string }> {
  const { company, order, items } = input;
  const subtotalCents = items.reduce((sum, item) => sum + rowCents(item, 'amount_cents'), 0);
  const shippingCents = rowCents(order, 'shipping_cents');
  const totalCents = subtotalCents + shippingCents;
  const generatedAt = (input.generatedAt ?? new Date().toISOString()).slice(0, 10);

  // 占位符值统一先做 HTML 转义；产品明细表是唯一允许注入原始 HTML 的特殊占位符。
  return new Map<string, { html: string }>([
    ['公司名', { html: escapeHtml(company.name) }],
    ['公司电话', { html: escapeHtml(company.phone) }],
    ['公司地址', { html: escapeHtml(company.address) }],
    ['订单号', { html: escapeHtml(rowText(order, 'order_no')) }],
    ['下单日期', { html: escapeHtml(rowText(order, 'ordered_at')) }],
    ['客户名', { html: escapeHtml(rowText(order, 'customer_name')) }],
    ['联系人', { html: escapeHtml(rowText(order, 'customer_contact_name')) }],
    ['联系电话', { html: escapeHtml(rowText(order, 'customer_contact_phone')) }],
    ['收件人', { html: escapeHtml(rowText(order, 'recipient_name')) }],
    ['收件地址', { html: escapeHtml(rowText(order, 'recipient_info') || rowText(order, 'customer_shipping_info')) }],
    ['产品小计', { html: escapeHtml(formatMoney(subtotalCents)) }],
    ['运费', { html: escapeHtml(formatMoney(shippingCents)) }],
    ['总金额', { html: escapeHtml(formatMoney(totalCents)) }],
    ['大写金额', { html: escapeHtml(centsToChineseUppercase(totalCents)) }],
    ['备注', { html: escapeHtml(rowText(order, 'remark')) }],
    ['签订日期', { html: escapeHtml(generatedAt) }],
    ['产品明细表', { html: buildProductTable(items) }],
  ]);
}

function substitutePlaceholders(clauseText: string, values: Map<string, { html: string }>): string {
  const escaped = escapeHtml(clauseText);
  // 先转义正文，再把 {占位符} 换成已转义的值；未识别的占位符原样保留，便于用户发现拼写问题。
  return escaped.replace(/\{([^{}]{1,30})\}/g, (matched, key: string) => {
    const value = values.get(key);
    return value ? value.html : matched;
  });
}

export function renderContractHtml(input: ContractRenderInput): string {
  const { template, company, order } = input;
  const values = resolveContractPlaceholders(input);
  const clauses = template.clauses
    .map((clause, index) => `<li><span class="clause-no">${escapeHtml(`第${chineseNumber(index + 1)}条`)}</span><p>${substitutePlaceholders(clause, values)}</p></li>`)
    .join('');

  const partyRows = (rows: [string, string][]) => rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<div class="party-row"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`)
    .join('');

  const supplier = partyRows([
    ['公司名称', values.get('公司名')!.html],
    ['联系电话', values.get('公司电话')!.html],
    ['公司地址', values.get('公司地址')!.html],
  ]);
  const buyer = partyRows([
    ['客户名称', values.get('客户名')!.html],
    ['联系人', values.get('联系人')!.html],
    ['联系电话', values.get('联系电话')!.html],
    ['收件地址', values.get('收件地址')!.html],
  ]);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(template.title)} · ${escapeHtml(rowText(order, 'order_no'))}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #15181c; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; font-size: 10.5pt; line-height: 1.7; }
    h1 { margin: 0; text-align: center; font-size: 19pt; letter-spacing: 2px; }
    .contract-meta { display: flex; justify-content: space-between; gap: 6mm; margin-top: 3mm; padding-bottom: 3mm; border-bottom: 2px solid #1f2933; color: #454e58; font-size: 9.5pt; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 8mm; margin-top: 4mm; }
    .party { min-width: 0; }
    .party-title { font-weight: 700; margin-bottom: 1.5mm; }
    .party-row { display: grid; grid-template-columns: auto 1fr; gap: 2mm; font-size: 9.5pt; min-width: 0; }
    .party-row span { color: #58616c; white-space: nowrap; }
    .party-row strong { font-weight: 500; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; margin-top: 4mm; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #68717b; padding: 2mm 1.6mm; vertical-align: middle; overflow-wrap: anywhere; }
    th { background: #eef1f3; font-size: 9.5pt; white-space: nowrap; }
    td.index, th.index { width: 10mm; text-align: center; }
    td.number, td.money, th.number, th.money { text-align: right; white-space: nowrap; }
    .totals { width: 82mm; margin: 3mm 0 0 auto; font-size: 10pt; }
    .totals div { display: flex; justify-content: space-between; gap: 8mm; padding: 1.2mm 0; }
    .totals .grand-total { border-top: 1px solid #303841; margin-top: 1mm; padding-top: 1.8mm; font-size: 11.5pt; font-weight: 700; }
    .uppercase-line { margin-top: 2mm; text-align: right; font-size: 9.5pt; color: #454e58; }
    .clauses { margin: 5mm 0 0; padding: 0; list-style: none; }
    .clauses li { display: flex; gap: 2.5mm; margin-bottom: 2.4mm; break-inside: avoid; }
    .clause-no { white-space: nowrap; font-weight: 700; }
    .clauses p { margin: 0; flex: 1; min-width: 0; white-space: pre-wrap; text-align: justify; }
    .signature { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-top: 9mm; page-break-inside: avoid; }
    .signature .side { border: 1px solid #a4aab0; border-radius: 2mm; padding: 4mm; min-height: 34mm; }
    .signature .side h3 { margin: 0 0 3mm; font-size: 10.5pt; }
    .signature .line { margin-top: 6mm; color: #58616c; font-size: 9.5pt; }
  </style>
</head>
<body>
  <h1>${escapeHtml(template.title)}</h1>
  <div class="contract-meta"><span>合同编号：${escapeHtml(rowText(order, 'order_no'))}</span><span>签订日期：${escapeHtml(values.get('签订日期')!.html)}</span></div>
  <section class="parties">
    <div class="party"><div class="party-title">甲方（供方）</div>${supplier}</div>
    <div class="party"><div class="party-title">乙方（需方）</div>${buyer}</div>
  </section>
  ${values.get('产品明细表')!.html}
  <section class="totals">
    <div><span>产品小计</span><span>${values.get('产品小计')!.html}</span></div>
    <div><span>运费</span><span>${values.get('运费')!.html}</span></div>
    <div class="grand-total"><span>合计金额</span><span>${values.get('总金额')!.html}</span></div>
  </section>
  <div class="uppercase-line">合计金额大写：${values.get('大写金额')!.html}</div>
  <ol class="clauses">${clauses}</ol>
  <footer class="signature">
    <div class="side"><h3>甲方（供方）</h3><div>${escapeHtml(company.name || '　　　　　　　　　　')}</div><div class="line">代表签字：＿＿＿＿＿＿＿＿　盖章</div><div class="line">日期：＿＿＿＿年＿＿月＿＿日</div></div>
    <div class="side"><h3>乙方（需方）</h3><div>${escapeHtml(rowText(order, 'customer_name') || '　　　　　　　　　　')}</div><div class="line">代表签字：＿＿＿＿＿＿＿＿　盖章</div><div class="line">日期：＿＿＿＿年＿＿月＿＿日</div></div>
  </footer>
</body>
</html>`;
}
