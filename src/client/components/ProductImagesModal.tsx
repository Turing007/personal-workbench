import { Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Clipboard, Copy, Download, ExternalLink, Folder, Hand, Image as ImageIcon, Upload, X, ZoomIn } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { createPortal } from 'react-dom';
import Modal from './Modal';
import PendingImageTile from './PendingImageTile';
import type { UploadFileSnapshot } from '../product-upload-queue';
import { canSaveImageNatively, registerImageSaveFailureHandler, registerImageSavedHandler } from '../app-bridge';
import { reportImageSaveFailure, saveStageText, startSaveImageToAlbum } from '../image-save';
import { thumbUrl } from '../image-urls';
import { registerCloseLayer, unregisterCloseLayer } from '../navigation-history';
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
  /** 还在后台上传的图（本地预览 + 逐张进度）；传完会被正式图片顶掉。 */
  pendingImages?: UploadFileSnapshot[];
  /** 单张上传失败时的重试入口（不走整体重试）。 */
  onRetryUploadFile?: (taskId: string) => void;
  onClose: () => void;
}

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

export default function ProductImagesModal({ open, productName = '产品', images, pendingImages = [], onRetryUploadFile, onClose }: ProductImagesModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  /** 放大镜浮层：null = 关闭，否则是当前查看的图片 id。 */
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  /** 保存到相册的全屏长按查看器（与放大镜是两个独立入口）。 */
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [savingToAlbum, setSavingToAlbum] = useState(false);
  const [savingProgress, setSavingProgress] = useState('');
  /** 大图浮层里的单张下载：忙碌态与结果提示（浮层关闭后仍可复用状态）。 */
  const [zoomDownloading, setZoomDownloading] = useState(false);
  const [zoomSaveMessage, setZoomSaveMessage] = useState('');
  const touchPointer = useTouchPointer();
  const narrow = useIsNarrow();
  const touchDevice = touchPointer && narrow;
  const canCopyImages = supportsImageCopy();
  const nativeSave = canSaveImageNatively();
  const zoomLayerRef = useRef(Symbol('product-image-zoom'));
  /** 原生一次只写一张，剩下的排队；用 ref 保存队列以免回调里读到过期闭包。 */
  const saveQueueRef = useRef<ImageAttachment[]>([]);
  const saveTotalRef = useRef(0);
  const saveResultRef = useRef({ ok: 0, failed: 0 });
  const saveFailureRef = useRef('');
  const albumBatchRef = useRef(false);
  /** 大图浮层里正在等原生回执的单张保存；与批量保存的回执互斥。 */
  const singleSaveRef = useRef(false);
  const zoomFailureRef = useRef('');
  /** 最近一次普通点击（非 Shift）的锚点；Shift 连选以它为起点。 */
  const selectionAnchorRef = useRef<string | null>(null);
  /** 手机端大图左右滑动的起点；只在窄屏生效，桌面仍用底部按钮。 */
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  /** 刚滑过一张的时间戳：浏览器补发的那次 click 不能把浮层关掉。 */
  const lastSwipeAtRef = useRef(0);

  /** 记录最近一次失败环节：界面提示用，同时回报到服务端日志。 */
  const noteSaveFailure = (stage: string | undefined, message = '') => {
    if (!stage) return;
    saveFailureRef.current = saveStageText(stage);
    reportImageSaveFailure(stage, message);
  };

  /** App 内保存：逐张交给原生写进相册，原生每存完一张回调一次。 */
  const sendNextToAlbum = () => {
    const next = saveQueueRef.current.shift();
    if (!next) {
      const { ok, failed } = saveResultRef.current;
      const reason = saveFailureRef.current;
      albumBatchRef.current = false;
      setSavingToAlbum(false);
      setSavingProgress('');
      setCopyMessage(failed ? `已保存 ${ok} 张，${failed} 张失败${reason ? `：${reason}` : ''}，请重试` : `已保存 ${ok} 张到手机相册`);
      return;
    }
    setSavingProgress(`${saveResultRef.current.ok + saveResultRef.current.failed + 1}/${saveTotalRef.current}`);
    void startSaveImageToAlbum(next.url, next.name).then((result) => {
      if (result.started) return; // 等原生回执再存下一张
      // 没能启动（抓图失败 / 桥接消失）也要计数并继续，不能让按钮卡在「保存中」。
      noteSaveFailure(result.stage, result.message);
      saveResultRef.current.failed += 1;
      sendNextToAlbum();
    });
  };

  const saveSelectedToAlbum = () => {
    if (!selectedImages.length || savingToAlbum) return;
    saveQueueRef.current = [...selectedImages];
    saveTotalRef.current = selectedImages.length;
    saveResultRef.current = { ok: 0, failed: 0 };
    saveFailureRef.current = '';
    albumBatchRef.current = true;
    setCopyMessage('');
    setSavingToAlbum(true);
    sendNextToAlbum();
  };

  useEffect(() => {
    if (!nativeSave) return undefined;
    const unregisterSaved = registerImageSavedHandler((ok) => {
      // 大图浮层的单张保存：一次只存一张，收到回执就收尾。
      if (singleSaveRef.current) {
        singleSaveRef.current = false;
        setZoomDownloading(false);
        setZoomSaveMessage(ok ? '已保存到手机相册' : `保存失败${zoomFailureRef.current ? `：${zoomFailureRef.current}` : '，请重试'}`);
        zoomFailureRef.current = '';
        return;
      }
      if (!albumBatchRef.current) return;
      if (ok) saveResultRef.current.ok += 1;
      else saveResultRef.current.failed += 1;
      sendNextToAlbum();
    });
    const unregisterFailed = registerImageSaveFailureHandler((stage, message) => {
      if (singleSaveRef.current) {
        zoomFailureRef.current = saveStageText(stage);
        reportImageSaveFailure(stage, message);
        return;
      }
      if (!albumBatchRef.current) return;
      noteSaveFailure(stage, message);
    });
    return () => {
      unregisterSaved();
      unregisterFailed();
    };
  }, [nativeSave]);

  useEffect(() => {
    // 打开弹窗/切换产品时不再默认勾选第一张：预勾选会让复制、下载、保存到相册的计数虚高，
    // 用户还得先手动取消第一张，一不小心就把不想带的图一起复制走了。
    setSelectedIds(new Set());
    setCollapsedFolders([]);
    setCopyMessage('');
    setZoomedId(null);
    setViewerOpen(false);
    // 上一次未存完的批次跟着作废，否则换了产品还会继续往相册里塞旧图。
    albumBatchRef.current = false;
    saveQueueRef.current = [];
    selectionAnchorRef.current = null;
    setSavingToAlbum(false);
    setSavingProgress('');
  }, [open, images]);

  // 只展示实际有图的分类文件夹，避免出现点开全空的块。
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const image of images) {
      const key = normalizeProductImageCategory(image.category);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [images]);

  const visibleImages = images;
  /** 展示顺序（按分类文件夹分组）：Shift 连选按这个顺序框选，折叠起来的文件夹也参与。 */
  const orderedImages = useMemo(
    () => PRODUCT_IMAGE_CATEGORY_SEQUENCE
      .filter((category) => categoryCounts.has(category))
      .flatMap((category) => images.filter((image) => normalizeProductImageCategory(image.category) === category)),
    [images, categoryCounts],
  );

  const selectedImages = useMemo(() => visibleImages.filter((image) => selectedIds.has(image.id)), [visibleImages, selectedIds]);
  const allSelected = visibleImages.length > 0 && selectedImages.length === visibleImages.length;
  const zoomIndex = zoomedId ? visibleImages.findIndex((image) => image.id === zoomedId) : -1;
  const zoomedImage = zoomIndex >= 0 ? visibleImages[zoomIndex] : null;
  const viewerImage = selectedImages[Math.min(viewerIndex, selectedImages.length - 1)];

  /**
   * 大图浮层里的单张下载。
   * App 内：交给原生写相册（1.18+ 用网页抓好的字节，旧壳回退原生下载通道），等回执再收尾。
   * 桌面：直接抓原图字节走 <a download>。
   */
  const downloadZoomed = async () => {
    if (!zoomedImage || zoomDownloading) return;
    setZoomSaveMessage('');
    // 手机浏览器（不在壳里）没有可靠的下载通道：<a download> 会被 iOS 静默忽略，
    // 这时请用户直接长按这张大图走系统「存储到照片」，别假装下载成功。
    if (touchDevice && !nativeSave) {
      setZoomSaveMessage('长按这张大图即可保存到相册');
      return;
    }
    if (!nativeSave) {
      setZoomDownloading(true);
      try {
        const { blob } = (await fetchImageBlobs([zoomedImage]))[0];
        downloadBlob(blob, safeFileName(zoomedImage.name, zoomIndex));
        setZoomSaveMessage('已开始下载这张图片');
      } catch {
        setZoomSaveMessage('图片下载失败，请右键保存图片');
      } finally {
        setZoomDownloading(false);
      }
      return;
    }

    setZoomDownloading(true);
    zoomFailureRef.current = '';
    singleSaveRef.current = true;
    const result = await startSaveImageToAlbum(zoomedImage.url, zoomedImage.name);
    if (result.started) return; // 等原生回执
    // 没能启动（抓图失败 / 桥接消失）也要结束忙碌态，不能卡在「保存中」。
    singleSaveRef.current = false;
    setZoomDownloading(false);
    setZoomSaveMessage(`保存失败：${saveStageText(result.stage ?? 'bridge')}`);
    if (result.stage) reportImageSaveFailure(result.stage, result.message ?? '');
  };

  /** 手机端保存入口：打开全屏大图，让用户长按走系统「存储到照片」。 */
  const openViewer = () => {
    if (!selectedImages.length) return;
    setViewerIndex(0);
    setCopyMessage('');
    setViewerOpen(true);
  };

  const goZoom = (offset: number) => {
    setZoomedId((current) => {
      const index = visibleImages.findIndex((image) => image.id === current);
      return visibleImages[index + offset]?.id ?? current;
    });
  };

  useEffect(() => {
    if (!zoomedImage) return undefined;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      // 捕获阶段先拦下按键：否则外层图库的监听会跟着响应，Esc 会连整个弹窗一起关掉。
      event.stopPropagation();
      event.preventDefault();
      if (event.key === 'Escape') setZoomedId(null);
      else goZoom(event.key === 'ArrowLeft' ? -1 : 1);
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [zoomedImage, visibleImages]);

  // 安卓返回键：放大图浮层在弹窗之上，先关浮层、再关图库。
  const zoomOpen = Boolean(zoomedImage);
  useEffect(() => {
    if (!zoomOpen) return undefined;
    registerCloseLayer(zoomLayerRef.current, () => setZoomedId(null));
    return () => unregisterCloseLayer(zoomLayerRef.current);
  }, [zoomOpen]);

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

  /** 点缩略图或放大镜：只打开大图浮层，不改变勾选；勾选走缩略图底部圆钮。 */
  const previewImage = (image: ImageAttachment) => {
    setZoomedId(image.id);
    setCopyMessage('');
  };

  /** 勾选/取消一张图；Shift 点击按文件夹展示顺序把锚点到目标之间全部选中。 */
  const toggleImage = (image: ImageAttachment, event?: ReactMouseEvent<HTMLButtonElement>) => {
    // Shift 连选：以最近一次普通勾选为锚点，把锚点到目标之间（按文件夹展示顺序）全部选中。
    // 锚点不随 Shift 点击移动，方便以同一张为起点反复框选；区间外已勾的保持不动。
    const anchorId = selectionAnchorRef.current;
    if (event?.shiftKey && anchorId && anchorId !== image.id) {
      const from = orderedImages.findIndex((item) => item.id === anchorId);
      const to = orderedImages.findIndex((item) => item.id === image.id);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        const rangeIds = orderedImages.slice(start, end + 1).map((item) => item.id);
        setSelectedIds((current) => {
          const next = new Set(current);
          for (const id of rangeIds) next.add(id);
          return next;
        });
        setCopyMessage('');
        return;
      }
    }
    selectionAnchorRef.current = image.id;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(image.id)) next.delete(image.id);
      else next.add(image.id);
      return next;
    });
    setCopyMessage('');
  };

  /** 手机端大图左右滑动切图：横向位移够大且明显大于纵向，才当成换图，避免和上下滚动打架。 */
  const onZoomTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    swipeRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const onZoomTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || !touchDevice) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    // 滑完浏览器还会补一次 click，别让那一下把刚翻到的大图关掉。
    lastSwipeAtRef.current = Date.now();
    goZoom(dx < 0 ? 1 : -1);
  };

  /** 点大图周围的空白关闭浮层（点图片本身不关，方便凑近看细节）；滑动手势紧跟的那次 click 不算。 */
  const closeZoomOnBackdrop = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastSwipeAtRef.current < 350) return;
    // 外框和舞台都可能是「空白」：图片比舞台小时点到的就是舞台本身。
    if (event.target === event.currentTarget) setZoomedId(null);
  };
  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(visibleImages.map((image) => image.id)));
    // 全选/清空后锚点作废：下一次 Shift 连选从刚点的那张重新起算。
    selectionAnchorRef.current = null;
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
      // 下载已启动就清空勾选，省得下一批还要先逐个取消；抓图失败时走到 catch，勾选保留。
      setSelectedIds(new Set());
      selectionAnchorRef.current = null;
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

  /** 标题栏右侧的批量操作：固定在顶部，不用滚到列表底部。 */
  const headerActions = (
    <>
      {touchDevice ? (
        <button
          className="button button-primary button-sm product-images-save-button"
          type="button"
          disabled={!selectedImages.length || savingToAlbum}
          onClick={() => (nativeSave ? saveSelectedToAlbum() : openViewer())}
        >
          <Download size={13} />
          {savingToAlbum ? `保存中 ${savingProgress}` : `存相册（${selectedImages.length}）`}
        </button>
      ) : (
        <>
          {canCopyImages && (
            <button className="button button-primary button-sm product-images-copy-button" type="button" disabled={!selectedImages.length || copying} onClick={() => void copySelected()}>
              {copying ? <Clipboard size={13} /> : <Copy size={13} />}
              {copying ? '复制中...' : `复制（${selectedImages.length}）`}
            </button>
          )}
          <button className={`button button-sm${canCopyImages ? '' : ' button-primary'} product-images-download-button`} type="button" disabled={!selectedImages.length || downloading} onClick={() => void downloadSelected()}>
            <Download size={13} />
            {downloading ? '准备中...' : `下载（${selectedImages.length}）`}
          </button>
        </>
      )}
    </>
  );

  return (
    <Modal open={open} className="product-images-modal" title={`${productName} · 全部图片`} onClose={onClose} width={880} headerExtra={headerActions}>
      {!images.length && !pendingImages.length ? (
        <div className="product-images-empty"><ImageIcon size={28} /><span>暂无产品图片</span></div>
      ) : (
        <div className="product-images-content">
          <div className="product-images-side">
            {!!pendingImages.length && <section className="product-images-pending" aria-label="正在上传的图片">
              <div className={`product-images-pending-header${pendingImages.some((item) => item.status === 'failed') && !pendingImages.some((item) => item.status === 'queued' || item.status === 'uploading') ? ' is-failed' : ''}`}>
                <Upload size={13} />
                <span>{pendingImages.some((item) => item.status === 'queued' || item.status === 'uploading') ? '正在上传' : '上传失败'}</span>
                <span className="image-folder-count">{pendingImages.length} 张</span>
              </div>
              <div className="product-images-thumbnails product-images-pending-thumbnails">
                {pendingImages.map((item) => <PendingImageTile key={item.id} item={item} onRetry={onRetryUploadFile} />)}
              </div>
            </section>}
            {!!visibleImages.length && <div className="product-images-selection-toolbar">
              <span>已选 {selectedImages.length} / {visibleImages.length}</span>
              <button className="product-images-select-all" type="button" onClick={toggleAll}>
                {allSelected ? <CheckCheck size={13} /> : <Check size={13} />}
                {allSelected ? '取消全选' : '全选'}
              </button>
            </div>}
            <div className="image-folder-list" aria-label="产品图片列表">
              {PRODUCT_IMAGE_CATEGORY_SEQUENCE
                .filter((category) => categoryCounts.has(category))
                .map((category) => {
                  const folderImages = images.filter((image) => normalizeProductImageCategory(image.category) === category);
                  const collapsed = collapsedFolders.includes(category);
                  return (
                    <section key={category} className="image-folder">
                      <button
                        type="button"
                        className={collapsed ? 'image-folder-header is-collapsed' : 'image-folder-header'}
                        aria-expanded={!collapsed}
                        onClick={() => setCollapsedFolders((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category])}
                      >
                        <Folder size={13} />
                        <span>{PRODUCT_IMAGE_CATEGORY_LABELS[category]}</span>
                        <span className="image-folder-count">{folderImages.length} 张</span>
                        <ChevronDown size={13} className="image-folder-chevron" />
                      </button>
                      {!collapsed && (
                        <div className="product-images-thumbnails">
                          {folderImages.map((image) => {
                            const selected = selectedIds.has(image.id);
                            return (
                              <div
                                key={image.id}
                                className={`product-image-thumbnail${selected ? ' is-selected' : ''}`}
                              >
                                <button
                                  className="product-image-thumbnail-preview"
                                  type="button"
                                  title={`${PRODUCT_IMAGE_CATEGORY_LABELS[normalizeProductImageCategory(image.category)]}：${image.name}${image.note?.trim() ? ` · ${image.note}` : ''}`}
                                  aria-label={`预览图片：${image.name}`}
                                  onClick={() => previewImage(image)}
                                >
                                  <img src={thumbUrl(image.url, 240)} alt="" loading="lazy" decoding="async" />
                                </button>
                                {/* 底栏：分类 + 放大镜 + 勾选圆钮。放大镜点开大图浮层，圆钮只负责勾选，三者热区互不重叠。 */}
                                <div className="product-image-thumbnail-footer">
                                  <span className="product-image-thumbnail-category">{PRODUCT_IMAGE_CATEGORY_LABELS[normalizeProductImageCategory(image.category)]}</span>
                                  <button
                                    className="product-image-thumbnail-zoom"
                                    type="button"
                                    title={`放大查看：${image.name}`}
                                    aria-label={`放大查看图片：${image.name}`}
                                    onClick={() => previewImage(image)}
                                  ><ZoomIn size={13} /></button>
                                  <button
                                    className="product-image-thumbnail-select"
                                    type="button"
                                    aria-label={`${selected ? '取消选择' : '选择'}图片：${image.name}`}
                                    aria-pressed={selected}
                                    onClick={(event) => toggleImage(image, event)}
                                  >{selected && <Check size={11} />}</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
            </div>
            {copyMessage && <div className="product-images-copy-message" role="status">{copyMessage}</div>}
            {!!visibleImages.length && <div className="product-images-help">
              点缩略图或放大镜看大图，点缩略图底部圆钮勾选（按住 Shift 可连选一段）；
              {touchDevice ? (nativeSave ? '点顶部的「存相册」即可存进手机相册。' : '长按大图可保存到相册。') : '也可以右键保存图片。'}
            </div>}
          </div>
        </div>
      )}
      {zoomedImage && createPortal(
        <div
          className="product-image-zoom"
          role="dialog"
          aria-modal="true"
          aria-label={`查看大图：${zoomedImage.name}`}
          onClick={closeZoomOnBackdrop}
        >
          <div className="product-image-zoom-bar">
            <span className="product-image-zoom-counter">{zoomIndex + 1} / {visibleImages.length}</span>
            <span className="product-image-zoom-name">{zoomedImage.name}</span>
            <button
              className="product-image-zoom-close"
              type="button"
              aria-label="关闭大图"
              title="关闭大图"
              onClick={() => setZoomedId(null)}
            ><X size={20} /></button>
          </div>
          <div
            className="product-image-zoom-stage"
            onTouchStart={onZoomTouchStart}
            onTouchEnd={onZoomTouchEnd}
            onClick={closeZoomOnBackdrop}
          >
            <img src={zoomedImage.url} alt={zoomedImage.name} draggable={false} />
            {touchDevice && visibleImages.length > 1 && <span className="product-image-zoom-hint">左右滑动切换</span>}
          </div>
          <div className="product-image-zoom-footer">
            <span className="product-image-category-badge">{PRODUCT_IMAGE_CATEGORY_LABELS[normalizeProductImageCategory(zoomedImage.category)]}</span>
            {zoomedImage.note?.trim() && <span className="product-image-zoom-note" title={zoomedImage.note}>{zoomedImage.note}</span>}
            <button className="product-image-zoom-nav" type="button" disabled={zoomIndex <= 0} onClick={() => goZoom(-1)}><ChevronLeft size={16} />上一张</button>
            <button className="product-image-zoom-nav" type="button" disabled={zoomIndex >= visibleImages.length - 1} onClick={() => goZoom(1)}>下一张<ChevronRight size={16} /></button>
            {/* 单张下载：手机交给相册，桌面走浏览器下载；都只针对当前这一张大图。 */}
            <button
              className="product-image-zoom-download"
              type="button"
              disabled={zoomDownloading}
              onClick={() => void downloadZoomed()}
            >
              <Download size={14} />
              {zoomDownloading ? (touchDevice ? '保存中...' : '准备中...') : (touchDevice ? '保存到相册' : '下载这张')}
            </button>
            <a className="product-image-zoom-open" href={zoomedImage.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />在新标签打开</a>
          </div>
          {zoomSaveMessage && <div className="product-image-zoom-message" role="status">{zoomSaveMessage}</div>}
        </div>,
        document.body,
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
