import type { FastifyInstance } from 'fastify';
import type { DocumentCustomerService } from '../services/document-customer-service.js';
import { mapDatabaseError, optionalText, sendFailure, sendSuccess } from './api-response.js';

interface DocumentCustomerRouteOptions {
  service: DocumentCustomerService;
}

export async function registerDocumentCustomerRoutes(
  app: FastifyInstance,
  options: DocumentCustomerRouteOptions,
): Promise<void> {
  app.get('/api/document-customers/suggestions', async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const search = optionalText(query.q, 'q', '搜索内容');
      const items = options.service.listSuggestions(search, 20);
      return sendSuccess(reply, { items });
    } catch (error) {
      return sendFailure(reply, mapDatabaseError(error));
    }
  });
}

export const documentCustomerRoutes = registerDocumentCustomerRoutes;
