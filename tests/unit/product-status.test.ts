import { describe, expect, it } from 'vitest';
import { normalizeProductStatus } from '../../src/shared/product-status';

describe('normalizeProductStatus', () => {
  it('三个已知值原样保留', () => {
    expect(normalizeProductStatus('draft')).toBe('draft');
    expect(normalizeProductStatus('active')).toBe('active');
    expect(normalizeProductStatus('discontinued')).toBe('discontinued');
  });

  // 停售是新加的值：老数据、写坏的值或老客户端传来的空值都不能让产品从筛选里消失，统一兜成在售。
  it('未知值与空值兜成在售', () => {
    expect(normalizeProductStatus(undefined)).toBe('active');
    expect(normalizeProductStatus(null)).toBe('active');
    expect(normalizeProductStatus('')).toBe('active');
    expect(normalizeProductStatus('archived')).toBe('active');
    expect(normalizeProductStatus(1)).toBe('active');
  });
});
