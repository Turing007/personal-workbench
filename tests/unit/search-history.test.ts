import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SEARCH_HISTORY_LIMIT,
  clearSearchHistory,
  loadSearchHistory,
  pushSearchHistory,
  removeSearchHistory,
} from '../../src/client/search-history';

/** 最小 localStorage 替身；window 与 globalThis 都要替换（模块引用全局 localStorage）。 */
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
  vi.stubGlobal('window', { localStorage });
  vi.stubGlobal('localStorage', localStorage);
  return store;
}

const KEY = 'workbench:search-history';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('搜索历史', () => {
  it('新词插到最前，读回顺序与写入一致', () => {
    stubStorage();
    pushSearchHistory('扳手');
    pushSearchHistory('电钻');
    expect(loadSearchHistory()).toEqual(['电钻', '扳手']);
  });

  it('重复搜索同一个词只保留最新一条并提到最前', () => {
    stubStorage();
    pushSearchHistory('扳手');
    pushSearchHistory('电钻');
    pushSearchHistory('扳手');
    expect(loadSearchHistory()).toEqual(['扳手', '电钻']);
  });

  it('判重忽略大小写与首尾空格，但保留用户原样输入', () => {
    stubStorage();
    pushSearchHistory('VT-01');
    pushSearchHistory('  vt-01  ');
    expect(loadSearchHistory()).toEqual(['vt-01']);
  });

  it('空词与纯空白不记录', () => {
    stubStorage();
    pushSearchHistory('');
    pushSearchHistory('   ');
    expect(loadSearchHistory()).toEqual([]);
  });

  it('只保留最近 10 条，超出的丢掉最旧的', () => {
    stubStorage();
    for (let index = 1; index <= SEARCH_HISTORY_LIMIT + 3; index += 1) pushSearchHistory(`词${index}`);
    const history = loadSearchHistory();
    expect(history).toHaveLength(SEARCH_HISTORY_LIMIT);
    // 最新的是「词13」，最旧的「词1」～「词3」已被挤掉。
    expect(history[0]).toBe(`词${SEARCH_HISTORY_LIMIT + 3}`);
    expect(history).not.toContain('词1');
  });

  it('删除单条与清空全部', () => {
    stubStorage();
    pushSearchHistory('扳手');
    pushSearchHistory('电钻');
    expect(removeSearchHistory('扳手')).toEqual(['电钻']);
    expect(loadSearchHistory()).toEqual(['电钻']);
    expect(clearSearchHistory()).toEqual([]);
    expect(loadSearchHistory()).toEqual([]);
  });

  it('存量脏数据（非数组、混入空值与重复）读取时清洗', () => {
    stubStorage({
      [KEY]: JSON.stringify(['电钻', '  电钻  ', '', 42, null, '扳手']),
    });
    expect(loadSearchHistory()).toEqual(['电钻', '扳手']);
  });

  it('存储内容损坏时按空历史处理，不抛错', () => {
    stubStorage({ [KEY]: 'not-json{{{' });
    expect(loadSearchHistory()).toEqual([]);
  });

  it('localStorage 不可用时静默降级，不影响搜索本身', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadSearchHistory()).toEqual([]);
    expect(() => pushSearchHistory('扳手')).not.toThrow();
    expect(() => clearSearchHistory()).not.toThrow();
  });
});
