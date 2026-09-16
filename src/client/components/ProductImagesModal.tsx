import { Check, CheckCheck, ChevronLeft, ChevronRight, Clipboard, Copy, Download, Image as ImageIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { thumbUrl } from '../image-urls';
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

function safeFileName(name: string, index: number) {
  const baseName = name.trim().replace(/[\\/:*?"<>|]+/g, '_') || `产品图片-${index + 1}`;
  return /\.[a-z0-9]+$/i.test(baseName) ? baseName : `${baseName}.png`;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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

  useEffect(() => {
    const firstId = images[0]?.id ?? '';
    setPreviewId(firstId);
    setSelectedIds(firstId ? new Set([firstId]) : new Set());
    setCategoryFilter(ALL_CATEGORIES);
    setCopyMessage('');
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
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      setCopyMessage('当前浏览器不支持复制图片，请下载所选图片');
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
      setCopyMessage('当前浏览器不支持多图复制，请下载所选图片');
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
            <button className="button button-primary product-images-copy-button" type="button" disabled={!selectedImages.length || copying || downloading} onClick={() => void copySelected()}>
              {copying ? <Clipboard size={14} /> : <Copy size={14} />}
              {copying ? '复制中...' : `复制所选图片（${selectedImages.length}）`}
            </button>
            {copyMessage.includes('下载') && <button className="button product-images-download-button" type="button" disabled={!selectedImages.length || downloading || copying} onClick={() => void downloadSelected()}>
              <Download size={14} />
              {downloading ? '准备下载...' : `下载所选图片（${selectedImages.length}）`}
            </button>}
            {copyMessage && <div className="product-images-copy-message" role="status">{copyMessage}</div>}
            <div className="product-images-help">点击缩略图可预览并切换选择状态，也可以右键保存图片。</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
