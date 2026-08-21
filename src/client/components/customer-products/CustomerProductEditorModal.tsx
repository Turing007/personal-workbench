import { Download, ExternalLink, FilePlus2, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { CustomerProduct, CustomerProductAttachmentCategory, CustomerProductPackaging, CustomerProductSaveInput } from '../../../shared/customers';
import type { ProductRecord } from '../ProductEditor';
import ImagePasteUpload, { type ImageAttachment } from '../ImagePasteUpload';
import Modal from '../Modal';
import PackagingTable from '../PackagingTable';

export interface CustomerProductEditorModalProps {
  open: boolean;
  product?: CustomerProduct | null;
  systemProducts?: ProductRecord[];
  onClose: () => void;
  onSave: (input: CustomerProductSaveInput, imageFile?: File, attachments?: CustomerProductAttachmentDraft[]) => Promise<void> | void;
  enableAttachments?: boolean;
  layer?: number;
}

export interface CustomerProductAttachmentDraft {
  id: number | string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  category: CustomerProductAttachmentCategory;
  createdAt?: string;
  file?: File;
}

const inputStyle = { width: '100%', minWidth: 0, border: '1px solid #dbe3ea', borderRadius: 5, padding: '8px 9px', font: 'inherit', fontSize: 12, background: '#fff' };

function yuanToCents(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round((amount + Number.EPSILON) * 100) : null;
}

function packagingToEditor(value: CustomerProductPackaging[] | undefined) {
  return (value ?? []).map((item, index) => ({
    id: String(item.id ?? `pack-${Date.now()}-${index}`),
    name: item.name,
    innerSize: item.innerSize,
    innerWeight: String(item.innerWeight ?? ''),
    outerSize: item.outerSize,
    outerWeight: String(item.outerWeight ?? ''),
    packSize: item.packCount,
    purchasePrice: '',
  }));
}

function systemPackaging(value: ProductRecord['packaging']) {
  return value.map((item, index) => ({
    id: String(item.id ?? `pack-${Date.now()}-${index}`),
    name: item.name,
    innerSize: item.innerSize,
    innerWeight: String(item.innerWeight ?? ''),
    outerSize: item.outerSize,
    outerWeight: String(item.outerWeight ?? ''),
    packSize: item.packSize,
    purchasePrice: '',
  }));
}

function imagePathFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const marker = '/files/';
  const index = url.indexOf(marker);
  return index >= 0 ? decodeURIComponent(url.slice(index + marker.length)) : null;
}

export default function CustomerProductEditorModal({ open, product, systemProducts = [], onClose, onSave, enableAttachments = false, layer = 40 }: CustomerProductEditorModalProps) {
  const [systemProductId, setSystemProductId] = useState<number | null>(null);
  const [systemProductQuery, setSystemProductQuery] = useState('');
  const [systemProductPickerOpen, setSystemProductPickerOpen] = useState(false);
  const [name, setName] = useState('');
  const [specification, setSpecification] = useState('');
  const [sku, setSku] = useState('');
  const [packCount, setPackCount] = useState('');
  const [finalPrice, setFinalPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [freightPerBox, setFreightPerBox] = useState('');
  const [remark, setRemark] = useState('');
  const [packaging, setPackaging] = useState<ReturnType<typeof systemPackaging>>([]);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [attachments, setAttachments] = useState<CustomerProductAttachmentDraft[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedSystemProduct = useMemo(() => systemProducts.find((item) => Number(item.id) === systemProductId), [systemProductId, systemProducts]);
  const selectableSystemProducts = useMemo(() => systemProducts.filter((item) => item.status !== 'draft'), [systemProducts]);
  const filteredSystemProducts = useMemo(() => {
    const needle = systemProductQuery.trim().toLowerCase();
    if (!needle) return selectableSystemProducts;
    return selectableSystemProducts.filter((item) => [item.name, item.specification, item.sku, String(item.id)].join(' ').toLowerCase().includes(needle));
  }, [systemProductQuery, selectableSystemProducts]);

  const systemProductLabel = (item: ProductRecord) => [item.name, item.specification, item.sku].filter(Boolean).join(' · ');

  useEffect(() => {
    if (!open) return;
    setSystemProductId(product?.systemProductId ?? null);
    setSystemProductQuery('');
    setSystemProductPickerOpen(false);
    setName(product?.name ?? '');
    setSpecification(product?.specification ?? '');
    setSku(product?.sku ?? '');
    setPackCount(product?.packCount == null ? '' : String(product.packCount));
    setFinalPrice(product?.finalPriceCents == null ? '' : (product.finalPriceCents / 100).toFixed(2));
    setCostPrice(product?.costPriceCents == null ? '' : (product.costPriceCents / 100).toFixed(2));
    setFreightPerBox(product?.freightPerBoxCents == null ? '' : (product.freightPerBoxCents / 100).toFixed(2));
    setRemark(product?.remark ?? '');
    setPackaging(packagingToEditor(product?.packaging));
    setImages(product?.imageRelativePath ? [{ id: product.imageRelativePath, name: '客户产品图片', url: `/files/${product.imageRelativePath}` }] : []);
    setAttachments(enableAttachments ? (product?.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.originalName,
      url: attachment.url,
      mimeType: attachment.mimeType,
      size: attachment.size,
      category: attachment.category,
      createdAt: attachment.createdAt,
    })) : []);
    setError('');
    setBusy(false);
  }, [open, product]);

  const chooseSystemProduct = (value: string) => {
    const id = value ? Number(value) : null;
    setSystemProductId(id);
    const next = systemProducts.find((item) => Number(item.id) === id);
    if (!next) {
      setSystemProductQuery('');
      setSystemProductPickerOpen(false);
      return;
    }
    setSystemProductQuery(systemProductLabel(next));
    setSystemProductPickerOpen(false);
    setName(next.name);
    setSpecification(next.specification);
    setSku(next.sku);
    setPackCount(next.packCount == null ? '' : String(next.packCount));
    setCostPrice(next.purchasePrice ? String(next.purchasePrice) : '');
    setFreightPerBox('');
    setRemark(next.remark ?? '');
    setPackaging(systemPackaging(next.packaging));
    const image = next.images[0];
    setImages(image ? [{ id: image.id, name: image.name, url: image.url }] : []);
  };

  const save = async () => {
    const count = packCount.trim() ? Math.trunc(Number(packCount)) : null;
    const price = yuanToCents(finalPrice);
    const cost = yuanToCents(costPrice);
    const freight = yuanToCents(freightPerBox);
    if (!name.trim()) return setError('请填写品名');
    if (packCount.trim() && (!Number.isSafeInteger(count) || (count ?? 0) <= 0)) return setError('装箱数必须是正整数');
    if (finalPrice.trim() && price === null) return setError('最终价格必须是大于等于 0 的数字');
    if (costPrice.trim() && cost === null) return setError('成本价必须是大于等于 0 的数字');
    setBusy(true);
    setError('');
    try {
      await onSave({
        systemProductId,
        name: name.trim(),
        specification: specification.trim(),
        sku: sku.trim(),
        packCount: count,
        finalPriceCents: price,
        costPriceCents: cost,
        freightPerBoxCents: freight,
        remark: remark.trim(),
        packaging: packaging.map((item) => ({
          id: item.id,
          name: item.name,
          innerSize: item.innerSize,
          innerWeight: Number(item.innerWeight) || 0,
          outerSize: item.outerSize,
          outerWeight: Number(item.outerWeight) || 0,
          packCount: Math.max(1, Math.trunc(Number(item.packSize) || 1)),
        })),
        imageRelativePath: images.length
          ? (product?.imageRelativePath ?? imagePathFromUrl(images[0]?.url))
          : null,
      }, images.find((item) => item.file)?.file, attachments);
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? '保存失败'));
    }
  };

  return <Modal open={open} title={product ? '编辑客户产品' : '添加客户产品'} onClose={busy ? () => undefined : onClose} width={760} layer={layer} footer={<><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="button button-primary" disabled={busy} onClick={() => { void save(); }}><Save size={14} />{busy ? '保存中…' : '保存产品'}</button></>}>
    <div style={{ display: 'grid', gap: 11 }}>
      {error && <div role="alert" style={{ padding: '8px 10px', border: '1px solid #fecaca', borderRadius: 5, background: '#fef2f2', color: '#b91c1c', fontSize: 12 }}>{error}</div>}
      {selectableSystemProducts.length > 0 && !product && <label style={{ position: 'relative', display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>选择系统产品（可选）
        <div style={{ position: 'relative' }}>
          <input
            value={systemProductQuery}
            onChange={(event) => { setSystemProductQuery(event.target.value); setSystemProductId(null); setSystemProductPickerOpen(true); }}
            onFocus={() => setSystemProductPickerOpen(true)}
            onKeyDown={(event) => { if (event.key === 'Escape') setSystemProductPickerOpen(false); }}
            style={{ ...inputStyle, paddingRight: systemProductId == null ? 9 : 72 }}
            placeholder="输入品名、规格、SKU或产品编号搜索"
            aria-label="搜索系统产品"
            role="combobox"
            aria-expanded={systemProductPickerOpen}
            aria-controls="customer-product-system-picker"
          />
          {systemProductId != null && <button type="button" onClick={() => chooseSystemProduct('')} disabled={busy} title="改为临时添加" style={{ position: 'absolute', right: 6, top: 5, height: 24, border: 0, color: '#64748b', background: 'transparent', cursor: 'pointer', fontSize: 11 }}>清除</button>}
          {systemProductPickerOpen && <div id="customer-product-system-picker" role="listbox" style={{ position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 220, overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', boxShadow: '0 8px 20px rgba(15, 23, 42, .12)' }}>
            <button type="button" role="option" aria-selected={systemProductId == null} onClick={() => chooseSystemProduct('')} disabled={busy} style={{ display: 'block', width: '100%', padding: '9px 10px', border: 0, borderBottom: '1px solid #edf0f2', color: '#64748b', background: '#fff', cursor: 'pointer', textAlign: 'left', fontSize: 12 }}>临时添加，不关联系统产品</button>
            {filteredSystemProducts.map((item) => <button key={item.id} type="button" role="option" aria-selected={Number(item.id) === systemProductId} onClick={() => chooseSystemProduct(String(item.id))} disabled={busy} style={{ display: 'block', width: '100%', padding: '9px 10px', border: 0, borderBottom: '1px solid #edf0f2', color: '#334155', background: Number(item.id) === systemProductId ? '#f0fdfa' : '#fff', cursor: 'pointer', textAlign: 'left', fontSize: 12 }}><strong>{item.name || '未命名产品'}</strong>{(item.specification || item.sku) && <span style={{ color: '#64748b' }}> · {[item.specification, item.sku].filter(Boolean).join(' · ')}</span>}</button>)}
            {!filteredSystemProducts.length && <div style={{ padding: 12, color: '#94a3b8', textAlign: 'center', fontSize: 12 }}>没有匹配的系统产品</div>}
          </div>}
        </div>
      </label>}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 10 }}>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>品名<input autoFocus value={name} onChange={(event) => setName(event.target.value)} style={inputStyle} /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>客户 SKU<input value={sku} onChange={(event) => setSku(event.target.value)} style={inputStyle} /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>规格<input value={specification} onChange={(event) => setSpecification(event.target.value)} style={inputStyle} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>装箱数<input type="number" min={1} step={1} value={packCount} onChange={(event) => setPackCount(event.target.value)} style={inputStyle} placeholder="待完善" /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>成本价（元）<input type="number" min={0} step="0.01" value={costPrice} onChange={(event) => setCostPrice(event.target.value)} style={inputStyle} placeholder="待完善" /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>最终价格（元）<input type="number" min={0} step="0.01" value={finalPrice} onChange={(event) => setFinalPrice(event.target.value)} style={inputStyle} placeholder="待完善" /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>运费（元/箱）<input type="number" min={0} step="0.01" value={freightPerBox} onChange={(event) => setFreightPerBox(event.target.value)} style={inputStyle} placeholder="可选" /></label>
      </div>
      <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>产品备注<textarea rows={3} value={remark} onChange={(event) => setRemark(event.target.value)} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} placeholder="记录客户专用要求、交期、材质或报价说明" /></label>
      {selectedSystemProduct && <div style={{ color: '#64748b', fontSize: 11 }}>已从系统产品库带入基础信息，可继续修改后保存。</div>}
      <PackagingTable value={packaging} onChange={setPackaging} compact showPurchasePrice={false} showImages={false} />
      <ImagePasteUpload label="客户产品图片" value={images} onChange={setImages} multiple={false} maxFiles={1} showNotes={false} />
      {enableAttachments && <CustomerProductAttachments value={attachments} onChange={setAttachments} />}
      {product?.latestQuoteCents != null && <div style={{ color: '#64748b', fontSize: 11 }}>最近报价：¥{(product.latestQuoteCents / 100).toFixed(2)}（只读）</div>}
    </div>
  </Modal>;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const attachmentCategoryOptions: Array<{ value: CustomerProductAttachmentCategory; label: string }> = [
  { value: 'label', label: '标贴文件' },
  { value: 'instruction', label: '说明书文件' },
  { value: 'packaging', label: '打包文件' },
  { value: 'other', label: '其他文件' },
];

function CustomerProductAttachments({ value, onChange }: { value: CustomerProductAttachmentDraft[]; onChange: (next: CustomerProductAttachmentDraft[]) => void }) {
  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    onChange([...value, ...files.map((file) => ({
      id: `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name,
      url: URL.createObjectURL(file),
      mimeType: file.type,
      size: file.size,
      category: 'other' as CustomerProductAttachmentCategory,
      file,
    }))]);
  };

  return <section style={{ display: 'grid', gap: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><span style={{ fontSize: 12, fontWeight: 650, color: '#334155' }}>客户产品附件</span><label className="button button-secondary" style={{ minHeight: 28, cursor: 'pointer' }}><FilePlus2 size={14} />添加附件<input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.zip,.rar,.7z,.ai,.psd,.cdr,.dwg,.dxf" hidden onChange={addFiles} /></label></div>
    {value.length ? <div style={{ display: 'grid', gap: 6 }}>{value.map((attachment) => <div key={String(attachment.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fbfdff' }}><div style={{ minWidth: 0, flex: 1 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155', fontSize: 12 }} title={attachment.name}>{attachment.name}</div><span style={{ color: '#94a3b8', fontSize: 11 }}>{formatFileSize(attachment.size)}{attachment.createdAt ? ` · ${attachment.createdAt.replace('T', ' ').slice(0, 16)}` : ''}</span></div><select aria-label={`${attachment.name}附件类型`} value={attachment.category} onChange={(event) => onChange(value.map((item) => item.id === attachment.id ? { ...item, category: event.target.value as CustomerProductAttachmentCategory } : item))} style={{ border: '1px solid #dbe3ea', borderRadius: 4, padding: '5px 6px', color: '#475569', fontSize: 11 }}>{attachmentCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{attachment.url && !attachment.file && <><a href={attachment.url} target="_blank" rel="noreferrer" title="打开附件" style={{ color: '#0f766e' }}><ExternalLink size={14} /></a><a href={attachment.url} download={attachment.name} title="下载附件" style={{ color: '#475569' }}><Download size={14} /></a></>}{attachment.file && <span title="待保存" style={{ color: '#0f766e', fontSize: 11 }}>待上传</span>}<button type="button" className="icon-button danger" title="移除附件" onClick={() => onChange(value.filter((item) => item.id !== attachment.id))}><Trash2 size={14} /></button></div>)}</div> : <div style={{ padding: '10px 12px', border: '1px dashed #cbd5e1', borderRadius: 6, color: '#94a3b8', fontSize: 12 }}>暂无附件，可添加说明书、报价文件、包装资料或其他客户专用文件。</div>}
    <span style={{ color: '#94a3b8', fontSize: 11 }}>支持 PDF、Office、图片、压缩包及常见设计源文件，单个附件不超过 20MB。</span>
  </section>;
}
