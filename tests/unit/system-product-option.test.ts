import { describe, expect, it } from 'vitest';
import { formatPurchasePrice, systemProductImageUrl } from '../../src/client/components/SystemProductOptionRow';

describe('系统产品选择行', () => {
  it('采购价：数字与数字字符串统一两位小数，空值整段不排', () => {
    expect(formatPurchasePrice(168.5)).toBe('¥ 168.50');
    expect(formatPurchasePrice('168.5')).toBe('¥ 168.50');
    expect(formatPurchasePrice('235')).toBe('¥ 235.00');
    expect(formatPurchasePrice(null)).toBe('');
    expect(formatPurchasePrice(undefined)).toBe('');
    expect(formatPurchasePrice('  ')).toBe('');
    // 非纯数字（历史脏数据）原样带出，不静默吞掉
    expect(formatPurchasePrice('面议')).toBe('¥ 面议');
    expect(formatPurchasePrice(Number.NaN)).toBe('');
  });

  it('缩略图：相对路径拼 /files，已是 /files 地址走缩略图服务；无图返回 undefined', () => {
    expect(systemProductImageUrl([{ url: '/files/product-images/a.jpg' }])).toBe('/api/thumbs/240/product-images/a.jpg');
    expect(systemProductImageUrl([{ relativePath: 'product-images/b.jpg' }])).toBe('/api/thumbs/240/product-images/b.jpg');
    expect(systemProductImageUrl([])).toBeUndefined();
    expect(systemProductImageUrl(undefined)).toBeUndefined();
  });
});
