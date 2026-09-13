import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  MIN_PASSWORD_LENGTH,
} from '../auth/auth-service.js';
import type { AuthService } from '../auth/auth-service.js';
import type { PublicUser } from '../auth/user-repository.js';
import { ApiError, asRecord, optionalText, parseId, requiredText, sendFailure, sendSuccess } from './api-response.js';

export interface AuthRouteOptions {
  service: AuthService;
}

export interface AuthenticatedUser extends PublicUser {}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/** 请求必须携带有效会话；未登录抛 401。用于鉴权门之外的增量保护点。 */
export function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) throw new ApiError(401, 'AUTH_REQUIRED', '请先登录');
  return request.user;
}

/** 管理员专属操作（账号管理、恢复备份等）。 */
export function requireAdmin(request: FastifyRequest): AuthenticatedUser {
  const user = requireUser(request);
  if (user.role !== 'admin') throw new ApiError(403, 'AUTH_FORBIDDEN', '该操作仅管理员可用');
  return user;
}

const COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: 'auto',
} as const;

export async function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): Promise<void> {
  const service = options.service;

  function sessionCookieAttributes(maxAgeSeconds: number) {
    return { ...COOKIE_OPTIONS, maxAge: maxAgeSeconds };
  }

  function clientKey(request: FastifyRequest, username: string): string {
    return `${request.ip}|${username.trim().toLowerCase()}`;
  }

  app.get('/api/auth/status', async (_request, reply) =>
    sendSuccess(reply, { initialized: service.isInitialized() }),
  );

  app.post('/api/auth/setup', async (request, reply) => {
    try {
      const body = asRecord(request.body);
      const context = await service.setupFirstAdmin({
        username: requiredText(body.username, 'username', '用户名'),
        password: requiredText(body.password, 'password', '密码'),
        displayName: optionalText(body.displayName, 'displayName', '显示名称'),
      });
      // Cookie 必须在 send 之前设置，send 之后再改头不会生效。
      reply.setCookie(SESSION_COOKIE, context.token, sessionCookieAttributes(SESSION_TTL_MS / 1000));
      return sendSuccess(reply, { user: context.user }, 201);
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    try {
      const body = asRecord(request.body);
      const username = requiredText(body.username, 'username', '用户名');
      const password = requiredText(body.password, 'password', '密码');
      const context = await service.login({
        username,
        password,
        clientKey: clientKey(request, username),
      });
      reply.setCookie(SESSION_COOKIE, context.token, sessionCookieAttributes(SESSION_TTL_MS / 1000));
      return sendSuccess(reply, { user: context.user });
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    service.logout(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { ...COOKIE_OPTIONS });
    return sendSuccess(reply, null);
  });

  app.get('/api/auth/me', async (request, reply) =>
    sendSuccess(reply, { user: requireUser(request) }),
  );

  app.put('/api/auth/password', async (request, reply) => {
    try {
      const user = requireUser(request);
      const body = asRecord(request.body);
      const updated = await service.changePassword(user.id, {
        currentPassword: requiredText(body.currentPassword, 'currentPassword', '当前密码'),
        newPassword: requiredText(body.newPassword, 'newPassword', '新密码'),
      }, request.cookies[SESSION_COOKIE]);
      return sendSuccess(reply, { user: updated });
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  app.get('/api/auth/users', async (request, reply) => {
    try {
      requireAdmin(request);
      return sendSuccess(reply, { users: service.listUsers() });
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  app.post('/api/auth/users', async (request, reply) => {
    try {
      requireAdmin(request);
      const body = asRecord(request.body);
      const user = await service.createUser({
        username: requiredText(body.username, 'username', '用户名'),
        password: requiredText(body.password, 'password', '密码'),
        displayName: optionalText(body.displayName, 'displayName', '显示名称'),
        role: body.role === 'admin' ? 'admin' : 'member',
      });
      return sendSuccess(reply, { user }, 201);
    } catch (error) {
      return sendFailure(reply, error);
    }
  });

  app.patch('/api/auth/users/:id', async (request, reply) => {
    try {
      const acting = requireAdmin(request);
      const targetId = parseId((request.params as { id: string }).id);
      const body = asRecord(request.body);
      const patch: { displayName?: string; password?: string; role?: 'admin' | 'member'; isActive?: boolean } = {};
      if ('displayName' in body) patch.displayName = optionalText(body.displayName, 'displayName', '显示名称');
      if ('password' in body) patch.password = requiredText(body.password, 'password', '密码');
      if ('role' in body) patch.role = body.role === 'admin' ? 'admin' : 'member';
      if ('isActive' in body) {
        if (typeof body.isActive !== 'boolean') {
          throw new ApiError(400, 'VALIDATION_ERROR', 'isActive 必须是布尔值', 'isActive');
        }
        patch.isActive = body.isActive;
      }
      const user = await service.updateUser(acting.id, targetId, patch);
      return sendSuccess(reply, { user });
    } catch (error) {
      return sendFailure(reply, error);
    }
  });
}

export const AUTH_PUBLIC_PATHS = new Set(['/api/auth/status', '/api/auth/setup', '/api/auth/login']);
