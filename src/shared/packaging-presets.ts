/**
 * 包装方式预设：产品编辑器里一键填入「包装名称 + 内盒尺寸 + 外箱尺寸 + 装箱数 + 包装采购价」的常用组合。
 * 预设存在服务端 settings 表（多设备共用一份），首次使用时从现有产品包装记录统计生成。
 */

export interface PackagingPreset {
  id: string;
  name: string;
  innerSize: string;
  outerSize: string;
  packSize: number;
  purchasePrice: string;
  /** 适用产品分类（按类目粒度关联，如「电钻」「扳手」）；空数组 = 通用，不限分类。 */
  categories: string[];
}

export const PACKAGING_PRESET_LIMIT = 12;
export const PACKAGING_PRESET_SEED_COUNT = 8;
export const PACKAGING_PRESET_NAME_LIMIT = 30;
/** 单条包装可关联的分类数与单个分类名长度：够用又不至于把一行撑爆。 */
export const PACKAGING_PRESET_CATEGORY_LIMIT = 12;
export const PACKAGING_PRESET_CATEGORY_NAME_LIMIT = 30;

/** 库里有人拿 1*1*1 当占位填，统计时按没填处理。 */
const JUNK_SIZE_PATTERN = /^1\s*[*×xX]\s*1\s*[*×xX]\s*1(?:cm)?$/;

function text(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return typeof value === 'string' ? value.trim() : '';
}

function size(value: unknown): string {
  const raw = text(value);
  return JUNK_SIZE_PATTERN.test(raw) ? '' : raw;
}

function price(value: unknown): string {
  const raw = text(value);
  if (!raw || Number(raw) === 0) return '';
  return raw;
}

export function packSizeValue(value: unknown): number {
  const parsed = Math.trunc(Number(value ?? 1));
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 9999);
}

/** 分类名单归一化：trim、去重、丢空串、按上限截断。 */
export function normalizeCategoryList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim().slice(0, PACKAGING_PRESET_CATEGORY_NAME_LIMIT);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
    if (result.length >= PACKAGING_PRESET_CATEGORY_LIMIT) break;
  }
  return result;
}

/**
 * 校验并清洗一条预设。
 * 有效性判定包含 categories：只勾了「可以装哪些产品」、规格还没填的行是维护中的中间状态，
 * 丢掉它会让用户以为保存成功、实际内容消失，所以有分类就算有效。
 */
export function normalizePackagingPreset(value: unknown, fallbackId = ''): PackagingPreset | null {
  const record = (value ?? {}) as Partial<PackagingPreset>;
  const name = text(record.name).slice(0, PACKAGING_PRESET_NAME_LIMIT);
  const innerSize = text(record.innerSize);
  const outerSize = text(record.outerSize);
  const purchasePrice = text(record.purchasePrice);
  const categories = normalizeCategoryList(record.categories);
  if (!name && !innerSize && !outerSize && !purchasePrice && !categories.length) return null;
  return { id: text(record.id) || fallbackId, name, innerSize, outerSize, packSize: packSizeValue(record.packSize), purchasePrice, categories };
}

/** 保存前的整表清洗：丢弃无效项、按上限截断、补齐缺失 id。 */
export function normalizePackagingPresets(value: unknown): PackagingPreset[] {
  const list = Array.isArray(value) ? value : [];
  const result: PackagingPreset[] = [];
  list.forEach((entry, index) => {
    if (result.length >= PACKAGING_PRESET_LIMIT) return;
    const preset = normalizePackagingPreset(entry, `pack-preset-${index + 1}`);
    if (preset) result.push(preset);
  });
  return result;
}

export interface PackagingPresetMatchInput {
  /** 当前产品的分类（可能是多个标签，如「电钻」「充电式」）。 */
  activeCategories: readonly string[];
  preset: PackagingPreset;
}

/**
 * 这条包装是否适用于当前产品的分类。
 * 空 categories = 通用，不限分类；否则与产品分类有任一交集即算命中。
 * 分类名做 trim 后精确比较 —— 产品分类名写「电钻 」而包装关联写「电钻」不应算不命中。
 */
export function packagingPresetMatches({ activeCategories, preset }: PackagingPresetMatchInput): boolean {
  if (!preset.categories.length) return true;
  const active = new Set(activeCategories.map((item) => item.trim()).filter(Boolean));
  return preset.categories.some((category) => active.has(category.trim()));
}

/**
 * 预设排序：命中的排前、未命中排后，组内保持原有相对顺序（stable）。
 * 产品编辑器据此决定「适用本类」卡片置顶，其余照旧。
 */
export function sortPackagingPresetsForProduct(presets: PackagingPreset[], activeCategories: readonly string[]): PackagingPreset[] {
  return presets
    .map((preset, index) => ({ preset, index, matched: packagingPresetMatches({ activeCategories, preset }) }))
    .sort((a, b) => (b.matched ? 1 : 0) - (a.matched ? 1 : 0) || a.index - b.index)
    .map((entry) => entry.preset);
}

export interface PackagingSourceRow {
  name?: string | null;
  innerSize?: string | null;
  outerSize?: string | null;
  packSize?: number | string | null;
  purchasePrice?: number | string | null;
  /** 该包装行所属产品的分类；为空表示这条记录贡献不了分类信息。 */
  category?: string | null;
}

/**
 * 从历史包装记录统计常用组合：按「内盒 + 外箱 + 装箱数 + 采购价」分组，取用得最多的前几套，
 * 名称用该组合里出现最多的包装名。内盒与外箱都没填的记录不参与。
 * categories 取该组合来源产品分类的并集（按出现频次倒序），统计不到分类时留空。
 */
export function derivePackagingPresets(rows: PackagingSourceRow[], limit = PACKAGING_PRESET_SEED_COUNT): PackagingPreset[] {
  interface Group { count: number; names: Map<string, number>; categories: Map<string, number> }
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const innerSize = size(row.innerSize);
    const outerSize = size(row.outerSize);
    if (!innerSize && !outerSize) continue;
    const packSize = packSizeValue(row.packSize);
    const purchasePrice = price(row.purchasePrice);
    const key = `${innerSize}|${outerSize}|${packSize}|${purchasePrice}`;
    let group = groups.get(key);
    if (!group) {
      group = { count: 0, names: new Map(), categories: new Map() };
      groups.set(key, group);
    }
    group.count += 1;
    const name = text(row.name);
    if (name) group.names.set(name, (group.names.get(name) ?? 0) + 1);
    const category = text(row.category);
    if (category) group.categories.set(category, (group.categories.get(category) ?? 0) + 1);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  return ranked.slice(0, Math.max(0, limit)).map(([key, group], index) => {
    const [innerSize, outerSize, packSize, purchasePrice] = key.split('|');
    const name = [...group.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
    const categories = [...group.categories.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value]) => value);
    return {
      id: `pack-preset-${index + 1}`,
      name,
      innerSize,
      outerSize,
      packSize: packSizeValue(packSize),
      purchasePrice,
      categories,
    };
  });
}
