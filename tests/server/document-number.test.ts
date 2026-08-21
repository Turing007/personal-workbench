import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DocumentNumberRepository } from '../../src/server/db/document-number-repository';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('document number repository', () => {
  it('allocates independent daily quotation and sales numbers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-number-'));
    directories.push(directory);
    const database = openDatabase(join(directory, 'workbench.sqlite'));
    migrateDatabase(database);
    const numbers = new DocumentNumberRepository(database);

    expect(numbers.next('quotation', '2026-08-08')).toBe('BJ20260808001');
    expect(numbers.next('quotation', '2026-08-08')).toBe('BJ20260808002');
    expect(numbers.next('sales', '2026-08-08')).toBe('XS20260808001');
    expect(numbers.next('quotation', '2026-08-09')).toBe('BJ20260809001');
    database.close();
  });
});

