import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerDiagnosticRoutes } from '../../src/server/routes/diagnostics';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createFixture() {
  const app = Fastify();
  apps.push(app);
  await registerDiagnosticRoutes(app);
  return app;
}

describe('客户端诊断回报', () => {
  it('接收保存失败回报并返回回执', async () => {
    const app = await createFixture();
    const response = await app.inject({
      method: 'POST',
      url: '/api/client-diagnostics',
      payload: { kind: 'image-save', stage: 'write', message: 'IOException: boom' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ received: true });
  });

  it('字段缺失或类型不对时不报错（清洗与截断在服务端兜底）', async () => {
    const app = await createFixture();
    const missing = await app.inject({ method: 'POST', url: '/api/client-diagnostics', payload: {} });
    expect(missing.statusCode).toBe(200);
    const wrongTypes = await app.inject({
      method: 'POST',
      url: '/api/client-diagnostics',
      payload: { kind: 42, stage: null, message: { nested: true } },
    });
    expect(wrongTypes.statusCode).toBe(200);
    const longText = await app.inject({
      method: 'POST',
      url: '/api/client-diagnostics',
      payload: { kind: 'image-save', stage: 'write', message: 'x'.repeat(5000) },
    });
    expect(longText.statusCode).toBe(200);
  });
});
