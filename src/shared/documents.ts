export type QuotationStatus = 'draft' | 'sent' | 'won' | 'expired';

export type SalesDocumentStatus = 'draft' | 'issued' | 'void';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface CompanySnapshot {
  name: string;
  logoRelativePath: string | null;
  phone: string;
  address: string;
  defaultIssuer: string;
  /** 微信二维码图片（图册封面用）；未上传为 null。 */
  wechatQrRelativePath: string | null;
}

export type QuotationColumnKey =
  | 'image'
  | 'name'
  | 'specification'
  | 'unitPrice'
  | 'tierPrice'
  | 'remark';

export interface QuotationPriceTier {
  minQuantity: number;
  maxQuantity: number | null;
  unitPriceCents: number;
}

export interface QuotationDisplayConfig {
  showLogo: boolean;
  showCompanyPhone: boolean;
  showCompanyAddress: boolean;
  showContactPhone: boolean;
  showTax: boolean;
  showTaxIncludedTotal: boolean;
  columns: Record<QuotationColumnKey, boolean>;
}

export type SalesDocumentColumnKey =
  | 'productCode'
  | 'productName'
  | 'specification'
  | 'quantity'
  | 'unitPrice'
  | 'amount'
  | 'remark';

export interface SalesDocumentDisplayConfig {
  showLogo: boolean;
  showCompanyPhone: boolean;
  showCompanyAddress: boolean;
  showProductImages: boolean;
  columns: Record<SalesDocumentColumnKey, boolean>;
}

export interface DocumentProductSnapshot {
  productId: number | null;
  customerProductId: number | null;
  isTemporary: boolean;
  name: string;
  sku: string;
  specification: string;
  parameters: string;
  packCount: number | null;
  imageRelativePath: string | null;
}

export interface QuotationItem extends DocumentProductSnapshot {
  id: number;
  quotationId: number;
  unitPriceCents: number;
  priceTiers?: QuotationPriceTier[];
  remark: string;
  sortOrder: number;
}

export interface SalesDocumentItem extends DocumentProductSnapshot {
  id: number;
  salesDocumentId: number;
  productCode: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  remark: string;
  sortOrder: number;
}

export interface QuotationCustomField {
  id: number;
  quotationId: number;
  placement: 'header' | 'footer';
  label: string;
  value: string;
  sortOrder: number;
}

export interface SalesReceiptFile {
  id: number;
  receiptId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface SalesReceipt {
  id: number;
  salesDocumentId: number;
  receivedAt: string;
  amountCents: number;
  paymentMethod: string;
  note: string;
  files: SalesReceiptFile[];
  createdAt: string;
}

export interface QuotationSummary {
  id: number;
  number: string;
  status: QuotationStatus;
  quotationDate: string;
  customerId: number | null;
  customerName: string;
  contactName: string;
  contactPhone: string;
  totalCents: number;
  updatedAt: string;
}

export interface QuotationDetail extends QuotationSummary {
  customerAddress: string;
  validUntil: string;
  remark: string;
  taxRateBps: number;
  subtotalCents: number;
  taxCents: number;
  companySnapshot: CompanySnapshot;
  displayConfig: QuotationDisplayConfig;
  customerProductsSyncedAt: string | null;
  items: QuotationItem[];
  customFields: QuotationCustomField[];
  createdAt: string;
}

export interface QuotationSaveInput {
  id?: number;
  status?: QuotationStatus;
  quotationDate: string;
  customerId?: number | null;
  customerName: string;
  contactName: string;
  contactPhone: string;
  customerAddress: string;
  validUntil: string;
  remark: string;
  taxRateBps: number;
  companySnapshot: CompanySnapshot;
  displayConfig: QuotationDisplayConfig;
  items: Array<QuotationItemInput>;
  customFields: Array<QuotationCustomFieldInput>;
}

export interface QuotationItemInput {
  id?: number;
  productId?: number | null;
  customerProductId?: number | null;
  isTemporary: boolean;
  name: string;
  sku: string;
  specification: string;
  parameters?: string;
  packCount?: number | null;
  imageRelativePath?: string | null;
  unitPriceCents: number;
  remark: string;
  sortOrder: number;
}

export interface QuotationCustomFieldInput {
  placement: 'header' | 'footer';
  label: string;
  value: string;
  sortOrder: number;
}

export interface SalesDocumentSummary {
  id: number;
  number: string;
  documentStatus: SalesDocumentStatus;
  paymentStatus: PaymentStatus;
  documentDate: string;
  customerId: number | null;
  customerName: string;
  purchaseOrderNo: string;
  totalCents: number;
  outstandingCents: number;
  updatedAt: string;
  generatedOrderId?: number | null;
  generatedOrderNo?: string | null;
}

export interface SalesDocumentDetail extends SalesDocumentSummary {
  contactName: string;
  contactPhone: string;
  customerAddress: string;
  shippingCents: number;
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  receivedCents: number;
  issuer: string;
  consignee: string;
  remark: string;
  companySnapshot: CompanySnapshot;
  displayConfig: SalesDocumentDisplayConfig;
  sourceQuotationId: number | null;
  items: SalesDocumentItem[];
  receipts: SalesReceipt[];
  createdAt: string;
}

export interface SalesDocumentSaveInput {
  id?: number;
  documentStatus?: SalesDocumentStatus;
  documentDate: string;
  customerId?: number | null;
  customerName: string;
  contactName: string;
  contactPhone: string;
  customerAddress: string;
  purchaseOrderNo: string;
  shippingCents: number;
  taxRateBps: number;
  issuer: string;
  consignee: string;
  remark: string;
  companySnapshot: CompanySnapshot;
  displayConfig: SalesDocumentDisplayConfig;
  sourceQuotationId?: number | null;
  items: Array<SalesDocumentItemInput>;
}

export interface SalesDocumentItemInput {
  id?: number;
  productId?: number | null;
  customerProductId?: number | null;
  isTemporary: boolean;
  productCode?: string;
  name: string;
  sku: string;
  specification: string;
  parameters?: string;
  packCount?: number | null;
  imageRelativePath?: string | null;
  quantity: number;
  unitPriceCents: number;
  remark: string;
  sortOrder: number;
}

export interface SalesReceiptInput {
  receivedAt: string;
  amountCents: number;
  paymentMethod: string;
  note: string;
}

export interface DocumentCustomerSuggestion {
  customerName: string;
  contactName: string;
  contactPhone: string;
  address: string;
}
