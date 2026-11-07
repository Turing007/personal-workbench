/** 资料库分类与展示文案，前后端共用。 */
export const LIBRARY_CATEGORIES = ['contract', 'label', 'product', 'other'] as const;
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export const LIBRARY_CATEGORY_LABELS: Record<LibraryCategory, string> = {
  contract: '合同表格',
  label: '客户标贴',
  product: '产品资料',
  other: '其他',
};

export const LIBRARY_SORTS = ['updated', 'name', 'size'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const DEFAULT_LIBRARY_CATEGORY: LibraryCategory = 'other';

export function isLibraryCategory(value: unknown): value is LibraryCategory {
  return typeof value === 'string' && (LIBRARY_CATEGORIES as readonly string[]).includes(value);
}

export function isLibrarySort(value: unknown): value is LibrarySort {
  return typeof value === 'string' && (LIBRARY_SORTS as readonly string[]).includes(value);
}

export function libraryCategoryLabel(category: LibraryCategory): string {
  return LIBRARY_CATEGORY_LABELS[category] ?? LIBRARY_CATEGORY_LABELS.other;
}
