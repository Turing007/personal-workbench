import { FileText, ExternalLink, Loader2, Upload, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CustomerProduct, CustomerProductAttachment, CustomerProductAttachmentCategory } from '../../../shared/customers';
import { deleteCustomerProductAttachment, uploadCustomerProductAttachment } from '../../api';
import { ATTACHMENT_ACCEPT, isSupportedAttachmentName, SUPPORTED_ATTACHMENT_HINT } from '../../attachment-mime';
import Modal from '../Modal';
import type { ToastKind } from '../OrderForm';

const CATEGORY_OPTIONS: Array<{ value: CustomerProductAttachmentCategory; label: string }> = [
  { value: 'label', label: '标贴文件' },
  { value: 'instruction', label: '说明书文件' },
  { value: 'packaging', label: '打包文件' },
  { value: 'other', label: '其他文件' },
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORY_OPTIONS.map((option) => [option.value, option.label])) as Record<string, string>;

function formatSize(size: number): string {
  if (!size) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export interface CustomerProductAttachmentsModalProps {
  open: boolean;
  product?: CustomerProduct;
  onClose: () => void;
  onChanged: () => void;
  onNotify: (message: string, kind?: ToastKind) => void;
}

/** 附件弹窗：查看/上传/删除产品附件；备注图片不在这里出现。 */
export default function CustomerProductAttachmentsModal({ open, product, onClose, onChanged, onNotify }: CustomerProductAttachmentsModalProps) {
  const [items, setItems] = useState<CustomerProductAttachment[]>([]);
  const [category, setCategory] = useState<CustomerProductAttachmentCategory>('other');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !product) return;
    setItems(product.attachments.filter((attachment) => attachment.category !== 'remark'));
    setError('');
    // 只在打开或换产品时回填。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  const upload = async (files: FileList | File[]) => {
    if (!product) return;
    const list = Array.from(files);
    if (!list.length) return;
    const allowed = list.filter((file) => isSupportedAttachmentName(file.name));
    const rejected = list.filter((file) => !isSupportedAttachmentName(file.name));
    setError(rejected.length ? `不支持的文件：${rejected.map((file) => file.name).join('、')}（${SUPPORTED_ATTACHMENT_HINT}）` : '');
    if (!allowed.length) return;
    setBusy(true);
    try {
      for (const file of allowed) {
        const saved = await uploadCustomerProductAttachment(product.id, file, category);
        setItems((current) => [...current, saved]);
      }
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '附件上传失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (attachment: CustomerProductAttachment) => {
    if (!product || !window.confirm(`删除附件「${attachment.originalName}」？`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteCustomerProductAttachment(product.id, attachment.id);
      setItems((current) => current.filter((item) => item.id !== attachment.id));
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  return <Modal
    open={open}
    title={product ? `附件 · ${product.name}` : '附件'}
    width={680}
    compact
    onClose={onClose}
    footer={<button className="button button-secondary" type="button" onClick={onClose}>关闭</button>}
  >
    <div className="cpe-quick-modal">
      <div className="cpe-attachment-upload">
        <select aria-label="附件类型" value={category} onChange={(event) => setCategory(event.target.value as CustomerProductAttachmentCategory)}>
          {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label className={`button button-primary${busy ? ' is-disabled' : ''}`}>
          {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}上传附件
          <input type="file" accept={ATTACHMENT_ACCEPT} multiple hidden disabled={busy} onChange={(event) => { void upload(event.target.files ?? []); event.target.value = ''; }} />
        </label>
        <span className="cpe-modal-hint">{SUPPORTED_ATTACHMENT_HINT}</span>
      </div>
      {items.length
        ? <div className="cpe-attachment-list">{items.map((attachment) => <div key={attachment.id} className="cpe-attachment-row">
          <FileText size={18} className="cpe-attachment-icon" />
          <div className="cpe-attachment-main">
            <a href={attachment.url} target="_blank" rel="noreferrer" title={attachment.originalName}>{attachment.originalName}</a>
            <span>{CATEGORY_LABELS[attachment.category] ?? '其他文件'} · {formatSize(attachment.size)}{attachment.createdAt ? ` · ${attachment.createdAt.replace('T', ' ').slice(0, 16)}` : ''}</span>
          </div>
          <a href={attachment.url} target="_blank" rel="noreferrer" title="打开附件" className="cpe-attachment-open"><ExternalLink size={14} /></a>
          <button className="icon-button danger" type="button" title="删除附件" disabled={busy} onClick={() => void remove(attachment)}><Trash2 size={14} /></button>
        </div>)}</div>
        : <div className="cpe-remark-empty">暂无附件，可上传说明书、打包文件或其他客户专用文件。</div>}
      {error && <div className="cpe-sticker-error" role="alert">{error}</div>}
    </div>
  </Modal>;
}
