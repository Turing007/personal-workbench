import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';
import { FileStore } from '../../src/server/files/file-store';
import { registerProductRoutes } from '../../src/server/routes/products';
import { IMAGE_MAX_EDGE, compressImageBuffer } from '../../src/server/files/image-compress';

const directories: string[] = [];
const apps: FastifyInstance[] = [];
const databases: Array<{ close: () => void }> = [];

afterEach(async () => {
  // Windows 下不先关连接和 app，删临时目录会 EBUSY。
  await Promise.all(apps.splice(0).map((app) => app.close()));
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/** 噪声图压不动，才能稳定造出「大于阈值」的真实 JPEG。 */
async function noiseJpeg(width: number, height: number, quality = 92): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

describe('图片压缩规则', () => {
  it('超尺寸图重采样到长边上限并变小', async () => {
    const source = await noiseJpeg(3000, 1200);
    const result = await compressImageBuffer(source);
    expect(result.reason).toBe('compressed');
    expect(result.buffer).toBeTruthy();
    const metadata = await sharp(result.buffer!).metadata();
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(IMAGE_MAX_EDGE);
    expect(result.buffer!.length).toBeLessThan(source.length);
  });

  it('已经够小的图不再重压，避免白掉画质', async () => {
    const source = await noiseJpeg(300, 200, 80);
    const result = await compressImageBuffer(source);
    expect(result.buffer).toBeNull();
    expect(result.reason).toBe('already-small');
  });

  it('非图片字节原样放过', async () => {
    const result = await compressImageBuffer(Buffer.from('这不是一张图片'));
    expect(result.buffer).toBeNull();
    expect(result.reason).toBe('unsupported');
  });

  it('GIF 一律不动（可能带动画，重编码会只剩第一帧）', async () => {
    const gif = await sharp(await noiseJpeg(320, 240, 80)).gif().toBuffer();
    const result = await compressImageBuffer(gif);
    expect(result.buffer).toBeNull();
    expect(result.reason).toBe('unsupported');
  });
});

describe('产品图片上传时压缩', () => {
  it('上传大图后落盘的是压过的版本，size_bytes 与磁盘一致', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-compress-'));
    directories.push(directory);
    const database = openDatabase(join(directory, 'workbench.sqlite'));
    databases.push(database);
    migrateDatabase(database);
    const repositories = new DatabaseRepositories(database);
    const app = Fastify();
    await app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } });
    const fileStore = new FileStore(join(directory, 'files'));
    await registerProductRoutes(app, { repositories, fileStore });
    apps.push(app);

    const created = await app.inject({ method: 'POST', url: '/api/products', payload: { name: '压缩测试', status: 'active', packaging: [{ name: '彩盒包装', packCount: 10 }] } });
    const product = (await created.json()).data as { id: number };
    const source = await noiseJpeg(3000, 1200);

    const boundary = `----compress-${Date.now()}`;
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/products/${product.id}/images`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="大图.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
        source,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(uploaded.statusCode).toBe(201);
    const image = (await uploaded.json()).data as { id: number; relativePath: string; size: number };

    const stored = await readFile(join(directory, 'files', image.relativePath));
    const metadata = await sharp(stored).metadata();
    expect((await stat(join(directory, 'files', image.relativePath))).size).toBe(image.size);
    expect(image.size).toBeLessThan(source.length);
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(IMAGE_MAX_EDGE);
    // 数据库里记的体积必须等于磁盘真实体积，否则备份清单和空间统计都会说谎
    expect(database.prepare('SELECT size_bytes FROM product_images WHERE id = ?').get(image.id)).toMatchObject({ size_bytes: image.size });
  });
});
