import type { DatabaseSync } from 'node:sqlite';
import type { CompanySnapshot } from '../../shared/documents.js';
import {
  cloneDefaultContractTemplate,
  normalizeContractTemplate,
  type ContractTemplate,
} from '../../shared/contract.js';

const COMPANY_PROFILE_KEY = 'company_profile';
const CONTRACT_TEMPLATE_KEY = 'contract_template';

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
}

