import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';
import type { CustomerProduct, CustomerProductAttachment } from '../../../shared/customers';
import { deleteCustomerProductAttachment, updateCustomerProductRemark, uploadCustomerProductAttachment } from '../../api';
import { thumbUrl } from '../../image-urls';
import Modal from '../Modal';
import type { ToastKind } from '../OrderForm';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export interface CustomerProductRemarkModalProps {
  open: boolean;
  product?: CustomerProduct;
  onClose: () => void;
  onChanged: () => void;
  onNotify: (message: string, kind?: ToastKind) => void;
}

/** 备注弹窗：文字随「保存」写入；图片可粘贴/选择上传，上传即生效（不占附件数量）。 */
export default function CustomerProductRemarkModal({ open, product, onClose, onChanged, onNotify }: CustomerProductRemarkModalProps) {
  const [remark, setRemark] = useState('');
  const [images, setImages] = useState<CustomerProductAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !product) return;
    setRemark(product.remark ?? '');
    setImages(product.attachments.filter((attachment) => attachment.category === 'remark'));
    setError('');
    // 只在打开或换产品时回填。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  const upload = async (files: File[]) => {
    if (!product || !files.length) return;
    const acceptable = files.filter((file) => IMAGE_EXTENSIONS[file.type]);
    if (acceptable.length !== files.length) setError('备注图片只支持 PNG / JPG / WebP');
    if (!acceptable.length) return;
    setBusy(true);
    try {
      for (const [index, file] of acceptable.entries()) {
        const renamed = new File([file], `备注图片-${Date.now()}-${index + 1}.${IMAGE_EXTENSIONS[file.type]}`, { type: file.type });
        const saved = await uploadCustomerProductAttachment(product.id, renamed, 'remark');
        setImages((current) => [...current, saved]);
      }
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '备注图片上传失败');
    } finally {
      setBusy(false);
    }
  };

  const handlePaste = (event: ReactClipboardEvent) => {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    void upload(files);
  };

  const removeImage = async (image: CustomerProductAttachment) => {
    if (!product || !window.confirm('删除这张备注图片？')) return;
    setBusy(true);
    setError('');
    try {
      await deleteCustomerProductAttachment(product.id, image.id);
      setImages((current) => current.filter((item) => item.id !== image.id));
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!product) return;
    setBusy(true);
    setError('');
    try {
      await updateCustomerProductRemark(product.id, remark);
      onChanged();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '备注保存失败');
    } finally {
      setBusy(false);
    }
  };

  return <Modal
    open={open}
    title={product ? `备注 · ${product.name}` : '备注'}
    width={640}
    compact
    onClose={onClose}
    footer={<>
      <button className="button button-ghost" type="button" onClick={onClose}>关闭</button>
      <button className="button button-primary" type="button" disabled={busy} onClick={() => void save()}>保存备注</button>
    </>}
  >
    <div className="cpe-quick-modal" onPaste={handlePaste}>
      <label className="cpe-remark-text">
        <span>备注文字（仅内部可见，不打印）</span>
        <textarea rows={5} value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="价格、税运、结算等内部信息写这里；截图可直接 Ctrl+V 粘贴" />
      </label>
      <div className="cpe-remark-images">
        <div className="cpe-remark-images-head">
          <strong>备注图片</strong>
          <label className={`button button-secondary button-sm${busy ? ' is-disabled' : ''}`}>
            {busy ? <Loader2 size={13} className="spin" /> : <ImagePlus size={13} />}添加图片
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden disabled={busy} onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
          </label>
        </div>
        <p className="cpe-modal-hint">截图可直接粘贴；图片上传即保存，关闭弹窗不会撤销。</p>
        {images.length
          ? <div className="cpe-remark-image-grid">{images.map((image) => <figure key={image.id}>
            <a href={image.url} target="_blank" rel="noreferrer" title="查看原图"><img src={thumbUrl(image.url, 240)} alt={image.originalName} loading="lazy" decoding="async" /></a>
            <button type="button" title="删除图片" disabled={busy} onClick={() => void removeImage(image)}><Trash2 size={13} /></button>
          </figure>)}</div>
          : <div className="cpe-remark-empty">还没有图片。</div>}
      </div>
      {error && <div className="cpe-sticker-error" role="alert">{error}</div>}
    </div>
  </Modal>;
}
