import {
  deleteProductImage,
  reorderProductImages,
  uploadProductAttachment,
  uploadProductImage,
  uploadProductPackagingImage,
} from './api';

/**
 * 产品文件后台上传队列。
 *
 * 背景：原先「保存产品」是一条串行长链，新图逐张上传且必须等完，10 张手机原图要等几十秒。
 * 现在产品记录、删除差异、分类回写这些"快且必须与本次保存意图一致"的部分留在前台，
 * 新图/包装图/附件的上传与最终排序交给这个队列在后台跑，界面只显示进度。
 *
 * 三条硬约束：
 *  1. 同一个产品的文件必须按顺序上传，传完才能重排 —— 否则排序会和上传打架；
 *  2. 任务要落盘（IndexedDB，localStorage 放不下几 MB 的原图），刷新或关掉浏览器后
 *     下次打开可以继续，否则"没传完"的图会静默丢失；
 *  3. 失败重试两次仍不成功就记下来，绝不静默吞掉 —— 产品已经存了、图少了，必须让人看到。
 */

/** 单个待上传文件的任务元数据（与字节分开存：字节在 IndexedDB 的同一个库里）。 */
export interface UploadTaskMeta {
  id: string;
  productId: string;
  productLabel: string;
  kind: 'image' | 'packaging-image' | 'attachment';
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

export interface UploadQueueSnapshot {
  /** 本次运行要处理的文件总数（含续传的）。 */
  total: number;
  /** 已成功上传的数量。 */
  done: number;
  active: boolean;
  /** 正在上传的产品 id，产品库据此打「上传中」标记。 */
  uploadingProductIds: string[];
  failures: UploadFailure[];
  /** 上次没传完、等待用户确认是否继续的文件数（0 = 没有待续传）。 */
  resumableCount: number;
}

const DB_NAME = 'workbench-product-upload';
const DB_VERSION = 1;
const BATCH_STORE = 'batches';
const FILE_STORE = 'files';
const MAX_PARALLEL_PRODUCTS = 2;
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

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BATCH_STORE)) db.createObjectStore(BATCH_STORE, { keyPath: 'productId' });
        if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: 'meta.id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

/**
 * 上传队列。做成模块级单例（`productUploadQueue`），因为进度条、产品库标记、
 * 列表轮询分处不同组件，需要同一份状态；组件通过 subscribe/getSnapshot 订阅。
 */
class ProductUploadQueue {
  private readonly listeners = new Set<() => void>();
  private snapshot: UploadQueueSnapshot = {
    total: 0,
    done: 0,
    active: false,
    uploadingProductIds: [],
    failures: [],
    resumableCount: 0,
  };
  /** 待处理任务：产品 id → 批次。落盘与内存各一份，落盘失败时退化为仅内存。 */
  private readonly batches = new Map<string, UploadBatch>();
  private readonly runningProducts = new Set<string>();
  private activeWorkers = 0;
  private initialized = false;
  /** 完成或失败一个产品后通知外部刷新产品库。 */
  private onBatchSettled: (() => void) | undefined;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): UploadQueueSnapshot => this.snapshot;

  setBatchSettledHandler(handler: () => void): void {
    this.onBatchSettled = handler;
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
      const byProduct = new Map<string, UploadBatch>();
      for (const stored of batches ?? []) {
        byProduct.set(stored.productId, { productId: stored.productId, productLabel: stored.productLabel, imageOrder: stored.imageOrder ?? [], files: [] });
      }
      for (const stored of files ?? []) {
        const batch = byProduct.get(stored.meta.productId);
        if (!batch) continue;
        batch.files.push({ meta: stored.meta, file: new File([stored.blob], stored.meta.fileName) });
      }
      for (const [productId, batch] of byProduct) if (batch.files.length) this.batches.set(productId, batch);
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
    this.batches.clear();
    this.publish({ resumableCount: 0 });
    await this.clearStorage();
  }

  /** 入队一个批次并立刻开始在后台跑。 */
  async enqueue(batch: UploadBatch): Promise<void> {
    if (!batch.files.length) {
      await this.reorderIfNeeded(batch, new Map());
      return;
    }
    this.batches.set(batch.productId, batch);
    await this.persistBatch(batch);
    const wasActive = this.snapshot.active;
    this.publish({
      active: true,
      total: wasActive ? this.snapshot.total + batch.files.length : this.pendingFileCount(),
      done: wasActive ? this.snapshot.done : 0,
    });
    this.pump();
  }

  /** 重试所有失败项。失败的文件仍留在各自的批次里，直接重新跑一遍即可。 */
  retryFailures(): void {
    if (!this.snapshot.failures.length) return;
    this.publish({ failures: [], active: true, total: this.pendingFileCount(), done: 0 });
    this.pump();
  }

  /** 该产品是否还有文件在处理（排队或上传中）。 */
  hasPending(productId: string): boolean {
    return this.batches.has(productId) || this.runningProducts.has(productId);
  }

  private pendingFileCount(): number {
    let count = 0;
    for (const batch of this.batches.values()) count += batch.files.length;
    return count;
  }

  private publish(patch: Partial<UploadQueueSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    next.uploadingProductIds = [...this.runningProducts];
    const unchanged = JSON.stringify({ ...next }) === JSON.stringify(this.snapshot);
    this.snapshot = next;
    if (!unchanged) for (const listener of this.listeners) listener();
  }

  private pump(): void {
    while (this.activeWorkers < MAX_PARALLEL_PRODUCTS) {
      const next = [...this.batches.values()].find((batch) => !this.runningProducts.has(batch.productId));
      if (!next) break;
      this.activeWorkers += 1;
      this.runningProducts.add(next.productId);
      this.publish({});
      void this.runBatch(next)
        .catch(() => undefined)
        .then(() => {
          this.activeWorkers -= 1;
          this.runningProducts.delete(next.productId);
          this.publish({});
          this.pump();
        });
    }
    if (!this.activeWorkers && !this.batches.size) this.publish({ active: false });
  }

  private async runBatch(batch: UploadBatch): Promise<void> {
    const uploadedByTaskId = new Map<string, number>();
    const remaining: UploadBatch['files'] = [];
    const failed: UploadFailure[] = [];

    for (const item of batch.files) {
      const uploaded = await this.uploadWithRetry(item, batch, failed);
      if (uploaded === undefined) remaining.push(item);
      else {
        if (uploaded !== null) uploadedByTaskId.set(item.meta.id, uploaded);
        this.publish({ done: this.snapshot.done + 1 });
      }
    }

    // 该产品的待传文件都处理完了（成功或最终失败）就重排一次，让已成功的图立刻按草稿顺序排好；
    // 还有失败的等重试成功后再排。
    if (remaining.length === 0) {
      await this.reorderIfNeeded(batch, uploadedByTaskId);
      this.batches.delete(batch.productId);
      await this.removeBatchFromStorage(batch.productId);
    } else {
      batch.files = remaining;
      await this.persistBatch(batch);
    }
    if (failed.length) this.publish({ failures: [...this.snapshot.failures, ...failed] });
    this.onBatchSettled?.();
  }

  /** 返回：图片 id（成功）/ null（非图片，成功）/ undefined（最终失败）。 */
  private async uploadWithRetry(
    item: { meta: UploadTaskMeta; file: File },
    batch: UploadBatch,
    failed: UploadFailure[],
  ): Promise<number | null | undefined> {
    const { meta, file } = item;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        if (meta.kind === 'image') {
          const uploaded = await uploadProductImage(meta.productId, file, meta.category, meta.note);
          return Number(uploaded.id);
        }
        if (meta.kind === 'packaging-image') {
          if (meta.packagingId) await uploadProductPackagingImage(meta.productId, meta.packagingId, file);
          return null;
        }
        await uploadProductAttachment(meta.productId, file, meta.category);
        return null;
      } catch (error) {
        if (attempt >= RETRY_DELAYS_MS.length) {
          failed.push({
            id: meta.id,
            productId: meta.productId,
            productLabel: batch.productLabel,
            fileName: meta.fileName,
            message: (error as { message?: string }).message ?? '上传失败',
          });
          return undefined;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
    return undefined;
  }

  private async reorderIfNeeded(batch: UploadBatch, uploadedByTaskId: Map<string, number>): Promise<void> {
    const orderedIds = resolveImageOrder(batch.imageOrder, uploadedByTaskId);
    if (!orderedIds.length) return;
    try {
      await reorderProductImages(batch.productId, orderedIds);
    } catch {
      // 排序失败不影响图片本身，下次编辑保存时会按草稿顺序重新排。
    }
  }

  // ===== IndexedDB 持久化（失败时静默退化为仅内存：宁可丢续传能力，也不能让保存报错）=====

  private async persistBatch(batch: UploadBatch): Promise<void> {
    const db = await openDatabase();
    if (!db) return;
    try {
      const stored: StoredBatch = {
        productId: batch.productId,
        productLabel: batch.productLabel,
        imageOrder: batch.imageOrder,
        createdAt: new Date().toISOString(),
      };
      const transaction = db.transaction([BATCH_STORE, FILE_STORE], 'readwrite');
      transaction.objectStore(BATCH_STORE).put(stored);
      const fileStore = transaction.objectStore(FILE_STORE);
      for (const item of batch.files) fileStore.put({ meta: item.meta, blob: item.file } satisfies StoredFile);
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
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
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
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
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
      });
    } finally {
      db.close();
    }
  }
}

export const productUploadQueue = new ProductUploadQueue();
