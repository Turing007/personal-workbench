import type { FastifyInstance } from 'fastify';
import { renderCatalogUnavailablePage, renderPublicCatalogPage } from '../documents/public-catalog-template.js';
import type { CatalogService } from '../services/catalog-service.js';
import type { ThumbnailService } from '../files/thumbnail-service.js';
import type { FileStore } from '../files/file-store.js';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

interface PublicCatalogRouteOptions {
  service: CatalogService;
  thumbnailService?: ThumbnailService;
  fileStore?: FileStore;
}

/**
 * 在线图册的公开访问：链接里带随机 token，知道链接即可查看，不需要登录。
 * 这些路径不在 /api、/files 之下，天然不过登录门；token 就是唯一凭证，
 * 停用后同一链接立即 404。页面上只出现客户版字段（供应商与价格在服务端就被剥离）。
 */
export async function registerPublicCatalogRoutes(app: FastifyInstance, options: PublicCatalogRouteOptions): Promise<void> {
  const { service, thumbnailService, fileStore } = options;

  app.get('/c/:token', async (request, reply) => {
    const token = String((request.params as { token?: string }).token ?? '');
    const data = service.getPublic(token);
    if (!data) {
      return reply.status(404).type('text/html; charset=utf-8').send(renderCatalogUnavailablePage());
    }
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(renderPublicCatalogPage(data));
  });

  app.get('/c/:token/img/:productId', async (request, reply) => {
    const { token, productId } = request.params as { token: string; productId: string };
    if (!thumbnailService) return reply.status(404).send();
    const size = (request.query as { size?: string }).size === '960' ? 960 : 480;
    const relativePath = service.getPublicImagePath(token, Number(productId));
    if (!relativePath) return reply.status(404).send();
    try {
      const image = await thumbnailService.get(size, relativePath);
      return reply.type('image/webp').header('Cache-Control', 'public, max-age=86400').send(image);
    } catch {
      return reply.status(404).send();
    }
  });

  app.get('/c/:token/:asset', async (request, reply) => {
    const { token, asset } = request.params as { token: string; asset: string };
    if (asset !== 'logo' && asset !== 'qr') return reply.status(404).send();
    if (!fileStore) return reply.status(404).send();
    const relativePath = service.resolveAsset(token, asset);
    if (!relativePath) return reply.status(404).send();
    try {
      const bytes = await fileStore.readFile(relativePath);
      const extension = relativePath.split('.').pop()?.toLowerCase() ?? '';
      return reply
        .type(MIME_BY_EXTENSION[extension] ?? 'application/octet-stream')
        .header('Cache-Control', 'public, max-age=3600')
        .send(bytes);
    } catch {
      return reply.status(404).send();
    }
  });
}
