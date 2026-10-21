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
  /** 每一容量行是否对所有产品隐藏，与 capacities 同序；缺项 = 显示。 */
  capacityHidden?: boolean[];
  /** 每一节数列是否对所有产品隐藏，与 packCounts 同序；缺项 = 显示。 */
  packCountHidden?: boolean[];
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
  const matrix: BatteryPriceMatrix = { capacities, packCounts, prices };
  // 隐藏标记只在确实有隐藏项时才写出：老数据保持原来的形状，读出来不会凭空多两项。
  const legacy = record as { capacityScopes?: unknown; packCountScopes?: unknown };
  const capacityHidden = hiddenFlags(record.capacityHidden, legacy.capacityScopes, capacities.length);
  if (capacityHidden.some(Boolean)) matrix.capacityHidden = capacityHidden;
  const packCountHidden = hiddenFlags(record.packCountHidden, legacy.packCountScopes, packCounts.length);
  if (packCountHidden.some(Boolean)) matrix.packCountHidden = packCountHidden;
  return matrix;
}

/**
 * 逐行/逐列的隐藏标记：长度对齐维度，缺项 = 显示。
 * 兼容刚上线过的「按类目限定」数据：非空的分类范围按「关闭眼睛」迁移为全局隐藏。
 */
function hiddenFlags(value: unknown, legacyScopes: unknown, length: number): boolean[] {
  const list = Array.isArray(value) ? value : [];
  const legacy = Array.isArray(legacyScopes) ? legacyScopes : [];
  return Array.from({ length }, (_item, index) => (
    typeof list[index] === 'boolean'
      ? list[index] as boolean
      : Array.isArray(legacy[index]) && (legacy[index] as unknown[]).length > 0
  ));
}

/** 计算器用的矩阵：去掉全局隐藏的容量行与节数列，单元格价格按剩余行列重新对齐。 */
export function batteryMatrixVisible(matrix: BatteryPriceMatrix): BatteryPriceMatrix {
  const rowIndexes = matrix.capacities.map((_capacity, index) => index).filter((index) => !matrix.capacityHidden?.[index]);
  const colIndexes = matrix.packCounts.map((_packCount, index) => index).filter((index) => !matrix.packCountHidden?.[index]);
  return {
    capacities: rowIndexes.map((index) => matrix.capacities[index]!),
    packCounts: colIndexes.map((index) => matrix.packCounts[index]!),
    prices: rowIndexes.map((rowIndex) => colIndexes.map((colIndex) => matrix.prices[rowIndex]?.[colIndex] ?? 0)),
  };
}

function moved<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function canMove(length: number, from: number, to: number): boolean {
  return Number.isInteger(from) && Number.isInteger(to)
    && from >= 0 && to >= 0 && from < length && to < length && from !== to;
}

/** 上移/下移容量行：价格行与隐藏标记跟着一起移动。非法位置原样返回。 */
export function moveBatteryCapacity(matrix: BatteryPriceMatrix, from: number, to: number): BatteryPriceMatrix {
  if (!canMove(matrix.capacities.length, from, to)) return matrix;
  return {
    ...matrix,
    capacities: moved(matrix.capacities, from, to),
    prices: moved(matrix.prices, from, to),
    ...(matrix.capacityHidden ? { capacityHidden: moved(matrix.capacityHidden, from, to) } : {}),
  };
}

/** 左移/右移节数列：每一行的价格单元格与隐藏标记跟着一起移动。非法位置原样返回。 */
export function moveBatteryPackCount(matrix: BatteryPriceMatrix, from: number, to: number): BatteryPriceMatrix {
  if (!canMove(matrix.packCounts.length, from, to)) return matrix;
  return {
    ...matrix,
    packCounts: moved(matrix.packCounts, from, to),
    prices: matrix.prices.map((row) => moved(row, from, to)),
    ...(matrix.packCountHidden ? { packCountHidden: moved(matrix.packCountHidden, from, to) } : {}),
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
