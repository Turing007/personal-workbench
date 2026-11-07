import {
  Archive,
  Download,
  Edit3,
  Eye,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Customer } from '../../shared/customers';
import {
  DEFAULT_LIBRARY_CATEGORY,
  LIBRARY_CATEGORIES,
  LIBRARY_CATEGORY_LABELS,
  libraryCategoryLabel,
  type LibraryCategory,
  type LibrarySort,
} from '../../shared/library';
import {
  deleteLibraryFile,
  listLibraryFiles,
  purgeLibraryFile,
  restoreLibraryFile,
  updateLibraryFile,
  uploadLibraryFile,
  type LibraryFile,
} from '../api';
import CustomerSelector from '../components/customers/CustomerSelector';
import Modal from '../components/Modal';
import SearchInput from '../components/SearchInput';
import { saveFileOrDownload } from '../file-save';
import { useFileDrop } from '../use-file-drop';

interface LibraryPageProps {
  customers: Customer[];
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const LIBRARY_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.7z,.ai,.psd,.cdr,.dwg,.dxf,.png,.jpg,.jpeg,.webp';
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: string): string {
  return value ? value.replace('T', ' ').slice(0, 16) : '—';
}

function isImageFile(file: LibraryFile): boolean {
  return file.mimeType.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.originalName);
}

function isPdfFile(file: LibraryFile): boolean {
  return file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.originalName);
}

function FileGlyph({ file }: { file: LibraryFile }) {
  if (isImageFile(file)) return <ImageIcon size={17} />;
  if (isPdfFile(file) || /\.(docx?|xlsx?|pptx?|txt)$/i.test(file.originalName)) return <FileText size={17} />;
  if (/\.(zip|rar|7z)$/i.test(file.originalName)) return <Archive size={17} />;
  return <FileIcon size={17} />;
}

function parseTagText(value: string): string[] {
  return value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
}

interface PendingUpload {
  key: string;
  file: File;
  title: string;
}

function UploadLibraryModal({ open, customers, onClose, onUploaded, onNotify }: {
  open: boolean;
  customers: Customer[];
  onClose: () => void;
  onUploaded: (count: number) => Promise<void> | void;
  onNotify?: LibraryPageProps['onNotify'];
}) {
  const [files, setFiles] = useState<PendingUpload[]>([]);
  const [category, setCategory] = useState<LibraryCategory>(DEFAULT_LIBRARY_CATEGORY);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [tagsText, setTagsText] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setCategory(DEFAULT_LIBRARY_CATEGORY);
    setCustomerId(null);
    setTagsText('');
    setNote('');
    setError('');
    setUploading(false);
    setProgress('');
  }, [open]);

  const appendFiles = (incoming: File[]) => {
    if (!incoming.length) return;
    const tooLarge = incoming.filter((file) => file.size > MAX_FILE_SIZE);
    const accepted = incoming.filter((file) => file.size <= MAX_FILE_SIZE);
    setError(tooLarge.length ? `${tooLarge.length} 个文件超过 20MB，已忽略` : '');
    setFiles((current) => [
      ...current,
      ...accepted.map((file, index) => ({
        key: `library-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
        file,
        title: file.name,
      })),
    ]);
  };

  const { dragging, handlers } = useFileDrop((incoming) => appendFiles(incoming));

  const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    appendFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const submit = async () => {
    if (!files.length || uploading) return;
    if (category === 'label' && customerId == null) {
      setError('客户标贴必须选择客户');
      return;
    }
    setError('');
    setUploading(true);
    let created = 0;
    let failed = 0;
    try {
      const tags = parseTagText(tagsText);
      for (let index = 0; index < files.length; index += 1) {
        const item = files[index];
        setProgress(`${index + 1}/${files.length}`);
        const meta = {
          title: item.title.trim() || item.file.name,
          category,
          customerId,
          tags,
          note: note.trim(),
        };
        try {
          await uploadLibraryFile({ ...meta, file: item.file });
          created += 1;
        } catch (uploadError) {
          const candidate = uploadError as { code?: string; message?: string };
          if (candidate.code === 'DUPLICATE_FILE') {
            const retry = window.confirm(`「${meta.title}」在资料库里已有相同文件，仍要再保存一份吗？`);
            if (retry) {
              try {
                await uploadLibraryFile({ ...meta, file: item.file, allowDuplicate: true });
                created += 1;
                continue;
              } catch (retryError) {
                failed += 1;
                onNotify?.((retryError as { message?: string }).message ?? '上传失败', 'error');
                continue;
              }
            }
            continue;
          }
          failed += 1;
          onNotify?.(candidate.message ?? `${meta.title} 上传失败`, 'error');
        }
      }
    } finally {
      setUploading(false);
      setProgress('');
    }
    if (created > 0) {
      await onUploaded(created);
      onNotify?.(`已保存 ${created} 个资料${failed ? `，${failed} 个失败` : ''}`, failed ? 'error' : 'success');
      onClose();
    } else if (failed > 0) {
      setError('没有文件保存成功，请检查后重试');
    }
  };

  return <Modal
    open={open}
    title="上传资料"
    width={620}
    onClose={uploading ? () => undefined : onClose}
    footer={<>
      <button className="button button-secondary" type="button" disabled={uploading} onClick={onClose}>取消</button>
      <button className="button button-primary" type="button" disabled={uploading || !files.length} onClick={() => void submit()}>
        <Upload size={14} />{uploading ? `上传中 ${progress}` : `上传（${files.length}）`}
      </button>
    </>}
  >
    <div className="library-upload-form">
      <div
        className={`library-drop-zone${dragging ? ' is-dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onPaste={(event) => {
          const pasted = Array.from(event.clipboardData?.files ?? []);
          if (pasted.length) {
            event.preventDefault();
            appendFiles(pasted);
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }}
        {...handlers}
      >
        <Upload size={20} />
        <strong>选择文件、拖进来或 Ctrl+V 粘贴</strong>
        <span>PDF、Word、Excel、PPT、图片、压缩包，单个不超过 20MB</span>
        <input ref={inputRef} type="file" multiple accept={LIBRARY_ACCEPT} onChange={pickFiles} hidden aria-label="选择资料文件" />
      </div>

      {files.length > 0 && <div className="library-pending-list">
        {files.map((item) => <div className="library-pending-row" key={item.key}>
          <span className="library-file-icon"><FileIcon size={15} /></span>
          <input
            className="input"
            aria-label={`资料名称 ${item.file.name}`}
            value={item.title}
            disabled={uploading}
            onChange={(event) => setFiles((current) => current.map((entry) => entry.key === item.key ? { ...entry, title: event.target.value } : entry))}
          />
          <span className="library-pending-size">{formatSize(item.file.size)}</span>
          <button type="button" className="icon-button danger" title="移除" disabled={uploading} onClick={() => setFiles((current) => current.filter((entry) => entry.key !== item.key))}><X size={14} /></button>
        </div>)}
      </div>}

      <div className="library-form-row">
        <label className="field"><span className="field-label">分类</span>
          <select className="toolbar-select" value={category} disabled={uploading} onChange={(event) => setCategory(event.target.value as LibraryCategory)}>
            {LIBRARY_CATEGORIES.map((item) => <option key={item} value={item}>{LIBRARY_CATEGORY_LABELS[item]}</option>)}
          </select>
        </label>
        <div className="field">
          <CustomerSelector value={customerId} customers={customers} onChange={(id) => setCustomerId(id)} />
          <span className="field-hint">{category === 'label' ? '客户标贴必须选择客户' : '可选，按客户归档更容易找'}</span>
        </div>
      </div>

      <label className="field"><span className="field-label">标签</span><input className="input" value={tagsText} disabled={uploading} onChange={(event) => setTagsText(event.target.value)} placeholder="多个标签用逗号分隔，如：2026、德艺、箱唛" /></label>
      <label className="field"><span className="field-label">备注</span><textarea className="textarea" rows={2} value={note} disabled={uploading} onChange={(event) => setNote(event.target.value)} placeholder="这份资料给谁用、什么时候用，可选" /></label>
      {error && <div className="library-form-error" role="alert">{error}</div>}
    </div>
  </Modal>;
}

function EditLibraryModal({ file, customers, onClose, onSaved, onNotify }: {
  file?: LibraryFile;
  customers: Customer[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onNotify?: LibraryPageProps['onNotify'];
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<LibraryCategory>(DEFAULT_LIBRARY_CATEGORY);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [tagsText, setTagsText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) return;
    setTitle(file.title);
    setCategory(file.category);
    setCustomerId(file.customerId);
    setTagsText(file.tags.join('，'));
    setNote(file.note);
    setError('');
  }, [file]);

  const save = async () => {
    if (!file || busy) return;
    if (!title.trim()) return setError('资料名称不能为空');
    if (category === 'label' && customerId == null) return setError('客户标贴必须选择客户');
    setBusy(true);
    try {
      await updateLibraryFile(file.id, {
        title: title.trim(),
        category,
        customerId,
        tags: parseTagText(tagsText),
        note: note.trim(),
      });
      await onSaved();
      onNotify?.('资料信息已更新', 'success');
      onClose();
    } catch (saveError) {
      setError((saveError as { message?: string }).message ?? '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return <Modal
    open={Boolean(file)}
    title={`编辑资料 · ${file?.originalName ?? ''}`}
    width={560}
    onClose={busy ? () => undefined : onClose}
    footer={<>
      <button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>取消</button>
      <button className="button button-primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? '保存中...' : '保存'}</button>
    </>}
  >
    <div className="library-form">
      <label className="field"><span className="field-label">资料名称</span><input className="input" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <div className="library-form-row">
        <label className="field"><span className="field-label">分类</span><select className="toolbar-select" value={category} onChange={(event) => setCategory(event.target.value as LibraryCategory)}>{LIBRARY_CATEGORIES.map((item) => <option key={item} value={item}>{LIBRARY_CATEGORY_LABELS[item]}</option>)}</select></label>
        <div className="field"><CustomerSelector value={customerId} customers={customers} onChange={(id) => setCustomerId(id)} /><span className="field-hint">{category === 'label' ? '客户标贴必须选择客户' : '可选'}</span></div>
      </div>
      <label className="field"><span className="field-label">标签</span><input className="input" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="多个标签用逗号分隔" /></label>
      <label className="field"><span className="field-label">备注</span><textarea className="textarea" rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {error && <div className="library-form-error" role="alert">{error}</div>}
    </div>
  </Modal>;
}

export default function LibraryPage({ customers, onNotify }: LibraryPageProps) {
  const [items, setItems] = useState<LibraryFile[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<LibraryCategory | 'all'>('all');
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [sort, setSort] = useState<LibrarySort>('updated');
  const [trash, setTrash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryFile>();
  const [preview, setPreview] = useState<LibraryFile>();
  const [downloadingId, setDownloadingId] = useState<number>();
  const [busyId, setBusyId] = useState<number>();

  const customerOptions = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [customers],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await listLibraryFiles({
          q: query,
          category,
          customerId,
          sort,
          trash,
          pageSize: 500,
        });
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
      } catch (error) {
        if (!cancelled) onNotify?.((error as { message?: string }).message ?? '资料库加载失败', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, category, customerId, sort, trash, refreshKey, onNotify]);

  const refresh = () => setRefreshKey((key) => key + 1);

  const previewFile = (file: LibraryFile) => {
    if (isImageFile(file)) {
      setPreview(file);
      return;
    }
    if (isPdfFile(file)) {
      window.open(file.url, '_blank', 'noopener');
      return;
    }
    onNotify?.('这种文件需要先下载再查看', 'info');
    void downloadFile(file);
  };

  const downloadFile = async (file: LibraryFile) => {
    if (downloadingId === file.id) return;
    setDownloadingId(file.id);
    try {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error('文件读取失败');
      const blob = await response.blob();
      await saveFileOrDownload(blob, file.originalName || file.title);
      onNotify?.('已开始保存文件', 'success');
    } catch (error) {
      onNotify?.((error as { message?: string }).message ?? '下载失败', 'error');
    } finally {
      setDownloadingId(undefined);
    }
  };

  const remove = async (file: LibraryFile) => {
    if (busyId) return;
    if (!window.confirm(`确定把「${file.title}」移入回收站吗？30 天内可以恢复。`)) return;
    setBusyId(file.id);
    try {
      await deleteLibraryFile(file.id);
      await refresh();
      onNotify?.('资料已移入回收站', 'success');
    } catch (error) {
      onNotify?.((error as { message?: string }).message ?? '删除失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  const restore = async (file: LibraryFile) => {
    setBusyId(file.id);
    try {
      await restoreLibraryFile(file.id);
      await refresh();
      onNotify?.('资料已恢复', 'success');
    } catch (error) {
      onNotify?.((error as { message?: string }).message ?? '恢复失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  const purge = async (file: LibraryFile) => {
    if (!window.confirm(`确定彻底删除「${file.title}」吗？文件和记录都会删除，无法恢复。`)) return;
    setBusyId(file.id);
    try {
      await purgeLibraryFile(file.id);
      await refresh();
      onNotify?.('资料已彻底删除', 'success');
    } catch (error) {
      onNotify?.((error as { message?: string }).message ?? '彻底删除失败', 'error');
    } finally {
      setBusyId(undefined);
    }
  };

  const actions = (file: LibraryFile) => trash
    ? <div className="row-actions">
        <button className="icon-button" type="button" title="恢复" disabled={busyId === file.id} onClick={() => void restore(file)}><RotateCcw size={14} /></button>
        <button className="icon-button danger" type="button" title="彻底删除" disabled={busyId === file.id} onClick={() => void purge(file)}><Trash2 size={14} /></button>
      </div>
    : <div className="row-actions">
        <button className="icon-button" type="button" title={isImageFile(file) || isPdfFile(file) ? '预览' : '下载查看'} onClick={() => previewFile(file)}><Eye size={14} /></button>
        <button className="icon-button" type="button" title="下载" disabled={downloadingId === file.id} onClick={() => void downloadFile(file)}><Download size={14} /></button>
        <button className="icon-button" type="button" title="编辑信息" onClick={() => setEditing(file)}><Edit3 size={14} /></button>
        <button className="icon-button danger" type="button" title="移入回收站" disabled={busyId === file.id} onClick={() => void remove(file)}><Trash2 size={14} /></button>
      </div>;

  return <div className="page-shell library-page">
    <div className="library-page-head">
      <div className="library-heading-copy">
        <span className="page-breadcrumb">资料 / 资料库</span>
        <strong className="page-title">资料库</strong>
        <span className="page-subtitle">合同表格、客户标贴、产品资料统一存放，按客户和标签快速找</span>
      </div>
      <div className="library-head-actions">
        <button className={`button button-secondary${trash ? ' is-active' : ''}`} type="button" onClick={() => setTrash((current) => !current)}>
          <Trash2 size={14} />{trash ? '返回资料库' : '回收站'}
        </button>
        {!trash && <button className="button button-primary" type="button" onClick={() => setUploadOpen(true)}><Plus size={15} />上传资料</button>}
      </div>
    </div>

    <div className="library-tabs" role="tablist" aria-label="资料分类">
      <button className={`library-tab${category === 'all' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={category === 'all'} onClick={() => setCategory('all')}>全部</button>
      {LIBRARY_CATEGORIES.map((item) => <button key={item} className={`library-tab${category === item ? ' is-active' : ''}`} type="button" role="tab" aria-selected={category === item} onClick={() => setCategory(item)}>{LIBRARY_CATEGORY_LABELS[item]}</button>)}
    </div>

    <section className="table-panel library-panel">
      <div className="page-toolbar library-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="搜资料名称、文件名、客户、标签" />
        <select className="toolbar-select" aria-label="按客户筛选" value={customerId ?? ''} onChange={(event) => setCustomerId(event.target.value ? Number(event.target.value) : undefined)}>
          <option value="">全部客户</option>
          {customerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.isActive ? '' : '（停用）'}</option>)}
        </select>
        <select className="toolbar-select" aria-label="排序" value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)}>
          <option value="updated">最近更新</option>
          <option value="name">名称</option>
          <option value="size">大小</option>
        </select>
        <span className="toolbar-count">{total} 份资料</span>
      </div>

      {loading ? <div className="table-state">正在加载资料…</div> : items.length === 0 ? <div className="table-state">
        {trash ? '回收站是空的。' : query.trim() || category !== 'all' || customerId ? '没有符合条件的资料。' : '还没有资料：点右上角「上传资料」，把合同表格、客户标贴存进来。'}
      </div> : <>
        <div className="table-scroll library-table-desktop">
          <table className="data-table library-table">
            <thead><tr>{['资料名称', '分类', '客户', '标签', '大小', '更新时间', '操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead>
            <tbody>{items.map((file) => <tr key={file.id}>
              <td className="library-name-cell">
                <span className="library-file-icon"><FileGlyph file={file} /></span>
                <div className="library-name-copy"><strong title={file.title}>{file.title}</strong><span title={file.originalName}>{file.originalName}</span></div>
              </td>
              <td><span className={`library-category is-${file.category}`}>{libraryCategoryLabel(file.category)}</span></td>
              <td className="library-customer-cell">{file.customerName || '—'}</td>
              <td><div className="library-tags">{file.tags.length ? file.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>) : '—'}{file.tags.length > 3 && <em>+{file.tags.length - 3}</em>}</div></td>
              <td className="library-size-cell">{formatSize(file.size)}</td>
              <td className="library-time-cell">{trash ? `删除于 ${formatTime(file.deletedAt ?? '')}` : formatTime(file.updatedAt)}</td>
              <td className="library-actions-cell">{actions(file)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="library-card-list">{items.map((file) => <article className="library-card" key={file.id}>
          <div className="library-card-head">
            <span className="library-file-icon"><FileGlyph file={file} /></span>
            <div className="library-name-copy"><strong title={file.title}>{file.title}</strong><span title={file.originalName}>{file.originalName}</span></div>
            <span className={`library-category is-${file.category}`}>{libraryCategoryLabel(file.category)}</span>
          </div>
          <div className="library-card-meta">
            <span>{file.customerName || '未绑定客户'}</span>
            <span>{formatSize(file.size)}</span>
            <span>{trash ? `删除于 ${formatTime(file.deletedAt ?? '')}` : formatTime(file.updatedAt)}</span>
          </div>
          {file.tags.length > 0 && <div className="library-tags">{file.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
          {actions(file)}
        </article>)}</div>
      </>}
    </section>

    <UploadLibraryModal open={uploadOpen} customers={customers} onClose={() => setUploadOpen(false)} onNotify={onNotify} onUploaded={async () => { await refresh(); }} />
    <EditLibraryModal file={editing} customers={customers} onClose={() => setEditing(undefined)} onNotify={onNotify} onSaved={refresh} />
    <Modal open={Boolean(preview)} title={preview ? `预览 · ${preview.title}` : '预览'} width={920} onClose={() => setPreview(undefined)} footer={<button className="button button-primary" type="button" onClick={() => setPreview(undefined)}>关闭</button>}>
      {preview && <div className="library-preview"><img src={preview.url} alt={preview.title} /></div>}
    </Modal>
  </div>;
}
