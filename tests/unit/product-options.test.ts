import { describe, expect, it } from 'vitest';
import {
  PRODUCT_OPTION_LIMIT,
  PRODUCT_OPTION_NAME_LIMIT,
  cleanProductOptionName,
  deriveProductOptionPresets,
  normalizeProductOptionList,
  normalizeProductOptionPresets,
} from '../../src/shared/product-options';

describe('颜色 / 插脚预设清洗', () => {
  it('去空白并截断超长名称', () => {
    expect(cleanProductOptionName('  蓝  ')).toBe('蓝');
    expect(cleanProductOptionName(42)).toBe('');
    expect(cleanProductOptionName('x'.repeat(PRODUCT_OPTION_NAME_LIMIT + 5))).toHaveLength(PRODUCT_OPTION_NAME_LIMIT);
  });

  it('大小写不敏感去重，保留先出现的写法与顺序', () => {
    expect(normalizeProductOptionList([' pv ', 'PV', 'Pv', '红', '', 3])).toEqual(['pv', '红']);
  });

  it('非数组与超上限都安全', () => {
    expect(normalizeProductOptionList('红')).toEqual([]);
    expect(normalizeProductOptionList(Array.from({ length: PRODUCT_OPTION_LIMIT + 10 }, (_, index) => `色${index}`))).toHaveLength(PRODUCT_OPTION_LIMIT);
    expect(normalizeProductOptionPresets(null)).toEqual({ colors: [], plugs: [] });
  });
});

describe('从产品库统计', () => {
  it('按出现次数降序，次数相同按名称排序', () => {
    const result = deriveProductOptionPresets([
      { colors: ['蓝', '红'], batteryPlugs: ['牧田'] },
      { colors: ['红', '蓝'], batteryPlugs: ['德伟'] },
      { colors: ['红'], batteryPlugs: ['牧田'] },
    ]);
    expect(result.colors).toEqual(['红', '蓝']);
    expect(result.plugs).toEqual(['牧田', '德伟']);
  });

  it('忽略脏数据', () => {
    const result = deriveProductOptionPresets([
      { colors: '红', batteryPlugs: [null, 3, '  '] },
      {},
      { colors: [' 黄 '], batteryPlugs: ['牧田'] },
    ]);
    expect(result).toEqual({ colors: ['黄'], plugs: ['牧田'] });
  });
});
