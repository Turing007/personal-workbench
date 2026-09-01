import type {
  CompanySnapshot,
  QuotationCustomField,
  QuotationDetail,
  QuotationDisplayConfig,
  QuotationPriceType,
  QuotationStatus,
  SalesDocumentDetail,
  SalesDocumentDisplayConfig,
  SalesDocumentStatus,
} from '../../shared/documents';

export interface DocumentImageDraft {
  relativePath: string | null;
  originalName: string;
  mimeType: string;
  file?: File;
}

export interface DocumentItemPriceTierDraft {
  minQuantity: string;
  maxQuantity: string;
  unitPrice: string;
}

export interface DocumentItemDraft {
  clientKey: string;
  id?: number;
  productId: number | null;
  customerProductId: number | null;
  isTemporary: boolean;
  productCode: string;
  name: string;
  sku: string;
  specification: string;
  parameters: string;
  packCount: string;
  quantity: string;
  unitPrice: string;
  priceTiers?: DocumentItemPriceTierDraft[];
  remark: string;
  freightPerBoxCents?: number | null;
  image: DocumentImageDraft;
}

export interface QuotationCustomFieldDraft {
  id?: number;
  placement: 'header' | 'footer';
  label: string;
  value: string;
}

export interface QuotationDraft {
  id?: number;
  number: string;
  status: QuotationStatus;
  quotationDate: string;
  customerId: number | null;
  customerName: string;
  contactName: string;
  contactPhone: string;
  customerAddress: string;
  validUntil: string;
  remark: string;
  taxRate: string;
  priceType: QuotationPriceType;
  subtotal: string;
  tax: string;
  total: string;
  companySnapshot: CompanySnapshot;
  displayConfig: QuotationDisplayConfig;
  items: DocumentItemDraft[];
  customFields: QuotationCustomFieldDraft[];
}

export interface SalesDocumentDraft {
  id?: number;
  number: string;
  documentStatus: SalesDocumentStatus;
  documentDate: string;
  customerId: number | null;
  customerName: string;
  contactName: string;
  contactPhone: string;
  customerAddress: string;
  purchaseOrderNo: string;
  shipping: string;
  taxRate: string;
  subtotal: string;
  tax: string;
  total: string;
  received: string;
  outstanding: string;
  issuer: string;
  consignee: string;
  remark: string;
  companySnapshot: CompanySnapshot;
  displayConfig: SalesDocumentDisplayConfig;
  sourceQuotationId: number | null;
  items: DocumentItemDraft[];
}

export interface DocumentItemPayload {
  clientKey: string;
  id?: number;
  productId: number | null;
  customerProductId: number | null;
  isTemporary: boolean;
  productCode?: string;
  name: string;
  sku: string;
  specification: string;
  parameters: string;
  packCount: number | null;
  imageRelativePath: string | null;
  imageOriginalName: string;
  imageMimeType: string;
  quantity: number;
  unitPriceCents: number;
  priceTiers?: Array<{ minQuantity: number; maxQuantity: number | null; unitPriceCents: number }>;
  remark: string;
  sortOrder: number;
}

export interface QuotationDraftPayload {
  status: QuotationStatus;
  quotationDate: string;
  customerId: number | null;
  customerName: string;
  contactName: string;
  contactPhone: string;
  customerAddress: string;
  validUntil: string;
  remark: string;
  taxRateBps: number;
  priceType: QuotationPriceType;
  companySnapshot: CompanySnapshot;
  displayConfig: QuotationDisplayConfig;
  items: DocumentItemPayload[];
  customFields: Array<{
    placement: 'header' | 'footer';
    label: string;
    value: string;
    sortOrder: number;
  }>;
}

export interface SalesDocumentDraftPayload {
  documentStatus: SalesDocumentStatus;
  documentDate: string;
  customerId: number | null;
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
  sourceQuotationId: number | null;
  items: DocumentItemPayload[];
}

let clientKeySequence = 0;

export function createDocumentClientKey(prefix = 'line'): string {
  clientKeySequence += 1;
  const random = globalThis.crypto?.randomUUID?.();
  return random ? `${prefix}-${random}` : `${prefix}-${Date.now().toString(36)}-${clientKeySequence.toString(36)}`;
}

function centsToInput(cents: number): string {
  if (!Number.isFinite(cents)) return '';
  return (cents / 100).toFixed(2);
}

function inputToCents(value: string): number {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) : 0;
}

function basisPointsToInput(value: number): string {
  if (!Number.isFinite(value)) return '';
  return (value / 100).toFixed(2);
}

function inputToBasisPoints(value: string): number {
  const rate = Number(value || 0);
  return Number.isFinite(rate) ? Math.round((rate + Number.EPSILON) * 100) : 0;
}

function snapshotName(relativePath: string | null): string {
  return relativePath?.split('/').at(-1) ?? '';
}

function itemToDraft(
  item: QuotationDetail['items'][number] | SalesDocumentDetail['items'][number],
  prefix: string,
): DocumentItemDraft {
  const productCode = 'productCode' in item ? String(item.productCode ?? item.sku) : item.sku;
  const priceTiers = 'priceTiers' in item && Array.isArray(item.priceTiers)
    ? item.priceTiers.map((tier) => ({
      minQuantity: String(tier.minQuantity),
      maxQuantity: tier.maxQuantity == null ? '' : String(tier.maxQuantity),
      unitPrice: centsToInput(tier.unitPriceCents),
    }))
    : undefined;
  return {
    clientKey: `${prefix}-${item.id}`,
    id: item.id,
    productId: item.productId,
    customerProductId: item.customerProductId ?? null,
    isTemporary: item.isTemporary,
    productCode,
    name: item.name,
    sku: item.sku,
    specification: item.specification,
    parameters: typeof item.parameters === 'string' ? item.parameters : '',
    packCount: item.packCount == null ? '' : String(item.packCount),
    quantity: 'quantity' in item ? String(item.quantity) : '1',
    unitPrice: centsToInput(item.unitPriceCents),
    ...(priceTiers ? { priceTiers } : {}),
    remark: item.remark,
    image: {
      relativePath: item.imageRelativePath,
      originalName: snapshotName(item.imageRelativePath),
      mimeType: '',
    },
  };
}

function customFieldToDraft(field: QuotationCustomField): QuotationCustomFieldDraft {
  return {
    id: field.id,
    placement: field.placement,
    label: field.label,
    value: field.value,
  };
}

export function quotationDetailToDraft(detail: QuotationDetail): QuotationDraft {
  return {
    id: detail.id,
    number: detail.number,
    status: detail.status,
    quotationDate: detail.quotationDate,
    customerId: detail.customerId ?? null,
    customerName: detail.customerName,
    contactName: detail.contactName,
    contactPhone: detail.contactPhone,
    customerAddress: detail.customerAddress,
    validUntil: detail.validUntil,
    remark: detail.remark,
    taxRate: basisPointsToInput(detail.taxRateBps),
    priceType: detail.priceType ?? 'ex_tax',
    subtotal: centsToInput(detail.subtotalCents),
    tax: centsToInput(detail.taxCents),
    total: centsToInput(detail.totalCents),
    companySnapshot: { ...detail.companySnapshot },
    displayConfig: { ...detail.displayConfig, columns: { ...detail.displayConfig.columns } },
    items: detail.items.map((item) => itemToDraft(item, 'quotation')),
    customFields: detail.customFields.map(customFieldToDraft),
  };
}

export function salesDocumentDetailToDraft(detail: SalesDocumentDetail): SalesDocumentDraft {
  return {
    id: detail.id,
    number: detail.number,
    documentStatus: detail.documentStatus,
    documentDate: detail.documentDate,
    customerId: detail.customerId ?? null,
    customerName: detail.customerName,
    contactName: detail.contactName,
    contactPhone: detail.contactPhone,
    customerAddress: detail.customerAddress,
    purchaseOrderNo: detail.purchaseOrderNo,
    shipping: centsToInput(detail.shippingCents),
    taxRate: basisPointsToInput(detail.taxRateBps),
    subtotal: centsToInput(detail.subtotalCents),
    tax: centsToInput(detail.taxCents),
    total: centsToInput(detail.totalCents),
    received: centsToInput(detail.receivedCents),
    outstanding: centsToInput(detail.outstandingCents),
    issuer: detail.issuer,
    consignee: detail.consignee,
    remark: detail.remark,
    companySnapshot: { ...detail.companySnapshot },
    displayConfig: { ...detail.displayConfig, columns: { ...detail.displayConfig.columns } },
    sourceQuotationId: detail.sourceQuotationId,
    items: detail.items.map((item) => itemToDraft(item, 'sales')),
  };
}

function draftTiersToPayload(item: DocumentItemDraft): DocumentItemPayload['priceTiers'] {
  const tiers = item.priceTiers?.filter((tier) => tier.minQuantity.trim() || tier.maxQuantity.trim() || tier.unitPrice.trim());
  if (!tiers?.length) return undefined;
  return tiers.map((tier) => ({
    minQuantity: Number(tier.minQuantity || 0),
    maxQuantity: tier.maxQuantity.trim() ? Number(tier.maxQuantity) : null,
    unitPriceCents: inputToCents(tier.unitPrice),
  }));
}

function itemToPayload(item: DocumentItemDraft, sortOrder: number): DocumentItemPayload {
  const priceTiers = draftTiersToPayload(item);
  return {
    clientKey: item.clientKey,
    ...(item.id == null ? {} : { id: item.id }),
    productId: item.productId,
    customerProductId: item.customerProductId ?? null,
    isTemporary: item.isTemporary,
    ...(item.productCode ? { productCode: item.productCode.trim() } : {}),
    name: item.name.trim(),
    sku: item.sku.trim(),
    specification: item.specification.trim(),
    parameters: item.parameters,
    packCount: item.packCount.trim() ? Math.max(1, Math.trunc(Number(item.packCount))) : null,
    imageRelativePath: item.image.file ? null : item.image.relativePath,
    imageOriginalName: item.image.file?.name || item.image.originalName,
    imageMimeType: item.image.file?.type || item.image.mimeType,
    quantity: Number(item.quantity || 0),
    unitPriceCents: inputToCents(item.unitPrice),
    ...(priceTiers ? { priceTiers } : {}),
    remark: item.remark.trim(),
    sortOrder,
  };
}

export function quotationDraftToPayload(draft: QuotationDraft): QuotationDraftPayload {
  return {
    status: draft.status,
    quotationDate: draft.quotationDate,
    customerId: draft.customerId,
    customerName: draft.customerName.trim(),
    contactName: draft.contactName.trim(),
    contactPhone: draft.contactPhone.trim(),
    customerAddress: draft.customerAddress.trim(),
    validUntil: draft.validUntil,
    remark: draft.remark.trim(),
    taxRateBps: inputToBasisPoints(draft.taxRate),
    priceType: draft.priceType,
    companySnapshot: { ...draft.companySnapshot },
    displayConfig: { ...draft.displayConfig, columns: { ...draft.displayConfig.columns } },
    // 报价单按产品报价、不含数量，固定按 1 计价
    items: draft.items.map((item, sortOrder) => itemToPayload({ ...item, quantity: '1' }, sortOrder)),
    customFields: draft.customFields.map((field, sortOrder) => ({
      placement: field.placement,
      label: field.label.trim(),
      value: field.value.trim(),
      sortOrder,
    })),
  };
}

export function salesDocumentDraftToPayload(draft: SalesDocumentDraft): SalesDocumentDraftPayload {
  return {
    documentStatus: draft.documentStatus,
    documentDate: draft.documentDate,
    customerId: draft.customerId,
    customerName: draft.customerName.trim(),
    contactName: draft.contactName.trim(),
    contactPhone: draft.contactPhone.trim(),
    customerAddress: draft.customerAddress.trim(),
    purchaseOrderNo: draft.purchaseOrderNo.trim(),
    shippingCents: inputToCents(draft.shipping),
    taxRateBps: inputToBasisPoints(draft.taxRate),
    issuer: draft.issuer.trim(),
    consignee: draft.consignee.trim(),
    remark: draft.remark.trim(),
    companySnapshot: { ...draft.companySnapshot },
    displayConfig: { ...draft.displayConfig, columns: { ...draft.displayConfig.columns } },
    sourceQuotationId: draft.sourceQuotationId,
    items: draft.items.map(itemToPayload),
  };
}

function payloadToFormData(
  payload: QuotationDraftPayload | SalesDocumentDraftPayload,
  items: readonly DocumentItemDraft[],
): FormData {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  items.forEach((item) => {
    if (item.image.file) form.append(`itemImage.${item.clientKey}`, item.image.file, item.image.file.name);
  });
  return form;
}

export function quotationDraftToFormData(draft: QuotationDraft): FormData {
  return payloadToFormData(quotationDraftToPayload(draft), draft.items);
}

export function salesDocumentDraftToFormData(draft: SalesDocumentDraft): FormData {
  return payloadToFormData(salesDocumentDraftToPayload(draft), draft.items);
}

export const quotationToDraft = quotationDetailToDraft;
export const salesDocumentToDraft = salesDocumentDetailToDraft;
