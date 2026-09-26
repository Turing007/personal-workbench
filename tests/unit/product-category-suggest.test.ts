import { describe, expect, it } from 'vitest';
import { orderCategoriesWithSuggestion, suggestProductCategory } from '../../src/client/product-category-suggest';

const CATEGORIES = ['扳手', '棘轮扳手', '逆变器', '吸尘器', '马刀锯'];

describe('suggestProductCategory', () => {
  it('取品名里出现的最长分类名，避免「棘轮扳手」被判成「扳手」', () => {
    expect(suggestProductCategory('棘轮扳手-有刷3/8"加长10cm', CATEGORIES)).toBe('棘轮扳手');
    expect(suggestProductCategory('无刷冲击扳手-500N（B款）', CATEGORIES)).toBe('扳手');
  });

  it('品名里没有分类词就不建议', () => {
    expect(suggestProductCategory('大角扳', CATEGORIES)).toBe('');
    expect(suggestProductCategory('吹吸两用', [])).toBe('');
  });

  it('空品名与空白品名返回空，不参与匹配', () => {
    expect(suggestProductCategory('', CATEGORIES)).toBe('');
    expect(suggestProductCategory('   ', CATEGORIES)).toBe('');
  });

  it('忽略候选里的空值与首尾空格', () => {
    expect(suggestProductCategory('锂电逆变器 12V', ['', '  逆变器  ', '扳手'])).toBe('逆变器');
  });
});

describe('orderCategoriesWithSuggestion', () => {
  it('建议项排第一，其余保持原顺序且不重复', () => {
    expect(orderCategoriesWithSuggestion(['扳手', '棘轮扳手', '逆变器'], '逆变器')).toEqual(['逆变器', '扳手', '棘轮扳手']);
  });

  it('没有建议时原样返回', () => {
    expect(orderCategoriesWithSuggestion(['扳手', '逆变器'], '')).toEqual(['扳手', '逆变器']);
  });
});
