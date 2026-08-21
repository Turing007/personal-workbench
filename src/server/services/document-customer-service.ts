import type { DatabaseSync } from 'node:sqlite';

export interface CustomerSuggestion {
  customerName: string;
  contactName: string;
  contactPhone: string;
  address: string;
}

export class DocumentCustomerService {
  constructor(private readonly database: DatabaseSync) {}

  listSuggestions(query = '', limit = 20): CustomerSuggestion[] {
    const normalizedQuery = query.trim();
    const pattern = `%${normalizedQuery}%`;
    const rows = this.database
      .prepare(
        `SELECT customer_name, contact_name, contact_phone, customer_address AS address, updated_at
         FROM quotations
         WHERE (? = '' OR customer_name LIKE ? OR contact_name LIKE ? OR contact_phone LIKE ? OR customer_address LIKE ?)
         UNION ALL
         SELECT customer_name, contact_name, contact_phone, address, updated_at
         FROM sales_documents
         WHERE (? = '' OR customer_name LIKE ? OR contact_name LIKE ? OR contact_phone LIKE ? OR address LIKE ?)
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(
        normalizedQuery,
        pattern,
        pattern,
        pattern,
        pattern,
        normalizedQuery,
        pattern,
        pattern,
        pattern,
        pattern,
        Math.max(1, Math.min(100, Math.trunc(limit))),
      ) as Array<Record<string, unknown>>;

    const seen = new Set<string>();
    const suggestions: CustomerSuggestion[] = [];
    for (const row of rows) {
      const suggestion = {
        customerName: String(row.customer_name ?? '').trim(),
        contactName: String(row.contact_name ?? '').trim(),
        contactPhone: String(row.contact_phone ?? '').trim(),
        address: String(row.address ?? '').trim(),
      } satisfies CustomerSuggestion;
      const key = JSON.stringify(suggestion);
      if (!suggestion.customerName || seen.has(key)) continue;
      seen.add(key);
      suggestions.push(suggestion);
    }
    return suggestions.slice(0, Math.max(1, Math.min(100, Math.trunc(limit))));
  }
}
