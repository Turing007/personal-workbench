import { describe, expect, it } from 'vitest';
import { resolveImageOrder } from '../../src/client/product-upload-queue';

// 后台上传完成后要按草稿顺序重排图片：新上传的图只有 taskId，得先映射成真实图片 id。
// 这段映射错了会直接把图片顺序打乱，所以单独测。
describe('后台上传：图片顺序还原', () => {
  it('把新上传的 taskId 映射成真实 id，并保持草稿顺序', () => {
    const order = [{ imageId: 7 }, { taskId: 'a' }, { imageId: 9 }, { taskId: 'b' }];
    const uploaded = new Map([['a', 100], ['b', 101]]);
    expect(resolveImageOrder(order, uploaded)).toEqual([7, 100, 9, 101]);
  });

  it('上传失败的图跳过，其余顺序不变', () => {
    const order = [{ taskId: 'a' }, { imageId: 7 }, { taskId: 'b' }];
    expect(resolveImageOrder(order, new Map([['b', 101]]))).toEqual([7, 101]);
  });

  it('只调整旧图顺序时原样返回', () => {
    const order = [{ imageId: 3 }, { imageId: 1 }, { imageId: 2 }];
    expect(resolveImageOrder(order, new Map())).toEqual([3, 1, 2]);
  });

  it('没有图片时返回空数组，调用方据此跳过重排请求', () => {
    expect(resolveImageOrder([], new Map())).toEqual([]);
  });
});
