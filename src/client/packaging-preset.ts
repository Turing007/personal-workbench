import type { PackagingOption } from './components/OrderForm';
import type { PackagingPreset } from '../shared/packaging-presets';

export function blankPackagingRow(): PackagingOption {
  return { id: `pack-${Date.now()}`, name: '彩盒包装', innerSize: '', innerWeight: '', outerSize: '', outerWeight: '', packSize: 1, purchasePrice: '', images: [] };
}

/** 落库时重量与价格会写成 0，回显成字符串「0」；这类值按「没填」处理。 */
function unfilled(value: string | number | null | undefined) {
  const text = String(value ?? '').trim();
  return !text || Number(text) === 0;
}

/**
 * 「没填过」的判定不含包装名称：新增行会把名称默认写成「彩盒包装」，
 * 要求名称为空的话这条规则永远不会命中，点预设就只会长出新行。
 */
export function isBlankPackagingRow(row: PackagingOption): boolean {
  return unfilled(row.innerSize)
    && unfilled(row.outerSize)
    && unfilled(row.innerWeight)
    && unfilled(row.outerWeight)
    && unfilled(row.purchasePrice)
    && !(row.packSize > 1)
    && !(row.images?.length ?? 0);
}

/** 点预设：优先填第一个没填过的空行，没有空行就追加一行，已有内容的行一律不动。 */
export function applyPackagingPreset(rows: PackagingOption[], preset: PackagingPreset): PackagingOption[] {
  const patch: Pick<PackagingOption, 'name' | 'innerSize' | 'outerSize' | 'packSize' | 'purchasePrice'> = {
    name: preset.name,
    innerSize: preset.innerSize,
    outerSize: preset.outerSize,
    packSize: preset.packSize,
    purchasePrice: preset.purchasePrice,
  };
  const index = rows.findIndex(isBlankPackagingRow);
  if (index >= 0) return rows.map((row, position) => (position === index ? { ...row, ...patch } : row));
  return [...rows, { ...blankPackagingRow(), ...patch }];
}
