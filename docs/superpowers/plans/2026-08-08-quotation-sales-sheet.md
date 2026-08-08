# 报价单与销售开单实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在现有个人工作台中增加可独立使用的报价单与销售开单模块，支持产品库调用、临时产品、数据快照、A4 PDF、多笔收款及付款凭证，同时不改变现有订单、箱唛和发货流程。

**架构：** 新模块采用共享领域类型与金额工具、各自独立的 SQLite 表、repository、service、Fastify 路由和 React 页面。单据保存产品、公司资料和图片快照；PDF 由服务端使用 Playwright Chromium 渲染专用 HTML，确保下载结果与历史快照一致。金额以整数“分”存储、税率以基点存储，文件写入使用“暂存、数据库事务、提交文件、失败清理”的边界。

**技术栈：** React 19、TypeScript 5、Vite 6、Fastify 5、SQLite `node:sqlite`、Zod、Playwright Chromium、Vitest、Playwright Test、Lucide React。

---

## 文件职责

### 共享领域与工具

- 创建 `src/shared/documents.ts`：报价单、销售单、收款、公司快照、显示配置、列表筛选和 API 输入/输出类型。
- 创建 `src/shared/money.ts`：元/分转换、行金额、税额、应收未收、付款状态和中文大写金额计算。
- 创建 `src/shared/document-validation.ts`：共享的非负数量、税率、产品行和显示配置校验函数。
- 测试 `tests/unit/money.test.ts`：整数金额、舍入、税费、付款状态及中文大写。
- 测试 `tests/unit/document-validation.test.ts`：空行、负数、非法税率和显示配置。

### 数据库与持久化

- 修改 `src/server/db/migrate.ts`：创建八张已确认的新表、约束和索引，将 `schema_version` 更新为 `2`。
- 修改 `src/server/backup/backup-service.ts`：将八张新表纳入备份、恢复和记录数校验。
- 创建 `src/server/db/document-number-repository.ts`：在事务中按类型和日期分配 `BJ`、`XS` 编号。
- 创建 `src/server/db/settings-repository.ts`：读写公司资料设置。
- 创建 `src/server/db/quotation-repository.ts`：报价单主表、明细、自定义字段的事务读写。
- 创建 `src/server/db/sales-document-repository.ts`：销售单主表、明细、收款和凭证元数据的事务读写。
- 修改 `src/server/db/repositories.ts`：仅保留现有 repository 行为，同时组合暴露新增的专用 repository，避免继续扩大该文件。

### 文件与 PDF

- 修改 `src/server/config.ts`：增加公司 Logo、报价快照、销售快照和销售收款凭证目录配置。
- 修改 `src/server/files/file-store.ts`：增加 `company-logo`、`quotation-asset`、`sales-asset`、`sales-receipt` 文件类型，分别使用 `company-logos/`、`quotation-assets/`、`sales-document-assets/`、`sales-receipt-proofs/` 目录，支持安全复制已有图片和暂存文件提交/回滚。
- 创建 `src/server/documents/document-assets.ts`：校验产品图片归属、建立单据图片快照、替换旧快照和失败清理。
- 创建 `src/server/documents/pdf-renderer.ts`：启动 Playwright Chromium，优先使用本机 Edge，失败时回退 Playwright Chromium，并输出 A4 纵向 PDF Buffer。
- 创建 `src/server/documents/quotation-template.ts`：报价单打印 HTML、分页表头、图片列和合计区域。
- 创建 `src/server/documents/sales-document-template.ts`：销售单紧凑打印 HTML、可选图片列、运费、未付款数字及中文大写。

### 服务与接口

- 创建 `src/server/services/settings-service.ts`：公司资料读取、更新和 Logo 替换。
- 创建 `src/server/services/quotation-service.ts`：报价校验、编号、快照、状态、删除确认、PDF 和复制边界。
- 创建 `src/server/services/sales-document-service.ts`：销售单校验、金额重算、付款状态、报价复制、状态和删除规则。
- 创建 `src/server/services/document-customer-service.ts`：从两类单据聚合历史客户建议。
- 创建 `src/server/routes/settings.ts`：公司资料 GET/PUT 和 Logo 上传/删除。
- 创建 `src/server/routes/quotations.ts`：报价单列表、详情、保存、状态、删除、PDF 和复制为销售单。
- 创建 `src/server/routes/sales-documents.ts`：销售单列表、详情、保存、状态、删除、PDF、收款和凭证接口。
- 创建 `src/server/routes/document-customers.ts`：历史客户建议接口。
- 修改 `src/server/app.ts`：注册新 repository、service 和路由。

### 前端

- 修改 `src/client/api.ts`：导出底层 `request`，增加报价、销售、设置、建议、PDF 和附件 API。
- 创建 `src/client/documents/document-drafts.ts`：API 数据与表单草稿互转、临时行 clientKey 和 Multipart payload 构造。
- 创建 `src/client/components/documents/CustomerSuggestionInput.tsx`：历史客户下拉建议。
- 创建 `src/client/components/documents/LibraryProductPicker.tsx`：按品名、SKU、规格搜索产品库并选择图片。
- 创建 `src/client/components/documents/TemporaryProductEditor.tsx`：当前单据临时产品录入和图片选择。
- 创建 `src/client/components/documents/CompanySnapshotFields.tsx`：公司名称、Logo、电话、地址显示开关和快照字段。
- 创建 `src/client/components/documents/DocumentColumnSettings.tsx`：单据列显示配置。
- 创建 `src/client/components/documents/DocumentTotals.tsx`：小计、税率、税额、含税合计及未付款显示。
- 创建 `src/client/components/documents/PdfDownloadButton.tsx`：下载 PDF Blob 并显示错误。
- 创建 `src/client/components/quotations/QuotationForm.tsx`：报价表单、产品行、自定义字段和金额。
- 创建 `src/client/pages/QuotationPage.tsx`：报价列表、筛选、编辑、删除、状态、PDF 和复制操作。
- 创建 `src/client/components/sales/SalesDocumentForm.tsx`：销售单字段、产品行、运费、收款和图片列。
- 创建 `src/client/components/sales/ReceiptEditor.tsx`：多笔收款和付款凭证上传/粘贴。
- 创建 `src/client/pages/SalesDocumentsPage.tsx`：销售单列表、筛选、编辑、状态、删除和 PDF。
- 修改 `src/client/components/ImagePasteUpload.tsx`：增加单图模式、只读已保存附件和删除回调，不改变订单付款凭证现有行为。
- 修改 `src/client/pages/SettingsPage.tsx`：公司资料表单和 Logo 管理，保留现有备份恢复区域。
- 修改 `src/client/components/Sidebar.tsx`：增加“报价单”“销售开单”入口。
- 修改 `src/client/App.tsx`：接入两个自管理页面，仅传递统一通知函数，不把单据状态塞回 `App.tsx`。
- 创建 `src/client/styles/documents.css` 并修改 `src/client/main.tsx`：单据列表、紧凑编辑器、打印预览和响应式布局。

### 测试与脚本

- 创建 `tests/server/document-number.test.ts`：编号独立递增和跨日重置。
- 创建 `tests/server/quotations.test.ts`：报价保存、快照、状态、复制限制和 PDF。
- 创建 `tests/server/sales-documents.test.ts`：销售单、收款、超额校验、凭证清理和 PDF。
- 创建 `tests/server/settings.test.ts`：公司资料和 Logo。
- 修改 `tests/server/database.test.ts`：完整表清单和约束。
- 修改 `tests/server/backup.test.ts`：新表及新附件目录备份恢复。
- 创建 `tests/e2e/document-workflow.spec.ts`：两个模块的主要前端工作流。
- 创建 `scripts/reset-e2e-data.mjs`：仅清理项目内 `data/e2e` 测试目录。
- 修改 `playwright.config.ts`：E2E 使用独立数据目录并在启动前重置。
- 修改 `package.json` 和锁文件：增加生产运行需要的 `playwright` 依赖。

## 数据约定

```ts
export type QuotationStatus = 'draft' | 'sent' | 'won' | 'expired';
export type SalesDocumentStatus = 'draft' | 'issued' | 'void';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface CompanySnapshot {
  name: string;
  logoRelativePath: string | null;
  phone: string;
  address: string;
  defaultIssuer: string;
}
```

- 金额字段统一使用 `*_cents INTEGER`，API 对外使用元数值并在服务层转换。
- 税率字段统一使用 `tax_rate_bps INTEGER`，`100` 代表 `1.00%`，`1300` 代表 `13.00%`。
- 产品数量使用 `REAL`，必须 `>= 0`；行金额使用 `Math.round(quantity * unitPriceCents)`。
- 单据图片快照必须位于 `quotation-assets/` 或 `sales-document-assets/`，历史 PDF 不读取当前产品图片。
- `display_config_json` 保存布尔列配置；`company_snapshot_json` 保存创建/最后保存时的公司展示资料。
- 前端每行持有稳定 `clientKey`；Multipart 文件字段使用 `itemImage.<clientKey>`，服务端据此关联临时产品图片。

---

### 任务 1：共享金额、状态和校验基础

**文件：**
- 创建：`src/shared/documents.ts`
- 创建：`src/shared/money.ts`
- 创建：`src/shared/document-validation.ts`
- 测试：`tests/unit/money.test.ts`
- 测试：`tests/unit/document-validation.test.ts`

- [ ] **步骤 1：编写金额与中文大写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { calculateDocumentTotals, centsToChineseUppercase, derivePaymentStatus } from '../../src/shared/money';

describe('document money', () => {
  it('rounds line amounts and tax in integer cents', () => {
    expect(calculateDocumentTotals([{ quantity: 3, unitPriceCents: 1999 }], 1300, 800)).toEqual({
      subtotalCents: 5997,
      taxCents: 780,
      shippingCents: 800,
      totalCents: 7577,
    });
  });

  it('derives payment state and uppercase balance', () => {
    expect(derivePaymentStatus(10000, 0)).toBe('unpaid');
    expect(derivePaymentStatus(10000, 3000)).toBe('partial');
    expect(derivePaymentStatus(10000, 10000)).toBe('paid');
    expect(centsToChineseUppercase(123456)).toBe('壹仟贰佰叁拾肆元伍角陆分');
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/unit/money.test.ts`

预期：FAIL，提示 `src/shared/money.ts` 不存在。

- [ ] **步骤 3：实现领域类型和整数金额函数**

在 `documents.ts` 完整定义 `QuotationStatus`、`SalesDocumentStatus`、`PaymentStatus`、`CompanySnapshot`、两类显示配置、产品行、收款、列表行、详情和保存输入。`money.ts` 实现并导出：

```ts
export function yuanToCents(value: number): number;
export function centsToYuan(value: number): number;
export function calculateLineAmountCents(quantity: number, unitPriceCents: number): number;
export function calculateDocumentTotals(
  lines: readonly { quantity: number; unitPriceCents: number }[],
  taxRateBps: number,
  shippingCents?: number,
): { subtotalCents: number; taxCents: number; shippingCents: number; totalCents: number };
export function calculateOutstandingCents(totalCents: number, receivedCents: number): number;
export function derivePaymentStatus(totalCents: number, receivedCents: number): PaymentStatus;
export function centsToChineseUppercase(cents: number): string;
```

- [ ] **步骤 4：编写并运行共享校验测试**

```ts
import { describe, expect, it } from 'vitest';
import { validateDocumentLines, validateTaxRateBps } from '../../src/shared/document-validation';

describe('document validation', () => {
  it('rejects empty lines and negative values', () => {
    expect(() => validateDocumentLines([])).toThrow('至少需要一行产品');
    expect(() => validateDocumentLines([{ name: 'A', quantity: -1, unitPriceCents: 100 }])).toThrow('数量不能小于 0');
    expect(() => validateDocumentLines([{ name: 'A', quantity: 1, unitPriceCents: -1 }])).toThrow('单价不能小于 0');
  });

  it('accepts 0 to 100 percent tax in basis points', () => {
    expect(validateTaxRateBps(1300)).toBe(1300);
    expect(() => validateTaxRateBps(-1)).toThrow('税率不能小于 0');
    expect(() => validateTaxRateBps(10001)).toThrow('税率不能超过 100%');
  });
});
```

运行：`npm test -- tests/unit/money.test.ts tests/unit/document-validation.test.ts`

预期：PASS。

- [ ] **步骤 5：提交共享领域基础**

```powershell
git add src/shared/documents.ts src/shared/money.ts src/shared/document-validation.ts tests/unit/money.test.ts tests/unit/document-validation.test.ts
git commit -m "feat: add document money and validation domain"
```

### 任务 2：数据库表、索引和备份清单

**文件：**
- 修改：`src/server/db/migrate.ts`
- 修改：`src/server/backup/backup-service.ts`
- 修改：`tests/server/database.test.ts`
- 修改：`tests/server/backup.test.ts`

- [ ] **步骤 1：先扩展数据库结构测试**

将预期表清单增加：

```ts
'document_number_sequences',
'quotation_custom_fields',
'quotation_items',
'quotations',
'sales_document_items',
'sales_documents',
'sales_receipt_files',
'sales_receipts',
```

并增加断言：`quotations.number`、`sales_documents.number` 唯一；`quotation_items` 和 `sales_document_items` 级联删除；`sales_documents.source_quotation_id` 删除来源时设为 `NULL`。

- [ ] **步骤 2：运行数据库测试确认失败**

运行：`npm test -- tests/server/database.test.ts`

预期：FAIL，缺少八张新表。

- [ ] **步骤 3：在迁移中创建完整表结构**

表结构至少包含以下稳定字段：

```sql
CREATE TABLE IF NOT EXISTS document_number_sequences (
  document_type TEXT NOT NULL CHECK (document_type IN ('quotation', 'sales')),
  sequence_date TEXT NOT NULL,
  last_value INTEGER NOT NULL CHECK (last_value > 0),
  PRIMARY KEY (document_type, sequence_date)
);

CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'won', 'expired')),
  quotation_date TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  valid_until TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  company_snapshot_json TEXT NOT NULL,
  display_config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`quotation_items` 包含 `product_id`、`is_temporary`、`name`、`sku`、`specification`、`quantity REAL`、`unit_price_cents`、`amount_cents`、`remark`、`image_relative_path`、`sort_order`；`quotation_custom_fields` 包含 `placement`、`label`、`value`、`sort_order`。

`sales_documents` 包含 `source_quotation_id`、单据状态、付款状态、客户/地址/日期/采购单号/开单人/收货人、运费和各合计金额、快照 JSON；`sales_document_items` 保存产品快照；`sales_receipts` 保存日期、金额、方式和备注；`sales_receipt_files` 保存文件元数据。

- [ ] **步骤 4：扩展备份表清单和备份测试**

将八张表加入 `tableNames`。在备份测试插入一张草稿报价单和一张草稿销售单，断言：

```ts
expect(manifest.recordCounts.quotations).toBe(1);
expect(manifest.recordCounts.sales_documents).toBe(1);
```

运行：`npm test -- tests/server/database.test.ts tests/server/backup.test.ts`

预期：PASS，备份恢复后新表记录数一致。

- [ ] **步骤 5：提交迁移和备份支持**

```powershell
git add src/server/db/migrate.ts src/server/backup/backup-service.ts tests/server/database.test.ts tests/server/backup.test.ts
git commit -m "feat: add quotation and sales document schema"
```

### 任务 3：单据编号、公司设置和客户建议 repository

**文件：**
- 创建：`src/server/db/document-number-repository.ts`
- 创建：`src/server/db/settings-repository.ts`
- 创建：`src/server/services/document-customer-service.ts`
- 测试：`tests/server/document-number.test.ts`
- 测试：`tests/server/settings.test.ts`

- [ ] **步骤 1：编写编号失败测试**

```ts
it('allocates independent daily quotation and sales numbers', () => {
  expect(numbers.next('quotation', '2026-08-08')).toBe('BJ20260808001');
  expect(numbers.next('quotation', '2026-08-08')).toBe('BJ20260808002');
  expect(numbers.next('sales', '2026-08-08')).toBe('XS20260808001');
  expect(numbers.next('quotation', '2026-08-09')).toBe('BJ20260809001');
});
```

运行：`npm test -- tests/server/document-number.test.ts`

预期：FAIL，编号 repository 不存在。

- [ ] **步骤 2：实现原子编号分配**

`DocumentNumberRepository.next(type, date, database?)` 必须在调用方事务使用的同一个 `DatabaseSync` 上执行：先 `INSERT ... ON CONFLICT DO UPDATE SET last_value = last_value + 1 RETURNING last_value`，再根据类型拼接 `BJ` 或 `XS`。

- [ ] **步骤 3：编写设置 repository 测试**

```ts
expect(settings.getCompanyProfile()).toEqual({
  name: '', logoRelativePath: null, phone: '', address: '', defaultIssuer: '',
});
settings.saveCompanyProfile({ name: '示例公司', logoRelativePath: null, phone: '13800000000', address: '深圳', defaultIssuer: '高先生' });
expect(settings.getCompanyProfile().defaultIssuer).toBe('高先生');
```

实现时使用一个 `company_profile` 设置键保存经过 Zod 校验的 JSON，不创建额外客户表。

- [ ] **步骤 4：实现客户建议聚合服务**

`DocumentCustomerService.listSuggestions(query, limit)` 对 `quotations` 和 `sales_documents` 执行 `UNION ALL`，按 `customer_name + contact_name + contact_phone + address` 去重，优先返回最近更新记录，最多 20 条。返回：

```ts
interface CustomerSuggestion {
  customerName: string;
  contactName: string;
  contactPhone: string;
  address: string;
}
```

- [ ] **步骤 5：运行测试并提交**

运行：`npm test -- tests/server/document-number.test.ts tests/server/settings.test.ts`

预期：PASS。

```powershell
git add src/server/db/document-number-repository.ts src/server/db/settings-repository.ts src/server/services/document-customer-service.ts tests/server/document-number.test.ts tests/server/settings.test.ts
git commit -m "feat: add document numbering and company settings repositories"
```

### 任务 4：安全文件快照和 PDF 渲染基础

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`src/server/config.ts`
- 修改：`src/server/files/file-store.ts`
- 创建：`src/server/documents/document-assets.ts`
- 创建：`src/server/documents/pdf-renderer.ts`
- 修改：`tests/server/database.test.ts`

- [ ] **步骤 1：扩展文件存储失败测试**

```ts
it('copies an allowed product image into a quotation snapshot directory', async () => {
  const source = await store.saveImage(Readable.from([Buffer.from('png')]), 'product', 'a.png', 'image/png');
  const snapshot = await store.copyImage(source.relativePath, 'quotation-asset', 'a.png', 'image/png');
  expect(snapshot.relativePath).toMatch(/^quotation-assets\/[0-9a-f-]+\.png$/);
});

it('keeps sales receipt files in their own directory', async () => {
  const proof = await store.saveImage(Readable.from([Buffer.from('png')]), 'sales-receipt', 'proof.png', 'image/png');
  expect(proof.relativePath).toMatch(/^sales-receipt-proofs\//);
});
```

- [ ] **步骤 2：实现新目录、允许前缀和暂存 API**

`FileKind` 扩展为：

```ts
export type FileKind =
  | 'product'
  | 'payment'
  | 'company-logo'
  | 'quotation-asset'
  | 'sales-asset'
  | 'sales-receipt';
```

增加 `stageImage`、`commitStagedFile`、`discardStagedFile`、`copyImage`。`resolvePublicPath` 只允许六个已声明目录，仍拒绝绝对路径和 `..`。

- [ ] **步骤 3：实现单据资源协调器**

`DocumentAssetManager.prepareItemImages()` 接收产品库图片路径和 Multipart 临时图片，校验产品图片确实属于对应 `product_id`，将所有新文件暂存。`commit()` 在数据库事务内移动到最终目录；任何失败调用 `rollback()` 删除本批文件。更新单据成功后再删除不再引用的旧快照。

- [ ] **步骤 4：增加 PDF 运行依赖并实现渲染器**

运行：`npm install playwright@^1.54.0`

`PdfRenderer.render(html)` 使用：

```ts
const browser = await launchBrowser();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });
return Buffer.from(await page.pdf({ format: 'A4', landscape: false, printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } }));
```

`launchBrowser()` 先尝试 `{ channel: 'msedge', headless: true }`，失败后使用 Playwright 自带 Chromium；两次失败时抛出 `PDF_RENDER_FAILED`，并在路由层转换为可读错误。

- [ ] **步骤 5：运行文件测试和类型检查并提交**

运行：`npm test -- tests/server/database.test.ts && npm run typecheck`

预期：PASS。

```powershell
git add package.json package-lock.json src/server/config.ts src/server/files/file-store.ts src/server/documents/document-assets.ts src/server/documents/pdf-renderer.ts tests/server/database.test.ts
git commit -m "feat: add document asset snapshots and pdf renderer"
```

### 任务 5：报价单 repository 与 service

**文件：**
- 创建：`src/server/db/quotation-repository.ts`
- 创建：`src/server/services/quotation-service.ts`
- 测试：`tests/server/quotations.test.ts`

- [ ] **步骤 1：编写报价保存和快照失败测试**

```ts
it('saves multiple quotation lines with calculated totals and snapshots', async () => {
  const quotation = await service.create(makeQuotationInput({
    taxRateBps: 1300,
    items: [
      { clientKey: 'a', productId, isTemporary: false, name: '电钻', sku: 'D-1', specification: '20V', quantity: 2, unitPrice: 100 },
      { clientKey: 'b', productId: null, isTemporary: true, name: '临时配件', sku: '', specification: '', quantity: 1, unitPrice: 50 },
    ],
  }));
  expect(quotation.number).toMatch(/^BJ\d{8}001$/);
  expect(quotation.subtotal).toBe(250);
  expect(quotation.tax).toBe(32.5);
  expect(quotation.total).toBe(282.5);
  expect(quotation.items).toHaveLength(2);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/server/quotations.test.ts`

预期：FAIL，报价 repository/service 不存在。

- [ ] **步骤 3：实现报价 repository**

提供精确接口：

```ts
export interface QuotationRepository {
  list(filters: QuotationListFilters): Paginated<QuotationListRow>;
  get(id: number): QuotationDetail | undefined;
  insert(database: DatabaseSync, record: QuotationPersistenceInput): number;
  replace(database: DatabaseSync, id: number, record: QuotationPersistenceInput): boolean;
  updateStatus(id: number, status: QuotationStatus): boolean;
  delete(id: number): boolean;
}
```

`insert`/`replace` 必须一次写主表、全部明细和自定义字段；更新时先读取旧图片路径供提交后清理。

- [ ] **步骤 4：实现报价 service 校验和业务规则**

`QuotationService` 负责：

- create 时在同一事务分配编号。
- update 保留原编号和 `created_at`。
- 每次保存重新计算 `subtotal/tax/total`，不接受前端传入合计。
- 保存公司资料、显示配置和产品资料快照。
- 产品库图片复制到报价快照目录；临时图片走 Multipart clientKey。
- 状态仅允许四个确认值，由用户显式更新。
- `won` 报价删除时要求 `confirmed=true`，否则抛 `CONFIRMATION_REQUIRED`。
- 没有有效产品行时拒绝 PDF。

- [ ] **步骤 5：补充历史快照和非法数据测试**

增加测试：修改/删除原产品后，报价详情的名称、规格和快照图片路径不变；空产品、负数量、负单价和非法税率均返回字段明确的验证错误。

运行：`npm test -- tests/server/quotations.test.ts`

预期：PASS。

- [ ] **步骤 6：提交报价领域后端**

```powershell
git add src/server/db/quotation-repository.ts src/server/services/quotation-service.ts tests/server/quotations.test.ts
git commit -m "feat: add quotation persistence and service"
```

### 任务 6：报价 API、打印模板和 PDF 下载

**文件：**
- 创建：`src/server/documents/quotation-template.ts`
- 创建：`src/server/routes/quotations.ts`
- 修改：`src/server/app.ts`
- 修改：`tests/server/quotations.test.ts`

- [ ] **步骤 1：编写报价 API 失败测试**

测试以下请求：

```text
GET    /api/quotations?status=draft&q=客户&page=1&pageSize=50
POST   /api/quotations                  multipart: payload + itemImage.<clientKey>
GET    /api/quotations/:id
PUT    /api/quotations/:id              multipart: payload + itemImage.<clientKey>
PATCH  /api/quotations/:id/status       { status }
DELETE /api/quotations/:id              { confirmed: boolean }
GET    /api/quotations/:id/pdf
POST   /api/quotations/:id/copy-to-sales
```

复制接口在销售 service 尚未接入时先通过依赖接口 `copyQuotationToSales(id)` 注入，测试非 `won` 状态返回 `QUOTATION_NOT_WON`。

- [ ] **步骤 2：实现报价 Multipart 解析和路由**

路由必须将 `payload` 解析为 JSON，对每个 `itemImage.<clientKey>` 最多接受一个 PNG/JPEG/WebP，未识别字段返回 `VALIDATION_ERROR`。所有响应沿用 `{ ok, data }` / `{ ok: false, error }`。

- [ ] **步骤 3：实现报价 HTML 模板**

模板使用内联 CSS 和经过 HTML 转义的数据。关键打印 CSS：

```css
@page { size: A4 portrait; margin: 10mm; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
.product-image { width: 18mm; height: 18mm; object-fit: contain; }
```

只渲染 `displayConfig` 启用的公司字段、产品列、税率、税额和含税合计；图片读取快照文件并转换为 data URL，不能通过 HTTP 回读当前产品库。

- [ ] **步骤 4：实现 PDF 响应并测试**

`GET /pdf` 返回：

```ts
reply
  .header('Content-Type', 'application/pdf')
  .header('Content-Disposition', `attachment; filename="${quotation.number}.pdf"`)
  .send(pdfBuffer);
```

测试断言响应头、Buffer 以 `%PDF` 开头、导出失败不改变报价状态。

- [ ] **步骤 5：注册路由、运行测试并提交**

运行：`npm test -- tests/server/quotations.test.ts && npm run typecheck`

预期：PASS。

```powershell
git add src/server/documents/quotation-template.ts src/server/routes/quotations.ts src/server/app.ts tests/server/quotations.test.ts
git commit -m "feat: add quotation api and pdf export"
```

### 任务 7：销售单 repository、金额和报价复制

**文件：**
- 创建：`src/server/db/sales-document-repository.ts`
- 创建：`src/server/services/sales-document-service.ts`
- 测试：`tests/server/sales-documents.test.ts`
- 修改：`tests/server/quotations.test.ts`

- [ ] **步骤 1：编写销售单与报价复制失败测试**

```ts
it('copies only a won quotation into an independent sales draft', async () => {
  await quotationService.updateStatus(quotation.id, 'won');
  const sales = await salesService.createFromQuotation(quotation.id);
  expect(sales.number).toMatch(/^XS\d{8}001$/);
  expect(sales.documentStatus).toBe('draft');
  expect(sales.paymentStatus).toBe('unpaid');
  expect(sales.received).toBe(0);
  expect(sales.sourceQuotationId).toBe(quotation.id);
  await salesService.update(sales.id, { ...toInput(sales), customerName: '修改后的客户' });
  expect(quotationService.get(quotation.id)?.customerName).not.toBe('修改后的客户');
});
```

- [ ] **步骤 2：实现销售 repository**

提供 `list/get/insert/replace/updateStatus/delete`，详情查询同时返回产品行、收款、凭证、已收和未付。付款状态可保存在主表便于筛选，但每次销售单或收款变更都必须由 service 重算并写回。

- [ ] **步骤 3：实现销售单 service**

规则：

- create 分配 `XSYYYYMMDD###`。
- `shippingCents` 加入含税总额：`subtotal + tax + shipping`。
- 默认开单人取公司设置的 `defaultIssuer`。
- 默认不显示图片列，单张销售单可以开启。
- update 不接受前端传入付款状态和合计。
- `issued` 删除要求 `confirmed=true`；`void` 永远返回 `VOID_DOCUMENT_PRESERVED`，不物理删除。
- `createFromQuotation` 只接受 `won` 报价，复制当前快照并生成全新销售编号，收款为空。

- [ ] **步骤 4：补充临时产品和快照测试**

断言系统产品和临时产品可并存；临时产品不会写入 `products`；修改产品库后销售历史不变；图片列关闭时详情仍保留图片快照供以后开启。

- [ ] **步骤 5：运行测试并提交**

运行：`npm test -- tests/server/sales-documents.test.ts tests/server/quotations.test.ts`

预期：PASS。

```powershell
git add src/server/db/sales-document-repository.ts src/server/services/sales-document-service.ts tests/server/sales-documents.test.ts tests/server/quotations.test.ts
git commit -m "feat: add sales document service and quotation conversion"
```

### 任务 8：多笔收款和独立付款凭证

**文件：**
- 修改：`src/server/db/sales-document-repository.ts`
- 修改：`src/server/services/sales-document-service.ts`
- 修改：`src/server/files/file-store.ts`
- 修改：`tests/server/sales-documents.test.ts`

- [ ] **步骤 1：编写收款累计与超额失败测试**

```ts
it('calculates partial and paid states from multiple receipts', async () => {
  await service.addReceipt(id, { receivedAt: '2026-08-08', amount: 300, paymentMethod: '微信', note: '预付款' });
  expect(service.get(id)?.paymentStatus).toBe('partial');
  await service.addReceipt(id, { receivedAt: '2026-08-09', amount: 700, paymentMethod: '银行转账', note: '尾款' });
  expect(service.get(id)?.paymentStatus).toBe('paid');
  expect(service.get(id)?.outstandingUppercase).toBe('零元整');
});

it('rejects receipts above the outstanding balance', async () => {
  await expect(service.addReceipt(id, { receivedAt: '2026-08-08', amount: 1000.01, paymentMethod: '', note: '' }))
    .rejects.toMatchObject({ code: 'RECEIPT_EXCEEDS_TOTAL' });
});
```

- [ ] **步骤 2：实现收款 CRUD 和原子重算**

接口：

```ts
addReceipt(documentId, input): SalesReceipt;
updateReceipt(receiptId, input): SalesReceipt;
deleteReceipt(receiptId): boolean;
addReceiptFile(receiptId, stagedFile): SalesReceiptFile;
deleteReceiptFile(fileId): Promise<boolean>;
```

每次增删改收款都在事务内重新汇总有效收款，拒绝负数或累计超过 `total_cents`，更新 `received_cents`、`outstanding_cents`、`payment_status`。

- [ ] **步骤 3：实现凭证失败清理测试**

上传凭证时先暂存，插入 `sales_receipt_files` 成功后提交文件；模拟数据库插入失败，断言暂存和最终目录均无新文件。删除收款记录后断言所属凭证文件和元数据都被删除。

- [ ] **步骤 4：运行测试并提交**

运行：`npm test -- tests/server/sales-documents.test.ts`

预期：PASS。

```powershell
git add src/server/db/sales-document-repository.ts src/server/services/sales-document-service.ts src/server/files/file-store.ts tests/server/sales-documents.test.ts
git commit -m "feat: add sales receipts and payment proof storage"
```

### 任务 9：销售 API、销售单模板和 PDF

**文件：**
- 创建：`src/server/documents/sales-document-template.ts`
- 创建：`src/server/routes/sales-documents.ts`
- 创建：`src/server/routes/document-customers.ts`
- 创建：`src/server/routes/settings.ts`
- 创建：`src/server/services/settings-service.ts`
- 修改：`src/server/app.ts`
- 修改：`tests/server/sales-documents.test.ts`
- 修改：`tests/server/settings.test.ts`

- [ ] **步骤 1：编写设置、建议和销售 API 失败测试**

覆盖：

```text
GET/PUT    /api/settings/company-profile
POST       /api/settings/company-profile/logo
DELETE     /api/settings/company-profile/logo
GET        /api/document-customers/suggestions?q=
GET/POST   /api/sales-documents
GET/PUT    /api/sales-documents/:id
PATCH      /api/sales-documents/:id/status
DELETE     /api/sales-documents/:id
GET        /api/sales-documents/:id/pdf
POST       /api/sales-documents/:id/receipts
PUT/DELETE /api/sales-receipts/:id
POST       /api/sales-receipts/:id/files
DELETE     /api/sales-receipt-files/:id
```

- [ ] **步骤 2：实现设置、建议和销售路由**

公司 Logo 上传使用 `company-logo` 目录；替换 Logo 后删除旧设置 Logo，但绝不删除已复制到历史单据目录的 Logo。销售保存与报价一样使用 Multipart `payload + itemImage.<clientKey>`。

- [ ] **步骤 3：实现紧凑销售单 HTML 模板**

默认列为产品代码、产品名称、数量（PCS）、不含税单价、不含税金额、备注；`showProductImage` 为 true 才插入图片列。页脚渲染运费、不含税合计、税率、税额、含税合计、未付款数字、未付款中文大写、开单人和收货人。

- [ ] **步骤 4：实现销售 PDF 测试**

断言：默认 HTML/PDF 不包含图片列标题；开启图片后包含快照 data URL；多行表格使用重复表头 CSS；PDF 响应以 `%PDF` 开头；导出不改变 `draft/issued/void` 状态。

- [ ] **步骤 5：注册全部路由、运行测试并提交**

运行：`npm test -- tests/server/settings.test.ts tests/server/sales-documents.test.ts tests/server/quotations.test.ts && npm run typecheck`

预期：PASS。

```powershell
git add src/server/documents/sales-document-template.ts src/server/routes/sales-documents.ts src/server/routes/document-customers.ts src/server/routes/settings.ts src/server/services/settings-service.ts src/server/app.ts tests/server/settings.test.ts tests/server/sales-documents.test.ts tests/server/quotations.test.ts
git commit -m "feat: add sales document api settings and pdf export"
```

### 任务 10：前端 API、表单草稿和下载能力

**文件：**
- 修改：`src/client/api.ts`
- 创建：`src/client/documents/document-drafts.ts`
- 创建：`src/client/components/documents/PdfDownloadButton.tsx`
- 测试：`tests/unit/document-drafts.test.ts`

- [ ] **步骤 1：编写草稿映射失败测试**

```ts
it('builds multipart payload and preserves temporary image client keys', () => {
  const form = quotationDraftToFormData(makeDraftWithTemporaryImage('line-1'));
  expect(JSON.parse(String(form.get('payload'))).items[0].clientKey).toBe('line-1');
  expect(form.get('itemImage.line-1')).toBeInstanceOf(File);
});
```

- [ ] **步骤 2：实现前端单据 API**

增加完整类型化函数：`list/get/save/update/delete/setStatus/download/copy` 报价单，销售单对应函数，收款 CRUD/凭证，公司设置和客户建议。PDF 请求使用 `requestBlob(path)`，不得尝试 JSON 解析 PDF。

- [ ] **步骤 3：实现草稿转换器**

API 元金额与表单字符串互转；新产品行生成稳定 `clientKey`；已有快照图片保留 `relativePath`；本地文件按 `itemImage.<clientKey>` 加入 FormData。保存时不发送前端计算的合计作为可信值。

- [ ] **步骤 4：实现 PDF 下载按钮**

按钮使用 `Download` 图标、loading 状态和 `title="导出 PDF"`，创建 Object URL 下载 `${number}.pdf`，完成后撤销 URL；错误通过 `onError(message)` 交给现有 Toast。

- [ ] **步骤 5：运行测试和类型检查并提交**

运行：`npm test -- tests/unit/document-drafts.test.ts && npm run typecheck`

预期：PASS。

```powershell
git add src/client/api.ts src/client/documents/document-drafts.ts src/client/components/documents/PdfDownloadButton.tsx tests/unit/document-drafts.test.ts
git commit -m "feat: add document client api and draft mapping"
```

### 任务 11：共享单据编辑组件与公司设置界面

**文件：**
- 创建：`src/client/components/documents/CustomerSuggestionInput.tsx`
- 创建：`src/client/components/documents/LibraryProductPicker.tsx`
- 创建：`src/client/components/documents/TemporaryProductEditor.tsx`
- 创建：`src/client/components/documents/CompanySnapshotFields.tsx`
- 创建：`src/client/components/documents/DocumentColumnSettings.tsx`
- 创建：`src/client/components/documents/DocumentTotals.tsx`
- 修改：`src/client/components/ImagePasteUpload.tsx`
- 修改：`src/client/pages/SettingsPage.tsx`

- [ ] **步骤 1：实现客户建议输入**

输入停止 250ms 后请求建议，菜单显示客户名称、联系人和电话；选择后一次回填对应字段，但每个输入仍可继续编辑。无匹配时保持普通文本框，不强制建立客户记录。

- [ ] **步骤 2：实现产品库选择器和临时产品编辑器**

产品库选择器提供品名、SKU、规格三个筛选输入，结果行显示缩略图、品名、SKU、规格；选择时默认第一张图，可在该产品图片列表中切换。临时产品至少要求品名，可填 SKU、规格、备注并上传一张当前单据图片。

- [ ] **步骤 3：实现公司快照和列配置**

公司资料区显示当前设置作为默认值，并允许单张单据修改文本和 Logo/电话/地址显示开关。列配置使用复选框，不允许关闭“品名/产品名称”和“金额”这两个核心列；报价默认开启图片，销售默认关闭图片。

- [ ] **步骤 4：扩展图片粘贴组件**

新增可选属性：

```ts
maxFiles?: number;
onDeleteSaved?: (attachment: ImageAttachment) => Promise<void> | void;
showNotes?: boolean;
```

默认值保持现有订单付款凭证行为不变。销售收款使用 `maxFiles={1}`、`showNotes={false}`，备注由收款记录字段承担。

- [ ] **步骤 5：扩展设置页面**

增加公司名称、电话、地址、默认开单人、Logo 上传和删除；保存成功后刷新 profile。保留服务地址、SQLite 说明和备份恢复功能，更新备份说明为包含报价单、销售单及其附件。

- [ ] **步骤 6：运行类型检查并提交**

运行：`npm run typecheck`

预期：PASS。

```powershell
git add src/client/components/documents src/client/components/ImagePasteUpload.tsx src/client/pages/SettingsPage.tsx
git commit -m "feat: add shared document editing components"
```

### 任务 12：报价单页面完整闭环

**文件：**
- 创建：`src/client/components/quotations/QuotationForm.tsx`
- 创建：`src/client/pages/QuotationPage.tsx`
- 创建：`src/client/styles/documents.css`

- [ ] **步骤 1：实现报价列表和筛选状态**

页面标题行放“报价单”、搜索、状态筛选、新建按钮。列表列为单号、日期、客户、产品数、不含税、含税、状态、更新时间、操作；状态筛选为 `全部/草稿/已发送/已成交/已失效`，不使用占空间的大卡片。

- [ ] **步骤 2：实现报价编辑器**

使用大尺寸 Modal 或页面内覆盖层，分为紧凑的单据信息、公司显示、产品明细、自定义字段、合计四区。支持多行、拖动以外的上移/下移排序、复制行、删除行、产品库调用、临时产品、图片切换、显示列开关和顶部/底部自定义字段。

- [ ] **步骤 3：实现保存、状态、删除和 PDF**

保存后刷新列表并保持当前筛选。`won` 删除前弹二次确认，普通状态单次确认；只有 `won` 行显示“复制为销售开单”。PDF 按钮直接下载，不自动修改状态。

- [ ] **步骤 4：实现前端金额即时反馈**

表单用共享 `money.ts` 计算只读预览；保存后的服务端结果覆盖前端预览。数量、单价、税率输入负数时就地显示错误，仍由后端做最终校验。

- [ ] **步骤 5：检查紧凑布局并提交**

手动检查 1440x900 和 1280x720：列表首屏至少显示 12 行；Modal 内产品表格横向不溢出视口；按钮文本和图标不重叠。

运行：`npm run typecheck && npm run build`

预期：PASS。

```powershell
git add src/client/components/quotations/QuotationForm.tsx src/client/pages/QuotationPage.tsx src/client/styles/documents.css
git commit -m "feat: add quotation management interface"
```

### 任务 13：销售开单页面和收款编辑器

**文件：**
- 创建：`src/client/components/sales/ReceiptEditor.tsx`
- 创建：`src/client/components/sales/SalesDocumentForm.tsx`
- 创建：`src/client/pages/SalesDocumentsPage.tsx`
- 修改：`src/client/styles/documents.css`

- [ ] **步骤 1：实现销售单列表和双状态筛选**

列表支持关键词、单据状态和付款状态筛选。列为销售单号、日期、客户、采购单号、含税合计、已收、未付、单据状态、付款状态、操作。新建销售单不依赖报价单。

- [ ] **步骤 2：实现销售单编辑器**

字段包含公司、客户、地址、日期、采购单号、开单人、收货人、产品明细、运费、税率、备注和图片列开关。产品可来自系统产品库或临时添加；默认图片列关闭。

- [ ] **步骤 3：实现收款编辑器**

每笔收款行包含收款日期、金额、付款方式、备注和一张凭证。新建销售单先保存主单再开放凭证上传；已保存销售单支持 `Ctrl+V` 粘贴，上传完成立即刷新收款和付款状态。删除收款先确认，并同步删除凭证。

- [ ] **步骤 4：实现状态、删除、作废和 PDF**

状态可切换 `草稿/已开单/已作废`。`已开单` 删除需要二次确认；`已作废` 隐藏删除按钮，仅保留查看和 PDF。PDF 不改变状态。列表明确显示未付款数字金额。

- [ ] **步骤 5：运行构建并提交**

运行：`npm run typecheck && npm run build`

预期：PASS。

```powershell
git add src/client/components/sales/ReceiptEditor.tsx src/client/components/sales/SalesDocumentForm.tsx src/client/pages/SalesDocumentsPage.tsx src/client/styles/documents.css
git commit -m "feat: add sales document and receipt interface"
```

### 任务 14：导航、应用编排和样式接入

**文件：**
- 修改：`src/client/components/Sidebar.tsx`
- 修改：`src/client/App.tsx`
- 修改：`src/client/main.tsx`
- 修改：`src/client/styles/app.css`

- [ ] **步骤 1：增加导航类型与图标**

```ts
export type NavigationKey =
  | 'orders'
  | 'quotations'
  | 'sales-documents'
  | 'products'
  | 'customer-products'
  | 'shipping'
  | 'settings';
```

使用 Lucide `FileText` 表示报价单，`ReceiptText` 表示销售开单，位置放在订单管理之后、产品库之前。

- [ ] **步骤 2：接入自管理页面**

`App.tsx` 仅增加：

```tsx
{active === 'quotations' && <QuotationPage onNotify={notify} onOpenSalesDocument={() => setActive('sales-documents')} />}
{active === 'sales-documents' && <SalesDocumentsPage onNotify={notify} />}
```

报价和销售页面自行加载数据，避免继续扩展 App 顶层数据状态。现有订单、产品、客户产品和发货状态保持原样。

- [ ] **步骤 3：加载单据 CSS 并做颜色扫描**

在 `main.tsx` 导入 `documents.css`。检查 CSS 不形成单一紫色、米色或深蓝主题；表格、输入、按钮沿用现有中性灰 + 青绿色主操作色。所有卡片圆角不超过 8px。

- [ ] **步骤 4：运行完整前端构建并提交**

运行：`npm run typecheck && npm run build`

预期：PASS，Vite 构建无循环依赖或类型错误。

```powershell
git add src/client/components/Sidebar.tsx src/client/App.tsx src/client/main.tsx src/client/styles/app.css src/client/styles/documents.css
git commit -m "feat: integrate quotation and sales modules"
```

### 任务 15：E2E、备份回归和最终验收

**文件：**
- 创建：`tests/e2e/document-workflow.spec.ts`
- 创建：`scripts/reset-e2e-data.mjs`
- 修改：`playwright.config.ts`
- 修改：`tests/server/backup.test.ts`
- 修改：`README.md`

- [ ] **步骤 1：隔离 E2E 数据目录**

`scripts/reset-e2e-data.mjs` 使用 `resolve('data/e2e')`，先断言目标路径位于项目 `data` 下，再 `rm(..., { recursive: true, force: true })`。`playwright.config.ts` 的 webServer 命令改为：

```text
node scripts/reset-e2e-data.mjs && npm run start
```

并设置 `WORKBENCH_DATA_DIR` 为项目内 `data/e2e`。

- [ ] **步骤 2：编写主要工作流 E2E**

测试通过 API 创建带图片产品和公司资料，再通过 UI：

1. 新建报价单，选择系统产品，添加临时产品，输入价格和税率，保存并导出 PDF。
2. 将报价状态改为已成交，复制为销售开单。
3. 打开销售开单，确认默认不显示图片列，新增“预付款”收款并粘贴/上传凭证。
4. 添加“尾款”，确认付款状态变为已付清、未付款为 0。
5. 导出销售 PDF，确认下载文件名以 `XS` 编号开头。

- [ ] **步骤 3：增加历史快照和备份回归**

服务端测试删除/修改原产品图片和公司 Logo 后，历史单据 PDF 仍生成；备份包含 `quotation-assets`、`sales-document-assets`、`sales-receipt-proofs`，恢复后文件字节和记录数一致。

- [ ] **步骤 4：更新 README 启动说明**

记录首次安装后执行：

```powershell
npm install
npx playwright install chromium
npm run dev
```

说明 PDF 优先调用本机 Edge，若不可用则使用 Playwright Chromium；备份包含报价单、销售单、Logo 快照和收款凭证。

- [ ] **步骤 5：执行完整自动验证**

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

预期：全部命令退出码为 0；E2E 的 PDF 下载存在且文件大小大于 1KB；现有订单状态、箱唛、备份和发货测试继续通过。

- [ ] **步骤 6：执行浏览器视觉验收**

启动：`npm run dev`

使用 Playwright 截图检查：

- 1440x900：报价和销售列表首屏至少 12 行。
- 1280x720：编辑器按钮和合计区不重叠。
- 390x844：侧边栏折叠或可访问，表格提供受控横向滚动，Modal 内容不超出屏幕。
- 报价 PDF A4 纵向：产品图片在品名前独立列，多页重复表头。
- 销售 PDF A4 纵向：默认无图片列，启用后图片完整显示，未付款大写不截断。

- [ ] **步骤 7：提交最终测试与文档**

```powershell
git add tests/e2e/document-workflow.spec.ts scripts/reset-e2e-data.mjs playwright.config.ts tests/server/backup.test.ts README.md
git commit -m "test: cover quotation and sales document workflows"
```

## 最终规格覆盖检查

- 报价单和销售开单使用独立入口、表、编号、状态和 PDF：任务 2、5、6、7、9、12、13、14。
- 报价调用系统产品图片/名称/SKU/规格，支持临时产品和多行：任务 5、10、11、12。
- 报价单字段、公司资料、自定义字段、显示列和税费：任务 1、3、5、11、12。
- `BJYYYYMMDD###`、四种报价状态及仅已成交复制：任务 3、5、6、7。
- 销售单独立新建或从报价复制，默认无图片，可临时开启：任务 7、9、11、13。
- 销售字段、运费、税费、未付款数字与中文大写：任务 1、7、9、13。
- 多笔收款、预付款/尾款备注、付款方式、上传和 Ctrl+V 凭证：任务 8、9、11、13。
- 收款超额拒绝、付款状态自动计算：任务 1、8。
- 历史公司和产品图片快照不受设置/产品库修改影响：任务 4、5、7、15。
- A4 纵向、自动分页、重复表头和图片列规则：任务 4、6、9、15。
- 客户建议来自历史单据且仍可手动修改：任务 3、9、11。
- 新表及附件进入备份恢复：任务 2、4、15。
- 现有订单、箱唛、备货、打包和发货流程不被自动修改：任务 7、14、15。
