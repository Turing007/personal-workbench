import type { APIRequestContext } from '@playwright/test';

// e2e 专用管理员口令：由规则生成，仅存在于 e2e 独立数据目录中，非真实凭据。
function e2eSecretFor(name: string): string {
  return `wb-e2e-${name}-2026`;
}

export const E2E_USERNAME = 'e2e-admin';
export const E2E_PASSWORD = e2eSecretFor('admin');

/** 确保存在 e2e 管理员账号并完成登录，返回会话 Cookie 值；数据库为空时走 setup 流程。 */
export async function ensureAuthenticated(request: APIRequestContext): Promise<string> {
  const login = () => request.post('/api/auth/login', {
    data: { username: E2E_USERNAME, password: E2E_PASSWORD },
  });
  let response = await login();
  if (response.status() === 401) {
    const setup = await request.post('/api/auth/setup', {
      data: { username: E2E_USERNAME, password: E2E_PASSWORD, displayName: 'E2E 管理员' },
    });
    if (setup.ok()) response = await login();
  }
  if (!response.ok()) {
    throw new Error(`e2e 登录失败：HTTP ${response.status()} ${await response.text()}`);
  }
  const setCookie = response.headers()['set-cookie'] ?? '';
  const sessionMatch = setCookie.match(/wb_session=([^;]+)/);
  if (!sessionMatch) throw new Error('e2e 登录失败：响应未包含会话 Cookie');
  return sessionMatch[1];
}

/** 向浏览器上下文注入会话 Cookie；供各 spec 的 beforeEach 调用。 */
export async function injectSession(context: { addCookies: (cookies: Array<{ name: string; value: string; domain: string; path: string }>) => Promise<void> }, sessionCookie: string): Promise<void> {
  await context.addCookies([{
    name: 'wb_session',
    value: sessionCookie,
    domain: '127.0.0.1',
    path: '/',
  }]);
}
