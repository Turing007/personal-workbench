import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuditLogInsert, AuditLogRepository } from '../db/audit-repository.js';

interface AuditDescriptor {
  action: string;
  entityType: string;
  summary: string;
  idParam?: string;
}

interface AuditRule extends AuditDescriptor {
  method: string;
  route: string;
}

interface RequestAuditContext {
  startedAt: bigint;
  responseEntityId: string;
  responseEntityLabel: string;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 只做展示、不改变业务数据的 POST（预览/图册/诊断）不写审计，避免日志被噪音淹没。
 */
const SKIP_ROUTES = new Set([
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/setup',
  'POST /api/backups/preview',
  'POST /api/products/catalog',
  'POST /api/quotations/:id/customer-products/preview',
  'POST /api/shipping/orders/:orderId/list-preview',
  'POST /api/client-diagnostics',
]);

const METHOD_LABELS: Record<string, string> = {
  POST: '新增/执行',
  PUT: '修改',
  PATCH: '修改',
  DELETE: '删除',
};

const FALLBACK_CATEGORY_LABELS: Record<string, string> = {
  orders: '订单',
  finance: '财务',
  quotations: '报价单',
  'sales-documents': '销售单',
  products: '产品',
  customers: '客户',
  'customer-products': '客户产品',
  companies: '公司',
  stock: '备货',
  backups: '备份',
  settings: '设置',
  shipping: '发货',
  labels: '标贴',
  library: '资料库',
  catalogs: '图册',
  'supplier-catalogs': '供应商图册',
  'document-customers': '客户档案',
};

const FALLBACK_ENTITY_TYPES: Record<string, string> = {
  orders: 'order',
  finance: 'finance',
  quotations: 'quotation',
  'sales-documents': 'sales_document',
  products: 'product',
  customers: 'customer',
  'customer-products': 'customer_product',
  companies: 'company',
  stock: 'stock',
  backups: 'backup',
  settings: 'settings',
  shipping: 'shipment',
  labels: 'order',
  library: 'library',
  catalogs: 'catalog',
  'supplier-catalogs': 'supplier_catalog',
  'document-customers': 'document_customer',
};

const RULES: AuditRule[] = [
  // 账号与备份
  { method: 'PUT', route: '/api/auth/password', action: 'user.password', entityType: 'user', summary: '修改本人密码' },
  { method: 'POST', route: '/api/auth/users', action: 'user.create', entityType: 'user', summary: '新建账号' },
  { method: 'PATCH', route: '/api/auth/users/:id', action: 'user.update', entityType: 'user', summary: '修改账号' },
  { method: 'PUT', route: '/api/backups/auto/settings', action: 'backup.settings', entityType: 'backup', summary: '修改自动备份设置' },
  { method: 'POST', route: '/api/backups/auto/run', action: 'backup.run', entityType: 'backup', summary: '执行自动备份' },
  { method: 'POST', route: '/api/backups', action: 'backup.create', entityType: 'backup', summary: '创建手动备份' },
  { method: 'POST', route: '/api/backups/restore', action: 'backup.restore', entityType: 'backup', summary: '恢复备份' },

  // 订单与履约
  { method: 'POST', route: '/api/orders', action: 'order.create', entityType: 'order', summary: '新建订单' },
  { method: 'PUT', route: '/api/orders/:id', action: 'order.update', entityType: 'order', summary: '修改订单' },
  { method: 'DELETE', route: '/api/orders/:id', action: 'order.delete', entityType: 'order', summary: '删除订单' },
  { method: 'POST', route: '/api/orders/:id/status', action: 'order.status', entityType: 'order', summary: '修改订单状态' },
  { method: 'PATCH', route: '/api/orders/:id/tracking', action: 'order.tracking', entityType: 'order', summary: '修改物流单号' },
  { method: 'POST', route: '/api/orders/:id/publish', action: 'order.publish', entityType: 'order', summary: '发布订单' },
  { method: 'POST', route: '/api/orders/:id/contracts', action: 'order.contract_upload', entityType: 'order', summary: '上传订单合同' },
  { method: 'POST', route: '/api/orders/:id/contracts/generate', action: 'order.contract_generate', entityType: 'order', summary: '生成订单合同' },
  { method: 'DELETE', route: '/api/order-contracts/:id', action: 'order.contract_delete', entityType: 'order_contract', summary: '删除订单合同' },
  { method: 'POST', route: '/api/orders/:id/detail-images', action: 'order.image_upload', entityType: 'order', summary: '上传订单详情图' },
  { method: 'DELETE', route: '/api/order-detail-images/:id', action: 'order.image_delete', entityType: 'order_image', summary: '删除订单详情图' },
  { method: 'POST', route: '/api/orders/:id/payment-proofs', action: 'order.proof_upload', entityType: 'order', summary: '上传付款凭证' },
  { method: 'DELETE', route: '/api/payment-proofs/:id', action: 'order.proof_delete', entityType: 'payment_proof', summary: '删除付款凭证' },
  { method: 'POST', route: '/api/temporary-customer/promote', action: 'customer.promote', entityType: 'customer', summary: '临时客户转为正式客户' },
  { method: 'PUT', route: '/api/orders/:id/labels', action: 'order.label_save', entityType: 'order', summary: '保存订单标贴' },
  { method: 'PUT', route: '/api/carton-labels/:id', action: 'order.label_update', entityType: 'carton_label', summary: '修改箱唛' },
  { method: 'POST', route: '/api/carton-labels/merge', action: 'order.label_merge', entityType: 'order', summary: '合并箱唛' },
  { method: 'POST', route: '/api/labels/print-history', action: 'order.label_print', entityType: 'order', summary: '记录标贴打印' },

  // 财务
  { method: 'POST', route: '/api/finance/orders/:orderId/proofs', action: 'finance.proof_upload', entityType: 'order', summary: '上传水单', idParam: 'orderId' },
  { method: 'PUT', route: '/api/finance/proofs/:id', action: 'finance.proof_update', entityType: 'payment_proof', summary: '修改水单' },
  { method: 'POST', route: '/api/finance/proofs/:id/approve', action: 'finance.proof_approve', entityType: 'payment_proof', summary: '审核水单入账' },
  { method: 'POST', route: '/api/finance/proofs/:id/reject', action: 'finance.proof_reject', entityType: 'payment_proof', summary: '驳回水单' },
  { method: 'POST', route: '/api/finance/proofs/:id/void', action: 'finance.proof_void', entityType: 'payment_proof', summary: '作废水单' },
  { method: 'DELETE', route: '/api/finance/proofs/:id', action: 'finance.proof_delete', entityType: 'payment_proof', summary: '删除水单' },
  { method: 'POST', route: '/api/finance/orders/:orderId/refunds', action: 'finance.refund_create', entityType: 'order', summary: '登记退款', idParam: 'orderId' },
  { method: 'PUT', route: '/api/finance/refunds/:id', action: 'finance.refund_update', entityType: 'refund', summary: '修改退款' },
  { method: 'DELETE', route: '/api/finance/refunds/:id', action: 'finance.refund_delete', entityType: 'refund', summary: '删除退款' },
  { method: 'POST', route: '/api/finance/orders/:orderId/invoices', action: 'finance.invoice_create', entityType: 'order', summary: '创建发票', idParam: 'orderId' },
  { method: 'PUT', route: '/api/finance/invoices/:id', action: 'finance.invoice_update', entityType: 'invoice', summary: '修改发票' },
  { method: 'POST', route: '/api/finance/invoices/:id/submit', action: 'finance.invoice_submit', entityType: 'invoice', summary: '提交开票申请' },
  { method: 'POST', route: '/api/finance/invoices/:id/issue', action: 'finance.invoice_issue', entityType: 'invoice', summary: '登记发票开具' },
  { method: 'POST', route: '/api/finance/invoices/:id/send', action: 'finance.invoice_send', entityType: 'invoice', summary: '标记发票已发送' },
  { method: 'POST', route: '/api/finance/invoices/:id/void', action: 'finance.invoice_void', entityType: 'invoice', summary: '作废发票' },
  { method: 'POST', route: '/api/finance/invoices/:id/files', action: 'finance.invoice_file_upload', entityType: 'invoice', summary: '上传发票文件' },
  { method: 'DELETE', route: '/api/finance/invoice-files/:id', action: 'finance.invoice_file_delete', entityType: 'invoice_file', summary: '删除发票文件' },
  { method: 'POST', route: '/api/finance/companies', action: 'company.create', entityType: 'company', summary: '新建公司' },
  { method: 'PUT', route: '/api/finance/companies/:id', action: 'company.update', entityType: 'company', summary: '修改公司' },
  { method: 'DELETE', route: '/api/finance/companies/:id', action: 'company.delete', entityType: 'company', summary: '删除公司' },

  // 客户与产品
  { method: 'POST', route: '/api/customers', action: 'customer.create', entityType: 'customer', summary: '新建客户' },
  { method: 'PUT', route: '/api/customers/:id', action: 'customer.update', entityType: 'customer', summary: '修改客户' },
  { method: 'PATCH', route: '/api/customers/:id/status', action: 'customer.status', entityType: 'customer', summary: '修改客户状态' },
  { method: 'DELETE', route: '/api/customers/:id', action: 'customer.delete', entityType: 'customer', summary: '删除客户' },
  { method: 'POST', route: '/api/products', action: 'product.create', entityType: 'product', summary: '新建产品' },
  { method: 'PUT', route: '/api/products/:id', action: 'product.update', entityType: 'product', summary: '修改产品' },
  { method: 'DELETE', route: '/api/products/:id', action: 'product.delete', entityType: 'product', summary: '删除产品' },
  { method: 'POST', route: '/api/products/:id/status', action: 'product.status', entityType: 'product', summary: '修改产品状态' },
  { method: 'POST', route: '/api/products/import', action: 'product.import', entityType: 'product', summary: '批量导入产品' },

  // 报价单与销售单
  { method: 'POST', route: '/api/quotations', action: 'quotation.create', entityType: 'quotation', summary: '新建报价单' },
  { method: 'PUT', route: '/api/quotations/:id', action: 'quotation.update', entityType: 'quotation', summary: '修改报价单' },
  { method: 'PATCH', route: '/api/quotations/:id/status', action: 'quotation.status', entityType: 'quotation', summary: '修改报价单状态' },
  { method: 'DELETE', route: '/api/quotations/:id', action: 'quotation.delete', entityType: 'quotation', summary: '删除报价单' },
  { method: 'POST', route: '/api/quotations/:id/customer-products/sync', action: 'quotation.product_sync', entityType: 'quotation', summary: '同步报价单客户产品' },
  { method: 'POST', route: '/api/quotations/:id/copy-to-sales', action: 'quotation.copy_to_sales', entityType: 'quotation', summary: '报价单转销售单' },
  { method: 'POST', route: '/api/sales-documents', action: 'sales_document.create', entityType: 'sales_document', summary: '新建销售单' },
  { method: 'PUT', route: '/api/sales-documents/:id', action: 'sales_document.update', entityType: 'sales_document', summary: '修改销售单' },
  { method: 'PATCH', route: '/api/sales-documents/:id/status', action: 'sales_document.status', entityType: 'sales_document', summary: '修改销售单状态' },
  { method: 'POST', route: '/api/sales-documents/:id/create-order', action: 'sales_document.create_order', entityType: 'sales_document', summary: '销售单生成订单' },
  { method: 'DELETE', route: '/api/sales-documents/:id', action: 'sales_document.delete', entityType: 'sales_document', summary: '删除销售单' },
  { method: 'POST', route: '/api/sales-documents/:id/receipts', action: 'sales_document.receipt_create', entityType: 'sales_document', summary: '登记销售单收款' },
  { method: 'PUT', route: '/api/sales-receipts/:id', action: 'sales_document.receipt_update', entityType: 'sales_receipt', summary: '修改销售单收款' },
  { method: 'DELETE', route: '/api/sales-receipts/:id', action: 'sales_document.receipt_delete', entityType: 'sales_receipt', summary: '删除销售单收款' },
  { method: 'POST', route: '/api/stock/confirmations', action: 'stock.confirm_supplier', entityType: 'stock_confirmation', summary: '确认供应商备货' },
  { method: 'POST', route: '/api/sales-receipts/:id/files', action: 'sales_document.receipt_file_upload', entityType: 'sales_receipt', summary: '上传销售单收款凭证' },
  { method: 'DELETE', route: '/api/sales-receipt-files/:id', action: 'sales_document.receipt_file_delete', entityType: 'sales_receipt_file', summary: '删除销售单收款凭证' },

  // 发货
  { method: 'POST', route: '/api/shipping/batches', action: 'shipment.batch_create', entityType: 'shipment_batch', summary: '新建发货批次' },
  { method: 'PUT', route: '/api/shipping/batches/:id/orders/:orderId', action: 'shipment.batch_order_update', entityType: 'shipment_batch', summary: '调整发货批次订单' },
  { method: 'POST', route: '/api/shipping/batches/:id/confirm', action: 'shipment.batch_confirm', entityType: 'shipment_batch', summary: '确认发货批次' },
  { method: 'POST', route: '/api/shipping/confirm', action: 'shipment.confirm', entityType: 'shipment', summary: '确认发货' },
  { method: 'POST', route: '/api/shipping/partial', action: 'shipment.partial', entityType: 'shipment', summary: '部分发货' },
  { method: 'DELETE', route: '/api/shipping/shipments/:shipmentId', action: 'shipment.delete', entityType: 'shipment', summary: '删除发货记录', idParam: 'shipmentId' },

  // 设置
  { method: 'PUT', route: '/api/settings/network-addresses', action: 'settings.network', entityType: 'settings', summary: '修改局域网地址' },
  { method: 'PUT', route: '/api/settings/company-profile', action: 'settings.company_profile', entityType: 'settings', summary: '修改公司资料' },
  { method: 'PUT', route: '/api/settings/contract-template', action: 'settings.contract_template', entityType: 'settings', summary: '修改合同模板' },
  { method: 'PUT', route: '/api/settings/packaging-presets', action: 'settings.packaging', entityType: 'settings', summary: '修改包装预设' },
  { method: 'POST', route: '/api/settings/packaging-presets/reseed', action: 'settings.packaging_reseed', entityType: 'settings', summary: '重置包装预设' },
  { method: 'PUT', route: '/api/settings/product-option-presets', action: 'settings.product_options', entityType: 'settings', summary: '修改颜色与插脚预设' },
  { method: 'POST', route: '/api/settings/product-option-presets/reseed', action: 'settings.product_options_reseed', entityType: 'settings', summary: '重置颜色与插脚预设' },
  { method: 'PUT', route: '/api/settings/battery-price-matrix', action: 'settings.battery_prices', entityType: 'settings', summary: '修改电池价格表' },
  { method: 'PUT', route: '/api/settings/volume-divisor', action: 'settings.volume_divisor', entityType: 'settings', summary: '修改体积重系数' },
  { method: 'PUT', route: '/api/settings/charger-prices', action: 'settings.charger_prices', entityType: 'settings', summary: '修改充电器价格' },
  { method: 'PUT', route: '/api/settings/category-accessory-prices', action: 'settings.accessory_prices', entityType: 'settings', summary: '修改类目配件价格' },
  { method: 'POST', route: '/api/settings/company-profile/logo', action: 'settings.company_logo', entityType: 'settings', summary: '更新公司 Logo' },
  { method: 'DELETE', route: '/api/settings/company-profile/logo', action: 'settings.company_logo_delete', entityType: 'settings', summary: '删除公司 Logo' },
  { method: 'POST', route: '/api/settings/company-profile/wechat-qr', action: 'settings.company_qr', entityType: 'settings', summary: '更新微信二维码' },
  { method: 'DELETE', route: '/api/settings/company-profile/wechat-qr', action: 'settings.company_qr_delete', entityType: 'settings', summary: '删除微信二维码' },
];

const RULE_MAP = new Map(RULES.map((rule) => [`${rule.method} ${rule.route}`, rule]));

const SENSITIVE_KEY = /password|passwd|secret|token|cookie|authorization/i;
const MAX_DETAIL_CHARS = 8_000;
const MAX_RESPONSE_CHARS = 2_000_000;

function fallbackDescriptor(route: string, method: string): AuditDescriptor {
  const segment = route.split('/').filter(Boolean)[1] ?? 'api';
  const entityType = FALLBACK_ENTITY_TYPES[segment] ?? segment.replaceAll('-', '_');
  const categoryLabel = FALLBACK_CATEGORY_LABELS[segment] ?? segment;
  return {
    action: `${entityType}.${method.toLowerCase()}`,
    entityType,
    summary: `${categoryLabel} · ${METHOD_LABELS[method] ?? method}`,
  };
}

function describeRoute(route: string, method: string): AuditDescriptor {
  return RULE_MAP.get(`${method} ${route}`) ?? fallbackDescriptor(route, method);
}

function sanitizeDetail(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[层级过深已省略]';
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `[二进制 ${value.length} 字节]`;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeDetail(item, depth + 1));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record).slice(0, 60)) {
      result[key] = SENSITIVE_KEY.test(key) ? '***' : sanitizeDetail(child, depth + 1);
    }
    return result;
  }
  return value;
}

function entityIdFromParams(request: FastifyRequest, descriptor: AuditDescriptor): string {
  const params = request.params && typeof request.params === 'object'
    ? request.params as Record<string, unknown>
    : {};
  if (descriptor.idParam && params[descriptor.idParam] != null) return String(params[descriptor.idParam]);
  for (const key of ['orderId', 'customerId', 'id', 'documentId', 'quotationId', 'shipmentId', 'batchId']) {
    if (params[key] != null && params[key] !== '') return String(params[key]);
  }
  return '';
}

function findResponseEntity(value: unknown, depth = 0): { id: string; label: string } {
  if (depth > 2 || value == null || typeof value !== 'object') return { id: '', label: '' };
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 3)) {
      const found = findResponseEntity(item, depth + 1);
      if (found.id || found.label) return found;
    }
    return { id: '', label: '' };
  }
  const record = value as Record<string, unknown>;
  const idValue = record.id ?? record.orderId ?? record.order_id;
  const numericId = Number(idValue);
  const id = Number.isSafeInteger(numericId) && numericId > 0 ? String(numericId) : '';
  const label = [
    'order_no', 'orderNo', 'number', 'document_no', 'documentNo',
    'invoice_no', 'invoiceNo', 'short_name', 'shortName',
    'name', 'title', 'display_name', 'displayName', 'username',
  ]
    .map((key) => (typeof record[key] === 'string' ? record[key].trim() : ''))
    .find(Boolean) ?? '';
  if (id || label) return { id, label: label.slice(0, 120) };
  for (const child of Object.values(record).slice(0, 20)) {
    const found = findResponseEntity(child, depth + 1);
    if (found.id || found.label) return found;
  }
  return { id: '', label: '' };
}

function parseResponseEntity(payload: unknown): { id: string; label: string } {
  if (typeof payload === 'string') {
    if (!payload || payload.length > MAX_RESPONSE_CHARS) return { id: '', label: '' };
    try {
      return findResponseEntity(JSON.parse(payload));
    } catch {
      return { id: '', label: '' };
    }
  }
  if (Buffer.isBuffer(payload)) {
    if (payload.length > MAX_RESPONSE_CHARS) return { id: '', label: '' };
    try {
      return findResponseEntity(JSON.parse(payload.toString('utf8')));
    } catch {
      return { id: '', label: '' };
    }
  }
  return { id: '', label: '' };
}

function buildDetailJson(request: FastifyRequest): string {
  const contentType = String(request.headers['content-type'] ?? '');
  const detail: Record<string, unknown> = {};
  if (!contentType.startsWith('multipart/form-data')) {
    detail.body = sanitizeDetail(request.body ?? null);
  } else {
    detail.contentType = 'multipart/form-data';
  }
  if (request.query && typeof request.query === 'object' && Object.keys(request.query).length) {
    detail.query = sanitizeDetail(request.query);
  }
  if (request.params && typeof request.params === 'object' && Object.keys(request.params).length) {
    detail.params = sanitizeDetail(request.params);
  }
  const json = JSON.stringify(detail);
  if (json.length <= MAX_DETAIL_CHARS) return json;
  return JSON.stringify({ truncated: true, preview: json.slice(0, MAX_DETAIL_CHARS - 100) });
}

/**
 * 注册操作审计钩子：
 * - onRequest 记录开始时间；
 * - onSend 在成功响应发出前解析对象 id / 单号并同步落库。
 *   放在 onSend 而不是 onResponse，保证响应返回时日志已经可查（测试与前端刷新都不用等）；
 *   写日志失败只记 warn，绝不影响业务响应。
 */
export function registerAuditLog(app: FastifyInstance, repository: AuditLogRepository): void {
  const contexts = new WeakMap<FastifyRequest, { startedAt: bigint }>();

  app.addHook('onRequest', async (request) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    if (!request.url.startsWith('/api/')) return;
    contexts.set(request, { startedAt: process.hrtime.bigint() });
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const context = contexts.get(request);
    if (!context) return payload;
    try {
      const route = request.routeOptions?.url;
      const key = `${request.method} ${route ?? ''}`;
      const user = request.user;
      if (!route || !user) return payload;
      if (SKIP_ROUTES.has(key)) return payload;
      if (reply.statusCode >= 400) return payload;
      const pathname = request.url.split('?')[0];
      if (!pathname.startsWith('/api/')) return payload;

      const descriptor = describeRoute(route, request.method);
      const responseEntity = parseResponseEntity(payload);
      const entityId = entityIdFromParams(request, descriptor) || responseEntity.id;
      const durationMs = Number((process.hrtime.bigint() - context.startedAt) / 1_000_000n);
      const insert: AuditLogInsert = {
        occurredAt: new Date().toISOString(),
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        method: request.method,
        path: pathname,
        route,
        statusCode: reply.statusCode,
        action: descriptor.action,
        entityType: descriptor.entityType,
        entityId,
        entityLabel: responseEntity.label,
        summary: descriptor.summary,
        ip: request.ip,
        userAgent: String(request.headers['user-agent'] ?? '').slice(0, 300),
        durationMs: Number.isFinite(durationMs) ? durationMs : 0,
        detailJson: buildDetailJson(request),
      };
      repository.insert(insert);
    } catch (error) {
      request.log.warn({ err: error }, '写入操作审计日志失败');
    }
    return payload;
  });
}
