import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanySnapshot } from '../shared/documents';
import Sidebar, { navigationKeys, type NavigationKey } from './components/Sidebar';
import MobileTabBar from './components/MobileTabBar';
import Toast, { type ToastMessage } from './components/Toast';
import LoginGate from './components/LoginGate';
import type { CartonLabel } from './components/LabelEditorModal';
import type { OrderContractDraft, OrderDraft, OrderItemDraft, OrderStatus } from './components/OrderForm';
import type { ProductRecord } from './components/ProductEditor';
import type { Customer } from '../shared/customers';
import OrdersPage, { fallbackLabels } from './pages/OrdersPage';
import { getBatchAdvancePlan, type BatchAdvanceAction } from './order-workflow';
import ProductsPage from './pages/ProductsPage';
import CustomerProductsPage from './pages/CustomerProductsPage';
import ShippingPage from './pages/ShippingPage';
import SettingsPage from './pages/SettingsPage';
import QuotationPage from './pages/QuotationPage';
import SalesDocumentsPage from './pages/SalesDocumentsPage';
import FinancePage from './pages/FinancePage';
import {
  AUTH_REQUIRED_EVENT,
  advanceOrderStatus,
  createBackup,
  deleteProduct,
  exportProducts,
  downloadProductImportTemplate,
  getAuthStatus,
  getCustomers,
  getCompanyProfile,
  createCustomer,
  getOrderDetail,
  getNextOrderNumber,
  getOrders,
  getProducts,
  mergeLabels,
  mapProductRecord,
  recordPrintHistory,
  restoreBackup,
  saveLabels,
  saveOrder,
  saveCustomerProduct,
  saveProduct,
  deleteOrderContract,
  generateOrderContractPdf,
  deleteOrder,
  previewBackup,
  publishOrder,
  uploadPaymentProof,
  uploadOrderContract,
  uploadOrderDetailImage,
  uploadProductImage,
  deleteProductImage,
  reorderProductImages,
  uploadProductPackagingImage,
  uploadProductAttachment,
  updateProductAttachmentCategory,
  deleteProductAttachment,
  updateProduct,
  importProducts,
  createShippingBatch,
  updateShippingTracking,
  confirmShippingBatch,
} from './api';
import type { ApiOrderDetail, ApiOrderRow } from './api';

function createId(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mapOrderItem(row: Record<string, unknown>): OrderItemDraft {
  const quantity = Math.max(1, Math.trunc(asNumber(row.quantity ?? row.total_count, 1)));
  const packSize = Math.max(1, Math.trunc(asNumber(row.pack_count ?? row.packCount, 1)));
  const customerProductId = row.customer_product_id == null ? undefined : Number(row.customer_product_id);
  const unitPriceCents = Math.max(0, Math.trunc(asNumber(row.unit_price_cents ?? row.unitPriceCents, 0)));
  const amountCents = Math.max(0, Math.trunc(asNumber(row.amount_cents ?? row.amountCents, quantity * unitPriceCents)));
  const rawPackaging = Array.isArray(row.packaging) ? row.packaging : [];
  const packaging = rawPackaging.map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      id: String(item.id ?? createId('packaging')),
      name: String(item.name ?? ''),
      innerSize: String(item.innerSize ?? ''),
      innerWeight: String(item.innerWeight ?? ''),
      outerSize: String(item.outerSize ?? ''),
      outerWeight: String(item.outerWeight ?? ''),
      packSize: Math.max(1, Math.trunc(asNumber(item.packCount ?? item.pack_count, packSize))),
      purchasePrice: '',
      length: String(item.outerLength ?? item.outer_length ?? ''),
      width: String(item.outerWidth ?? item.outer_width ?? ''),
      height: String(item.outerHeight ?? item.outer_height ?? ''),
    };
  });
  const rawRequirementAttachments = Array.isArray(row.requirementAttachments) ? row.requirementAttachments : [];
  return { id: String(row.id ?? createId('item')), customerProductId, productId: customerProductId == null ? undefined : String(customerProductId), name: String(row.name ?? row.product_name ?? ''), sku: String(row.sku ?? ''), specification: String(row.specification ?? row.spec ?? ''), quantity, packSize, boxes: Math.ceil(quantity / packSize), unitPriceCents, amountCents, freightPerBoxCents: Math.max(0, Math.trunc(asNumber(row.freight_per_box_cents ?? row.freightPerBoxCents, 0))), remark: String(row.remark ?? ''), customerProductAttachments: rawRequirementAttachments.map((raw) => { const item = raw as Record<string, unknown>; const relativePath = String(item.relative_path ?? item.relativePath ?? ''); return { id: Number(item.id), customerProductId: customerProductId ?? 0, relativePath, originalName: String(item.original_name ?? item.originalName ?? '客户产品资料'), mimeType: String(item.mime_type ?? item.mimeType ?? ''), size: asNumber(item.size ?? item.size_bytes), createdAt: String(item.created_at ?? item.createdAt ?? ''), url: String(item.url ?? (relativePath ? `/files/${relativePath}` : '')), category: (['label', 'instruction', 'packaging', 'other'].includes(String(item.category)) ? String(item.category) : 'other') as import('../shared/customers').CustomerProductAttachmentCategory }; }), packaging };
}

function mapOrderDetail(row: ApiOrderDetail | ApiOrderRow): OrderDraft {
  const raw = row as unknown as Record<string, unknown>;
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const rawContracts = Array.isArray(raw.contracts) ? raw.contracts : [];
  const rawDetailImages = Array.isArray(raw.orderDetailImages) ? raw.orderDetailImages : Array.isArray(raw.order_detail_images) ? raw.order_detail_images : [];
  const mappedContracts = rawContracts.map((contract): OrderContractDraft => { const item = contract as Record<string, unknown>; const relativePath = String(item.relative_path ?? item.relativePath ?? ''); return { id: String(item.id), name: String(item.original_name ?? item.originalName ?? '订单附件'), url: String(item.url ?? (relativePath ? `/files/${relativePath}` : '')), mimeType: String(item.mime_type ?? item.mimeType ?? ''), size: asNumber(item.size ?? item.size_bytes), createdAt: String(item.created_at ?? item.createdAt ?? ''), category: String(item.category ?? 'other'), sourceCustomerProductId: item.source_customer_product_id == null ? null : Number(item.source_customer_product_id) }; });
  const rawFinance = (raw.financeSummary ?? raw.finance_summary) as Record<string, unknown> | null | undefined;
  return {
      id: String(raw.id), orderNo: String(raw.order_no ?? ''), orderedAt: String(raw.ordered_at ?? '').slice(0, 10), customerId: raw.customer_id == null ? null : Number(raw.customer_id), customerName: String(raw.customer_name ?? ''), customerContactName: String(raw.customer_contact_name ?? ''), customerContactPhone: String(raw.customer_contact_phone ?? ''), customerShippingInfo: String(raw.customer_shipping_info ?? ''), settlementType: raw.settlement_type === 'personal' ? 'personal' : 'corporate', orderDetail: String(raw.order_detail ?? raw.orderDetail ?? ''), orderDetailImages: rawDetailImages.map((image) => { const item = image as Record<string, unknown>; const relativePath = String(item.relative_path ?? item.relativePath ?? ''); return { id: String(item.id), name: String(item.original_name ?? item.originalName ?? '订单详情图片'), url: String(item.url ?? (relativePath ? `/files/${relativePath}` : '')), mimeType: String(item.mime_type ?? item.mimeType ?? ''), size: asNumber(item.size ?? item.size_bytes) }; }), recipientName: String(raw.recipient_name ?? ''), recipientInfo: String(raw.recipient_info ?? ''), amount: asNumber(raw.amount).toFixed(2), shippingCents: Math.max(0, Math.trunc(asNumber(raw.shipping_cents ?? raw.shippingCents))), trackingNo: String(raw.tracking_no ?? ''), paymentNote: String(raw.payment_note ?? raw.paymentNote ?? ''), paymentProofs: (Array.isArray(raw.paymentProofs) ? raw.paymentProofs : Array.isArray(raw.payment_proofs) ? raw.payment_proofs : []).map((proof) => { const item = proof as Record<string, unknown>; const relativePath = String(item.relative_path ?? item.relativePath ?? ''); return { id: String(item.id), name: String(item.original_name ?? item.originalName ?? '付款凭证'), url: String(item.url ?? (relativePath ? `/files/${relativePath}` : '')), note: String(item.note ?? ''), mimeType: String(item.mime_type ?? item.mimeType ?? ''), size: asNumber(item.size ?? item.size_bytes), createdAt: String(item.created_at ?? item.createdAt ?? '') }; }), contracts: mappedContracts, labels: Array.isArray(raw.labels) ? raw.labels as Array<Record<string, unknown>> : [], remark: String(raw.remark ?? ''), items: rawItems.map((item) => mapOrderItem(item as Record<string, unknown>)), totalBoxes: Math.max(0, Math.trunc(asNumber(raw.total_boxes))), status: String(raw.status ?? 'pending_stock') as OrderStatus, labelPrintedAt: raw.label_printed_at == null ? undefined : String(raw.label_printed_at),
      financeSummary: rawFinance ? {
        orderId: Math.trunc(asNumber(rawFinance.orderId ?? rawFinance.order_id)),
        receivableCents: Math.max(0, Math.trunc(asNumber(rawFinance.receivableCents ?? rawFinance.receivable_cents))),
        receivedCents: Math.max(0, Math.trunc(asNumber(rawFinance.receivedCents ?? rawFinance.received_cents))),
        outstandingCents: Math.trunc(asNumber(rawFinance.outstandingCents ?? rawFinance.outstanding_cents)),
        paymentStatus: String(rawFinance.paymentStatus ?? rawFinance.payment_status ?? 'unpaid'),
        proofStatus: String(rawFinance.proofStatus ?? rawFinance.proof_status ?? 'none'),
        invoiceStatus: String(rawFinance.invoiceStatus ?? rawFinance.invoice_status ?? 'not_requested'),
        updatedAt: String(rawFinance.updatedAt ?? rawFinance.updated_at ?? ''),
      } as import('./../shared/finance').OrderFinanceLite : null,
  };
}

function labelFromApi(raw: Record<string, unknown>, order: OrderDraft): CartonLabel {
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const productTotals = new Map<string, number>();
  order.items.forEach((item) => {
    const key = `${item.name}\u0000${item.sku}\u0000${item.specification}`;
    productTotals.set(key, (productTotals.get(key) ?? 0) + Math.max(1, Math.trunc(item.quantity)));
  });
  return { id: String(raw.id), orderId: order.id ?? '', orderNo: order.orderNo, recipientName: order.recipientName, cartonNo: asNumber(raw.box_no ?? raw.boxNo, 1), totalCartons: asNumber(raw.total_boxes ?? raw.totalBoxes, 1), isTail: Boolean(raw.is_tail ?? raw.isTail) || rawItems.length > 1 || rawItems.some((rawLine) => { const line = rawLine as Record<string, unknown>; return asNumber(line.total_count ?? line.totalCount, 0) < asNumber(line.pack_count ?? line.packCount, 0); }), remark: String(raw.remark ?? ''), orderRemark: String(raw.order_remark ?? raw.orderRemark ?? order.orderDetail ?? ''), lines: rawItems.map((rawLine, index) => { const line = rawLine as Record<string, unknown>; const name = String(line.name ?? line.product_name ?? ''); const sku = String(line.sku ?? ''); const specification = String(line.specification ?? line.spec ?? ''); return { id: String(line.id ?? `${raw.id}-line-${index}`), orderItemId: line.order_item_id == null && line.orderItemId == null ? null : asNumber(line.order_item_id ?? line.orderItemId), sku, name, specification, packSize: Math.max(1, Math.trunc(asNumber(line.pack_count ?? line.packCount, 1))), quantity: Math.max(1, Math.trunc(asNumber(line.total_count ?? line.totalCount, 1))), boxCount: Math.max(1, Math.trunc(asNumber(line.box_count ?? line.boxCount, 1))), totalQuantity: productTotals.get(`${name}\u0000${sku}\u0000${specification}`) ?? Math.max(1, Math.trunc(asNumber(line.total_quantity ?? line.totalQuantity ?? line.total_count ?? line.totalCount, 1))), remark: String(line.remark ?? '') }; }) };
}

function orderKey(order: OrderDraft) { return order.id ?? order.orderNo; }

const ACTIVE_NAV_STORAGE_KEY = 'workbench:active-nav';

function initialActiveNav(): NavigationKey {
  try {
    const saved = window.localStorage.getItem(ACTIVE_NAV_STORAGE_KEY);
    if (saved && navigationKeys.includes(saved as NavigationKey)) return saved as NavigationKey;
  } catch { /* localStorage 不可用时回退到默认模块 */ }
  return 'orders';
}

export default function App() {
  const [active, setActive] = useState<NavigationKey>(initialActiveNav);
  const [orders, setOrders] = useState<OrderDraft[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanySnapshot>({ name: '', logoRelativePath: null, phone: '', address: '', defaultIssuer: '' });
  const [labelsByOrderId, setLabelsByOrderId] = useState<Record<string, CartonLabel[]>>({});
  const [statusCounts, setStatusCounts] = useState<Partial<Record<'all' | OrderStatus, number>>>({});
  const [customerProductsInitialCustomerId, setCustomerProductsInitialCustomerId] = useState<number | null>(null);
  const [shippingInitialOrder, setShippingInitialOrder] = useState<OrderDraft>();
  const [shippingInitialOrders, setShippingInitialOrders] = useState<OrderDraft[]>();
  const [financeInitialOrderId, setFinanceInitialOrderId] = useState<number>();
  const [ordersInitialOrderId, setOrdersInitialOrderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [authState, setAuthState] = useState<'checking' | 'open' | 'locked'>('checking');
  const [accessConfigured, setAccessConfigured] = useState(true);

  // 启动时先问一次会话状态：已设置密码且未登录则先展示登录门，避免后台请求齐刷刷 401。
  useEffect(() => {
    let cancelled = false;
    getAuthStatus()
      .then((status) => {
        if (cancelled) return;
        setAccessConfigured(status.configured);
        setAuthState(status.configured && !status.authenticated ? 'locked' : 'open');
      })
      .catch(() => { if (!cancelled) setAuthState('open'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = () => setAuthState('locked');
    window.addEventListener(AUTH_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handler);
  }, []);

  const navigate = useCallback((next: NavigationKey) => {
    // The customer id is a one-time hand-off from quotation sync. Clear it
    // when leaving the customer product page so a later manual visit does
    // not unexpectedly jump back to the last synced customer.
    if (next !== 'customer-products') setCustomerProductsInitialCustomerId(null);
    if (next !== 'shipping') setShippingInitialOrder(undefined);
    if (next !== 'finance') setFinanceInitialOrderId(undefined);
    if (next !== 'orders') setOrdersInitialOrderId(null);
    setActive(next);
    setMobileNavOpen(false);
    // 切换模块后回到列表顶部，避免手机上停留在上一个模块的滚动位置。
    document.querySelector('.app-content')?.scrollTo({ top: 0 });
    // 记住当前模块，浏览器刷新后仍停留在原页面。
    try { window.localStorage.setItem(ACTIVE_NAV_STORAGE_KEY, next); } catch { /* 忽略存储失败 */ }
  }, []);

  const notify = useCallback((message: string, kind: ToastMessage['kind'] = 'info') => {
    const id = createId('toast');
    setMessages((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setMessages((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);

  const loadProducts = useCallback(async (): Promise<boolean> => {
    try { setProducts(await getProducts()); return true; } catch (error) { notify((error as { message?: string }).message ?? '产品库加载失败', 'error'); return false; }
  }, [notify]);
  const loadCompanyProfile = useCallback(async () => {
    try { setCompanyProfile(await getCompanyProfile()); } catch { /* company branding is optional; keep the fallback */ }
  }, []);
  const loadCustomers = useCallback(async () => {
    try { setCustomers(await getCustomers(true)); } catch (error) { notify((error as { message?: string }).message ?? '客户档案加载失败', 'error'); }
  }, [notify]);
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getOrders({ pageSize: 200 });
      const details = await Promise.all(result.rows.map((row) => getOrderDetail(row.id).catch(() => row)));
      const mapped = details.map((row) => mapOrderDetail(row as ApiOrderDetail | ApiOrderRow));
      setOrders(mapped);
      const counts: Partial<Record<'all' | OrderStatus, number>> = { all: result.total };
      result.rows.forEach((row) => { const status = row.status; counts[status] = (counts[status] ?? 0) + 1; });
      setStatusCounts(counts);
      setLabelsByOrderId((current) => {
        const next = { ...current };
        details.forEach((row) => {
          const mappedOrder = mapOrderDetail(row as ApiOrderDetail | ApiOrderRow);
          const rawLabels = Array.isArray((row as ApiOrderDetail).labels) ? (row as ApiOrderDetail).labels : [];
          if (rawLabels.length) next[orderKey(mappedOrder)] = rawLabels.map((label) => labelFromApi(label as Record<string, unknown>, mappedOrder));
        });
        return next;
      });
    } catch (error) { notify((error as { message?: string }).message ?? '订单加载失败', 'error'); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => {
    if (authState !== 'open') return;
    void Promise.all([loadProducts(), loadCustomers(), loadOrders(), loadCompanyProfile()]);
  }, [authState, loadProducts, loadCustomers, loadOrders, loadCompanyProfile]);

  const saveProductRecord = async (draft: ProductRecord, mode: 'draft' | 'active') => {
    try {
      const isExisting = /^\d+$/.test(draft.id);
      const previousProduct = products.find((item) => item.id === draft.id);
      const payload: ProductRecord = { ...draft, status: mode === 'draft' ? 'draft' : 'active' };
      const saved = isExisting ? await updateProduct(draft.id, payload) : await saveProduct(payload);
      const savedProductId = String((saved as { id?: number }).id);
      if (isExisting) {
        const draftImageIds = new Set(draft.images.filter((item) => !item.file && /^\d+$/.test(item.id)).map((item) => item.id));
        for (const image of (products.find((item) => item.id === draft.id)?.images ?? [])) {
          if (/^\d+$/.test(image.id) && !draftImageIds.has(image.id)) await deleteProductImage(savedProductId, image.id);
        }
      }
      const orderedImageIds: number[] = [];
      for (const image of draft.images) {
        if (image.file) {
          const uploaded = await uploadProductImage(savedProductId, image.file);
          orderedImageIds.push(Number(uploaded.id));
        } else if (/^\d+$/.test(image.id)) {
          orderedImageIds.push(Number(image.id));
        }
      }
      if (orderedImageIds.length) await reorderProductImages(savedProductId, orderedImageIds);
      const savedPackaging = Array.isArray(saved.packaging) ? saved.packaging : [];
      for (const [index, packaging] of draft.packaging.entries()) {
        const packagingId = savedPackaging[index] && String((savedPackaging[index] as Record<string, unknown>).id ?? '');
        if (!packagingId) continue;
        for (const image of (packaging.images ?? []).filter((item) => item.file)) {
          await uploadProductPackagingImage(savedProductId, packagingId, image.file!);
        }
      }
      const previousAttachments = previousProduct?.attachments ?? [];
      const currentSavedAttachmentIds = new Set(
        draft.attachments.filter((item) => !item.file && /^\d+$/.test(item.id)).map((item) => item.id),
      );
      for (const attachment of previousAttachments) {
        if (/^\d+$/.test(attachment.id) && !currentSavedAttachmentIds.has(attachment.id)) {
          await deleteProductAttachment(savedProductId, attachment.id);
        }
      }
      for (const attachment of draft.attachments.filter((item) => item.file)) {
        await uploadProductAttachment(savedProductId, attachment.file!, attachment.category);
      }
      for (const attachment of draft.attachments.filter((item) => !item.file && /^\d+$/.test(item.id))) {
        const previous = previousAttachments.find((item) => item.id === attachment.id);
        if (previous && previous.category !== attachment.category) {
          await updateProductAttachmentCategory(savedProductId, attachment.id, attachment.category);
        }
      }
      await loadProducts();
      notify(mode === 'draft' ? '草稿已保存，可稍后继续编辑' : '产品已保存', 'success');
    } catch (error) {
      notify((error as { message?: string }).message ?? '产品保存失败', 'error');
      // 抛出错误让产品库页面保持编辑器打开，避免未保存的内容丢失。
      throw error;
    }
  };
  const exportProductLibrary = async () => {
    try {
      const blob = await exportProducts();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `产品库-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      notify('产品库已导出', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '产品库导出失败', 'error'); }
  };
  const downloadProductTemplate = async () => {
    try {
      const blob = await downloadProductImportTemplate();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = '产品库导入模板.xlsx';
      anchor.click();
      URL.revokeObjectURL(url);
      notify('产品库导入模板已下载', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '模板下载失败', 'error'); }
  };
  const importProductLibrary = async (file: File) => {
    try {
      const result = await importProducts(file);
      await loadProducts();
      notify(`产品库导入完成：新增 ${result.created} 个，更新 ${result.updated} 个`, 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '产品库导入失败', 'error'); }
  };
  const saveOrderDraft = async (draft: OrderDraft) => {
    try {
      const saved = await saveOrder(draft);
      const orderId = Number(saved.id ?? draft.id);
      if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new Error('订单保存成功但未返回有效订单 ID');
      for (const proof of draft.paymentProofs.filter((item) => item.file)) await uploadPaymentProof(orderId, proof.file!, proof.note ?? '');
      for (const contract of (draft.contracts ?? []).filter((item) => item.file)) await uploadOrderContract(orderId, contract.file!);
      for (const image of (draft.orderDetailImages ?? []).filter((item) => item.file)) await uploadOrderDetailImage(orderId, image.file!);
      for (const contractId of draft.deletedContractIds ?? []) await deleteOrderContract(contractId);
      await loadOrders();
      notify(draft.status === 'draft' ? '草稿已保存，可稍后继续编辑' : '订单已保存', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '订单保存失败', 'error'); }
  };
  // 草稿保存与正式保存共用持久化链路（附件上传等），仅提示语不同。
  const saveOrderAsDraft = async (draft: OrderDraft) => { await saveOrderDraft({ ...draft, status: 'draft' }); };
  const publishOrderDraft = async (order: OrderDraft) => {
    if (!order.id) return;
    try {
      await publishOrder(order.id);
      await loadOrders();
      notify(`草稿订单 ${order.orderNo} 已发布，进入待备货流程`, 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '草稿发布失败，请补全订单信息后再试', 'error'); }
  };
  const saveOrderCustomerProduct = async (customerId: number, input: import('../shared/customers').CustomerProductSaveInput) => {
    try {
      const saved = await saveCustomerProduct(customerId, input);
      await loadCustomers();
      notify('客户产品已添加并加入订单', 'success');
      return saved;
    } catch (error) {
      notify((error as { message?: string }).message ?? '客户产品保存失败', 'error');
      throw error;
    }
  };
  const createCustomerProfile = async (input: import('../shared/customers').CustomerSaveInput) => {
    try {
      const saved = await createCustomer(input);
      await loadCustomers();
      notify(`客户“${saved.name}”已添加`, 'success');
      return saved;
    } catch (error) {
      notify((error as { message?: string }).message ?? '客户保存失败', 'error');
      throw error;
    }
  };
  const previewNextOrderNumber = async () => (await getNextOrderNumber()).number;
  const removeOrderContract = async (contractId: string) => {
    try {
      await deleteOrderContract(contractId);
      await loadOrders();
      notify('合同附件已删除', 'success');
    } catch (error) {
      notify((error as { message?: string }).message ?? '合同删除失败', 'error');
      throw error;
    }
  };
  const generateContract = async (order: OrderDraft) => {
    if (!order.id) return;
    try {
      const blob = await generateOrderContractPdf(order.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${order.orderNo}-购销合同.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      // 服务端已把 PDF 归档进订单附件，刷新后即可在详情里看到。
      await loadOrders();
      notify('购销合同已生成并归档', 'success');
    } catch (error) {
      notify((error as { message?: string }).message ?? '合同生成失败', 'error');
      throw error;
    }
  };
  const removeOrder = async (order: OrderDraft) => {
    if (!order.id) return;
    try {
      await deleteOrder(order.id);
      await loadOrders();
      notify('订单已删除', 'success');
    } catch (error) {
      notify((error as { message?: string }).message ?? '订单删除失败', 'error');
      throw error;
    }
  };
  // advance 只处理正式流程推进；草稿订单走 publishOrderDraft。
  const advance = async (order: OrderDraft, status: OrderStatus) => {
    if (status === 'draft' || order.status === 'draft') return;
    const enteringStock = (order.status === 'label_pending' && status === 'pending_stock') || (order.status === 'pending_stock' && status === 'stock_reported');
    if (enteringStock && !order.labelPrintedAt) {
      const targetLabel = status === 'pending_stock' ? '待备货' : '已备货';
      const proceed = window.confirm(`订单“${order.orderNo}”尚未打印箱唛，是否继续进入“${targetLabel}”？\n提示：打印箱唛仅作为提醒，不会阻止流程。`);
      if (!proceed) return;
    }
    try { await advanceOrderStatus(Number(order.id), status); await loadOrders(); notify(`订单 ${order.orderNo} 已推进到下一状态`, 'success'); } catch (error) { notify((error as { message?: string }).message ?? '状态推进失败', 'error'); }
  };
  // 批量推进：一键备货 / 一键打包 / 一键发货，逐单推进、单单容错，结束后统一汇总。
  const batchAdvance = async (selected: OrderDraft[], action: BatchAdvanceAction) => {
    const actionLabels = { stock: '备货', pack: '打包', ship: '发货' } as const;
    const plan = getBatchAdvancePlan(selected, action);
    // 一键发货：未填物流单号的订单无法直接发货（发货必须留单号），引导到发货工作区补录。
    const untrackedOrders = action === 'ship'
      ? plan.skipped
        .filter((item) => item.reason === '缺少物流单号')
        .map((item) => selected.find((order) => order.orderNo === item.orderNo))
        .filter((order): order is OrderDraft => Boolean(order))
      : [];
    if (!plan.targets.length && !untrackedOrders.length) {
      const reason = plan.skipped.length ? plan.skipped[0].reason : '当前状态不支持该操作';
      notify(`所选订单没有可批量${actionLabels[action]}的订单（${reason}）`, 'error');
      return;
    }
    const unprintedCount = action === 'ship' ? 0 : plan.targets.filter((target) => !target.order.labelPrintedAt).length;
    const lines: string[] = [];
    if (action === 'stock') lines.push(`确定对 ${plan.targets.length} 单执行“批量备货”吗？`, '备货：待备货 → 已备货');
    if (action === 'pack') lines.push(`确定对 ${plan.targets.length} 单执行“批量打包”吗？`, '打包：已备货/待打包 → 完成打包，推进到待发货');
    if (action === 'ship' && plan.targets.length) lines.push(`确定对 ${plan.targets.length} 单执行“批量发货”吗？`, '发货：待发货 → 已发货');
    if (untrackedOrders.length) lines.push(`另有 ${untrackedOrders.length} 单未填物流单号，${plan.targets.length ? '发货后将' : '将'}打开发货工作区补录。`);
    if (unprintedCount) lines.push(`注意：其中 ${unprintedCount} 单尚未打印箱唛（仅作提醒，不阻止流程）`);
    if (!window.confirm(lines.join('\n'))) return;
    let advanced = 0;
    const failed: string[] = [];
    for (const { order, steps } of plan.targets) {
      try {
        for (const step of steps) await advanceOrderStatus(Number(order.id), step);
        advanced += 1;
      } catch (error) {
        failed.push(`${order.orderNo}（${(error as { message?: string }).message ?? '推进失败'}）`);
      }
    }
    await loadOrders();
    if (plan.targets.length) {
      const parts = [`批量${actionLabels[action]}完成：成功 ${advanced} 单`];
      if (untrackedOrders.length) parts.push(`${untrackedOrders.length} 单转入发货工作区补录物流单号`);
      if (failed.length) {
        notify(`${parts.join('，')}；失败 ${failed.length} 单：${failed.slice(0, 3).join('、')}${failed.length > 3 ? '等' : ''}`, 'error');
      } else {
        notify(parts.join('，'), 'success');
      }
    }
    if (untrackedOrders.length) {
      setShippingInitialOrders(untrackedOrders);
      navigate('shipping');
    }
  };
  const saveOrderLabels = async (order: OrderDraft, labels: CartonLabel[]) => {
    try {
      const result = await saveLabels(Number(order.id), labels);
      const savedLabels = Array.isArray((result as { labels?: unknown[] }).labels) ? (result as { labels: unknown[] }).labels.map((label) => labelFromApi(label as Record<string, unknown>, order)) : labels;
      setLabelsByOrderId((current) => ({ ...current, [orderKey(order)]: savedLabels }));
      notify('箱唛修改已保存', 'success');
      return savedLabels;
    } catch (error) { notify((error as { message?: string }).message ?? '箱唛保存失败', 'error'); throw error; }
  };
  const mergeOrderLabels = async (order: OrderDraft, labelIds: string[]) => {
    try {
      const result = await mergeLabels(Number(order.id), labelIds);
      const next = result.labels.map((label) => labelFromApi(label, order));
      setLabelsByOrderId((current) => ({ ...current, [orderKey(order)]: next }));
      notify('箱唛已合并并重新编号', 'success');
      return next;
    } catch (error) {
      notify((error as { message?: string }).message ?? '合箱失败', 'error');
      return undefined;
    }
  };
  const restoreAutoLabels = async (order: OrderDraft) => {
    try {
      const next = fallbackLabels(order);
      const result = await saveLabels(Number(order.id), next);
      const saved = Array.isArray((result as { labels?: unknown[] }).labels) ? (result as { labels: unknown[] }).labels.map((label) => labelFromApi(label as Record<string, unknown>, order)) : next;
      setLabelsByOrderId((current) => ({ ...current, [orderKey(order)]: saved }));
      notify('已恢复自动装箱方案', 'success');
      return saved;
    } catch (error) {
      notify((error as { message?: string }).message ?? '恢复自动方案失败', 'error');
      return undefined;
    }
  };
  const recordHistory = async (labels: CartonLabel[]) => {
    try {
      const orderIds = [...new Set(labels.map((label) => Number(label.orderId)).filter((id) => Number.isSafeInteger(id)))];
      const persistedLabelsByOrder = await Promise.all(orderIds.map(async (orderId) => {
        const order = orders.find((entry) => Number(entry.id) === orderId);
        const orderLabels = labels.filter((label) => Number(label.orderId) === orderId);
        if (!orderLabels.length) return [];
        const hasPersistedLabels = orderLabels.every((label) => /^\d+$/.test(label.id));
        // 订单不在当前分页数据里时无法先持久化箱唛，仍需原样上报，由服务端按提交内容记录。
        if (hasPersistedLabels || !order) return orderLabels;
        return await saveOrderLabels(order, orderLabels);
      }));
      const persistedLabels = persistedLabelsByOrder.flat();
      const persistedOrderIds = [...new Set(persistedLabels.map((label) => Number(label.orderId)).filter((id) => Number.isSafeInteger(id)))];
      await recordPrintHistory(persistedOrderIds, persistedLabels as unknown[], 'print');
      await loadOrders();
      notify('箱唛打印已记录，订单流程不受影响', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '打印记录失败', 'error'); throw error; }
  };

  const shippingOrders = useMemo(() => orders.filter((order) => order.status === 'ship_pending'), [orders]);
  const updateTracking = (id: string, value: string) => setOrders((current) => current.map((order) => orderKey(order) === id ? { ...order, trackingNo: value } : order));
  const confirmShipping = async (batch: OrderDraft[]) => {
    try {
      const created = await createShippingBatch(batch.map((order) => Number(order.id)));
      for (const order of batch) { if (created.id) await updateShippingTracking(created.id, Number(order.id), order.trackingNo); }
      await confirmShippingBatch(created.id);
      await loadOrders(); notify('发货批次已确认', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '发货确认失败', 'error'); }
  };

  const backup = async () => {
    try {
      const result = await createBackup();
      const anchor = document.createElement('a');
      anchor.href = result.downloadUrl;
      anchor.download = result.fileName;
      anchor.click();
      notify('备份已创建并开始下载', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '备份创建失败', 'error'); }
  };

  const restore = async (file: File) => {
    try {
      const manifest = await previewBackup(file);
      const attachmentCount = manifest.attachments.length;
      const confirmed = window.confirm(`备份时间：${manifest.createdAt}\n附件数量：${attachmentCount}\n恢复后会替换当前本机数据，并自动保留一份恢复前备份。确定继续吗？`);
      if (!confirmed) return;
      await restoreBackup(file);
      await Promise.all([loadProducts(), loadCustomers(), loadOrders()]);
      notify('数据已恢复，请重新检查订单与产品信息', 'success');
    } catch (error) { notify((error as { message?: string }).message ?? '数据恢复失败', 'error'); }
  };

  if (authState === 'checking') {
    return <div className="app-splash" role="status">正在进入个人工作台...</div>;
  }
  if (authState === 'locked') {
    // 登录成功后整页刷新，让所有模块在已登录状态下重新加载数据。
    return <LoginGate mode="login" onUnlocked={() => window.location.reload()} />;
  }

  return <div className="app-layout"><Sidebar activeKey={active} onNavigate={navigate} companyName={companyProfile.name} logoUrl={companyProfile.logoRelativePath ? `/files/${companyProfile.logoRelativePath}` : undefined} mobileOpen={mobileNavOpen} onMobileOpenChange={setMobileNavOpen} /><main className="app-content">
    {!accessConfigured && <div className="auth-banner">尚未设置访问密码，同一网络内的设备都能直接打开工作台。建议先在「设置 → 访问密码」中开启保护。<button type="button" onClick={() => navigate('settings')}>去设置</button></div>}
    {active === 'finance' && <FinancePage onNotify={notify} initialOrderId={financeInitialOrderId} customers={customers} />}
    {active === 'orders' && <OrdersPage orders={orders} customers={customers} statusCounts={statusCounts} labelsByOrderId={labelsByOrderId} initialOrderId={ordersInitialOrderId} onSaveOrder={(draft) => { void saveOrderDraft(draft); }} onSaveDraft={(draft) => { void saveOrderAsDraft(draft); }} onPublishOrder={(order) => { void publishOrderDraft(order); }} onDeleteOrder={(order) => { void removeOrder(order); }} onSaveCustomerProduct={saveOrderCustomerProduct} onCreateCustomer={createCustomerProfile} onGetNextOrderNumber={previewNextOrderNumber} onDeleteContract={removeOrderContract} onGenerateContract={generateContract} onAdvanceStatus={(order, status) => { void advance(order, status); }} onBatchAdvance={(orders, action) => { void batchAdvance(orders, action); }} onOpenShipping={(order) => { setShippingInitialOrder(order); navigate('shipping'); }} onOpenFinance={(order) => { setFinanceInitialOrderId(Number(order.id)); navigate('finance'); }} onSaveLabels={(order, labels) => { void saveOrderLabels(order, labels); }} onMergeLabels={mergeOrderLabels} onRestoreAutoLabels={restoreAutoLabels} onPrintHistory={(labels) => recordHistory(labels).catch(() => undefined)} />}
    {active === 'quotations' && <QuotationPage onNotify={notify} onOpenSalesDocument={() => navigate('sales-documents')} onOpenCustomerProducts={(customerId) => { setCustomerProductsInitialCustomerId(customerId); navigate('customer-products'); }} onSaveCustomerProduct={saveOrderCustomerProduct} onCreateCustomer={createCustomerProfile} />}
    {active === 'sales-documents' && <SalesDocumentsPage customers={customers} onNotify={notify} onSaveCustomerProduct={saveOrderCustomerProduct} onCreateCustomer={createCustomerProfile} onOpenOrder={async (orderId) => { await loadOrders(); setOrdersInitialOrderId(orderId); navigate('orders'); }} />}
    {active === 'products' && <ProductsPage products={products} loading={loading} onSave={saveProductRecord} onExport={exportProductLibrary} onDownloadTemplate={downloadProductTemplate} onImport={importProductLibrary} onRefresh={async () => { if (await loadProducts()) notify('产品库已刷新', 'success'); }} onDelete={async (product) => { try { await deleteProduct(product.id); await loadProducts(); notify('产品已删除', 'success'); } catch (error) { notify((error as { message?: string }).message ?? '删除失败', 'error'); } }} />}
    {active === 'customer-products' && <CustomerProductsPage customers={customers} systemProducts={products} initialCustomerId={customerProductsInitialCustomerId ?? undefined} loading={loading} onCustomersChanged={loadCustomers} onNotify={notify} />}
    {active === 'shipping' && <ShippingPage orders={shippingOrders} initialOrder={shippingInitialOrder} initialOrders={shippingInitialOrders} onUpdateTracking={updateTracking} onConfirm={confirmShipping} />}
    {active === 'settings' && <SettingsPage onBackup={backup} onRestore={restore} onProfileChanged={setCompanyProfile} />}
  </main><MobileTabBar activeKey={active} onNavigate={navigate} onOpenMore={() => setMobileNavOpen(true)} /><Toast messages={messages} onDismiss={(id) => setMessages((current) => current.filter((item) => item.id !== id))} /></div>;
}
