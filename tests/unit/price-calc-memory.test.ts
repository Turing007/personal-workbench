import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MARKUP_PERCENT,
  rememberedMarkup,
  rememberedShippingUnitPrice,
  rememberMarkup,
  rememberShippingUnitPrice,
} from '../../src/client/price-calc-memory';
import { DEFAULT_SHIPPING_UNIT_PRICE } from '../../src/shared/price-calculator';

/** 最小 localStorage 替身；store 用来直接检查写进去的值。
 *  模块里引用的是全局 localStorage，所以 window 与 globalThis 都要替换
 *  —— 只 stub window 时，Node 环境读到的仍是另一个对象，写入读不回。 */
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
  vi.stubGlobal('window', { localStorage });
  vi.stubGlobal('localStorage', localStorage);
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('售价计算器的输入记忆', () => {
  it('毛利率：没存过用默认 20%，存过就回读', () => {
    stubStorage();
    expect(rememberedMarkup()).toBe(DEFAULT_MARKUP_PERCENT);
    expect(DEFAULT_MARKUP_PERCENT).toBe('20');
    rememberMarkup('35');
    expect(rememberedMarkup()).toBe('35');
  });

  it('运费单价：没存过用默认 1.5，存过就回读', () => {
    stubStorage();
    expect(rememberedShippingUnitPrice()).toBe(String(DEFAULT_SHIPPING_UNIT_PRICE));
    rememberShippingUnitPrice('2.8');
    expect(rememberedShippingUnitPrice()).toBe('2.8');
  });

  it('运费单价只记正数：清空或半途输入不覆盖已有记忆', () => {
    const store = stubStorage({ 'price-calc-shipping-unit': '2.5' });
    rememberShippingUnitPrice('');
    rememberShippingUnitPrice('0');
    rememberShippingUnitPrice('-3');
    rememberShippingUnitPrice('abc');
    // 半途状态（如「1.」）数值上是 1，但用户还没输完；这里按合法值记下，
    // 真正要防的是清空与负数把记忆抹掉。
    expect(store.get('price-calc-shipping-unit')).toBe('2.5');
  });

  it('存过脏值的运费单价：读取时回落默认，不让脏值进计算', () => {
    for (const dirty of ['', '0', '-1', 'abc', 'NaN']) {
      stubStorage({ 'price-calc-shipping-unit': dirty });
      expect(rememberedShippingUnitPrice()).toBe(String(DEFAULT_SHIPPING_UNIT_PRICE));
    }
  });

  it('localStorage 不可用（隐私模式）时静默回落默认值，不抛错', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(rememberedMarkup()).toBe(DEFAULT_MARKUP_PERCENT);
    expect(rememberedShippingUnitPrice()).toBe(String(DEFAULT_SHIPPING_UNIT_PRICE));
    expect(() => rememberMarkup('30')).not.toThrow();
    expect(() => rememberShippingUnitPrice('2')).not.toThrow();
  });

  it('写入失败不抛错（配额满等）', () => {
    const localStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    vi.stubGlobal('window', { localStorage });
    vi.stubGlobal('localStorage', localStorage);
    expect(() => rememberShippingUnitPrice('3')).not.toThrow();
  });
});
