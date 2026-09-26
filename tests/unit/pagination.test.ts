import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  clampPage,
  pageWindow,
  readStoredPageSize,
  rememberPageSize,
  slicePage,
  totalPages,
} from '../../src/client/pagination';

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    },
  });
  return store;
}

const KEY = 'workbench:products-page-size';

describe('产品库分页参数', () => {
  it('默认每页 20 条，可选 20 / 50 / 100', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    expect([...PAGE_SIZES]).toEqual([20, 50, 100]);
  });

  it('页数为结果数除以每页条数，空结果也算一页', () => {
    expect(totalPages(0, 20)).toBe(1);
    expect(totalPages(20, 20)).toBe(1);
    expect(totalPages(21, 20)).toBe(2);
    expect(totalPages(63, 20)).toBe(4);
  });

  it('切片只取当前页，越界页返回空而不是报错', () => {
    const items = Array.from({ length: 25 }, (_, index) => index + 1);
    expect(slicePage(items, 1, 20).length).toBe(20);
    expect(slicePage(items, 2, 20)).toEqual([21, 22, 23, 24, 25]);
    expect(slicePage(items, 3, 20)).toEqual([]);
  });

  it('删除或换每页条数后页码被夹回有效范围', () => {
    expect(clampPage(5, 25, 20)).toBe(2);
    expect(clampPage(0, 25, 20)).toBe(1);
    expect(clampPage(2, 0, 20)).toBe(1);
    expect(clampPage(3, 60, 50)).toBe(2);
  });

  it('页码少时全部列出，多时收成首页/当前页附近/末页并补省略位', () => {
    expect(pageWindow(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageWindow(6, 12)).toEqual([1, 'gap', 4, 5, 6, 7, 8, 'gap', 12]);
    expect(pageWindow(1, 12)).toEqual([1, 2, 3, 'gap', 12]);
    expect(pageWindow(12, 12)).toEqual([1, 'gap', 10, 11, 12]);
  });
});

describe('每页条数记住上次选择', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('本地存过就沿用', () => {
    stubStorage({ [KEY]: '50' });
    expect(readStoredPageSize()).toBe(50);
  });

  it('没存过或存了不可用的值回到 20', () => {
    stubStorage();
    expect(readStoredPageSize()).toBe(20);
    stubStorage({ [KEY]: '37' });
    expect(readStoredPageSize()).toBe(20);
  });

  it('切换后写回本地，供下次进入使用', () => {
    const store = stubStorage();
    rememberPageSize(100);
    expect(store.get(KEY)).toBe('100');
    expect(readStoredPageSize()).toBe(100);
  });

  it('localStorage 不可用时静默回落到默认值', () => {
    vi.stubGlobal('window', undefined);
    expect(readStoredPageSize()).toBe(DEFAULT_PAGE_SIZE);
    expect(() => rememberPageSize(50)).not.toThrow();
  });
});
