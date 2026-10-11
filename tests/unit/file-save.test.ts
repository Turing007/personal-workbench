import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../../src/client/file-save';

describe('bytesToBase64：App 导出文件分块编码', () => {
  it('与 Buffer 的 base64 输出一致，含 32KB 分段边界', () => {
    for (const size of [0, 1, 5, 0x7fff, 0x8000, 0x8001, 200_000]) {
      const bytes = new Uint8Array(size);
      for (let index = 0; index < size; index += 1) bytes[index] = (index * 31 + 7) % 256;
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('高字节（>127）不会被破坏', () => {
    const bytes = new Uint8Array([0x00, 0x7f, 0x80, 0xff, 0xfe, 0x01]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});
