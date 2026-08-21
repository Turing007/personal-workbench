import { describe, expect, it } from 'vitest';
import { dateInputValue, dateOnlyValue } from '../../src/shared/date-input';

describe('日期输入值', () => {
  it('新订单使用浏览器本地日期，不经过 UTC 转换', () => {
    expect(dateInputValue(new Date(2026, 7, 11, 0, 5))).toBe('2026-08-11');
  });

  it('历史 ISO 日期只取日期部分', () => {
    expect(dateOnlyValue('2026-08-10T08:00:00.000Z')).toBe('2026-08-10');
    expect(dateOnlyValue('2026-08-10')).toBe('2026-08-10');
  });

  it('空值使用传入的本地当前日期', () => {
    expect(dateInputValue(undefined, new Date(2026, 7, 11, 23, 59))).toBe('2026-08-11');
  });
});
