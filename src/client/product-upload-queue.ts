import {
  reorderProductImages,
  uploadProductAttachment,
  uploadProductImage,
  uploadProductPackagingImage,
  uploadProductVideo,
} from './api';
import { createImageThumbUrl } from './preview-thumbs';
import { compressImageForUpload } from './upload-image-compress';

/**
 * 产品文件后台上传队列。
 *
 * 背景：原先「保存产品」是一条串行长链，新图逐张上传且必须等完，10 张手机原图要等几十秒。
 * 现在产品记录、删除差异、分类回写这些"快且必须与本次保存意图一致"的部分留在前台，
 * 新图/包装图/附件的上传与最终排序交给这个队列在后台跑，界面只显示进度；
 * 产品图在联网上传前先在手机端压到长边 2048（见 upload-image-compress），上传体积约降 80%。
 *
 * 三条硬约束：
 *  1. 图片最终顺序只在"该产品的文件全部传完"后用一次重排统一确定，与上传先后无关，
 *     所以同一产品的文件也可以并发上传（全局同时最多 MAX_PARALLEL_FILES 个）；
 *  2. 任务要落盘（IndexedDB，localStorage 放不下几 MB 的原图），刷新或关掉浏览器后
 *     下次打开可以继续，否则"没传完"的图会静默丢失；
 *  3. 失败重试两次仍不成功就记下来，绝不静默吞掉 —— 产品已经存了、图少了，必须让人看到。
 *
 * 产品图库要为每张图单独画进度条，所以队列按文件粒度暴露状态（files）、图片本地预览
 * （previewUrl）和上传成功后的真实图片 id（uploadedId）：传完的图靠 uploadedId 与产品
 * 记录对齐，界面据此把占位换成正式图片。
 */

/** 单个待上传文件的任务元数据（与字节分开存：字节在 IndexedDB 的同一个库里）。 */
export interface UploadTaskMeta {
  id: string;
  productId: string;
  productLabel: string;
  kind: 'image' | 'packaging-image' | 'attachment' | 'video';
  category: string;
  note: string;
  packagingId?: string;
  fileName: string;
}

/** 一次产品保存产生的后台上传批次。 */
export interface UploadBatch {
  productId: string;
  productLabel: string;
  /**
   * 图片最终顺序。既有图片用 imageId，本次新上传的用 taskId 占位，
   * 上传完成后按这张表映射成真实 id 再调用排序接口。
   */
  imageOrder: Array<{ imageId: number } | { taskId: string }>;
  files: Array<{ meta: UploadTaskMeta; file: File }>;
}

export interface UploadFailure {
  id: string;
  productId: string;
  productLabel: string;
  fileName: string;
  message: string;
}

export type UploadFileStatus = 'queued' | 'uploading' | 'done' | 'failed';

/** 单个文件的实时状态（产品图库据此画逐张进度）。 */
export interface UploadFileSnapshot {
  id: string;
  productId: string;
  productLabel: string;
  kind: UploadTaskMeta['kind'];
  fileName: string;
  category: string;
  note: string;
  status: UploadFileStatus;
  /** 0-100；undefined = 总大小未知，界面画流动动画。 */
  progress?: number;
  /** 最终失败的原因（status='failed' 时）。 */
  message?: string;
  /** 图片的本地预览（object URL），上传完成前图库里先看它。 */
  previewUrl?: string;
  /** 上传成功后的真实图片 id（kind='image'）。 */
  uploadedId?: number;
}

export interface UploadQueueSnapshot {
  /** 本次运行要处理的文件总数（含续传的）。 */
  total: number;
  /** 已成功上传的数量。 */
  done: number;
  /** 是否还有排队或上传中的文件；只剩失败项时为 false。 */
  active: boolean;
  /** 正在上传的产品 id，产品库据此打「上传中」标记。 */
  uploadingProductIds: string[];
  failures: UploadFailure[];
  /** 上次没传完、等待用户确认是否继续的文件数（0 = 没有待续传）。 */
  resumableCount: number;
  /** 队列里每个文件的实时状态，按入队顺序。 */
  files: UploadFileSnapshot[];
}

const DB_NAME = 'workbench-product-upload';
const DB_VERSION = 1;
const BATCH_STORE = 'batches';
const FILE_STORE = 'files';
/** 全局同时上传的文件数上限（跨产品合计）。手机上 3 个是速度与稳定性的平衡点。 */
export const MAX_PARALLEL_FILES = 3;
/** 单张失败后的自动重试间隔（毫秒），共两次。 */
export const RETRY_DELAYS_MS = [1_000, 3_000];

interface StoredBatch {
  productId: string;
  productLabel: string;
  imageOrder: UploadBatch['imageOrder'];
  createdAt: string;
}

interface StoredFile {
  meta: UploadTaskMeta;
  blob: Blob;
}

interface QueueItem {
  meta: UploadTaskMeta;
  file: File;
  status: UploadFileStatus;
  progress?: number;
  message?: string;
  previewUrl?: string;
  uploadedId?: number;
}

interface InternalBatch {
  productId: string;
  productLabel: string;
  imageOrder: UploadBatch['imageOrder'];
  items: QueueItem[];
  /** 正在做收尾（重排 + 清理），防止并发完成时重复执行。 */
  settling?: boolean;
}

/** 把上传成功的 taskId 映射回真实图片 id，得到最终顺序；失败的图跳过但保持相对顺序。 */
export function resolveImageOrder(
  order: UploadBatch['imageOrder'],
  uploadedByTaskId: Map<string, number>,
): number[] {
  const ids: number[] = [];
  for (const entry of order) {
    if ('imageId' in entry) {
      ids.push(entry.imageId);
      continue;
    }
    const uploaded = uploadedByTaskId.get(entry.taskId);
    if (uploaded !== undefined) ids.push(uploaded);
  }
  return ids;
}

/** 释放缩略图的 Object URL；环境不支持时忽略。 */
function revokePreviewUrl(item: QueueItem): void {
  if (!item.previewUrl) return;
  try { URL.revokeObjectURL(item.previewUrl); } catch { /* 关页瞬间可能失败，忽略 */ }
  item.previewUrl = undefined;
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let settled = false;
    // 浏览器/WebView 里 indexedDB.open 可能被另一个连接阻塞且永远不回调；
    // 续传只是附属能力，最多等 1.5 秒就退化为仅内存，绝不能让保存按钮一直转圈。
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(null); }
    }, 1500);
    const finish = (value: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BATCH_STORE)) db.createObjectStore(BATCH_STORE, { keyPath: 'productId' });
        if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: 'meta.id' });
      };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        finish(request.result);
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

/** 事务收尾也设上限：持久化失败只丢续传能力，不能让后台队列永远挂住。 */
function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 2000);
    transaction.oncomplete = finish;
    transaction.onerror = finish;
    transaction.onabort = finish;
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

/**
 * 上传队列。做成模块级单例（`productUploadQueue`），因为进度条、产品图库占位、
 * 列表标记分处不同组件，需要同一份状态；组件通过 subscribe/getSnapshot 订阅。
 */
export class ProductUploadQueue {
  private readonly listeners = new Set<() => void>();
  private snapshot: UploadQueueSnapshot = {
    total: 0,
    done: 0,
    active: false,
    uploadingProductIds: [],
    failures: [],
    resumableCount: 0,
    files: [],
  };
  /** 待处理任务：产品 id → 批次。落盘与内存各一份，落盘失败时退化为仅内存。 */
  private readonly batches = new Map<string, InternalBatch>();
  /** 全局在传的文件数（跨产品合计），上限 MAX_PARALLEL_FILES。 */
  private activeUploads = 0;
  /** 每张图最终上传用的文件（手机端压过一次就缓存复用，重试不重复压）。 */
  private readonly uploadFiles = new WeakMap<QueueItem, Promise<File>>();
  private initialized = false;
  /** 完成一个产品的这一轮后通知外部刷新产品库。 */
  private onBatchSettled: (() => void) | undefined;
  /** 单个文件上传成功：界面据此把该产品立刻刷一遍，让正式图片尽早顶掉占位。 */
  private onFileUploaded: ((productId: string) => void) | undefined;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): UploadQueueSnapshot => this.snapshot;

  setBatchSettledHandler(handler: () => void): void {
    this.onBatchSettled = handler;
  }

  setFileUploadedHandler(handler: (productId: string) => void): void {
    this.onFileUploaded = handler;
  }

  /** 应用启动时调用：把上次没传完的任务读回来，等用户确认后再续传。 */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const db = await openDatabase();
    if (!db) return;
    try {
      const [batches, files] = await Promise.all([
        promisifyRequest(db.transaction(BATCH_STORE).objectStore(BATCH_STORE).getAll() as IDBRequest<StoredBatch[]>),
        promisifyRequest(db.transaction(FILE_STORE).objectStore(FILE_STORE).getAll() as IDBRequest<StoredFile[]>),
      ]);
      const byProduct = new Map<string, InternalBatch>();
      for (const stored of batches ?? []) {
        byProduct.set(stored.productId, { productId: stored.productId, productLabel: stored.productLabel, imageOrder: stored.imageOrder ?? [], items: [] });
      }
      for (const stored of files ?? []) {
        const batch = byProduct.get(stored.meta.productId);
        if (!batch) continue;
        const file = new File([stored.blob], stored.meta.fileName);
        batch.items.push({ meta: stored.meta, file, status: 'queued' });
      }
      for (const [productId, batch] of byProduct) if (batch.items.length) this.batches.set(productId, batch);
      for (const batch of this.batches.values()) for (const item of batch.items) this.attachThumb(item);
      this.publish({ resumableCount: this.pendingFileCount() });
    } finally {
      db.close();
    }
  }

  /** 用户确认续传：把上次剩下的任务接着传。 */
  resume(): void {
    if (!this.batches.size) return;
    this.publish({ resumableCount: 0, active: true, total: this.pendingFileCount(), done: 0 });
    this.pump();
  }

  /** 用户选择丢弃上次没传完的任务。 */
  async discardPending(): Promise<void> {
    for (const batch of this.batches.values()) for (const item of batch.items) revokePreviewUrl(item);
    this.batches.clear();
    this.publish({ resumableCount: 0 });
    await this.clearStorage();
  }

  /** 入队一个批次并立刻开始在后台跑。 */
  async enqueue(batch: UploadBatch): Promise<void> {
    if (!batch.files.length) {
      // 排序只是收尾动作，不能让它（网络慢/失败）把「保存」按钮卡在保存中。
      void this.reorderIfNeeded(batch, new Map());
      return;
    }
    const items: QueueItem[] = batch.files.map((entry) => ({
      meta: entry.meta,
      file: entry.file,
      status: 'queued',
    }));
    const existing = this.batches.get(batch.productId);
    if (existing) for (const item of existing.items) revokePreviewUrl(item);
    const internal: InternalBatch = { productId: batch.productId, productLabel: batch.productLabel, imageOrder: batch.imageOrder, items };
    this.batches.set(batch.productId, internal);
    // 续传落盘只影响崩溃后能否接着传，不能阻塞保存结果；失败时退化为仅内存。
    void this.persistBatch(internal).catch(() => undefined);
    const wasActive = this.snapshot.active;
    this.publish({
      active: true,
      total: wasActive ? this.snapshot.total + batch.files.length : this.pendingFileCount(),
      done: wasActive ? this.snapshot.done : 0,
    });
    for (const item of items) this.attachThumb(item);
    this.pump();
  }

  /** 重试所有失败项。失败的文件仍留在各自的批次里，直接重新跑一遍即可。 */
  retryFailures(): void {
    if (!this.snapshot.failures.length) return;
    for (const batch of this.batches.values()) {
      for (const item of batch.items) {
        if (item.status !== 'failed') continue;
        item.status = 'queued';
        item.message = undefined;
        item.progress = undefined;
      }
    }
    this.publish({ active: true, total: this.pendingFileCount(), done: 0 });
    this.pump();
  }

  /** 单项重试：只有这一张重跑，同一产品里其它失败项保持原样。 */
  retryFailure(taskId: string): void {
    for (const batch of this.batches.values()) {
      const item = batch.items.find((entry) => entry.meta.id === taskId && entry.status === 'failed');
      if (!item) continue;
      item.status = 'queued';
      item.message = undefined;
      item.progress = undefined;
      this.publish({ active: true, total: this.pendingFileCount(), done: 0 });
      this.pump();
      return;
    }
  }

  /** 该产品是否还有文件在处理（排队、上传中或等待重试）；批次还在就为 true。 */
  hasPending(productId: string): boolean {
    return this.batches.has(productId);
  }

  private pendingFileCount(): number {
    let count = 0;
    for (const batch of this.batches.values()) for (const item of batch.items) if (item.status !== 'done') count += 1;
    return count;
  }

  /** 图片的本地预览统一用小图（最长边约 480px），生成好再挂上；期间界面显示占位图标。 */
  private attachThumb(item: QueueItem): void {
    if (item.meta.kind !== 'image' || item.previewUrl) return;
    void createImageThumbUrl(item.file).then((url) => {
      if (!url) return;
      if (this.isTracked(item)) {
        item.previewUrl = url;
        this.publish();
      } else {
        // 批次已经结束或被丢弃：生成结果没人用，直接回收。
        try { URL.revokeObjectURL(url); } catch { /* 页面收尾中 */ }
      }
    });
  }

  private isTracked(item: QueueItem): boolean {
    for (const batch of this.batches.values()) if (batch.items.includes(item)) return true;
    return false;
  }

  private publish(patch: Partial<UploadQueueSnapshot> = {}): void {
    const files: UploadFileSnapshot[] = [];
    for (const batch of this.batches.values()) {
      for (const item of batch.items) {
        files.push({
          id: item.meta.id,
          productId: item.meta.productId,
          productLabel: item.meta.productLabel || batch.productLabel,
          kind: item.meta.kind,
          fileName: item.meta.fileName,
          category: item.meta.category,
          note: item.meta.note,
          status: item.status,
          progress: item.progress,
          message: item.message,
          previewUrl: item.previewUrl,
          uploadedId: item.uploadedId,
        });
      }
    }
    const next: UploadQueueSnapshot = {
      ...this.snapshot,
      ...patch,
      uploadingProductIds: [...new Set(files.filter((item) => item.status === 'queued' || item.status === 'uploading').map((item) => item.productId))],
      files,
      failures: files
        .filter((item) => item.status === 'failed')
        .map((item) => ({
          id: item.id,
          productId: item.productId,
          productLabel: item.productLabel,
          fileName: item.fileName,
          message: item.message ?? '上传失败',
        })),
    };
    const unchanged = JSON.stringify(next) === JSON.stringify(this.snapshot);
    this.snapshot = next;
    if (!unchanged) for (const listener of this.listeners) listener();
  }

  private pump(): void {
    while (this.activeUploads < MAX_PARALLEL_FILES) {
      const next = this.nextQueuedItem();
      if (!next) break;
      const { batch, item } = next;
      this.activeUploads += 1;
      item.status = 'uploading';
      item.message = undefined;
      item.progress = 0;
      this.publish();
      void this.runItem(batch, item)
        .catch(() => undefined)
        .then(() => {
          this.activeUploads -= 1;
          this.publish();
          this.pump();
        });
    }
    // 只剩失败项在等用户处理时不算"正在上传"：顶部进度条要收掉，失败提示才接管画面。
    const hasQueued = [...this.batches.values()].some((batch) => batch.items.some((item) => item.status === 'queued'));
    if (!this.activeUploads && !hasQueued) this.publish({ active: false });
  }

  /** 下一个待传文件：按批次、再按批内顺序取第一个排队的；同一产品的图可以并发上传。 */
  private nextQueuedItem(): { batch: InternalBatch; item: QueueItem } | undefined {
    for (const batch of this.batches.values()) {
      const item = batch.items.find((entry) => entry.status === 'queued');
      if (item) return { batch, item };
    }
    return undefined;
  }

  private async runItem(batch: InternalBatch, item: QueueItem): Promise<void> {
    const uploaded = await this.uploadWithRetry(item);
    if (uploaded !== undefined) {
      item.status = 'done';
      item.progress = 100;
      if (uploaded !== null) item.uploadedId = uploaded;
      // 已传完的从续传存储里去掉：万一中途崩溃，重开也不会重复上传这一张。
      await this.removeItemFromStorage(item.meta.id);
      this.publish({ done: this.snapshot.done + 1 });
      this.onFileUploaded?.(batch.productId);
    }
    await this.settleBatchIfDone(batch);
    this.publish();
  }

  /** 该产品的文件全部传完（成功）才重排一次并收尾；还有失败的保持原样等重试。 */
  private async settleBatchIfDone(batch: InternalBatch): Promise<void> {
    if (batch.settling || !batch.items.every((item) => item.status === 'done')) return;
    batch.settling = true;
    const uploadedByTaskId = new Map<string, number>();
    for (const item of batch.items) {
      if (item.uploadedId !== undefined) uploadedByTaskId.set(item.meta.id, item.uploadedId);
    }
    await this.reorderIfNeeded(batch, uploadedByTaskId);
    this.batches.delete(batch.productId);
    for (const item of batch.items) revokePreviewUrl(item);
    await this.removeBatchFromStorage(batch.productId);
    this.onBatchSettled?.();
  }

  /** 上传用的文件：产品图（含包装图）先在手机端压到长边 2048（每张只压一次，重试/续传复用同一份）。 */
  private resolveUploadFile(item: QueueItem): Promise<File> {
    let pending = this.uploadFiles.get(item);
    if (!pending) {
      if (item.meta.kind === 'image' || item.meta.kind === 'packaging-image') {
        item.progress = undefined; // 压缩阶段进度未知，界面画流动条
        this.publish();
        pending = compressImageForUpload(item.file);
      } else {
        pending = Promise.resolve(item.file);
      }
      this.uploadFiles.set(item, pending);
    }
    return pending;
  }

  /** 返回：图片 id（成功）/ null（非图片，成功）/ undefined（最终失败）。 */
  private async uploadWithRetry(item: QueueItem): Promise<number | null | undefined> {
    const { meta } = item;
    const file = await this.resolveUploadFile(item);
    const reportProgress = (percent: number | undefined) => {
      item.progress = percent;
      this.publish();
    };
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        if (meta.kind === 'image') {
          const uploaded = await uploadProductImage(meta.productId, file, meta.category, meta.note, reportProgress);
          return Number(uploaded.id);
        }
        if (meta.kind === 'packaging-image') {
          if (meta.packagingId) await uploadProductPackagingImage(meta.productId, meta.packagingId, file, reportProgress);
          return null;
        }
        if (meta.kind === 'video') {
          await uploadProductVideo(meta.productId, file, reportProgress);
          return null;
        }
        await uploadProductAttachment(meta.productId, file, meta.category, reportProgress);
        return null;
      } catch (error) {
        if (attempt >= RETRY_DELAYS_MS.length) {
          item.status = 'failed';
          item.progress = undefined;
          item.message = (error as { message?: string }).message ?? '上传失败';
          this.publish();
          return undefined;
        }
        // 重试要重发整张，进度从头计。
        item.progress = 0;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
    return undefined;
  }

  private async reorderIfNeeded(
    batch: Pick<InternalBatch, 'productId' | 'imageOrder'>,
    uploadedByTaskId: Map<string, number>,
  ): Promise<void> {
    const orderedIds = resolveImageOrder(batch.imageOrder, uploadedByTaskId);
    if (!orderedIds.length) return;
    try {
      await reorderProductImages(batch.productId, orderedIds);
    } catch {
      // 排序失败不影响图片本身，下次编辑保存时会按草稿顺序重新排。
    }
  }

  // ===== IndexedDB 持久化（失败时静默退化为仅内存：宁可丢续传能力，也不能让保存报错）=====

  private async persistBatch(batch: InternalBatch): Promise<void> {
    const db = await openDatabase();
    if (!db) return;
    try {
      // 不阻塞保存后，上传可能先完成并清掉批次；此时不要再把旧记录写回续传库。
      if (!this.batches.has(batch.productId)) return;
      const stored: StoredBatch = {
        productId: batch.productId,
        productLabel: batch.productLabel,
        imageOrder: batch.imageOrder,
        createdAt: new Date().toISOString(),
      };
      const transaction = db.transaction([BATCH_STORE, FILE_STORE], 'readwrite');
      transaction.objectStore(BATCH_STORE).put(stored);
      const fileStore = transaction.objectStore(FILE_STORE);
      // 已传完的不再落盘：续传只需要没传完的部分。
      for (const item of batch.items) {
        if (item.status === 'done') continue;
        fileStore.put({ meta: item.meta, blob: item.file } satisfies StoredFile);
      }
      await waitForTransaction(transaction);
      // 写盘期间批次已经传完/被丢弃：补一次清理，避免下次启动把已完成的图当成续传项。
      if (!this.batches.has(batch.productId)) await this.removeBatchFromStorage(batch.productId);
    } finally {
      db.close();
    }
  }

  /** 单张传完就把它从续传存储里删掉（批次记录保留），避免中途崩溃后重复上传。 */
  private async removeItemFromStorage(taskId: string): Promise<void> {
    const db = await openDatabase();
    if (!db) return;
    try {
      const transaction = db.transaction(FILE_STORE, 'readwrite');
      transaction.objectStore(FILE_STORE).delete(taskId);
      await waitForTransaction(transaction);
    } finally {
      db.close();
    }
  }

  private async removeBatchFromStorage(productId: string): Promise<void> {
    const db = await openDatabase();
    if (!db) return;
    try {
      const transaction = db.transaction([BATCH_STORE, FILE_STORE], 'readwrite');
      transaction.objectStore(BATCH_STORE).delete(productId);
      const files = await promisifyRequest(transaction.objectStore(FILE_STORE).getAll() as IDBRequest<StoredFile[]>);
      for (const stored of files ?? []) {
        if (stored.meta.productId === productId) transaction.objectStore(FILE_STORE).delete(stored.meta.id);
      }
      await waitForTransaction(transaction);
    } finally {
      db.close();
    }
  }

  private async clearStorage(): Promise<void> {
    const db = await openDatabase();
    if (!db) return;
    try {
      const transaction = db.transaction([BATCH_STORE, FILE_STORE], 'readwrite');
      transaction.objectStore(BATCH_STORE).clear();
      transaction.objectStore(FILE_STORE).clear();
      await waitForTransaction(transaction);
    } finally {
      db.close();
    }
  }
}

export const productUploadQueue = new ProductUploadQueue();
