/**
 * 单据版本：报价单/销售单每次创建、编辑保存、状态变更时追加一份不可变快照。
 * 只追加不修改，用于回答“当时开出去的单据长什么样”。
 */

export type DocumentVersionType = 'sales_document' | 'quotation';

export type DocumentVersionAction = 'create' | 'update' | 'status';

export interface DocumentVersionSummary {
  id: number;
  documentType: DocumentVersionType;
  documentId: number;
  versionNo: number;
  action: DocumentVersionAction;
  documentStatus: string;
  documentNumber: string;
  documentDate: string;
  totalCents: number;
  createdBy: string;
  createdAt: string;
}

export interface DocumentVersionDetail extends DocumentVersionSummary {
  /** 单据详情快照，字段与对应的 SalesDocumentDetail / QuotationDetail 一致。 */
  snapshot: Record<string, unknown>;
}

export const DOCUMENT_VERSION_ACTION_LABELS: Record<DocumentVersionAction, string> = {
  create: '创建',
  update: '编辑保存',
  status: '状态变更',
};

export const DOCUMENT_VERSION_TYPE_LABELS: Record<DocumentVersionType, string> = {
  sales_document: '销售单',
  quotation: '报价单',
};
