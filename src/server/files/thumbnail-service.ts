import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { ApiError } from '../routes/api-response.js';
import type { FileStore } from './file-store.js';

/** 列表/缩略图可用的尺寸（原图不动，缩略图单独缓存）。 */
export const THUMBNAIL_SIZES = [240, 480, 960] as const;
export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number];

const IMAGE_FILE_PATTERN = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;

export function isThumbnailSize(value: unknown): value is ThumbnailSize {
  return THUMBNAIL_SIZES.includes(Number(value) as ThumbnailSize);
}

/** PDF 等非图片文件没有缩略图，调用方应回退到原文件地址。 */
export function isResizableImage(relativePath: string): boolean {
  return IMAGE_FILE_PATTERN.test(relativePath);
}

/**
 * 生成并缓存缩略图：手机端列表只加载小图，避免一次传输几十 MB 原图。
 * 缓存目录默认在数据目录下、但不属于 files/，因此不会被打进备份 ZIP。
 */
export class ThumbnailService {
  constructor(
    private readonly fileStore: FileStore,
    private readonly cacheDirectory: string,
  ) {}

  private cachePath(size: ThumbnailSize, relativePath: string): string {
    return join(this.cacheDirectory, String(size), `${relativePath}.webp`);
  }

  async get(size: ThumbnailSize, relativePath: string): Promise<Buffer> {
    const cachePath = this.cachePath(size, relativePath);
    const originalPath = this.fileStore.resolvePublicPath(relativePath);

    try {
      const [cacheStat, originalStat] = await Promise.all([stat(cachePath), stat(originalPath)]);
      // 缓存比原图新即可复用（原图不会被就地修改，这里只是保守判断）。
      if (cacheStat.mtimeMs >= originalStat.mtimeMs) return await readFile(cachePath);
    } catch {
      // 缓存缺失或原图不存在：继续走下面的生成流程（原图缺失会在读取时抛错）。
    }

    const source = await this.fileStore.readFile(relativePath);
    let output: Buffer;
    try {
      output = await sharp(source, { failOn: 'none' })
        .rotate()
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();
    } catch {
      throw new ApiError(415, 'THUMBNAIL_UNSUPPORTED', '该文件无法生成缩略图');
    }

    await mkdir(dirname(cachePath), { recursive: true });
    // 缓存写入失败不影响本次返回。
    await writeFile(cachePath, output).catch(() => undefined);
    return output;
  }
}
