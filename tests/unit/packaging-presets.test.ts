import { describe, expect, it } from 'vitest';
import {
  PACKAGING_PRESET_CATEGORY_LIMIT,
  PACKAGING_PRESET_LIMIT,
  derivePackagingPresets,
  normalizeCategoryList,
  normalizePackagingPresets,
  packagingPresetMatches,
  sortPackagingPresetsForProduct,
  type PackagingPreset,
  type PackagingSourceRow,
} from '../../src/shared/packaging-presets';
import { applyPackagingPreset, isBlankPackagingRow } from '../../src/client/packaging-preset';

function row(values: Partial<PackagingSourceRow>): PackagingSourceRow {
  return { name: '牛皮纸盒', innerSize: '45*9*9', outerSize: '47*48*36', packSize: 20, purchasePrice: '', ...values };
}

describe('derivePackagingPresets', () => {
  it('按组合使用次数倒序取前几套，名称用该组合里最常见的包装名', () => {
    const presets = derivePackagingPresets([
      row({ innerSize: '23*22*9.5', outerSize: '50*47*23', packSize: 10, purchasePrice: '2', name: '彩盒包装' }),
      row({ name: '牛皮纸盒-20台装' }),
      row({}),
      row({ name: '牛皮纸盒-15台装', innerSize: '28*26*10', outerSize: '58*53*28', packSize: 15 }),
    ]);
    // 45*9*9 / 47*48*36 / 20 用了两次排第一；剩下两套各一次，按组合键稳定排序。
    expect(presets).toHaveLength(3);
    expect(presets[0]).toMatchObject({ name: '牛皮纸盒', innerSize: '45*9*9', outerSize: '47*48*36', packSize: 20, purchasePrice: '' });
    expect(presets[1]).toMatchObject({ name: '彩盒包装', innerSize: '23*22*9.5', purchasePrice: '2' });
    expect(presets[2]).toMatchObject({ name: '牛皮纸盒-15台装', packSize: 15 });
  });

  it('内盒与外箱都没填、或只有 1*1*1 占位值的记录不参与统计', () => {
    const presets = derivePackagingPresets([
      row({ innerSize: '', outerSize: '' }),
      row({ innerSize: '', outerSize: '1*1*1' }),
      row({ innerSize: '10*10*10', outerSize: '1*1*1' }),
    ]);
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({ innerSize: '10*10*10', outerSize: '' });
  });

  it('采购价 0 视为未填，不写进预设', () => {
    const presets = derivePackagingPresets([row({ purchasePrice: '0' }), row({ purchasePrice: 0 })]);
    expect(presets).toHaveLength(1);
    expect(presets[0].purchasePrice).toBe('');
  });

  it('受 limit 限制，默认最多 8 套', () => {
    const rows = Array.from({ length: 12 }, (_, index) => row({ innerSize: `10*10*${index}` }));
    expect(derivePackagingPresets(rows)).toHaveLength(8);
    expect(derivePackagingPresets(rows, 3)).toHaveLength(3);
  });

  it('按来源产品的分类填 categories，统计不到分类时留空', () => {
    const presets = derivePackagingPresets([
      row({ category: '电钻' }),
      row({ category: '电钻' }),
      row({ category: '扳手' }),
      row({ innerSize: '20*20*20', outerSize: '30*30*30', packSize: 6, category: '' }),
    ]);
    // 同一组合用了三次（电钻×2、扳手×1），分类按出现频次倒序。
    expect(presets[0].categories).toEqual(['电钻', '扳手']);
    // 没填分类的产品贡献不了分类信息，结果是空数组而不是 undefined。
    expect(presets[1].categories).toEqual([]);
  });

  it('分类名做 trim，空格与空串不计入', () => {
    const presets = derivePackagingPresets([row({ category: '  电钻  ' }), row({ category: '   ' })]);
    expect(presets[0].categories).toEqual(['电钻']);
  });
});

describe('normalizeCategoryList', () => {
  it('trim、去重、丢空串，非字符串项忽略', () => {
    expect(normalizeCategoryList([' 电钻 ', '电钻', '', '扳手', 42 as never, null as never])).toEqual(['电钻', '扳手']);
  });

  it('非数组输入返回空数组', () => {
    expect(normalizeCategoryList(undefined)).toEqual([]);
    expect(normalizeCategoryList('电钻')).toEqual([]);
  });

  it('按上限截断', () => {
    const many = Array.from({ length: PACKAGING_PRESET_CATEGORY_LIMIT + 4 }, (_, index) => `分类${index}`);
    expect(normalizeCategoryList(many)).toHaveLength(PACKAGING_PRESET_CATEGORY_LIMIT);
  });

  it('单个分类名超长时截断', () => {
    const [name] = normalizeCategoryList(['x'.repeat(50)]);
    expect(name).toHaveLength(30);
  });
});

describe('包装管理的分类关联', () => {
  const preset = (categories: string[]): PackagingPreset => ({
    id: 'p1', name: '牛皮纸盒-20台装', innerSize: '45*9*9', outerSize: '47*48*36', packSize: 20, purchasePrice: '', categories,
  });

  it('缺省 categories 按通用处理，旧数据无缝升级', () => {
    const result = normalizePackagingPresets([{ name: '老预设', innerSize: '10*10*10', outerSize: '', packSize: 10, purchasePrice: '' }]);
    expect(result[0].categories).toEqual([]);
    expect(packagingPresetMatches({ activeCategories: ['任意分类'], preset: result[0] })).toBe(true);
  });

  it('只勾了分类、没填规格的行不被当成空行丢掉', () => {
    const result = normalizePackagingPresets([{ name: '', innerSize: '', outerSize: '', packSize: 1, purchasePrice: '', categories: ['电钻'] }]);
    expect(result).toHaveLength(1);
    expect(result[0].categories).toEqual(['电钻']);
  });

  it('分类名 trim 后精确匹配', () => {
    expect(packagingPresetMatches({ activeCategories: ['电钻 '], preset: preset(['电钻']) })).toBe(true);
    expect(packagingPresetMatches({ activeCategories: ['扳手'], preset: preset(['电钻']) })).toBe(false);
    expect(packagingPresetMatches({ activeCategories: [], preset: preset(['电钻']) })).toBe(false);
    expect(packagingPresetMatches({ activeCategories: [], preset: preset([]) })).toBe(true);
  });

  it('多分类产品命中任一交集即算适用', () => {
    expect(packagingPresetMatches({ activeCategories: ['充电式', '扳手'], preset: preset(['电钻', '扳手']) })).toBe(true);
  });

  it('排序把命中的排前、未命中排后，组内保持原有顺序', () => {
    const a = preset([]);           // 通用 → 命中
    const b = { ...preset(['电钻']), id: 'p2', name: '电钻专用' };
    const c = { ...preset(['扳手']), id: 'p3', name: '扳手专用' };
    const d = { ...preset(['电钻']), id: 'p4', name: '电钻备用' };
    const sorted = sortPackagingPresetsForProduct([a, b, c, d], ['电钻']);
    expect(sorted.map((item) => item.name)).toEqual(['牛皮纸盒-20台装', '电钻专用', '电钻备用', '扳手专用']);
  });

  it('产品没填分类时，通用包装仍排在前、限定了分类的排后', () => {
    const list = [preset(['电钻']), preset(['扳手']), preset([])];
    expect(sortPackagingPresetsForProduct(list, []).map((item) => item.categories)).toEqual([[], ['电钻'], ['扳手']]);
  });
});

describe('normalizePackagingPresets', () => {
  it('丢弃全空条目、按上限截断、补齐缺失 id', () => {
    const input = Array.from({ length: 15 }, (_, index) => ({ name: `预设${index}`, innerSize: '10*10*10', outerSize: '', packSize: 10, purchasePrice: '' }));
    const result = normalizePackagingPresets([...input, { name: '', innerSize: '', outerSize: '', packSize: 1, purchasePrice: '' }]);
    expect(result).toHaveLength(PACKAGING_PRESET_LIMIT);
    expect(result[0].id).toBe('pack-preset-1');
  });

  it('装箱数兜到有效区间', () => {
    const [preset] = normalizePackagingPresets([{ name: 'a', packSize: 0 }, { name: 'b', packSize: 99_999 }, { name: 'c', packSize: '12.7' }]);
    expect(preset.packSize).toBe(1);
    const [, second, third] = normalizePackagingPresets([{ name: 'a', packSize: 0 }, { name: 'b', packSize: 99_999 }, { name: 'c', packSize: '12.7' }]);
    expect(second.packSize).toBe(9999);
    expect(third.packSize).toBe(12);
  });

  it('非数组输入返回空列表', () => {
    expect(normalizePackagingPresets(undefined)).toEqual([]);
    expect(normalizePackagingPresets({})).toEqual([]);
  });
});

describe('applyPackagingPreset', () => {
  const preset = { id: 'p1', name: '牛皮纸盒-20台装', innerSize: '45*9*9', outerSize: '47*48*36', packSize: 20, purchasePrice: '2' };
  const blank = { id: 'r1', name: '彩盒包装', innerSize: '', innerWeight: '', outerSize: '', outerWeight: '', packSize: 1, purchasePrice: '', images: [] };
  const filled = { ...blank, id: 'r2', name: '塑箱', innerSize: '30*20*10', packSize: 6 };

  it('新建产品带来的默认行算空行，能被预设填进去', () => {
    expect(isBlankPackagingRow(blank)).toBe(true);
    const [row1] = applyPackagingPreset([blank], preset);
    expect(row1).toMatchObject({ id: 'r1', name: '牛皮纸盒-20台装', innerSize: '45*9*9', outerSize: '47*48*36', packSize: 20, purchasePrice: '2' });
  });

  it('没有空行时追加一行，已有内容的行原样保留', () => {
    const result = applyPackagingPreset([filled], preset);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(filled);
    expect(result[1]).toMatchObject({ name: '牛皮纸盒-20台装', innerSize: '45*9*9' });
  });

  it('只填第一个空行', () => {
    const result = applyPackagingPreset([filled, blank, { ...blank, id: 'r3' }], preset);
    expect(result[1].innerSize).toBe('45*9*9');
    expect(result[2].innerSize).toBe('');
  });

  it('填过重量或图片的行不算空行', () => {
    expect(isBlankPackagingRow({ ...blank, innerWeight: '0.5' })).toBe(false);
    expect(isBlankPackagingRow({ ...blank, images: [{ id: 'i1' } as never] })).toBe(false);
  });

  it('落库回显的 0 重量 / 0 价格仍算空行，预设能直接填进去', () => {
    const fromDb = { ...blank, innerWeight: '0', outerWeight: '0', purchasePrice: '0' };
    expect(isBlankPackagingRow(fromDb)).toBe(true);
    const [first] = applyPackagingPreset([fromDb], preset);
    expect(first).toMatchObject({ id: 'r1', innerSize: '45*9*9', purchasePrice: '2' });
  });
});
