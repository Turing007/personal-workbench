import { join, resolve } from 'node:path';
import { normalizeEnvironment, type WorkbenchEnvironment } from '../shared/environment.js';

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_CONTRACT_SIZE = 20 * 1024 * 1024;
/** 产品视频上限：手机拍 1~2 分钟 1080p 够用，同时按住备份 ZIP 的体积。 */
export const MAX_VIDEO_SIZE = 200 * 1024 * 1024;
export const ALLOWED_CONTRACT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export const ALLOWED_CONTRACT_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
] as const;

export const MAX_INVOICE_SIZE = 20 * 1024 * 1024;
export const ALLOWED_INVOICE_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export const ALLOWED_INVOICE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'] as const;

export const ALLOWED_PRODUCT_ATTACHMENT_EXTENSIONS = [
  ...ALLOWED_CONTRACT_EXTENSIONS,
  '.txt',
  '.zip',
  '.rar',
  '.7z',
  '.ai',
  '.psd',
  '.cdr',
  '.dwg',
  '.dxf',
] as const;

/** 产品视频允许的扩展名（按扩展名判定，和老 ROM 上拿不到可靠 MIME 的机型兼容）。 */
export const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
export type AllowedContractMimeType = (typeof ALLOWED_CONTRACT_MIME_TYPES)[number];

export interface WorkbenchConfig {
  host: string;
  port: number;
  /** 反向代理部署时置 true，Cookie 的 secure 属性跟随代理协议。 */
  trustProxy: boolean;
  projectDirectory: string;
  dataDirectory: string;
  databasePath: string;
  filesDirectory: string;
  productImagesDirectory: string;
  customerProductImagesDirectory: string;
  paymentProofsDirectory: string;
  orderContractsDirectory: string;
  orderDetailImagesDirectory: string;
  productAttachmentsDirectory: string;
  customerProductAttachmentsDirectory: string;
  orderItemRequirementsDirectory: string;
  companyLogosDirectory: string;
  quotationAssetsDirectory: string;
  salesDocumentAssetsDirectory: string;
  salesReceiptProofsDirectory: string;
  financeInvoicesDirectory: string;
  backupsDirectory: string;
  maxImageSize: number;
  allowedImageMimeTypes: readonly AllowedImageMimeType[];
  maxContractSize: number;
  allowedContractMimeTypes: readonly AllowedContractMimeType[];
  environment: WorkbenchEnvironment;
}

export function createConfig(projectDirectory = process.cwd()): WorkbenchConfig {
  const projectRoot = resolve(projectDirectory);
  const dataDirectory = resolve(process.env.WORKBENCH_DATA_DIR ?? join(projectRoot, 'data'));
  const filesDirectory = join(dataDirectory, 'files');

  return {
    // 监听所有网卡，手机连同一局域网即可访问；如只想本机使用可设 WORKBENCH_HOST=127.0.0.1。
    host: process.env.WORKBENCH_HOST ?? '0.0.0.0',
    // 刻意避开服务器占用的 52341：本机一旦同时存在两个实例，两份库会各改各的分叉。
    // 镜像里 Dockerfile 与 compose 都显式钉住 52341，所以这里的默认值不影响线上。
    port: Number(process.env.WORKBENCH_PORT ?? 52342),
    // 由部署链路显式设置：本机启动器写 test，Docker 镜像写 production。
    environment: normalizeEnvironment(process.env.WORKBENCH_ENV),
    trustProxy: process.env.WORKBENCH_TRUST_PROXY === '1',
    projectDirectory: projectRoot,
    dataDirectory,
    databasePath: join(dataDirectory, 'workbench.sqlite'),
    filesDirectory,
    productImagesDirectory: join(filesDirectory, 'product-images'),
    customerProductImagesDirectory: join(filesDirectory, 'customer-product-images'),
    paymentProofsDirectory: join(filesDirectory, 'payment-proofs'),
    orderContractsDirectory: join(filesDirectory, 'order-contracts'),
    orderDetailImagesDirectory: join(filesDirectory, 'order-detail-images'),
    productAttachmentsDirectory: join(filesDirectory, 'product-attachments'),
    customerProductAttachmentsDirectory: join(filesDirectory, 'customer-product-attachments'),
    orderItemRequirementsDirectory: join(filesDirectory, 'order-item-requirements'),
    companyLogosDirectory: join(filesDirectory, 'company-logos'),
    quotationAssetsDirectory: join(filesDirectory, 'quotation-assets'),
    salesDocumentAssetsDirectory: join(filesDirectory, 'sales-document-assets'),
    salesReceiptProofsDirectory: join(filesDirectory, 'sales-receipt-proofs'),
    financeInvoicesDirectory: join(filesDirectory, 'finance-invoices'),
    backupsDirectory: join(dataDirectory, 'backups'),
    maxImageSize: MAX_IMAGE_SIZE,
    allowedImageMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
    maxContractSize: MAX_CONTRACT_SIZE,
    allowedContractMimeTypes: ALLOWED_CONTRACT_MIME_TYPES,
  };
}

export const config = createConfig();
