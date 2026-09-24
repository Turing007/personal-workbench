import { Check, ChevronDown, ClipboardPaste, Folder, GripVertical, ImagePlus, Star, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from 'react';
import { canPickFilesNatively, pickFilesNatively } from '../app-bridge';
import { normalizeUploadImage, SUPPORTED_IMAGE_HINT } from '../image-mime';
import { normalizeProductImageCategory } from '../../shared/product-image-categories';

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
  /** 图多时的批量管理（产品图库使用）：可框选多张一次性删除。 */
  selectable?: boolean;
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
  selectable = false,
}: ImagePasteUploadProps) {
  const [message, setMessage] = useState('');
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean }>();
  const dropTargetRef = useRef<{ id: string; before: boolean } | undefined>(undefined);
  const objectUrls = useRef(new Set<string>());
  const valueRef = useRef(value);
  const pointerDragRef = useRef<PointerDragSession | undefined>(undefined);
  const folderInputRefs = useRef(new Map<string, HTMLInputElement>());
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

  const addFiles = async (files: File[], successMessage = '', categoryOverride?: string) => {
    if (!files.length) return;
    // 手机端选图/拍照常拿不到可靠 MIME，这里统一识别（MIME → 扩展名 → 文件头）并回写类型，
    // 否则图片会被静默丢弃，或者以 application/octet-stream 上传被后端拒绝。
    // 识别过程本身也可能在老 WebView 上抛异常，必须捕获成可见提示，不能让上传「点了没反应」。
    let resolved: Array<File | undefined>;
    try {
      resolved = await Promise.all(files.map((file) => normalizeUploadImage(file)));
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : '图片读取失败，请重试');
      return;
    }
    const uploadable = resolved.filter((file): file is File => Boolean(file));
    const current = valueRef.current;
    const remaining = Math.max(0, fileLimit - current.length);
    const accepted = uploadable.slice(0, remaining);
    if (uploadable.length < files.length) setMessage(SUPPORTED_IMAGE_HINT);
    else if (uploadable.length > remaining) setMessage(`最多添加 ${fileLimit} 张图片`);
    else setMessage(successMessage);
    const defaultCategory = categoryOverride ?? categories?.[0]?.value;
    const attachments = accepted.map((file) => {
      const attachment = fileToAttachment(file);
      return defaultCategory ? { ...attachment, category: defaultCategory } : attachment;
    });
    attachments.forEach((attachment) => objectUrls.current.add(attachment.url));
    const next = multiple || fileLimit > 1 ? [...current, ...attachments] : attachments;
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

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((id2) => id2 !== id) : [...current, id]);
  };

  /** 多选模式下一次性删除所有选中图片；已保存的逐张走 onDeleteSaved，单个失败不拖累其余。 */
  const removeSelected = async () => {
    const targets = value.filter((item) => selectedIds.includes(item.id));
    if (!targets.length || deletingIds.length) return;
    // 已保存图的真正删除发生在「保存产品」时由 App 的差异清理执行，这里提示时点。
    if (!window.confirm(`确定删除所选的 ${targets.length} 张图片吗？将随下一次保存生效。`)) return;
    setMessage('');
    setDeletingIds(targets.map((item) => item.id));
    const removedIds: string[] = [];
    const failedNames: string[] = [];
    try {
      for (const attachment of targets) {
        try {
          if (!attachment.file && onDeleteSaved) await onDeleteSaved(attachment);
          if (attachment.file) {
            URL.revokeObjectURL(attachment.url);
            objectUrls.current.delete(attachment.url);
          }
          removedIds.push(attachment.id);
        } catch {
          failedNames.push(attachment.name || '图片');
        }
      }
      if (removedIds.length) {
        onChange(value.filter((entry) => !removedIds.includes(entry.id)));
        if (failedNames.length) setMessage(`已删除 ${removedIds.length} 张，${failedNames.length} 张删除失败：${failedNames.join('、')}`);
        else setMessage(`已删除 ${removedIds.length} 张图片`);
      } else setMessage(`删除失败：${failedNames.join('、')}`);
    } finally {
      setDeletingIds([]);
      setSelectedIds([]);
      // 全部删干净时退出选择态，还剩图片时保留选择态方便继续操作。
      if (value.length === removedIds.length) {
        setSelectMode(false);
      }
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    // 文件夹模式下每个分区有自己的 input，data-folder 标明归入哪个分类。
    const folder = event.target.dataset.folder || undefined;
    // 用 void 调用的 Promise 一旦 reject 就是未处理的静默失败（老 WebView 上尤其危险），
    // 这里补上 catch，保证任何异常都会变成界面上的可见提示。
    void addFiles(Array.from(event.target.files ?? []), '', folder).catch(() => setMessage('图片读取失败，请重试'));
    event.target.value = '';
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.some((item) => item.type.startsWith('image/'))) return;
    event.preventDefault();
    void addFiles(files, '已从剪贴板添加图片').catch(() => setMessage('图片读取失败，请重试'));
  };

  /**
   * 拉起原生选图（仅 App 内）。返回 false 表示原生侧没能拉起，调用方退回 input 路径。
   * 选完的文件同样过 addFiles 的 MIME 识别管线，行为与系统选图器路径一致；
   * categoryOverride 让文件夹模式下的上传直接归入对应分区。
   */
  const pickNatively = (categoryOverride?: string): boolean => {
    const remaining = Math.max(1, fileLimit - valueRef.current.length);
    const accepted = accept.split(',').map((item) => item.trim()).filter(Boolean);
    const picked = pickFilesNatively(accepted, multiple && fileLimit > 1, remaining);
    if (!picked) return false;
    void picked
      .then((files) => addFiles(files, '', categoryOverride))
      .catch(() => setMessage('图片读取失败，请重试'));
    return true;
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

  const renderCard = (item: ImageAttachment, index: number) => {
    const isCover = index === 0;
    const isDeleting = deletingIds.includes(item.id);
    const isSelected = selectMode && selectedIds.includes(item.id);
    // 选择态下停用长按拖动与封面/单张删除：点缩略图 = 勾选，避免两个手势打架。
    const cardSortable = sortable && !selectMode;
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
        onPointerMove={cardSortable ? onPointerMove : undefined}
        onPointerUp={cardSortable ? onPointerUp : undefined}
        onPointerCancel={cardSortable ? onPointerCancel : undefined}
        onLostPointerCapture={cardSortable ? onPointerCancel : undefined}
        className={`image-card${cardSortable && isCover ? ' is-cover' : ''}${draggingId === item.id ? ' is-dragging' : ''}${dropTarget?.id === item.id ? (dropTarget.before ? ' is-drop-before' : ' is-drop-after') : ''}${isSelected ? ' is-selected' : ''}`}
      >
        <div
          className="image-card-thumb"
          onPointerDown={cardSortable ? (event) => onPointerDown(event, item.id) : undefined}
          onClick={selectMode ? (event) => { event.stopPropagation(); toggleSelected(item.id); } : undefined}
          style={selectMode ? { cursor: 'pointer' } : undefined}
        >
          <img draggable={false} className="image-card-img" src={item.url} alt={item.name} />
          {selectMode && <div className={`image-card-check-badge${isSelected ? ' is-on' : ''}`} aria-hidden="true">{isSelected && <Check size={12} />}</div>}
          {cardSortable && !compact && <div
            title="长按拖动调整图片顺序"
            onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, item.id); }}
            className="image-card-drag-handle image-card-drag-handle-label"
          >{isCover ? <Star size={10} fill="currentColor" /> : <GripVertical size={10} />}<span>{isCover ? '封面' : '拖动'}</span></div>}
          {!selectMode && !compact && deleteButton}
        </div>
        {cardSortable && (compact ? (
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
  };

  const renderAddTile = (option?: ImageCategoryOption) => (
    <div
      className="image-upload-empty"
      style={{ minHeight: 82, cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
      onClick={(event) => {
        // 落点是 input 本身：要么是无桥环境下的真实点击，要么是下方兜底的程序化 click()
        // 冒泡回来——两种都必须直接放行，让默认行为（打开系统选图器）发生，
        // 否则会重复弹窗，甚至 preventDefault 掉自己触发的合成点击。
        if (event.target instanceof HTMLInputElement) return;
        // App 内优先走原生选图桥：部分 ROM 的 WebView 里 file input 的点击激活链
        // 整条静默失效（点了连系统选图界面都不弹），只能由原生侧拉起选择器。
        if (canPickFilesNatively()) {
          event.preventDefault();
          if (!pickNatively(option?.value)) folderInputRefs.current.get(option?.value ?? '')?.click();
          return;
        }
        folderInputRefs.current.get(option?.value ?? '')?.click();
      }}
    >
      <ImagePlus size={18} />
      <span>{option ? `添加${option.label}` : '添加图片'}</span>
      {/* 不用 inset 简写（老 WebView 不认），显式写四个方向；input 必须保持「已渲染」，
          display:none / hidden 会让真机点击彻底没有反应。
          有原生桥时 input 不再吃真实点击（pointer-events:none），否则真指落在 input 上
          会走回那条失效的 WebView 选图链；原生桥拉不起来时才靠兜底 click() 激活它。 */}
      <input
        key={option?.value ?? 'default'}
        ref={(el) => { const key = option?.value ?? ''; if (el) folderInputRefs.current.set(key, el); else folderInputRefs.current.delete(key); }}
        type="file"
        accept={accept}
        multiple={multiple && fileLimit > 1}
        data-folder={option?.value}
        onChange={onFileChange}
        aria-label={option ? `添加${option.label}` : '添加图片'}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 1, pointerEvents: canPickFilesNatively() ? 'none' : 'auto' }}
      />
    </div>
  );

  return (
    <div onPaste={onPaste} tabIndex={0} className={`image-upload${compact ? ' is-compact' : ''}`}>
      <div className="image-upload-header">
        <label className="image-upload-label">{label}</label>
        {selectable && value.length > 0 && (
          <button type="button" aria-pressed={selectMode} className={selectMode ? 'image-select-toggle is-on' : 'image-select-toggle'}
            onClick={() => { setSelectedIds([]); setSelectMode((current) => !current); }}
          >{selectMode ? '退出多选' : `多选管理`}</button>
        )}
        <span className="image-upload-hint">点击区域后可 Ctrl+V</span>
      </div>
      {selectMode && <div className="image-select-bar" role="toolbar" aria-label="图片批量操作">
        <span className="image-select-count">已选 {selectedIds.length} / {value.length} 张</span>
        <button type="button" onClick={() => setSelectedIds((current) => current.length === value.length ? [] : value.map((item) => item.id))}>
          {selectedIds.length === value.length ? '取消全选' : '全选'}
        </button>
        <button type="button" className="is-danger" disabled={!selectedIds.length || deletingIds.length > 0} onClick={() => void removeSelected()}>
          <Trash2 size={12} />删除所选{selectedIds.length ? `（${selectedIds.length}）` : ''}
        </button>
      </div>}
      {categories?.length ? (
        <div className="image-folder-list">
          {categories.map((option) => {
            // 历史图片没有分类，normalize 后归入「精修图」，保证任何图片都不落空。
            const entries = value.map((item, index) => ({ item, index })).filter(({ item }) => normalizeProductImageCategory(item.category) === option.value);
            const collapsed = collapsedFolders.includes(option.value);
            return (
              <section key={option.value} className="image-folder">
                <button
                  type="button"
                  className={collapsed ? 'image-folder-header is-collapsed' : 'image-folder-header'}
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsedFolders((current) => current.includes(option.value) ? current.filter((item) => item !== option.value) : [...current, option.value])}
                >
                  <Folder size={13} />
                  <span>{option.label}</span>
                  <span className="image-folder-count">{entries.length} 张</span>
                  <ChevronDown size={13} className="image-folder-chevron" />
                </button>
                {!collapsed && (
                  <div className="image-upload-grid">
                    {entries.map(({ item, index }) => renderCard(item, index))}
                    {canAdd && renderAddTile(option)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="image-upload-grid">
          {value.map((item, index) => renderCard(item, index))}
          {canAdd && renderAddTile()}
        </div>
      )}
      {/* 手机端会隐藏 .image-upload-hint（没有 Ctrl+V），所以提示必须放在它外面，否则用户看不到任何反馈 */}
      {message && <div className="image-upload-message" role="status" aria-live="polite">{message}</div>}
      <div className="image-upload-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Upload size={13} /><span>支持上传图片</span><ClipboardPaste size={13} /><span>支持粘贴</span></div>
    </div>
  );
}
