export const PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;
const STORAGE_KEY = 'workbench:products-page-size';

export function readStoredPageSize(): number {
  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(saved) ? saved : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

export function rememberPageSize(size: number) {
  try { window.localStorage.setItem(STORAGE_KEY, String(size)); } catch { /* 存储不可用时本次生效即可 */ }
}

export function totalPages(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

// 删除、筛选、换每页条数都会让页数变少，这里兜住越界，避免出现空白页。
export function clampPage(page: number, total: number, pageSize: number) {
  return Math.min(Math.max(1, page), totalPages(total, pageSize));
}

export function slicePage<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

// 页码条：首页/末页/当前页两侧各两页始终露出，中间省略的用「…」占位。
export function pageWindow(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const keep = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]);
  const shown = [...keep].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
  const result: Array<number | 'gap'> = [];
  let previous = 0;
  for (const value of shown) {
    if (previous && value - previous > 1) result.push('gap');
    result.push(value);
    previous = value;
  }
  return result;
}
