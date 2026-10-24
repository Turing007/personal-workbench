/**
 * 产品电池电压：决定售价计算器/在线图册里显示哪些电池节数列。
 * 口径（用户定义）：3 节 = 12V，4 节 = 16.8V，5 节及以上 = 21V（5/10/15/20 节都是 21V）。
 */

export type BatteryVoltage = '12V' | '16.8V' | '21V';

export const BATTERY_VOLTAGE_OPTIONS: ReadonlyArray<{ value: BatteryVoltage; label: string; hint: string }> = [
  { value: '12V', label: '12V', hint: '3 节电池' },
  { value: '16.8V', label: '16.8V', hint: '4 节电池' },
  { value: '21V', label: '21V', hint: '5 节及以上电池' },
];

export const DEFAULT_BATTERY_VOLTAGE: BatteryVoltage = '21V';

export function normalizeBatteryVoltage(value: unknown): BatteryVoltage {
  return BATTERY_VOLTAGE_OPTIONS.some((option) => option.value === value)
    ? value as BatteryVoltage
    : DEFAULT_BATTERY_VOLTAGE;
}

/** 电池包节数对应的电压：3 节 12V、4 节 16.8V、5 节及以上 21V。 */
export function batteryVoltageForPackCount(packCount: unknown): BatteryVoltage {
  const count = Math.trunc(Number(packCount));
  if (count === 3) return '12V';
  if (count === 4) return '16.8V';
  return '21V';
}

/** 该节数的电池包是否适配产品电压。 */
export function packCountMatchesVoltage(packCount: unknown, voltage: unknown): boolean {
  return batteryVoltageForPackCount(packCount) === normalizeBatteryVoltage(voltage);
}
