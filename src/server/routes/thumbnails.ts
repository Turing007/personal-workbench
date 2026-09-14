import type { FastifyInstance } from 'fastify';
import { FileStoreError } from '../files/file-store.js';
import { ThumbnailService, isResizableImage, isThumbnailSize } from '../files/thumbnail-service.js';
import { ApiError } from './api-response.js';

export interface ThumbnailRouteOptions {
  service: ThumbnailService;
}

/**
 * 缩略图路由：`GET /api/thumbs/:size/<相对路径>`（登录后可访问）。
 * 图片类附件返回 WebP 小图，非图片文件返回 415，客户端应回退到 /files/ 原地址。
 */
export async function registerThumbnailRoutes(app: FastifyInstance, options: ThumbnailRouteOptions): Promise<void> {
  app.get('/api/thumbs/:size/*', async (request, reply) => {
    const params = request.params as { size?: string; '*': string };
    const relativePath = params['*'] ?? '';
    if (!isThumbnailSize(params.size)) {
      throw new ApiError(400, 'INVALID_THUMBNAIL_SIZE', '缩略图尺寸无效');
    }
    if (!isResizableImage(relativePath)) {
      throw new ApiError(415, 'THUMBNAIL_UNSUPPORTED', '该文件不支持缩略图');
    }

    let image: Buffer;
    try {
      image = await options.service.get(Number(params.size) as 240 | 480 | 960, relativePath);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof FileStoreError) {
        // 路径穿越等非法路径按 400 处理，其余存储错误交给上层映射。
        throw new ApiError(error.code.startsWith('INVALID_') ? 400 : 500, error.code, error.message);
      }
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new ApiError(404, 'FILE_NOT_FOUND', '附件不存在');
      }
      throw error;
    }

    return reply
      .header('Content-Type', 'image/webp')
      // 文件名带 UUID、内容不变，可长期缓存；私有缓存避免被共享代理留存。
      .header('Cache-Control', 'private, max-age=2592000, immutable')
      .send(image);
  });
}
