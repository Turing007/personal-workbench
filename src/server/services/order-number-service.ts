import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from '../db/connection.js';

export function orderDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

export function formatOrderNumber(dateKey: string, sequence: number): string {
  if (!/^\d{8}$/.test(dateKey) || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('订单号日期或流水号无效');
  }
  return `SO${dateKey}${String(sequence).padStart(3, '0')}`;
}

function readSequence(database: DatabaseSync, dateKey: string): number {
  const row = database
    .prepare('SELECT last_value FROM order_number_sequences WHERE sequence_date = ?')
    .get(dateKey) as { last_value?: unknown } | undefined;
  const value = Number(row?.last_value ?? 0);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function findAvailableSequence(database: DatabaseSync, dateKey: string, initial: number): number {
  let sequence = initial;
  do {
    sequence += 1;
  } while (database.prepare('SELECT 1 FROM orders WHERE order_no = ?').get(formatOrderNumber(dateKey, sequence)));
  return sequence;
}

export class OrderNumberService {
  constructor(private readonly database: DatabaseSync) {}

  preview(date = new Date()): string {
    const dateKey = orderDateKey(date);
    const sequence = findAvailableSequence(this.database, dateKey, readSequence(this.database, dateKey));
    return formatOrderNumber(dateKey, sequence);
  }

  next(date = new Date()): string {
    const dateKey = orderDateKey(date);
    return withTransaction(this.database, (database) => {
      const sequence = findAvailableSequence(database, dateKey, readSequence(database, dateKey));
      database
        .prepare(
          `INSERT INTO order_number_sequences (sequence_date, last_value)
           VALUES (?, ?)
           ON CONFLICT(sequence_date) DO UPDATE SET last_value = excluded.last_value`,
        )
        .run(dateKey, sequence);
      return formatOrderNumber(dateKey, sequence);
    });
  }
}
