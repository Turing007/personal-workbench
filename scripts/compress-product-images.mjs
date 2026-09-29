#!/usr/bin/env node
/**
 * 一次性压缩产品图片原图：长边压到 2048、JPEG 质量 80，格式不变。
 *
 * 用法：
 *   node scripts/compress-product-images.mjs --dry-run   # 只统计会省多少，不写盘
 *   node scripts/compress-product-images.mjs             # 真正执行
 *
 * 安全性：
 * - 逐个文件「写临时文件 → rename 覆盖」，任意时刻磁盘上都是完整文件；
 * - 已经够小的图（长边 ≤2048 且 ≤400KB）直接跳过，不反复掉画质；
 * - 重压反而变大的保持原样；
 * - 可重复执行：跑过的文件下一轮会以 already-small 跳过。
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { compressImageFile } from '../src/server/files/image-compress.ts';

const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = 4;
const ROOT = resolve(import.meta.dirname, '..');
const IMAGE_DIRECTORY = join(ROOT, 'data/files/product-images');
const DATABASE_PATH = join(ROOT, 'data/workbench.sqlite');

const entries = (await readdir(IMAGE_DIRECTORY))
  .filter((name) => !name.startsWith('.') && !name.endsWith('.compressing'));

let cursor = 0;
const stats = { compressed: 0, skipped: 0, failed: 0, savedBytes: 0, scanned: entries.length };
const newSizeByFile = new Map();
const startedAt = Date.now();

async function worker() {
  const { readFile } = await import('node:fs/promises');
  while (cursor < entries.length) {
    const name = entries[cursor++];
    const path = join(IMAGE_DIRECTORY, name);
    try {
      if (DRY_RUN) {
        const source = await readFile(path);
        const { compressImageBuffer } = await import('../src/server/files/image-compress.ts');
        const result = await compressImageBuffer(source);
        if (result.buffer) {
          stats.compressed += 1;
          stats.savedBytes += source.length - result.buffer.length;
        } else {
          stats.skipped += 1;
        }
      } else {
        const before = (await stat(path)).size;
        const outcome = await compressImageFile(IMAGE_DIRECTORY, name);
        if (outcome.reason === 'compressed') {
          const after = (await stat(path)).size;
          stats.compressed += 1;
          stats.savedBytes += before - after;
          newSizeByFile.set(name, after);
        } else {
          stats.skipped += 1;
          await unlink(join(IMAGE_DIRECTORY, `${name}.compressing`)).catch(() => undefined);
        }
      }
    } catch (error) {
      stats.failed += 1;
      console.log(`  失败 ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const done = stats.compressed + stats.skipped + stats.failed;
    if (done % 500 === 0) {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      console.log(`  进度 ${done}/${entries.length}｜已省 ${(stats.savedBytes / 1048576).toFixed(0)}MB｜${seconds}s`);
    }
  }
}

console.log(`${DRY_RUN ? '【试运行】' : '【执行】'}目录 ${IMAGE_DIRECTORY}`);
console.log(`待处理 ${entries.length} 个文件，并发 ${CONCURRENCY}`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
console.log(`\n完成：压缩 ${stats.compressed}，跳过 ${stats.skipped}，失败 ${stats.failed}，用时 ${minutes} 分钟`);
console.log(`释放空间：${(stats.savedBytes / 1073741824).toFixed(2)} GB`);

// 把新体积回写到数据库，避免列表与备份清单里显示过期的 size_bytes
if (!DRY_RUN && newSizeByFile.size) {
  const database = new DatabaseSync(DATABASE_PATH);
  try {
    database.exec('PRAGMA busy_timeout = 15000;');
    const update = database.prepare('UPDATE product_images SET size_bytes = ? WHERE relative_path = ?');
    database.exec('BEGIN');
    let written = 0;
    for (const [name, size] of newSizeByFile) {
      const relativePath = `product-images/${name}`;
      written += Number(update.run(size, relativePath).changes);
    }
    database.exec('COMMIT');
    console.log(`已回写 size_bytes：${written} 行（磁盘上 ${newSizeByFile.size} 个文件被改过，差额为孤儿文件）`);
  } finally {
    database.close();
  }
}
