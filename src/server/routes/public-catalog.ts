import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { renderCatalogUnavailablePage, renderPublicCatalogPage } from '../documents/public-catalog-template.js';
import { renderCatalogQuoteErrorPage, renderCatalogQuoteHtml } from '../documents/catalog-quote-template.js';
import { PdfRenderer } from '../documents/pdf-renderer.js';
import type { CatalogService, PublicCatalogQuoteItem } from '../services/catalog-service.js';
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
  pdfRenderer?: Pick<PdfRenderer, 'render'>;
}

/** 购物车导出链接的 items 参数：`产品ID:数量[:备注base64url]`，多个产品用逗号分隔；非法片段直接跳过。 */
function parseQuoteItems(raw: string | undefined): PublicCatalogQuoteItem[] {
  if (!raw) return [];
  const items: PublicCatalogQuoteItem[] = [];
  for (const part of raw.split(',')) {
    const match = /^(\d{1,12})[:x](\d{1,4})(?::([A-Za-z0-9_-]{0,1024}))?$/.exec(part.trim());
    if (!match) continue;
    const productId = Number(match[1]);
    const quantity = Number(match[2]);
    if (!Number.isSafeInteger(productId) || productId <= 0) continue;
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 9999) continue;
    let note = '';
    if (match[3]) {
      try { note = Buffer.from(match[3], 'base64url').toString('utf8').trim().slice(0, 120); } catch { note = ''; }
    }
    items.push({ productId, quantity, ...(note ? { note } : {}) });
    if (items.length >= 500) break;
  }
  return items;
}

/** Logo 内联成 data URL：PDF 渲染不加载外部资源，避免多等一次网络请求。 */
async function logoDataUrl(fileStore: FileStore | undefined, relativePath: string | null): Promise<string | undefined> {
  if (!fileStore || !relativePath) return undefined;
  try {
    const bytes = await fileStore.readFile(relativePath);
    const extension = relativePath.split('.').pop()?.toLowerCase() ?? '';
    const mime = MIME_BY_EXTENSION[extension];
    return mime ? `data:${mime};base64,${bytes.toString('base64')}` : undefined;
  } catch {
    return undefined;
  }
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

  app.get('/c/:token/quote.pdf', async (request, reply) => {
    const { token } = request.params as { token: string };
    const items = parseQuoteItems((request.query as { items?: string }).items);
    if (!items.length) {
      return reply.status(400).type('text/html; charset=utf-8').send(renderCatalogQuoteErrorPage('购物车还是空的，请先在图册中选择产品并填写数量。', token));
    }
    const quote = service.buildPublicQuote(token, items);
    if (!quote) {
      return reply.status(404).type('text/html; charset=utf-8').send(renderCatalogUnavailablePage());
    }
    if (!quote.lines.length) {
      return reply.status(400).type('text/html; charset=utf-8').send(renderCatalogQuoteErrorPage('购物车里的产品已不在当前图册中，请返回图册重新选择。', token));
    }
    // 产品主图：240 缩略图转 JPEG 内联，避免 Chromium 把 WebP 无损重编码导致 PDF 膨胀。
    const imageDataUrls = new Map<number, string>();
    if (thumbnailService) {
      const targets = quote.lines.filter((line) => line.imageRelativePath).slice(0, 200);
      for (let offset = 0; offset < targets.length; offset += 4) {
        await Promise.all(targets.slice(offset, offset + 4).map(async (line) => {
          try {
            const image = await thumbnailService.get(240, line.imageRelativePath!);
            const jpeg = await sharp(image).flatten({ background: '#ffffff' }).jpeg({ quality: 75, mozjpeg: true }).toBuffer();
            imageDataUrls.set(line.productId, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
          } catch {
            // 单张图读不出来不阻断整份报价。
          }
        }));
      }
    }
    const pdfRenderer = options.pdfRenderer ?? new PdfRenderer();
    try {
      const pdf = await pdfRenderer.render(renderCatalogQuoteHtml(quote, {
        logoDataUrl: await logoDataUrl(fileStore, quote.company.logoRelativePath),
        imageDataUrls,
      }));
      const filename = `${quote.catalogName}-选品报价.pdf`;
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Cache-Control', 'no-store')
        .header('Content-Disposition', `attachment; filename="catalog-quote.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .send(pdf);
    } catch {
      return reply.status(500).type('text/html; charset=utf-8').send(renderCatalogQuoteErrorPage('PDF 生成失败，请稍后重试。', token));
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
