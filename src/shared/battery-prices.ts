/**
 * 电池价格矩阵：行 = 单节容量（mAh），列 = 节数，单元格 = 该组合的单价（元，0 表示未填）。
 * 例：10 节 1300mAh 的电池包多少钱，查「1300」行 ×「10」列即可；计算器里电池行只出这张表里已定价的组合。
 */

export interface BatteryPriceMatrix {
  /** 行：单节电池容量（mAh），正整数。 */
  capacities: number[];
  /** 列：节数，正整数。 */
  packCounts: number[];
  /** prices[容量行][节数列] = 单价（元）；0 表示未填。与行列对齐。 */
  prices: number[][];
  /** 每一容量行的可见范围，与 capacities 同序；空数组 = 所有产品都显示。 */
  capacityScopes?: string[][];
  /** 每一节数列的可见范围，与 packCounts 同序；空数组 = 所有产品都显示。 */
  packCountScopes?: string[][];
}

export const BATTERY_MATRIX_MAX_DIM = 12;
/** 单行/单列最多限定的产品分类数，与包装管理「可以装哪些产品」同一口径。 */
export const BATTERY_SCOPE_CATEGORY_LIMIT = 12;
export const BATTERY_SCOPE_CATEGORY_NAME_LIMIT = 30;

/** 首次使用的默认模板（用户给过的口径）：1300/1500/2000 × 5/10/15/20，价格留空待填。 */
export const BATTERY_MATRIX_DEFAULTS: BatteryPriceMatrix = {
  capacities: [1300, 1500, 2000],
  packCounts: [5, 10, 15, 20],
  prices: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
};

function dimension(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [];
  const result: number[] = [];
  for (const entry of list) {
    const parsed = Math.trunc(Number(entry));
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    if (result.includes(parsed)) continue;
    if (result.length >= BATTERY_MATRIX_MAX_DIM) break;
    result.push(parsed);
  }
  return result;
}

function cellPrice(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100) / 100;
}

export function normalizeBatteryMatrix(value: unknown): BatteryPriceMatrix {
  const record = (value ?? {}) as Partial<BatteryPriceMatrix>;
  const capacities = dimension(record.capacities);
  const packCounts = dimension(record.packCounts);
  const rawRows = Array.isArray(record.prices) ? record.prices : [];
  const prices = capacities.map((_capacity, rowIndex) => {
    const rawRow = Array.isArray(rawRows[rowIndex]) ? (rawRows[rowIndex] as unknown[]) : [];
    return packCounts.map((_packCount, colIndex) => cellPrice(rawRow[colIndex]));
  });
  const matrix: BatteryPriceMatrix = { capacities, packCounts, prices };
  // 只在确实有限定范围时才写出这两个字段：老数据保持原来的形状，读出来不会凭空多两项。
  const capacityScopes = scopes(record.capacityScopes, capacities.length);
  if (capacityScopes.some((scope) => scope.length)) matrix.capacityScopes = capacityScopes;
  const packCountScopes = scopes(record.packCountScopes, packCounts.length);
  if (packCountScopes.some((scope) => scope.length)) matrix.packCountScopes = packCountScopes;
  return matrix;
}

/** 分类名清洗：trim、去空、去重、按上限截断；非字符串一律丢弃。 */
function scopeCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim().slice(0, BATTERY_SCOPE_CATEGORY_NAME_LIMIT);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
    if (result.length >= BATTERY_SCOPE_CATEGORY_LIMIT) break;
  }
  return result;
}

/** 逐行/逐列的可见范围：长度对齐维度；缺项补空数组（= 所有产品可见）。 */
function scopes(value: unknown, length: number): string[][] {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_item, index) => scopeCategories(list[index]));
}

/** 这一行/列是否在指定产品分类下可见：范围为空 = 通用，否则要求有交集。 */
export function batteryScopeVisible(scope: readonly string[] | undefined, productCategories: readonly string[]): boolean {
  if (!scope?.length) return true;
  const active = new Set(productCategories.map((item) => item.trim()).filter(Boolean));
  return scope.some((category) => active.has(category.trim()));
}

/**
 * 按产品分类裁剪矩阵：只保留该产品看得见的容量行与节数列，
 * 单元格价格按原行列位置搬过来。没设置可见范围的行列照常全部显示。
 */
export function batteryMatrixForProduct(matrix: BatteryPriceMatrix, productCategories: readonly string[]): BatteryPriceMatrix {
  const rowIndexes: number[] = [];
  matrix.capacities.forEach((_capacity, index) => {
    if (batteryScopeVisible(matrix.capacityScopes?.[index], productCategories)) rowIndexes.push(index);
  });
  const colIndexes: number[] = [];
  matrix.packCounts.forEach((_packCount, index) => {
    if (batteryScopeVisible(matrix.packCountScopes?.[index], productCategories)) colIndexes.push(index);
  });
  return {
    capacities: rowIndexes.map((index) => matrix.capacities[index]),
    packCounts: colIndexes.map((index) => matrix.packCounts[index]),
    prices: rowIndexes.map((rowIndex) => colIndexes.map((colIndex) => matrix.prices[rowIndex]?.[colIndex] ?? 0)),
    capacityScopes: rowIndexes.map((index) => matrix.capacityScopes?.[index] ?? []),
    packCountScopes: colIndexes.map((index) => matrix.packCountScopes?.[index] ?? []),
  };
}

export function batteryCellPrice(matrix: BatteryPriceMatrix, capacityIndex: number, packCountIndex: number): number {
  return matrix.prices[capacityIndex]?.[packCountIndex] ?? 0;
}

/** 矩阵取价：按「容量 × 节数」原样取；没定价（0 或缺格）时返回 null，矩阵表格显示 —。 */
export function batteryUnitPriceOf(matrix: BatteryPriceMatrix, capacity: number, packCount: number): number | null {
  const capacityIndex = matrix.capacities.indexOf(capacity);
  const packCountIndex = matrix.packCounts.indexOf(packCount);
  if (capacityIndex < 0 || packCountIndex < 0) return null;
  const price = batteryCellPrice(matrix, capacityIndex, packCountIndex);
  return price > 0 ? price : null;
}

/** 售价计算器的两种成套口径：一电一充 = 1 块电池 + 1 个充电器；两电一充 = 2 块 + 1 个。 */
export const BATTERY_COMBO_VARIANTS: ReadonlyArray<{ batteryCount: number; label: string }> = [
  { batteryCount: 1, label: '一电一充' },
  { batteryCount: 2, label: '两电一充' },
];

/** 电池选项名（与用户既有写法一致）：「5 节 1300 电池」。 */
export function batteryOptionName(capacity: number, packCount: number): string {
  return `${packCount} 节 ${capacity} 电池`;
}

/** 计算器可选项：只取已定价（>0）的单元格。 */
export function batteryMatrixOptions(matrix: BatteryPriceMatrix): Array<{ id: string; name: string; price: number }> {
  const options: Array<{ id: string; name: string; price: number }> = [];
  matrix.capacities.forEach((capacity, rowIndex) => {
    matrix.packCounts.forEach((packCount, colIndex) => {
      const price = batteryCellPrice(matrix, rowIndex, colIndex);
      if (price > 0) options.push({ id: `cell-${rowIndex}-${colIndex}`, name: batteryOptionName(capacity, packCount), price });
    });
  });
  return options;
}

const LEGACY_BATTERY_PATTERN = /^(\d+)\s*节\s*(\d{3,6})$/;

/**
 * 迁移播种：默认模板打底，再把旧「全局配件」清单里的电池条目（如「5 节 1300」¥11）
 * 按「N 节 M」解析进对应单元格；解析不出的条目不进矩阵。
 */
export function buildBatteryMatrixSeed(legacy: Array<{ name: string; price: number }>): BatteryPriceMatrix {
  const capacities = [...BATTERY_MATRIX_DEFAULTS.capacities];
  const packCounts = [...BATTERY_MATRIX_DEFAULTS.packCounts];
  const prices: number[][] = BATTERY_MATRIX_DEFAULTS.capacities.map((_capacity, rowIndex) =>
    BATTERY_MATRIX_DEFAULTS.prices[rowIndex].slice());
  for (const item of legacy) {
    const matched = item.name.trim().match(LEGACY_BATTERY_PATTERN);
    if (!matched) continue;
    const packCount = Number(matched[1]);
    const capacity = Number(matched[2]);
    if (!capacities.includes(capacity)) {
      if (capacities.length >= BATTERY_MATRIX_MAX_DIM) continue;
      capacities.push(capacity);
      prices.push(new Array(packCounts.length).fill(0));
    }
    if (!packCounts.includes(packCount)) {
      if (packCounts.length >= BATTERY_MATRIX_MAX_DIM) continue;
      packCounts.push(packCount);
      for (const row of prices) row.push(0);
    }
    const rowIndex = capacities.indexOf(capacity);
    const colIndex = packCounts.indexOf(packCount);
    prices[rowIndex][colIndex] = Math.max(0, Math.round(Number(item.price) * 100) / 100);
  }
  return { capacities, packCounts, prices };
}
