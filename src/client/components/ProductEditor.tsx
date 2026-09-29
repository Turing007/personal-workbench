import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Download, ExternalLink, FilePlus2, Plus, Save, Trash2 } from 'lucide-react';
import ImagePasteUpload, { type ImageAttachment } from './ImagePasteUpload';
import { canPickFilesNatively, pickFilesNatively } from '../app-bridge';
import { PRODUCT_IMAGE_CATEGORY_OPTIONS } from '../../shared/product-image-categories';
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
  images: ImageAttachment[];
  accessories: string;
  remark: string;
  packaging: PackagingOption[];
  /** 多档采购报价；默认档决定列表价格与客户产品成本价。 */
  purchaseQuotes?: ProductPurchaseQuote[];
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
  /** 库里已用过的供应商与报价名目，作为采购报价表格的候选。 */
  supplierOptions?: string[];
  variantOptions?: string[];
  /** 点「管理预设 ›」时跳到设置页维护，未传则不显示入口。 */
  onManagePresets?: () => void;
  onClose: () => void;
  onSave: (product: ProductRecord, mode: 'draft' | 'active') => void;
}

const colorPresets = ['蓝', '红', '黄'];
const plugPresets = ['牧田', '德伟', '米沃奇'];

/** 打开编辑器就摆一行空报价：第一行天然就是默认档，省掉「先点添加报价才能填」。 */
function withFirstQuoteRow(record: ProductRecord): ProductRecord {
  if (record.purchaseQuotes?.length) return record;
  return { ...record, purchaseQuotes: [{ ...blankPurchaseQuote(), isDefault: true }] };
}

function blankProduct(): ProductRecord {
  return { id: `product-${Date.now()}`, name: '', sku: '', specification: '', packCount: 1, parameters: '', packaging: [blankPackagingRow()], remark: '', category: '', purchasePrice: '', supplier: '', purchaseQuotes: [], colors: [], batteryPlugs: [], images: [], accessories: '', attachments: [] };
}

const attachmentCategories: Array<{ value: ProductAttachmentCategory; label: string }> = [
  { value: 'manual', label: '电子说明书' },
  { value: 'packaging-design', label: '包装设计图' },
  { value: 'label-dieline', label: '标贴刀模' },
  { value: 'other', label: '其他附件' },
];

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const ATTACHMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.zip,.rar,.7z,.ai,.psd,.cdr,.dwg,.dxf';

function ProductAttachments({ value, onChange }: { value: ProductAttachment[]; onChange: (next: ProductAttachment[]) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appendFiles = (files: File[]) => {
    if (!files.length) return;
    onChange([...value, ...files.map((file) => ({ id: `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`, category: 'manual' as ProductAttachmentCategory, name: file.name, url: URL.createObjectURL(file), mimeType: file.type, size: file.size, file }))]);
  };
  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    appendFiles(files);
  };
  return <section className="product-editor-attachments">
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
    <span className="label-hint">支持 PDF、Office、图片、压缩包及常见设计源文件，单个附件不超过 20MB。</span>
  </section>;
}

export default function ProductEditor({ open, product, copyMode = false, showParameters: showParametersProp, packagingPresets, saving = false, productCategories = [], supplierOptions = [], variantOptions = [], onManagePresets, onClose, onSave }: ProductEditorProps) {
  const [draft, setDraft] = useState<ProductRecord>(() => withFirstQuoteRow(product ?? blankProduct()));
  const [customColor, setCustomColor] = useState('');
  const [customPlug, setCustomPlug] = useState('');
  const showParameters = showParametersProp ?? Object.prototype.hasOwnProperty.call(draft, 'parameters');
  useEffect(() => {
    if (!open) return;
    setDraft(withFirstQuoteRow(product ?? blankProduct()));
    setCustomColor('');
    setCustomPlug('');
  }, [open, product]);
  const set = <K extends keyof ProductRecord>(key: K, next: ProductRecord[K]) => setDraft((current) => ({ ...current, [key]: next }));
  const toggle = (key: 'colors' | 'batteryPlugs', item: string) => set(key, draft[key].includes(item) ? draft[key].filter((entry) => entry !== item) : [...draft[key], item]);
  const addCustom = (key: 'colors' | 'batteryPlugs', value: string, clear: (value: string) => void) => { const text = value.trim(); if (text && !draft[key].includes(text)) set(key, [...draft[key], text]); clear(''); };
  const editingExisting = Boolean(product && /^\d+$/.test(product.id));
  const editingDraft = editingExisting && product?.status === 'draft';
  const saveDraft = () => onSave({ ...draft, status: 'draft' }, 'draft');
  const saveActive = () => onSave({ ...draft, status: 'active' }, 'active');
  // 分类只做建议：按品名里出现的最长现有分类名判定，点「建议」才写入，绝不自动覆盖人工填的值。
  // 报价数组是采购价与供应商的唯一入口，默认档那一条会写回 products 的镜像列。
  const purchaseQuotes = draft.purchaseQuotes ?? [];
  const categorySuggestion = suggestProductCategory(draft.name, productCategories);
  const categoryCandidates = orderCategoriesWithSuggestion(productCategories, categorySuggestion);
  return <Modal open={open} title={copyMode ? '复制产品（新建）' : editingDraft ? '编辑产品（草稿）' : editingExisting ? '编辑产品' : '添加产品'} onClose={onClose} width={900} footer={<><button type="button" className="button button-secondary" onClick={onClose}>取消</button>{!editingExisting || editingDraft ? <button type="button" className="button button-secondary" title="暂存当前内容，稍后继续编辑" disabled={saving} onClick={saveDraft}>存为草稿</button> : null}<button type="button" className="button button-primary" disabled={saving} onClick={saveActive}><Save size={14} />{saving ? '保存中...' : editingDraft ? '完成并保存' : '保存产品'}</button></>}>
    <div className="product-editor">
      {copyMode && <div className="notice notice-accent">已复制产品资料和包装信息；图片、包装图片及附件需重新上传。</div>}
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
        <div className="field">
          <span className="field-label">颜色（多选）</span>
          <div className="product-editor-chips">{colorPresets.concat(draft.colors.filter((item) => !colorPresets.includes(item))).map((color) => <button type="button" key={color} className={`chip${draft.colors.includes(color) ? ' is-selected' : ''}`} onClick={() => toggle('colors', color)}>{color}</button>)}<span className="chip-custom"><input className="chip-input" aria-label="自定义颜色" value={customColor} onChange={(event) => setCustomColor(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addCustom('colors', customColor, setCustomColor); }} placeholder="自定义" /><button type="button" className="chip-add" title="添加自定义颜色" onClick={() => addCustom('colors', customColor, setCustomColor)}><Plus size={14} /></button></span></div>
        </div>
        <div className="field">
          <span className="field-label">电池插脚（多选）</span>
          <div className="product-editor-chips">{plugPresets.concat(draft.batteryPlugs.filter((item) => !plugPresets.includes(item))).map((plug) => <button type="button" key={plug} className={`chip${draft.batteryPlugs.includes(plug) ? ' is-selected' : ''}`} onClick={() => toggle('batteryPlugs', plug)}>{plug}</button>)}<span className="chip-custom"><input className="chip-input" aria-label="自定义插脚" value={customPlug} onChange={(event) => setCustomPlug(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addCustom('batteryPlugs', customPlug, setCustomPlug); }} placeholder="自定义" /><button type="button" className="chip-add" title="添加自定义插脚" onClick={() => addCustom('batteryPlugs', customPlug, setCustomPlug)}><Plus size={14} /></button></span></div>
        </div>
      </div>
      <PurchaseQuotesTable value={purchaseQuotes} onChange={(next) => set('purchaseQuotes', next)} supplierOptions={supplierOptions} variantOptions={variantOptions} />
      <div className="form-grid product-editor-text-fields">
        {showParameters && <label className="label">产品参数<textarea className="textarea" rows={6} value={draft.parameters ?? ''} onChange={(event) => set('parameters', event.target.value)} placeholder={'例如：扭矩：35N·m\n转速：0-1500rpm\n额定电压：12V'} /></label>}
        <label className="label">配件<textarea className="textarea" rows={6} value={draft.accessories} onChange={(event) => set('accessories', event.target.value)} /></label>
        <label className="label">备注<textarea className="textarea" rows={6} value={draft.remark ?? ''} onChange={(event) => set('remark', event.target.value)} /></label>
      </div>
      <PackagingTable collapsible value={draft.packaging} onChange={(packaging: PackagingOption[]) => set('packaging', packaging)} presets={packagingPresets} onManagePresets={onManagePresets} />
      <ImagePasteUpload label="产品图片与资料图" value={draft.images} onChange={(images) => set('images', images)} multiple showNotes sortable compact selectable categories={PRODUCT_IMAGE_CATEGORY_OPTIONS} />
      <ProductAttachments value={draft.attachments ?? []} onChange={(attachments) => set('attachments', attachments)} />
    </div>
  </Modal>;
}
