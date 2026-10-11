import type { DatabaseSync } from 'node:sqlite';
import type { CompanySnapshot } from '../../shared/documents.js';
import {
  normalizePackagingPresets,
  type PackagingPreset,
} from '../../shared/packaging-presets.js';
import {
  normalizeAccessoryPrices,
  type AccessoryPrice,
} from '../../shared/accessory-prices.js';
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
const ACCESSORY_PRICES_KEY = 'accessory_prices';
const CATEGORY_ACCESSORY_PRICES_KEY = 'category_accessory_prices';

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
  wechatQrRelativePath: null,
};

function normalizeProfile(value: Partial<CompanySnapshot> | null | undefined): CompanySnapshot {
  return {
    name: String(value?.name ?? '').trim(),
    logoRelativePath: value?.logoRelativePath ? String(value.logoRelativePath) : null,
    phone: String(value?.phone ?? '').trim(),
    address: String(value?.address ?? '').trim(),
    defaultIssuer: String(value?.defaultIssuer ?? '').trim(),
    wechatQrRelativePath: value?.wechatQrRelativePath ? String(value.wechatQrRelativePath) : null,
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

  /** 全店共用的「配件与价格」清单（售价计算器取数）；不做自动播种，空就是空。 */
  readAccessoryPrices(): AccessoryPrice[] {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(ACCESSORY_PRICES_KEY) as { value?: string } | undefined;
    if (!row?.value) return [];
    try {
      return normalizeAccessoryPrices(JSON.parse(row.value));
    } catch {
      return [];
    }
  }

  saveAccessoryPrices(value: unknown): AccessoryPrice[] {
    const items = normalizeAccessoryPrices(value);
    this.database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(ACCESSORY_PRICES_KEY, JSON.stringify(items), new Date().toISOString());
    return items;
  }

  /** 类目配件（按产品分类共享，如电锤的钻头）：整份映射读出。 */
  readCategoryAccessoryPrices(): Record<string, AccessoryPrice[]> {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(CATEGORY_ACCESSORY_PRICES_KEY) as { value?: string } | undefined;
    if (!row?.value) return {};
    try {
      const parsed = JSON.parse(row.value) as Record<string, unknown>;
      const result: Record<string, AccessoryPrice[]> = {};
      for (const [category, items] of Object.entries(parsed ?? {})) {
        const name = category.trim();
        if (name) result[name] = normalizeAccessoryPrices(items);
      }
      return result;
    } catch {
      return {};
    }
  }

  readCategoryAccessoryPricesFor(category: string): AccessoryPrice[] {
    const key = category.trim();
    if (!key) return [];
    return this.readCategoryAccessoryPrices()[key] ?? [];
  }

  saveCategoryAccessoryPrices(category: string, value: unknown): AccessoryPrice[] {
    const key = category.trim();
    if (!key) return [];
    const all = this.readCategoryAccessoryPrices();
    all[key] = normalizeAccessoryPrices(value);
    this.database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(CATEGORY_ACCESSORY_PRICES_KEY, JSON.stringify(all), new Date().toISOString());
    return all[key];
  }
}

