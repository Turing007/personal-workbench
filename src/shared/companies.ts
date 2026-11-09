/** 收款/开票公司档案。公司由财务模块维护，订单引用后水单和发票自动带出。 */
export interface Company {
  id: number;
  shortName: string;
  fullName: string;
  taxNo: string;
  bankName: string;
  bankAccount: string;
  address: string;
  phone: string;
  contactName: string;
  remark: string;
  /** 可开票类目，如「电动工具」「电池」「充电器」，用于一键复制开票信息时发给客户。 */
  invoiceCategories: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompanySaveInput {
  /** 兼容旧接口；新前端只提交 fullName，服务端会用它作为内部唯一名。 */
  shortName?: string;
  fullName?: string;
  taxNo?: string;
  bankName?: string;
  bankAccount?: string;
  address?: string;
  phone?: string;
  contactName?: string;
  remark?: string;
  invoiceCategories?: string[];
  isActive?: boolean;
}

/** 对外展示的公司名称：优先公司全称，历史数据没有全称时回退到简称。 */
export function companyDisplayName(company: { shortName?: string; fullName?: string }): string {
  return (company.fullName ?? '').trim() || (company.shortName ?? '').trim();
}

/** 可开票类目数量与单个类目长度上限，避免复制文本过长。 */
export const INVOICE_CATEGORY_LIMIT = 20;
export const INVOICE_CATEGORY_MAX_LENGTH = 30;

/**
 * 把接口/表单里的可开票类目统一成字符串数组。
 * 兼容数组、JSON 数组字符串，以及顿号/逗号/分号/换行分隔的文本；去空、去重并限制长度。
 */
export function normalizeInvoiceCategories(value: unknown): string[] {
  let raw: unknown[] = [];
  if (Array.isArray(value)) raw = value;
  else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) raw = parsed;
      } catch {
        raw = trimmed.split(/[、,，;；\n]/);
      }
    } else {
      raw = trimmed.split(/[、,，;；\n]/);
    }
  }
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const item of raw) {
    const text = (typeof item === 'string' ? item : String(item ?? '')).trim();
    if (!text) continue;
    const display = text.slice(0, INVOICE_CATEGORY_MAX_LENGTH);
    const key = display.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(display);
    if (categories.length >= INVOICE_CATEGORY_LIMIT) break;
  }
  return categories;
}

/** 表单输入框展示用：多个类目用中文顿号连接。 */
export function formatInvoiceCategories(categories: string[] | undefined): string {
  return normalizeInvoiceCategories(categories).join('、');
}

export interface CompanyInvoiceInfoSource {
  shortName?: string;
  fullName?: string;
  taxNo?: string;
  bankName?: string;
  bankAccount?: string;
  address?: string;
  phone?: string;
}

/**
 * 生成可直接发给客户的纯文本开票信息（不含可开票类目）。
 * 空字段整行省略，避免把「未填写」之类的内部提示发给客户。
 */
export function buildCompanyInvoiceInfoText(company: CompanyInvoiceInfoSource): string {
  const lines = ['【开票信息】'];
  const name = companyDisplayName(company);
  if (name) lines.push(`公司名称：${name}`);
  const taxNo = (company.taxNo ?? '').trim();
  if (taxNo) lines.push(`纳税人识别号：${taxNo}`);
  const address = (company.address ?? '').trim();
  if (address) lines.push(`注册地址：${address}`);
  const phone = (company.phone ?? '').trim();
  if (phone) lines.push(`联系电话：${phone}`);
  const bankName = (company.bankName ?? '').trim();
  if (bankName) lines.push(`开户行：${bankName}`);
  const bankAccount = (company.bankAccount ?? '').trim();
  if (bankAccount) lines.push(`银行账号：${bankAccount}`);
  return lines.join('\n');
}

/** 水单页按公司汇总的一行。companyId 为 null 表示历史订单尚未分配公司。 */
export interface CompanyStatsRow {
  companyId: number | null;
  companyName: string;
  receivedCents: number;
  receivedCount: number;
  pendingCents: number;
  pendingCount: number;
  pendingInvoiceCents: number;
  pendingInvoiceCount: number;
}

/** 财务列表“已收金额 → 按公司”弹层使用，月份口径与财务台账一致（下单月份）。 */
export interface CompanyReceiptBreakdownRow {
  companyId: number | null;
  companyName: string;
  receiptCount: number;
  amountCents: number;
}

export const UNASSIGNED_COMPANY_NAME = '未分配公司';
