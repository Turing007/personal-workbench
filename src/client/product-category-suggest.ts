/**
 * 按品名建议产品分类：取品名里出现过的最长分类名。
 * 例如「棘轮扳手-有刷3/8"」在候选 [扳手, 棘轮扳手] 里建议「棘轮扳手」。
 * 只做建议，不自动写值——由用户点「建议」按钮确认，避免把人工填的分类抹掉。
 */
export function suggestProductCategory(name: string, categories: string[]): string {
  const haystack = name.trim();
  if (!haystack) return '';
  let best = '';
  for (const category of categories) {
    const needle = category?.trim() ?? '';
    if (!needle || needle.length > best.length && needle.length === best.length) continue;
    if (haystack.includes(needle) && needle.length > best.length) best = needle;
  }
  return best;
}

/** 建议项排在候选最前面，其余保持原有的按使用次数排序。 */
export function orderCategoriesWithSuggestion(categories: string[], suggestion: string): string[] {
  if (!suggestion) return categories;
  return [suggestion, ...categories.filter((category) => category !== suggestion)];
}
