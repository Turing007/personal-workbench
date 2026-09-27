import { describe, expect, it } from 'vitest';
import {
  PURCHASE_QUOTE_LIMIT,
  blankPurchaseQuote,
  defaultPurchaseQuote,
  groupPurchaseQuotesBySupplier,
  mapStoredPurchaseQuotes,
  normalizePurchaseQuotes,
  purchaseQuoteLabel,
  purchaseQuoteMirror,
} from '../../src/shared/product-purchase-quotes';

const row = (supplier: string, variant: string, price: string, isDefault = false) => ({ supplier, variant, price, isDefault });

describe('normalizePurchaseQuotes', () => {
  it('三个格子全空的行丢掉，超出上限截断', () => {
    const many = Array.from({ length: PURCHASE_QUOTE_LIMIT + 5 }, (_, index) => row(`供应商${index}`, '', '10'));
    const result = normalizePurchaseQuotes([...many, row('', '', ''), null]);
    expect(result).toHaveLength(PURCHASE_QUOTE_LIMIT);
    expect(result.every((quote) => quote.supplier || quote.variant || quote.price)).toBe(true);
  });

  it('一条默认都没标时第一行当默认；标了多个默认时只留第一个', () => {
    expect(normalizePurchaseQuotes([row('A', '有刷', '120'), row('B', '无刷', '140')])[0].isDefault).toBe(true);
    const doubled = normalizePurchaseQuotes([row('A', '有刷', '120', true), row('B', '无刷', '140', true)]);
    expect(doubled.map((quote) => quote.isDefault)).toEqual([true, false]);
  });

  it('价格只接受正数，0、负数、乱码一律当未定价', () => {
    const result = normalizePurchaseQuotes([row('A', '甲', '0'), row('B', '乙', '-5'), row('C', '丙', 'abc'), row('D', '丁', '137.5')]);
    expect(result.map((quote) => quote.price)).toEqual(['', '', '', '137.5']);
  });

  it('接受服务端读回来的 0/1 默认标记，并把数字价格转成字符串', () => {
    const result = mapStoredPurchaseQuotes([{ id: 7, supplier: '德艺堡', variant: '', price: 120.5, isDefault: 1 }]);
    expect(result[0]).toEqual({ id: '7', supplier: '德艺堡', variant: '', price: '120.5', isDefault: true });
  });

  it('读库映射不丢行，哪怕供应商与名目都为空（那是历史占位档）', () => {
    expect(mapStoredPurchaseQuotes([row('', '', '0')])).toHaveLength(1);
  });

  it('供应商与名目按长度截断，避免脏数据撑破表格', () => {
    const [quote] = normalizePurchaseQuotes([row('超'.repeat(60), '名'.repeat(60), '10')]);
    expect(quote.supplier).toHaveLength(40);
    expect(quote.variant).toHaveLength(40);
  });
});

describe('默认档与镜像列', () => {
  it('默认档的供应商与价格就是 products 表要写的值', () => {
    const quotes = normalizePurchaseQuotes([row('德艺堡', '有刷', '120'), row('良景', '无刷', '140', true)]);
    expect(purchaseQuoteMirror(quotes)).toEqual({ supplier: '良景', purchasePrice: '140' });
    expect(defaultPurchaseQuote(quotes)?.variant).toBe('无刷');
  });

  it('一条报价都没有时镜像回落到空值', () => {
    expect(purchaseQuoteMirror([])).toEqual({ supplier: '', purchasePrice: '' });
    expect(defaultPurchaseQuote([])).toBeUndefined();
  });
});

describe('展示辅助', () => {
  it('标题优先名目，其次供应商，都空则「默认报价」', () => {
    expect(purchaseQuoteLabel({ ...blankPurchaseQuote(), variant: '含配件', supplier: '德艺堡' })).toBe('含配件');
    expect(purchaseQuoteLabel({ ...blankPurchaseQuote(), supplier: '德艺堡' })).toBe('德艺堡');
    expect(purchaseQuoteLabel({ ...blankPurchaseQuote(), price: '120' })).toBe('默认报价');
  });

  it('按供应商分组，组内保持原顺序，没填供应商的归一组', () => {
    const groups = groupPurchaseQuotesBySupplier(normalizePurchaseQuotes([
      row('德艺堡', '有刷', '120', true),
      row('良景', '含配件', '135'),
      row('德艺堡', '无刷', '140'),
      row('', '裸机', '100'),
    ]));
    expect(groups.map((group) => group.supplier)).toEqual(['德艺堡', '良景', '未填供应商']);
    expect(groups[0].quotes.map((quote) => quote.variant)).toEqual(['有刷', '无刷']);
  });
});
