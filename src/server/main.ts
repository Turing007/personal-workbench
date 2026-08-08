import Fastify from 'fastify';

const app = Fastify({ logger: true });
app.get('/health', async () => ({ ok: true }));

await app.listen({ host: '127.0.0.1', port: 52341 });
