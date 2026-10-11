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
}

export const BATTERY_MATRIX_MAX_DIM = 12;

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
  return { capacities, packCounts, prices };
}

export function batteryCellPrice(matrix: BatteryPriceMatrix, capacityIndex: number, packCountIndex: number): number {
  return matrix.prices[capacityIndex]?.[packCountIndex] ?? 0;
}

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
