/**
 * 搜索历史：把用户搜过的关键词存在 localStorage，下次点搜索框时以胶囊形式展示，
 * 点一下直接搜。属于本机偏好（与产品库视图选择同一套路），不进服务端、不跨设备。
 *
 * 三条规则：
 *  1. 同一个词再次搜索只保留最新一条，位置提到最前 —— 常用的词自然浮到前面；
 *  2. 大小写与首尾空格不敏感地判重（「VT-01」与「vt-01」算同一个词），
 *     但存的是用户原样输入，展示与再搜都用原值；
 *  3. 只保留最近 10 条，超出丢掉最旧的。
 */

const STORAGE_KEY = 'workbench:search-history';

/** 最多保留的关键词数量。 */
export const SEARCH_HISTORY_LIMIT = 10;

/** 单条关键词长度上限，防止有人粘一整段文本进来把小胶囊撑爆。 */
const KEYWORD_LIMIT = 40;

function normalizeKeyword(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, KEYWORD_LIMIT);
}

/** 判重用的键：大小写与中文全半角差异不敏感。 */
function dedupeKey(keyword: string): string {
  return keyword.toLowerCase();
}

export function loadSearchHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: string[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
      const keyword = normalizeKeyword(entry);
      if (!keyword) continue;
      const key = dedupeKey(keyword);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(keyword);
      if (result.length >= SEARCH_HISTORY_LIMIT) break;
    }
    return result;
  } catch {
    return [];
  }
}

function persist(history: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // 存不进去（隐私模式、配额满）时本次仍然生效，只是关掉页面后不再记得。
  }
}

/** 记一条关键词到最前，返回新列表（同时落盘）。空词或纯空白直接忽略。 */
export function pushSearchHistory(keyword: string, current?: string[]): string[] {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) return current ?? loadSearchHistory();
  const base = current ?? loadSearchHistory();
  const key = dedupeKey(normalized);
  const next = [normalized, ...base.filter((entry) => dedupeKey(entry) !== key)].slice(0, SEARCH_HISTORY_LIMIT);
  persist(next);
  return next;
}

/** 删掉一条关键词，返回新列表。 */
export function removeSearchHistory(keyword: string, current?: string[]): string[] {
  const key = dedupeKey(normalizeKeyword(keyword));
  const base = current ?? loadSearchHistory();
  const next = base.filter((entry) => dedupeKey(entry) !== key);
  persist(next);
  return next;
}

/** 清空全部历史。 */
export function clearSearchHistory(): string[] {
  persist([]);
  return [];
}
