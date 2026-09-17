import { Check, CheckCheck, ChevronLeft, ChevronRight, Clipboard, Copy, Download, ExternalLink, Hand, Image as ImageIcon, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from './Modal';
import { canSaveImageNatively, registerImageSavedHandler, saveImageNatively } from '../app-bridge';
import { thumbUrl } from '../image-urls';
import { useIsNarrow } from '../use-is-narrow';
import type { ImageAttachment } from './ImagePasteUpload';
import {
  PRODUCT_IMAGE_CATEGORY_LABELS,
  PRODUCT_IMAGE_CATEGORY_SEQUENCE,
  normalizeProductImageCategory,
} from '../../shared/product-image-categories';

export interface ProductImagesModalProps {
  open: boolean;
  productName?: string;
  images: ImageAttachment[];
  onClose: () => void;
}

const ALL_CATEGORIES = 'all';
const COARSE_POINTER_QUERY = '(pointer: coarse)';

/** 是否触摸输入：带触摸屏的 Windows 桌面同样为 true，需再叠加窄屏才是手机/平板。 */
function useTouchPointer() {
  const detect = () => (
    typeof window === 'undefined'
      ? false
      : window.matchMedia(COARSE_POINTER_QUERY).matches || navigator.maxTouchPoints > 0
  );
  const [touch, setTouch] = useState(detect);
  useEffect(() => {
    const query = window.matchMedia(COARSE_POINTER_QUERY);
    const update = () => setTouch(detect());
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return touch;
}

/** 图片写入剪贴板只在安全上下文（https / localhost）可用，局域网 http 下必然失败。 */
function supportsImageCopy() {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && typeof navigator !== 'undefined'
    && typeof navigator.clipboard?.write === 'function'
    && typeof ClipboardItem !== 'undefined';
}

function safeFileName(name: string, index: number) {
  const baseName = name.trim().replace(/[\\/:*?"<>|]+/g, '_') || `产品图片-${index + 1}`;
  return /\.[a-z0-9]+$/i.test(baseName) ? baseName : `${baseName}.png`;
}

/** 桌面端专用：<a download> + blob 只适合桌面浏览器。iOS Safari 与部分安卓内置浏览器会静默忽略它，手机端改走「长按保存」。 */
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 立刻 revoke 会让部分浏览器还没读完 blob 就被掐断，留足时间再回收。
  window.setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片格式转换失败'));
    }, 'image/png');
  });
}

async function toClipboardBlob(blob: Blob) {
  if (blob.type === 'image/png') return blob;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('图片加载失败'));
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) throw new Error('图片格式转换失败');
    context.drawImage(image, 0, 0);
    return canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function ProductImagesModal({ open, productName = '产品', images, onClose }: ProductImagesModalProps) {
  const [previewId, setPreviewId] = useState(images[0]?.id ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(images[0] ? [images[0].id] : []));
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [savingToAlbum, setSavingToAlbum] = useState(false);
  const [savingProgress, setSavingProgress] = useState('');
  const touchPointer = useTouchPointer();
  const narrow = useIsNarrow();
  const touchDevice = touchPointer && narrow;
  const canCopyImages = supportsImageCopy();
  const nativeSave = canSaveImageNatively();
  /** 原生一次只写一张，剩下的排队；用 ref 保存队列以免回调里读到过期闭包。 */
  const saveQueueRef = useRef<ImageAttachment[]>([]);
  const saveTotalRef = useRef(0);
  const saveResultRef = useRef({ ok: 0, failed: 0 });
  const albumBatchRef = useRef(false);

  /** App 内保存：逐张交给原生写进相册，原生每存完一张回调一次。 */
  const sendNextToAlbum = () => {
    const next = saveQueueRef.current.shift();
    if (!next) {
      const { ok, failed } = saveResultRef.current;
      albumBatchRef.current = false;
      setSavingToAlbum(false);
      setSavingProgress('');
      setCopyMessage(failed ? `已保存 ${ok} 张，${failed} 张失败，请重试` : `已保存 ${ok} 张到手机相册`);
      return;
    }
    setSavingProgress(`${saveResultRef.current.ok + saveResultRef.current.failed + 1}/${saveTotalRef.current}`);
    // 桥接在调用瞬间消失（例如 App 被换成旧版本）时直接收尾，不能让按钮卡在「保存中」。
    if (!saveImageNatively(next.url, next.name)) {
      saveResultRef.current.failed += 1;
      sendNextToAlbum();
    }
  };

  const saveSelectedToAlbum = () => {
    if (!selectedImages.length || savingToAlbum) return;
    saveQueueRef.current = [...selectedImages];
    saveTotalRef.current = selectedImages.length;
    saveResultRef.current = { ok: 0, failed: 0 };
    albumBatchRef.current = true;
    setCopyMessage('');
    setSavingToAlbum(true);
    sendNextToAlbum();
  };

  useEffect(() => {
    if (!nativeSave) return undefined;
    return registerImageSavedHandler((ok) => {
      // 长按图片保存走的是同一个回调，但没有排队中的批次，这里忽略即可。
      if (!albumBatchRef.current) return;
      if (ok) saveResultRef.current.ok += 1;
      else saveResultRef.current.failed += 1;
      sendNextToAlbum();
    });
  }, [nativeSave]);

  useEffect(() => {
    const firstId = images[0]?.id ?? '';
    setPreviewId(firstId);
    setSelectedIds(firstId ? new Set([firstId]) : new Set());
    setCategoryFilter(ALL_CATEGORIES);
    setCopyMessage('');
    setViewerOpen(false);
    // 上一次未存完的批次跟着作废，否则换了产品还会继续往相册里塞旧图。
    albumBatchRef.current = false;
    saveQueueRef.current = [];
    setSavingToAlbum(false);
    setSavingProgress('');
  }, [open, images]);

  // 只展示实际有图的分类，避免出现点了空白的分段项。
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const image of images) {
      const key = normalizeProductImageCategory(image.category);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [images]);

  const visibleImages = useMemo(
    () => (categoryFilter === ALL_CATEGORIES
      ? images
      : images.filter((image) => normalizeProductImageCategory(image.category) === categoryFilter)),
    [images, categoryFilter],
  );

  const selectedImage = visibleImages.find((image) => image.id === previewId) ?? visibleImages[0];
  const previewIndex = selectedImage ? visibleImages.findIndex((image) => image.id === selectedImage.id) : -1;
  const selectedImages = useMemo(() => visibleImages.filter((image) => selectedIds.has(image.id)), [visibleImages, selectedIds]);
  const allSelected = visibleImages.length > 0 && selectedImages.length === visibleImages.length;
  const viewerImage = selectedImages[Math.min(viewerIndex, selectedImages.length - 1)];

  /** 手机端保存入口：打开全屏大图，让用户长按走系统「存储到照片」。 */
  const openViewer = () => {
    if (!selectedImages.length) return;
    const start = selectedImages.findIndex((image) => image.id === selectedImage?.id);
    setViewerIndex(start >= 0 ? start : 0);
    setCopyMessage('');
    setViewerOpen(true);
  };

  const changeCategoryFilter = (value: string) => {
    setCategoryFilter(value);
    const next = value === ALL_CATEGORIES
      ? images
      : images.filter((image) => normalizeProductImageCategory(image.category) === value);
    // 切换分类后清空选择，避免"已选"里混着当前看不到的图片。
    setPreviewId(next[0]?.id ?? '');
    setSelectedIds(new Set());
    setCopyMessage('');
  };

  const goPreview = (offset: number) => {
    const nextIndex = previewIndex + offset;
    if (nextIndex < 0 || nextIndex >= visibleImages.length) return;
    setPreviewId(visibleImages[nextIndex].id);
    setCopyMessage('');
  };

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPreview(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goPreview(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, previewIndex, visibleImages]);

  useEffect(() => {
    if (!viewerOpen) return undefined;
    const step = (offset: number) => setViewerIndex((index) => Math.min(Math.max(index + offset, 0), selectedImages.length - 1));
    const handleViewerKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      // 捕获阶段先拦下按键：否则弹窗那层的全局监听会跟着响应，Esc 会连整个图库一起关掉。
      event.stopPropagation();
      event.preventDefault();
      if (event.key === 'Escape') setViewerOpen(false);
      else step(event.key === 'ArrowLeft' ? -1 : 1);
    };
    document.addEventListener('keydown', handleViewerKeyDown, true);
    return () => document.removeEventListener('keydown', handleViewerKeyDown, true);
  }, [viewerOpen, selectedImages.length]);

  const toggleImage = (image: ImageAttachment) => {
    setPreviewId(image.id);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(image.id)) next.delete(image.id);
      else next.add(image.id);
      return next;
    });
    setCopyMessage('');
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(visibleImages.map((image) => image.id)));
    setCopyMessage('');
  };

  const fetchImageBlobs = async (items: ImageAttachment[]) => {
    return Promise.all(items.map(async (image) => {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error('图片读取失败');
      const blob = await response.blob();
      return { image, blob: blob.type ? blob : new Blob([blob], { type: 'image/png' }) };
    }));
  };

  /** 桌面端专用：手机端不再走这里（手机走全屏长按保存），所以文案只按桌面写。 */
  const downloadSelected = async () => {
    if (!selectedImages.length || downloading) return;
    setDownloading(true);
    setCopyMessage('');
    try {
      const blobs = await fetchImageBlobs(selectedImages);
      blobs.forEach(({ image }, index) => downloadBlob(blobs[index].blob, safeFileName(image.name, index)));
      setCopyMessage(`已开始下载 ${blobs.length} 张图片`);
    } catch {
      setCopyMessage('图片下载失败，请右键保存图片');
    } finally {
      setDownloading(false);
    }
  };

  const copySelected = async () => {
    if (!selectedImages.length || copying) return;
    setCopyMessage('');
    if (!supportsImageCopy()) {
      setCopyMessage('当前环境不支持复制图片，请使用保存到相册');
      return;
    }

    setCopying(true);
    try {
      const blobs = await fetchImageBlobs(selectedImages);
      const clipboardBlobs = await Promise.all(blobs.map(({ blob }) => toClipboardBlob(blob)));
      const items = clipboardBlobs.map((blob) => new ClipboardItem({ 'image/png': blob }));
      await navigator.clipboard.write(items);
      setCopyMessage(`已复制 ${items.length} 张图片，可直接粘贴`);
    } catch {
      setCopyMessage('当前浏览器不支持多图复制，请使用保存到相册');
    } finally {
      setCopying(false);
    }
  };

  const showCategoryFilter = categoryCounts.size > 1;

  return (
    <Modal open={open} title={`${productName} · 全部图片`} onClose={onClose} width={820}>
      {!images.length ? (
        <div className="product-images-empty"><ImageIcon size={28} /><span>暂无产品图片</span></div>
      ) : (
        <div className="product-images-content">
          {showCategoryFilter && <div className="segmented product-images-filter">{[
            { value: ALL_CATEGORIES, label: `全部 ${images.length}` },
            ...PRODUCT_IMAGE_CATEGORY_SEQUENCE
              .filter((category) => categoryCounts.has(category))
              .map((category) => ({ value: category as string, label: `${PRODUCT_IMAGE_CATEGORY_LABELS[category]} ${categoryCounts.get(category) ?? 0}` })),
          ].map((option) => <button key={option.value} className={`segmented-item${categoryFilter === option.value ? ' is-active' : ''}`} type="button" onClick={() => changeCategoryFilter(option.value)}>{option.label}</button>)}</div>}
          <div className="product-images-preview-wrap">
            <div className="product-images-preview">
              {selectedImage && <img src={selectedImage.url} alt={selectedImage.name} draggable={false} />}
              <button className="product-images-preview-nav product-images-preview-nav-prev" type="button" aria-label="上一张图片" title="上一张图片" disabled={previewIndex <= 0} onClick={() => goPreview(-1)}><ChevronLeft size={22} /></button>
              <button className="product-images-preview-nav product-images-preview-nav-next" type="button" aria-label="下一张图片" title="下一张图片" disabled={previewIndex < 0 || previewIndex >= visibleImages.length - 1} onClick={() => goPreview(1)}><ChevronRight size={22} /></button>
            </div>
            <div className="product-images-preview-name">{selectedImage?.name || '产品图片'}</div>
            {selectedImage && <div className="product-images-preview-meta">
              <span className="product-image-category-badge">{PRODUCT_IMAGE_CATEGORY_LABELS[normalizeProductImageCategory(selectedImage.category)]}</span>
              {selectedImage.note?.trim() && <span className="product-images-preview-note" title={selectedImage.note}>{selectedImage.note}</span>}
            </div>}
          </div>
          <div className="product-images-side">
            <div className="product-images-selection-toolbar">
              <span>已选 {selectedImages.length} / {visibleImages.length}</span>
              <button className="product-images-select-all" type="button" onClick={toggleAll}>
                {allSelected ? <CheckCheck size={13} /> : <Check size={13} />}
                {allSelected ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="product-images-thumbnails" aria-label="产品图片列表">
              {visibleImages.map((image) => {
                const selected = selectedIds.has(image.id);
                const previewing = image.id === selectedImage?.id;
                return (
                  <button
                    key={image.id}
                    className={`product-image-thumbnail${selected ? ' is-selected' : ''}${previewing ? ' is-previewing' : ''}`}
                    type="button"
                    title={`${PRODUCT_IMAGE_CATEGORY_LABELS[normalizeProductImageCategory(image.category)]}：${image.name}${image.note?.trim() ? ` · ${image.note}` : ''}`}
                    aria-label={`选择图片：${image.name}`}
                    aria-pressed={selected}
                    onClick={() => toggleImage(image)}
                  >
                    <img src={thumbUrl(image.url, 240)} alt="" loading="lazy" decoding="async" />
                    <span className="product-image-thumbnail-category">{PRODUCT_IMAGE_CATEGORY_LABELS[normalizeProductImageCategory(image.category)]}</span>
                    {selected && <Check size={13} />}
                  </button>
                );
              })}
            </div>
            {touchDevice ? (
              <button
                className="button button-primary product-images-save-button"
                type="button"
                disabled={!selectedImages.length || savingToAlbum}
                onClick={() => (nativeSave ? saveSelectedToAlbum() : openViewer())}
              >
                <Download size={14} />
                {savingToAlbum ? `保存中 ${savingProgress}` : `保存到相册（${selectedImages.length}）`}
              </button>
            ) : (
              <>
                {canCopyImages && (
                  <button className="button button-primary product-images-copy-button" type="button" disabled={!selectedImages.length || copying} onClick={() => void copySelected()}>
                    {copying ? <Clipboard size={14} /> : <Copy size={14} />}
                    {copying ? '复制中...' : `复制所选图片（${selectedImages.length}）`}
                  </button>
                )}
                <button className={`button${canCopyImages ? '' : ' button-primary'} product-images-download-button`} type="button" disabled={!selectedImages.length || downloading} onClick={() => void downloadSelected()}>
                  <Download size={14} />
                  {downloading ? '准备中...' : `下载所选图片（${selectedImages.length}）`}
                </button>
              </>
            )}
            {copyMessage && <div className="product-images-copy-message" role="status">{copyMessage}</div>}
            <div className="product-images-help">
              点击缩略图可预览并切换选择状态，
              {touchDevice ? (nativeSave ? '点「保存到相册」即可存进手机相册。' : '长按大图可保存到相册。') : '也可以右键保存图片。'}
            </div>
          </div>
        </div>
      )}
      {viewerOpen && viewerImage && createPortal(
        <div
          className="image-save-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="保存图片到相册"
          onClick={(event) => { if (event.target === event.currentTarget) setViewerOpen(false); }}
        >
          <div className="image-save-viewer-bar">
            <span className="image-save-viewer-counter">{viewerIndex + 1} / {selectedImages.length}</span>
            <button className="image-save-viewer-close" type="button" autoFocus aria-label="关闭大图" title="关闭大图" onClick={() => setViewerOpen(false)}><X size={20} /></button>
          </div>
          <div className="image-save-viewer-stage">
            <img className="image-save-viewer-image" src={viewerImage.url} alt={viewerImage.name} draggable={false} />
          </div>
          <div className="image-save-viewer-name">{viewerImage.name}</div>
          <div className="image-save-viewer-hint"><Hand size={16} /><span>长按图片，选择「存储到照片」即可保存到手机相册</span></div>
          <div className="image-save-viewer-actions">
            {selectedImages.length > 1 && (
              <>
                <button className="image-save-viewer-step" type="button" disabled={viewerIndex <= 0} onClick={() => setViewerIndex((index) => Math.max(index - 1, 0))}><ChevronLeft size={16} />上一张</button>
                <button className="image-save-viewer-step" type="button" disabled={viewerIndex >= selectedImages.length - 1} onClick={() => setViewerIndex((index) => Math.min(index + 1, selectedImages.length - 1))}>下一张<ChevronRight size={16} /></button>
              </>
            )}
            <a className="image-save-viewer-open" href={viewerImage.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />在新标签打开</a>
          </div>
        </div>,
        document.body,
      )}
    </Modal>
  );
}
