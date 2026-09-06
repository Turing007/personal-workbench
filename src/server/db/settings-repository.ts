import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CompanySnapshot } from '../../shared/documents.js';
import {
  cloneDefaultContractTemplate,
  normalizeContractTemplate,
  type ContractTemplate,
} from '../../shared/contract.js';

const COMPANY_PROFILE_KEY = 'company_profile';
const CONTRACT_TEMPLATE_KEY = 'contract_template';
const AUTO_BACKUP_SETTINGS_KEY = 'auto_backup_settings';
const AUTH_PASSWORD_HASH_KEY = 'auth_password_hash';
// 仅是 settings 表里的键名；会话密钥的值在首次访问时用 crypto.randomBytes 生成并入库。
const AUTH_SESSION_KEY_NAME = 'auth_session_key';

export interface AutoBackupSettingsRecord {
  /** 自定义备份目录；空字符串 = 默认目录（数据目录/backups）。 */
  directory: string;
  /** 保留份数（1-30）。 */
  keepCount: number;
}

const DEFAULT_AUTO_BACKUP_SETTINGS: AutoBackupSettingsRecord = {
  directory: '',
  keepCount: 3,
};

function normalizeAutoBackupSettings(value: unknown): AutoBackupSettingsRecord {
  const record = (value ?? {}) as Partial<AutoBackupSettingsRecord>;
  const keepCount = Math.trunc(Number(record.keepCount ?? DEFAULT_AUTO_BACKUP_SETTINGS.keepCount));
  return {
    directory: typeof record.directory === 'string' ? record.directory.trim() : '',
    keepCount: Number.isFinite(keepCount) ? keepCount : DEFAULT_AUTO_BACKUP_SETTINGS.keepCount,
  };
}

export const EMPTY_COMPANY_PROFILE: CompanySnapshot = {
  name: '',
  logoRelativePath: null,
  phone: '',
  address: '',
  defaultIssuer: '',
};

function normalizeProfile(value: Partial<CompanySnapshot> | null | undefined): CompanySnapshot {
  return {
    name: String(value?.name ?? '').trim(),
    logoRelativePath: value?.logoRelativePath ? String(value.logoRelativePath) : null,
    phone: String(value?.phone ?? '').trim(),
    address: String(value?.address ?? '').trim(),
    defaultIssuer: String(value?.defaultIssuer ?? '').trim(),
  };
}

export class SettingsRepository {
  constructor(private readonly database: DatabaseSync) {}

  getCompanyProfile(): CompanySnapshot {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(COMPANY_PROFILE_KEY) as { value?: string } | undefined;
    if (!row?.value) return { ...EMPTY_COMPANY_PROFILE };
    try {
      return normalizeProfile(JSON.parse(row.value) as Partial<CompanySnapshot>);
    } catch {
      return { ...EMPTY_COMPANY_PROFILE };
    }
  }

  saveCompanyProfile(value: Partial<CompanySnapshot>): CompanySnapshot {
    const profile = normalizeProfile(value);
    this.database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(COMPANY_PROFILE_KEY, JSON.stringify(profile), new Date().toISOString());
    return profile;
  }

  getContractTemplate(): ContractTemplate {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(CONTRACT_TEMPLATE_KEY) as { value?: string } | undefined;
    if (!row?.value) return cloneDefaultContractTemplate();
    try {
      return normalizeContractTemplate(JSON.parse(row.value));
    } catch {
      return cloneDefaultContractTemplate();
    }
  }

  saveContractTemplate(value: unknown): ContractTemplate {
    // 统一走共享层归一化，非法数据在这里直接抛错，避免写入脏模板。
    const template = normalizeContractTemplate(value);
    this.database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(CONTRACT_TEMPLATE_KEY, JSON.stringify(template), new Date().toISOString());
    return template;
  }

  getAutoBackupSettings(): AutoBackupSettingsRecord {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(AUTO_BACKUP_SETTINGS_KEY) as { value?: string } | undefined;
    if (!row?.value) return { ...DEFAULT_AUTO_BACKUP_SETTINGS };
    try {
      return normalizeAutoBackupSettings(JSON.parse(row.value));
    } catch {
      return { ...DEFAULT_AUTO_BACKUP_SETTINGS };
    }
  }

  saveAutoBackupSettings(value: Partial<AutoBackupSettingsRecord>): AutoBackupSettingsRecord {
    const merged = normalizeAutoBackupSettings({ ...this.getAutoBackupSettings(), ...value });
    this.database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(AUTO_BACKUP_SETTINGS_KEY, JSON.stringify(merged), new Date().toISOString());
    return merged;
  }

  getPasswordHash(): string | null {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(AUTH_PASSWORD_HASH_KEY) as { value?: string } | undefined;
    return row?.value || null;
  }

  savePasswordHash(hash: string): void {
    this.database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(AUTH_PASSWORD_HASH_KEY, hash, new Date().toISOString());
  }

  /** 首次调用时生成随机会话密钥并持久化，之后每次读取返回同一把密钥。 */
  getSessionSecret(): string {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(AUTH_SESSION_KEY_NAME) as { value?: string } | undefined;
    if (row?.value) return row.value;
    const secret = randomBytes(32).toString('hex');
    this.database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(AUTH_SESSION_KEY_NAME, secret, new Date().toISOString());
    return secret;
  }

  /** 轮换会话密钥：修改访问密码时调用，使所有已签发的旧会话失效。 */
  rotateSessionSecret(): string {
    const secret = randomBytes(32).toString('hex');
    this.database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(AUTH_SESSION_KEY_NAME, secret, new Date().toISOString());
    return secret;
  }
}

