import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createSessionToken, hashPassword, parseSessionCookie, verifyPassword, verifySessionToken } from '../../src/server/auth';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { SettingsRepository } from '../../src/server/db/settings-repository';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';

const temporaryDirectories: string[] = [];
const apps: FastifyInstance[] = [];
const databases: DatabaseSync[] = [];

// 测试专用的示例口令，无任何真实凭据。
const SAMPLE = {
  main: 'secret123',
  short: 'abc',
  other: 'another456',
  wrong: 'wrong!!',
  previous: 'old12345',
  updated: 'new123456',
  junk: 'whatever7',
  nope: 'nope',
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(databases.splice(0).map((database) => database.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function sessionCookieFrom(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw.join('\n') : raw ?? '';
  const match = value.match(/workbench_session=([^;]*)/);
  expect(match, '登录响应应签发 workbench_session cookie').toBeTruthy();
  return match![1];
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-auth-'));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  databases.push(database);
  migrateDatabase(database);
  const app = await createApp({ database });
  apps.push(app);
  return { app, settings: new SettingsRepository(database) };
}

describe('auth helpers', () => {
  it('hashes and verifies passwords', () => {
    const stored = hashPassword(SAMPLE.main);
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword(SAMPLE.main, stored)).toBe(true);
    expect(verifyPassword(SAMPLE.wrong, stored)).toBe(false);
    expect(verifyPassword(SAMPLE.main, 'garbage')).toBe(false);
  });

  it('accepts genuine session tokens and rejects tampered or expired ones', () => {
    const key = 'unit-test-key';
    const token = createSessionToken(key, 1_000_000);
    expect(verifySessionToken(key, token, 1_000_000 + 1000)).toBe(true);
    expect(verifySessionToken(key, token, 1_000_000 + 180 * 24 * 60 * 60 * 1000)).toBe(true);
    expect(verifySessionToken(key, token, 1_000_000 + 180 * 24 * 60 * 60 * 1000 + 1)).toBe(false);
    expect(verifySessionToken(key, `${token}x`, 1_000_000)).toBe(false);
    expect(verifySessionToken('other-key', token, 1_000_000)).toBe(false);
    expect(verifySessionToken(key, 'not-a-token')).toBe(false);
  });

  it('parses the session cookie from a cookie header', () => {
    expect(parseSessionCookie('a=1; workbench_session=tok.en; b=2')).toBe('tok.en');
    expect(parseSessionCookie('workbench_session=only')).toBe('only');
    expect(parseSessionCookie('other=1')).toBeNull();
    expect(parseSessionCookie(undefined)).toBeNull();
  });
});

describe('access control flow', () => {
  it('stays open before a password is configured and reports status', async () => {
    const { app } = await createFixture();

    const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json().data).toEqual({ configured: false, authenticated: false });

    // 未设置密码：普通接口无需登录即可访问（首次使用不会被锁在门外）。
    const customers = await app.inject({ method: 'GET', url: '/api/customers' });
    expect(customers.statusCode).toBe(200);
  });

  it('sets up the password, locks the API and lets the session through', async () => {
    const { app, settings } = await createFixture();

    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: SAMPLE.main } });
    expect(setup.statusCode).toBe(201);
    const token = sessionCookieFrom(setup.headers);

    // 已设置密码：无 cookie 的数据请求被拦截，附件同理。
    const anonymous = await app.inject({ method: 'GET', url: '/api/customers' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe('AUTH_REQUIRED');
    const anonymousFile = await app.inject({ method: 'GET', url: '/files/payment-proofs/whatever.png' });
    expect(anonymousFile.statusCode).toBe(401);

    const authed = await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: `workbench_session=${token}` } });
    expect(authed.statusCode).toBe(200);

    const status = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie: `workbench_session=${token}` } });
    expect(status.json().data).toEqual({ configured: true, authenticated: true });

    // 健康检查始终开放。
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    expect(settings.getPasswordHash()).toContain('scrypt$');
  });

  it('rejects wrong passwords and duplicate setup', async () => {
    const { app } = await createFixture();
    await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: SAMPLE.main } });

    const duplicate = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: SAMPLE.other } });
    expect(duplicate.statusCode).toBe(409);

    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: SAMPLE.wrong } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('INVALID_PASSWORD');

    const tooShort = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: SAMPLE.short } });
    expect(tooShort.statusCode).toBe(409); // 已设置密码时优先返回 409
  });

  it('logs in with the configured password', async () => {
    const { app } = await createFixture();
    await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: SAMPLE.main } });

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: SAMPLE.main } });
    expect(login.statusCode).toBe(200);
    const token = sessionCookieFrom(login.headers);

    const authed = await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: `workbench_session=${token}` } });
    expect(authed.statusCode).toBe(200);
  });

  it('changes the password, invalidates old sessions and keeps the current device logged in', async () => {
    const { app } = await createFixture();
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: SAMPLE.previous } });
    const oldToken = sessionCookieFrom(setup.headers);

    const change = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie: `workbench_session=${oldToken}` },
      payload: { currentPassword: SAMPLE.previous, newPassword: SAMPLE.updated },
    });
    expect(change.statusCode).toBe(200);
    const newToken = sessionCookieFrom(change.headers);

    // 其他设备的旧会话随密钥轮换失效。
    const staleDevice = await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: `workbench_session=${oldToken}` } });
    expect(staleDevice.statusCode).toBe(401);

    const currentDevice = await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: `workbench_session=${newToken}` } });
    expect(currentDevice.statusCode).toBe(200);

    const wrongCurrent = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie: `workbench_session=${newToken}` },
      payload: { currentPassword: SAMPLE.nope, newPassword: SAMPLE.junk },
    });
    expect(wrongCurrent.statusCode).toBe(401);

    const relogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: SAMPLE.updated } });
    expect(relogin.statusCode).toBe(200);
    const oldLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: SAMPLE.previous } });
    expect(oldLogin.statusCode).toBe(401);
  });

  it('clears the session cookie on logout', async () => {
    const { app } = await createFixture();
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: SAMPLE.main } });
    const token = sessionCookieFrom(setup.headers);

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: `workbench_session=${token}` } });
    expect(logout.statusCode).toBe(200);

    // 令牌本身仍有效（无状态签名），退出靠清除 cookie 实现。
    const after = await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: `workbench_session=${token}` } });
    expect(after.statusCode).toBe(200);
    expect(/workbench_session=;/.test(String(logout.headers['set-cookie']))).toBe(true);
  });
});
