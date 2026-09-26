/** 图册密度：一页排几个产品。服务端排版与前端选择共用这份定义。 */
export type CatalogDensity = 'comfortable' | 'standard' | 'compact';

export const DEFAULT_CATALOG_DENSITY: CatalogDensity = 'standard';

export const CATALOG_DENSITY_OPTIONS: ReadonlyArray<{ value: CatalogDensity; label: string; hint: string }> = [
  { value: 'comfortable', label: '大图', hint: '每页约 4 个，主图最大' },
  { value: 'standard', label: '标准', hint: '每页约 6 个' },
  { value: 'compact', label: '紧凑', hint: '每页约 8 个，适合微信直发' },
];

export function isCatalogDensity(value: unknown): value is CatalogDensity {
  return CATALOG_DENSITY_OPTIONS.some((option) => option.value === value);
}
