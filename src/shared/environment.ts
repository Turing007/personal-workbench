/** 本机测试实例与线上服务器的区分标记，服务端与前端共用同一套判定。 */
export type WorkbenchEnvironment = 'test' | 'production';

/**
 * 只有显式写成 production 才算线上；空值、拼错、未知取值一律按 test 处理。
 * 宁可多显示一个测试横条，也不能让测试实例冒充线上 —— 方向错了就是拿错库录数据。
 */
export function normalizeEnvironment(raw: string | undefined): WorkbenchEnvironment {
  return (raw ?? '').trim().toLowerCase() === 'production' ? 'production' : 'test';
}
