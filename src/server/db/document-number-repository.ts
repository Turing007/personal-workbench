import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './connection.js';

export type DocumentNumberType = 'quotation' | 'sales';

const PREFIXES: Record<DocumentNumberType, string> = {
  quotation: 'BJ',
  sales: 'XS',
};

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new Error('编号日期必须是 YYYY-MM-DD');
  }
}

export class DocumentNumberRepository {
  constructor(private readonly database: DatabaseSync) {}

  next(type: DocumentNumberType, sequenceDate: string): string {
    assertDate(sequenceDate);
    const value = withTransaction(this.database, (database) => {
      const row = database
        .prepare(
          `INSERT INTO document_number_sequences (document_type, sequence_date, last_value)
           VALUES (?, ?, 1)
           ON CONFLICT(document_type, sequence_date)
           DO UPDATE SET last_value = document_number_sequences.last_value + 1
           RETURNING last_value`,
        )
        .get(type, sequenceDate) as { last_value?: number } | undefined;
      const lastValue = Number(row?.last_value ?? 0);
      if (!Number.isSafeInteger(lastValue) || lastValue <= 0) throw new Error('单据编号序列无效');
      return lastValue;
    });
    return `${PREFIXES[type]}${sequenceDate.replaceAll('-', '')}${String(value).padStart(3, '0')}`;
  }
}

