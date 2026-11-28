import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DocumentVersionType } from '../../shared/document-versions.js';
import type { DocumentVersionService } from '../services/document-version-service.js';
import { ApiError, parseId, sendFailure, sendSuccess } from './api-response.js';

interface IdParams { id: string }
interface VersionParams extends IdParams { versionNo: string }

export interface DocumentVersionRouteOptions {
  /** 例如 /api/sales-documents。 */
  basePath: string;
  documentType: DocumentVersionType;
  notFoundMessage: string;
  exists: (id: number) => boolean;
  service: DocumentVersionService;
}

async function safeRoute<T>(handler: () => Promise<T> | T, reply: FastifyReply): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    return sendFailure(reply, error);
  }
}

/** 为报价单/销售单挂载只读的版本历史接口。 */
export async function registerDocumentVersionRoutes(
  app: FastifyInstance,
  options: DocumentVersionRouteOptions,
): Promise<void> {
  app.get(`${options.basePath}/:id/versions`, async (request: FastifyRequest<{ Params: IdParams }>, reply) => safeRoute(() => {
    const id = parseId(request.params.id);
    if (!options.exists(id)) throw new ApiError(404, 'NOT_FOUND', options.notFoundMessage);
    return sendSuccess(reply, options.service.list(options.documentType, id));
  }, reply));

  app.get(`${options.basePath}/:id/versions/:versionNo`, async (request: FastifyRequest<{ Params: VersionParams }>, reply) => safeRoute(() => {
    const id = parseId(request.params.id);
    if (!options.exists(id)) throw new ApiError(404, 'NOT_FOUND', options.notFoundMessage);
    const versionNo = parseId(request.params.versionNo, 'versionNo');
    const version = options.service.get(options.documentType, id, versionNo);
    if (!version) throw new ApiError(404, 'VERSION_NOT_FOUND', '版本记录不存在');
    return sendSuccess(reply, version);
  }, reply));
}
