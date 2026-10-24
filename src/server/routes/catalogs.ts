import type { FastifyInstance } from 'fastify';
import { ApiError, asRecord, parseId, sendFailure, sendSuccess } from './api-response.js';
import { CatalogService, CatalogServiceError } from '../services/catalog-service.js';

function mapCatalogError(error: unknown): ApiError {
  if (error instanceof CatalogServiceError) {
    const status = error.code === 'CATALOG_NOT_FOUND' ? 404 : 400;
    return new ApiError(status, error.code, error.message);
  }
  return new ApiError(500, 'INTERNAL_ERROR', '图册操作失败');
}

/** 产品图册（在线链接版）的管理接口；公开访问走 /c/:token，不在这些路径下。 */
export async function registerCatalogRoutes(app: FastifyInstance, options: { service: CatalogService }): Promise<void> {
  const { service } = options;

  app.get('/api/catalogs', async (_request, reply) =>
    sendSuccess(reply, { items: service.list() }),
  );

  app.get('/api/catalogs/:id', async (request, reply) => {
    try {
      return sendSuccess(reply, service.detail(parseId((request.params as { id?: string }).id)));
    } catch (error) {
      return sendFailure(reply, mapCatalogError(error));
    }
  });

  app.post('/api/catalogs', async (request, reply) => {
    try {
      const body = asRecord(request.body);
      return sendSuccess(reply, service.create({ name: body.name, productIds: body.productIds, markupPercent: body.markupPercent }), 201);
    } catch (error) {
      return sendFailure(reply, mapCatalogError(error));
    }
  });

  app.put('/api/catalogs/:id', async (request, reply) => {
    try {
      const body = asRecord(request.body);
      const id = parseId((request.params as { id?: string }).id);
      return sendSuccess(reply, service.update(id, { name: body.name, enabled: body.enabled, productIds: body.productIds, markupPercent: body.markupPercent }));
    } catch (error) {
      return sendFailure(reply, mapCatalogError(error));
    }
  });

  app.delete('/api/catalogs/:id', async (request, reply) => {
    try {
      service.delete(parseId((request.params as { id?: string }).id));
      return sendSuccess(reply, { deleted: true });
    } catch (error) {
      return sendFailure(reply, mapCatalogError(error));
    }
  });
}
