import type { FastifyInstance } from 'fastify';
import { sendSuccess } from './api-response.js';

const MAX_LENGTH = 300;

function cleanText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_LENGTH);
}

/**
 * 客户端把失败原因回报到这里（目前是 App 内「保存到相册」在用）。
 * 只写日志、不落库：线上排查时从 docker logs 就能看到失败环节与系统报错原文。
 */
export async function registerDiagnosticRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/client-diagnostics', async (request, reply) => {
    const body = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
    request.log.warn({
      kind: cleanText(body.kind, 'unknown'),
      stage: cleanText(body.stage),
      message: cleanText(body.message),
      userAgent: cleanText(request.headers['user-agent']),
    }, 'client diagnostic');
    return sendSuccess(reply, { received: true });
  });
}
