import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent } from 'react';
import { getCategoryAccessoryPrices, listCatalogs, saveCategoryAccessoryPrices, type CatalogSummary } from '../api';
import type { AccessoryPrice } from '../../shared/accessory-prices';
import { Download, ExternalLink, FilePlus2, ClipboardPaste, Play, Plus, Save, Tags, Trash2, Video } from 'lucide-react';
import ImagePasteUpload, { type ImageAttachment } from './ImagePasteUpload';
import VideoPlayerModal from './VideoPlayerModal';
import { canPickFilesNatively, pickFilesNatively } from '../app-bridge';
import { ATTACHMENT_ACCEPT, normalizeUploadAttachment, attachmentFilesFromClipboard, filesFromClipboard, SUPPORTED_ATTACHMENT_HINT } from '../attachment-mime';
import { useFileDrop } from '../use-file-drop';
import { PRODUCT_IMAGE_CATEGORY_OPTIONS } from '../../shared/product-image-categories';
import { DEFAULT_PRODUCT_COLORS, DEFAULT_PRODUCT_PLUGS } from '../../shared/product-options';
import { BATTERY_VOLTAGE_OPTIONS, DEFAULT_BATTERY_VOLTAGE, type BatteryVoltage } from '../../shared/battery-voltage';
import Modal from './Modal';
import PackagingTable from './PackagingTable';
import PurchaseQuotesTable from './PurchaseQuotesTable';
import { blankPackagingRow } from '../packaging-preset';
import { orderCategoriesWithSuggestion, suggestProductCategory } from '../product-category-suggest';
import type { CustomerProduct, PackagingOption } from './OrderForm';
import type { PackagingPreset } from '../../shared/packaging-presets';
import type { ProductStatus } from '../../shared/product-status';
import type { ProductPurchaseQuote } from '../../shared/product-purchase-quotes';
import { blankPurchaseQuote } from '../../shared/product-purchase-quotes';

export interface ProductRecord extends CustomerProduct {
  category: string;
  purchasePrice: string;
  supplier: string;
  /** 系统产品参数；客户产品草稿不填写此字段。 */
  parameters?: string;
  /** 草稿产品允许信息不完整，保存后可继续编辑；停售产品保留资料但不再进新单。 */
  status?: ProductStatus;
  colors: string[];
  batteryPlugs: string[];
  /** 电池电压：决定计算器/图册显示哪些节数的电池（3 节=12V、4 节=16.8V、5 节及以上=21V）。 */
  batteryVoltage?: BatteryVoltage;
  images: ImageAttachment[];
  /** 产品视频：已保存的带 url；本次新选的带 file，保存后进后台上传队列。 */
  videos?: ProductVideo[];
  accessories: string;
  remark: string;
  packaging: PackagingOption[];
  /** 多档采购报价；默认档决定列表价格与客户产品成本价。 */
  purchaseQuotes?: ProductPurchaseQuote[];
  /** 本产品自己的配件价格清单；没动过时为空，详情/计算器沿用类目默认。 */
  accessoryPrices?: AccessoryPrice[];
  /** 服务端标记：已保存过本产品自己的配件清单（含删空）后，不再跟随类目默认。 */
  accessoryPricesCustomized?: boolean;
  /** 客户端会话标记：本次编辑里增/删/改过配件清单，保存产品时才会固化。 */
  accessoryPricesTouched?: boolean;
  attachments: ProductAttachment[];
  /** 落库时间，由服务端 products 表带回；产品库列表按 updatedAt 倒序展示。 */
  createdAt?: string;
  updatedAt?: string;
}

export type ProductAttachmentCategory = 'manual' | 'packaging-design' | 'label-dieline' | 'other';

export interface ProductAttachment {
  id: string;
  category: ProductAttachmentCategory;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt?: string;
  file?: File;
}

/** 产品视频：id 为服务端数字 id 或本地临时 id；新选的视频只有 file，保存后才上传。 */
export interface ProductVideo {
  id: string;
  name: string;
  size: number;
  url: string;
  file?: File;
  /** 服务端压缩状态；本地未上传的草稿没有这个字段。 */
  transcodeStatus?: 'pending' | 'processing' | 'done' | 'failed';
}

export interface ProductEditorProps {
  open: boolean;
  product?: ProductRecord;
  /** 表示当前表单由已有产品复制而来，但仍会创建新产品。 */
  copyMode?: boolean;
  /** 客户产品复用编辑器时隐藏系统产品参数字段。 */
  showParameters?: boolean;
  /** 包装方式预设卡片；为空则不显示。 */
  packagingPresets?: PackagingPreset[];
  /** 保存与图片/附件同步进行中：禁用两个保存按钮，连点会重跑同一份差异同步。 */
  saving?: boolean;
  /** 现有产品的分类，作为分类输入框的候选（仍可自由填写新分类）。 */
  productCategories?: string[];
  /** 颜色 / 插脚候选：只从设置页维护的清单里勾选，不再临时输入。 */
  colorOptions?: string[];
  plugOptions?: string[];
  /** 点「管理预设 ›」时跳到设置页维护，未传则不显示入口。 */
  onManagePresets?: () => void;
  /** 点颜色 / 插脚旁的「管理 ›」时跳到设置页维护，未传则不显示入口。 */
  onManageProductOptions?: () => void;
  onClose: () => void;
  /** options.addToCatalogId：「添加到产品图册」勾选后的目标图册，随保存请求带给服务端追加。 */
  onSave: (product: ProductRecord, mode: 'draft' | 'active', options?: { addToCatalogId?: number }) => void;
  /** 类目配件被改动后静默刷新产品列表：已有产品的固化标记需要跟着更新，详情才不会继续跟随新默认。 */
  onCategoryDefaultsSaved?: () => Promise<void> | void;
}

/** 打开编辑器就摆一行空报价：第一行天然就是默认档，省掉「先点添加报价才能填」。 */
function withFirstQuoteRow(record: ProductRecord): ProductRecord {
  if (record.purchaseQuotes?.length) return record;
  return { ...record, purchaseQuotes: [{ ...blankPurchaseQuote(), isDefault: true }] };
}

function blankProduct(): ProductRecord {
  return { id: `product-${Date.now()}`, name: '', sku: '', specification: '', packCount: 1, parameters: '', packaging: [blankPackagingRow()], remark: '', category: '', purchasePrice: '', supplier: '', purchaseQuotes: [], colors: [], batteryPlugs: [], batteryVoltage: DEFAULT_BATTERY_VOLTAGE, images: [], videos: [], accessories: '', attachments: [], accessoryPrices: [] };
}

const attachmentCategories: Array<{ value: ProductAttachmentCategory; label: string }> = [
  { value: 'manual', label: '电子说明书' },
  { value: 'packaging-design', label: '包装设计图' },
  { value: 'label-dieline', label: '标贴刀模' },
  { value: 'other', label: '其他附件' },
];

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const VIDEO_ACCEPT = '.mp4,.mov,.m4v,.webm';
/** 与服务端 ALLOWED_VIDEO_EXTENSIONS 对齐：只认扩展名，不信 MIME（剪贴板文件常无类型）。 */
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'];
/** 与服务端 MAX_VIDEO_SIZE 保持一致：单个视频不超过 200MB。 */
const VIDEO_MAX_SIZE = 200 * 1024 * 1024;
const VIDEO_HINT = '视频支持 MP4、MOV、M4V、WebM 格式';

/** 产品视频区块：手机/电脑选视频，保存后进后台上传队列；已保存的可页内播放。 */
function ProductVideoSection({ value, onChange }: { value: ProductVideo[]; onChange: (next: ProductVideo[]) => void }) {
  const [message, setMessage] = useState('');
  const [playing, setPlaying] = useState<ProductVideo>();
  const [pasteArmed, setPasteArmed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // 点击激活粘贴：section 自身不含可聚焦控件，点击不会自动获得焦点，
  // 靠 onBlur 取消会失效（高亮卡住）。改成监听 document 的 pointerdown：
  // 点在区块外就取消，点区块内则激活。挂载期间监听、卸载时移除，不泄漏。
  useEffect(() => {
    if (!pasteArmed) return;
    const onOutsidePointerDown = (event: PointerEvent) => {
      if (!sectionRef.current?.contains(event.target as Node)) setPasteArmed(false);
    };
    document.addEventListener('pointerdown', onOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', onOutsidePointerDown);
  }, [pasteArmed]);

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    const accepted: ProductVideo[] = [];
    const rejected: string[] = [];
    const wrongType: string[] = [];
    for (const file of files) {
      // 粘贴来的视频常报 application/octet-stream 或空类型，按扩展名判定。
      if (!VIDEO_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))) {
        wrongType.push(file.name);
        continue;
      }
      if (file.size > VIDEO_MAX_SIZE) {
        rejected.push(file.name);
        continue;
      }
      accepted.push({ id: `video-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: file.name, size: file.size, url: '', file });
    }
    if (wrongType.length) setMessage(`${VIDEO_HINT}；已忽略 ${wrongType.length} 个不支持的文件`);
    else if (rejected.length) setMessage(`「${rejected.join('、')}」超过 200MB，请先压缩或剪辑后再传`);
    else setMessage('');
    if (accepted.length) onChange([...value, ...accepted]);
  };

  const pickVideos = () => {
    if (canPickFilesNatively()) {
      const picked = pickFilesNatively(VIDEO_ACCEPT.split(','), true, 5);
      if (picked) {
        void picked.then(addFiles).catch(() => setMessage('视频读取失败，请重试'));
        return;
      }
    }
    inputRef.current?.click();
  };

  // 与产品图片/附件同一套粘贴交互：点进区块后 Ctrl+V 直接入库。
  // 手机端没有键盘，靠「添加视频」按钮；桌面端复制文件后不用先找按钮。
  const onPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const files = filesFromClipboard(event.clipboardData);
    if (!files.length) return; // 纯文本/图片粘贴不拦截，交给浏览器默认行为
    event.preventDefault();
    addFiles(files);
  };

  return <section
    ref={sectionRef}
    className={`section-box product-video-section${pasteArmed ? ' is-paste-armed' : ''}`}
    onPaste={onPaste}
    tabIndex={0}
    // 点击即「激活粘贴」：给一个醒目的高亮，让用户明确知道现在 Ctrl+V 会进到这里。
    // 取消交给 document 上的 pointerdown 监听（点在区块外即取消），见上方 useEffect。
    onClick={() => setPasteArmed(true)}
    aria-label="产品视频，点击后可按 Ctrl+V 粘贴视频"
  >
    <div className="section-box-header"><span className="section-box-title">产品视频</span>
      <button type="button" className="button button-secondary button-sm" onClick={pickVideos}><Video size={14} />添加视频</button>
    </div>
    {value.length ? <div className="product-video-list">{value.map((video) => (
      <div className="product-video-row" key={video.id}>
        <Video size={15} />
        <span className="product-video-name" title={video.name}>{video.name}</span>
        <span className="product-video-size">{formatFileSize(video.size)}</span>
        {video.file
          ? <span className="product-video-pending" title="保存后自动在后台上传">待上传</span>
          : video.transcodeStatus === 'pending'
            ? <span className="product-video-pending" title="已进入压缩队列">待压缩</span>
            : video.transcodeStatus === 'processing'
              ? <span className="product-video-pending" title="服务端正在压缩，期间播放为原画质">压缩中</span>
              : video.transcodeStatus === 'failed'
                ? <span className="product-video-pending" title="压缩失败，保留原文件，播放不受影响">压缩失败</span>
                : <button type="button" className="icon-button" title="播放视频" aria-label={`播放 ${video.name}`} onClick={() => setPlaying(video)}><Play size={14} /></button>}
        <button type="button" className="icon-button danger" title="移除视频" aria-label={`移除 ${video.name}`} onClick={() => onChange(value.filter((item) => item.id !== video.id))}><Trash2 size={14} /></button>
      </div>
    ))}</div> : <div className="empty-state">暂无视频，可添加手机拍的产品实拍视频（单个不超过 200MB）。</div>}
    <div className="image-upload-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ClipboardPaste size={13} /><span>{pasteArmed ? '已激活，现在 Ctrl+V 即可粘贴视频' : '点击本区域后可 Ctrl+V 粘贴视频'}</span></div>
    {message && <div className="image-upload-message" role="status">{message}</div>}
    <input
      ref={inputRef}
      type="file"
      accept={VIDEO_ACCEPT}
      multiple
      hidden
      aria-label="添加产品视频"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        addFiles(files);
      }}
    />
    <VideoPlayerModal open={Boolean(playing)} title={playing?.name} src={playing?.url} onClose={() => setPlaying(undefined)} />
  </section>;
}

/**
 * 「类目配件」弹层：维护新产品的预填模板（服务端按类目存一份）；
 * 每行末尾的加号同时支持把该条单独加入当前产品草稿，点加号不会保存模板。
 * 保存模板时服务端先把旧模板固化给仍在跟随它的已有产品，所以已有产品保持原样，
 * 新模板只对之后新建的产品生效。
 */
function CategoryAccessoryDefaultsModal({ open, category, onClose, onSaved, addedNames = [], onAddToProduct }: {
  open: boolean;
  category: string;
  onClose: () => void;
  /** 模板保存成功后：已有产品已被服务端固化，通知外层静默刷新产品列表。 */
  onSaved?: () => Promise<void> | void;
  /** 当前产品已有配件名称：同名的加号置灰，避免重复加入。 */
  addedNames?: string[];
  /** 把某一条类目配件加入当前产品草稿；只动产品，不保存类目模板。 */
  onAddToProduct?: (item: AccessoryPrice) => void;
}) {
  const [items, setItems] = useState<AccessoryPrice[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [addMessage, setAddMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');

  useEffect(() => {
    if (!open || !category) return;
    let cancelled = false;
    setLoading(true);
    setMessage('');
    setAddMessage('');
    setDirty(false);
    getCategoryAccessoryPrices(category)
      .then((list) => { if (!cancelled) setItems(list); })
      .catch(() => { if (!cancelled) { setItems([]); setMessageKind('error'); setMessage('类目配件加载失败'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, category]);

  const update = (id: string, patch: Partial<Pick<AccessoryPrice, 'name' | 'price' | 'weight'>>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      setItems(await saveCategoryAccessoryPrices(category, items));
      setDirty(false);
      // 刷新产品列表让「已固化」标记生效；刷新失败不影响模板已经保存成功。
      try { await onSaved?.(); } catch { /* 忽略 */ }
      setMessageKind('success');
      setMessage(`已保存「${category}」的类目配件`);
    } catch (error) {
      setMessageKind('error');
      setMessage((error as { message?: string })?.message ?? '类目配件保存失败');
    } finally {
      setBusy(false);
    }
  };

  return <Modal open={open} title={`类目配件 · ${category}`} onClose={onClose} width={560} footer={<>
    <button className="button button-secondary" type="button" onClick={onClose}>关闭</button>
    <button className="button button-primary" type="button" disabled={busy || loading || !dirty} onClick={() => void save()}>{busy ? '保存中...' : '保存类目配件'}</button>
  </>}>
    <div style={{ display: 'grid', gap: 10 }}>
      <p className="label-hint" style={{ margin: 0 }}>点每行末尾的加号，可把这一条单独加入当前产品（随「保存产品」一起生效）。保存类目配件只影响以后新建的产品；已有产品的配件清单保持原样。</p>
      <div className="section-box-header"><span className="section-box-title">类目配件清单</span>
        <button className="link-button packaging-table-add" type="button" disabled={loading || busy} onClick={() => { setItems((current) => [...current, { id: `def-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: '', price: 0 }]); setDirty(true); }}><Plus size={14} />添加</button>
      </div>
      {loading && <div className="table-state">正在加载...</div>}
      {!loading && !!items.length && <div className="packaging-table-shell">
        <table className="packaging-table accessory-prices-table category-accessory-defaults-table">
          <thead><tr>{['名称', '价格', '重量 kg', '操作'].map((title, index) => <th key={index}>{title}</th>)}</tr></thead>
          <tbody>{items.map((item, index) => {
            const label = item.name.trim() || `第 ${index + 1} 条`;
            const added = addedNames.includes(item.name.trim());
            const canAdd = !added && Boolean(item.name.trim());
            return <tr key={item.id || index}>
              <td className="packaging-table-col-size">
                <input className="input packaging-table-input" aria-label={`类目配件${index + 1}名称`} value={item.name} placeholder="如：9 件套筒" onChange={(event) => update(item.id, { name: event.target.value })} />
              </td>
              <td className="packaging-table-col-price">
                <input className="input packaging-table-input" type="number" min={0} step="0.01" aria-label={`类目配件${index + 1}价格`} value={item.price} placeholder="元" onChange={(event) => update(item.id, { price: Number(event.target.value) || 0 })} />
              </td>
              <td className="packaging-table-col-weight">
                <input className="input packaging-table-input" type="number" min={0} step="0.01" aria-label={`类目配件${index + 1}重量`} value={item.weight ?? ''} placeholder="kg" onChange={(event) => update(item.id, { weight: Number(event.target.value) || 0 })} />
              </td>
              <td className="packaging-table-col-actions">
                <span className="category-accessory-defaults-actions">
                  <button
                    className="icon-button"
                    type="button"
                    title={canAdd ? '把这条加入当前产品' : added ? '当前产品已有同名配件' : '先填写配件名称'}
                    aria-label={canAdd ? `把「${label}」加入当前产品` : added ? `「${label}」已在当前产品` : `第 ${index + 1} 条还没有名称`}
                    disabled={!canAdd}
                    onClick={() => { onAddToProduct?.(item); setAddMessage(`已把「${label}」加入当前产品；保存产品后生效（类目模板不受影响）`); }}
                  ><Plus size={14} /></button>
                  <button className="icon-button danger" type="button" title="移除这条默认配件" aria-label={`移除第 ${index + 1} 条默认配件`} onClick={() => { setItems((current) => current.filter((entry) => entry.id !== item.id)); setDirty(true); }}><Trash2 size={14} /></button>
                </span>
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
      {!loading && !items.length && <div className="empty-state">还没有默认配件，点上方「添加」。</div>}
      {!!addMessage && <p className="label-hint product-accessory-message" role="status">{addMessage}</p>}
      {!!message && <p role="status" style={{ margin: 0, fontSize: 12, color: messageKind === 'error' ? 'var(--tone-danger-text)' : '#0f766e' }}>{message}</p>}
    </div>
  </Modal>;
}

/**
 * 本产品的配件：随产品一起保存（「保存产品」时固化到本产品，不再写类目共享清单）。
 * 产品没动过这份清单时，第一次打开自动把类目配件连价格、重量带出来；动过并保存后即以本产品为准。
 * 「类目配件」按钮维护该类目的预填清单；弹层里每条末尾的加号把单条加入本产品。
 * 价格与重量都会进售价计算器：价格计入成本，重量计入实重与运费。
 */
function CategoryAccessoryPricesEditor({ category, value, customized, onSeed, onEdit, onDefaultsSaved }: {
  category: string;
  value: AccessoryPrice[];
  customized: boolean;
  /** 自动带出类目配件（不改「动过」标记）：产品还没固化过清单时才发生。 */
  onSeed: (next: AccessoryPrice[]) => void;
  /** 用户增/删/改：保存产品时会把这时的清单固化为本产品自己的。 */
  onEdit: (next: AccessoryPrice[]) => void;
  /** 类目配件模板保存后：静默刷新产品列表，让已有产品的固化状态立即生效。 */
  onDefaultsSaved?: () => Promise<void> | void;
}) {
  const key = category.trim();
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [seedMessage, setSeedMessage] = useState('');
  const seededRef = useRef<string | null>(null);
  const touchedRef = useRef(false);

  // 第一次打开（产品还没固化过清单）：把类目配件连价格一起带出来；用户动过之后就不再覆盖。
  useEffect(() => {
    if (customized || !key || seededRef.current === key) return;
    let cancelled = false;
    setLoading(true);
    getCategoryAccessoryPrices(key)
      .then((items) => {
        if (cancelled) return;
        seededRef.current = key;
        if (touchedRef.current) return;
        const rows = items.filter((item) => item.name.trim()).map((item) => ({ ...item }));
        if (rows.length) onSeed(rows);
      })
      .catch(() => { /* 带不出来就保持空表，手填即可 */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [customized, key]);

  const update = (id: string, patch: Partial<Pick<AccessoryPrice, 'name' | 'price' | 'weight'>>) => {
    touchedRef.current = true;
    setSeedMessage('');
    onEdit(value.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const add = () => {
    touchedRef.current = true;
    setSeedMessage('');
    onEdit([...value, { id: `acc-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: '', price: 0 }]);
  };
  const remove = (id: string) => {
    touchedRef.current = true;
    setSeedMessage('');
    onEdit(value.filter((item) => item.id !== id));
  };

  /** 从「类目配件」弹层加入单条：同名已在产品里时跳过，保留本产品现有价格与重量。 */
  const addOneFromCategory = (item: AccessoryPrice) => {
    const name = item.name.trim();
    if (!name || value.some((entry) => entry.name.trim() === name)) return;
    touchedRef.current = true;
    setSeedMessage(`已加入「${name}」，保存产品后生效`);
    onEdit([...value, { ...item, id: `acc-${Date.now()}-${Math.random().toString(16).slice(2)}` }]);
  };

  // 与左侧采购报价同款：共用 packaging-table-section（无灰底无边框），并排时两边视觉一致。
  return <section className="packaging-table-section accessory-prices-section">
    <div className="section-box-header"><span className="section-box-title">配件</span>
      {!!key && <span className="product-accessory-actions">
        <button className="button button-secondary button-sm" type="button" title="查看/维护该类目的预填配件，并可把单条加入本产品" onClick={() => setDefaultsOpen(true)}><Tags size={14} />类目配件</button>
        <button className="link-button packaging-table-add" type="button" title="添加一条配件" onClick={add}><Plus size={14} />添加</button>
      </span>}
    </div>
    {!!seedMessage && <p className="label-hint product-accessory-message" role="status">{seedMessage}</p>}
    {key ? <>
      {loading && <div className="table-state">正在加载...</div>}
      {!loading && !!value.length && <div className="packaging-table-shell">
        <table className="packaging-table accessory-prices-table">
          <thead><tr>{['名称', '价格', '重量 kg', ''].map((title, index) => <th key={index}>{title}</th>)}</tr></thead>
          <tbody>{value.map((item, index) => <tr key={item.id || index}>
            <td className="packaging-table-col-size">
              <input className="input packaging-table-input" aria-label={`产品配件${index + 1}名称`} value={item.name} placeholder="如：9 件套筒" onChange={(event) => update(item.id, { name: event.target.value })} />
            </td>
            <td className="packaging-table-col-price">
              <input className="input packaging-table-input" type="number" min={0} step="0.01" aria-label={`产品配件${index + 1}价格`} value={item.price} placeholder="元" onChange={(event) => update(item.id, { price: Number(event.target.value) || 0 })} />
            </td>
            <td className="packaging-table-col-weight">
              <input className="input packaging-table-input" type="number" min={0} step="0.01" aria-label={`产品配件${index + 1}重量`} value={item.weight ?? ''} placeholder="kg" onChange={(event) => update(item.id, { weight: Number(event.target.value) || 0 })} />
            </td>
            <td className="packaging-table-col-actions">
              <button className="icon-button danger" type="button" title="移除这条配件" aria-label={`移除第 ${index + 1} 条产品配件`} onClick={() => remove(item.id)}><Trash2 size={14} /></button>
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
      {!loading && !value.length && <div className="empty-state">本产品还没有配件，点右上角「添加」，或在「类目配件」里点加号加入本产品。</div>}
      <CategoryAccessoryDefaultsModal
        open={defaultsOpen}
        category={key}
        onClose={() => setDefaultsOpen(false)}
        onSaved={onDefaultsSaved}
        addedNames={value.map((item) => item.name.trim()).filter(Boolean)}
        onAddToProduct={addOneFromCategory}
      />
    </> : <span className="label-hint">先在上方填写「产品分类」；填好后会自动带出该类目的配件（可增删改，随产品一起保存）。</span>}
  </section>;
}

function ProductAttachments({ value, onChange }: { value: ProductAttachment[]; onChange: (next: ProductAttachment[]) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const appendFiles = (files: File[]) => {
    if (!files.length) return;
    // 按扩展名归一化 MIME：粘贴/拖来的文件常没有类型，不回写会让存下来的附件类型与内容不符。
    const accepted = files.map(normalizeUploadAttachment).filter((file): file is File => Boolean(file));
    if (accepted.length < files.length) setMessage(`${SUPPORTED_ATTACHMENT_HINT}；已忽略 ${files.length - accepted.length} 个不支持的文件`);
    else setMessage('');
    if (!accepted.length) return;
    onChange([...value, ...accepted.map((file) => ({ id: `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`, category: 'manual' as ProductAttachmentCategory, name: file.name, url: URL.createObjectURL(file), mimeType: file.type, size: file.size, file }))]);
  };
  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    appendFiles(files);
  };
  const onPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const files = attachmentFilesFromClipboard(event.clipboardData);
    if (!files.length) return; // 纯文本粘贴不拦截
    event.preventDefault();
    appendFiles(files);
  };
  const { dragging, handlers } = useFileDrop(appendFiles);
  return <section className={`product-editor-attachments${dragging ? ' is-drop-target' : ''}`} onPaste={onPaste} tabIndex={0} {...handlers}>
    <div className="section-box-header"><span className="section-box-title">产品附件</span>
      {/* 原来是 <label> 包一个 hidden 的 file input：hidden 等于 display:none，
          在 Android WebView 里点这个按钮不会有任何反应（选图/选文件界面都不弹出）。
          透明 input 铺满 + 兜底 click() 只是保底；App 内优先走原生选择器桥，
          彻底绕开 WebView file input 这条在部分 ROM 上静默失效的激活链。 */}
      <div
        className="button button-secondary button-sm product-editor-file-button"
        style={{ position: 'relative', overflow: 'hidden' }}
        onClick={(event) => {
          // 落点是 input 本身：无桥环境的真实点击，或下方兜底的程序化 click() 冒泡回来，
          // 都必须直接放行让默认行为发生（否则会把合成点击也 preventDefault 掉）。
          if (event.target === fileInputRef.current) return;
          // App 内优先原生选择器，绕开 WebView file input 这条在部分 ROM 上静默失效的激活链。
          if (canPickFilesNatively()) {
            event.preventDefault();
            const picked = pickFilesNatively(ATTACHMENT_ACCEPT.split(','), true, 20);
            if (picked) {
              void picked.then(appendFiles).catch(() => {});
              return;
            }
          }
          fileInputRef.current?.click();
        }}
      ><FilePlus2 size={14} />添加附件
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          onChange={addFiles}
          aria-label="添加附件"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 1, pointerEvents: canPickFilesNatively() ? 'none' : 'auto' }}
        />
      </div>
    </div>
    {value.length ? <div className="product-editor-attachment-list">{value.map((attachment) => <div key={attachment.id} className="attachment-row"><div className="attachment-main"><div className="attachment-name" title={attachment.name}>{attachment.name}</div><span className="attachment-meta">{formatFileSize(attachment.size)}{attachment.createdAt ? ` · ${attachment.createdAt.replace('T', ' ').slice(0, 16)}` : ''}</span></div><select className="product-editor-attachment-category" aria-label={`${attachment.name}附件类型`} value={attachment.category} onChange={(event) => onChange(value.map((item) => item.id === attachment.id ? { ...item, category: event.target.value as ProductAttachmentCategory } : item))}>{attachmentCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>{attachment.url && !attachment.file && <span className="attachment-actions"><a href={attachment.url} target="_blank" rel="noreferrer" title="打开附件"><ExternalLink size={14} /></a><a href={attachment.url} download={attachment.name} title="下载附件"><Download size={14} /></a></span>}{attachment.file && <span className="attachment-pending" title="待保存">待上传</span>}<button type="button" className="icon-button danger" title="移除附件" onClick={() => onChange(value.filter((item) => item.id !== attachment.id))}><Trash2 size={14} /></button></div>)}</div> : <div className="empty-state">暂无附件，可添加说明书、包装设计图或标贴刀模。</div>}
    {message && <div className="image-upload-message" role="status" aria-live="polite">{message}</div>}
    <span className="label-hint">支持 PDF、Office、图片、压缩包及常见设计源文件，单个附件不超过 20MB；也可直接 Ctrl+V 粘贴或把文件拖进来。</span>
  </section>;
}

export default function ProductEditor({ open, product, copyMode = false, showParameters: showParametersProp, packagingPresets, saving = false, productCategories = [], colorOptions, plugOptions, onManagePresets, onManageProductOptions, onClose, onSave, onCategoryDefaultsSaved }: ProductEditorProps) {
  const [draft, setDraft] = useState<ProductRecord>(() => withFirstQuoteRow(product ?? blankProduct()));
  const [catalogs, setCatalogs] = useState<CatalogSummary[]>([]);
  const [addToCatalog, setAddToCatalog] = useState(false);
  const [catalogId, setCatalogId] = useState<number | null>(null);
  const showParameters = showParametersProp ?? Object.prototype.hasOwnProperty.call(draft, 'parameters');
  useEffect(() => {
    if (!open) return;
    const nextDraft = withFirstQuoteRow(product ?? blankProduct());
    // 复制产品时，源产品的配件清单算「这次动过」：副本应保留清单，而不是回落到类目默认。
    if (copyMode && nextDraft.accessoryPrices?.length) nextDraft.accessoryPricesTouched = true;
    setDraft(nextDraft);
    // 「添加到产品图册」每次打开都重置为未勾选（只负责加入、默认不产生副作用），
    // 图册列表现取最新，默认选第一条（在用的主图册）。
    setAddToCatalog(false);
    setCatalogId(null);
    let cancelled = false;
    listCatalogs()
      .then((items) => {
        if (cancelled) return;
        setCatalogs(items);
        setCatalogId(items[0]?.id ?? null);
      })
      .catch(() => { if (!cancelled) setCatalogs([]); });
    return () => { cancelled = true; };
  }, [open, product]);
  const set = <K extends keyof ProductRecord>(key: K, next: ProductRecord[K]) => setDraft((current) => ({ ...current, [key]: next }));
  const toggle = (key: 'colors' | 'batteryPlugs', item: string) => set(key, draft[key].includes(item) ? draft[key].filter((entry) => entry !== item) : [...draft[key], item]);
  // 候选 = 设置页清单 + 本产品已有但清单里没有的值。
  // 后者必须保留：老产品存过的颜色/插脚如果在清单里被删了，仍要能看见、默认不丢，
  // 否则一打开编辑器就会把历史值悄悄清掉（即使这次只想改个品名）。
  const colors = (colorOptions ?? DEFAULT_PRODUCT_COLORS);
  const plugs = (plugOptions ?? DEFAULT_PRODUCT_PLUGS);
  const colorChoices = colors.concat(draft.colors.filter((item) => !colors.includes(item)));
  const plugChoices = plugs.concat(draft.batteryPlugs.filter((item) => !plugs.includes(item)));
  const editingExisting = Boolean(product && /^\d+$/.test(product.id));
  const editingDraft = editingExisting && product?.status === 'draft';
  const saveDraft = () => onSave({ ...draft, status: 'draft' }, 'draft');
  // 勾选框只对「保存产品」生效；存为草稿不进图册（草稿不进客户图册）。
  const saveActive = () => onSave(
    { ...draft, status: 'active' },
    'active',
    addToCatalog && catalogId ? { addToCatalogId: catalogId } : undefined,
  );
  // 分类只做建议：按品名里出现的最长现有分类名判定，点「建议」才写入，绝不自动覆盖人工填的值。
  // 报价数组是采购价与供应商的唯一入口，默认档那一条会写回 products 的镜像列。
  const purchaseQuotes = draft.purchaseQuotes ?? [];
  const categorySuggestion = suggestProductCategory(draft.name, productCategories);
  const categoryCandidates = orderCategoriesWithSuggestion(productCategories, categorySuggestion);
  /** 当前产品自身的分类（包装管理「可以装哪些产品」的匹配依据）。 */
  const activeProductCategories = (draft.category ?? '').trim() ? [String(draft.category).trim()] : [];
  return <Modal open={open} title={copyMode ? '复制产品（新建）' : editingDraft ? '编辑产品（草稿）' : editingExisting ? '编辑产品' : '添加产品'} onClose={onClose} width={900} footer={<div className="product-editor-footer">
    {catalogs.length > 0 && <label className="product-editor-catalog-add" title="勾选后点「保存产品」，本产品会加入所选图册；已在图册中不会重复加，移出仍去图册模块操作">
      <input type="checkbox" aria-label="添加到产品图册" checked={addToCatalog} disabled={saving} onChange={(event) => setAddToCatalog(event.target.checked)} />
      <span>添加到产品图册</span>
      <select className="product-editor-catalog-select" aria-label="选择要加入的图册" value={catalogId ?? ''} disabled={saving} onChange={(event) => setCatalogId(Number(event.target.value) || null)}>
        {catalogs.map((catalog) => <option key={catalog.id} value={catalog.id}>{catalog.name}{catalog.enabled ? '' : '（已停用）'}</option>)}
      </select>
    </label>}
    <div className="product-editor-footer-actions">
      <button type="button" className="button button-secondary" onClick={onClose}>取消</button>{!editingExisting || editingDraft ? <button type="button" className="button button-secondary" title="暂存当前内容，稍后继续编辑" disabled={saving} onClick={saveDraft}>存为草稿</button> : null}<button type="button" className="button button-primary" disabled={saving} onClick={saveActive}><Save size={14} />{saving ? '保存中...' : editingDraft ? '完成并保存' : '保存产品'}</button>
    </div>
  </div>}>
    <div className="product-editor">
      {copyMode && <div className="notice notice-accent">已复制产品资料和包装信息；图片、包装图片、附件与视频需重新上传。</div>}
      <div className={editingExisting ? 'form-grid product-editor-identity has-sku' : 'form-grid product-editor-identity'}>
        {editingExisting && <label className="label product-editor-sku">SKU<input className="input" value={draft.sku} readOnly placeholder="系统自动生成（VT-0000）" title="SKU由系统自动生成" /></label>}
        <label className="label">品名<input className="input" value={draft.name} onChange={(event) => set('name', event.target.value)} /></label>
        <div className="field">
          <span className="field-label">产品分类</span>
          <div className="product-category-field">
            <input className="input" aria-label="产品分类" list="product-category-options" value={draft.category ?? ''} onChange={(event) => set('category', event.target.value)} placeholder="如 扳手、逆变器" />
            {!!categorySuggestion && categorySuggestion !== (draft.category ?? '').trim() && <button className="product-category-suggest" type="button" title={`按品名判定的分类：${categorySuggestion}，点一下填入`} onClick={() => set('category', categorySuggestion)}>建议 {categorySuggestion}</button>}
          </div>
          <datalist id="product-category-options">{categoryCandidates.map((category) => <option key={category} value={category} />)}</datalist>
        </div>
      </div>
      {/* 颜色与插脚固定同一行：去掉自定义输入后每个字段只剩一排胶囊，并排放得下，手机端也不拆行。 */}
      <div className="form-grid product-editor-options-row">
        <div className="field product-editor-option-field">
          <span className="field-label">颜色（多选）{onManageProductOptions && <button type="button" className="link-button product-option-manage" onClick={onManageProductOptions}>管理 ›</button>}</span>
          <div className="product-editor-chips">{colorChoices.map((color) => <button type="button" key={color} className={`chip${draft.colors.includes(color) ? ' is-selected' : ''}`} onClick={() => toggle('colors', color)}>{color}</button>)}</div>
        </div>
        <div className="field product-editor-option-field">
          <span className="field-label">电池插脚（多选）{onManageProductOptions && <button type="button" className="link-button product-option-manage" onClick={onManageProductOptions}>管理 ›</button>}</span>
          <div className="product-editor-chips">{plugChoices.map((plug) => <button type="button" key={plug} className={`chip${draft.batteryPlugs.includes(plug) ? ' is-selected' : ''}`} onClick={() => toggle('batteryPlugs', plug)}>{plug}</button>)}</div>
        </div>
        <div className="field product-editor-option-field">
          <span className="field-label">电池电压（单选）</span>
          <div className="product-editor-chips">{BATTERY_VOLTAGE_OPTIONS.map((option) => <button
            type="button"
            key={option.value}
            className={`chip${(draft.batteryVoltage ?? DEFAULT_BATTERY_VOLTAGE) === option.value ? ' is-selected' : ''}`}
            title={option.hint}
            onClick={() => set('batteryVoltage', option.value)}
          >{option.label}</button>)}</div>
        </div>
      </div>
      {/* 采购报价与配件价格并排：左报价、右配件价格。 */}
      <div className="product-editor-quote-row">
        <PurchaseQuotesTable value={purchaseQuotes} onChange={(next) => set('purchaseQuotes', next)} />
        <CategoryAccessoryPricesEditor
          category={draft.category ?? ''}
          value={draft.accessoryPrices ?? []}
          customized={Boolean(draft.accessoryPricesCustomized)}
          onSeed={(next) => set('accessoryPrices', next)}
          onEdit={(next) => { set('accessoryPrices', next); set('accessoryPricesTouched', true); }}
          onDefaultsSaved={onCategoryDefaultsSaved}
        />
      </div>
      <div className="form-grid product-editor-text-fields">
        {showParameters && <label className="label">产品参数<textarea className="textarea" rows={6} value={draft.parameters ?? ''} onChange={(event) => set('parameters', event.target.value)} placeholder={'例如：扭矩：35N·m\n转速：0-1500rpm\n额定电压：12V'} /></label>}
        <label className="label">备注<textarea className="textarea" rows={6} value={draft.remark ?? ''} onChange={(event) => set('remark', event.target.value)} /></label>
      </div>
      <PackagingTable collapsible value={draft.packaging} onChange={(packaging: PackagingOption[]) => set('packaging', packaging)} presets={packagingPresets} activeCategories={activeProductCategories} onManagePresets={onManagePresets} />
      <ImagePasteUpload label="产品图片与资料图" value={draft.images} onChange={(images) => set('images', images)} multiple showNotes sortable compact selectable categories={PRODUCT_IMAGE_CATEGORY_OPTIONS} />
      <ProductVideoSection value={draft.videos ?? []} onChange={(videos) => set('videos', videos)} />
      <ProductAttachments value={draft.attachments ?? []} onChange={(attachments) => set('attachments', attachments)} />
    </div>
  </Modal>;
}
