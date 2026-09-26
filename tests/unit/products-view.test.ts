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

  it('默认视图按屏幕宽度定：手机端大图，桌面端列表', () => {
    stubStorage();
    expect(initialProductsView(true)).toBe('gallery');
    expect(initialProductsView(false)).toBe('list');
  });

  it('用户选过的视图优先于屏幕宽度', () => {
    stubStorage({ [KEY]: 'list' });
    expect(initialProductsView(true)).toBe('list');
  });

  it('localStorage 不可用时按宽度回落，不抛错', () => {
    vi.stubGlobal('window', undefined);
    expect(initialProductsView(true)).toBe('gallery');
    expect(() => saveProductsView('list')).not.toThrow();
  });
});
