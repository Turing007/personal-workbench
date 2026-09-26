export type ProductsView = 'list' | 'gallery';

const STORAGE_KEY = 'workbench:products-view';

/** 用户选过的视图；null 表示从没选过，由调用方按屏幕宽度定默认。 */
export function loadProductsView(): ProductsView | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'list' || saved === 'gallery' ? saved : null;
  } catch {
    return null;
  }
}

export function saveProductsView(view: ProductsView) {
  try { window.localStorage.setItem(STORAGE_KEY, view); } catch { /* 存储不可用时本次生效即可 */ }
}

/** 默认进大图浏览；用户在工具条上手动切过列表就以他的选择为准（本地记住）。 */
export function initialProductsView(): ProductsView {
  return loadProductsView() ?? 'gallery';
}
