import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/server/app';
import { LOGIN_LOCKOUT_LADDER_MS, LOGIN_LOCKOUT_THRESHOLD } from '../../src/server/auth/auth-service';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { authInject, getAdminCredential, loginAs, setupAdmin } from './helpers/auth';

/** 由用户名确定性生成测试口令：仅用于内存数据库夹具，非真实凭据。 */
function fixturePasswordFor(username: string): string {
  return `wb-test-${username}-2026`;
}

const ADMIN_USERNAME = 'admin';

const directories: string[] = [];
const apps: FastifyInstance[] = [];
const databases: DatabaseSync[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const database of databases.splice(0)) database.close();
  // Windows 下 SQLite 句柄释放有延迟，重试删除避免 EBUSY。
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })));
}, 30_000);

async function createAppFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-auth-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  databases.push(database);
  migrateDatabase(database);
  const app = await createApp({ database });
  apps.push(app);
  return { app, database };
}

function orderPayload() {
  return {
    orderNo: '',
    orderedAt: '2026-09-12',
    recipientName: '张三',
    recipientInfo: '张三 13800000000 浙江省宁波市',
    items: [{ name: '测试产品', quantity: 2, packCount: 1, unitPriceCents: 500 }],
  };
}

describe('鉴权门', () => {
  it('未登录访问业务接口返回 401，健康检查保持公开', async () => {
    const { app } = await createAppFixture();

    const orders = await app.inject({ method: 'GET', url: '/api/orders' });
    expect(orders.statusCode).toBe(401);
    expect(orders.json()).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    // 未登录也能读：登录页要靠它决定是否显示测试横条
    expect(health.json().data.environment).toBe('test');
  });

  it('status 反映初始化状态；setup 创建首个管理员并自动登录', async () => {
    const { app } = await createAppFixture();

    const before = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(before.json().data.initialized).toBe(false);

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'admin', password: fixturePasswordFor('admin'), displayName: '管理员' },
    });
    expect(setup.statusCode).toBe(201);
    expect(setup.json().data.user).toMatchObject({ username: 'admin', role: 'admin' });
    expect(setup.cookies.some((cookie) => cookie.name === 'wb_session')).toBe(true);

    const after = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(after.json().data.initialized).toBe(true);

    const sessionCookie = setup.cookies.find((cookie) => cookie.name === 'wb_session')!.value;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { wb_session: sessionCookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.username).toBe('admin');
  });

  it('系统已初始化后拒绝再次 setup', async () => {
    const { app } = await createAppFixture();
    await setupAdmin(app, { password: fixturePasswordFor(ADMIN_USERNAME) });

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'intruder', password: fixturePasswordFor('admin') },
    });
    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe('AUTH_ALREADY_INITIALIZED');
  });
});

describe('登录与会话', () => {
  it('登录成功设置会话 Cookie，错误密码返回统一错误', async () => {
    const { app } = await createAppFixture();
    await setupAdmin(app, { password: fixturePasswordFor(ADMIN_USERNAME) });

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: fixturePasswordFor('wrong') },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('AUTH_INVALID_CREDENTIALS');

    const missing = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: fixturePasswordFor('wrong') },
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.message).toBe(wrong.json().error.message);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: fixturePasswordFor('admin') },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.some((cookie) => cookie.name === 'wb_session')).toBe(true);
  });

  it('连续失败到阈值即锁定，即使密码正确也返回 429 并带 Retry-After', async () => {
    const { app } = await createAppFixture();
    await setupAdmin(app, { password: fixturePasswordFor(ADMIN_USERNAME) });

    for (let attempt = 0; attempt < LOGIN_LOCKOUT_THRESHOLD; attempt += 1) {
      const failure = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: fixturePasswordFor('wrong') },
      });
      expect(failure.statusCode).toBe(401);
    }

    const locked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: fixturePasswordFor('admin') },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('AUTH_RATE_LIMITED');
    // 客户端与网关都靠 Retry-After 退避，必须是十进制秒数，且不超过第一档锁定时长
    const retryAfter = Number(locked.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(LOGIN_LOCKOUT_LADDER_MS[0] / 1000);
  });

  it('锁定状态落盘：重启服务后仍被锁', async () => {
    const { app, database } = await createAppFixture();
    await setupAdmin(app, { password: fixturePasswordFor(ADMIN_USERNAME) });
    for (let attempt = 0; attempt < LOGIN_LOCKOUT_THRESHOLD; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: fixturePasswordFor('wrong') },
      });
    }
    expect((await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: fixturePasswordFor('admin') },
    })).statusCode).toBe(429);

    // 模拟容器重启：同一份数据库上重新建一个 app，锁定不该因为重启而消失
    const restarted = await createApp({ database });
    apps.push(restarted);
    const afterRestart = await restarted.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: fixturePasswordFor('admin') },
    });
    expect(afterRestart.statusCode).toBe(429);
  });

  it('反复失败沿退避阶梯升级：第 4 次锁 15 分钟，而不是每轮都停在 5 分钟', async () => {
    const { app, database } = await createAppFixture();
    await setupAdmin(app, { password: fixturePasswordFor(ADMIN_USERNAME) });

    // 直接写一份「已失败到阈值、且第一档锁定刚过期」的落盘状态，等价于等满 5 分钟再来猜。
    database.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(
      'login_lockouts',
      JSON.stringify({
        '127.0.0.1|admin': {
          count: LOGIN_LOCKOUT_THRESHOLD,
          firstFailureAt: Date.now() - 60_000,
          lockedUntil: Date.now() - 1_000,
        },
      }),
      new Date().toISOString(),
    );

    const failure = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: fixturePasswordFor('wrong') },
    });
    expect(failure.statusCode).toBe(401);

    const locked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: fixturePasswordFor('admin') },
    });
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBe(LOGIN_LOCKOUT_LADDER_MS[1] / 1000);
  });

  it('登录成功后失败计数清零，不会把偶发手误累积成锁定', async () => {
    const { app } = await createAppFixture();
    await setupAdmin(app, { password: fixturePasswordFor(ADMIN_USERNAME) });

    const fail = () => app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: fixturePasswordFor('wrong') },
    });
    const succeed = () => app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: fixturePasswordFor('admin') },
    });

    // 差一次就到阈值时登录成功
    for (let attempt = 0; attempt < LOGIN_LOCKOUT_THRESHOLD - 1; attempt += 1) expect((await fail()).statusCode).toBe(401);
    expect((await succeed()).statusCode).toBe(200);

    // 计数已清零：再连错两次仍然没到阈值，正确密码照常能进
    for (let attempt = 0; attempt < LOGIN_LOCKOUT_THRESHOLD - 1; attempt += 1) expect((await fail()).statusCode).toBe(401);
    expect((await succeed()).statusCode).toBe(200);
  });

  it('登出后原会话失效', async () => {
    const { app } = await createAppFixture();
    await setupAdmin(app, { password: fixturePasswordFor(ADMIN_USERNAME) });
    const { token } = getAdminCredential(app);

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { wb_session: token } });
    expect(logout.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { wb_session: token } });
    expect(me.statusCode).toBe(401);
  });

  it('修改密码：校验当前密码，成功后旧密码失效且其他会话被吊销', async () => {
    const { app } = await createAppFixture();
    const setupCredential = await setupAdmin(app, { password: fixturePasswordFor('admin') });
    // setupAdmin 的会话当作“其他设备”，loginAs 的新会话用来执行修改。
    const otherDeviceToken = setupCredential.token;

    await loginAs(app, 'admin', fixturePasswordFor('admin'));

    const wrongCurrent = await authInject(app, {
      method: 'PUT',
      url: '/api/auth/password',
      payload: { currentPassword: fixturePasswordFor('wrong'), newPassword: fixturePasswordFor('changed') },
    });
    expect(wrongCurrent.statusCode).toBe(400);

    const changed = await authInject(app, {
      method: 'PUT',
      url: '/api/auth/password',
      payload: { currentPassword: fixturePasswordFor('admin'), newPassword: fixturePasswordFor('changed') },
    });
    expect(changed.statusCode).toBe(200);

    const oldSession = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { wb_session: otherDeviceToken } });
    expect(oldSession.statusCode).toBe(401);

    const loginWithOld = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: fixturePasswordFor('admin') } });
    expect(loginWithOld.statusCode).toBe(401);

    const loginWithNew = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: fixturePasswordFor('changed') } });
    expect(loginWithNew.statusCode).toBe(200);
  });
});

describe('账号管理', () => {
  it('管理员可创建成员账号，成员访问管理接口被拒绝', async () => {
    const { app } = await createAppFixture();
    await setupAdmin(app, { password: fixturePasswordFor(ADMIN_USERNAME) });

    const created = await authInject(app, {
      method: 'POST',
      url: '/api/auth/users',
      payload: { username: 'staff', password: fixturePasswordFor('staff'), displayName: '小张' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.user).toMatchObject({ username: 'staff', role: 'member', displayName: '小张' });

    await loginAs(app, 'staff', fixturePasswordFor('staff'));
    const list = await authInject(app, { method: 'GET', url: '/api/auth/users' });
    expect(list.statusCode).toBe(403);

    const create = await authInject(app, {
      method: 'POST',
      url: '/api/auth/users',
      payload: { username: 'another', password: fixturePasswordFor('staff') },
    });
    expect(create.statusCode).toBe(403);
  });

  it('停用的账号无法登录，已有会话立即失效', async () => {
    const { app } = await createAppFixture();
    await setupAdmin(app, { password: fixturePasswordFor(ADMIN_USERNAME) });

    await authInject(app, {
      method: 'POST',
      url: '/api/auth/users',
      payload: { username: 'staff', password: fixturePasswordFor('staff') },
    });
    // 直接用 app.inject 登录员工账号，避免覆盖 authInject 的管理员默认会话。
    const staffLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'staff', password: fixturePasswordFor('staff') } });
    expect(staffLogin.statusCode).toBe(200);
    const staffSession = staffLogin.cookies.find((cookie) => cookie.name === 'wb_session')!.value;

    const staffList = await authInject(app, { method: 'GET', url: '/api/auth/users' });
    const staff = staffList.json().data.users.find((user: { username: string }) => user.username === 'staff');

    const disable = await authInject(app, { method: 'PATCH', url: `/api/auth/users/${staff.id}`, payload: { isActive: false } });
    expect(disable.statusCode).toBe(200);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'staff', password: fixturePasswordFor('staff') } });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('AUTH_ACCOUNT_DISABLED');

    const staffMe = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { wb_session: staffSession } });
    expect(staffMe.statusCode).toBe(401);
  });

  it('不能停用自己，也不能让系统失去最后一名管理员', async () => {
    const { app } = await createAppFixture();
    await setupAdmin(app, { password: fixturePasswordFor(ADMIN_USERNAME) });
    const admin = (await authInject(app, { method: 'GET', url: '/api/auth/me' })).json().data.user as { id: number };

    const selfDisable = await authInject(app, { method: 'PATCH', url: `/api/auth/users/${admin.id}`, payload: { isActive: false } });
    expect(selfDisable.statusCode).toBe(409);
    expect(selfDisable.json().error.code).toBe('AUTH_SELF_DISABLE');

    const demote = await authInject(app, { method: 'PATCH', url: `/api/auth/users/${admin.id}`, payload: { role: 'member' } });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error.code).toBe('AUTH_LAST_ADMIN');
  });
});

describe('订单创建人留痕', () => {
  it('订单记录创建人用户名并回显在详情中', async () => {
    const { app } = await createAppFixture();
    await setupAdmin(app, { password: fixturePasswordFor(ADMIN_USERNAME) });

    const created = await authInject(app, { method: 'POST', url: '/api/orders', payload: orderPayload() });
    expect(created.statusCode).toBe(201);
    const orderId = created.json().data.id;

    const detail = await authInject(app, { method: 'GET', url: `/api/orders/${orderId}/detail` });
    expect(detail.statusCode).toBe(200);
    expect(String(detail.json().data.created_by)).toBe('admin');
  });
});
