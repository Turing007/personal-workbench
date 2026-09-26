import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialProductsView, loadProductsView, saveProductsView } from '../../src/client/products-view';

const KEY = 'workbench:products-view';

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

describe('产品库视图选择', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('没选过或存了不认识的值为 null', () => {
    stubStorage();
    expect(loadProductsView()).toBeNull();
    stubStorage({ [KEY]: 'grid' });
    expect(loadProductsView()).toBeNull();
  });

  it('选过就沿用，切换会写回本地', () => {
    const store = stubStorage();
    saveProductsView('gallery');
    expect(store.get(KEY)).toBe('gallery');
    expect(loadProductsView()).toBe('gallery');
  });

  it('默认进大图浏览', () => {
    stubStorage();
    expect(initialProductsView()).toBe('gallery');
  });

  it('用户选过的视图优先于默认值', () => {
    stubStorage({ [KEY]: 'list' });
    expect(initialProductsView()).toBe('list');
  });

  it('localStorage 不可用时回到默认大图，不抛错', () => {
    vi.stubGlobal('window', undefined);
    expect(initialProductsView()).toBe('gallery');
    expect(() => saveProductsView('list')).not.toThrow();
  });
});
