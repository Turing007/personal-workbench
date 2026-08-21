import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Download, ExternalLink, FilePlus2, ImagePlus, Plus, Save, Trash2 } from 'lucide-react';
import ImagePasteUpload, { type ImageAttachment } from './ImagePasteUpload';
import Modal from './Modal';
import PackagingTable from './PackagingTable';
import type { CustomerProduct, PackagingOption } from './OrderForm';

export interface ProductRecord extends CustomerProduct {
  category: string;
  purchasePrice: string;
  supplier: string;
  /** 系统产品参数；客户产品草稿不填写此字段。 */
  parameters?: string;
  /** 草稿产品允许信息不完整，保存后可继续编辑。 */
  status?: 'draft' | 'active';
  colors: string[];
  batteryPlugs: string[];
  images: ImageAttachment[];
  accessories: string;
  remark: string;
  packaging: PackagingOption[];
  attachments: ProductAttachment[];
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
  onClose: () => void;
  onSave: (product: ProductRecord, mode: 'draft' | 'active') => void;
}

const colorPresets = ['蓝', '红', '黄'];
const plugPresets = ['牧田', '德伟', '米沃奇'];
const fieldStyle = { width: '100%', border: '1px solid var(--control-border)', borderRadius: 'var(--radius-control)', padding: '7px 9px', color: 'var(--color-text)', background: 'var(--control-bg)', font: 'inherit', fontSize: 'var(--text-xs)' };

function blankProduct(): ProductRecord {
  return { id: `product-${Date.now()}`, name: '', sku: '', specification: '', packCount: 1, parameters: '', packaging: [{ id: `pack-${Date.now()}`, name: '彩盒包装', innerSize: '', innerWeight: '', outerSize: '', outerWeight: '', packSize: 1, purchasePrice: '', images: [] }], remark: '', category: '', purchasePrice: '', supplier: '', colors: [], batteryPlugs: [], images: [], accessories: '', attachments: [] };
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

function ProductAttachments({ value, onChange }: { value: ProductAttachment[]; onChange: (next: ProductAttachment[]) => void }) {
  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    onChange([...value, ...files.map((file) => ({ id: `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`, category: 'manual' as ProductAttachmentCategory, name: file.name, url: URL.createObjectURL(file), mimeType: file.type, size: file.size, file }))]);
  };
  return <section style={{ display: 'grid', gap: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontSize: 12, fontWeight: 650, color: '#334155' }}>产品附件</span><label className="button button-secondary" style={{ minHeight: 28, cursor: 'pointer' }}><FilePlus2 size={14} />添加附件<input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.zip,.rar,.7z,.ai,.psd,.cdr,.dwg,.dxf" hidden onChange={addFiles} /></label></div>
    {value.length ? <div style={{ display: 'grid', gap: 6 }}>{value.map((attachment) => <div key={attachment.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fbfdff' }}><div style={{ minWidth: 0, flex: 1 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155', fontSize: 12 }} title={attachment.name}>{attachment.name}</div><span style={{ color: '#94a3b8', fontSize: 11 }}>{formatFileSize(attachment.size)}{attachment.createdAt ? ` · ${attachment.createdAt.replace('T', ' ').slice(0, 16)}` : ''}</span></div><select aria-label={`${attachment.name}附件类型`} value={attachment.category} onChange={(event) => onChange(value.map((item) => item.id === attachment.id ? { ...item, category: event.target.value as ProductAttachmentCategory } : item))} style={{ border: '1px solid #dbe3ea', borderRadius: 4, padding: '5px 6px', color: '#475569', fontSize: 11 }}>{attachmentCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>{attachment.url && !attachment.file && <><a href={attachment.url} target="_blank" rel="noreferrer" title="打开附件" style={{ color: '#0f766e' }}><ExternalLink size={14} /></a><a href={attachment.url} download={attachment.name} title="下载附件" style={{ color: '#475569' }}><Download size={14} /></a></>}{attachment.file && <span title="待保存" style={{ color: '#0f766e', fontSize: 11 }}>待上传</span>}<button type="button" className="icon-button danger" title="移除附件" onClick={() => onChange(value.filter((item) => item.id !== attachment.id))}><Trash2 size={14} /></button></div>)}</div> : <div style={{ padding: '10px 12px', border: '1px dashed #cbd5e1', borderRadius: 6, color: '#94a3b8', fontSize: 12 }}>暂无附件，可添加说明书、包装设计图或标贴刀模。</div>}
    <span style={{ color: '#94a3b8', fontSize: 11 }}>支持 PDF、Office、图片、压缩包及常见设计源文件，单个附件不超过 20MB。</span>
  </section>;
}

export default function ProductEditor({ open, product, copyMode = false, showParameters: showParametersProp, onClose, onSave }: ProductEditorProps) {
  const [draft, setDraft] = useState<ProductRecord>(() => product ?? blankProduct());
  const [customColor, setCustomColor] = useState('');
  const [customPlug, setCustomPlug] = useState('');
  const showParameters = showParametersProp ?? Object.prototype.hasOwnProperty.call(draft, 'parameters');
  useEffect(() => {
    if (!open) return;
    setDraft(product ?? blankProduct());
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
  return <Modal open={open} title={copyMode ? '复制产品（新建）' : editingDraft ? '编辑产品（草稿）' : editingExisting ? '编辑产品' : '添加产品'} onClose={onClose} width={900} footer={<><button type="button" onClick={onClose} style={{ border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', padding: '8px 14px', cursor: 'pointer' }}>取消</button>{!editingExisting || editingDraft ? <button type="button" onClick={saveDraft} title="暂存当前内容，稍后继续编辑" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', padding: '8px 14px', cursor: 'pointer', color: '#475569' }}>存为草稿</button> : null}<button type="button" onClick={saveActive} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, borderRadius: 5, background: '#0f766e', color: '#fff', padding: '8px 15px', cursor: 'pointer' }}><Save size={14} />{editingDraft ? '完成并保存' : '保存产品'}</button></>}>
    <div style={{ display: 'grid', gap: 14 }}>
      {copyMode && <div style={{ padding: '8px 10px', borderRadius: 6, background: '#f0fdfa', color: '#0f766e', fontSize: 12 }}>已复制产品资料和包装信息；图片、包装图片及附件需重新上传。</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 110px 1fr', gap: 10 }}>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#64748b' }}>品名<input value={draft.name} onChange={(event) => set('name', event.target.value)} style={fieldStyle} /></label>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#64748b' }}>分类<input value={draft.category} onChange={(event) => set('category', event.target.value)} style={fieldStyle} /></label>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#64748b' }}>采购价<input type="number" min="0" value={draft.purchasePrice} onChange={(event) => set('purchasePrice', event.target.value)} style={fieldStyle} /></label>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#64748b' }}>供应商<input value={draft.supplier ?? ''} onChange={(event) => set('supplier', event.target.value)} style={fieldStyle} /></label>
      </div>
      {editingExisting && <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#64748b' }}>SKU<input value={draft.sku} readOnly placeholder="系统自动生成（VT-0000）" title="SKU由系统自动生成" style={{ ...fieldStyle, maxWidth: 180, background: '#f8fafc', color: '#475569', cursor: 'not-allowed' }} /></label>}
      {showParameters && <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#64748b' }}>参数<textarea rows={4} value={draft.parameters ?? ''} onChange={(event) => set('parameters', event.target.value)} placeholder={'例如：扭矩：35N·m\n转速：0-1500rpm\n额定电压：12V'} style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.6 }} /></label>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#64748b' }}>配件<textarea rows={2} value={draft.accessories} onChange={(event) => set('accessories', event.target.value)} style={{ ...fieldStyle, resize: 'vertical' }} /></label><label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#64748b' }}>备注<textarea rows={2} value={draft.remark ?? ''} onChange={(event) => set('remark', event.target.value)} style={{ ...fieldStyle, resize: 'vertical' }} /></label></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><div style={{ display: 'grid', gap: 7 }}><span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>颜色（多选）</span><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{colorPresets.concat(draft.colors.filter((item) => !colorPresets.includes(item))).map((color) => <button type="button" key={color} onClick={() => toggle('colors', color)} style={{ border: `1px solid ${draft.colors.includes(color) ? '#0f766e' : '#cbd5e1'}`, borderRadius: 5, padding: '6px 10px', color: draft.colors.includes(color) ? '#0f766e' : '#64748b', background: draft.colors.includes(color) ? '#f0fdfa' : '#fff', cursor: 'pointer', fontSize: 12 }}>{color}</button>)}<input value={customColor} onChange={(event) => setCustomColor(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addCustom('colors', customColor, setCustomColor); }} placeholder="自定义颜色" style={{ ...fieldStyle, width: 110 }} /><button type="button" title="添加自定义颜色" onClick={() => addCustom('colors', customColor, setCustomColor)} style={{ border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer' }}><Plus size={14} /></button></div></div><div style={{ display: 'grid', gap: 7 }}><span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>电池插脚（多选）</span><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{plugPresets.concat(draft.batteryPlugs.filter((item) => !plugPresets.includes(item))).map((plug) => <button type="button" key={plug} onClick={() => toggle('batteryPlugs', plug)} style={{ border: `1px solid ${draft.batteryPlugs.includes(plug) ? '#0f766e' : '#cbd5e1'}`, borderRadius: 5, padding: '6px 10px', color: draft.batteryPlugs.includes(plug) ? '#0f766e' : '#64748b', background: draft.batteryPlugs.includes(plug) ? '#f0fdfa' : '#fff', cursor: 'pointer', fontSize: 12 }}>{plug}</button>)}<input value={customPlug} onChange={(event) => setCustomPlug(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addCustom('batteryPlugs', customPlug, setCustomPlug); }} placeholder="自定义插脚" style={{ ...fieldStyle, width: 110 }} /><button type="button" title="添加自定义插脚" onClick={() => addCustom('batteryPlugs', customPlug, setCustomPlug)} style={{ border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer' }}><Plus size={14} /></button></div></div></div>
      <PackagingTable value={draft.packaging} onChange={(packaging: PackagingOption[]) => set('packaging', packaging)} />
      <ImagePasteUpload label="产品图片" value={draft.images} onChange={(images) => set('images', images)} multiple showNotes={false} sortable />
      <ProductAttachments value={draft.attachments ?? []} onChange={(attachments) => set('attachments', attachments)} />
    </div>
  </Modal>;
}
