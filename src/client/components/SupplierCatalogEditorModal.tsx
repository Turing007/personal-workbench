import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Download, ExternalLink, FilePlus2, FileText, Image as ImageIcon, Trash2 } from 'lucide-react';
import Modal from './Modal';
import { canPickFilesNatively, pickFilesNatively } from '../app-bridge';
import { filesFromClipboard } from '../attachment-mime';
import { extensionOf } from '../image-mime';
import { useFileDrop } from '../use-file-drop';
import {
  createSupplierCatalog,
  deleteSupplierCatalogFile,
  updateSupplierCatalog,
  uploadSupplierCatalogFile,
  type SupplierCatalog,
  type SupplierCatalogFile,
} from '../api';

const MAX_FILES = 20;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const SUPPLIER_FILE_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp'] as const;
const SUPPLIER_FILE_ACCEPT = SUPPLIER_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const SUPPLIER_FILE_HINT = '支持 PDF、PNG、JPG、WebP，单个文件不超过 20MB';

interface PendingFile {
  id: string;
  file: File;
}

interface SupplierCatalogEditorModalProps {
  open: boolean;
  /** 传入表示编辑已有记录；不传表示新建。 */
  catalog?: SupplierCatalog | null;
  onClose: () => void;
  /** 任一步写入成功后静默刷新列表（弹窗可能继续开着重试上传）。 */
  onChanged: () => Promise<void> | void;
  onNotify: (message: string, kind?: 'info' | 'success' | 'error') => void;
}

function todayValue(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 粘贴/拖入的文件常常没有 MIME 或没有文件名，按扩展名归一化；无扩展名时按 MIME 补一个。 */
function normalizeSupplierFile(file: File): File | undefined {
  let name = (file.name || '').trim();
  if (!extensionOf(name)) {
    const extension = file.type === 'application/pdf'
      ? 'pdf'
      : file.type === 'image/png'
        ? 'png'
        : file.type === 'image/jpeg'
          ? 'jpg'
          : file.type === 'image/webp'
            ? 'webp'
            : '';
    if (!extension) return undefined;
    name = `粘贴文件-${Date.now()}.${extension}`;
  }
  const extension = extensionOf(name);
  if (!(SUPPLIER_FILE_EXTENSIONS as readonly string[]).includes(extension)) return undefined;
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) return undefined;
  if (file.type === mime && file.name === name) return file;
  return new File([file], name, { type: mime, lastModified: file.lastModified });
}

function fileBaseName(name: string): string {
  const trimmed = name.trim();
  const index = trimmed.lastIndexOf('.');
  return (index > 0 ? trimmed.slice(0, index) : trimmed).slice(0, 80);
}

/** 供应商产品图册的编辑弹窗：元数据 + 多文件，支持点选、拖入、Ctrl+V 粘贴。 */
export default function SupplierCatalogEditorModal({ open, catalog, onClose, onChanged, onNotify }: SupplierCatalogEditorModalProps) {
  const [supplier, setSupplier] = useState('');
  const [name, setName] = useState('');
  const [receivedAt, setReceivedAt] = useState(todayValue());
  const [remark, setRemark] = useState('');
  const [savedFiles, setSavedFiles] = useState<SupplierCatalogFile[]>([]);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [catalogId, setCatalogId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appendFilesRef = useRef<(files: File[]) => void>(() => {});

  useEffect(() => {
    if (!open) return;
    setSupplier(catalog?.supplier ?? '');
    setName(catalog?.name ?? '');
    setReceivedAt(catalog?.receivedAt || todayValue());
    setRemark(catalog?.remark ?? '');
    setSavedFiles(catalog?.files ?? []);
    setPending([]);
    setCatalogId(catalog?.id ?? null);
    setBusy(false);
    setProgress('');
    setMessage('');
  }, [open, catalog]);

  const appendFiles = (incoming: File[]) => {
    if (!incoming.length) return;
    const accepted: PendingFile[] = [];
    const rejected: string[] = [];
    for (const raw of incoming) {
      const file = normalizeSupplierFile(raw);
      if (!file) {
        rejected.push(raw.name || '未命名文件');
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name}（超过 20MB）`);
        continue;
      }
      accepted.push({ id: `supplier-file-${Date.now()}-${Math.random().toString(16).slice(2)}`, file });
    }
    const remaining = MAX_FILES - savedFiles.length - pending.length;
    if (accepted.length > remaining) {
      rejected.push(`${accepted.length - Math.max(0, remaining)} 个文件（一条图册最多 ${MAX_FILES} 个）`);
      accepted.splice(Math.max(0, remaining));
    }
    if (accepted.length) {
      setPending((current) => [...current, ...accepted]);
      if (!name.trim()) setName(fileBaseName(accepted[0].file.name));
    }
    if (rejected.length) {
      setMessageKind('error');
      setMessage(`已忽略 ${rejected.length} 个文件：${rejected.slice(0, 3).join('、')}${rejected.length > 3 ? ' 等' : ''}`);
    } else {
      setMessage('');
    }
  };

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    appendFiles(files);
  };

  const pickFiles = () => {
    if (canPickFilesNatively()) {
      const picked = pickFilesNatively(SUPPLIER_FILE_ACCEPT.split(','), true, MAX_FILES);
      if (picked) {
        void picked.then(appendFiles).catch(() => setMessage('文件读取失败，请重试'));
        return;
      }
    }
    fileInputRef.current?.click();
  };

  appendFilesRef.current = appendFiles;

  // 弹窗打开期间在任意位置 Ctrl+V 都能粘贴：焦点停在供应商名/名称输入框时也生效。
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: ClipboardEvent) => {
      const files = filesFromClipboard(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      appendFilesRef.current(files);
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [open]);

  const { dragging, handlers } = useFileDrop(appendFiles);

  const close = () => {
    if (busy) return;
    if (pending.length && !window.confirm(`还有 ${pending.length} 个文件没有上传，确定关闭吗？`)) return;
    onClose();
  };

  const removeSavedFile = async (file: SupplierCatalogFile) => {
    if (!catalogId) return;
    if (!window.confirm(`确定从这条图册删除「${file.originalName}」吗？文件会一并删除，不能恢复。`)) return;
    setBusy(true);
    try {
      await deleteSupplierCatalogFile(catalogId, file.id);
      setSavedFiles((current) => current.filter((item) => item.id !== file.id));
      await onChanged();
      onNotify('图册文件已删除', 'success');
    } catch (error) {
      setMessageKind('error');
      setMessage((error as { message?: string })?.message ?? '文件删除失败');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const supplierText = supplier.trim();
    const nameText = name.trim();
    if (!supplierText) { setMessageKind('error'); setMessage('请填写供应商名称'); return; }
    if (!nameText) { setMessageKind('error'); setMessage('请填写图册名称'); return; }
    if (!savedFiles.length && !pending.length) { setMessageKind('error'); setMessage('请至少添加一个文件'); return; }
    setBusy(true);
    setMessage('');
    setProgress('');
    let id = catalogId;
    try {
      const input = { supplier: supplierText, name: nameText, receivedAt: receivedAt || todayValue(), remark: remark.trim() };
      if (id == null) {
        const created = await createSupplierCatalog(input);
        id = created.id;
        setCatalogId(id);
      } else {
        await updateSupplierCatalog(id, input);
      }
      await onChanged();

      if (pending.length) {
        const failed: PendingFile[] = [];
        for (let index = 0; index < pending.length; index += 1) {
          const item = pending[index];
          setProgress(`正在上传 ${index + 1}/${pending.length}：${item.file.name}`);
          try {
            const saved = await uploadSupplierCatalogFile(id, item.file);
            setSavedFiles((current) => [...current, saved]);
            setPending((current) => current.filter((entry) => entry.id !== item.id));
          } catch (error) {
            failed.push(item);
            setMessageKind('error');
            setMessage(`「${item.file.name}」上传失败：${(error as { message?: string })?.message ?? '请稍后重试'}；已成功的文件已保存`);
          }
        }
        setProgress('');
        if (failed.length) {
          setMessageKind('error');
          setMessage(`有 ${failed.length} 个文件没有上传成功，可再次点「保存」重试，或移除后再关闭。`);
          await onChanged();
          return;
        }
      }
      await onChanged();
      onNotify(catalog ? '供应商图册已更新' : '供应商图册已保存', 'success');
      onClose();
    } catch (error) {
      setMessageKind('error');
      setMessage((error as { message?: string })?.message ?? '保存失败，请稍后重试');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return <Modal
    open={open}
    title={catalog ? '编辑供应商图册' : '上传供应商图册'}
    width={680}
    onClose={close}
    footer={<>
      <button className="button button-secondary" type="button" disabled={busy} onClick={close}>取消</button>
      <button className="button button-primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? '处理中…' : `保存（${savedFiles.length + pending.length} 个文件）`}</button>
    </>}
  >
    <div className="supplier-catalog-editor">
      <div className="supplier-catalog-fields">
        <label className="label">供应商名称
          <input className="input" value={supplier} maxLength={80} disabled={busy} placeholder="如：东莞某某五金厂" onChange={(event) => setSupplier(event.target.value)} />
        </label>
        <label className="label">图册名称
          <input className="input" value={name} maxLength={80} disabled={busy} placeholder="如：2026 新品图册" onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="label">收到日期
          <input className="input" type="date" value={receivedAt} disabled={busy} onChange={(event) => setReceivedAt(event.target.value)} />
        </label>
        <label className="label supplier-catalog-remark">备注（可选）
          <input className="input" value={remark} maxLength={500} disabled={busy} placeholder="如：只含电钻 / 2026 春季报价" onChange={(event) => setRemark(event.target.value)} />
        </label>
      </div>

      <section
        className={`supplier-catalog-drop${dragging ? ' is-drop-target' : ''}`}
        tabIndex={0}
        aria-label="供应商图册文件，可拖入文件或按 Ctrl+V 粘贴"
        {...handlers}
      >
        <div className="supplier-catalog-drop-head">
          <div>
            <strong>图册文件</strong>
            <span className="label-hint">点选、拖入，或直接 Ctrl+V 粘贴</span>
          </div>
          <div className="supplier-catalog-file-button-wrap">
            <button className="button button-secondary button-sm" type="button" disabled={busy} onClick={pickFiles}><FilePlus2 size={14} />添加文件</button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={SUPPLIER_FILE_ACCEPT}
              disabled={busy}
              onChange={addFiles}
              aria-label="添加供应商图册文件"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 1, pointerEvents: canPickFilesNatively() || busy ? 'none' : 'auto' }}
            />
          </div>
        </div>
        <p className="label-hint supplier-catalog-drop-hint">{SUPPLIER_FILE_HINT}；一条图册最多 {MAX_FILES} 个文件。</p>
        {savedFiles.length + pending.length > 0 ? <div className="supplier-catalog-file-list">
          {savedFiles.map((file) => <div className="supplier-catalog-file-row" key={`saved-${file.id}`}>
            <span className="supplier-catalog-file-icon">{file.mimeType === 'application/pdf' ? <FileText size={16} /> : <ImageIcon size={16} />}</span>
            <span className="supplier-catalog-file-name" title={file.originalName}>{file.originalName}</span>
            <span className="supplier-catalog-file-meta">{formatFileSize(file.size)}</span>
            <a className="icon-button" href={file.url} target="_blank" rel="noreferrer" title="打开文件" aria-label={`打开 ${file.originalName}`}><ExternalLink size={14} /></a>
            <a className="icon-button" href={file.url} download={file.originalName} title="下载文件" aria-label={`下载 ${file.originalName}`}><Download size={14} /></a>
            <button className="icon-button danger" type="button" disabled={busy} title="删除文件" aria-label={`删除 ${file.originalName}`} onClick={() => void removeSavedFile(file)}><Trash2 size={14} /></button>
          </div>)}
          {pending.map((item) => <div className="supplier-catalog-file-row is-pending" key={item.id}>
            <span className="supplier-catalog-file-icon">{item.file.type === 'application/pdf' ? <FileText size={16} /> : <ImageIcon size={16} />}</span>
            <span className="supplier-catalog-file-name" title={item.file.name}>{item.file.name}</span>
            <span className="supplier-catalog-file-meta">{formatFileSize(item.file.size)}</span>
            <span className="supplier-catalog-pending">待上传</span>
            <button className="icon-button danger" type="button" disabled={busy} title="移除" aria-label={`移除 ${item.file.name}`} onClick={() => setPending((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 size={14} /></button>
          </div>)}
        </div> : <div className="empty-state">还没有文件，点「添加文件」或直接粘贴 / 拖入。</div>}
        {!!progress && <p className="supplier-catalog-progress" role="status">{progress}</p>}
      </section>
      {!!message && <p className={`supplier-catalog-message${messageKind === 'error' ? ' is-error' : ''}`} role="status">{message}</p>}
    </div>
  </Modal>;
}
