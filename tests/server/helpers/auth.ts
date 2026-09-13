import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';

interface AdminCredential {
  username: string;
  password: string;
  token: string;
}

const adminCredentials = new WeakMap<FastifyInstance, AdminCredential>();

/**
 * 通过 /api/auth/setup 为测试应用创建首个管理员，并记住其会话令牌。
 * 之后再通过 authInject 发请求即可自动携带会话 Cookie。
 */
export async function setupAdmin(
  app: FastifyInstance,
  options: { username?: string; password?: string; displayName?: string } = {},
): Promise<AdminCredential> {
  const username = options.username ?? 'admin';
  const password = options.password ?? 'test-password-123';
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username, password, displayName: options.displayName ?? '测试管理员' },
  });
  if (response.statusCode !== 201) {
    throw new Error(`setupAdmin 失败：HTTP ${response.statusCode} ${response.body}`);
  }
  const sessionCookie = response.cookies.find((cookie) => cookie.name === 'wb_session');
  if (!sessionCookie) throw new Error('setupAdmin 失败：响应未包含会话 Cookie');
  const credential: AdminCredential = { username, password, token: sessionCookie.value };
  adminCredentials.set(app, credential);
  return credential;
}

export function getAdminCredential(app: FastifyInstance): AdminCredential {
  const credential = adminCredentials.get(app);
  if (!credential) throw new Error('authInject 前必须先调用 setupAdmin');
  return credential;
}

/** 与 app.inject 相同，但自动附带管理员会话 Cookie。 */
export async function authInject(app: FastifyInstance, options: InjectOptions): Promise<LightMyRequestResponse> {
  const credential = getAdminCredential(app);
  return app.inject({ ...options, cookies: { ...options.cookies, wb_session: credential.token } });
}

/** 以指定账号登录并替换该应用的默认会话令牌。 */
export async function loginAs(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`loginAs 失败：HTTP ${response.statusCode} ${response.body}`);
  }
  const sessionCookie = response.cookies.find((cookie) => cookie.name === 'wb_session');
  if (!sessionCookie) throw new Error('loginAs 失败：响应未包含会话 Cookie');
  adminCredentials.set(app, { username, password, token: sessionCookie.value });
}
