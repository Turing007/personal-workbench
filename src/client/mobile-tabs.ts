import { navigationKeys, type NavigationKey } from './navigation';

export const MOBILE_TABS_STORAGE_KEY = 'workbench:mobile-tabs';

/** 底部栏最多显示的模块数，超过后每个 Tab 会挤到看不清。 */
export const MOBILE_TAB_LIMIT = 4;

/** 默认与历史行为保持一致：订单 → 报价 → 发货 → 财务。 */
export const DEFAULT_MOBILE_TABS: NavigationKey[] = ['orders', 'quotations', 'shipping', 'finance'];

function isNavigationKey(value: unknown): value is NavigationKey {
  return typeof value === 'string' && (navigationKeys as string[]).includes(value);
}

/**
 * 把任意来源（本机存储、旧版本数据）归一化成合法的底部栏配置：
 * 剔除未知模块、去重、截断到上限。全部非法时回退默认，避免底部栏只剩「更多」。
 */
export function normalizeMobileTabs(value: unknown): NavigationKey[] {
  if (!Array.isArray(value)) return [...DEFAULT_MOBILE_TABS];
  const result: NavigationKey[] = [];
  for (const item of value) {
    if (!isNavigationKey(item) || result.includes(item)) continue;
    result.push(item);
    if (result.length >= MOBILE_TAB_LIMIT) break;
  }
  return result.length ? result : [...DEFAULT_MOBILE_TABS];
}

/** 交换相邻位置，用于底部栏排序；越界时原样返回。 */
export function moveMobileTab(tabs: NavigationKey[], key: NavigationKey, offset: -1 | 1): NavigationKey[] {
  const index = tabs.indexOf(key);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= tabs.length) return tabs;
  const next = [...tabs];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** 添加/移除一个模块：添加追加到末尾，已满则忽略；始终至少保留一个模块。 */
export function toggleMobileTab(tabs: NavigationKey[], key: NavigationKey): NavigationKey[] {
  if (tabs.includes(key)) {
    return tabs.length <= 1 ? tabs : tabs.filter((item) => item !== key);
  }
  return tabs.length >= MOBILE_TAB_LIMIT ? tabs : [...tabs, key];
}

export function isDefaultMobileTabs(tabs: NavigationKey[]): boolean {
  return tabs.length === DEFAULT_MOBILE_TABS.length && tabs.every((key, index) => key === DEFAULT_MOBILE_TABS[index]);
}

export function loadMobileTabs(): NavigationKey[] {
  try {
    const raw = window.localStorage.getItem(MOBILE_TABS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_MOBILE_TABS];
    return normalizeMobileTabs(JSON.parse(raw));
  } catch {
    /* 存储不可用或数据损坏时回退默认，不影响底部栏渲染 */
    return [...DEFAULT_MOBILE_TABS];
  }
}

export function saveMobileTabs(tabs: NavigationKey[]): void {
  try { window.localStorage.setItem(MOBILE_TABS_STORAGE_KEY, JSON.stringify(tabs)); } catch { /* 忽略存储失败 */ }
}
