import { rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp, { type Metadata } from 'sharp';

/** 压缩目标：长边不超过 2048（A4 300dpi 打印也够），质量 80，格式保持不变。 */
export const IMAGE_MAX_EDGE = 2048;
export const IMAGE_QUALITY = 80;
/** 长边已达标且小于这个体积的图不再重压：避免为省几十 KB 反复掉画质。 */
export const IMAGE_SKIP_UNDER_BYTES = 400 * 1024;

export type CompressReason = 'compressed' | 'already-small' | 'unsupported' | 'not-worth-it';

export interface CompressResult {
  /** 无需重压时为 null，调用方保持原文件不动。 */
  buffer: Buffer | null;
  width: number;
  height: number;
  reason: CompressReason;
}

/**
 * 把图片重采样到长边 `IMAGE_MAX_EDGE`。
 * 只处理静态 JPEG/PNG/WebP；GIF（可能带动画）、TIFF 等一律原样保留。
 */
export async function compressImageBuffer(source: Buffer): Promise<CompressResult> {
  let metadata: Metadata;
  try {
    metadata = await sharp(source, { failOn: 'none' }).metadata();
  } catch {
    return { buffer: null, width: 0, height: 0, reason: 'unsupported' };
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const format = metadata.format;
  // 动图（多页 WebP/PNG）重编码会只剩第一帧，直接放过。
  if (!format || !['jpeg', 'png', 'webp'].includes(format) || (metadata.pages ?? 1) > 1) {
    return { buffer: null, width, height, reason: 'unsupported' };
  }
  const longestEdge = Math.max(width, height);
  if (longestEdge <= IMAGE_MAX_EDGE && source.length <= IMAGE_SKIP_UNDER_BYTES) {
    return { buffer: null, width, height, reason: 'already-small' };
  }

  let pipeline = sharp(source, { failOn: 'none' }).rotate();
  if (longestEdge > IMAGE_MAX_EDGE) {
    pipeline = pipeline.resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true });
  }
  const output = await pipeline
    .toFormat(format === 'png' ? 'png' : 'jpeg', format === 'png' ? {} : { quality: IMAGE_QUALITY, mozjpeg: true })
    .toBuffer();

  // 重压反而更大（小图、已高度压缩过的图常见）就别动原文件。
  if (output.length >= source.length) {
    return { buffer: null, width, height, reason: 'not-worth-it' };
  }
  return { buffer: output, width, height, reason: 'compressed' };
}

/**
 * 就地压缩单个文件：先写临时文件再 rename 覆盖，
 * 保证任意时刻磁盘上要么是旧文件、要么是新文件，不会出现半张图。
 */
export async function compressImageFile(directory: string, fileName: string): Promise<{ savedBytes: number; reason: CompressReason }> {
  const path = join(directory, fileName);
  let source: Buffer;
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) return { savedBytes: 0, reason: 'unsupported' };
    const { readFile } = await import('node:fs/promises');
    source = await readFile(path);
  } catch {
    return { savedBytes: 0, reason: 'unsupported' };
  }
  const result = await compressImageBuffer(source);
  if (!result.buffer) return { savedBytes: 0, reason: result.reason };

  await writeFile(join(directory, `${fileName}.compressing`), result.buffer);
  await rename(join(directory, `${fileName}.compressing`), path);
  return { savedBytes: source.length - result.buffer.length, reason: 'compressed' };
}
