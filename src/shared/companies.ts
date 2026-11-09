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
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompanySaveInput {
  shortName: string;
  fullName?: string;
  taxNo?: string;
  bankName?: string;
  bankAccount?: string;
  address?: string;
  phone?: string;
  contactName?: string;
  remark?: string;
  isActive?: boolean;
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
