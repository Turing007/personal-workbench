import { Download, ExternalLink, FilePlus2, ImagePlus, Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { CustomerProduct, CustomerProductAttachmentCategory, CustomerProductBatchItemInput, CustomerProductBatchSaveInput, CustomerProductPackaging, CustomerProductSaveInput } from '../../../shared/customers';
import type { ProductRecord } from '../ProductEditor';
import { CUSTOMER_PRODUCT_BATCH_LIMIT, parseBatchLines } from '../../customer-product-batch';
import ImagePasteUpload, { type ImageAttachment } from '../ImagePasteUpload';
import Modal from '../Modal';
import PackagingTable from '../PackagingTable';

export interface CustomerProductEditorModalProps {
  open: boolean;
  product?: CustomerProduct | null;
  /** 表示当前表单由已有客户产品复制而来，保存时仍会创建新产品。 */
  copyMode?: boolean;
  /** 复制模式下原产品的图片地址，用于取回图片内容并作为新文件随新品上传。 */
  copyFromImageURL?: string | null;
  systemProducts?: ProductRecord[];
  onClose: () => void;
  onSave: (input: CustomerProductSaveInput, imageFile?: File, attachments?: CustomerProductAttachmentDraft[]) => Promise<void> | void;
  /** 提供后开放“批量添加”模式：清单逐行填写品名/规格/SKU/图片，其余资料与包装共享，一次性创建。imageFiles 与 input.items 一一对应。 */
  onBatchSave?: (input: CustomerProductBatchSaveInput, imageFiles: Array<File | undefined>) => Promise<void> | void;
  enableAttachments?: boolean;
  layer?: number;
}

interface BatchRowDraft {
  id: string;
  name: string;
  specification: string;
  sku: string;
  imageFile?: File;
  imageUrl?: string;
}

function createBatchRow(seed?: Partial<BatchRowDraft>): BatchRowDraft {
  return {
    id: `batch-row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: seed?.name ?? '',
    specification: seed?.specification ?? '',
    sku: seed?.sku ?? '',
  };
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

export default function CustomerProductEditorModal({ open, product, copyMode = false, copyFromImageURL = null, systemProducts = [], onClose, onSave, onBatchSave, enableAttachments = false, layer = 40 }: CustomerProductEditorModalProps) {
  const [systemProductId, setSystemProductId] = useState<number | null>(null);
  const [systemProductQuery, setSystemProductQuery] = useState('');
  const [systemProductPickerOpen, setSystemProductPickerOpen] = useState(false);
  const [supplierProductName, setSupplierProductName] = useState('');
  const [name, setName] = useState('');
  const [specification, setSpecification] = useState('');
  const [sku, setSku] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRowDraft[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [packCount, setPackCount] = useState('');
  const [finalPrice, setFinalPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [freightPerBox, setFreightPerBox] = useState('');
  const [remark, setRemark] = useState('');
  const [labelRequirement, setLabelRequirement] = useState('');
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
    setSupplierProductName(product?.supplierProductName ?? '');
    setName(product?.name ?? '');
    setSpecification(product?.specification ?? '');
    setSku(product?.sku ?? '');
    setBatchMode(false);
    setBatchRows([]);
    setPasteOpen(false);
    setPasteText('');
    setPackCount(product?.packCount == null ? '' : String(product.packCount));
    setFinalPrice(product?.finalPriceCents == null ? '' : (product.finalPriceCents / 100).toFixed(2));
    setCostPrice(product?.costPriceCents == null ? '' : (product.costPriceCents / 100).toFixed(2));
    setFreightPerBox(product?.freightPerBoxCents == null ? '' : (product.freightPerBoxCents / 100).toFixed(2));
    setRemark(product?.remark ?? '');
    setLabelRequirement(product?.labelRequirement ?? '');
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
    // 复制时把原图取回为本地文件，保存后作为新文件上传，避免与原产品共享同一图片文件。
    if (!copyMode || !copyFromImageURL) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(copyFromImageURL);
        if (!response.ok) return;
        const blob = await response.blob();
        if (cancelled || !blob.type.startsWith('image/')) return;
        const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1] || 'png';
        const file = new File([blob], `customer-product-copy.${extension}`, { type: blob.type });
        setImages((current) => current.length ? current : [{ id: 'copy-source-image', name: '客户产品图片', url: URL.createObjectURL(blob), file }]);
      } catch {
        // 取图失败时保持无图，用户可手动上传。
      }
    })();
    return () => { cancelled = true; };
  }, [open, product, copyMode, copyFromImageURL, enableAttachments]);

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
    setRemark(next.remark ?? ''); setLabelRequirement('');
    setPackaging(systemPackaging(next.packaging));
    const image = next.images[0];
    setImages(image ? [{ id: image.id, name: image.name, url: image.url }] : []);
  };

  const toggleBatchMode = () => {
    if (!onBatchSave || product || copyMode) return;
    if (!batchMode) {
      setBatchRows([name.trim() || specification.trim() || sku.trim()
        ? createBatchRow({ name: name.trim(), specification: specification.trim(), sku: sku.trim() })
        : createBatchRow()]);
      setPasteOpen(false);
      setPasteText('');
      setBatchMode(true);
    } else {
      const first = batchRows.find((row) => row.name.trim() || row.specification.trim() || row.sku.trim());
      setName(first?.name.trim() ?? '');
      setSpecification(first?.specification.trim() ?? '');
      setSku(first?.sku.trim() ?? '');
      setBatchMode(false);
    }
  };

  /** 汇总批量清单：跳过全空行，品名缺失时记录行号；按服务端同款"品名+规格"规则去重，保证 items、图片与创建结果一一对应。 */
  const buildBatchPayload = () => {
    const items: CustomerProductBatchItemInput[] = [];
    const imageFiles: Array<File | undefined> = [];
    const seen = new Set<string>();
    let missingNameRow: number | undefined;
    batchRows.forEach((row, index) => {
      const name = row.name.trim();
      const specification = row.specification.trim();
      const sku = row.sku.trim();
      if (!name && !specification && !sku && !row.imageFile) return;
      if (!name) {
        missingNameRow ??= index + 1;
        return;
      }
      const key = `${name.toLowerCase()}\u0000${specification.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ name, specification, sku });
      imageFiles.push(row.imageFile);
    });
    return { items, imageFiles, missingNameRow };
  };

  const packagingPayloadInput = () => packaging.map((item) => ({
    id: item.id,
    name: item.name,
    innerSize: item.innerSize,
    innerWeight: Number(item.innerWeight) || 0,
    outerSize: item.outerSize,
    outerWeight: Number(item.outerWeight) || 0,
    packCount: Math.max(1, Math.trunc(Number(item.packSize) || 1)),
  }));

  const save = async () => {
    const count = packCount.trim() ? Math.trunc(Number(packCount)) : null;
    const price = yuanToCents(finalPrice);
    const cost = yuanToCents(costPrice);
    const freight = yuanToCents(freightPerBox);
    const batch = batchMode ? buildBatchPayload() : undefined;
    if (batch) {
      if (batch.missingNameRow) return setError(`产品清单第 ${batch.missingNameRow} 行请填写品名`);
      if (!batch.items.length) return setError('请至少添加一行产品');
      if (batch.items.length > CUSTOMER_PRODUCT_BATCH_LIMIT) return setError(`单个批次最多创建 ${CUSTOMER_PRODUCT_BATCH_LIMIT} 个客户产品`);
    } else if (!name.trim()) return setError('请填写品名');
    if (packCount.trim() && (!Number.isSafeInteger(count) || (count ?? 0) <= 0)) return setError('装箱数必须是正整数');
    if (finalPrice.trim() && price === null) return setError('最终价格必须是大于等于 0 的数字');
    if (costPrice.trim() && cost === null) return setError('成本价必须是大于等于 0 的数字');
    setBusy(true);
    setError('');
    try {
      if (batch) {
        await onBatchSave!({
          items: batch.items,
          packCount: count,
          finalPriceCents: price,
          costPriceCents: cost,
          freightPerBoxCents: freight,
          remark: remark.trim(), labelRequirement: labelRequirement.trim(),
          packaging: packagingPayloadInput(),
        }, batch.imageFiles);
      } else {
        await onSave({
          systemProductId,
          name: name.trim(),
          supplierProductName: supplierProductName.trim(),
          specification: specification.trim(),
          sku: sku.trim(),
          packCount: count,
          finalPriceCents: price,
          costPriceCents: cost,
          freightPerBoxCents: freight,
          remark: remark.trim(),
          packaging: packagingPayloadInput(),
          imageRelativePath: images.length
            ? (product?.imageRelativePath ?? imagePathFromUrl(images[0]?.url))
            : null,
        }, images.find((item) => item.file)?.file, attachments);
      }
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? '保存失败'));
    }
  };

  return <Modal open={open} title={batchMode ? '批量添加客户产品' : copyMode ? '复制客户产品（新建）' : product ? '编辑客户产品' : '添加客户产品'} onClose={busy ? () => undefined : onClose} width={760} layer={layer} footer={<><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="button button-primary" disabled={busy} onClick={() => { void save(); }}><Save size={14} />{busy ? '保存中…' : batchMode ? `批量创建（${buildBatchPayload().items.length} 个）` : '保存产品'}</button></>}>
    <div style={{ display: 'grid', gap: 11 }}>
      {error && <div role="alert" style={{ padding: '8px 10px', border: '1px solid #fecaca', borderRadius: 5, background: '#fef2f2', color: '#b91c1c', fontSize: 12 }}>{error}</div>}
      {copyMode && <div style={{ padding: '8px 10px', borderRadius: 6, background: '#f0fdfa', color: '#0f766e', fontSize: 12 }}>已复制原产品的资料、包装信息和图片，保存后将创建为新的客户产品；附件不会复制。</div>}
      {onBatchSave && !product && !copyMode && <label style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#475569', fontSize: 12, cursor: 'pointer' }}><input type="checkbox" checked={batchMode} disabled={busy} onChange={toggleBatchMode} />批量添加：逐行填写品名、规格、SKU 与图片，其余信息共享</label>}
      {selectableSystemProducts.length > 0 && !product && !copyMode && !batchMode && <label style={{ position: 'relative', display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>选择系统产品（可选）
        <div style={{ position: 'relative' }}>
          <input
            value={systemProductQuery}
            onChange={(event) => { setSystemProductQuery(event.target.value); setSystemProductId(null); setSystemProductPickerOpen(true); }}
            onFocus={() => setSystemProductPickerOpen(true)}
            onKeyDown={(event) => { if (event.key === 'Escape') setSystemProductPickerOpen(false); }}
            style={{ ...inputStyle, paddingRight: systemProductId == null ? (systemProductQuery ? 30 : 9) : 72 }}
            placeholder="输入品名、规格、SKU或产品编号搜索"
            aria-label="搜索系统产品"
            role="combobox"
            aria-expanded={systemProductPickerOpen}
            aria-controls="customer-product-system-picker"
          />
          {systemProductId == null && !!systemProductQuery && <button type="button" aria-label="清空搜索" title="清空" onMouseDown={(event) => event.preventDefault()} onClick={() => setSystemProductQuery('')} style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, border: 0, borderRadius: '50%', padding: 0, color: '#94a3b8', background: 'transparent', cursor: 'pointer' }}><X size={13} /></button>}
          {systemProductId != null && <button type="button" onClick={() => chooseSystemProduct('')} disabled={busy} title="改为临时添加" style={{ position: 'absolute', right: 6, top: 5, height: 24, border: 0, color: '#64748b', background: 'transparent', cursor: 'pointer', fontSize: 11 }}>清除</button>}
          {systemProductPickerOpen && <div id="customer-product-system-picker" role="listbox" style={{ position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 220, overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', boxShadow: '0 8px 20px rgba(15, 23, 42, .12)' }}>
            <button type="button" role="option" aria-selected={systemProductId == null} onClick={() => chooseSystemProduct('')} disabled={busy} style={{ display: 'block', width: '100%', padding: '9px 10px', border: 0, borderBottom: '1px solid #edf0f2', color: '#64748b', background: '#fff', cursor: 'pointer', textAlign: 'left', fontSize: 12 }}>临时添加，不关联系统产品</button>
            {filteredSystemProducts.map((item) => <button key={item.id} type="button" role="option" aria-selected={Number(item.id) === systemProductId} onClick={() => chooseSystemProduct(String(item.id))} disabled={busy} style={{ display: 'block', width: '100%', padding: '9px 10px', border: 0, borderBottom: '1px solid #edf0f2', color: '#334155', background: Number(item.id) === systemProductId ? '#f0fdfa' : '#fff', cursor: 'pointer', textAlign: 'left', fontSize: 12 }}><strong>{item.name || '未命名产品'}</strong>{(item.specification || item.sku) && <span style={{ color: '#64748b' }}> · {[item.specification, item.sku].filter(Boolean).join(' · ')}</span>}</button>)}
            {!filteredSystemProducts.length && <div style={{ padding: 12, color: '#94a3b8', textAlign: 'center', fontSize: 12 }}>没有匹配的系统产品</div>}
          </div>}
        </div>
      </label>}
      {batchMode && <section style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ color: '#334155', fontSize: 12, fontWeight: 650 }}>产品清单（每行为一个产品）</span>
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <button type="button" className="button button-secondary" style={{ minHeight: 26, padding: '3px 9px', fontSize: 11 }} disabled={busy} onClick={() => setPasteOpen((current) => !current)}>粘贴导入</button>
            <button type="button" className="button button-secondary" style={{ minHeight: 26, padding: '3px 9px', fontSize: 11 }} disabled={busy} onClick={() => setBatchRows((current) => [...current, createBatchRow()])}><Plus size={12} />添加一行</button>
          </span>
        </div>
        {pasteOpen && <div style={{ display: 'grid', gap: 6, padding: '8px 9px', border: '1px dashed #cbd5e1', borderRadius: 6, background: '#fbfdff' }}>
          <textarea rows={3} value={pasteText} disabled={busy} onChange={(event) => setPasteText(event.target.value)} placeholder={'每行一条：品名，规格，SKU（规格、SKU 可省略），例如：\n迷你风扇-白色, USB款, WS-01\n迷你风扇-黑色'} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="button button-secondary" style={{ minHeight: 26, padding: '3px 9px', fontSize: 11 }} disabled={busy} onClick={() => { setPasteOpen(false); setPasteText(''); }}>取消</button>
            <button type="button" className="button button-primary" style={{ minHeight: 26, padding: '3px 10px', fontSize: 11 }} disabled={busy || !pasteText.trim()} onClick={() => {
              const lines = parseBatchLines(pasteText);
              if (!lines.length) return setError('未解析到有效内容，请检查每行是否以品名开头');
              setBatchRows((current) => [...current, ...lines.map((line) => createBatchRow(line))]);
              setPasteText('');
              setPasteOpen(false);
            }}>导入</button>
          </div>
        </div>}
        <div style={{ display: 'grid', gap: 6 }}>
          {batchRows.map((row, index) => (
            <BatchRowEditor
              key={row.id}
              row={row}
              index={index}
              busy={busy}
              onChange={(patch) => setBatchRows((current) => current.map((item) => item.id === row.id ? { ...item, ...patch } : item))}
              onRemove={() => setBatchRows((current) => current.filter((item) => item.id !== row.id))}
            />
          ))}
          {!batchRows.length && <div style={{ padding: '10px 12px', border: '1px dashed #cbd5e1', borderRadius: 6, color: '#94a3b8', fontSize: 12 }}>暂无产品行，点击“添加一行”或“粘贴导入”开始。</div>}
        </div>
        <div style={{ color: '#94a3b8', fontSize: 11 }}>品名必填；规格与 SKU 可逐行填写或留空待完善。装箱数、价格、备注与下方包装信息为所有产品共用；“品名+规格”重复的行会自动忽略。</div>
      </section>}
      {!batchMode && <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 10 }}>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>品名<input autoFocus value={name} onChange={(event) => setName(event.target.value)} style={inputStyle} /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>客户 SKU<input value={sku} onChange={(event) => setSku(event.target.value)} style={inputStyle} /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>规格<input value={specification} onChange={(event) => setSpecification(event.target.value)} style={inputStyle} /></label>
      </div>}
      {!batchMode && <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>供应商产品名称
        <input value={supplierProductName} onChange={(event) => setSupplierProductName(event.target.value)} style={inputStyle} placeholder="报给供应商的名称，留空则按系统产品名报供（备货表使用）" />
      </label>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>装箱数<input type="number" min={1} step={1} value={packCount} onChange={(event) => setPackCount(event.target.value)} style={inputStyle} placeholder="待完善" /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>成本价（元）<input type="number" min={0} step="0.01" value={costPrice} onChange={(event) => setCostPrice(event.target.value)} style={inputStyle} placeholder="待完善" /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>最终价格（元）<input type="number" min={0} step="0.01" value={finalPrice} onChange={(event) => setFinalPrice(event.target.value)} style={inputStyle} placeholder="待完善" /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>运费（元/箱）<input type="number" min={0} step="0.01" value={freightPerBox} onChange={(event) => setFreightPerBox(event.target.value)} style={inputStyle} placeholder="可选" /></label>
      </div>
      <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>箱唛要求（会印在箱面上）<textarea rows={2} value={labelRequirement} onChange={(event) => setLabelRequirement(event.target.value)} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} placeholder="只写要让仓库/工厂照做并印上箱子的话，如：外箱贴条码箱唛、机器套气泡袋" /></label>
      <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>备注（仅内部可见，不打印）<textarea rows={3} value={remark} onChange={(event) => setRemark(event.target.value)} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} placeholder="价格、税运、结算等内部信息写这里；要印到箱子上的请填上面的「箱唛要求」" /></label>
      {selectedSystemProduct && <div style={{ color: '#64748b', fontSize: 11 }}>已从系统产品库带入基础信息，可继续修改后保存。</div>}
      <PackagingTable value={packaging} onChange={setPackaging} compact showPurchasePrice={false} showImages={false} />
      {!batchMode && <>
        <ImagePasteUpload label="客户产品图片" value={images} onChange={setImages} multiple={false} maxFiles={1} showNotes={false} />
        {enableAttachments && <CustomerProductAttachments value={attachments} onChange={setAttachments} />}
      </>}
      {product?.latestQuoteCents != null && <div style={{ color: '#64748b', fontSize: 11 }}>最近报价：¥{(product.latestQuoteCents / 100).toFixed(2)}（只读）</div>}
    </div>
  </Modal>;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function BatchRowEditor({ row, index, busy, onChange, onRemove }: {
  row: BatchRowDraft;
  index: number;
  busy: boolean;
  onChange: (patch: Partial<BatchRowDraft>) => void;
  onRemove: () => void;
}) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto auto', gap: 6, alignItems: 'center' }}>
    <input aria-label={`产品清单第 ${index + 1} 行品名`} placeholder={`第 ${index + 1} 行品名 *`} value={row.name} disabled={busy} autoFocus={index === 0} onChange={(event) => onChange({ name: event.target.value })} style={inputStyle} />
    <input aria-label={`产品清单第 ${index + 1} 行规格`} placeholder="规格（可留空）" value={row.specification} disabled={busy} onChange={(event) => onChange({ specification: event.target.value })} style={inputStyle} />
    <input aria-label={`产品清单第 ${index + 1} 行 SKU`} placeholder="SKU（可留空）" value={row.sku} disabled={busy} onChange={(event) => onChange({ sku: event.target.value })} style={inputStyle} />
    {row.imageUrl ? <span style={{ position: 'relative', width: 34, height: 30 }}>
      <img src={row.imageUrl} alt="" style={{ width: 34, height: 30, objectFit: 'cover', borderRadius: 4, border: '1px solid #dbe3ea', display: 'block' }} />
      <button type="button" title="移除该行图片" disabled={busy} onClick={() => onChange({ imageFile: undefined, imageUrl: undefined })} style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 999, border: 0, background: '#334155', color: '#fff', fontSize: 10, lineHeight: '16px', cursor: 'pointer', padding: 0 }}>×</button>
    </span> : <label className="icon-button" title="选择该行产品图片" style={{ cursor: 'pointer', width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #dbe3ea', borderRadius: 5 }}>
      <ImagePlus size={14} />
      <input type="file" accept="image/*" hidden disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onChange({ imageFile: file, imageUrl: URL.createObjectURL(file) }); }} />
    </label>}
    <button type="button" className="icon-button danger" title="移除该行" disabled={busy} onClick={onRemove}><Trash2 size={13} /></button>
  </div>;
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
