import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/server/app';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { FileStore } from '../../src/server/files/file-store';
import { authInject, setupAdmin } from './helpers/auth';

const directories: string[] = [];
const apps: FastifyInstance[] = [];
const databases: DatabaseSync[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const database of databases.splice(0)) database.close();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })));
}, 30_000);

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-thumbs-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  databases.push(database);
  migrateDatabase(database);
  const filesDirectory = join(directory, 'files');
  const fileStore = new FileStore(filesDirectory);
  const app = await createApp({ database, fileStore, dataDirectory: directory, filesDirectory });
  apps.push(app);
  await setupAdmin(app);
  return { app, fileStore, directory };
}

/** 造一张真实 JPEG（照片场景：大尺寸 + 噪点，压缩后仍有明显体积）。 */
async function createPhoto(): Promise<Buffer> {
  const width = 1600;
  const height = 1200;
  const noise = Buffer.alloc(width * height * 3);
  for (let index = 0; index < noise.length; index += 1) {
    noise[index] = (index * 37) % 256;
  }
  return sharp(noise, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

describe('缩略图接口', () => {
  it('把原图转成小尺寸 WebP，并缓存复用', async () => {
    const { app, fileStore, directory } = await createFixture();
    const original = await createPhoto();
    const stored = await fileStore.saveImage(Readable.from(original), 'product', 'photo.jpg', 'image/jpeg');

    const response = await authInject(app, { method: 'GET', url: `/api/thumbs/240/${stored.relativePath}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/webp');
    expect(response.headers['cache-control']).toContain('immutable');

    const thumbnail = Buffer.from(response.rawPayload);
    expect(thumbnail.length).toBeLessThan(original.length / 4);
    const metadata = await sharp(thumbnail).metadata();
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(240);

    // 首次请求落盘缓存，第二次直接命中缓存且字节一致
    const cacheFiles = await readdir(join(directory, 'thumbnails', '240', 'product-images'));
    expect(cacheFiles).toHaveLength(1);
    const cached = await stat(join(directory, 'thumbnails', '240', 'product-images', cacheFiles[0]));
    expect(cached.size).toBe(thumbnail.length);

    const again = await authInject(app, { method: 'GET', url: `/api/thumbs/240/${stored.relativePath}` });
    expect(again.statusCode).toBe(200);
    expect(Buffer.from(again.rawPayload).equals(thumbnail)).toBe(true);
  });

  it('拒绝非法尺寸、非图片文件与越权访问', async () => {
    const { app, fileStore, directory } = await createFixture();
    const stored = await fileStore.saveImage(Readable.from(await createPhoto()), 'product', 'photo.jpg', 'image/jpeg');

    const badSize = await authInject(app, { method: 'GET', url: `/api/thumbs/123/${stored.relativePath}` });
    expect(badSize.statusCode).toBe(400);
    expect(badSize.json().error.code).toBe('INVALID_THUMBNAIL_SIZE');

    const pdf = await authInject(app, { method: 'GET', url: '/api/thumbs/240/product-attachments/spec.pdf' });
    expect(pdf.statusCode).toBe(415);
    expect(pdf.json().error.code).toBe('THUMBNAIL_UNSUPPORTED');

    const missing = await authInject(app, { method: 'GET', url: '/api/thumbs/240/product-images/not-exists.png' });
    expect(missing.statusCode).toBe(404);

    // 未登录不允许访问缩略图（遵循全局鉴权门）
    const anonymous = await app.inject({ method: 'GET', url: `/api/thumbs/240/${stored.relativePath}` });
    expect(anonymous.statusCode).toBe(401);

    // 路径穿越不会成功读到 files 之外的任何文件
    const traversal = await authInject(app, { method: 'GET', url: '/api/thumbs/240/..%2F..%2Fworkbench.sqlite.png' });
    expect([400, 404]).toContain(traversal.statusCode);
    expect(await readdir(join(directory, 'thumbnails', '240')).catch(() => [])).not.toContain('..');
  });
});
