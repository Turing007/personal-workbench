import { Readable } from 'node:stream';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentAssetError,
  DocumentAssetManager,
} from '../../src/server/documents/document-assets';
import { PdfRenderer, PdfRendererError, closeSharedPdfRenderer } from '../../src/server/documents/pdf-renderer';
import { FileStore } from '../../src/server/files/file-store';

const temporaryDirectories: string[] = [];

async function makeStore(maxSize?: number) {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-documents-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    filesDirectory: join(directory, 'files'),
    store: new FileStore(join(directory, 'files'), maxSize),
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('document file storage', () => {
  it.each([
    ['product', 'product-images'],
    ['payment', 'payment-proofs'],
    ['company-logo', 'company-logos'],
    ['quotation-asset', 'quotation-assets'],
    ['sales-asset', 'sales-document-assets'],
    ['sales-receipt', 'sales-receipt-proofs'],
  ] as const)('stores %s images in %s', async (kind, directoryName) => {
    const { store } = await makeStore();
    const stored = await store.saveImage(Readable.from([Buffer.from('png')]), kind, 'image.png', 'image/png');

    expect(stored.relativePath).toMatch(new RegExp(`^${directoryName}/[0-9a-f-]+\\.png$`));
    expect(await store.readFile(stored.relativePath)).toEqual(Buffer.from('png'));
  });

  it('stages an image outside public directories until it is committed', async () => {
    const { store } = await makeStore();
    const staged = await store.stageImage(
      Readable.from([Buffer.from('staged')]),
      'quotation-asset',
      'quote.png',
      'image/png',
    );

    expect(await pathExists(store.resolvePublicPath(staged.relativePath))).toBe(false);
    const committed = await store.commitStagedFile(staged);
    expect(committed.relativePath).toBe(staged.relativePath);
    expect(await store.readFile(committed.relativePath)).toEqual(Buffer.from('staged'));
  });

  it('discards staged images and cleans oversized failed writes', async () => {
    const { filesDirectory, store } = await makeStore(3);
    const staged = await store.stageImage(
      Readable.from([Buffer.from('ok')]),
      'sales-receipt',
      'proof.png',
      'image/png',
    );

    await store.discardStagedFile(staged);
    await expect(store.commitStagedFile(staged)).rejects.toMatchObject({ code: 'INVALID_STAGED_FILE' });

    await expect(
      store.stageImage(Readable.from([Buffer.from('large')]), 'sales-receipt', 'large.png', 'image/png'),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });

    const stagingDirectory = join(filesDirectory, '.staging');
    expect(await readdir(stagingDirectory)).toEqual([]);
  });

  it('copies an allowed image into a document snapshot directory', async () => {
    const { store } = await makeStore();
    const source = await store.saveImage(
      Readable.from([Buffer.from('source')]),
      'product',
      'product.png',
      'image/png',
    );
    const copied = await store.copyImage(
      source.relativePath,
      'sales-asset',
      'snapshot.png',
      'image/png',
    );

    expect(copied.relativePath).toMatch(/^sales-document-assets\/[0-9a-f-]+\.png$/);
    expect(await store.readFile(copied.relativePath)).toEqual(Buffer.from('source'));
  });

  it('rejects traversal and unsupported public directories', async () => {
    const { store } = await makeStore();

    for (const unsafePath of [
      '../outside.png',
      'quotation-assets/../product-images/source.png',
      'sales-document-assets/../../outside.png',
      'C:\\outside.png',
      '/outside.png',
      '.staging/private.upload',
      'unknown/image.png',
      'company-logos/nested/logo.png',
    ]) {
      expect(() => store.resolvePublicPath(unsafePath)).toThrow();
    }
  });

  it('keeps the image and contract size limits distinct for truncated multipart streams', async () => {
    const { store } = await makeStore();
    const imageStream = Readable.from([Buffer.from('truncated-image')]) as Readable & { truncated?: boolean };
    imageStream.truncated = true;
    const contractStream = Readable.from([Buffer.from('truncated-contract')]) as Readable & { truncated?: boolean };
    contractStream.truncated = true;

    await expect(store.stageImage(imageStream, 'product', 'image.png', 'image/png'))
      .rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    await expect(store.stageFile(contractStream, 'order-contract', 'contract.pdf', 'application/pdf'))
      .rejects.toMatchObject({ code: 'CONTRACT_TOO_LARGE' });
  });
});

describe('document asset manager', () => {
  it('prepares product snapshots and uploaded images as one commit boundary', async () => {
    const { store } = await makeStore();
    const source = await store.saveImage(
      Readable.from([Buffer.from('library')]),
      'product',
      'library.png',
      'image/png',
    );
    const validateProductImage = vi.fn(async (productId: number, relativePath: string) =>
      productId === 7 && relativePath === source.relativePath,
    );
    const manager = new DocumentAssetManager(store, validateProductImage);
    const batch = await manager.prepareItemImages('quotation-asset', [
      {
        key: 'library-item',
        productId: 7,
        sourceRelativePath: source.relativePath,
        originalName: 'library.png',
        mimeType: 'image/png',
      },
      {
        key: 'temporary-item',
        upload: {
          stream: Readable.from([Buffer.from('temporary')]),
          originalName: 'temporary.webp',
          mimeType: 'image/webp',
        },
      },
    ]);

    expect(validateProductImage).toHaveBeenCalledWith(7, source.relativePath, undefined);
    expect(batch.assets).toHaveLength(2);
    await manager.commit(batch);
    await expect(store.readFile(batch.assets[0].relativePath)).resolves.toEqual(Buffer.from('library'));
    await expect(store.readFile(batch.assets[1].relativePath)).resolves.toEqual(Buffer.from('temporary'));

    await manager.rollback(batch);
    expect(await pathExists(store.resolvePublicPath(batch.assets[0].relativePath))).toBe(false);
    expect(await pathExists(store.resolvePublicPath(batch.assets[1].relativePath))).toBe(false);
  });

  it('forwards customer product id to the image validator for customer product snapshots', async () => {
    const { store } = await makeStore();
    const source = await store.saveImage(
      Readable.from([Buffer.from('customer')]),
      'customer-product',
      'glass-gun.png',
      'image/png',
    );
    const validateProductImage = vi.fn(async (_productId: number | undefined, relativePath: string, customerProductId?: number) =>
      customerProductId === 21 && relativePath === source.relativePath);
    const manager = new DocumentAssetManager(store, validateProductImage);
    const batch = await manager.prepareItemImages('quotation-asset', [
      {
        key: 'customer-item',
        customerProductId: 21,
        sourceRelativePath: source.relativePath,
        originalName: 'glass-gun.png',
        mimeType: 'image/png',
      },
    ]);

    expect(validateProductImage).toHaveBeenCalledWith(undefined, source.relativePath, 21);
    expect(batch.assets).toHaveLength(1);
    await manager.commit(batch);
    await expect(store.readFile(batch.assets[0].relativePath)).resolves.toEqual(Buffer.from('customer'));
    await manager.rollback(batch);
  });

  it('rejects product images that do not belong to the selected product', async () => {    const { store } = await makeStore();
    const source = await store.saveImage(
      Readable.from([Buffer.from('library')]),
      'product',
      'library.png',
      'image/png',
    );
    const manager = new DocumentAssetManager(store, async () => false);

    await expect(
      manager.prepareItemImages('sales-asset', [{
        key: 'wrong-product',
        productId: 9,
        sourceRelativePath: source.relativePath,
        originalName: 'library.png',
        mimeType: 'image/png',
      }]),
    ).rejects.toBeInstanceOf(DocumentAssetError);
  });

  it('rolls back every staged or committed image when a batch commit fails', async () => {
    const { store } = await makeStore();
    const manager = new DocumentAssetManager(store, async () => true);
    const batch = await manager.prepareItemImages('sales-asset', [
      {
        key: 'one',
        upload: { stream: Readable.from([Buffer.from('one')]), originalName: 'one.png', mimeType: 'image/png' },
      },
      {
        key: 'two',
        upload: { stream: Readable.from([Buffer.from('two')]), originalName: 'two.png', mimeType: 'image/png' },
      },
    ]);
    const originalCommit = store.commitStagedFile.bind(store);
    let commitCount = 0;
    vi.spyOn(store, 'commitStagedFile').mockImplementation(async (staged) => {
      commitCount += 1;
      if (commitCount === 2) throw new Error('forced commit failure');
      return originalCommit(staged);
    });

    await expect(manager.commit(batch)).rejects.toThrow('forced commit failure');
    for (const asset of batch.assets) {
      expect(await pathExists(store.resolvePublicPath(asset.relativePath))).toBe(false);
    }
  });
});

describe('PDF renderer', () => {
  function createPage(pdf: Buffer) {
    return {
      setContent: vi.fn(async () => undefined),
      emulateMedia: vi.fn(async () => undefined),
      pdf: vi.fn(async () => pdf),
      close: vi.fn(async () => undefined),
    };
  }

  it('prefers Edge, falls back to bundled Chromium, and reuses the browser across renders', async () => {
    const pdf = Buffer.from('%PDF-test');
    const firstPage = createPage(pdf);
    const secondPage = createPage(pdf);
    const browser = {
      newPage: vi.fn()
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage),
      isConnected: vi.fn(() => true),
      close: vi.fn(async () => undefined),
    };
    const launch = vi.fn()
      .mockRejectedValueOnce(new Error('Edge is unavailable'))
      .mockResolvedValueOnce(browser);
    const renderer = new PdfRenderer({ launch } as never);

    await expect(renderer.render('<html><body>报价单</body></html>')).resolves.toEqual(pdf);
    expect(launch).toHaveBeenNthCalledWith(1, { channel: 'msedge', headless: true });
    expect(launch).toHaveBeenNthCalledWith(2, { headless: true });
    // 打印媒体模拟先于内容注入，避免多余排版
    expect(firstPage.emulateMedia).toHaveBeenCalledWith({ media: 'print' });
    expect(firstPage.emulateMedia.mock.invocationCallOrder[0])
      .toBeLessThan(firstPage.setContent.mock.invocationCallOrder[0]);
    expect(firstPage.setContent).toHaveBeenCalledWith('<html><body>报价单</body></html>', { waitUntil: 'load' });
    expect(firstPage.pdf).toHaveBeenCalledWith({
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
    // 渲染后只关闭页面，浏览器保持常驻供下次复用
    expect(firstPage.close).toHaveBeenCalledOnce();
    expect(browser.close).not.toHaveBeenCalled();

    await expect(renderer.render('<html><body>第二份</body></html>')).resolves.toEqual(pdf);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(browser.newPage).toHaveBeenCalledTimes(2);
    expect(secondPage.pdf).toHaveBeenCalledOnce();
  });

  it('relaunches and retries once when the shared browser has crashed', async () => {
    const pdf = Buffer.from('%PDF-test');
    const deadBrowser = {
      newPage: vi.fn(async () => { throw new Error('Target page, context or browser has been closed'); }),
      isConnected: () => false,
      close: vi.fn(async () => undefined),
    };
    const page = createPage(pdf);
    const liveBrowser = {
      newPage: vi.fn(async () => page),
      isConnected: () => true,
      close: vi.fn(async () => undefined),
    };
    const launch = vi.fn()
      .mockResolvedValueOnce(deadBrowser)
      .mockResolvedValueOnce(liveBrowser);
    const renderer = new PdfRenderer({ launch } as never);

    await expect(renderer.render('<html></html>')).resolves.toEqual(pdf);
    expect(launch).toHaveBeenCalledTimes(2);
    // 崩溃的旧浏览器会被关闭回收，不会残留进程
    expect(deadBrowser.close).toHaveBeenCalledOnce();
    expect(page.pdf).toHaveBeenCalledOnce();
  });

  it('throws an identifiable error when both browsers fail to launch', async () => {
    const launch = vi.fn().mockRejectedValue(new Error('browser missing'));
    const renderer = new PdfRenderer({ launch } as never);

    await expect(renderer.render('<html></html>')).rejects.toMatchObject<PdfRendererError>({
      code: 'PDF_RENDER_FAILED',
      name: 'PdfRendererError',
    });
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('closes the shared browser via closeSharedPdfRenderer', async () => {
    const pdf = Buffer.from('%PDF-test');
    const page = createPage(pdf);
    const browser = {
      newPage: vi.fn(async () => page),
      isConnected: () => true,
      close: vi.fn(async () => undefined),
    };
    const launch = vi.fn().mockResolvedValue(browser);
    const renderer = new PdfRenderer({ launch } as never);
    await renderer.render('<html></html>');

    await closeSharedPdfRenderer();

    expect(browser.close).toHaveBeenCalledOnce();
  });
});
