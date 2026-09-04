import type { FastifyInstance } from 'fastify';
import { sendSuccess } from './api-response.js';
import { getVersionInfo } from '../version-info.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => sendSuccess(reply, { status: 'ok', ...getVersionInfo() }));
}

export const healthRoutes = registerHealthRoutes;
