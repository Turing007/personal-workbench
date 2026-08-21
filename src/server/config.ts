import { join, resolve } from 'node:path';

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_CONTRACT_SIZE = 20 * 1024 * 1024;
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

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
export type AllowedContractMimeType = (typeof ALLOWED_CONTRACT_MIME_TYPES)[number];

export interface WorkbenchConfig {
  host: string;
  port: number;
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
}

export function createConfig(projectDirectory = process.cwd()): WorkbenchConfig {
  const projectRoot = resolve(projectDirectory);
  const dataDirectory = resolve(process.env.WORKBENCH_DATA_DIR ?? join(projectRoot, 'data'));
  const filesDirectory = join(dataDirectory, 'files');

  return {
    host: process.env.WORKBENCH_HOST ?? '127.0.0.1',
    port: Number(process.env.WORKBENCH_PORT ?? 52341),
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
