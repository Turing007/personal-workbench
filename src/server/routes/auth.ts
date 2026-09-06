import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SettingsRepository } from '../db/settings-repository.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  hashPassword,
  parseSessionCookie,
  verifyPassword,
  verifySessionToken,
} from '../auth.js';
import { ApiError, asRecord, sendFailure, sendSuccess } from './api-response.js';

const MIN_PASSWORD_LENGTH = 6;

// 未设置访问密码时仅开放认证端点与健康检查；其余路径是否拦截取决于是否已配置密码，
// 因此恢复备份、修改密码后立即生效，无需重启。
const PUBLIC_PATHS = new Set(['/health', '/api/auth/status', '/api/auth/setup', '/api/auth/login']);

interface AuthRouteOptions {
  settings: SettingsRepository;
}

function sessionCookie(value: string, maxAgeSeconds: number): string {
  // SameSite=Lax + HttpOnly；经 Tailscale/局域网 HTTP 访问，不启用 Secure 以免浏览器拒收。
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function issueSession(reply: FastifyReply, settings: SettingsRepository): void {
  reply.header('set-cookie', sessionCookie(createSessionToken(settings.getSessionSecret()), SESSION_MAX_AGE_SECONDS));
}

function clearSession(reply: FastifyReply): void {
  reply.header('set-cookie', sessionCookie('', 0));
}

function readPasswordField(value: unknown, field: string): string {
  const body = asRecord(value);
  const password = body[field];
  if (typeof password !== 'string' || password.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', '密码不能为空', field);
  }
  return password;
}

function readNewPassword(value: unknown, field: string): string {
  const password = readPasswordField(value, field);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(400, 'VALIDATION_ERROR', `密码至少 ${MIN_PASSWORD_LENGTH} 位`, field);
  }
  return password;
}

export function isAuthenticated(settings: SettingsRepository, request: FastifyRequest): boolean {
  const token = parseSessionCookie(request.headers.cookie);
  return token != null && verifySessionToken(settings.getSessionSecret(), token);
}

export async function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): Promise<void> {
  const { settings } = options;

  app.get('/api/auth/status', async (_request, reply) =>
    sendSuccess(reply, {
      configured: settings.getPasswordHash() != null,
      authenticated: isAuthenticated(settings, _request),
    }),
  );

  // 首次使用：创建访问密码后自动登录。
  app.post('/api/auth/setup', async (request, reply) => {
    try {
      if (settings.getPasswordHash() != null) {
        throw new ApiError(409, 'ALREADY_CONFIGURED', '访问密码已设置，请直接登录或先验证旧密码');
      }
      const password = readNewPassword(request.body, 'password');
      settings.savePasswordHash(hashPassword(password));
      issueSession(reply, settings);
      return sendSuccess(reply, { configured: true }, 201);
    } catch (error) {
      return sendFailure(reply, error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', '设置访问密码失败'));
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    try {
      const stored = settings.getPasswordHash();
      if (stored == null) throw new ApiError(409, 'NOT_CONFIGURED', '尚未设置访问密码');
      const password = readPasswordField(request.body, 'password');
      if (!verifyPassword(password, stored)) {
        throw new ApiError(401, 'INVALID_PASSWORD', '访问密码不正确');
      }
      issueSession(reply, settings);
      return sendSuccess(reply, { authenticated: true });
    } catch (error) {
      return sendFailure(reply, error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', '登录失败'));
    }
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSession(reply);
    return sendSuccess(reply, { authenticated: false });
  });

  app.post('/api/auth/change-password', async (request, reply) => {
    try {
      const body = asRecord(request.body);
      const currentPassword = readPasswordField(body, 'currentPassword');
      const newPassword = readNewPassword(body, 'newPassword');
      const stored = settings.getPasswordHash();
      if (stored == null || !verifyPassword(currentPassword, stored)) {
        throw new ApiError(401, 'INVALID_PASSWORD', '当前访问密码不正确');
      }
      // 轮换会话密钥使其他设备上的旧会话失效，本设备换发新 cookie 保持登录。
      settings.savePasswordHash(hashPassword(newPassword));
      settings.rotateSessionSecret();
      issueSession(reply, settings);
      return sendSuccess(reply, { configured: true });
    } catch (error) {
      return sendFailure(reply, error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', '修改访问密码失败'));
    }
  });
}

/**
 * 全局访问控制：已设置访问密码后，除公共路径（认证端点、健康检查）外，
 * 页面静态资源放行（登录界面本身依赖外壳加载），API 与 /files/ 附件一律要求有效会话。
 */
export async function registerAccessControl(app: FastifyInstance, settings: SettingsRepository): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (PUBLIC_PATHS.has(pathname)) return;
    if (settings.getPasswordHash() == null) return;
    if (isAuthenticated(settings, request)) return;
    // 静态外壳放行，数据面（API 与附件）拦截：未登录时页面能加载并由前端展示登录界面。
    if (!pathname.startsWith('/api/') && !pathname.startsWith('/files/')) return;
    void reply.status(401).send({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请先输入访问密码' } });
  });
}
