/**
 * 产品可选项预设：颜色、电池插脚。
 * 产品编辑器里只能从这份清单勾选，不再临时输入；维护入口在设置页（服务端存一份，多设备共用）。
 * 从未维护过时，按产品库里的实际取值自动统计；没有历史数据才用默认三条。
 */

export interface ProductOptionPresets {
  colors: string[];
  plugs: string[];
}

export const DEFAULT_PRODUCT_COLORS = ['蓝', '红', '黄'];
export const DEFAULT_PRODUCT_PLUGS = ['MT', 'DE', 'MI'];

/** 每类上限：够覆盖常见规格，又不会把编辑器第一行撑爆。 */
export const PRODUCT_OPTION_LIMIT = 40;
export const PRODUCT_OPTION_NAME_LIMIT = 20;

/** 单个名称清洗：去空白、限长；空串返回 ''。 */
export function cleanProductOptionName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, PRODUCT_OPTION_NAME_LIMIT);
}

/**
 * 名称清单归一化：去空、去重、按上限截断，保留用户排的顺序。
 * 大小写不敏感去重（「PV」与「pv」视为同一个），但保留先出现的写法。
 */
export function normalizeProductOptionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const name = cleanProductOptionName(entry);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
    if (result.length >= PRODUCT_OPTION_LIMIT) break;
  }
  return result;
}

export function normalizeProductOptionPresets(value: unknown): ProductOptionPresets {
  const record = (value ?? {}) as Partial<ProductOptionPresets>;
  return {
    colors: normalizeProductOptionList(record.colors),
    plugs: normalizeProductOptionList(record.plugs),
  };
}

/** 从真实产品数据统计候选：按出现次数降序，次数相同按名称排序。 */
export function deriveProductOptionPresets(
  rows: Array<{ colors?: unknown; batteryPlugs?: unknown }>,
): ProductOptionPresets {
  const count = (key: 'colors' | 'batteryPlugs') => {
    const map = new Map<string, { name: string; count: number }>();
    for (const row of rows) {
      const list = Array.isArray(row[key]) ? row[key] as unknown[] : [];
      for (const entry of list) {
        const name = cleanProductOptionName(entry);
        if (!name) continue;
        const id = name.toLowerCase();
        const current = map.get(id);
        if (current) current.count += 1;
        else map.set(id, { name, count: 1 });
      }
    }
    return [...map.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
      .slice(0, PRODUCT_OPTION_LIMIT)
      .map((item) => item.name);
  };
  return { colors: count('colors'), plugs: count('batteryPlugs') };
}
