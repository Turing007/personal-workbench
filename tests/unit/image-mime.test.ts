import { describe, expect, it } from 'vitest';
import { normalizeUploadImage, resolveUploadImageMime } from '../../src/client/image-mime';

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const TEXT_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3];

function file(name: string, type: string, bytes: number[] = JPEG_HEAD): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('手机端图片上传的类型识别', () => {
  it('file.type 为空时按扩展名兜底，并回写正确的 Content-Type', async () => {
    const result = await normalizeUploadImage(file('IMG_20260918.jpg', '', JPEG_HEAD));
    expect(result?.type).toBe('image/jpeg');
    expect(result?.name).toBe('IMG_20260918.jpg');
  });

  it('application/octet-stream 的 png 也能识别', async () => {
    const result = await normalizeUploadImage(file('截图.png', 'application/octet-stream', PNG_HEAD));
    expect(result?.type).toBe('image/png');
  });

  it('没有扩展名时按文件头识别 webp', async () => {
    const result = await normalizeUploadImage(file('download', '', WEBP_HEAD));
    expect(result?.type).toBe('image/webp');
    expect(result?.name).toBe('download');
  });

  it('类型已经正确时原样返回同一个文件对象', async () => {
    const source = file('a.png', 'image/png', PNG_HEAD);
    expect(await normalizeUploadImage(source)).toBe(source);
  });

  it('image/jpg 这类不规范写法按扩展名纠正为 image/jpeg', async () => {
    expect(await resolveUploadImageMime(file('a.jpg', 'image/jpg', JPEG_HEAD))).toBe('image/jpeg');
  });

  it('HEIC/GIF 等后端不支持的格式返回 undefined，避免静默通过', async () => {
    expect(await resolveUploadImageMime(file('IMG_0001.HEIC', 'image/heic', TEXT_HEAD))).toBeUndefined();
    expect(await resolveUploadImageMime(file('a.gif', 'image/gif', TEXT_HEAD))).toBeUndefined();
  });

  it('既没有类型也没有扩展名、文件头也不认识时返回 undefined', async () => {
    expect(await resolveUploadImageMime(file('mystery', 'application/octet-stream', TEXT_HEAD))).toBeUndefined();
  });

  it('文件名带路径或大写扩展名也能识别', async () => {
    expect(await resolveUploadImageMime(file('C:\\DCIM\\Camera\\A.JPEG', '', JPEG_HEAD))).toBe('image/jpeg');
  });
});
