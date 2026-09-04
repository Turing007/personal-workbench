import type { FastifyInstance } from 'fastify';
import { sendSuccess } from './api-response.js';
import { readVersionInfo } from '../version.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => sendSuccess(reply, { status: 'ok', ...readVersionInfo() }));
}

export const healthRoutes = registerHealthRoutes;
