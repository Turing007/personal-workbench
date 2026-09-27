import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';
import { PURCHASE_QUOTE_LIMIT } from '../../src/shared/product-purchase-quotes';

const directories: string[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(async () => {
  // 不先关库，Windows 下删临时目录会 EBUSY。
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-quotes-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  databases.push(database);
  migrateDatabase(database);
  return { database, repositories: new DatabaseRepositories(database) };
}

const quote = (supplier: string, variant: string, price: string, isDefault = false) => ({ supplier, variant, price, isDefault });

describe('产品多档采购报价', () => {
  it('保存产品时写入多档，并把默认档镜像回 products 两列', async () => {
    const { database, repositories } = await fixture();
    const id = Number((repositories.saveProduct({
      name: '冲击扳手',
      supplier: '旧供应商',
      purchasePrice: 99,
      packaging: [{ name: '彩盒包装', packCount: 10 }],
      purchaseQuotes: [quote('德艺堡', '有刷款', '120', true), quote('德艺堡', '无刷款', '140'), quote('良景', '含配件', '135')],
    } as never) as { id?: number }).id);

    const row = database.prepare('SELECT supplier, purchase_price FROM products WHERE id = ?').get(id) as { supplier: string; purchase_price: number };
    expect(row).toEqual({ supplier: '德艺堡', purchase_price: 120 });

    const product = repositories.getProduct(id) as { purchaseQuotes: unknown[] };
    expect(product.purchaseQuotes).toHaveLength(3);
    expect(product.purchaseQuotes[0]).toMatchObject({ supplier: '德艺堡', variant: '有刷款', price: '120', isDefault: true });
    expect(product.purchaseQuotes[1]).toMatchObject({ variant: '无刷款', isDefault: false });
  });

  it('换默认档会同步镜像列，且始终只有一个默认', async () => {
    const { database, repositories } = await fixture();
    const id = Number((repositories.saveProduct({
      name: '逆变器',
      packaging: [{ name: '彩盒包装', packCount: 10 }],
      purchaseQuotes: [quote('德艺堡', '有刷款', '120', true), quote('良景', '无刷款', '140')],
    } as never) as { id?: number }).id);

    repositories.saveProduct({
      id,
      name: '逆变器',
      packaging: [{ name: '彩盒包装', packCount: 10 }],
      purchaseQuotes: [quote('德艺堡', '有刷款', '120'), quote('良景', '无刷款', '140', true)],
    } as never, id);

    const row = database.prepare('SELECT supplier, purchase_price FROM products WHERE id = ?').get(id) as { supplier: string; purchase_price: number };
    expect(row).toEqual({ supplier: '良景', purchase_price: 140 });
    const stored = database.prepare('SELECT COUNT(*) c FROM product_purchase_quotes WHERE is_default = 1 AND product_id = ?').get(id) as { c: number };
    expect(stored.c).toBe(1);
  });

  it('一条默认都没标时第一行当默认；超出上限的行被丢掉；全空行不入库', async () => {
    const { repositories } = await fixture();
    const many = Array.from({ length: PURCHASE_QUOTE_LIMIT + 3 }, (_, index) => quote(`供应商${index}`, '', '10'));
    const id = Number((repositories.saveProduct({
      name: '马刀锯',
      packaging: [{ name: '彩盒包装', packCount: 10 }],
      purchaseQuotes: [...many, quote('', '', '')],
    } as never) as { id?: number }).id);

    const product = repositories.getProduct(id) as { purchaseQuotes: Array<{ isDefault: boolean; supplier: string }> };
    expect(product.purchaseQuotes).toHaveLength(PURCHASE_QUOTE_LIMIT);
    expect(product.purchaseQuotes[0].isDefault).toBe(true);
    expect(product.purchaseQuotes.filter((item) => item.isDefault)).toHaveLength(1);
    expect(product.purchaseQuotes.some((item) => !item.supplier && !item.price)).toBe(false);
  });

  it('不带报价数组的写入（Excel 导入路径）保留原报价，并在缺失时补一条默认档', async () => {
    const { repositories } = await fixture();
    const id = Number((repositories.saveProduct({
      name: '吹风机',
      supplier: '良景',
      purchasePrice: 118,
      packaging: [{ name: '彩盒包装', packCount: 10 }],
    } as never) as { id?: number }).id);

    // 老路径：没有报价数组，应当自动落一条默认档，镜像列与报价一致。
    const seeded = repositories.getProduct(id) as { purchaseQuotes: Array<Record<string, unknown>> };
    expect(seeded.purchaseQuotes).toHaveLength(1);
    expect(seeded.purchaseQuotes[0]).toMatchObject({ supplier: '良景', price: '118', isDefault: true });

    // 再次不带数组保存：已有的多档不能被清掉。
    repositories.saveProduct({ name: '吹风机 1800W', supplier: '良景', purchasePrice: 118, packaging: [{ name: '彩盒包装', packCount: 10 }] } as never, id);
    const kept = repositories.getProduct(id) as { purchaseQuotes: unknown[]; name?: string };
    expect(kept.purchaseQuotes).toHaveLength(1);
    expect(kept.name).toBe('吹风机 1800W');
  });

  it('删除产品时报价行随级联一起清掉', async () => {
    const { database, repositories } = await fixture();
    const id = Number((repositories.saveProduct({
      name: '电剪刀',
      packaging: [{ name: '彩盒包装', packCount: 10 }],
      purchaseQuotes: [quote('德艺堡', '含配件', '120', true), quote('德艺堡', '不含配件', '108')],
    } as never) as { id?: number }).id);
    expect((database.prepare('SELECT COUNT(*) c FROM product_purchase_quotes WHERE product_id = ?').get(id) as { c: number }).c).toBe(2);

    repositories.deleteProduct(id);
    expect(database.prepare('SELECT COUNT(*) c FROM product_purchase_quotes WHERE product_id = ?').get(id)).toEqual({ c: 0 });
  });

  it('迁移把已有的供应商与采购价转成一条默认报价，且重复执行不产生重复行', async () => {
    const { database, repositories } = await fixture();
    repositories.saveProduct({ name: '历史品', supplier: '德艺堡', purchasePrice: 137.5, packaging: [{ name: '彩盒包装', packCount: 10 }] } as never);
    database.prepare('DELETE FROM product_purchase_quotes').run();
    database.prepare("UPDATE products SET supplier = '老供应商', purchase_price = 88").run();

    migrateDatabase(database);
    const once = database.prepare('SELECT COUNT(*) c FROM product_purchase_quotes').get() as { c: number };
    expect(once.c).toBe(1);
    expect(database.prepare('SELECT supplier, price, is_default FROM product_purchase_quotes').get()).toEqual({ supplier: '老供应商', price: 88, is_default: 1 });

    migrateDatabase(database);
    expect((database.prepare('SELECT COUNT(*) c FROM product_purchase_quotes').get() as { c: number }).c).toBe(once.c);
  });
});
