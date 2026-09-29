import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { compressImageBuffer } from './image-compress.js';
import {
  ALLOWED_CONTRACT_EXTENSIONS,
  ALLOWED_CONTRACT_MIME_TYPES,
  ALLOWED_INVOICE_EXTENSIONS,
  ALLOWED_INVOICE_MIME_TYPES,
  ALLOWED_PRODUCT_ATTACHMENT_EXTENSIONS,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_CONTRACT_SIZE,
  MAX_IMAGE_SIZE,
  MAX_INVOICE_SIZE,
  type AllowedImageMimeType,
} from '../config.js';

export type FileKind =
  | 'product'
  | 'product-packaging'
  | 'customer-product'
  | 'payment'
  | 'company-logo'
  | 'quotation-asset'
  | 'sales-asset'
  | 'sales-receipt'
  | 'order-contract'
  | 'order-detail'
  | 'product-attachment'
  | 'customer-product-attachment'
  | 'order-item-requirement'
  | 'finance-invoice';

export type PublicFileDirectory =
  | 'product-images'
  | 'product-packaging-images'
  | 'customer-product-images'
  | 'payment-proofs'
  | 'company-logos'
  | 'quotation-assets'
  | 'sales-document-assets'
  | 'sales-receipt-proofs'
  | 'order-contracts'
  | 'order-detail-images'
  | 'product-attachments'
  | 'customer-product-attachments'
  | 'order-item-requirements'
  | 'finance-invoices';

export interface StoredFile {
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface StagedFile extends StoredFile {
  stagingId: string;
}

export class FileStoreError extends Error {
  constructor(
    public readonly code:
      | 'UNSUPPORTED_IMAGE_TYPE'
      | 'IMAGE_TOO_LARGE'
      | 'UNSUPPORTED_CONTRACT_TYPE'
      | 'CONTRACT_TOO_LARGE'
      | 'UNSUPPORTED_PRODUCT_ATTACHMENT_TYPE'
      | 'PRODUCT_ATTACHMENT_TOO_LARGE'
      | 'UNSUPPORTED_INVOICE_TYPE'
      | 'INVOICE_TOO_LARGE'
      | 'INVALID_FILE_PATH'
      | 'INVALID_FILE_NAME'
      | 'INVALID_STAGED_FILE',
    message: string,
  ) {
    super(message);
    this.name = 'FileStoreError';
  }
}

const mimeExtensions: Record<AllowedImageMimeType, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const contractExtensionsByMime: Record<string, readonly string[]> = {
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

function assertAllowedInvoiceFile(originalName: string, mime: string): string {
  if (!(ALLOWED_INVOICE_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new FileStoreError('UNSUPPORTED_INVOICE_TYPE', '发票仅支持 PDF、PNG、JPEG 或 WebP 文件');
  }
  const base = basename(originalName.replaceAll('\\', '/'));
  const extension = base.toLowerCase().slice(base.lastIndexOf('.'));
  const extensions = mime === 'application/pdf' ? ['.pdf'] : mime === 'image/png' ? ['.png'] : mime === 'image/jpeg' ? ['.jpg', '.jpeg'] : ['.webp'];
  if (!(ALLOWED_INVOICE_EXTENSIONS as readonly string[]).includes(extension) || !extensions.includes(extension)) {
    throw new FileStoreError('UNSUPPORTED_INVOICE_TYPE', '发票文件扩展名与文件类型不匹配');
  }
  return extension;
}

const directoryByKind: Record<FileKind, PublicFileDirectory> = {
  product: 'product-images',
  'product-packaging': 'product-packaging-images',
  'customer-product': 'customer-product-images',
  payment: 'payment-proofs',
  'company-logo': 'company-logos',
  'quotation-asset': 'quotation-assets',
  'sales-asset': 'sales-document-assets',
  'sales-receipt': 'sales-receipt-proofs',
  'order-contract': 'order-contracts',
  'order-detail': 'order-detail-images',
  'product-attachment': 'product-attachments',
  'customer-product-attachment': 'customer-product-attachments',
  'order-item-requirement': 'order-item-requirements',
  'finance-invoice': 'finance-invoices',
};

const publicDirectories = new Set<PublicFileDirectory>(Object.values(directoryByKind));
const stagingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function targetDirectoryName(kind: FileKind): PublicFileDirectory {
  return directoryByKind[kind];
}

function normalizeOriginalName(originalName: string): string {
  const normalized = basename(originalName.replaceAll('\\', '/'));
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new FileStoreError('INVALID_FILE_NAME', '文件名不能为空');
  }
  return normalized;
}

function assertAllowedMime(mime: string): asserts mime is AllowedImageMimeType {
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new FileStoreError('UNSUPPORTED_IMAGE_TYPE', '只允许上传 PNG、JPEG 或 WebP 图片');
  }
}

function assertAllowedContractFile(originalName: string, mime: string): string {
  if (!(ALLOWED_CONTRACT_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new FileStoreError('UNSUPPORTED_CONTRACT_TYPE', '合同仅支持 PDF、Word、Excel 或 PNG/JPEG/WebP 图片');
  }
  const extension = basename(originalName.replaceAll('\\', '/')).toLowerCase().slice(basename(originalName.replaceAll('\\', '/')).lastIndexOf('.'));
  const allowedExtensions = contractExtensionsByMime[mime] ?? [];
  if (!(ALLOWED_CONTRACT_EXTENSIONS as readonly string[]).includes(extension) || !allowedExtensions.includes(extension)) {
    throw new FileStoreError('UNSUPPORTED_CONTRACT_TYPE', '合同文件扩展名与文件类型不匹配');
  }
  return extension;
}

function assertAllowedProductAttachmentFile(originalName: string, _mime: string): string {
  const extension = basename(originalName.replaceAll('\\', '/')).toLowerCase().slice(basename(originalName.replaceAll('\\', '/')).lastIndexOf('.'));
  if (!(ALLOWED_PRODUCT_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new FileStoreError('UNSUPPORTED_PRODUCT_ATTACHMENT_TYPE', '产品附件支持 PDF、Office、图片、压缩包及常见设计源文件');
  }
  return extension;
}

export class FileStore {
  private readonly rootDirectory: string;
  private readonly maxSize: number;
  private readonly maxContractSize: number;

  constructor(rootDirectory: string, maxSize = MAX_IMAGE_SIZE, maxContractSize = MAX_CONTRACT_SIZE) {
    this.rootDirectory = resolve(rootDirectory);
    this.maxSize = maxSize;
    this.maxContractSize = maxContractSize;
  }

  async saveImage(
    stream: NodeJS.ReadableStream,
    kind: FileKind,
    originalName: string,
    mime: string,
  ): Promise<StoredFile> {
    const staged = await this.stageImage(stream, kind, originalName, mime);
    try {
      return await this.commitStagedFile(staged);
    } catch (error) {
      await this.discardStagedFile(staged);
      throw error;
    }
  }

  async stageImage(
    stream: NodeJS.ReadableStream,
    kind: FileKind,
    originalName: string,
    mime: string,
  ): Promise<StagedFile> {
    assertAllowedMime(mime);
    const safeOriginalName = normalizeOriginalName(originalName);
    const directoryName = targetDirectoryName(kind);
    const stagingDirectory = join(this.rootDirectory, '.staging');
    await mkdir(stagingDirectory, { recursive: true });

    const fileId = randomUUID();
    const extension = mimeExtensions[mime];
    const relativePath = `${directoryName}/${fileId}${extension}`;
    const temporaryPath = this.resolveStagingPath(fileId);
    let size = 0;

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > this.maxSize) {
          throw new FileStoreError('IMAGE_TOO_LARGE', `图片不能超过 ${this.maxSize / 1024 / 1024}MB`);
        }
        chunks.push(buffer);
      }

      if ((stream as NodeJS.ReadableStream & { truncated?: boolean }).truncated) {
        throw new FileStoreError('IMAGE_TOO_LARGE', `图片不能超过 ${this.maxSize / 1024 / 1024}MB`);
      }

      await writeFile(temporaryPath, Buffer.concat(chunks));
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }

    return {
      relativePath,
      originalName: safeOriginalName,
      mimeType: mime,
      size,
      stagingId: fileId,
    };
  }

  async saveFile(
    stream: NodeJS.ReadableStream,
    kind: FileKind,
    originalName: string,
    mime: string,
  ): Promise<StoredFile> {
    const staged = await this.stageFile(stream, kind, originalName, mime);
    try {
      return await this.commitStagedFile(staged);
    } catch (error) {
      await this.discardStagedFile(staged);
      throw error;
    }
  }

  async stageFile(
    stream: NodeJS.ReadableStream,
    kind: FileKind,
    originalName: string,
    mime: string,
  ): Promise<StagedFile> {
    if (kind !== 'order-contract' && kind !== 'product-attachment' && kind !== 'customer-product-attachment' && kind !== 'order-item-requirement' && kind !== 'finance-invoice') {
      throw new FileStoreError('INVALID_FILE_PATH', '通用附件类型无效');
    }
    const safeOriginalName = normalizeOriginalName(originalName);
    const extension = kind === 'order-contract'
      ? assertAllowedContractFile(safeOriginalName, mime)
      : kind === 'finance-invoice'
        ? assertAllowedInvoiceFile(safeOriginalName, mime)
        : assertAllowedProductAttachmentFile(safeOriginalName, mime);
    const directoryName = targetDirectoryName(kind);
    const stagingDirectory = join(this.rootDirectory, '.staging');
    await mkdir(stagingDirectory, { recursive: true });

    const fileId = randomUUID();
    const relativePath = `${directoryName}/${fileId}${extension}`;
    const temporaryPath = this.resolveStagingPath(fileId);
    let size = 0;

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        const maxSize = kind === 'finance-invoice' ? MAX_INVOICE_SIZE : this.maxContractSize;
        if (size > maxSize) {
          throw new FileStoreError(kind === 'order-contract' ? 'CONTRACT_TOO_LARGE' : kind === 'finance-invoice' ? 'INVOICE_TOO_LARGE' : 'PRODUCT_ATTACHMENT_TOO_LARGE', `附件不能超过 ${maxSize / 1024 / 1024}MB`);
        }
        chunks.push(buffer);
      }

      if ((stream as NodeJS.ReadableStream & { truncated?: boolean }).truncated) {
        const maxSize = kind === 'finance-invoice' ? MAX_INVOICE_SIZE : this.maxContractSize;
        throw new FileStoreError(kind === 'order-contract' ? 'CONTRACT_TOO_LARGE' : kind === 'finance-invoice' ? 'INVOICE_TOO_LARGE' : 'PRODUCT_ATTACHMENT_TOO_LARGE', `附件不能超过 ${maxSize / 1024 / 1024}MB`);
      }

      await writeFile(temporaryPath, Buffer.concat(chunks));
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }

    return {
      relativePath,
      originalName: safeOriginalName,
      mimeType: mime,
      size,
      stagingId: fileId,
    };
  }

  async commitStagedFile(stagedFile: StagedFile): Promise<StoredFile> {
    const stagingPath = this.resolveStagedFile(stagedFile);
    const finalPath = this.resolvePublicPath(stagedFile.relativePath);
    await mkdir(dirname(finalPath), { recursive: true });

    try {
      await rename(stagingPath, finalPath);
    } catch (error) {
      await rm(stagingPath, { force: true });
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileStoreError('INVALID_STAGED_FILE', '暂存附件不存在或已经处理');
      }
      throw error;
    }

    return this.toStoredFile(stagedFile);
  }

  async discardStagedFile(stagedFile: StagedFile): Promise<void> {
    await rm(this.resolveStagedFile(stagedFile), { force: true });
  }

  async copyImage(
    sourceRelativePath: string,
    targetKind: FileKind,
    originalName: string,
    mime: string,
  ): Promise<StoredFile> {
    const source = await this.readFile(sourceRelativePath);
    const staged = await this.stageImage(Readable.from([source]), targetKind, originalName, mime);
    try {
      return await this.commitStagedFile(staged);
    } catch (error) {
      await this.discardStagedFile(staged);
      throw error;
    }
  }

  async copyFile(
    sourceRelativePath: string,
    targetKind: FileKind,
    originalName: string,
    mime: string,
  ): Promise<StoredFile> {
    const source = await this.readFile(sourceRelativePath);
    const staged = await this.stageFile(Readable.from([source]), targetKind, originalName, mime);
    try {
      return await this.commitStagedFile(staged);
    } catch (error) {
      await this.discardStagedFile(staged);
      throw error;
    }
  }

  resolvePublicPath(relativePath: string): string {
    if (!relativePath || typeof relativePath !== 'string' || relativePath.includes('\0')) {
      throw new FileStoreError('INVALID_FILE_PATH', '附件路径不能为空');
    }

    const slashPath = relativePath.replaceAll('\\', '/');
    if (
      isAbsolute(relativePath) ||
      /^\/?[a-zA-Z]:\//.test(slashPath) ||
      slashPath.startsWith('/') ||
      slashPath.split('/').includes('..')
    ) {
      throw new FileStoreError('INVALID_FILE_PATH', '附件路径不安全');
    }

    const pathParts = slashPath.split('/');
    if (
      pathParts.length !== 2 ||
      !publicDirectories.has(pathParts[0] as PublicFileDirectory) ||
      !pathParts[1] ||
      pathParts[1] === '.' ||
      pathParts[1] === '..'
    ) {
      throw new FileStoreError('INVALID_FILE_PATH', '附件路径必须位于受支持的附件目录中');
    }

    const absolutePath = resolve(this.rootDirectory, ...slashPath.split('/'));
    const rootRelativePath = relative(this.rootDirectory, absolutePath);
    if (rootRelativePath === '..' || rootRelativePath.startsWith(`..${sep}`) || isAbsolute(rootRelativePath)) {
      throw new FileStoreError('INVALID_FILE_PATH', '附件路径超出存储目录');
    }
    return absolutePath;
  }

  async deleteFile(relativePath: string): Promise<void> {
    await rm(this.resolvePublicPath(relativePath), { force: true });
  }

  async readFile(relativePath: string): Promise<Buffer> {
    return readFile(this.resolvePublicPath(relativePath));
  }

  /**
   * 就地把已存好的图片压到展示够用的尺寸：相机原图动辄 4096×3072 / 6MB，
   * 全库四千张就是 6GB 以上，备份体积也跟着线性膨胀。
   * 压缩失败绝不阻断上传——宁可留大图，不能丢图。
   */
  async optimizeStoredImage(stored: StoredFile): Promise<StoredFile> {
    const path = this.resolvePublicPath(stored.relativePath);
    const temporaryPath = `${path}.compressing`;
    try {
      const result = await compressImageBuffer(await readFile(path));
      if (!result.buffer) return stored;
      await writeFile(temporaryPath, result.buffer);
      await rename(temporaryPath, path);
      return { ...stored, size: result.buffer.length };
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      return stored;
    }
  }

  private resolveStagedFile(stagedFile: StagedFile): string {
    if (
      !stagedFile ||
      !stagingIdPattern.test(stagedFile.stagingId) ||
      !stagedFile.relativePath.includes(stagedFile.stagingId)
    ) {
      throw new FileStoreError('INVALID_STAGED_FILE', '暂存附件标识无效');
    }
    this.resolvePublicPath(stagedFile.relativePath);
    return this.resolveStagingPath(stagedFile.stagingId);
  }

  private resolveStagingPath(stagingId: string): string {
    if (!stagingIdPattern.test(stagingId)) {
      throw new FileStoreError('INVALID_STAGED_FILE', '暂存附件标识无效');
    }
    return join(this.rootDirectory, '.staging', `${stagingId}.upload`);
  }

  private toStoredFile(stagedFile: StagedFile): StoredFile {
    return {
      relativePath: stagedFile.relativePath,
      originalName: stagedFile.originalName,
      mimeType: stagedFile.mimeType,
      size: stagedFile.size,
    };
  }
}
