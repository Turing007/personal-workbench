import type { BatteryPriceMatrix } from '../shared/battery-prices';
import type { AccessoryPrice } from '../shared/accessory-prices';

/**
 * 全局计价设置缓存（电池矩阵 / 充电器 / 体积参数）。
 * 报价明细弹窗反复打开时不再重复拉取；api 层保存成功即写入新值，
 * 设置页/计算器的修改立即生效。60 秒 TTL 兜底跨标签页修改的过期窗口。
 */
const TTL_MS = 60_000;

interface Entry<T> {
  value: T;
  at: number;
}

let matrix: Entry<BatteryPriceMatrix> | undefined;
let chargers: Entry<AccessoryPrice[]> | undefined;
let divisor: Entry<number> | undefined;

function fresh<T>(entry: Entry<T> | undefined): T | undefined {
  return entry && Date.now() - entry.at < TTL_MS ? entry.value : undefined;
}

export const pricingSettingsCache = {
  matrix: (): BatteryPriceMatrix | undefined => fresh(matrix),
  setMatrix: (value: BatteryPriceMatrix) => { matrix = { value, at: Date.now() }; },
  chargers: (): AccessoryPrice[] | undefined => fresh(chargers),
  setChargers: (value: AccessoryPrice[]) => { chargers = { value, at: Date.now() }; },
  divisor: (): number | undefined => fresh(divisor),
  setDivisor: (value: number) => { divisor = { value, at: Date.now() }; },
};