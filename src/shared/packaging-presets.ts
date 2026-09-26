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
}

export const PACKAGING_PRESET_LIMIT = 12;
export const PACKAGING_PRESET_SEED_COUNT = 8;
export const PACKAGING_PRESET_NAME_LIMIT = 30;

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

/** 校验并清洗一条预设；名称与四个字段全空视为无效（返回 null，由调用方丢弃）。 */
export function normalizePackagingPreset(value: unknown, fallbackId = ''): PackagingPreset | null {
  const record = (value ?? {}) as Partial<PackagingPreset>;
  const name = text(record.name).slice(0, PACKAGING_PRESET_NAME_LIMIT);
  const innerSize = text(record.innerSize);
  const outerSize = text(record.outerSize);
  const purchasePrice = text(record.purchasePrice);
  if (!name && !innerSize && !outerSize && !purchasePrice) return null;
  return { id: text(record.id) || fallbackId, name, innerSize, outerSize, packSize: packSizeValue(record.packSize), purchasePrice };
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

export interface PackagingSourceRow {
  name?: string | null;
  innerSize?: string | null;
  outerSize?: string | null;
  packSize?: number | string | null;
  purchasePrice?: number | string | null;
}

/**
 * 从历史包装记录统计常用组合：按「内盒 + 外箱 + 装箱数 + 采购价」分组，取用得最多的前几套，
 * 名称用该组合里出现最多的包装名。内盒与外箱都没填的记录不参与。
 */
export function derivePackagingPresets(rows: PackagingSourceRow[], limit = PACKAGING_PRESET_SEED_COUNT): PackagingPreset[] {
  interface Group { count: number; names: Map<string, number> }
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
      group = { count: 0, names: new Map() };
      groups.set(key, group);
    }
    group.count += 1;
    const name = text(row.name);
    if (name) group.names.set(name, (group.names.get(name) ?? 0) + 1);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  return ranked.slice(0, Math.max(0, limit)).map(([key, group], index) => {
    const [innerSize, outerSize, packSize, purchasePrice] = key.split('|');
    const name = [...group.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
    return {
      id: `pack-preset-${index + 1}`,
      name,
      innerSize,
      outerSize,
      packSize: packSizeValue(packSize),
      purchasePrice,
    };
  });
}
