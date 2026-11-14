import { Download, ExternalLink, FileText, Plus, Trash2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { getNextOrderNumber, deleteOrderDetailImage } from '../api';
import { canPickFilesNatively, pickFilesNatively } from '../app-bridge';
import { CONTRACT_PICKER_ACCEPT, normalizeUploadContract, SUPPORTED_CONTRACT_HINT } from '../contract-mime';
import { attachmentFilesFromClipboard } from '../attachment-mime';
import { useFileDrop } from '../use-file-drop';
import { calculateOrderBoxes } from '../../shared/order-calculations';
import { calculateFreightCents, calculateOrderLineAmountCents, calculateOrderTotalCents } from '../../shared/order-prices';
import { dateInputValue, dateOnlyValue } from '../../shared/date-input';
import { extractRecipientName } from '../order-recipient';
import { ORDER_SETTLEMENT_LABELS, isSettlementType, type OrderSettlementType } from '../../shared/settlement';
import type { Company } from '../../shared/companies';
import type { Customer, CustomerProduct as CustomerProductRecord, CustomerProductAttachment, CustomerProductSaveInput, CustomerSaveInput } from '../../shared/customers';
import ImagePasteUpload, { type ImageAttachment } from './ImagePasteUpload';
import CustomerProductEditorModal from './customer-products/CustomerProductEditorModal';
import CustomerProductPicker from './customer-products/CustomerProductPicker';
import CustomerSelector from './customers/CustomerSelector';
import PackagingTable from './PackagingTable';
import Modal from './Modal';

export type ToastKind = 'success' | 'info' | 'error';
export type OrderStatus = 'draft' | 'label_pending' | 'pending_stock' | 'stock_reported' | 'pending_packing' | 'ship_pending' | 'shipped';

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
  name: string;
  sku: string;
  specification: string;
  quantity: number;
  packSize: number;
  boxes: number;
  unitPriceCents?: number;
  amountCents?: number;
  freightPerBoxCents?: number;
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
  /** 结算方式：corporate 对公（需开票）/ personal 对私（无需开票）。新建默认对私，历史订单按各自已存的值显示。 */
  settlementType?: OrderSettlementType;
  /** 收款/开票公司；对公订单必选，历史订单可能为空。 */
  companyId?: number | null;
  companyName?: string;
  orderDetail: string;
  orderDetailImages: OrderDetailImageDraft[];
  recipientName: string;
  recipientInfo: string;
  amount: string;
  shippingCents?: number;
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

function makeItem(product?: CustomerProductRecord): OrderItemDraft {
  const packSize = Math.max(1, Math.trunc(product?.packCount ?? 1));
  const unitPriceCents = product?.finalPriceCents ?? 0;
  return { id: `item-${Date.now()}-${Math.random().toString(16).slice(2)}`, customerProductId: product?.id ?? null, productId: product?.systemProductId == null ? undefined : String(product.systemProductId), name: product?.name ?? '', sku: product?.sku ?? '', specification: product?.specification ?? '', quantity: 1, packSize, boxes: 1, unitPriceCents, amountCents: unitPriceCents, freightPerBoxCents: product?.freightPerBoxCents ?? 0, remark: product?.remark ?? '', labelRequirement: product?.labelRequirement ?? '', customerProductAttachments: product?.attachments ?? [] };
}

function defaultDraft(value: Partial<OrderDraft> | undefined): OrderDraft {
  return {
    orderNo: value?.orderNo ?? '', orderNoAuto: value?.orderNoAuto ?? (!value?.id && !value?.orderNo), orderedAt: dateOnlyValue(value?.orderedAt ?? dateInputValue()), customerId: value?.customerId ?? null, customerName: value?.customerName ?? '', customerContactName: value?.customerContactName ?? '', customerContactPhone: value?.customerContactPhone ?? '', customerShippingInfo: value?.customerShippingInfo ?? '', settlementType: isSettlementType(value?.settlementType) ? value.settlementType : 'personal', companyId: value?.companyId ?? null, companyName: value?.companyName ?? '', orderDetail: value?.orderDetail ?? '', orderDetailImages: value?.orderDetailImages ?? [], recipientName: value?.recipientName ?? '', recipientInfo: value?.recipientInfo ?? '', amount: value?.amount ?? '', shippingCents: value?.shippingCents ?? 0, trackingNo: value?.trackingNo ?? '', paymentNote: value?.paymentNote ?? '', paymentProofs: value?.paymentProofs ?? [], remark: value?.remark ?? '', items: value?.items ?? [], contracts: value?.contracts ?? [], deletedContractIds: value?.deletedContractIds ?? [], status: value?.status ?? 'pending_stock', id: value?.id,
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

export default function OrderForm({ value, customers, companies = [], onSubmit, onCancel, onSaveDraft, onSaveCustomerProduct, onCreateCustomer, submitLabel = '保存订单', onGetNextOrderNumber }: OrderFormProps) {
  const [draft, setDraft] = useState<OrderDraft>(() => defaultDraft(value));
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
      items: customerId && customerId !== current.customerId
        ? current.items.map((item) => ({ ...item, customerProductId: null }))
        : current.items,
    };
  });
  const selectProduct = (product: CustomerProductRecord) => setDraft((current) => ({ ...current, items: [...current.items, makeItem(product)] }));
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
          <CustomerSelector value={draft.customerId ?? null} customers={customers} onChange={selectCustomer} onCreateCustomer={onCreateCustomer} />
          <label style={labelStyle}>订单号<input style={controlStyle} value={draft.orderNo} onChange={(event) => { const orderNo = event.target.value; update('orderNo', orderNo); update('orderNoAuto', !orderNo.trim()); }} placeholder="自动生成，可手动修改" /></label>
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
          {(draft.settlementType ?? 'personal') !== 'personal' && <label style={labelStyle}>收款/开票公司<select aria-label="收款/开票公司" style={controlStyle} value={draft.companyId ?? ''} onChange={(event) => {
            const companyId = event.target.value ? Number(event.target.value) : null;
            const company = companies.find((item) => item.id === companyId);
            update('companyId', companyId);
            update('companyName', company?.shortName ?? '');
          }}>
            <option value="">请选择公司</option>
            {companies.filter((company) => company.isActive || company.id === draft.companyId).map((company) => <option key={company.id} value={company.id}>{company.shortName}{company.isActive ? '' : '（已停用）'}</option>)}
          </select></label>}
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
          <button type="button" onClick={() => setDetailOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-ui)', background: 'var(--color-accent-soft)', color: 'var(--color-accent)', padding: '7px 11px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}><FileText size={14} />填写订单详情</button>
        </div>
        {!draft.items.length && <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>尚未添加产品，点击“填写订单详情”选择客户产品并填写数量与单价。</span>}
      </section>

      <div className="order-form-grid order-form-grid-attachments">
        <ImagePasteUpload value={draft.paymentProofs} onChange={(proofs) => update('paymentProofs', proofs as PaymentProofDraft[])} />
        <section onPaste={onContractPaste} tabIndex={0} className={contractDragging ? 'attachment-drop-section is-drop-target' : 'attachment-drop-section'} style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface-subtle)' }} {...contractDropHandlers}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><label style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600 }}>订单附件</label><label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: '6px 9px', color: 'var(--color-accent)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: 12 }} onClick={openContractPicker}><Plus size={14} />选择附件<input ref={contractInputRef} type="file" multiple accept={contractAccept} aria-label="选择订单附件" onChange={(event) => { addContractFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} style={{ display: 'none' }} /></label></div>
          <div style={{ display: 'grid', gap: 5 }}>{(draft.contracts ?? []).map((contract) => <div key={contract.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface)' }}>{isImageContract(contract) && contract.url ? <img src={contract.url} alt={contract.name} style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 'var(--radius-ui)' }} /> : <FileText size={22} color="var(--color-text-secondary)" />}<div style={{ minWidth: 0, flex: 1 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text)', fontSize: 12 }}>{contract.name}</div><span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{formatFileSize(contract.size)}{contract.file ? ' · 待上传' : contract.createdAt ? ` · ${contract.createdAt.replace('T', ' ').slice(0, 16)}` : ''}</span></div><button type="button" title="移除附件" onClick={() => removeContract(contract)} style={{ display: 'inline-flex', border: 0, background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}><Trash2 size={14} /></button></div>)}{customerProductAttachments.map((attachment) => <div key={`product-${attachment.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '6px 8px', border: '1px solid var(--color-accent-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-accent-soft)' }}><FileText size={18} color="var(--color-accent)" /><div style={{ minWidth: 0, flex: 1 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text)', fontSize: 12 }}>{attachment.originalName}</div><span style={{ color: 'var(--color-accent)', fontSize: 11 }}>{customerAttachmentLabel(attachment.category)} · 保存订单后归档</span></div>{attachment.url && <a href={attachment.url} target="_blank" rel="noreferrer" title="打开客户产品附件" style={{ color: 'var(--color-accent)' }}><ExternalLink size={14} /></a>}<a href={attachment.url} download={attachment.originalName} title="下载客户产品附件" style={{ color: 'var(--color-text-secondary)' }}><Download size={14} /></a></div>)}{!(draft.contracts ?? []).length && !customerProductAttachments.length && <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>暂无订单附件；客户产品附件会在保存订单时归档到订单附件。也可直接 Ctrl+V 粘贴或把文件拖进来。</span>}</div>
        </section>
      </div>
      <label style={labelStyle}>订单备注<textarea rows={2} style={{ ...controlStyle, resize: 'vertical' }} value={draft.remark} onChange={(event) => update('remark', event.target.value)} placeholder="付款阶段、特殊要求等" /></label>
      <div className="order-form-actions">{onSaveDraft && <button type="button" className="button button-secondary" onClick={submitDraft} title="保存为草稿，信息可暂不完整，稍后继续编辑">存草稿</button>}<button type="button" className="button button-secondary" onClick={onCancel}>取消</button><button type="button" className="button button-primary" onClick={submit}>{submitLabel}</button></div>
      <CustomerProductEditorModal open={newProductOpen} product={null} layer={40} onClose={() => setNewProductOpen(false)} onSave={saveNewProduct} />
      <Modal open={detailOpen} title="填写订单详情" onClose={() => setDetailOpen(false)} width={980}>
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={labelStyle}>详情说明<textarea rows={5} style={{ ...controlStyle, resize: 'vertical' }} value={draft.orderDetail} onChange={(event) => update('orderDetail', event.target.value)} placeholder="记录客户要求、包装方式、交期、颜色、尺寸等订单细节" /></label>
          <ImagePasteUpload label="订单详情图片" value={detailImages} onChange={addDetailImages} onDeleteSaved={removeDetailImage} showNotes={false} />
          <section style={{ display: 'grid', gap: 9, order: -1, borderBottom: '1px solid var(--color-border)', paddingBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><strong style={{ fontSize: 13 }}>产品明细</strong><span style={{ marginLeft: 8, color: 'var(--color-text-muted)', fontSize: 11 }}>金额 = 数量 × 单价，自动汇总</span></div>{onSaveCustomerProduct && draft.customerId && <button type="button" onClick={openNewProduct} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, color: 'var(--color-accent)', background: 'transparent', cursor: 'pointer', fontSize: 12 }}><Plus size={14} />添加新品</button>}</div>
            <CustomerProductPicker customerId={draft.customerId ?? null} onSelect={selectProduct} onAddNew={onSaveCustomerProduct && draft.customerId ? openNewProduct : undefined} />
            <div style={{ display: 'grid', gap: 7 }}>{draft.items.length > 0 && <div className="order-items-head"><span>品名</span><span>SKU</span><span>规格</span><span>数量</span><span>装箱数</span><span>箱数</span><span>单价（元）</span><span>金额</span><span /></div>}{draft.items.map((item) => <div key={item.id} className="order-item-card"><div className="order-item-row"><label className="order-item-cell is-name"><small>品名</small><input aria-label="订单产品品名" value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} style={controlStyle} /></label><label className="order-item-cell is-sku"><small>SKU</small><input aria-label="订单产品SKU" value={item.sku} onChange={(event) => updateItem(item.id, { sku: event.target.value })} style={controlStyle} /></label><label className="order-item-cell is-spec"><small>规格</small><input aria-label="订单产品规格" value={item.specification} onChange={(event) => updateItem(item.id, { specification: event.target.value })} style={controlStyle} /></label><label className="order-item-cell is-qty"><small>数量</small><input type="number" min="1" aria-label="订购数量" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} style={controlStyle} /></label><label className="order-item-cell is-pack"><small>装箱数</small><input type="number" min="1" aria-label="订单装箱数" value={item.packSize} onChange={(event) => updateItem(item.id, { packSize: Math.max(1, Number(event.target.value) || 1) })} style={controlStyle} /></label><span className="order-item-cell is-boxes"><small>箱数</small><strong>{item.boxes}</strong></span><label className="order-item-cell is-price"><small>单价（元）</small><input type="number" min="0" step="0.01" inputMode="decimal" aria-label="订单产品单价" value={priceInputValue(item)} onChange={(event) => changePriceInput(item.id, event.target.value)} onBlur={() => commitPriceInput(item)} style={controlStyle} /></label><span className="order-item-cell is-amount"><small>金额</small><strong>¥ {((item.amountCents ?? calculateOrderLineAmountCents({ quantity: item.quantity, unitPriceCents: item.unitPriceCents ?? 0 })) / 100).toFixed(2)}</strong></span><button type="button" className="order-item-cell is-remove" title="删除产品" onClick={() => update('items', draft.items.filter((entry) => entry.id !== item.id))} style={{ border: 0, background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}><Trash2 size={14} /></button></div>{(item.remark.trim() || (item.labelRequirement ?? '').trim() || item.customerProductAttachments?.length) ? <div style={{ display: 'grid', gap: 4, padding: '6px 8px', borderLeft: '3px solid var(--color-accent)', background: 'var(--color-accent-soft)', color: 'var(--color-text-secondary)', fontSize: 11 }}><label style={{ display: 'grid', gap: 3 }}><strong style={{ color: 'var(--color-accent)' }}>箱唛要求（印在箱面上）</strong><input aria-label="箱唛要求" value={item.labelRequirement ?? ''} onChange={(event) => updateItem(item.id, { labelRequirement: event.target.value })} placeholder="如：外箱贴条码箱唛" style={{ ...controlStyle, fontSize: 11, padding: '5px 8px' }} /></label>{item.remark.trim() && <div style={{ display: 'grid', gap: 2 }}><strong style={{ color: 'var(--color-text-muted)' }}>内部备注（不打印）</strong><span style={{ whiteSpace: 'pre-wrap' }}>{item.remark}</span></div>}{item.customerProductAttachments?.length ? <span>附件已带入订单：{item.customerProductAttachments.map((attachment) => `${attachment.originalName}`).join('；')}</span> : null}</div> : null}</div>)}{!draft.items.length && <div style={{ padding: 25, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>从上方客户产品库选择产品</div>}<div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 10px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-subtle)', color: 'var(--color-text-secondary)', fontSize: 12 }}><span>产品合计</span><strong style={{ color: 'var(--color-accent)', fontSize: 13 }}>¥ {productAmount}</strong><label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>运费（元）{!shippingOverridden && <small style={{ color: 'var(--color-accent)' }}>自动</small>}<input type="text" inputMode="decimal" aria-label="订单运费" value={shippingInput} onChange={(event) => updateShippingInput(event.target.value)} onBlur={commitShippingInput} style={{ ...controlStyle, width: 92 }} /></label><span>订单金额</span><strong style={{ color: 'var(--color-accent)', fontSize: 14 }}>¥ {calculatedAmount}</strong></div></div>
          </section>
          <div className="order-form-actions"><button type="button" className="button button-primary" onClick={() => setDetailOpen(false)}>完成</button></div>
        </div>
      </Modal>
    </div>
  );
}

export { PackagingTable };
