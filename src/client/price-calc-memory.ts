/**
 * 售价计算器的输入记忆：毛利率与运费单价存在 localStorage，下次打开接着用。
 *
 * 两个键分开存、互不影响；任何一步失败（隐私模式、配额满、存了脏值）都只是
 * 回落到默认值，不抛错、不打断计算 —— 记忆是体验优化，不是功能前提。
 */

import { DEFAULT_SHIPPING_UNIT_PRICE } from '../shared/price-calculator';

const MARKUP_MEMORY_KEY = 'price-calc-markup';
const SHIPPING_UNIT_MEMORY_KEY = 'price-calc-shipping-unit';

/** 毛利率默认 20%（首次使用、或记忆读不出来时）。 */
export const DEFAULT_MARKUP_PERCENT = '20';

export function rememberedMarkup(): string {
  try {
    return localStorage.getItem(MARKUP_MEMORY_KEY) ?? DEFAULT_MARKUP_PERCENT;
  } catch {
    return DEFAULT_MARKUP_PERCENT;
  }
}

export function rememberMarkup(value: string): void {
  try {
    localStorage.setItem(MARKUP_MEMORY_KEY, value);
  } catch {
    // 记忆失败不影响本次计算。
  }
}

/**
 * 记住的运费单价：读不出来、或存过脏值（空/非数字/非正）时回落默认 1.5。
 * 校验放在读取侧，脏值不会进到计算里。
 */
export function rememberedShippingUnitPrice(): string {
  try {
    const stored = localStorage.getItem(SHIPPING_UNIT_MEMORY_KEY);
    if (stored != null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed) && parsed > 0) return stored;
    }
  } catch {
    // 读不到 localStorage（隐私模式等）：用默认值，不影响使用。
  }
  return String(DEFAULT_SHIPPING_UNIT_PRICE);
}

/**
 * 记住运费单价：只在值合法（正数）时写入 —— 清空输入或半途状态（如「1.」）
 * 不覆盖已有记忆。与毛利率不同，改了就记、不必先保存方案：单价跨产品通用。
 */
export function rememberShippingUnitPrice(value: string): void {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return;
  try {
    localStorage.setItem(SHIPPING_UNIT_MEMORY_KEY, value);
  } catch {
    // 记忆失败不影响本次计算。
  }
}
