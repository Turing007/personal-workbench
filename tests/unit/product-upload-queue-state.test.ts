import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/client/api', () => ({
  reorderProductImages: vi.fn(async () => undefined),
  uploadProductAttachment: vi.fn(async () => ({})),
  uploadProductImage: vi.fn(),
  uploadProductPackagingImage: vi.fn(async () => undefined),
}));

import { reorderProductImages, uploadProductImage } from '../../src/client/api';
import { MAX_PARALLEL_FILES, ProductUploadQueue, type UploadBatch } from '../../src/client/product-upload-queue';

const mockUploadImage = vi.mocked(uploadProductImage);
const mockReorder = vi.mocked(reorderProductImages);

function makeBatch(productId: string, names: string[]): UploadBatch {
  return {
    productId,
    productLabel: `产品${productId}`,
    imageOrder: names.map((_, index) => ({ taskId: `t-${productId}-${index}` })),
    files: names.map((name, index) => ({
      meta: { id: `t-${productId}-${index}`, productId, productLabel: `产品${productId}`, kind: 'image' as const, category: '', note: '', fileName: name },
      file: new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' }),
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('后台上传队列：逐张状态', () => {
  it('传出每张的实时状态与进度，传完自动重排并清空', async () => {
    const queue = new ProductUploadQueue();
    const first = deferred<{ id: number }>();
    const second = deferred<{ id: number }>();
    mockUploadImage.mockImplementationOnce(() => first.promise as never).mockImplementationOnce(() => second.promise as never);
    let settled = 0;
    queue.setBatchSettledHandler(() => { settled += 1; });

    await queue.enqueue(makeBatch('7', ['a.jpg', 'b.jpg']));
    await flush();

    // 并发上传：同一产品的两张图同时开传。
    let files = queue.getSnapshot().files;
    expect(files.map((item) => item.status)).toEqual(['uploading', 'uploading']);

    // XHR 进度回调写进快照，界面据此画条。
    const reportProgress = mockUploadImage.mock.calls[0][4] as (percent?: number) => void;
    reportProgress(45);
    expect(queue.getSnapshot().files[0].progress).toBe(45);

    first.resolve({ id: 101 });
    await flush();
    files = queue.getSnapshot().files;
    expect(files[0]).toMatchObject({ status: 'done', uploadedId: 101, progress: 100 });
    expect(files[1].status).toBe('uploading');

    second.resolve({ id: 102 });
    await flush();
    // 全部传完：批次清空、按草稿顺序重排、通知外部刷新。
    expect(queue.getSnapshot().files).toEqual([]);
    expect(queue.getSnapshot().failures).toEqual([]);
    expect(queue.getSnapshot().active).toBe(false);
    expect(mockReorder).toHaveBeenCalledWith('7', [101, 102]);
    expect(settled).toBeGreaterThan(0);
  });

  it('失败标红并记下原因；单项重试只重跑点中的那一张', async () => {
    vi.useFakeTimers();
    const queue = new ProductUploadQueue();
    mockUploadImage.mockRejectedValue(new Error('网络超时：请求没有回音，请检查手机网络后重试'));

    await queue.enqueue(makeBatch('9', ['x.jpg', 'y.jpg']));
    await vi.advanceTimersByTimeAsync(20_000);

    let snapshot = queue.getSnapshot();
    expect(snapshot.files.map((item) => item.status)).toEqual(['failed', 'failed']);
    expect(snapshot.files[0].message).toContain('网络超时');
    expect(snapshot.failures).toHaveLength(2);
    expect(snapshot.active).toBe(false);
    // 每张自动重试两次（共三次调用），失败后不再自己重跑。
    expect(mockUploadImage).toHaveBeenCalledTimes(6);

    mockUploadImage.mockReset();
    mockUploadImage.mockResolvedValue({ id: 55 } as never);
    queue.retryFailure('t-9-0');
    await vi.advanceTimersByTimeAsync(10);

    snapshot = queue.getSnapshot();
    expect(mockUploadImage).toHaveBeenCalledTimes(1);
    expect(snapshot.files.find((item) => item.id === 't-9-0')).toMatchObject({ status: 'done', uploadedId: 55 });
    expect(snapshot.files.find((item) => item.id === 't-9-1')?.status).toBe('failed');

    mockUploadImage.mockResolvedValue({ id: 66 } as never);
    queue.retryFailure('t-9-1');
    await vi.advanceTimersByTimeAsync(10);

    snapshot = queue.getSnapshot();
    expect(snapshot.files).toEqual([]);
    expect(mockReorder).toHaveBeenCalledWith('9', [55, 66]);
    // 重排包含两次重试各自的结果，中途成功的那张不会被漏掉。
    expect(queue.hasPending('9')).toBe(false);
  });

  it('全局同时最多传 3 张：一张传完立刻补位下一张', async () => {
    const queue = new ProductUploadQueue();
    const pending = Array.from({ length: 4 }, () => deferred<{ id: number }>());
    let callIndex = 0;
    mockUploadImage.mockImplementation(() => pending[Math.min(callIndex++, pending.length - 1)].promise as never);

    await queue.enqueue(makeBatch('7', ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']));
    await flush();

    expect(MAX_PARALLEL_FILES).toBe(3);
    expect(mockUploadImage).toHaveBeenCalledTimes(3);
    expect(queue.getSnapshot().files.filter((item) => item.status === 'uploading')).toHaveLength(3);
    expect(queue.getSnapshot().files.filter((item) => item.status === 'queued')).toHaveLength(1);

    // 第一张传完：第 4 张立刻补位，始终满载但不超过上限。
    pending[0].resolve({ id: 101 });
    await flush();
    expect(mockUploadImage).toHaveBeenCalledTimes(4);
    expect(queue.getSnapshot().files.filter((item) => item.status === 'uploading')).toHaveLength(3);

    pending[1].resolve({ id: 102 });
    await flush();
    pending[2].resolve({ id: 103 });
    await flush();
    pending[3].resolve({ id: 104 });
    await flush();

    // 全部传完：批次清空并按草稿顺序重排一次。
    expect(queue.getSnapshot().files).toEqual([]);
    expect(mockReorder).toHaveBeenCalledWith('7', [101, 102, 103, 104]);
  });
});
