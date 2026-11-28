/**
 * 操作审计日志：记录关键业务写操作的“谁、何时、做了什么”。
 * 服务端在响应成功后写入，前端在“设置 → 操作日志”中查看（仅管理员）。
 */

export interface AuditLogRow {
  id: number;
  occurredAt: string;
  userId: number | null;
  username: string;
  displayName: string;
  role: string;
  method: string;
  path: string;
  route: string;
  statusCode: number;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  summary: string;
  ip: string;
  userAgent: string;
  durationMs: number;
  detail: Record<string, unknown> | null;
}

export interface AuditLogFilters {
  /** 关键词：摘要、账号、单号、对象名称、接口路径。 */
  q?: string;
  action?: string;
  category?: string;
  username?: string;
  entityType?: string;
  entityId?: string;
  /** ISO 时间，含边界。 */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogListResult {
  items: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditCategory {
  key: string;
  label: string;
  /** 匹配 action 的前缀，例如 order.create → order.。 */
  actionPrefixes: readonly string[];
}

export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  { key: 'all', label: '全部', actionPrefixes: [] },
  { key: 'order', label: '订单与发货', actionPrefixes: ['order.', 'shipment.', 'stock.'] },
  { key: 'finance', label: '财务', actionPrefixes: ['finance.'] },
  { key: 'document', label: '报价与销售单', actionPrefixes: ['quotation.', 'sales_document.'] },
  { key: 'product', label: '产品与资料', actionPrefixes: ['product.', 'catalog.', 'supplier_catalog.', 'library.'] },
  { key: 'customer', label: '客户', actionPrefixes: ['customer.'] },
  { key: 'system', label: '系统与账号', actionPrefixes: ['user.', 'backup.', 'settings.', 'company.'] },
];

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  order: '订单',
  order_contract: '订单合同',
  order_image: '订单图片',
  payment_proof: '水单',
  carton_label: '箱唛',
  quotation: '报价单',
  sales_document: '销售单',
  sales_receipt: '销售单收款',
  sales_receipt_file: '收款凭证',
  customer: '客户',
  customer_product: '客户产品',
  product: '产品',
  company: '公司',
  invoice: '发票',
  invoice_file: '发票文件',
  refund: '退款',
  shipment: '发货',
  shipment_batch: '发货批次',
  stock_confirmation: '备货确认',
  user: '账号',
  backup: '备份',
  settings: '设置',
  library: '资料库',
  catalog: '图册',
  supplier_catalog: '供应商图册',
  document_customer: '客户档案',
  finance: '财务',
};

/** 列表中的对象描述，例如“订单 DD20261128001”。 */
export function auditEntityText(row: Pick<AuditLogRow, 'entityType' | 'entityId' | 'entityLabel'>): string {
  const typeLabel = AUDIT_ENTITY_LABELS[row.entityType] ?? row.entityType;
  const value = row.entityLabel || row.entityId;
  if (value) return `${typeLabel} ${value}`.trim();
  return typeLabel;
}
