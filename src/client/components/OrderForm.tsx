import { BookmarkPlus, Calculator, Download, ExternalLink, FileText, Library, Plus, Trash2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { getNextOrderNumber, deleteOrderDetailImage, getOrderItemImages, getProductsByIds, importCustomerProductWithInput } from '../api';
import { thumbUrl } from '../image-urls';
import { canPickFilesNatively, pickFilesNatively } from '../app-bridge';
import { CONTRACT_PICKER_ACCEPT, normalizeUploadContract, SUPPORTED_CONTRACT_HINT } from '../contract-mime';
import { attachmentFilesFromClipboard } from '../attachment-mime';
import { useFileDrop } from '../use-file-drop';
import { calculateOrderBoxes } from '../../shared/order-calculations';
import { calculateFreightCents, calculateOrderLineAmountCents, calculateOrderTotalCents } from '../../shared/order-prices';
import { dateInputValue, dateOnlyValue } from '../../shared/date-input';
import { extractRecipientName } from '../order-recipient';
import { ORDER_SETTLEMENT_LABELS, isSettlementType, type OrderSettlementType } from '../../shared/settlement';
import { PAYMENT_POLICY_LABELS, PAYMENT_POLICY_OPTIONS, depositCents, normalizePaymentPolicy, paymentPolicySummary, type PaymentPolicy } from '../../shared/payment-policy';
import { ORDER_CHANNEL_LABELS, type AnyOrderStatus, type OrderChannel } from '../../shared/domain';
import type { Company } from '../../shared/companies';
import type { Customer, CustomerProduct as CustomerProductRecord, CustomerProductAttachment, CustomerProductSaveInput, CustomerSaveInput } from '../../shared/customers';
import ImagePasteUpload, { type ImageAttachment } from './ImagePasteUpload';
import CustomerProductEditorModal from './customer-products/CustomerProductEditorModal';
import CustomerProductPicker from './customer-products/CustomerProductPicker';
import { useProductPreview } from './ProductPreview';
import LibraryProductPicker, { type LibraryProductSelection } from './documents/LibraryProductPicker';
import CustomerSelector from './customers/CustomerSelector';
import PackagingTable from './PackagingTable';
import Modal from './Modal';
import { OrderCostEditor, OrderItemCostEditor, OrderProfitSummaryCard } from './orders/OrderProfitEditor';

export type ToastKind = 'success' | 'info' | 'error';
/** 订单状态统一从 shared/domain 派生，避免客户端再维护一份联合类型。 */
export type OrderStatus = AnyOrderStatus;

export interface PackagingOption {
  id: string;
  name: string;
  innerSize: string;
  innerWeight: string;
  outerSize: string;
  outerWeight: string;
  packSize: number;
  purchasePrice: string;
  /** 旧产品回显兼容字段；新编辑器不再显示独立的长宽高控件。 */
  length?: string;
  width?: string;
  height?: string;
  images?: ImageAttachment[];
}

export interface CustomerProduct {
  id: string;
  name: string;
  sku: string;
  specification: string;
  packCount: number;
}

export interface OrderItemDraft {
  id: string;
  customerProductId?: number | null;
  productId?: string;
  /** 产品图片相对路径（/files/ 下）：客户产品自有/借用图或系统产品图，用于明细行缩略图与放大。 */
  imageRelativePath?: string | null;
  name: string;
  sku: string;
  specification: string;
  quantity: number;
  packSize: number;
  boxes: number;
  /** 已发数量；部分发货后由服务端维护，编辑订单时只读。 */
  shippedQuantity?: number;
  unitPriceCents?: number;
  amountCents?: number;
  freightPerBoxCents?: number;
  machineCostCents?: number | null;
  batteryCostCents?: number | null;
  chargerCostCents?: number | null;
  packagingCostCents?: number | null;
  accessoryCostCents?: number | null;
  otherCostCents?: number | null;
  costConfirmed?: boolean;
  /** 备注：只给自己看的内部信息，不会印到箱唛。 */
  remark: string;
  /** 箱唛要求：会随订单带到箱面上打印的作业指令。 */
  labelRequirement?: string;
  customerProductAttachments?: CustomerProductAttachment[];
  packaging?: PackagingOption[];
}

export interface PaymentProofDraft extends ImageAttachment {
  note: string;
  mimeType?: string;
  size?: number;
  createdAt?: string;
}

export interface OrderDetailImageDraft extends ImageAttachment {
  mimeType?: string;
  size?: number;
}

export interface OrderContractDraft {
  id: string;
  name: string;
  url: string;
  file?: File;
  mimeType?: string;
  size?: number;
  createdAt?: string;
  category?: string;
  sourceCustomerProductId?: number | null;
}

export interface OrderDraft {
  id?: string;
  orderNo: string;
  orderNoAuto?: boolean;
  orderedAt: string;
  customerId?: number | null;
  customerName?: string;
  customerContactName?: string;
  customerContactPhone?: string;
  customerShippingInfo?: string;
  /** 订单渠道：online 线上 / offline 线下；新建时由当前页签决定。 */
  channel?: OrderChannel;
  /** 结算方式：corporate 对公（需开票）/ personal 对私（无需开票）。新建默认对私，历史订单按各自已存的值显示。 */
  settlementType?: OrderSettlementType;
  /** 收款/开票公司；对公订单必选，历史订单可能为空。 */
  companyId?: number | null;
  companyName?: string;
  /** 付款方式快照：先款后货 / 发货前付清 / 账期；选客户时自动带出，可本次覆盖。 */
  paymentPolicy?: PaymentPolicy;
  /** 先款后货的定金比例（%），0 表示收全款才能发布。 */
  depositPercent?: number;
  /** 账期天数。 */
  creditDays?: number;
  orderDetail: string;
  orderDetailImages: OrderDetailImageDraft[];
  recipientName: string;
  recipientInfo: string;
  amount: string;
  shippingCents?: number;
  logisticsCostCents?: number | null;
  labelCostCents?: number | null;
  otherCostCents?: number | null;
  otherCostNote?: string;
  costConfirmed?: boolean;
  trackingNo: string;
  paymentNote: string;
  paymentProofs: PaymentProofDraft[];
  remark: string;
  items: OrderItemDraft[];
  contracts?: OrderContractDraft[];
  labels?: Array<Record<string, unknown>>;
  deletedContractIds?: string[];
  totalBoxes?: number;
  status?: OrderStatus;
  labelPrintedAt?: string;
  /** 创建人用户名（服务端留痕，详情展示用）。 */
  createdBy?: string;
  financeSummary?: import('../../shared/finance').OrderFinanceLite | null;
}

export interface OrderFormProps {
  value?: Partial<OrderDraft>;
  /** 新建订单时由当前订单页签决定渠道。 */
  defaultChannel?: OrderChannel;
  customers: Customer[];
  companies?: Company[];
  onSubmit: (value: OrderDraft) => void;
  onCancel?: () => void;
  onSaveDraft?: (value: OrderDraft) => void;
  onSaveCustomerProduct?: (customerId: number, input: CustomerProductSaveInput) => Promise<CustomerProductRecord | undefined>;
  onCreateCustomer?: (input: CustomerSaveInput) => Promise<Customer>;
  submitLabel?: string;
  onGetNextOrderNumber?: () => Promise<string | undefined>;
}

const controlStyle = { width: '100%', minWidth: 0, border: '1px solid var(--control-border)', borderRadius: 'var(--radius-control)', padding: '7px 9px', color: 'var(--color-text)', background: 'var(--control-bg)', font: 'inherit', fontSize: 'var(--text-xs)' };
const labelStyle = { display: 'grid', gap: 'var(--space-2)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' };
const contractAccept = '.pdf,.doc,.docx,.xls,.xlsx,image/png,image/jpeg,image/webp';
const CONTRACT_MAX_PICK = 9;

function directCostCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function makeItem(product?: CustomerProductRecord): OrderItemDraft {
  const packSize = Math.max(1, Math.trunc(product?.packCount ?? 1));
  const unitPriceCents = product?.finalPriceCents ?? 0;
  return { id: `item-${Date.now()}-${Math.random().toString(16).slice(2)}`, customerProductId: product?.id ?? null, productId: product?.systemProductId == null ? undefined : String(product.systemProductId), name: product?.name ?? '', sku: product?.sku ?? '', specification: product?.specification ?? '', quantity: 1, packSize, boxes: 1, unitPriceCents, amountCents: unitPriceCents, freightPerBoxCents: product?.freightPerBoxCents ?? 0, machineCostCents: product?.costPriceCents ?? null, batteryCostCents: product?.batteryCostCents ?? null, chargerCostCents: product?.chargerCostCents ?? null, packagingCostCents: product?.packagingCostCents ?? null, accessoryCostCents: product?.accessoryCostCents ?? null, otherCostCents: product?.otherCostCents ?? null, costConfirmed: Boolean(product?.costConfirmed), remark: product?.remark ?? '', labelRequirement: product?.labelRequirement ?? '', imageRelativePath: product?.imageRelativePath ?? null, customerProductAttachments: product?.attachments ?? [] };
}

function defaultDraft(value: Partial<OrderDraft> | undefined, defaultChannel: OrderChannel): OrderDraft {
  return {
    orderNo: value?.orderNo ?? '', orderNoAuto: value?.orderNoAuto ?? (!value?.id && !value?.orderNo), orderedAt: dateOnlyValue(value?.orderedAt ?? dateInputValue()), customerId: value?.customerId ?? null, customerName: value?.customerName ?? '', customerContactName: value?.customerContactName ?? '', customerContactPhone: value?.customerContactPhone ?? '', customerShippingInfo: value?.customerShippingInfo ?? '', channel: value?.channel ?? defaultChannel, settlementType: isSettlementType(value?.settlementType) ? value.settlementType : 'personal', companyId: value?.companyId ?? null, companyName: value?.companyName ?? '', paymentPolicy: normalizePaymentPolicy(value?.paymentPolicy), depositPercent: value?.depositPercent ?? 0, creditDays: value?.creditDays ?? 0, orderDetail: value?.orderDetail ?? '', orderDetailImages: value?.orderDetailImages ?? [], recipientName: value?.recipientName ?? '', recipientInfo: value?.recipientInfo ?? '', amount: value?.amount ?? '', shippingCents: value?.shippingCents ?? 0, logisticsCostCents: value?.logisticsCostCents ?? null, labelCostCents: value?.labelCostCents ?? null, otherCostCents: value?.otherCostCents ?? null, otherCostNote: value?.otherCostNote ?? '', costConfirmed: value?.costConfirmed ?? false, trackingNo: value?.trackingNo ?? '', paymentNote: value?.paymentNote ?? '', paymentProofs: value?.paymentProofs ?? [], remark: value?.remark ?? '', items: value?.items ?? [], contracts: value?.contracts ?? [], deletedContractIds: value?.deletedContractIds ?? [], status: value?.status ?? 'pending_stock', id: value?.id,
  };
}

function isImageContract(contract: OrderContractDraft) {
  return contract.mimeType?.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(contract.name);
}

function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function customerAttachmentLabel(category: string): string {
  return category === 'label' ? '标贴文件' : category === 'instruction' ? '说明书文件' : category === 'packaging' ? '打包文件' : '客户产品附件';
}

export default function OrderForm({ value, defaultChannel = 'offline', customers, companies = [], onSubmit, onCancel, onSaveDraft, onSaveCustomerProduct, onCreateCustomer, submitLabel = '保存订单', onGetNextOrderNumber }: OrderFormProps) {
  const { bind, previewElement } = useProductPreview();
  const [draft, setDraft] = useState<OrderDraft>(() => defaultDraft(value, defaultChannel));
  const itemsLocked = Boolean(draft.id) && draft.items.some((item) => (item.shippedQuantity ?? 0) > 0);
  const companyAutoFilled = useRef(false);
  const [shippingInput, setShippingInput] = useState(() => ((value?.shippingCents ?? 0) / 100).toFixed(2));
  const [shippingOverridden, setShippingOverridden] = useState(Boolean(value?.id));
  const [error, setError] = useState('');
  // 只有一个启用公司时直接选中，减少新建对公订单的点击；对私订单不需要开票公司，不自动带出。
  useEffect(() => {
    if ((draft.settlementType ?? 'personal') === 'personal') return;
    if (companyAutoFilled.current || draft.companyId != null) return;
    const active = companies.filter((company) => company.isActive);
    if (active.length !== 1) return;
    companyAutoFilled.current = true;
    setDraft((current) => ({ ...current, companyId: active[0].id, companyName: active[0].shortName }));
  }, [companies, draft.companyId, draft.settlementType]);
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [profitOpen, setProfitOpen] = useState(false);
  const [systemPickerOpen, setSystemPickerOpen] = useState(false);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [savingItemIds, setSavingItemIds] = useState<Set<string>>(() => new Set());
  /** 单价输入的本地编辑缓冲：允许 “”“12.”“12.3” 等中间态，失焦后再规范化。 */
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const calculatedTotalCents = calculateOrderTotalCents(draft.items.map((item) => ({ quantity: item.quantity, unitPriceCents: item.unitPriceCents ?? 0 })));
  const calculatedFreightCents = calculateFreightCents(draft.items.map((item) => ({ boxes: item.boxes, freightPerBoxCents: item.freightPerBoxCents ?? 0 })));
  const shippingCents = shippingOverridden ? Math.max(0, Math.trunc(draft.shippingCents ?? 0)) : calculatedFreightCents;
  const productAmount = (calculatedTotalCents / 100).toFixed(2);
  const shippingAmount = (shippingCents / 100).toFixed(2);
  const calculatedAmount = ((calculatedTotalCents + shippingCents) / 100).toFixed(2);
  const objectUrls = useRef(new Set<string>());
  const autoPreviewRef = useRef('');
  /** 上次自动提取到的收件人名称；只覆盖这个值，用户手改过就不再动。 */
  const autoRecipientNameRef = useRef('');
  const errorRef = useRef<HTMLDivElement>(null);
  const contractInputRef = useRef<HTMLInputElement>(null);
  // 表单错误条固定在顶部，而「选择附件」「保存订单」都在弹窗下方：移动端弹窗正文是独立滚动容器，
  // 不出错则已，一出错就停在视口外，使用者看到的只是「点了没反应」。
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [error]);
  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
  }, []);

  useEffect(() => {
    if (draft.id || autoPreviewRef.current) return;
    let cancelled = false;
    const loadNextNumber = onGetNextOrderNumber
      ? onGetNextOrderNumber().then((result) => result)
      : getNextOrderNumber().then((result) => result.number);
    void loadNextNumber.then((result) => {
      if (cancelled || !result) return;
      autoPreviewRef.current = result;
      setDraft((current) => {
        if (current.id || !current.orderNoAuto || (current.orderNo && current.orderNo !== autoPreviewRef.current && current.orderNo !== result)) return current;
        return { ...current, orderNo: result };
      });
    }).catch(() => {
      // A preview failure must not block saving; the server can generate the number from an empty value.
    });
    return () => { cancelled = true; };
  }, [draft.id, onGetNextOrderNumber]);

  useEffect(() => {
    setDraft((current) => current.amount === calculatedAmount ? current : { ...current, amount: calculatedAmount });
  }, [calculatedAmount]);

  useEffect(() => {
    if (!shippingOverridden) {
      setShippingInput((calculatedFreightCents / 100).toFixed(2));
      setDraft((current) => current.shippingCents === calculatedFreightCents ? current : { ...current, shippingCents: calculatedFreightCents });
    }
  }, [calculatedFreightCents, shippingOverridden]);

  useEffect(() => {
    setShippingOverridden(Boolean(value?.id));
    setShippingInput(((value?.shippingCents ?? 0) / 100).toFixed(2));
  }, [value?.id, value?.shippingCents]);

  // 编辑已有订单：明细行图片不在订单 payload 里，按行 id 从图片接口并入草稿（新选品行自带图，跳过）。
  useEffect(() => {
    if (!value?.id) return undefined;
    let cancelled = false;
    void getOrderItemImages(value.id).then((result) => {
      if (cancelled) return;
      setDraft((current) => ({
        ...current,
        items: current.items.map((item) => {
          if (item.imageRelativePath) return item;
          const url = result.itemImages[Number(item.id)]?.[0]?.url;
          return url ? { ...item, imageRelativePath: url.replace(/^\/files\//, '') } : item;
        }),
      }));
    }).catch(() => { /* 图片加载失败不打断编辑 */ });
    return () => { cancelled = true; };
  }, [value?.id]);

  const update = <K extends keyof OrderDraft>(key: K, next: OrderDraft[K]) => setDraft((current) => ({ ...current, [key]: next }));
  const updateShippingInput = (next: string) => {
    setShippingOverridden(true);
    setShippingInput(next);
    if (!/^\d*(?:\.\d{0,2})?$/.test(next)) return;
    update('shippingCents', next ? Math.round(Number(next) * 100) : 0);
  };
  const commitShippingInput = () => {
    const cents = /^\d*(?:\.\d{0,2})?$/.test(shippingInput) && shippingInput !== ''
      ? Math.max(0, Math.round(Number(shippingInput) * 100))
      : 0;
    update('shippingCents', cents);
    setShippingInput((cents / 100).toFixed(2));
  };
  /** 收件信息变化：自动提取姓名，但只在姓名为空或仍是上次自动值时覆盖。 */
  const changeRecipientInfo = (info: string) => setDraft((current) => {
    const parsed = extractRecipientName(info);
    const canReplace = !current.recipientName.trim() || current.recipientName === autoRecipientNameRef.current;
    if (parsed && canReplace) autoRecipientNameRef.current = parsed;
    return {
      ...current,
      recipientInfo: info,
      recipientName: parsed && canReplace ? parsed : current.recipientName,
    };
  });
  const selectCustomer = (customerId: number | null, customer?: Customer) => setDraft((current) => {
    const shippingInfo = customer?.shippingInfo ?? '';
    const recipientInfo = current.recipientInfo.trim() ? current.recipientInfo : shippingInfo;
    const parsed = extractRecipientName(recipientInfo);
    const canReplace = !current.recipientName.trim() || current.recipientName === autoRecipientNameRef.current;
    if (parsed && canReplace) autoRecipientNameRef.current = parsed;
    return {
      ...current,
      customerId,
      customerName: customer?.name ?? '',
      customerContactName: customer?.contactName ?? '',
      customerContactPhone: customer?.contactPhone ?? '',
      customerShippingInfo: shippingInfo,
      recipientInfo,
      recipientName: parsed && canReplace ? parsed : current.recipientName,
      // 付款方式跟随客户档案，换客户时重新带出；之后仍可在本单里改。
      paymentPolicy: customer ? customer.paymentPolicy : 'before_ship',
      depositPercent: customer ? customer.depositPercent : 0,
      creditDays: customer ? customer.creditDays : 0,
      items: customerId && customerId !== current.customerId
        ? current.items.map((item) => ({ ...item, customerProductId: null }))
        : current.items,
    };
  });
  const setTemporaryCustomerName = (name: string) => setDraft((current) => ({
    ...current,
    customerId: null,
    customerName: name,
    customerContactName: '',
    customerContactPhone: '',
    customerShippingInfo: '',
    // 临时客户不能挂客户产品（服务端按客户归属校验），切到临时时解除行的客户产品关联，保留系统产品引用。
    items: current.items.map((item) => ({ ...item, customerProductId: null })),
  }));
  const selectProduct = (product: CustomerProductRecord) => setDraft((current) => ({ ...current, items: [...current.items, makeItem(product)] }));
  const selectSystemProduct = async (selection: LibraryProductSelection) => {
    const { product, image } = selection;
    let detail: Awaited<ReturnType<typeof getProductsByIds>>[number] | undefined;
    try { [detail] = await getProductsByIds([product.id]); } catch { /* 包装拉取失败不阻断选品，装箱数回退 1 */ }
    const packSize = Math.max(1, Math.trunc(detail?.packaging?.[0]?.packSize ?? 1));
    const packagingCostCents = detail?.packaging?.[0]?.purchasePrice
      ? Math.round((directCostCents(detail.packaging[0].purchasePrice) ?? 0) / packSize)
      : null;
    const imageRelativePath = image?.relativePath ?? (image?.url ? image.url.replace(/^\/files\//, '') : null);
    const newItem: OrderItemDraft = {
      id: `item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      customerProductId: null,
      productId: String(product.id),
      imageRelativePath: imageRelativePath || null,
      name: product.name,
      sku: product.sku,
      specification: product.specification,
      quantity: 1,
      packSize,
      boxes: 1,
      unitPriceCents: 0,
      amountCents: 0,
      freightPerBoxCents: 0,
      machineCostCents: directCostCents(product.purchasePrice),
      packagingCostCents,
      costConfirmed: false,
      remark: '',
      labelRequirement: '',
      packaging: detail?.packaging?.length ? detail.packaging : undefined,
    };
    setDraft((current) => ({ ...current, items: [...current.items, newItem] }));
    setSystemPickerOpen(false);
  };
  const saveItemToCustomerLibrary = async (item: OrderItemDraft) => {
    if (!draft.customerId || !item.productId) return;
    const systemProductId = Number(item.productId);
    setSavingItemIds((current) => new Set(current).add(item.id));
    try {
      const saved = await importCustomerProductWithInput(draft.customerId, systemProductId, {
        systemProductId,
        name: item.name,
        specification: item.specification,
        sku: item.sku,
        packCount: item.packSize,
        finalPriceCents: item.unitPriceCents ?? 0,
        freightPerBoxCents: item.freightPerBoxCents ?? 0,
        remark: item.remark,
        labelRequirement: item.labelRequirement ?? '',
        packaging: (item.packaging ?? []).map((pack) => ({ name: pack.name, innerSize: pack.innerSize, innerWeight: Number(pack.innerWeight) || 0, outerSize: pack.outerSize, outerWeight: Number(pack.outerWeight) || 0, packCount: pack.packSize })),
        imageRelativePath: item.imageRelativePath ?? null,
      });
      updateItem(item.id, { customerProductId: saved.id });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '存入客户产品库失败');
    } finally {
      setSavingItemIds((current) => { const next = new Set(current); next.delete(item.id); return next; });
    }
  };
  const updateItem = (id: string, patch: Partial<OrderItemDraft>) => setDraft((current) => ({ ...current, items: current.items.map((item) => {
    if (item.id !== id) return item;
    const quantity = patch.quantity ?? item.quantity;
    const packSize = patch.packSize ?? item.packSize;
    const unitPriceCents = patch.unitPriceCents ?? item.unitPriceCents ?? 0;
    return { ...item, ...patch, unitPriceCents, amountCents: calculateOrderLineAmountCents({ quantity, unitPriceCents }), boxes: calculateOrderBoxes(quantity, packSize) };
  }) }));
  const openNewProduct = () => setNewProductOpen(true);
  /** 单价输入中间态：仅当用户正在编辑该行单价时使用缓冲值，否则回显规范化的两位小数。 */
  const priceInputValue = (item: OrderItemDraft) => priceInputs[item.id] ?? ((item.unitPriceCents ?? 0) / 100).toFixed(2);
  const changePriceInput = (id: string, next: string) => {
    if (next !== '' && !/^\d*(?:\.\d{0,2})?$/.test(next)) return;
    setPriceInputs((current) => ({ ...current, [id]: next }));
    if (!/^\d*(?:\.\d{0,2})?$/.test(next)) return;
    updateItem(id, { unitPriceCents: Math.max(0, Math.round((Number(next) || 0) * 100)) });
  };
  const commitPriceInput = (item: OrderItemDraft) => {
    const raw = priceInputs[item.id];
    if (raw === undefined) return;
    const cents = Math.max(0, Math.round((Number(raw) || 0) * 100));
    updateItem(item.id, { unitPriceCents: cents });
    setPriceInputs((current) => {
      if (current[item.id] === undefined) return current;
      const { [item.id]: _removed, ...rest } = current;
      return rest;
    });
  };
  const saveNewProduct = async (input: CustomerProductSaveInput) => {
    if (!draft.customerId || !onSaveCustomerProduct) throw new Error('请先选择客户后再添加客户产品');
    const saved = await onSaveCustomerProduct(draft.customerId, input);
    if (!saved) throw new Error('客户产品保存失败');
    selectProduct(saved);
    setNewProductOpen(false);
  };
  const addContractFiles = (files: File[]) => {
    // 以扩展名为准回写 MIME：手机选回的文件常报 application/octet-stream，
    // 而服务端要求 MIME 命中白名单且与扩展名配对，不回写会被 400 拒掉。
    const accepted = files.map(normalizeUploadContract).filter((file): file is File => Boolean(file));
    if (accepted.length !== files.length) setError(SUPPORTED_CONTRACT_HINT);
    if (!accepted.length) return;
    const contracts = accepted.map((file): OrderContractDraft => {
      const image = file.type.startsWith('image/');
      const url = image ? URL.createObjectURL(file) : '';
      if (url) objectUrls.current.add(url);
      return { id: `contract-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: file.name, url, file, mimeType: file.type, size: file.size };
    });
    setDraft((current) => ({ ...current, contracts: [...(current.contracts ?? []), ...contracts] }));
  };
  /**
   * App 内优先走原生选文件桥，不经 WebView 的 file input。
   * 日志实证：手机经 file input 选完文件后，POST /api/orders/:id/contracts 只有请求头到达服务端，
   * 请求体一个字节都没写出（.staging 无残留、服务端从未返回响应），上传永远挂着；
   * 而走原生桥把字节读进内存再 fetch 的产品图片上传全部成功。
   */
  const openContractPicker = (event: ReactMouseEvent<HTMLLabelElement>) => {
    if (event.target === contractInputRef.current) return; // label 转发给 input 的点击，不重复处理
    if (!canPickFilesNatively()) return; // 浏览器/旧版 App：保持 label 激活隐藏 input 的原生行为
    event.preventDefault();
    const picked = pickFilesNatively(CONTRACT_PICKER_ACCEPT, true, CONTRACT_MAX_PICK);
    if (!picked) {
      contractInputRef.current?.click();
      return;
    }
    void picked
      .then((files) => addContractFiles(files))
      .catch(() => setError('附件读取失败，请重新选择'));
  };
  /** 粘贴订单附件：从剪贴板取文件后走与「选择附件」相同的类型归一化管线。 */
  const onContractPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const files = attachmentFilesFromClipboard(event.clipboardData);
    if (!files.length) return; // 纯文本粘贴不拦截
    event.preventDefault();
    addContractFiles(files);
  };
  const { dragging: contractDragging, handlers: contractDropHandlers } = useFileDrop(addContractFiles);
  const removeContract = (contract: OrderContractDraft) => {
    if (contract.file && contract.url) {
      URL.revokeObjectURL(contract.url);
      objectUrls.current.delete(contract.url);
    }
    setDraft((current) => ({ ...current, contracts: (current.contracts ?? []).filter((item) => item.id !== contract.id), deletedContractIds: contract.file ? current.deletedContractIds : [...new Set([...(current.deletedContractIds ?? []), contract.id])] }));
  };
  const detailImages = draft.orderDetailImages ?? [];
  const customerProductAttachments = draft.items.flatMap((item) => item.customerProductAttachments ?? []);
  const addDetailImages = (attachments: ImageAttachment[]) => update('orderDetailImages', attachments as OrderDetailImageDraft[]);
  const removeDetailImage = async (attachment: ImageAttachment) => {
    if (!attachment.file && draft.id) await deleteOrderDetailImage(attachment.id);
  };
  const submit = () => {
    if (draft.id && !draft.orderNo.trim()) return setError('请填写订单号');
    if (!draft.recipientName.trim()) return setError('请填写收件人名称');
    if (!draft.items.length) return setError('请至少添加一行产品');
    if (draft.items.some((item) => !item.name.trim() || item.quantity < 1 || item.packSize < 1)) return setError('产品信息或数量不完整');
    // 新建对公订单必须选公司；历史订单可能还没有公司，允继续编辑保存，避免卡住旧数据。
    if (!draft.id && (draft.settlementType ?? 'personal') !== 'personal' && draft.companyId == null) return setError('对公订单请选择收款/开票公司');
    setError('');
    onSubmit({ ...draft, amount: calculatedAmount, shippingCents });
  };

  // 存草稿：仅要求至少一行产品（可以是空行），其余字段允许暂缺。
  const submitDraft = () => {
    if (!draft.items.length) return setError('草稿也需至少添加一行产品，可在订单详情中先选择产品');
    setError('');
    onSaveDraft?.({ ...draft, amount: calculatedAmount, shippingCents, status: 'draft' });
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <div ref={errorRef} role="alert" style={{ padding: '9px 11px', background: 'var(--color-danger-soft)', color: 'var(--color-danger)', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-ui)', fontSize: 12 }}>{error}</div>}
      <section style={{ display: 'grid', gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--color-text)' }}><UserRound size={16} /><strong style={{ fontSize: 13 }}>客户与订单信息</strong></div>
        <div className="order-form-grid order-form-grid-main">
          <CustomerSelector value={draft.customerId ?? null} customers={customers} onChange={selectCustomer} onCreateCustomer={onCreateCustomer} temporaryName={draft.customerId == null ? (draft.customerName ?? '') : ''} onTemporaryNameChange={setTemporaryCustomerName} />
          <label style={labelStyle}>订单号<input style={controlStyle} value={draft.orderNo} disabled={itemsLocked} title={itemsLocked ? '已有发货记录，订单号已锁定' : undefined} onChange={(event) => { const orderNo = event.target.value; update('orderNo', orderNo); update('orderNoAuto', !orderNo.trim()); }} placeholder="自动生成，可手动修改" /></label>
          <label style={labelStyle}>下单时间<input type="date" style={{ ...controlStyle, minWidth: 0 }} value={draft.orderedAt} onChange={(event) => update('orderedAt', event.target.value)} /></label>
          <label style={labelStyle}>结算方式<select aria-label="结算方式" style={controlStyle} value={draft.settlementType ?? 'personal'} onChange={(event) => {
            const settlementType = event.target.value === 'personal' ? 'personal' : 'corporate';
            if (settlementType === 'personal') {
              // 对私不需要开票公司：切过来时清掉，避免带着公司保存；再切回对公时允许重新自动带出。
              companyAutoFilled.current = false;
              setDraft((current) => ({ ...current, settlementType, companyId: null, companyName: '' }));
            } else {
              update('settlementType', settlementType);
            }
          }}>
            <option value="corporate">{ORDER_SETTLEMENT_LABELS.corporate}（需要开票）</option>
            <option value="personal">{ORDER_SETTLEMENT_LABELS.personal}（无需开票）</option>
          </select></label>
          <label style={labelStyle}>订单渠道<select aria-label="订单渠道" title={draft.id ? '改渠道只影响订单在线上/线下列表中的归类，不会改动财务数据' : '新建订单的渠道由当前页签决定'} style={controlStyle} value={draft.channel ?? defaultChannel} disabled={!draft.id} onChange={(event) => {
            const current = draft.channel ?? 'offline';
            const next: OrderChannel = event.target.value === 'online' ? 'online' : 'offline';
            if (next !== current && !window.confirm('改渠道只影响订单在线上/线下列表中的归类，不会改动财务数据。确定继续吗？')) {
              event.target.value = current;
              return;
            }
            update('channel', next);
          }}>
            <option value="online">{ORDER_CHANNEL_LABELS.online}订单</option>
            <option value="offline">{ORDER_CHANNEL_LABELS.offline}订单</option>
          </select></label>
          {(draft.settlementType ?? 'personal') !== 'personal' && <label style={labelStyle}>收款/开票公司<select aria-label="收款/开票公司" style={controlStyle} value={draft.companyId ?? ''} onChange={(event) => {
            const companyId = event.target.value ? Number(event.target.value) : null;
            const company = companies.find((item) => item.id === companyId);
            update('companyId', companyId);
            update('companyName', company?.shortName ?? '');
          }}>
            <option value="">请选择公司</option>
            {companies.filter((company) => company.isActive || company.id === draft.companyId).map((company) => <option key={company.id} value={company.id}>{company.shortName}{company.isActive ? '' : '（已停用）'}</option>)}
          </select></label>}
          <label style={labelStyle}>付款方式<select aria-label="付款方式" style={controlStyle} value={draft.paymentPolicy ?? 'before_ship'} onChange={(event) => update('paymentPolicy', event.target.value as PaymentPolicy)}>
            {PAYMENT_POLICY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
          {(draft.paymentPolicy ?? 'before_ship') === 'prepay' && <label style={labelStyle}>定金比例（%）<input type="number" min="0" max="100" inputMode="numeric" aria-label="定金比例" style={controlStyle} value={draft.depositPercent ?? 0} onChange={(event) => update('depositPercent', Math.max(0, Math.min(100, Math.trunc(Number(event.target.value) || 0))))} /></label>}
          {(draft.paymentPolicy ?? 'before_ship') === 'credit' && <label style={labelStyle}>账期天数<input type="number" min="0" max="365" inputMode="numeric" aria-label="账期天数" style={controlStyle} value={draft.creditDays ?? 0} onChange={(event) => update('creditDays', Math.max(0, Math.min(365, Math.trunc(Number(event.target.value) || 0))))} /></label>}
          <div style={{ gridColumn: '1 / -1', color: 'var(--color-text-muted)', fontSize: 11 }}>
            {paymentPolicySummary(normalizePaymentPolicy(draft.paymentPolicy), draft.depositPercent ?? 0, draft.creditDays ?? 0)}
            {(draft.paymentPolicy ?? 'before_ship') === 'prepay'
              ? ` · 定金 ¥${(depositCents(calculatedTotalCents + shippingCents, draft.depositPercent ?? 0) / 100).toFixed(2)}；收齐定金前只能存草稿，收齐全款后才能确认已备货`
              : (draft.paymentPolicy ?? 'before_ship') === 'credit' ? ' · 可先发货，按账期在财务「对账」里收款' : ' · 可先备货打包，发货前必须收齐全款'}
          </div>
        </div>
        <div className="order-form-grid order-form-grid-recipient">
          <label style={labelStyle}>收件人名称<input style={controlStyle} value={draft.recipientName} onChange={(event) => { autoRecipientNameRef.current = ''; update('recipientName', event.target.value); }} placeholder="从收件信息自动提取，可修改" /></label>
          <label style={labelStyle}>收件信息<textarea rows={2} style={{ ...controlStyle, resize: 'vertical' }} value={draft.recipientInfo} onChange={(event) => changeRecipientInfo(event.target.value)} placeholder="粘贴收件人、电话、地址，姓名会自动提取" /></label>
          <label style={labelStyle}>发货单号<input style={controlStyle} value={draft.trackingNo} onChange={(event) => update('trackingNo', event.target.value)} placeholder="发货后回填" /></label>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 7, padding: '9px 11px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
            <strong style={{ fontSize: 13 }}>订单详情</strong>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{draft.items.length} 行产品 · {detailImages.length} 张图片 · {customerProductAttachments.length + (draft.contracts ?? []).length} 个订单附件 · {draft.orderDetail.trim() ? '已填写文字详情' : '未填写文字详情'}</span>
            <span style={{ color: 'var(--color-accent)', fontWeight: 700, fontSize: 14, marginLeft: 'auto' }}>合计 ¥ {calculatedAmount}{shippingCents > 0 ? <small style={{ color: 'var(--color-text-secondary)', fontWeight: 500, fontSize: 11 }}>（产品 ¥ {productAmount} + 运费 ¥ {shippingAmount}）</small> : null}</span>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setDetailOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-ui)', background: 'var(--color-accent-soft)', color: 'var(--color-accent)', padding: '7px 11px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}><FileText size={14} />填写订单详情</button>
            <button type="button" onClick={() => setProfitOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', padding: '7px 11px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}><Calculator size={14} />成本与利润</button>
          </div>
        </div>
        {!draft.items.length && <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>尚未添加产品，点击“填写订单详情”选择客户产品并填写数量与单价。</span>}
      </section>

      <div className="order-form-grid order-form-grid-attachments">
        <ImagePasteUpload value={draft.paymentProofs} onChange={(proofs) => update('paymentProofs', proofs as PaymentProofDraft[])} />
        <section onPaste={onContractPaste} tabIndex={0} className={contractDragging ? 'attachment-drop-section is-drop-target' : 'attachment-drop-section'} style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface-subtle)' }} {...contractDropHandlers}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><label style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600 }}>订单附件</label><label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: '6px 9px', color: 'var(--color-accent)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: 12 }} onClick={openContractPicker}><Plus size={14} />选择附件<input ref={contractInputRef} type="file" multiple accept={contractAccept} aria-label="选择订单附件" onChange={(event) => { addContractFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} style={{ display: 'none' }} /></label></div>
          <div style={{ display: 'grid', gap: 5 }}>{(draft.contracts ?? []).map((contract) => <div key={contract.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface)' }}>{isImageContract(contract) && contract.url ? <img src={contract.url} alt={contract.name} style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 'var(--radius-ui)' }} /> : <FileText size={22} color="var(--color-text-secondary)" />}<div style={{ minWidth: 0, flex: 1 }}><div title={contract.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text)', fontSize: 12 }}>{contract.name}</div><span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{formatFileSize(contract.size)}{contract.file ? ' · 待上传' : contract.createdAt ? ` · ${contract.createdAt.replace('T', ' ').slice(0, 16)}` : ''}</span></div><button type="button" title="移除附件" onClick={() => removeContract(contract)} style={{ display: 'inline-flex', border: 0, background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}><Trash2 size={14} /></button></div>)}{customerProductAttachments.map((attachment) => <div key={`product-${attachment.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '6px 8px', border: '1px solid var(--color-accent-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-accent-soft)' }}><FileText size={18} color="var(--color-accent)" /><div style={{ minWidth: 0, flex: 1 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text)', fontSize: 12 }}>{attachment.originalName}</div><span style={{ color: 'var(--color-accent)', fontSize: 11 }}>{customerAttachmentLabel(attachment.category)} · 保存订单后归档</span></div>{attachment.url && <a href={attachment.url} target="_blank" rel="noreferrer" title="打开客户产品附件" style={{ color: 'var(--color-accent)' }}><ExternalLink size={14} /></a>}<a href={attachment.url} download={attachment.originalName} title="下载客户产品附件" style={{ color: 'var(--color-text-secondary)' }}><Download size={14} /></a></div>)}{!(draft.contracts ?? []).length && !customerProductAttachments.length && <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>暂无订单附件；客户产品附件会在保存订单时归档到订单附件。也可直接 Ctrl+V 粘贴或把文件拖进来。</span>}</div>
        </section>
      </div>
      <label style={labelStyle}>订单备注<textarea rows={2} style={{ ...controlStyle, resize: 'vertical' }} value={draft.remark} onChange={(event) => update('remark', event.target.value)} placeholder="付款阶段、特殊要求等" /></label>
      {draft.id && draft.status !== 'draft' && <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 11, lineHeight: 1.5 }}>修改产品明细、数量、装箱数、箱唛要求或详情说明会按新明细重排箱唛；只改附件、金额不影响现有箱唛。</p>}
      <div className="order-form-actions">{onSaveDraft && <button type="button" className="button button-secondary" onClick={submitDraft} title="保存为草稿，信息可暂不完整，稍后继续编辑">存草稿</button>}<button type="button" className="button button-secondary" onClick={onCancel}>取消</button><button type="button" className="button button-primary" onClick={(draft.paymentPolicy ?? 'before_ship') === 'prepay' && onSaveDraft ? submitDraft : submit}>{(draft.paymentPolicy ?? 'before_ship') === 'prepay' ? '存草稿（先款后货）' : submitLabel}</button></div>
      <CustomerProductEditorModal open={newProductOpen} product={null} layer={40} onClose={() => setNewProductOpen(false)} onSave={saveNewProduct} />
      <Modal open={detailOpen} title="填写订单详情" onClose={() => setDetailOpen(false)} width={980}>
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={labelStyle}>详情说明<textarea rows={5} style={{ ...controlStyle, resize: 'vertical' }} value={draft.orderDetail} onChange={(event) => update('orderDetail', event.target.value)} placeholder="记录客户要求、包装方式、交期、颜色、尺寸等订单细节" /></label>
          <ImagePasteUpload label="订单详情图片" value={detailImages} onChange={addDetailImages} onDeleteSaved={removeDetailImage} showNotes={false} />
          <section style={{ display: 'grid', gap: 9, order: -1, borderBottom: '1px solid var(--color-border)', paddingBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><strong style={{ fontSize: 13 }}>产品明细</strong><span style={{ marginLeft: 8, color: 'var(--color-text-muted)', fontSize: 11 }}>金额 = 数量 × 单价，自动汇总</span></div><div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><button type="button" disabled={itemsLocked} title={itemsLocked ? '已有发货记录，产品明细已锁定' : undefined} onClick={() => setSystemPickerOpen((current) => !current)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, color: 'var(--color-accent)', background: 'transparent', cursor: itemsLocked ? 'not-allowed' : 'pointer', opacity: itemsLocked ? .45 : 1, fontSize: 12 }}><Library size={14} />从系统产品库添加</button>{onSaveCustomerProduct && draft.customerId && <button type="button" disabled={itemsLocked} onClick={openNewProduct} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, color: 'var(--color-accent)', background: 'transparent', cursor: itemsLocked ? 'not-allowed' : 'pointer', opacity: itemsLocked ? .45 : 1, fontSize: 12 }}><Plus size={14} />添加新品</button>}</div></div>
            {systemPickerOpen && !itemsLocked && <div style={{ display: 'grid', gap: 7, padding: 9, border: '1px solid var(--color-accent-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-accent-soft)' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong style={{ fontSize: 12, color: 'var(--color-accent)' }}>从系统产品库选择（仅在售产品）</strong><button type="button" onClick={() => setSystemPickerOpen(false)} style={{ border: 0, background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 11 }}>收起</button></div><LibraryProductPicker onSelect={(selection) => { void selectSystemProduct(selection); }} /></div>}
            {itemsLocked
              ? <div style={{ padding: '9px 11px', border: '1px solid var(--color-warning-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-warning-soft)', color: 'var(--color-warning-text)', fontSize: 12 }}>订单已有发货记录，产品明细、数量和价格已锁定；如需修改，请先在订单详情里撤销发货记录。</div>
              : draft.customerId == null && (draft.customerName ?? '').trim()
                ? <div style={{ padding: 14, border: '1px dashed var(--color-border-control)', borderRadius: 'var(--radius-ui)', color: 'var(--color-text-muted)', textAlign: 'center', fontSize: 12 }}>临时客户暂不能用客户产品库，可从系统产品库选品或手填行；转正后可存入客户产品库。</div>
                : <CustomerProductPicker customerId={draft.customerId ?? null} onSelect={selectProduct} onAddNew={onSaveCustomerProduct && draft.customerId ? openNewProduct : undefined} />}
            <div className={itemsLocked ? 'order-items-locked' : undefined} style={{ display: 'grid', gap: 7 }}>{draft.items.length > 0 && <div className="order-items-head"><span>品名</span><span>SKU</span><span>规格</span><span>数量</span><span>装箱数</span><span>箱数</span><span>单价（元）</span><span>金额</span><span /></div>}{draft.items.map((item) => <div key={item.id} className="order-item-card"><div className="order-item-row"><label className="order-item-cell is-name"><small>品名</small><span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>{item.imageRelativePath && <button type="button" title="查看产品大图" {...bind("/files/" + item.imageRelativePath, item.name)} onClick={() => setZoomImage(`/files/${item.imageRelativePath}`)} style={{ flexShrink: 0, width: 34, height: 34, padding: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface-subtle)', cursor: 'zoom-in', overflow: 'hidden' }}><img src={thumbUrl(`/files/${item.imageRelativePath}`, 240)} alt={item.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></button>}<input aria-label="订单产品品名" value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} style={{ ...controlStyle, flex: 1, minWidth: 0 }} /></span></label><label className="order-item-cell is-sku"><small>SKU</small><input aria-label="订单产品SKU" value={item.sku} onChange={(event) => updateItem(item.id, { sku: event.target.value })} style={controlStyle} /></label><label className="order-item-cell is-spec"><small>规格</small><input aria-label="订单产品规格" value={item.specification} onChange={(event) => updateItem(item.id, { specification: event.target.value })} style={controlStyle} /></label><label className="order-item-cell is-qty"><small>数量</small><input type="number" min="1" aria-label="订购数量" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} style={controlStyle} /></label><label className="order-item-cell is-pack"><small>装箱数</small><input type="number" min="1" aria-label="订单装箱数" value={item.packSize} onChange={(event) => updateItem(item.id, { packSize: Math.max(1, Number(event.target.value) || 1) })} style={controlStyle} /></label><span className="order-item-cell is-boxes"><small>箱数</small><strong>{item.boxes}</strong></span><label className="order-item-cell is-price"><small>单价（元）</small><input type="number" min="0" step="0.01" inputMode="decimal" aria-label="订单产品单价" value={priceInputValue(item)} onChange={(event) => changePriceInput(item.id, event.target.value)} onBlur={() => commitPriceInput(item)} style={controlStyle} /></label><span className="order-item-cell is-amount"><small>金额</small><strong>¥ {((item.amountCents ?? calculateOrderLineAmountCents({ quantity: item.quantity, unitPriceCents: item.unitPriceCents ?? 0 })) / 100).toFixed(2)}</strong></span><button type="button" className="order-item-cell is-remove" title="删除产品" onClick={() => update('items', draft.items.filter((entry) => entry.id !== item.id))} style={{ border: 0, background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}><Trash2 size={14} /></button></div>{item.productId && !item.customerProductId && <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>{draft.customerId ? <button type="button" disabled={savingItemIds.has(item.id)} onClick={() => { void saveItemToCustomerLibrary(item); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--color-accent-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-accent-soft)', color: 'var(--color-accent)', padding: '4px 9px', cursor: savingItemIds.has(item.id) ? 'wait' : 'pointer', fontSize: 11 }}><BookmarkPlus size={13} />{savingItemIds.has(item.id) ? '存入中…' : '存入客户产品库'}</button> : <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>转正后可存入客户产品库</span>}</div>}{(item.remark.trim() || (item.labelRequirement ?? '').trim() || item.customerProductAttachments?.length) ? <div style={{ display: 'grid', gap: 4, padding: '6px 8px', borderLeft: '3px solid var(--color-accent)', background: 'var(--color-accent-soft)', color: 'var(--color-text-secondary)', fontSize: 11 }}><label style={{ display: 'grid', gap: 3 }}><strong style={{ color: 'var(--color-accent)' }}>箱唛要求（印在箱面上）</strong><input aria-label="箱唛要求" value={item.labelRequirement ?? ''} onChange={(event) => updateItem(item.id, { labelRequirement: event.target.value })} placeholder="如：外箱贴条码箱唛" style={{ ...controlStyle, fontSize: 11, padding: '5px 8px' }} /></label>{item.remark.trim() && <div style={{ display: 'grid', gap: 2 }}><strong style={{ color: 'var(--color-text-muted)' }}>内部备注（不打印）</strong><span style={{ whiteSpace: 'pre-wrap' }}>{item.remark}</span></div>}{item.customerProductAttachments?.length ? <span>附件已带入订单：{item.customerProductAttachments.map((attachment) => `${attachment.originalName}`).join('；')}</span> : null}</div> : null}</div>)}{!draft.items.length && <div style={{ padding: 25, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>从上方客户产品库或系统产品库选择产品</div>}<div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 10px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-subtle)', color: 'var(--color-text-secondary)', fontSize: 12 }}><span>产品合计</span><strong style={{ color: 'var(--color-accent)', fontSize: 13 }}>¥ {productAmount}</strong><label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>运费（元）{!shippingOverridden && <small style={{ color: 'var(--color-accent)' }}>自动</small>}<input type="text" inputMode="decimal" aria-label="订单运费" value={shippingInput} onChange={(event) => updateShippingInput(event.target.value)} onBlur={commitShippingInput} style={{ ...controlStyle, width: 92 }} /></label><span>订单金额</span><strong style={{ color: 'var(--color-accent)', fontSize: 14 }}>¥ {calculatedAmount}</strong></div></div>
          </section>
          <div className="order-form-actions"><button type="button" className="button button-primary" onClick={() => setDetailOpen(false)}>完成</button></div>
        </div>
      </Modal>
      <Modal open={profitOpen} title="订单成本与利润" onClose={() => setProfitOpen(false)} width={860}>
        <div className="order-profit-editor-modal">
          <p className="order-cost-hint">成本会随订单一起保存；只有勾选“已核对”的行和整单费用才会计入当月毛利。</p>
          <OrderProfitSummaryCard order={draft} />
          <OrderCostEditor order={draft} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} />
          <section className="order-item-cost-list">
            <div className="order-item-cost-list-head">
              <div><strong>产品单件成本</strong><span>逐行核对机头、电池、充电器、包装、配件和标贴</span></div>
              <span>{draft.items.length} 行</span>
            </div>
            {draft.items.map((item) => <div className="order-item-cost-row" key={item.id}>
              <div className="order-item-cost-row-head">
                <strong>{item.name || '未填产品'}</strong>
                <span>{item.specification || '未填规格'} · {item.quantity} 件</span>
              </div>
              <OrderItemCostEditor item={item} onChange={(patch) => updateItem(item.id, patch)} />
            </div>)}
            {!draft.items.length && <div className="table-state">先添加产品，再填写成本。</div>}
          </section>
          <div className="order-form-actions"><button type="button" className="button button-primary" onClick={() => setProfitOpen(false)}>完成</button></div>
        </div>
      </Modal>
      {zoomImage && <div role="dialog" aria-label="产品大图" onClick={() => setZoomImage(null)} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.82)', display: 'grid', placeItems: 'center', padding: 24, cursor: 'zoom-out' }}><img src={zoomImage} alt="产品大图" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 'var(--radius-ui)' }} /><button type="button" onClick={() => setZoomImage(null)} style={{ position: 'absolute', top: 16, right: 16, border: '1px solid rgba(255,255,255,.4)', borderRadius: 'var(--radius-ui)', background: 'rgba(0,0,0,.4)', color: '#fff', padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>关闭</button></div>}
    </div>
  );
}

export { PackagingTable };
