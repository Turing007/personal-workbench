import type { QuotationDetail, SalesDocumentDetail } from '../../shared/documents.js';
import type {
  DocumentVersionAction,
  DocumentVersionDetail,
  DocumentVersionSummary,
  DocumentVersionType,
} from '../../shared/document-versions.js';
import type { DocumentVersionRepository } from '../db/document-version-repository.js';

/**
 * 记录单据版本。快照取自保存后的完整详情，包含表头、产品行、公司抬头与收款信息，
 * 因此后续再编辑或删除关联文件，也不会改变历史版本里已经保存的字段。
 */
export class DocumentVersionService {
  constructor(private readonly repository: DocumentVersionRepository) {}

  recordSalesDocument(
    detail: SalesDocumentDetail,
    action: DocumentVersionAction,
    createdBy: string,
  ): DocumentVersionSummary {
    return this.record({
      documentType: 'sales_document',
      documentId: detail.id,
      action,
      documentStatus: detail.documentStatus,
      documentNumber: detail.number,
      documentDate: detail.documentDate,
      totalCents: detail.totalCents,
      snapshot: detail,
      createdBy,
    });
  }

  recordQuotation(
    detail: QuotationDetail,
    action: DocumentVersionAction,
    createdBy: string,
  ): DocumentVersionSummary {
    return this.record({
      documentType: 'quotation',
      documentId: detail.id,
      action,
      documentStatus: detail.status,
      documentNumber: detail.number,
      documentDate: detail.quotationDate,
      totalCents: detail.totalCents,
      snapshot: detail,
      createdBy,
    });
  }

  isAssetReferenced(relativePath: string): boolean {
    return this.repository.isAssetReferenced(relativePath);
  }

  removeAll(documentType: DocumentVersionType, documentId: number): void {
    this.repository.deleteAll(documentType, documentId);
  }

  list(documentType: DocumentVersionType, documentId: number): DocumentVersionSummary[] {
    return this.repository.list(documentType, documentId);
  }

  get(documentType: DocumentVersionType, documentId: number, versionNo: number): DocumentVersionDetail | undefined {
    return this.repository.get(documentType, documentId, versionNo);
  }

  private record(input: {
    documentType: DocumentVersionType;
    documentId: number;
    action: DocumentVersionAction;
    documentStatus: string;
    documentNumber: string;
    documentDate: string;
    totalCents: number;
    snapshot: unknown;
    createdBy: string;
  }): DocumentVersionSummary {
    const createdAt = new Date().toISOString();
    const { id, versionNo } = this.repository.insert({
      documentType: input.documentType,
      documentId: input.documentId,
      action: input.action,
      documentStatus: input.documentStatus,
      documentNumber: input.documentNumber,
      documentDate: input.documentDate,
      totalCents: input.totalCents,
      snapshotJson: JSON.stringify(input.snapshot),
      createdBy: input.createdBy,
      createdAt,
    });
    return {
      id,
      documentType: input.documentType,
      documentId: input.documentId,
      versionNo,
      action: input.action,
      documentStatus: input.documentStatus,
      documentNumber: input.documentNumber,
      documentDate: input.documentDate,
      totalCents: input.totalCents,
      createdBy: input.createdBy,
      createdAt,
    };
  }
}
