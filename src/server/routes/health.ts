import type { FastifyInstance } from 'fastify';
import { sendSuccess } from './api-response.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => sendSuccess(reply, { status: 'ok' }));
}

export const healthRoutes = registerHealthRoutes;
