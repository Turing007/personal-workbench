import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../../src/server/db/migrate';
import { LibraryRepository } from '../../src/server/db/library-repository';

function makeRepository() {
  const database = new DatabaseSync(':memory:');
  migrateDatabase(database);
  return { database, repository: new LibraryRepository(database) };
}

function create(repository: LibraryRepository, overrides: Partial<Parameters<LibraryRepository['create']>[0]> = {}) {
  return repository.create({
    title: '合同模板',
    category: 'contract',
    customerId: null,
    tags: ['合同'],
    note: '',
    originalName: 'contract.pdf',
    relativePath: `library-files/${Math.random().toString(16).slice(2)}.pdf`,
    mimeType: 'application/pdf',
    size: 100,
    contentHash: `hash-${Math.random().toString(16).slice(2)}`,
    createdBy: 'tester',
    ...overrides,
  });
}

describe('资料库仓储', () => {
  it('按分类、客户、关键词和标签筛选，并返回客户名', () => {
    const { database, repository } = makeRepository();
    database.prepare("INSERT INTO customers (name, contact_name, contact_phone, shipping_info, invoice_title, tax_no, is_active, created_at, updated_at) VALUES ('德艺客户', '', '', '', '', '', 1, '2026-01-01', '2026-01-01')").run();
    const customerId = Number(database.prepare('SELECT last_insert_rowid() AS id').get()?.id);
    create(repository, { title: '年度合同', category: 'contract', tags: ['2026'] });
    create(repository, { title: '德艺标贴', category: 'label', customerId, tags: ['箱唛'] });
    create(repository, { title: '包装尺寸图', category: 'product' });

    expect(repository.list({ category: 'label' }).items.map((item) => item.title)).toEqual(['德艺标贴']);
    expect(repository.list({ customerId }).items[0]?.customerName).toBe('德艺客户');
    expect(repository.list({ q: '2026' }).items.map((item) => item.title)).toEqual(['年度合同']);
    expect(repository.list({ q: '箱唛' }).items.map((item) => item.title)).toEqual(['德艺标贴']);
  });

  it('同一内容 hash 能找到重复文件，软删除后不再算重复', () => {
    const { repository } = makeRepository();
    const id = create(repository, { contentHash: 'same-hash' });
    expect(repository.findDuplicate('same-hash')?.id).toBe(id);
    expect(repository.softDelete(id)).toBe(true);
    expect(repository.findDuplicate('same-hash')).toBeUndefined();
    expect(repository.list({ trash: true }).items).toHaveLength(1);
    expect(repository.restore(id)).toBe(true);
    expect(repository.findDuplicate('same-hash')?.id).toBe(id);
  });

  it('彻底删除只允许回收站里的记录，并返回文件路径', () => {
    const { repository } = makeRepository();
    const id = create(repository, { relativePath: 'library-files/a.pdf' });
    expect(repository.purge(id)).toBeUndefined();
    repository.softDelete(id);
    expect(repository.purge(id)).toBe('library-files/a.pdf');
    expect(repository.get(id)).toBeUndefined();
  });

  it('清理超过 30 天的回收站记录', () => {
    const { database, repository } = makeRepository();
    const oldId = create(repository, { relativePath: 'library-files/old.pdf' });
    const freshId = create(repository, { relativePath: 'library-files/fresh.pdf' });
    repository.softDelete(oldId);
    repository.softDelete(freshId);
    database.prepare('UPDATE library_files SET deleted_at = ? WHERE id = ?').run(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(), oldId);
    expect(repository.purgeExpired(30)).toEqual(['library-files/old.pdf']);
    expect(repository.get(oldId)).toBeUndefined();
    expect(repository.get(freshId)).toBeDefined();
  });
});
