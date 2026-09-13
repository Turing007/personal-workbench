import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from '../routes/api-response.js';
import { hashPassword, verifyPassword } from './password.js';
import type { PublicUser, SessionRecord, UserRole, UserRepository } from './user-repository.js';

export const SESSION_COOKIE = 'wb_session';
/** 会话有效期：30 天，滑动续期（活跃使用即自动延长）。 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 距上次续期超过该间隔才写库，避免高频请求放大写入。 */
const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{2,32}$/;
export const MIN_PASSWORD_LENGTH = 8;

const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 10 * 60 * 1000;

interface LoginFailureEntry {
  count: number;
  firstFailureAt: number;
  lockedUntil: number;
}

interface SessionContext {
  user: PublicUser;
  token: string;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 登录鉴权服务：首账号初始化、登录会话、密码修改与账号管理。
 * 会话令牌只存哈希，泄露数据库也无法直接伪造 Cookie。
 */
export class AuthService {
  private readonly loginFailures = new Map<string, LoginFailureEntry>();

  constructor(private readonly users: UserRepository) {}

  isInitialized(): boolean {
    return this.users.countUsers() > 0;
  }

  /** 初始化首个管理员账号；已有账号时拒绝，防止公网上的匿名抢注。 */
  async setupFirstAdmin(input: {
    username: string;
    password: string;
    displayName?: string;
  }): Promise<SessionContext> {
    if (this.isInitialized()) {
      throw new ApiError(403, 'AUTH_ALREADY_INITIALIZED', '系统已初始化账号，请直接登录');
    }
    const user = await this.createUserInternal({ ...input, role: 'admin' });
    return { user, token: this.createSession(user.id) };
  }

  async login(input: { username: string; password: string; clientKey: string }): Promise<SessionContext> {
    this.assertNotLocked(input.clientKey);
    const username = input.username.trim().toLowerCase();
    const user = username ? this.users.getUserByUsername(username) : undefined;
    const passwordMatches = user ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !passwordMatches) {
      this.recordLoginFailure(input.clientKey);
      throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS', '用户名或密码错误');
    }
    if (!user.isActive) {
      throw new ApiError(403, 'AUTH_ACCOUNT_DISABLED', '该账号已被停用，请联系管理员');
    }
    this.loginFailures.delete(input.clientKey);
    this.users.purgeExpiredSessions(nowIso());
    return { user: this.toPublic(user), token: this.createSession(user.id) };
  }

  /** 解析会话 Cookie；有效时按需滑动续期。 */
  resolveSession(token: string | undefined): PublicUser | undefined {
    if (!token) return undefined;
    const tokenHashValue = tokenHash(token);
    const user = this.users.findActiveSession(tokenHashValue, nowIso());
    if (!user) return undefined;
    const now = Date.now();
    const session = this.users.getSession(tokenHashValue);
    if (!session || now - Date.parse(session.lastSeenAt) > SESSION_TOUCH_INTERVAL_MS) {
      this.users.touchSession(tokenHashValue, nowIso(), new Date(now + SESSION_TTL_MS).toISOString());
    }
    return this.toPublic(user);
  }

  logout(token: string | undefined): void {
    if (token) this.users.deleteSession(tokenHash(token));
  }

  async changePassword(
    userId: number,
    input: { currentPassword: string; newPassword: string },
    keepToken: string | undefined,
  ): Promise<PublicUser> {
    const user = this.users.getUserById(userId);
    if (!user) throw new ApiError(404, 'NOT_FOUND', '账号不存在');
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new ApiError(400, 'AUTH_INVALID_CREDENTIALS', '当前密码不正确', 'currentPassword');
    }
    this.assertPassword(input.newPassword);
    const passwordHash = await hashPassword(input.newPassword);
    const updated = this.users.updateUser(userId, { passwordHash }, nowIso());
    // 密码变更后吊销本人其他会话，当前会话保留。
    this.users.deleteOtherSessionsForUser(userId, keepToken ? tokenHash(keepToken) : undefined, nowIso());
    return this.toPublic(this.users.getUserById(userId)!);
  }

  listUsers(): PublicUser[] {
    return this.users.listUsers();
  }

  async createUser(input: {
    username: string;
    password: string;
    displayName?: string;
    role?: UserRole;
  }): Promise<PublicUser> {
    return this.createUserInternal(input);
  }

  async updateUser(
    actingUserId: number,
    targetUserId: number,
    patch: {
      displayName?: string;
      password?: string;
      role?: UserRole;
      isActive?: boolean;
    },
  ): Promise<PublicUser> {
    const target = this.users.getUserById(targetUserId);
    if (!target) throw new ApiError(404, 'NOT_FOUND', '账号不存在');
    const updates: { displayName?: string; passwordHash?: string; role?: UserRole; isActive?: boolean } = {};
    if (patch.displayName !== undefined) updates.displayName = patch.displayName;
    if (patch.password !== undefined) {
      this.assertPassword(patch.password);
      updates.passwordHash = await hashPassword(patch.password);
    }
    if (patch.role !== undefined) updates.role = patch.role;
    if (patch.isActive !== undefined) updates.isActive = patch.isActive;
    if (targetUserId === actingUserId && patch.isActive === false) {
      throw new ApiError(409, 'AUTH_SELF_DISABLE', '不能停用自己的账号');
    }
    const losesAdmin = (patch.role !== undefined && patch.role !== 'admin')
      || (patch.isActive === false && target.role === 'admin');
    if (target.role === 'admin' && target.isActive && losesAdmin
      && this.users.countActiveAdmins(targetUserId) === 0) {
      throw new ApiError(409, 'AUTH_LAST_ADMIN', '至少需要保留一名启用的管理员');
    }
    const updated = this.users.updateUser(targetUserId, updates, nowIso());
    if (!updated) throw new ApiError(404, 'NOT_FOUND', '账号不存在');
    if (updates.passwordHash || updates.isActive === false) {
      // 密码重置/停用立即生效：清掉目标用户的其他会话。
      this.users.deleteOtherSessionsForUser(targetUserId, undefined, nowIso());
    }
    return updated;
  }

  private createSession(userId: number): string {
    const token = randomBytes(32).toString('base64url');
    const now = nowIso();
    const session: SessionRecord = {
      id: tokenHash(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };
    this.users.insertSession(session);
    return token;
  }

  private async createUserInternal(input: {
    username: string;
    password: string;
    displayName?: string;
    role?: UserRole;
  }): Promise<PublicUser> {
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      throw new ApiError(400, 'VALIDATION_ERROR', '用户名需为 2-32 位字母、数字、下划线或中划线', 'username');
    }
    this.assertPassword(input.password);
    if (this.users.getUserByUsername(username)) {
      throw new ApiError(409, 'CONFLICT', '该用户名已被使用', 'username');
    }
    const passwordHash = await hashPassword(input.password);
    return this.users.insertUser({
      username,
      displayName: (input.displayName ?? '').trim() || username,
      passwordHash,
      role: input.role ?? 'member',
      now: nowIso(),
    });
  }

  private assertPassword(password: string): void {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(400, 'VALIDATION_ERROR', `密码至少 ${MIN_PASSWORD_LENGTH} 位`, 'password');
    }
  }

  private toPublic(user: { id: number; username: string; displayName: string; role: UserRole; isActive: boolean; createdAt: string; updatedAt: string }): PublicUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private assertNotLocked(clientKey: string): void {
    const entry = this.loginFailures.get(clientKey);
    if (!entry) return;
    if (entry.lockedUntil > Date.now()) {
      const minutes = Math.max(1, Math.ceil((entry.lockedUntil - Date.now()) / 60_000));
      throw new ApiError(429, 'AUTH_RATE_LIMITED', `登录失败次数过多，请约 ${minutes} 分钟后再试`);
    }
    if (Date.now() - entry.firstFailureAt > LOGIN_LOCKOUT_MS) this.loginFailures.delete(clientKey);
  }

  private recordLoginFailure(clientKey: string): void {
    const now = Date.now();
    const entry = this.loginFailures.get(clientKey);
    if (!entry || now - entry.firstFailureAt > LOGIN_LOCKOUT_MS) {
      this.loginFailures.set(clientKey, { count: 1, firstFailureAt: now, lockedUntil: 0 });
      return;
    }
    entry.count += 1;
    if (entry.count >= LOGIN_MAX_FAILURES) {
      entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
    }
  }
}
