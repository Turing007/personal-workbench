import type { DatabaseSync } from 'node:sqlite';
import type { CompanySnapshot } from '../../shared/documents.js';
import {
  normalizePackagingPresets,
  type PackagingPreset,
} from '../../shared/packaging-presets.js';
import {
  cloneDefaultContractTemplate,
  normalizeContractTemplate,
  type ContractTemplate,
} from '../../shared/contract.js';

const COMPANY_PROFILE_KEY = 'company_profile';
const CONTRACT_TEMPLATE_KEY = 'contract_template';
const AUTO_BACKUP_SETTINGS_KEY = 'auto_backup_settings';
const TUNNEL_URL_KEY = 'tunnel_url';
const PACKAGING_PRESETS_KEY = 'packaging_presets';

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

  /** 内网穿透/隧道地址（供手机在流量网络下访问）；空字符串表示未配置。 */
  getTunnelUrl(): string {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(TUNNEL_URL_KEY) as { value?: string } | undefined;
    return typeof row?.value === 'string' ? row.value : '';
  }

  saveTunnelUrl(value: unknown): string {
    const normalized = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
    this.database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(TUNNEL_URL_KEY, normalized, new Date().toISOString());
    return normalized;
  }

  /** null = 从未写入过，由服务层触发一次自动统计；空数组是用户自己清空的，不再重算。 */
  readPackagingPresets(): PackagingPreset[] | null {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(PACKAGING_PRESETS_KEY) as { value?: string } | undefined;
    if (!row?.value) return null;
    try {
      return normalizePackagingPresets(JSON.parse(row.value));
    } catch {
      return null;
    }
  }

  savePackagingPresets(value: unknown): PackagingPreset[] {
    const presets = normalizePackagingPresets(value);
    this.database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(PACKAGING_PRESETS_KEY, JSON.stringify(presets), new Date().toISOString());
    return presets;
  }
}

