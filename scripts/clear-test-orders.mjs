#!/usr/bin/env node
/**
 * 清空测试订单及其关联数据（箱唛、水单、发票、发货批次、打印历史）。
 * 默认 dry-run；加 --yes 才执行，执行前会先用 VACUUM INTO 备份整库。
 * 不动产品、客户、报价单、销售单、设置和账号。
 *
 * 用法：
 *   node scripts/clear-test-orders.mjs                  # 只看将删除多少数据
 *   node scripts/clear-test-orders.mjs --yes            # 备份后执行
 *   node scripts/clear-test-orders.mjs --yes --data-dir=/data   # 容器内对线上库执行
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const dataDirArg = args.find((arg) => arg.startsWith('--data-dir='))?.slice('--data-dir='.length);
const dataDir = resolve(dataDirArg || process.env.WORKBENCH_DATA_DIR || 'data');
const dbPath = join(dataDir, 'workbench.sqlite');
const filesRoot = join(dataDir, 'files');

if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');
const one = (sql) => db.prepare(sql).get();
const all = (sql) => db.prepare(sql).all();

const counts = {
  orders: Number(one('SELECT COUNT(*) AS n FROM orders').n),
  orderItems: Number(one('SELECT COUNT(*) AS n FROM order_items').n),
  cartonLabels: Number(one('SELECT COUNT(*) AS n FROM carton_labels').n),
  paymentProofs: Number(one('SELECT COUNT(*) AS n FROM payment_proofs').n),
  receipts: Number(one('SELECT COUNT(*) AS n FROM finance_receipts').n),
  invoices: Number(one('SELECT COUNT(*) AS n FROM finance_invoices').n),
  contracts: Number(one('SELECT COUNT(*) AS n FROM order_contracts').n),
  shipmentBatches: Number(one('SELECT COUNT(*) AS n FROM shipment_batches').n),
  printHistories: Number(one('SELECT COUNT(*) AS n FROM print_histories').n),
};

console.log(`数据库：${dbPath}`);
console.log('将清空：');
console.log(`  订单 ${counts.orders} 条 / 产品行 ${counts.orderItems} 条 / 箱唛 ${counts.cartonLabels} 个`);
console.log(`  水单 ${counts.paymentProofs} 张 / 已入账 ${counts.receipts} 笔 / 发票 ${counts.invoices} 张`);
console.log(`  订单附件 ${counts.contracts} 个 / 发货批次 ${counts.shipmentBatches} 个 / 打印历史 ${counts.printHistories} 条`);
console.log('保留：产品、客户、报价单、销售单、图册、设置、账号。');

if (!yes) {
  console.log('\n这是 dry-run，没有改动任何数据。确认后加 --yes 执行。');
  db.close();
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const backupDir = join(dataDir, 'backups');
mkdirSync(backupDir, { recursive: true });
const backupPath = join(backupDir, `清测试订单前-${stamp}.sqlite`);
db.exec(`VACUUM INTO '${backupPath.replace(/\\/g, '/').replace(/'/g, "''")}'`);
console.log(`\n已备份：${backupPath}`);

const filePaths = [
  ...all('SELECT relative_path FROM order_contracts'),
  ...all('SELECT relative_path FROM payment_proofs'),
  ...all('SELECT relative_path FROM order_detail_images'),
  ...all(`SELECT f.relative_path FROM finance_invoice_files f JOIN finance_invoices i ON i.id = f.invoice_id`),
  ...all(`SELECT a.relative_path FROM order_item_requirement_attachments a JOIN order_items i ON i.id = a.order_item_id`),
].map((row) => String(row.relative_path ?? '')).filter(Boolean);

db.exec('BEGIN');
try {
  db.exec(`
    DELETE FROM shipment_batch_orders;
    DELETE FROM shipments;
    DELETE FROM shipment_batches;
    DELETE FROM print_history_labels;
    DELETE FROM print_histories;
    DELETE FROM orders;
  `);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  db.close();
  console.error('清库失败，已回滚：', error instanceof Error ? error.message : error);
  process.exit(1);
}

let removedFiles = 0;
for (const relativePath of new Set(filePaths)) {
  const target = resolve(filesRoot, relativePath);
  if (target !== filesRoot && !target.startsWith(`${filesRoot}${sep}`)) continue;
  try {
    unlinkSync(target);
    removedFiles += 1;
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(`文件删除失败：${relativePath}`);
  }
}

console.log(`已清空订单及关联数据，删除附件文件 ${removedFiles} 个。`);
console.log('如服务正在运行，请重启一次，让内存中的列表立即刷新。');
db.close();
