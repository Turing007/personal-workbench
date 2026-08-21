import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type TransactionCallback<T> = (database: DatabaseSync) => T;

/** Opens a SQLite connection with the invariants required by the local app. */
export function openDatabase(databasePath: string): DatabaseSync {
  const absolutePath = resolve(databasePath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  const database = new DatabaseSync(absolutePath, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });

  // Keep these pragmas explicit so a connection opened by a test or a future
  // command-line tool has the same integrity and durability guarantees.
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA synchronous = NORMAL;');
  database.exec('PRAGMA busy_timeout = 5000;');

  return database;
}

/** Runs a callback atomically and restores the original error on rollback. */
export function withTransaction<T>(database: DatabaseSync, callback: TransactionCallback<T>): T {
  if (database.isTransaction) {
    return callback(database);
  }

  database.exec('BEGIN IMMEDIATE;');
  try {
    const result = callback(database);
    database.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK;');
    } catch {
      // Preserve the application error if SQLite is already out of the transaction.
    }
    throw error;
  }
}

export function closeDatabase(database: DatabaseSync): void {
  if (database.isOpen) {
    database.close();
  }
}
