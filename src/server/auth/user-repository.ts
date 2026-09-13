import type { DatabaseSync } from 'node:sqlite';

export type UserRole = 'admin' | 'member';

export interface UserRecord {
  id: number;
  username: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  userId: number;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

function toUserRecord(row: Record<string, unknown>): UserRecord {
  return {
    id: Number(row.id),
    username: String(row.username),
    displayName: String(row.display_name ?? ''),
    passwordHash: String(row.password_hash),
    role: row.role === 'admin' ? 'admin' : 'member',
    isActive: Number(row.is_active) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toPublicUser(record: UserRecord): PublicUser {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    role: record.role,
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** users/sessions 表的数据访问；密码哈希等敏感字段只在本模块内部流转。 */
export class UserRepository {
  constructor(private readonly database: DatabaseSync) {}

  countUsers(): number {
    return Number(this.database.prepare('SELECT COUNT(*) AS count FROM users').get()?.count ?? 0);
  }

  listUsers(): PublicUser[] {
    return this.database
      .prepare('SELECT * FROM users ORDER BY id ASC')
      .all()
      .map((row) => toPublicUser(toUserRecord(row as Record<string, unknown>)));
  }

  getUserByUsername(username: string): UserRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as Record<string, unknown> | undefined;
    return row ? toUserRecord(row) : undefined;
  }

  getUserById(id: number): UserRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? toUserRecord(row) : undefined;
  }

  insertUser(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    role: UserRole;
    now: string;
  }): PublicUser {
    const id = Number(
      this.database
        .prepare(
          `INSERT INTO users (username, display_name, password_hash, role, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(input.username, input.displayName, input.passwordHash, input.role, input.now, input.now)
        .lastInsertRowid,
    );
    const record = this.getUserById(id)!;
    return toPublicUser(record);
  }

  updateUser(
    id: number,
    patch: { displayName?: string; passwordHash?: string; role?: UserRole; isActive?: boolean },
    now: string,
  ): PublicUser | undefined {
    const assignments: string[] = [];
    const values: Array<string | number> = [];
    if (patch.displayName !== undefined) {
      assignments.push('display_name = ?');
      values.push(patch.displayName);
    }
    if (patch.passwordHash !== undefined) {
      assignments.push('password_hash = ?');
      values.push(patch.passwordHash);
    }
    if (patch.role !== undefined) {
      assignments.push('role = ?');
      values.push(patch.role);
    }
    if (patch.isActive !== undefined) {
      assignments.push('is_active = ?');
      values.push(patch.isActive ? 1 : 0);
    }
    if (!assignments.length) return this.getUserById(id);
    assignments.push('updated_at = ?');
    values.push(now, id);
    this.database
      .prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values);
    const record = this.getUserById(id);
    return record ? toPublicUser(record) : undefined;
  }

  /** 统计「有效的管理员」数量：角色为 admin 且账号未停用，可排除指定用户。 */
  countActiveAdmins(excludeUserId?: number): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?")
      .get(excludeUserId ?? -1) as { count: number | bigint } | undefined;
    return Number(row?.count ?? 0);
  }

  insertSession(session: SessionRecord): void {
    this.database
      .prepare(
        `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(session.id, session.userId, session.createdAt, session.lastSeenAt, session.expiresAt);
  }

  /** 返回会话所属的用户；会话不存在或已过期时清理并返回 undefined。 */
  findActiveSession(tokenHash: string, now: string): UserRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT u.*, s.expires_at AS session_expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ?`,
      )
      .get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    if (String(row.session_expires_at) <= now) {
      this.deleteSession(tokenHash);
      return undefined;
    }
    if (Number(row.is_active) !== 1) return undefined;
    return toUserRecord(row);
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      userId: Number(row.user_id),
      createdAt: String(row.created_at),
      lastSeenAt: String(row.last_seen_at),
      expiresAt: String(row.expires_at),
    };
  }

  touchSession(tokenHash: string, lastSeenAt: string, expiresAt: string): void {
    this.database
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(lastSeenAt, expiresAt, tokenHash);
  }

  deleteSession(tokenHash: string): void {
    this.database.prepare('DELETE FROM sessions WHERE id = ?').run(tokenHash);
  }

  deleteOtherSessionsForUser(userId: number, keepTokenHash: string | undefined, now: string): void {
    if (keepTokenHash) {
      this.database
        .prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ? AND expires_at > ?')
        .run(userId, keepTokenHash, now);
      return;
    }
    this.database.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at > ?').run(userId, now);
  }

  /** 登录时顺带清理过期会话，避免 sessions 无限增长。 */
  purgeExpiredSessions(now: string): void {
    this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  }
}
