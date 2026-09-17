import { Check, ClipboardPaste, GripVertical, ImagePlus, Star, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

export interface ImageAttachment {
  id: string;
  name: string;
  url: string;
  file?: File;
  note?: string;
  /** 图片分类，仅在传入 categories 时使用（产品图库按分类归档图片资料）。 */
  category?: string;
}

export interface ImageCategoryOption {
  value: string;
  label: string;
}

export interface ImagePasteUploadProps {
  value: ImageAttachment[];
  onChange: (value: ImageAttachment[]) => void;
  label?: string;
  multiple?: boolean;
  accept?: string;
  maxFiles?: number;
  onDeleteSaved?: (attachment: ImageAttachment) => Promise<void> | void;
  showNotes?: boolean;
  sortable?: boolean;
  /** 紧凑图墙：方形缩略图 + 底部小控件行，控件不再压在图片上（产品图库使用）。 */
  compact?: boolean;
  /** 传入分类选项后，每张图片下方出现分类下拉；不传则保持原有纯图片上传行为。 */
  categories?: ReadonlyArray<ImageCategoryOption>;
}

function fileToAttachment(file: File): ImageAttachment {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: file.name || '粘贴图片', url: URL.createObjectURL(file), file };
}

type PointerDragSession = {
  id: string;
  pointerId: number;
  element: HTMLElement;
  startX: number;
  startY: number;
  timer?: number;
  active: boolean;
};

export default function ImagePasteUpload({
  value,
  onChange,
  label = '付款凭证',
  multiple = true,
  accept = 'image/*',
  maxFiles,
  onDeleteSaved,
  showNotes = true,
  sortable = false,
  compact = false,
  categories,
}: ImagePasteUploadProps) {
  const [message, setMessage] = useState('');
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean }>();
  const dropTargetRef = useRef<{ id: string; before: boolean } | undefined>(undefined);
  const objectUrls = useRef(new Set<string>());
  const valueRef = useRef(value);
  const pointerDragRef = useRef<PointerDragSession | undefined>(undefined);
  valueRef.current = value;
  const fileLimit = Math.max(1, Math.trunc(maxFiles ?? (multiple ? Number.MAX_SAFE_INTEGER : 1)));
  const canAdd = value.length < fileLimit;

  useEffect(() => () => {
    const session = pointerDragRef.current;
    if (session?.timer) window.clearTimeout(session.timer);
    if (session?.element.hasPointerCapture?.(session.pointerId)) session.element.releasePointerCapture(session.pointerId);
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
  }, []);

  const addFiles = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length !== files.length) setMessage('仅支持图片格式');
    const remaining = Math.max(0, fileLimit - value.length);
    const accepted = images.slice(0, remaining);
    if (images.length > remaining) setMessage(`最多添加 ${fileLimit} 张图片`);
    const defaultCategory = categories?.[0]?.value;
    const attachments = accepted.map((file) => {
      const attachment = fileToAttachment(file);
      return defaultCategory ? { ...attachment, category: defaultCategory } : attachment;
    });
    attachments.forEach((attachment) => objectUrls.current.add(attachment.url));
    const next = multiple || fileLimit > 1 ? [...value, ...attachments] : attachments;
    if (accepted.length) onChange(next);
  };

  const removeAttachment = async (attachment: ImageAttachment) => {
    if (deletingIds.includes(attachment.id)) return;
    setMessage('');
    try {
      if (!attachment.file && onDeleteSaved) {
        setDeletingIds((current) => [...current, attachment.id]);
        await onDeleteSaved(attachment);
      }
      if (attachment.file) {
        URL.revokeObjectURL(attachment.url);
        objectUrls.current.delete(attachment.url);
      }
      onChange(value.filter((entry) => entry.id !== attachment.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '图片删除失败');
    } finally {
      setDeletingIds((current) => current.filter((id) => id !== attachment.id));
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files).filter((item) => item.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      addFiles(files);
      setMessage('已从剪贴板添加图片');
    }
  };

  const reorder = (sourceId: string, targetId: string, before: boolean) => {
    if (sourceId === targetId) return;
    const current = valueRef.current;
    const sourceIndex = current.findIndex((item) => item.id === sourceId);
    const targetIndex = current.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...current];
    const [moved] = next.splice(sourceIndex, 1);
    const adjustedTargetIndex = next.findIndex((item) => item.id === targetId);
    const insertIndex = Math.max(0, adjustedTargetIndex + (before ? 0 : 1));
    next.splice(insertIndex, 0, moved);
    onChange(next);
  };

  const clearPointerDrag = () => {
    const session = pointerDragRef.current;
    if (!session) return;
    if (session.timer) window.clearTimeout(session.timer);
    if (session.element.hasPointerCapture?.(session.pointerId)) session.element.releasePointerCapture(session.pointerId);
    pointerDragRef.current = undefined;
    setDraggingId(undefined);
    dropTargetRef.current = undefined;
    setDropTarget(undefined);
  };

  const updateDropTarget = (clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-image-id]');
    if (!target) {
      dropTargetRef.current = undefined;
      setDropTarget(undefined);
      return;
    }
    const id = target.dataset.imageId;
    if (!id || id === pointerDragRef.current?.id) {
      dropTargetRef.current = undefined;
      setDropTarget(undefined);
      return;
    }
    const rect = target.getBoundingClientRect();
    const nextTarget = { id, before: clientY < rect.top + rect.height / 2 };
    dropTargetRef.current = nextTarget;
    setDropTarget(nextTarget);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLElement>, id: string) => {
    if (!sortable || event.button !== 0 || pointerDragRef.current) return;
    const element = event.currentTarget;
    const session: PointerDragSession = {
      id,
      pointerId: event.pointerId,
      element,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    session.timer = window.setTimeout(() => {
      if (pointerDragRef.current !== session) return;
      session.active = true;
      element.setPointerCapture?.(event.pointerId);
      setDraggingId(id);
    }, 420);
    pointerDragRef.current = session;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = pointerDragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    if (!session.active && distance > 8) {
      clearPointerDrag();
      return;
    }
    if (!session.active) return;
    event.preventDefault();
    updateDropTarget(event.clientX, event.clientY);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = pointerDragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.active && dropTargetRef.current) reorder(session.id, dropTargetRef.current.id, dropTargetRef.current.before);
    clearPointerDrag();
  };

  const onPointerCancel = () => clearPointerDrag();

  const setCover = (id: string) => {
    const index = value.findIndex((item) => item.id === id);
    if (index <= 0) return;
    const next = [...value];
    const [cover] = next.splice(index, 1);
    next.unshift(cover);
    onChange(next);
  };

  return (
    <div onPaste={onPaste} tabIndex={0} className={`image-upload${compact ? ' is-compact' : ''}`}>
      <div className="image-upload-header">
        <label className="image-upload-label">{label}</label>
        <span className="image-upload-hint">点击区域后可 Ctrl+V</span>
      </div>
      <div className="image-upload-grid">
        {value.map((item, index) => {
          const isCover = index === 0;
          const isDeleting = deletingIds.includes(item.id);
          const deleteButton = (
            <button
              type="button"
              title="删除图片"
              aria-label="删除图片"
              disabled={isDeleting}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); void removeAttachment(item); }}
              className="image-card-button image-card-delete-button"
              style={{ opacity: isDeleting ? 0.55 : 1, cursor: isDeleting ? 'wait' : 'pointer' }}
            ><Trash2 size={12} /></button>
          );
          return (
            <div
              key={item.id}
              data-image-id={item.id}
              onPointerMove={sortable ? onPointerMove : undefined}
              onPointerUp={sortable ? onPointerUp : undefined}
              onPointerCancel={sortable ? onPointerCancel : undefined}
              onLostPointerCapture={sortable ? onPointerCancel : undefined}
              className={`image-card${sortable && isCover ? ' is-cover' : ''}${draggingId === item.id ? ' is-dragging' : ''}${dropTarget?.id === item.id ? (dropTarget.before ? ' is-drop-before' : ' is-drop-after') : ''}`}
            >
              <div className="image-card-thumb" onPointerDown={sortable ? (event) => onPointerDown(event, item.id) : undefined}>
                <img draggable={false} className="image-card-img" src={item.url} alt={item.name} />
                {sortable && !compact && <div
                  title="长按拖动调整图片顺序"
                  onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, item.id); }}
                  className="image-card-drag-handle image-card-drag-handle-label"
                >{isCover ? <Star size={10} fill="currentColor" /> : <GripVertical size={10} />}<span>{isCover ? '封面' : '拖动'}</span></div>}
                {!compact && deleteButton}
              </div>
              {sortable && (compact ? (
                <div className="image-card-controls">
                  <button type="button" title={isCover ? '当前为封面图片' : '设为封面'} aria-label={isCover ? '当前为封面图片' : '设为封面'} disabled={isCover} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setCover(item.id); }} className={`image-card-button${isCover ? ' is-on' : ''}`}>{isCover ? <Check size={12} /> : <Star size={12} />}</button>
                  <button type="button" title="长按拖动调整图片顺序" aria-label="长按拖动调整图片顺序" className="image-card-button" onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, item.id); }}><GripVertical size={12} /></button>
                  {deleteButton}
                </div>
              ) : (
                <button type="button" title={isCover ? '当前为封面图片' : '设为封面'} disabled={isCover} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setCover(item.id); }} className="image-card-button" style={{ position: 'static', width: '100%', height: 25, gap: 4, color: isCover ? 'var(--color-accent)' : 'var(--tone-text-soft)', background: isCover ? 'var(--color-accent-soft)' : 'var(--color-surface)', boxShadow: 'inset 0 0 0 1px var(--color-divider)', cursor: isCover ? 'default' : 'pointer', fontSize: 11 }}>{isCover ? <><Check size={12} />封面图片</> : <><Star size={12} />设为封面</>}</button>
              ))}
              {!!categories?.length && <select
                aria-label={`${item.name}图片分类`}
                className="image-card-category"
                value={item.category ?? categories[0].value}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onChange(value.map((entry) => entry.id === item.id ? { ...entry, category: event.target.value } : entry))}
              >{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>}
              {showNotes && <input aria-label={`${item.name}备注`} className="image-card-note" value={item.note ?? ''} onChange={(event) => onChange(value.map((entry) => entry.id === item.id ? { ...entry, note: event.target.value } : entry))} placeholder={compact ? '备注' : categories?.length ? '备注（如：客户A要求补拍）' : '凭证备注'} />}
            </div>
          );
        })}
        {canAdd && <label className="image-upload-empty" style={{ minHeight: 82, cursor: 'pointer' }}>
          <ImagePlus size={18} />
          <span>添加图片</span>
          <input type="file" accept={accept} multiple={multiple && fileLimit > 1} onChange={onFileChange} style={{ display: 'none' }} />
        </label>}
      </div>
      <div className="image-upload-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Upload size={13} /><span>支持上传图片</span><ClipboardPaste size={13} /><span>支持粘贴</span>{message && <span style={{ color: 'var(--color-warning-text)' }}>{message}</span>}</div>
    </div>
  );
}
