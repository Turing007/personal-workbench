import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';

const directories: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(async () => {
  // 不先关库，Windows 下删临时目录会 EBUSY。
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-image-order-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  databases.push(database);
  migrateDatabase(database);
  return { database, repositories: new DatabaseRepositories(database) };
}

/** 按给定的文件名顺序入库：入库时的顺序就是当初那次乱序上传留下的 sort_order。 */
async function seedInOrder(names: string[]) {
  const { database, repositories } = await fixture();
  const productId = Number((repositories.saveProduct({
    name: '排序测试产品',
    packaging: [{ name: '彩盒包装', packCount: 10 }],
  } as never) as { id?: number }).id);
  for (const [index, name] of names.entries()) {
    repositories.addProductImage(productId, {
      relativePath: `product-images/uuid-${index}.jpg`,
      originalName: name,
      mimeType: 'image/jpeg',
      size: 1024,
    });
  }
  return { database, productId };
}

const storedOrder = (database: ReturnType<typeof openDatabase>, productId: number) => database
  .prepare('SELECT original_name FROM product_images WHERE product_id = ? ORDER BY sort_order, id')
  .all(productId)
  .map((row: { original_name: string }) => row.original_name);

/** 抹掉一次性标记，模拟"迁移还没跑过"的库。 */
function resetMigrationFlag(database: ReturnType<typeof openDatabase>) {
  database.prepare("DELETE FROM settings WHERE key = 'product_images_ordered_by_filename_v25'").run();
}

describe('产品图片按文件名编号重排', () => {
  it('把字符串序的上传结果重排成编号升序，无编号的跟在后面', async () => {
    const { database, productId } = await seedInOrder(['10.jpg', '0.jpg', 'IMG20260503155537.jpg', '2.jpg']);
    // 迁移前：完全按入库顺序存着，10 排在 0 后面第一位。
    expect(storedOrder(database, productId)).toEqual(['10.jpg', '0.jpg', 'IMG20260503155537.jpg', '2.jpg']);

    resetMigrationFlag(database);
    migrateDatabase(database);

    expect(storedOrder(database, productId)).toEqual(['0.jpg', '2.jpg', '10.jpg', 'IMG20260503155537.jpg']);
    // 重排只动 sort_order，不增删行。
    expect(database.prepare('SELECT COUNT(*) c FROM product_images').get()).toMatchObject({ c: 4 });
  });

  it('重排只跑一次：之后手工拖动的顺序不会被启动流程覆盖', async () => {
    const { database, productId } = await seedInOrder(['10.jpg', '0.jpg', '1.jpg']);
    resetMigrationFlag(database);
    migrateDatabase(database);
    expect(storedOrder(database, productId)).toEqual(['0.jpg', '1.jpg', '10.jpg']);

    // 用户手工把 10.jpg 拖到最前。
    database.prepare('UPDATE product_images SET sort_order = 0 WHERE product_id = ? AND original_name = ?').run(productId, '10.jpg');
    database.prepare('UPDATE product_images SET sort_order = sort_order + 1 WHERE product_id = ? AND original_name != ?').run(productId, '10.jpg');

    migrateDatabase(database);
    expect(storedOrder(database, productId)).toEqual(['10.jpg', '0.jpg', '1.jpg']);
  });

  it('同产品内编号重复的保持原有相对顺序', async () => {
    const { database, productId } = await seedInOrder(['0.jpg', '1.jpg', '0.jpg']);
    resetMigrationFlag(database);
    migrateDatabase(database);
    expect(storedOrder(database, productId)).toEqual(['0.jpg', '0.jpg', '1.jpg']);
  });
});
