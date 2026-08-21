import { Readable } from 'node:stream';
import type { AllowedImageMimeType } from '../config.js';
import {
  FileStore,
  type StagedFile,
  type StoredFile,
} from '../files/file-store.js';

export type DocumentAssetKind = 'quotation-asset' | 'sales-asset';

export interface UploadedDocumentImage {
  stream: NodeJS.ReadableStream;
  originalName: string;
  mimeType: string;
}

export interface DocumentItemImageInput {
  key: string;
  productId?: number;
  sourceRelativePath?: string;
  originalName?: string;
  mimeType?: string;
  upload?: UploadedDocumentImage;
}

export interface PreparedDocumentAsset extends StoredFile {
  key: string;
}

export interface PreparedDocumentAssetBatch {
  readonly assets: readonly PreparedDocumentAsset[];
  readonly stagedFiles: readonly StagedFile[];
  state: 'prepared' | 'committed' | 'rolled-back';
}

export type ProductImageValidator = (
  productId: number,
  relativePath: string,
) => boolean | Promise<boolean>;

export class DocumentAssetError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_DOCUMENT_ASSET'
      | 'PRODUCT_IMAGE_MISMATCH'
      | 'ASSET_BATCH_CLOSED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DocumentAssetError';
  }
}

export class DocumentAssetManager {
  constructor(
    private readonly fileStore: FileStore,
    private readonly validateProductImage: ProductImageValidator,
  ) {}

  async prepareItemImages(
    targetKind: DocumentAssetKind,
    inputs: readonly DocumentItemImageInput[],
  ): Promise<PreparedDocumentAssetBatch> {
    const stagedFiles: StagedFile[] = [];
    const assets: PreparedDocumentAsset[] = [];

    try {
      for (const input of inputs) {
        this.assertValidInput(input);
        let stagedFile: StagedFile;

        if (input.upload) {
          stagedFile = await this.fileStore.stageImage(
            input.upload.stream,
            targetKind,
            input.upload.originalName,
            input.upload.mimeType,
          );
        } else {
          const sourceRelativePath = input.sourceRelativePath as string;
          const productId = input.productId as number;
          if (!(await this.validateProductImage(productId, sourceRelativePath))) {
            throw new DocumentAssetError(
              'PRODUCT_IMAGE_MISMATCH',
              '所选产品图片不属于对应产品',
            );
          }
          const source = await this.fileStore.readFile(sourceRelativePath);
          stagedFile = await this.fileStore.stageImage(
            Readable.from([source]),
            targetKind,
            input.originalName as string,
            input.mimeType as string,
          );
        }

        stagedFiles.push(stagedFile);
        assets.push({
          key: input.key,
          relativePath: stagedFile.relativePath,
          originalName: stagedFile.originalName,
          mimeType: stagedFile.mimeType,
          size: stagedFile.size,
        });
      }
    } catch (error) {
      await Promise.all(stagedFiles.map((stagedFile) => this.fileStore.discardStagedFile(stagedFile)));
      throw error;
    }

    return { assets, stagedFiles, state: 'prepared' };
  }

  async prepareCompanyLogo(
    targetKind: DocumentAssetKind,
    sourceRelativePath: string,
  ): Promise<PreparedDocumentAssetBatch> {
    const source = await this.fileStore.readFile(sourceRelativePath);
    const lowerPath = sourceRelativePath.toLowerCase();
    const mimeType = lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')
      ? 'image/jpeg'
      : lowerPath.endsWith('.webp')
        ? 'image/webp'
        : 'image/png';
    const originalName = sourceRelativePath.split('/').at(-1) ?? 'company-logo.png';
    const stagedFile = await this.fileStore.stageImage(
      Readable.from([source]),
      targetKind,
      originalName,
      mimeType,
    );
    return {
      assets: [{
        key: 'company-logo',
        relativePath: stagedFile.relativePath,
        originalName: stagedFile.originalName,
        mimeType: stagedFile.mimeType,
        size: stagedFile.size,
      }],
      stagedFiles: [stagedFile],
      state: 'prepared',
    };
  }

  async commit(batch: PreparedDocumentAssetBatch): Promise<readonly PreparedDocumentAsset[]> {
    if (batch.state === 'committed') return batch.assets;
    if (batch.state !== 'prepared') {
      throw new DocumentAssetError('ASSET_BATCH_CLOSED', '附件批次已经回滚，不能再次提交');
    }

    try {
      for (const stagedFile of batch.stagedFiles) {
        await this.fileStore.commitStagedFile(stagedFile);
      }
      batch.state = 'committed';
      return batch.assets;
    } catch (error) {
      await this.rollback(batch);
      throw error;
    }
  }

  async rollback(batch: PreparedDocumentAssetBatch): Promise<void> {
    if (batch.state === 'rolled-back') return;

    await Promise.all(batch.stagedFiles.map(async (stagedFile) => {
      await Promise.all([
        this.fileStore.discardStagedFile(stagedFile),
        this.fileStore.deleteFile(stagedFile.relativePath),
      ]);
    }));
    batch.state = 'rolled-back';
  }

  private assertValidInput(input: DocumentItemImageInput): void {
    if (!input.key.trim()) {
      throw new DocumentAssetError('INVALID_DOCUMENT_ASSET', '产品图片关联标识不能为空');
    }

    const sourceCount = Number(Boolean(input.upload)) + Number(Boolean(input.sourceRelativePath));
    if (sourceCount !== 1) {
      throw new DocumentAssetError(
        'INVALID_DOCUMENT_ASSET',
        '每个产品图片必须且只能提供上传文件或产品库图片',
      );
    }

    if (!input.upload) {
      if (!Number.isInteger(input.productId) || (input.productId as number) <= 0) {
        throw new DocumentAssetError('INVALID_DOCUMENT_ASSET', '产品库图片必须提供有效产品 ID');
      }
      if (!input.originalName?.trim() || !input.mimeType?.trim()) {
        throw new DocumentAssetError('INVALID_DOCUMENT_ASSET', '产品库图片缺少文件名或类型');
      }
    }
  }
}

export type { AllowedImageMimeType };
