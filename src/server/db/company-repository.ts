import type { DatabaseSync } from 'node:sqlite';
import { companyDisplayName, normalizeInvoiceCategories, type Company, type CompanySaveInput } from '../../shared/companies.js';

interface CompanyRow {
  id: number;
  short_name: string;
  full_name: string;
  tax_no: string;
  bank_name: string;
  bank_account: string;
  address: string;
  phone: string;
  contact_name: string;
  remark: string;
  invoice_categories: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export type CompanyErrorCode = 'COMPANY_NOT_FOUND' | 'COMPANY_NAME_EXISTS' | 'COMPANY_IN_USE' | 'COMPANY_NAME_REQUIRED';

export class CompanyRepositoryError extends Error {
  constructor(public readonly code: CompanyErrorCode, message: string) {
    super(message);
    this.name = 'CompanyRepositoryError';
  }
}

/** 数据库里按 JSON 数组保存；历史数据或手工写入的异常值退化为分隔文本解析。 */
function storedInvoiceCategories(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    return normalizeInvoiceCategories(JSON.parse(value));
  } catch {
    return normalizeInvoiceCategories(value);
  }
}

function mapCompany(row: CompanyRow): Company {
  const fullName = String(row.full_name ?? '').trim();
  const displayName = companyDisplayName({ shortName: String(row.short_name ?? ''), fullName });
  return {
    id: Number(row.id),
    // 前端统一把 shortName 当作展示名使用；数据库 short_name 仍保留作兼容与唯一索引。
    shortName: displayName,
    fullName: fullName || displayName,
    taxNo: String(row.tax_no ?? ''),
    bankName: String(row.bank_name ?? ''),
    bankAccount: String(row.bank_account ?? ''),
    address: String(row.address ?? ''),
    phone: String(row.phone ?? ''),
    contactName: String(row.contact_name ?? ''),
    remark: String(row.remark ?? ''),
    invoiceCategories: storedInvoiceCategories(row.invoice_categories),
    isActive: Number(row.is_active) === 1,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export class CompanyRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(includeInactive = false): Company[] {
    const where = includeInactive ? '' : 'WHERE is_active = 1';
    const rows = this.database
      .prepare(`SELECT * FROM companies ${where} ORDER BY is_active DESC, COALESCE(NULLIF(full_name, ''), short_name) COLLATE NOCASE, id`)
      .all() as unknown as CompanyRow[];
    return rows.map(mapCompany);
  }

  get(id: number): Company | undefined {
    const row = this.database.prepare('SELECT * FROM companies WHERE id = ?').get(id) as CompanyRow | undefined;
    return row ? mapCompany(row) : undefined;
  }

  create(input: CompanySaveInput): Company {
    const fullName = text(input.fullName);
    const name = fullName || text(input.shortName);
    if (!name) throw new CompanyRepositoryError('COMPANY_NAME_REQUIRED', '公司名称不能为空');
    const timestamp = new Date().toISOString();
    try {
      const result = this.database.prepare(`
        INSERT INTO companies
          (short_name, full_name, tax_no, bank_name, bank_account, address, phone, contact_name, remark, invoice_categories, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name,
        fullName || name,
        text(input.taxNo),
        text(input.bankName),
        text(input.bankAccount),
        text(input.address),
        text(input.phone),
        text(input.contactName),
        text(input.remark),
        JSON.stringify(normalizeInvoiceCategories(input.invoiceCategories)),
        input.isActive === false ? 0 : 1,
        timestamp,
        timestamp,
      );
      return this.get(Number(result.lastInsertRowid))!;
    } catch (error) {
      if (/UNIQUE constraint failed.*companies/i.test(String(error))) {
        throw new CompanyRepositoryError('COMPANY_NAME_EXISTS', '公司名称已存在');
      }
      throw error;
    }
  }

  update(id: number, input: CompanySaveInput): Company {
    const existing = this.get(id);
    if (!existing) throw new CompanyRepositoryError('COMPANY_NOT_FOUND', '公司不存在');
    const fullName = text(input.fullName);
    const name = fullName || text(input.shortName);
    if (!name) throw new CompanyRepositoryError('COMPANY_NAME_REQUIRED', '公司名称不能为空');
    const timestamp = new Date().toISOString();
    try {
      this.database.prepare(`
        UPDATE companies SET
          short_name = ?, full_name = ?, tax_no = ?, bank_name = ?, bank_account = ?,
          address = ?, phone = ?, contact_name = ?, remark = ?, invoice_categories = ?, is_active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name,
        fullName || name,
        text(input.taxNo),
        text(input.bankName),
        text(input.bankAccount),
        text(input.address),
        text(input.phone),
        text(input.contactName),
        text(input.remark),
        JSON.stringify(normalizeInvoiceCategories(input.invoiceCategories)),
        input.isActive === false ? 0 : 1,
        timestamp,
        id,
      );
      return this.get(id)!;
    } catch (error) {
      if (/UNIQUE constraint failed.*companies/i.test(String(error))) {
        throw new CompanyRepositoryError('COMPANY_NAME_EXISTS', '公司名称已存在');
      }
      throw error;
    }
  }

  countOrders(id: number): number {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM orders WHERE company_id = ?').get(id);
    return Number(row?.count ?? 0);
  }

  remove(id: number): void {
    const existing = this.get(id);
    if (!existing) throw new CompanyRepositoryError('COMPANY_NOT_FOUND', '公司不存在');
    if (this.countOrders(id) > 0) {
      throw new CompanyRepositoryError('COMPANY_IN_USE', '该公司已被订单引用，不能删除；如不再使用请停用');
    }
    this.database.prepare('DELETE FROM companies WHERE id = ?').run(id);
  }
}
