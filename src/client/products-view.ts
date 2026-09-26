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

/** 手机端默认大图浏览，桌面端默认列表（表格）。 */
export function initialProductsView(narrow: boolean): ProductsView {
  return loadProductsView() ?? (narrow ? 'gallery' : 'list');
}
