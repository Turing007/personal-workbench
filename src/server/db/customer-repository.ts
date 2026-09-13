import type { DatabaseSync } from 'node:sqlite';
import type { Customer, CustomerSaveInput } from '../../shared/customers.js';

interface CustomerRow extends Record<string, unknown> {
  id: number;
  name: string;
  contact_name: string;
  contact_phone: string;
  shipping_info: string;
  invoice_title: string;
  tax_no: string;
  is_active: number;
  product_count: number;
  incomplete_product_count: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerListOptions {
  search?: string;
  includeInactive?: boolean;
}

export type CustomerDeleteResult =
  | { mode: 'deleted'; id: number }
  | { mode: 'deactivated'; customer: Customer };

const customerSelect = `
  SELECT
    c.id,
    c.name,
    c.contact_name,
    c.contact_phone,
    c.shipping_info,
    c.invoice_title,
    c.tax_no,
    c.is_active,
    c.created_at,
    c.updated_at,
    COUNT(cp.id) AS product_count,
    COALESCE(SUM(
      CASE
        WHEN cp.id IS NOT NULL AND (
          typeof(cp.sku) <> 'text'
          OR trim(cp.sku) = ''
          OR typeof(cp.pack_count) <> 'integer'
          OR cp.pack_count <= 0
          OR cp.pack_count > 9007199254740991
          OR typeof(cp.final_price_cents) <> 'integer'
          OR cp.final_price_cents < 0
          OR cp.final_price_cents > 9007199254740991
        ) THEN 1
        ELSE 0
      END
    ), 0) AS incomplete_product_count
  FROM customers c
  LEFT JOIN customer_products cp ON cp.customer_id = c.id
`;

function mapCustomer(row: CustomerRow | undefined): Customer | undefined {
  if (!row) return undefined;
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    contactName: String(row.contact_name ?? ''),
    contactPhone: String(row.contact_phone ?? ''),
    shippingInfo: String(row.shipping_info ?? ''),
    invoiceTitle: String(row.invoice_title ?? ''),
    taxNo: String(row.tax_no ?? ''),
    isActive: Boolean(row.is_active),
    productCount: Number(row.product_count ?? 0),
    incompleteProductCount: Number(row.incomplete_product_count ?? 0),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export class CustomerRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(options: CustomerListOptions = {}): Customer[] {
    const clauses: string[] = [];
    const parameters: string[] = [];
    if (!options.includeInactive) clauses.push('c.is_active = 1');
    if (options.search) {
      clauses.push(`(
        c.name LIKE ? ESCAPE '\\'
        OR c.contact_name LIKE ? ESCAPE '\\'
        OR c.contact_phone LIKE ? ESCAPE '\\'
      )`);
      const pattern = `%${escapeLike(options.search)}%`;
      parameters.push(pattern, pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.database.prepare(`
      ${customerSelect}
      ${where}
      GROUP BY c.id
      ORDER BY
        c.is_active DESC,
        incomplete_product_count DESC,
        c.updated_at DESC,
        c.id DESC
    `).all(...parameters) as CustomerRow[];
    return rows.map((row) => mapCustomer(row)!);
  }

  get(id: number): Customer | undefined {
    const row = this.database.prepare(`
      ${customerSelect}
      WHERE c.id = ?
      GROUP BY c.id
    `).get(id) as CustomerRow | undefined;
    return mapCustomer(row);
  }

  hasName(name: string, excludeId?: number): boolean {
    const row = excludeId === undefined
      ? this.database.prepare('SELECT 1 FROM customers WHERE name = ? LIMIT 1').get(name)
      : this.database.prepare('SELECT 1 FROM customers WHERE name = ? AND id <> ? LIMIT 1').get(name, excludeId);
    return Boolean(row);
  }

  create(input: CustomerSaveInput): Customer {
    const timestamp = new Date().toISOString();
    const result = this.database.prepare(`
      INSERT INTO customers
        (name, contact_name, contact_phone, shipping_info, invoice_title, tax_no, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      input.name,
      input.contactName,
      input.contactPhone,
      input.shippingInfo,
      input.invoiceTitle,
      input.taxNo,
      timestamp,
      timestamp,
    );
    return this.get(Number(result.lastInsertRowid))!;
  }

  update(id: number, input: CustomerSaveInput): Customer | undefined {
    const result = this.database.prepare(`
      UPDATE customers
      SET name = ?, contact_name = ?, contact_phone = ?, shipping_info = ?, invoice_title = ?, tax_no = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name,
      input.contactName,
      input.contactPhone,
      input.shippingInfo,
      input.invoiceTitle,
      input.taxNo,
      new Date().toISOString(),
      id,
    );
    return result.changes ? this.get(id) : undefined;
  }

  setActive(id: number, isActive: boolean): Customer | undefined {
    const result = this.database.prepare(`
      UPDATE customers SET is_active = ?, updated_at = ? WHERE id = ?
    `).run(isActive ? 1 : 0, new Date().toISOString(), id);
    return result.changes ? this.get(id) : undefined;
  }

  hasReferences(id: number): boolean {
    return ['customer_products', 'orders', 'quotations', 'sales_documents'].some((table) => Boolean(
      this.database.prepare(`SELECT 1 FROM ${table} WHERE customer_id = ? LIMIT 1`).get(id),
    ));
  }

  remove(id: number): CustomerDeleteResult | undefined {
    const customer = this.get(id);
    if (!customer) return undefined;
    if (this.hasReferences(id)) {
      return { mode: 'deactivated', customer: this.setActive(id, false)! };
    }
    this.database.prepare('DELETE FROM customers WHERE id = ?').run(id);
    return { mode: 'deleted', id: customer.id };
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
