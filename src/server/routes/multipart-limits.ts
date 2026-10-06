import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { MAX_CONTRACT_SIZE, MAX_IMAGE_SIZE, MAX_VIDEO_SIZE } from '../config.js';
import { FileStoreError } from '../files/file-store.js';

type PartsOptions = Parameters<FastifyRequest['parts']>[0];
type FileOptions = Parameters<FastifyRequest['file']>[0];

const imageOptions = {
  limits: { fileSize: MAX_IMAGE_SIZE },
  throwFileSizeLimit: false,
};

const contractOptions = {
  limits: { fileSize: MAX_CONTRACT_SIZE },
  throwFileSizeLimit: false,
};

const videoOptions = {
  limits: { fileSize: MAX_VIDEO_SIZE },
  throwFileSizeLimit: false,
};

export const imageFileOptions = imageOptions as unknown as FileOptions;
export const contractFileOptions = contractOptions as unknown as FileOptions;
export const videoFileOptions = videoOptions as unknown as FileOptions;
export const imagePartsOptions = imageOptions as unknown as PartsOptions;
export const contractPartsOptions = contractOptions as unknown as PartsOptions;

export function assertMultipartFileNotTruncated(
  part: MultipartFile,
  kind: 'image' | 'contract' | 'video',
): void {
  if (!part.file.truncated) return;
  if (kind === 'image') {
    throw new FileStoreError('IMAGE_TOO_LARGE', `图片不能超过 ${MAX_IMAGE_SIZE / 1024 / 1024}MB`);
  }
  if (kind === 'video') {
    throw new FileStoreError('VIDEO_TOO_LARGE', `视频不能超过 ${MAX_VIDEO_SIZE / 1024 / 1024}MB`);
  }
  throw new FileStoreError('CONTRACT_TOO_LARGE', `合同不能超过 ${MAX_CONTRACT_SIZE / 1024 / 1024}MB`);
}
