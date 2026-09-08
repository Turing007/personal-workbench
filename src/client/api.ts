import type { OrderStatus } from '../shared/domain';
import { calculateOrderAmountCents } from '../shared/order-prices';
import type { StockPreparation } from '../shared/stock';
import type {
  Customer,
  CustomerProduct as SharedCustomerProduct,
  CustomerProductAttachment,
  CustomerProductBatchSaveInput,
  CustomerProductListFilters,
  CustomerProductPackaging,
  CustomerProductSaveInput,
  CustomerSaveInput,
  QuotationCustomerProductSyncPreview,
  QuotationCustomerProductSyncResult,
} from '../shared/customers';
import type {
  CompanySnapshot,
  DocumentCustomerSuggestion,
  PaymentStatus,
  QuotationDetail,
  QuotationSaveInput,
  QuotationStatus,
  QuotationSummary,
  SalesDocumentDetail,
  SalesDocumentSaveInput,
  SalesDocumentStatus,
  SalesDocumentSummary,
  SalesReceipt,
  SalesReceiptFile,
  SalesReceiptInput,
} from '../shared/documents';
import type {
  FinanceInvoice,
  FinanceInvoiceFile,
  FinanceListFilters,
  FinanceListResult,
  FinanceReceipt,
  OrderFinanceSummary,
  PayeeBreakdownRow,
  PaymentProofRecord,
} from '../shared/finance';
import type { CustomerProduct as LegacyCustomerProduct, OrderDraft, OrderItemDraft, PackagingOption } from './components/OrderForm';
import type { ProductRecord } from './components/ProductEditor';
import type { ProductAttachmentCategory } from './components/ProductEditor';

export interface ApiErrorShape {
  code: string;
  message: string;
  field?: string;
}

export interface ApiOrderPackaging {
  id: number;
  name: string;
  innerSize?: string;
  innerWeight?: number;
  outerSize?: string;
  outerLength?: number;
  outerWidth?: number;
  outerHeight?: number;
  outerWeight?: number;
  packCount: number;
  sortOrder?: number;
}

export interface ApiOrderItemDetail {
  id: number;
  order_id?: number;
  customer_product_id?: number | null;
  name: string;
  sku: string;
  specification: string;
  quantity: number;
  pack_count: number;
  unit_price_cents?: number;
  amount_cents?: number;
  remark?: string;
  packaging?: ApiOrderPackaging[];
}

export interface ApiOrderPaymentProof {
  id: number;
  orderId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  note: string;
  createdAt: string;
  url: string;
}

export interface ApiOrderRow {
  id: number;
  order_no: string;
  ordered_at: string;
  customer_id?: number | null;
  customer_name?: string;
  customer_contact_name?: string;
  customer_contact_phone?: string;
  customer_shipping_info?: string;
  recipient_name: string;
  recipient_info: string;
  amount: number;
  amount_cents?: number;
  shipping_cents?: number;
  tracking_no: string;
  payment_note?: string;
  order_detail?: string;
  remark?: string;
  created_at?: string;
  updated_at?: string;
  /** 含 draft（草稿）在内的全部订单状态。 */
  status: OrderStatus | 'draft';
  label_printed_at?: string | null;
  total_boxes: number;
  total_quantity: number;
}

export interface ApiOrderDetail extends ApiOrderRow {
  payment_note: string;
  remark: string;
  items: ApiOrderItemDetail[];
  labels: Array<Record<string, unknown>>;
  paymentProofs: ApiOrderPaymentProof[];
  contracts: ApiOrderContract[];
  orderDetail?: string;
  order_detail?: string;
  orderDetailImages?: ApiOrderDetailImage[];
}


export interface ApiOrderContract {
  id: number;
  orderId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
}

export interface ApiOrderDetailImage {
  id: number;
  orderId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
}

export interface ListResponse<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductApiRecord {
  id: number;
  name: string;
  sku: string;
  specification: string;
  parameters?: string;
  category?: string;
  purchase_price?: number | null;
  supplier?: string;
  colors?: string[];
  batteryPlugs?: string[];
  packaging?: Array<Record<string, unknown>>;
  remark?: string;
  accessories?: string;
  images?: Array<Record<string, unknown>>;
  attachments?: Array<Record<string, unknown>>;
  status?: string;
}

export interface ProductAttachmentApiRecord {
  id: number;
  productId?: number;
  category: string;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt?: string;
  url?: string;
}

export interface ProductImageApiRecord {
  id: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt?: string;
}

function toError(payload: unknown, fallback: string, status: number): ApiErrorShape {
  if (payload && typeof payload === 'object') {
    const candidate = payload as Record<string, unknown>;
    const error = candidate.error && typeof candidate.error === 'object' ? candidate.error as Record<string, unknown> : candidate;
    if (typeof error.message === 'string') return { code: String(error.code ?? `HTTP_${status}`), message: error.message, field: typeof error.field === 'string' ? error.field : undefined };
    if (typeof candidate.message === 'string') return { code: `HTTP_${status}`, message: candidate.message };
  }
  return { code: `HTTP_${status}`, message: fallback };
}

// 访问密码会话失效时由服务端返回 401/AUTH_REQUIRED；这里广播全局事件，
// App 监听后切换到登录界面。事件名导出以便测试与订阅方复用。
export const AUTH_REQUIRED_EVENT = 'workbench:auth-required';

function notifyAuthRequired(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const error = toError(payload, response.statusText || '请求失败', response.status);
    if (error.code === 'AUTH_REQUIRED') notifyAuthRequired();
    throw error;
  }
  if (payload && typeof payload === 'object' && 'ok' in payload) {
    const envelope = payload as { ok?: boolean; data?: T; error?: unknown };
    if (envelope.ok === false) {
      const error = toError(payload, '请求失败', response.status);
      if (error.code === 'AUTH_REQUIRED') notifyAuthRequired();
      throw error;
    }
    return envelope.data as T;
  }
  return payload as T;
}

export async function requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const headers = new Headers(init.headers);
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    let payload: unknown = text;
    try { payload = text ? JSON.parse(text) : null; } catch { /* Keep the response text for a useful fallback error. */ }
    const error = toError(payload, response.statusText || '下载失败', response.status);
    if (error.code === 'AUTH_REQUIRED') notifyAuthRequired();
    throw error;
  }
  return response.blob();
}

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
}

export function getAuthStatus(): Promise<AuthStatus> {
  return request<AuthStatus>('/api/auth/status');
}

export function setupAccessPassword(password: string): Promise<{ configured: boolean }> {
  return request<{ configured: boolean }>('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password }) });
}

export function loginWithPassword(password: string): Promise<{ authenticated: boolean }> {
  return request<{ authenticated: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
}

export function changeAccessPassword(currentPassword: string, newPassword: string): Promise<{ configured: boolean }> {
  return request<{ configured: boolean }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function logoutAccess(): Promise<{ authenticated: boolean }> {
  return request<{ authenticated: boolean }>('/api/auth/logout', { method: 'POST' });
}

function asPackaging(row: Record<string, unknown> | undefined): PackagingOption {
  const oldLength = String(row?.outerLength ?? row?.outer_length ?? '');
  const oldWidth = String(row?.outerWidth ?? row?.outer_width ?? '');
  const oldHeight = String(row?.outerHeight ?? row?.outer_height ?? '');
  const legacyOuterSize = [oldLength, oldWidth, oldHeight].every(Boolean) ? `${oldLength}×${oldWidth}×${oldHeight}` : '';
  const rawImages = typeof row?.images === 'string'
    ? (() => { try { return JSON.parse(row.images) as unknown; } catch { return []; } })()
    : row?.images;
  return {
    id: String(row?.id ?? `pack-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    name: String(row?.name ?? '标准包装'),
    innerSize: String(row?.innerSize ?? row?.inner_size ?? ''),
    innerWeight: String(row?.innerWeight ?? row?.inner_weight ?? ''),
    outerSize: String(row?.outerSize ?? row?.outer_size ?? legacyOuterSize),
    outerWeight: String(row?.outerWeight ?? row?.outer_weight ?? ''),
    packSize: Math.max(1, Number(row?.packCount ?? row?.pack_count ?? 1)),
    purchasePrice: row?.purchasePrice == null && row?.purchase_price == null
      ? ''
      : String(row?.purchasePrice ?? row?.purchase_price ?? ''),
    length: oldLength || undefined,
    width: oldWidth || undefined,
    height: oldHeight || undefined,
    images: (Array.isArray(rawImages) ? rawImages : []).map((raw) => {
      const image = raw as Record<string, unknown>;
      const relativePath = String(image.relativePath ?? image.relative_path ?? '');
      return {
        id: String(image.id ?? relativePath),
        name: String(image.originalName ?? image.original_name ?? '包装图片'),
        url: `/files/${relativePath}`,
      };
    }).filter((image) => image.url !== '/files/'),
  };
}

export function mapProduct(row: ProductApiRecord): LegacyCustomerProduct {
  const packaging = (row.packaging ?? []).map((item) => asPackaging(item));
  return { id: String(row.id), name: row.name, sku: row.sku ?? '', specification: row.specification ?? '', packCount: packaging[0]?.packSize ?? 1 };
}

function mapCustomerProduct(row: SharedCustomerProduct): SharedCustomerProduct {
  return {
    ...row,
    id: Number(row.id),
    customerId: Number(row.customerId),
    systemProductId: row.systemProductId == null ? null : Number(row.systemProductId),
    packCount: row.packCount == null ? null : Number(row.packCount),
    latestQuoteCents: row.latestQuoteCents == null ? null : Number(row.latestQuoteCents),
    finalPriceCents: row.finalPriceCents == null ? null : Number(row.finalPriceCents),
    costPriceCents: row.costPriceCents == null ? null : Number(row.costPriceCents),
    freightPerBoxCents: row.freightPerBoxCents == null ? null : Number(row.freightPerBoxCents),
    remark: String(row.remark ?? ''),
    packaging: Array.isArray(row.packaging) ? row.packaging : [],
    attachments: Array.isArray(row.attachments)
      ? row.attachments.map((attachment) => ({
        ...attachment,
        id: Number(attachment.id),
        customerProductId: Number(attachment.customerProductId),
        size: Number(attachment.size ?? 0),
        category: attachment.category ?? 'other',
        url: attachment.url || (attachment.relativePath ? `/files/${attachment.relativePath}` : ''),
      }))
      : [],
  };
}

export function mapProductRecord(row: ProductApiRecord): ProductRecord {
  const purchasePrice = row.purchase_price ?? (row as ProductApiRecord & { purchasePrice?: number | null }).purchasePrice;
  const rawImages = row.images ?? (row as ProductApiRecord & { images_json?: Array<Record<string, unknown>> }).images_json ?? [];
  const packaging = (row.packaging ?? []).map((item) => asPackaging(item));
  const rawAttachments = row.attachments ?? [];
  return { ...mapProduct(row), category: row.category ?? '', purchasePrice: purchasePrice == null ? '' : String(purchasePrice), supplier: row.supplier ?? '', parameters: typeof row.parameters === 'string' ? row.parameters : '', status: row.status === 'draft' ? 'draft' : 'active', colors: row.colors ?? [], batteryPlugs: row.batteryPlugs ?? [], images: rawImages.map((image) => ({ id: String(image.id ?? image.relativePath ?? image.relative_path), name: String(image.originalName ?? image.original_name ?? '产品图片'), url: `/files/${String(image.relativePath ?? image.relative_path ?? '')}` })), attachments: rawAttachments.map((raw) => { const item = raw as Record<string, unknown>; const category = String(item.category ?? 'other'); const relativePath = String(item.relativePath ?? item.relative_path ?? ''); return { id: String(item.id), category: (['manual', 'packaging-design', 'label-dieline', 'other'].includes(category) ? category : 'other') as ProductAttachmentCategory, name: String(item.originalName ?? item.original_name ?? '产品附件'), url: String(item.url ?? (relativePath ? `/files/${relativePath}` : '')), mimeType: String(item.mimeType ?? item.mime_type ?? ''), size: Number(item.size ?? item.size_bytes ?? 0), createdAt: String(item.createdAt ?? item.created_at ?? '') }; }), accessories: row.accessories ?? '', remark: row.remark ?? '', packaging: packaging.length ? packaging : [asPackaging(undefined)] };
}

export function draftToInput(draft: OrderDraft) {
  const isDraft = draft.status === 'draft';
  const itemInputs = draft.items.map((item) => ({
    quantity: Math.max(1, Math.trunc(item.quantity)),
    unitPriceCents: Math.max(0, Math.trunc(item.unitPriceCents ?? 0)),
  }));
  const shippingCents = Math.max(0, Math.trunc(draft.shippingCents ?? 0));
  const amountCents = calculateOrderAmountCents(itemInputs, shippingCents);
  return {
    orderNo: draft.orderNo.trim(),
    orderedAt: draft.orderedAt.slice(0, 10),
    isDraft: isDraft || undefined,
    customerId: draft.customerId ?? null,
    customerName: draft.customerName ?? '',
    customerContactName: draft.customerContactName ?? '',
    customerContactPhone: draft.customerContactPhone ?? '',
    customerShippingInfo: draft.customerShippingInfo ?? '',
    recipientName: draft.recipientName,
    recipientInfo: draft.recipientInfo,
    amount: amountCents / 100,
    amountCents,
    shippingCents,
    trackingNo: draft.trackingNo,
    paymentNote: draft.paymentNote,
    orderDetail: draft.orderDetail,
    remark: draft.remark,
    settlementType: draft.settlementType === 'personal' ? 'personal' : 'corporate',
    items: draft.items.map((item) => ({ customerProductId: item.customerProductId ?? (item.productId ? Number(item.productId) : null), name: item.name.trim(), sku: item.sku.trim(), specification: item.specification.trim(), packCount: Math.max(1, Math.trunc(item.packSize)), quantity: Math.max(1, Math.trunc(item.quantity)), unitPriceCents: Math.max(0, Math.trunc(item.unitPriceCents ?? 0)), freightPerBoxCents: Math.max(0, Math.trunc(item.freightPerBoxCents ?? 0)), packaging: item.packaging?.length ? item.packaging.map((pack) => ({ name: pack.name, innerSize: pack.innerSize, innerWeight: Number(pack.innerWeight) || 0, outerSize: pack.outerSize, outerWeight: Number(pack.outerWeight) || 0, packCount: Math.max(1, Math.trunc(pack.packSize)) })) : [{ name: '', packCount: Math.max(1, Math.trunc(item.packSize)) }], remark: item.remark }))
    , orderAttachments: draft.items.flatMap((item) => (item.customerProductAttachments ?? []).map((attachment) => ({ category: attachment.category, sourceCustomerProductId: item.customerProductId ?? null, relativePath: attachment.relativePath, originalName: attachment.originalName, mimeType: attachment.mimeType, size: attachment.size })))
  };
}

export function getOrders(params: { status?: 'all' | OrderStatus; q?: string; page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.status && params.status !== 'all') query.set('status', params.status);
  if (params.q?.trim()) query.set('q', params.q.trim());
  query.set('page', String(params.page ?? 1));
  query.set('pageSize', String(params.pageSize ?? 50));
  return request<ListResponse<ApiOrderRow>>(`/api/orders?${query.toString()}`);
}

export function getOrderDetail(id: number | string) { return request<ApiOrderDetail>(`/api/orders/${id}/detail`); }
export function getNextOrderNumber() { return request<{ number: string; date: string }>('/api/orders/next-number'); }
export function getOrderItemImages(orderId: number | string) {
  return request<{ itemImages: Record<number, Array<{ url: string; name: string; mimeType: string }>> }>(`/api/orders/${orderId}/items-images`);
}

export function saveOrder(draft: OrderDraft) {
  const input = { method: draft.id ? 'PUT' : 'POST', body: JSON.stringify(draftToInput(draft)) } as const;
  return request<ApiOrderDetail>(draft.id ? `/api/orders/${draft.id}` : '/api/orders', input);
}

/** 发布草稿订单：draft → pending_stock，进入正式流程。 */
export function publishOrder(id: number | string) {
  return request<ApiOrderDetail>(`/api/orders/${id}/publish`, { method: 'POST' });
}

export function deleteOrder(id: number | string) {
  return request<null>(`/api/orders/${id}`, { method: 'DELETE' });
}

export async function uploadOrderDetailImage(orderId: number | string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<ApiOrderDetailImage>(`/api/orders/${orderId}/detail-images`, { method: 'POST', body: form });
}

export function deleteOrderDetailImage(id: number | string) {
  return request<null>(`/api/order-detail-images/${id}`, { method: 'DELETE' });
}

export async function uploadOrderContract(orderId: number | string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<ApiOrderContract>(`/api/orders/${orderId}/contracts`, { method: 'POST', body: form });
}

export function getOrderContracts(orderId: number | string) {
  return request<ApiOrderContract[] | { contracts?: ApiOrderContract[]; items?: ApiOrderContract[] }>(`/api/orders/${orderId}/contracts`)
    .then((result) => Array.isArray(result) ? result : result.contracts ?? result.items ?? []);
}

export function deleteOrderContract(id: number | string) {
  return request<null>(`/api/order-contracts/${id}`, { method: 'DELETE' });
}

export function generateOrderContractPdf(orderId: number | string) {
  return requestBlob(`/api/orders/${orderId}/contracts/generate`, { method: 'POST' });
}

export function advanceOrderStatus(id: number | string, to: OrderStatus, reason: 'manual' | 'first-print' = 'manual') { return request(`/api/orders/${id}/status`, { method: 'POST', body: JSON.stringify({ to, reason }) }); }

export function getProducts(q = '') { return request<{ items?: ProductApiRecord[]; rows?: ProductApiRecord[] }>(`/api/products?q=${encodeURIComponent(q)}`).then((result) => (result.items ?? result.rows ?? []).map(mapProductRecord)); }
export function exportProducts() { return requestBlob('/api/products/export'); }
export function downloadProductImportTemplate() { return requestBlob('/api/products/import-template'); }
export async function importProducts(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<{ total: number; created: number; updated: number }>('/api/products/import', { method: 'POST', body: form });
}

export function getCustomers(includeInactive = false, q = '') {
  const query = new URLSearchParams({ includeInactive: includeInactive ? '1' : '0' });
  if (q.trim()) query.set('q', q.trim());
  return request<{ items: Customer[] }>(`/api/customers?${query.toString()}`).then((result) => result.items);
}

export function getCustomer(id: number) {
  return request<Customer>(`/api/customers/${id}`);
}

export function createCustomer(input: CustomerSaveInput) {
  return request<Customer>('/api/customers', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCustomer(id: number, input: CustomerSaveInput) {
  return request<Customer>(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function setCustomerActive(id: number, isActive: boolean) {
  return request<Customer>(`/api/customers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
}

export function deleteCustomer(id: number) {
  return request<null>(`/api/customers/${id}`, { method: 'DELETE' });
}

export function getCustomerProducts(customerId: number, filters: CustomerProductListFilters = {}) {
  const query = new URLSearchParams();
  if (filters.search?.trim()) query.set('q', filters.search.trim());
  if (filters.status && filters.status !== 'all') query.set('status', filters.status);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return request<{ items: SharedCustomerProduct[] }>(`/api/customers/${customerId}/products${suffix}`)
    .then((result) => result.items.map(mapCustomerProduct));
}

function packagingPayload(packaging: CustomerProductPackaging[] | undefined) {
  return (packaging ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    innerSize: item.innerSize,
    innerWeight: Number(item.innerWeight) || 0,
    outerSize: item.outerSize,
    outerWeight: Number(item.outerWeight) || 0,
    packCount: Math.max(1, Math.trunc(Number(item.packCount) || 1)),
  }));
}

function customerProductInput(product: CustomerProductSaveInput) {
  return {
    ...(product.systemProductId === undefined ? {} : { systemProductId: product.systemProductId }),
    name: product.name.trim(),
    supplierProductName: (product.supplierProductName ?? '').trim(),
    specification: product.specification.trim(),
    sku: product.sku.trim(),
    packCount: product.packCount,
    finalPriceCents: product.finalPriceCents,
    costPriceCents: product.costPriceCents ?? null,
    freightPerBoxCents: product.freightPerBoxCents ?? null,
    remark: product.remark ?? '',
    packaging: packagingPayload(product.packaging),
    ...(product.imageRelativePath === undefined ? {} : { imageRelativePath: product.imageRelativePath }),
  };
}

export function saveCustomerProduct(customerId: number, product: CustomerProductSaveInput) {
  return request<SharedCustomerProduct>(`/api/customers/${customerId}/products`, { method: 'POST', body: JSON.stringify(customerProductInput(product)) })
    .then(mapCustomerProduct);
}

export function saveCustomerProductsBatch(customerId: number, input: CustomerProductBatchSaveInput) {
  return request<{ items: SharedCustomerProduct[] }>(`/api/customers/${customerId}/products/batch`, {
    method: 'POST',
    body: JSON.stringify({
      items: input.items.map((item) => ({
        name: item.name.trim(),
        specification: (item.specification ?? '').trim(),
        sku: (item.sku ?? '').trim(),
      })),
      packCount: input.packCount,
      finalPriceCents: input.finalPriceCents,
      costPriceCents: input.costPriceCents ?? null,
      freightPerBoxCents: input.freightPerBoxCents ?? null,
      remark: input.remark ?? '',
      packaging: packagingPayload(input.packaging),
    }),
  }).then((result) => result.items.map(mapCustomerProduct));
}

export function importCustomerProduct(customerId: number, systemProductId: number) {
  return request<SharedCustomerProduct>(`/api/customers/${customerId}/products/from-library`, { method: 'POST', body: JSON.stringify({ systemProductId }) })
    .then(mapCustomerProduct);
}

export function importCustomerProductWithInput(customerId: number, systemProductId: number, product: CustomerProductSaveInput) {
  return request<SharedCustomerProduct>(`/api/customers/${customerId}/products/from-library/complete`, {
    method: 'POST',
    body: JSON.stringify({ systemProductId, ...customerProductInput(product) }),
  }).then(mapCustomerProduct);
}

export async function uploadCustomerProductImage(id: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<SharedCustomerProduct>(`/api/customer-products/${id}/images`, { method: 'POST', body: form }).then(mapCustomerProduct);
}

export function deleteCustomerProductImage(id: number) {
  return request<SharedCustomerProduct | null>(`/api/customer-products/${id}/images`, { method: 'DELETE' }).then((value) => value ? mapCustomerProduct(value) : value);
}

export async function uploadCustomerProductAttachment(id: number, file: File, category: string) {
  const form = new FormData();
  form.append('file', file);
  return request<CustomerProductAttachment>(`/api/customer-products/${id}/attachments?category=${encodeURIComponent(category)}`, { method: 'POST', body: form });
}

export function deleteCustomerProductAttachment(id: number, attachmentId: number) {
  return request<null>(`/api/customer-products/${id}/attachments/${attachmentId}`, { method: 'DELETE' });
}

export function updateCustomerProductAttachmentCategory(id: number, attachmentId: number, category: string) {
  return request<CustomerProductAttachment>(`/api/customer-products/${id}/attachments/${attachmentId}`, { method: 'PATCH', body: JSON.stringify({ category }) });
}

export function updateCustomerProduct(id: number, product: CustomerProductSaveInput) {
  return request<SharedCustomerProduct>(`/api/customer-products/${id}`, { method: 'PUT', body: JSON.stringify(customerProductInput(product)) })
    .then(mapCustomerProduct);
}

export function deleteCustomerProduct(id: number) {
  return request<null>(`/api/customer-products/${id}`, { method: 'DELETE' });
}

export function deleteCustomerProducts(customerId: number, ids: number[]) {
  return request<{ deletedCount: number }>(`/api/customers/${customerId}/products/batch-delete`, { method: 'POST', body: JSON.stringify({ ids }) });
}

/** 备货模块补关联：建立客户产品与系统产品的映射并写入报供名称；systemProductId 传 null 表示清除映射。 */
export function linkCustomerProductToSystem(id: number | string, systemProductId: number | null, supplierProductName: string) {
  return request<SharedCustomerProduct>(`/api/customer-products/${id}/link`, { method: 'POST', body: JSON.stringify({ systemProductId, supplierProductName }) })
    .then(mapCustomerProduct);
}

export function getStockPreparation(date: string | 'all') {
  return request<StockPreparation>(`/api/stock/preparation?date=${encodeURIComponent(date)}`);
}

export function exportStockPreparation(date: string | 'all') {
  return requestBlob(`/api/stock/preparation/export?date=${encodeURIComponent(date)}`);
}

function parseDimensionTriplet(value: string) {
  const values = value.match(/[0-9]+(?:\.[0-9]+)?/g)?.map(Number) ?? [];
  return values.length === 3 ? values : [0, 0, 0];
}
function packagingToInput(row: PackagingOption) {
  const [outerLength, outerWidth, outerHeight] = parseDimensionTriplet(row.outerSize || `${row.length ?? ''}×${row.width ?? ''}×${row.height ?? ''}`);
  const id = /^\d+$/.test(row.id) ? Number(row.id) : undefined;
  const imageIds = (row.images ?? []).filter((image) => !image.file && /^\d+$/.test(image.id)).map((image) => Number(image.id));
  return { id, imageIds, name: row.name.trim(), innerSize: row.innerSize.trim(), innerWeight: Math.max(0, Number(row.innerWeight || 0)), outerSize: row.outerSize.trim(), outerWeight: Math.max(0, Number(row.outerWeight || 0)), packCount: Math.max(1, Math.trunc(row.packSize)), purchasePrice: row.purchasePrice.trim() ? Math.max(0, Number(row.purchasePrice)) : null, outerLength, outerWidth, outerHeight };
}
export function productToInput(product: ProductRecord) { return { name: product.name.trim(), sku: product.sku.trim(), specification: product.specification.trim(), parameters: product.parameters ?? '', category: product.category, purchasePrice: Number(product.purchasePrice || 0), supplier: product.supplier, colors: product.colors, batteryPlugs: product.batteryPlugs, accessories: product.accessories, remark: product.remark, status: product.status === 'draft' ? 'draft' : 'active', packaging: product.packaging.map(packagingToInput) }; }
export function saveProduct(product: ProductRecord) { return request<ProductApiRecord>('/api/products', { method: 'POST', body: JSON.stringify(productToInput(product)) }); }
export function updateProduct(id: string, product: ProductRecord) { return request<ProductApiRecord>(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(productToInput(product)) }); }
export function deleteProduct(id: string) { return request(`/api/products/${id}`, { method: 'DELETE' }); }
export async function uploadProductAttachment(productId: string, file: File, category: string) {
  const form = new FormData();
  form.append('file', file);
  return request<ProductAttachmentApiRecord>(`/api/products/${productId}/attachments?category=${encodeURIComponent(category)}`, { method: 'POST', body: form });
}
export function updateProductAttachmentCategory(productId: string, attachmentId: string, category: string) {
  return request<ProductAttachmentApiRecord>(`/api/products/${productId}/attachments/${attachmentId}`, { method: 'PATCH', body: JSON.stringify({ category }) });
}
export function deleteProductAttachment(productId: string, attachmentId: string) {
  return request<null>(`/api/products/${productId}/attachments/${attachmentId}`, { method: 'DELETE' });
}
export async function uploadProductImage(id: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<ProductImageApiRecord>(`/api/products/${id}/images`, { method: 'POST', body: form });
}
export function deleteProductImage(productId: string, imageId: string) { return request(`/api/products/${productId}/images/${imageId}`, { method: 'DELETE' }); }
export function reorderProductImages(productId: string, imageIds: number[]) { return request<null>(`/api/products/${productId}/images/order`, { method: 'PUT', body: JSON.stringify({ imageIds }) }); }
export async function uploadProductPackagingImage(productId: string, packagingId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return request(`/api/products/${productId}/packaging/${packagingId}/images`, { method: 'POST', body: form });
}
export function deleteProductPackagingImage(productId: string, packagingId: string, imageId: string) {
  return request(`/api/products/${productId}/packaging/${packagingId}/images/${imageId}`, { method: 'DELETE' });
}
export function getLabels(orderId: number | string) { return request<{ labels: Array<Record<string, unknown>> }>(`/api/orders/${orderId}/labels`); }
export function mergeLabels(orderId: number | string, labelIds: Array<number | string>) {
  return request<{ labels: Array<Record<string, unknown>> }>('/api/carton-labels/merge', {
    method: 'POST',
    body: JSON.stringify({ orderId: Number(orderId), labelIds: labelIds.map(Number) }),
  });
}
export function saveLabels(orderId: number | string, labels: unknown[]) {
  const normalized = labels.map((raw) => {
    const label = raw as Record<string, unknown>;
    const lines = Array.isArray(label.lines) ? label.lines : Array.isArray(label.items) ? label.items : [];
    return {
      boxNo: Number(label.cartonNo ?? label.boxNo ?? 0),
      manualEdited: Boolean(label.manuallyEdited ?? label.manualEdited),
      items: lines.map((rawLine) => {
        const line = rawLine as Record<string, unknown>;
        return { orderItemId: line.orderItemId == null ? null : Number(line.orderItemId), name: String(line.name ?? line.productName ?? ''), sku: String(line.sku ?? ''), specification: String(line.specification ?? line.spec ?? ''), packCount: Number(line.packSize ?? line.packCount ?? 1), boxCount: Number(line.boxCount ?? 1), totalCount: Number(line.quantity ?? line.totalCount ?? 0), remark: String(line.remark ?? '') };
      }),
    };
  });
  return request(`/api/orders/${orderId}/labels`, { method: 'PUT', body: JSON.stringify({ labels: normalized }) });
}
export function recordPrintHistory(orderIds: number[], labels: unknown[], actionType: 'print' | 'first-print' = 'print') { return request('/api/labels/print-history', { method: 'POST', body: JSON.stringify({ orderIds, labels, actionType }) }); }

export interface ShippingBatch { id: number; batchNo: string; status: string; orderIds: number[]; text: string; }
export function getEligibleOrders() { return request<{ rows: ApiOrderRow[] }>('/api/shipping/eligible-orders'); }
export function createShippingBatch(orderIds: number[]) { return request<ShippingBatch>('/api/shipping/batches', { method: 'POST', body: JSON.stringify({ orderIds }) }); }
export function updateShippingTracking(batchId: number, orderId: number, trackingNo: string) { return request(`/api/shipping/batches/${batchId}/orders/${orderId}`, { method: 'PUT', body: JSON.stringify({ trackingNo }) }); }
export function getShippingBatchText(batchId: number) { return request<{ text: string }>(`/api/shipping/batches/${batchId}/text`); }
export function confirmShippingBatch(batchId: number) { return request(`/api/shipping/batches/${batchId}/confirm`, { method: 'POST' }); }

export async function uploadPaymentProof(orderId: number | string, file: File, note = '') {
  const form = new FormData();
  form.append('file', file);
  form.append('note', note);
  return request(`/api/orders/${orderId}/payment-proofs`, { method: 'POST', body: form });
}
export function deletePaymentProof(id: number | string) { return request(`/api/payment-proofs/${id}`, { method: 'DELETE' }); }

export interface ApiFinanceDetail {
  order: Record<string, unknown>;
  finance: OrderFinanceSummary;
  proofs: Array<PaymentProofRecord & { url: string }>;
  receipts: FinanceReceipt[];
  invoices: Array<FinanceInvoice & { files: Array<FinanceInvoiceFile & { url: string }> }>;
}

export interface FinanceListParams extends FinanceListFilters {
  q?: string;
}

export function listFinanceOrders(params: FinanceListParams = {}) {
  const query = new URLSearchParams();
  const values = { ...params, query: params.q ?? params.query };
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '' && key !== 'q') query.set(key, String(value));
  });
  return request<FinanceListResult>(`/api/finance/orders?${query.toString()}`);
}

export function getOrderFinance(orderId: number | string) {
  return request<ApiFinanceDetail>(`/api/finance/orders/${orderId}`);
}

export async function uploadFinanceProof(orderId: number | string, file: File, input: { paymentDate?: string; amountCents?: number; paymentMethod?: string; payerName?: string; transactionNo?: string; note?: string }) {
  const form = new FormData();
  form.append('file', file);
  Object.entries(input).forEach(([key, value]) => { if (value !== undefined) form.append(key, String(value)); });
  return request<PaymentProofRecord & { url: string }>(`/api/finance/orders/${orderId}/proofs`, { method: 'POST', body: form });
}

export function updateFinanceProof(id: number, input: Record<string, unknown>) { return request<PaymentProofRecord & { url: string }>(`/api/finance/proofs/${id}`, { method: 'PUT', body: JSON.stringify(input) }); }
export function approveFinanceProof(id: number, payeeName = '') { return request<ApiFinanceDetail>(`/api/finance/proofs/${id}/approve`, { method: 'POST', body: JSON.stringify({ payeeName }) }); }
export function listReceivedByPayee(month?: string) { return request<{ items: PayeeBreakdownRow[] }>(`/api/finance/receipts/by-payee${month ? `?month=${encodeURIComponent(month)}` : ''}`); }
export function rejectFinanceProof(id: number, note: string) { return request<ApiFinanceDetail>(`/api/finance/proofs/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) }); }
export function voidFinanceProof(id: number, note: string) { return request<ApiFinanceDetail>(`/api/finance/proofs/${id}/void`, { method: 'POST', body: JSON.stringify({ note }) }); }
export function deleteFinanceProof(id: number) { return request<PaymentProofRecord>(`/api/finance/proofs/${id}`, { method: 'DELETE' }); }
export function createFinanceInvoice(orderId: number, input: Record<string, unknown>) { return request<FinanceInvoice>(`/api/finance/orders/${orderId}/invoices`, { method: 'POST', body: JSON.stringify(input) }); }
export function updateFinanceInvoice(id: number, input: Record<string, unknown>) { return request<FinanceInvoice>(`/api/finance/invoices/${id}`, { method: 'PUT', body: JSON.stringify(input) }); }
export function submitFinanceInvoice(id: number) { return request<FinanceInvoice>(`/api/finance/invoices/${id}/submit`, { method: 'POST', body: JSON.stringify({}) }); }
export function issueFinanceInvoice(id: number, input: Record<string, unknown>) { return request<FinanceInvoice>(`/api/finance/invoices/${id}/issue`, { method: 'POST', body: JSON.stringify(input) }); }
export function sendFinanceInvoice(id: number) { return request<FinanceInvoice>(`/api/finance/invoices/${id}/send`, { method: 'POST', body: JSON.stringify({}) }); }
export function voidFinanceInvoice(id: number, note: string) { return request<FinanceInvoice>(`/api/finance/invoices/${id}/void`, { method: 'POST', body: JSON.stringify({ note }) }); }
export async function uploadFinanceInvoiceFile(id: number, file: File) {
  const form = new FormData(); form.append('file', file);
  return request<FinanceInvoiceFile & { url: string }>(`/api/finance/invoices/${id}/files`, { method: 'POST', body: form });
}
export function deleteFinanceInvoiceFile(id: number) { return request<FinanceInvoiceFile>(`/api/finance/invoice-files/${id}`, { method: 'DELETE' }); }

export interface BackupResult {
  fileName: string;
  createdAt: string;
  recordCounts: Record<string, number>;
  downloadUrl: string;
}

export function getServiceVersion() {
  return request<{ status: string; version: string; buildTime: string | null; gitCommit: string | null; mode: 'production' | 'development' }>('/health');
}

export function createBackup() { return request<BackupResult>('/api/backups', { method: 'POST' }); }

export interface AutoBackupFileInfo {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface AutoBackupSettings {
  directory: string;
  keepCount: number;
}

export interface AutoBackupStatus {
  enabled: boolean;
  running: boolean;
  todayDone: boolean;
  lastBackupAt: string | null;
  lastResult: 'success' | 'failed' | null;
  lastError: string | null;
  keepCount: number;
  directory: string;
  files: AutoBackupFileInfo[];
}

export function getAutoBackupStatus() { return request<AutoBackupStatus>('/api/backups/auto/status'); }
export function runAutoBackupNow() { return request<BackupResult & { createdAt: string }>('/api/backups/auto/run', { method: 'POST' }); }
export function getAutoBackupSettings() { return request<AutoBackupSettings>('/api/backups/auto/settings'); }
export function updateAutoBackupSettings(input: Partial<AutoBackupSettings>) { return request<AutoBackupSettings>('/api/backups/auto/settings', { method: 'PUT', body: JSON.stringify(input) }); }
export async function previewBackup(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<{ formatVersion: number; createdAt: string; recordCounts: Record<string, number>; attachments: string[] }>('/api/backups/preview', { method: 'POST', body: form });
}
export async function restoreBackup(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<{ restoredAt: string; safetyBackup: BackupResult }>('/api/backups/restore', { method: 'POST', body: form });
}

export interface QuotationListParams {
  status?: 'all' | QuotationStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface SalesDocumentListParams {
  documentStatus?: 'all' | SalesDocumentStatus;
  paymentStatus?: 'all' | PaymentStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

type DocumentSaveBody = FormData | QuotationSaveInput | SalesDocumentSaveInput | Record<string, unknown>;

function documentRequestBody(body: DocumentSaveBody): BodyInit {
  return body instanceof FormData ? body : JSON.stringify(body);
}

function appendListParams(
  params: { q?: string; page?: number; pageSize?: number },
  query = new URLSearchParams(),
): URLSearchParams {
  if (params.q?.trim()) query.set('q', params.q.trim());
  query.set('page', String(params.page ?? 1));
  query.set('pageSize', String(params.pageSize ?? 50));
  return query;
}

export function listQuotations(params: QuotationListParams = {}) {
  const query = new URLSearchParams();
  if (params.status && params.status !== 'all') query.set('status', params.status);
  appendListParams(params, query);
  return request<ListResponse<QuotationSummary>>(`/api/quotations?${query.toString()}`);
}

export function getQuotation(id: number | string) {
  return request<QuotationDetail>(`/api/quotations/${id}`);
}

export function createQuotation(input: FormData | QuotationSaveInput | Record<string, unknown>) {
  return request<QuotationDetail>('/api/quotations', { method: 'POST', body: documentRequestBody(input) });
}

export function updateQuotation(id: number | string, input: FormData | QuotationSaveInput | Record<string, unknown>) {
  return request<QuotationDetail>(`/api/quotations/${id}`, { method: 'PUT', body: documentRequestBody(input) });
}

export function saveQuotation(input: FormData | QuotationSaveInput | Record<string, unknown>, id?: number | string) {
  return id == null ? createQuotation(input) : updateQuotation(id, input);
}

export function deleteQuotation(id: number | string, confirmed = false) {
  return request<null>(`/api/quotations/${id}`, { method: 'DELETE', body: JSON.stringify({ confirmed }) });
}

export function setQuotationStatus(id: number | string, status: QuotationStatus) {
  return request<QuotationDetail>(`/api/quotations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export function downloadQuotationPdf(id: number | string) {
  return requestBlob(`/api/quotations/${id}/pdf`);
}

export function copyQuotationToSales(id: number | string) {
  return request<SalesDocumentDetail>(`/api/quotations/${id}/copy-to-sales`, { method: 'POST' });
}

export function previewQuotationCustomerProductSync(quotationId: number) {
  return request<QuotationCustomerProductSyncPreview>(`/api/quotations/${quotationId}/customer-products/preview`, { method: 'POST' });
}

export function syncQuotationCustomerProducts(quotationId: number, quotationItemIds?: number[]) {
  return request<QuotationCustomerProductSyncResult>(`/api/quotations/${quotationId}/customer-products/sync`, {
    method: 'POST',
    body: JSON.stringify(quotationItemIds === undefined ? {} : { quotationItemIds }),
  });
}

export function listSalesDocuments(params: SalesDocumentListParams = {}) {
  const query = new URLSearchParams();
  if (params.documentStatus && params.documentStatus !== 'all') query.set('documentStatus', params.documentStatus);
  if (params.paymentStatus && params.paymentStatus !== 'all') query.set('paymentStatus', params.paymentStatus);
  appendListParams(params, query);
  return request<ListResponse<SalesDocumentSummary>>(`/api/sales-documents?${query.toString()}`);
}

export function getSalesDocument(id: number | string) {
  return request<SalesDocumentDetail>(`/api/sales-documents/${id}`);
}

export function createSalesDocument(input: FormData | SalesDocumentSaveInput | Record<string, unknown>) {
  return request<SalesDocumentDetail>('/api/sales-documents', { method: 'POST', body: documentRequestBody(input) });
}

export function updateSalesDocument(id: number | string, input: FormData | SalesDocumentSaveInput | Record<string, unknown>) {
  return request<SalesDocumentDetail>(`/api/sales-documents/${id}`, { method: 'PUT', body: documentRequestBody(input) });
}

export function saveSalesDocument(input: FormData | SalesDocumentSaveInput | Record<string, unknown>, id?: number | string) {
  return id == null ? createSalesDocument(input) : updateSalesDocument(id, input);
}

export function deleteSalesDocument(id: number | string, confirmed = false) {
  return request<null>(`/api/sales-documents/${id}`, { method: 'DELETE', body: JSON.stringify({ confirmed }) });
}

export function setSalesDocumentStatus(id: number | string, status: SalesDocumentStatus) {
  return request<SalesDocumentDetail>(`/api/sales-documents/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export interface GeneratedOrderResult {
  id: number;
  orderNo: string;
  amountCents: number;
  shippingCents: number;
}

export async function createOrderFromSalesDocument(id: number | string): Promise<GeneratedOrderResult> {
  const detail = await request<Record<string, unknown>>(`/api/sales-documents/${id}/create-order`, { method: 'POST' });
  return {
    id: Number(detail.id),
    orderNo: String(detail.order_no ?? ''),
    amountCents: Number(detail.amount_cents ?? 0),
    shippingCents: Number(detail.shipping_cents ?? 0),
  };
}

export function downloadSalesDocumentPdf(id: number | string) {
  return requestBlob(`/api/sales-documents/${id}/pdf`);
}

export function addSalesReceipt(documentId: number | string, input: SalesReceiptInput) {
  return request<SalesReceipt>(`/api/sales-documents/${documentId}/receipts`, { method: 'POST', body: JSON.stringify(input) });
}

export function updateSalesReceipt(id: number | string, input: SalesReceiptInput) {
  return request<SalesReceipt>(`/api/sales-receipts/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteSalesReceipt(id: number | string) {
  return request<null>(`/api/sales-receipts/${id}`, { method: 'DELETE' });
}

export async function uploadSalesReceiptFile(receiptId: number | string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<SalesReceiptFile>(`/api/sales-receipts/${receiptId}/files`, { method: 'POST', body: form });
}

export function deleteSalesReceiptFile(id: number | string) {
  return request<null>(`/api/sales-receipt-files/${id}`, { method: 'DELETE' });
}

export function getCompanyProfile() {
  return request<CompanySnapshot>('/api/settings/company-profile');
}

export function updateCompanyProfile(profile: Partial<CompanySnapshot>) {
  const { logoRelativePath: _ignored, ...editable } = profile;
  return request<CompanySnapshot>('/api/settings/company-profile', { method: 'PUT', body: JSON.stringify(editable) });
}

export async function uploadCompanyLogo(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<CompanySnapshot>('/api/settings/company-profile/logo', { method: 'POST', body: form });
}

export function deleteCompanyLogo() {
  return request<CompanySnapshot>('/api/settings/company-profile/logo', { method: 'DELETE' });
}

export function getDocumentCustomerSuggestions(q = '') {
  return request<{ items: DocumentCustomerSuggestion[] }>(`/api/document-customers/suggestions?q=${encodeURIComponent(q.trim())}`)
    .then((result) => result.items);
}

export const getQuotationDetail = getQuotation;
export const getSalesDocumentDetail = getSalesDocument;
export const getCustomerSuggestions = getDocumentCustomerSuggestions;
export const uploadSalesReceiptProof = uploadSalesReceiptFile;
export const deleteSalesReceiptProof = deleteSalesReceiptFile;
