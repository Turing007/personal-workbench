import { describe, expect, it } from 'vitest';
import { normalizeEnvironment } from '../../src/shared/environment';

// 方向性很重要：只有明确写成 production 才算线上，其余一切（包括没设、拼错）
// 都按测试端处理 —— 判错的代价是拿线上库当测试环境改，或者反过来。
describe('环境归一化', () => {
  it('只在明确写 production 时判为线上', () => {
    expect(normalizeEnvironment('production')).toBe('production');
    expect(normalizeEnvironment('PRODUCTION')).toBe('production');
    expect(normalizeEnvironment('  Production  ')).toBe('production');
  });

  it('未设置、空值与 test 都判为测试端', () => {
    expect(normalizeEnvironment(undefined)).toBe('test');
    expect(normalizeEnvironment('')).toBe('test');
    expect(normalizeEnvironment('   ')).toBe('test');
    expect(normalizeEnvironment('test')).toBe('test');
  });

  it('拼错或未知取值一律落回测试端，绝不误判成线上', () => {
    expect(normalizeEnvironment('prod')).toBe('test');
    expect(normalizeEnvironment('prodction')).toBe('test');
    expect(normalizeEnvironment('staging')).toBe('test');
    expect(normalizeEnvironment('1')).toBe('test');
  });
});
