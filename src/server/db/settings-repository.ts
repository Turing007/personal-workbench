import type { DatabaseSync } from 'node:sqlite';
import type { CompanySnapshot } from '../../shared/documents.js';

const COMPANY_PROFILE_KEY = 'company_profile';

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
}

