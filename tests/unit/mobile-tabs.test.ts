import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigationItem, navigationItems, navigationKeys, type NavigationKey } from '../../src/client/navigation';
import {
  DEFAULT_MOBILE_TABS,
  MOBILE_TABS_STORAGE_KEY,
  MOBILE_TAB_LIMIT,
  isDefaultMobileTabs,
  loadMobileTabs,
  moveMobileTab,
  normalizeMobileTabs,
  saveMobileTabs,
  toggleMobileTab,
} from '../../src/client/mobile-tabs';

describe('navigation registry', () => {
  it('exposes a unique key and a non-empty short label for every module', () => {
    expect(new Set(navigationKeys).size).toBe(navigationKeys.length);
    for (const item of navigationItems) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.shortLabel.length).toBeGreaterThan(0);
      expect(navigationItem(item.key)).toBe(item);
    }
  });

  it('throws for an unknown key instead of rendering an empty tab', () => {
    expect(() => navigationItem('not-a-module' as NavigationKey)).toThrow(/未知导航模块/);
  });

  it('keeps the default tabs pointing at real modules', () => {
    for (const key of DEFAULT_MOBILE_TABS) expect(navigationKeys).toContain(key);
  });
});

describe('normalizeMobileTabs', () => {
  it('falls back to the default tabs for non-array input', () => {
    expect(normalizeMobileTabs(null)).toEqual(DEFAULT_MOBILE_TABS);
    expect(normalizeMobileTabs('orders')).toEqual(DEFAULT_MOBILE_TABS);
  });

  it('drops unknown keys, deduplicates and truncates to the limit', () => {
    expect(normalizeMobileTabs(['finance', 'finance', 'nope', 'orders', 'stock', 'shipping', 'products']))
      .toEqual(['finance', 'orders', 'stock', 'shipping']);
    expect(normalizeMobileTabs(['finance', 'finance', 'nope', 'orders', 'stock', 'shipping', 'products'])).toHaveLength(MOBILE_TAB_LIMIT);
  });

  it('falls back to the default when every entry is invalid', () => {
    expect(normalizeMobileTabs(['nope', 42])).toEqual(DEFAULT_MOBILE_TABS);
  });

  it('keeps a valid user selection untouched', () => {
    expect(normalizeMobileTabs(['products', 'stock'])).toEqual(['products', 'stock']);
  });
});

describe('moveMobileTab', () => {
  it('swaps neighbours and returns a new array', () => {
    const tabs: NavigationKey[] = ['orders', 'quotations', 'shipping', 'finance'];
    const moved = moveMobileTab(tabs, 'quotations', -1);
    expect(moved).toEqual(['quotations', 'orders', 'shipping', 'finance']);
    expect(moved).not.toBe(tabs);
  });

  it('ignores out-of-range moves', () => {
    const tabs: NavigationKey[] = ['orders', 'quotations'];
    expect(moveMobileTab(tabs, 'orders', -1)).toBe(tabs);
    expect(moveMobileTab(tabs, 'quotations', 1)).toBe(tabs);
    expect(moveMobileTab(tabs, 'shipping', 1)).toBe(tabs);
  });
});

describe('toggleMobileTab', () => {
  it('appends a new module at the end', () => {
    expect(toggleMobileTab(['orders'], 'finance')).toEqual(['orders', 'finance']);
  });

  it('refuses to exceed the limit', () => {
    const full: NavigationKey[] = ['orders', 'quotations', 'shipping', 'finance'];
    expect(toggleMobileTab(full, 'products')).toBe(full);
  });

  it('removes an existing module but always keeps at least one', () => {
    expect(toggleMobileTab(['orders', 'quotations'], 'orders')).toEqual(['quotations']);
    expect(toggleMobileTab(['orders'], 'orders')).toEqual(['orders']);
  });
});

describe('isDefaultMobileTabs', () => {
  it('detects the default combination, including the order of tabs', () => {
    expect(isDefaultMobileTabs([...DEFAULT_MOBILE_TABS])).toBe(true);
    expect(isDefaultMobileTabs(['quotations', 'orders', 'shipping', 'finance'])).toBe(false);
    expect(isDefaultMobileTabs(DEFAULT_MOBILE_TABS.slice(0, 2))).toBe(false);
  });
});

describe('mobile tab persistence', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('round trips through the local storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
      },
    });
    expect(loadMobileTabs()).toEqual(DEFAULT_MOBILE_TABS);
    saveMobileTabs(['products', 'stock']);
    expect(store.get(MOBILE_TABS_STORAGE_KEY)).toBe(JSON.stringify(['products', 'stock']));
    expect(loadMobileTabs()).toEqual(['products', 'stock']);
  });

  it('recovers from corrupted or unavailable storage without throwing', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => '{not json',
        setItem: () => undefined,
      },
    });
    expect(loadMobileTabs()).toEqual(DEFAULT_MOBILE_TABS);
    expect(() => saveMobileTabs(['orders'])).not.toThrow();
  });
});
