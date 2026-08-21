# 财务模块实施计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为现有订单工作台增加财务模块，记录客户水单、审核收款、计算订单应收/已收/未收，并跟踪发票申请、开具和发送状态。

**一期范围：** 以现有 `orders` 为主业务对象；支持一个订单多笔水单和多笔正式收款，水单审核通过后才计入收款；支持一张水单对应一个订单。发票一期按订单记录，允许一订单多张发票，不做跨订单水单分摊、不做合并开票、不做自动银行对账、不改变现有物流状态机。

**架构决策：** 财务状态与订单物流状态分离。订单金额沿用订单保存的 `amountCents` 快照，财务应收金额默认等于订单金额；水单是客户提交的付款证据，收款记录是财务审核后的正式入账；历史付款凭证兼容为“待审核水单”，不删除其文件和记录。新增财务专用表和服务层，不复用销售单据的 `sales_receipts`，因为销售单和客户订单是两条不同业务链路；销售单现有收款功能保持不变。

**技术栈：** React 19、TypeScript、Fastify、SQLite、`@fastify/multipart`、Vitest、Playwright、Vite。

---

## 业务状态与规则

### 财务主状态

订单财务状态使用三个独立字段/聚合结果：

```text
付款状态：未付款 | 部分付款 | 已付款 | 超额付款
水单状态：无水单 | 待审核 | 已审核 | 有驳回
发票状态：未申请 | 资料不完整 | 待开票 | 已开票 | 已发送 | 有作废
```

内部英文值固定为：

```ts
type FinancePaymentStatus = 'unpaid' | 'partial' | 'paid' | 'overpaid';
type FinanceProofStatus = 'none' | 'pending' | 'approved' | 'rejected';
type PaymentProofStatus = 'pending' | 'approved' | 'rejected' | 'void';
type InvoiceStatus = 'not_requested' | 'incomplete' | 'pending_issue' | 'issued' | 'sent' | 'void';
```

- `receivableCents` 在财务记录创建时取订单 `amountCents`，之后只能通过明确的财务调整接口修改；一期不做调整接口，先固定为订单金额。
- `receivedCents` 只统计状态为 `approved` 的收款记录，不统计上传但未审核的水单。
- `outstandingCents = receivableCents - receivedCents`；当 `receivedCents > receivableCents` 时付款状态为 `overpaid`，`outstandingCents` 为负数，用绝对值展示超收金额。
- 水单驳回必须保存 `reviewNote`；审核通过必须生成收款记录，审核通过动作和收款记录写入同一事务。
- 已审核水单不可直接删除，只能作废；待审核水单可以删除，删除时同时删除文件。
- 发票金额合计不得超过订单应收金额，除非未来增加财务调整；发票作废保留原始记录，不能物理删除。
- 财务模块不阻止备货、打包或发货，只在详情和列表提供“未收款发货”提示。

---

## 数据模型

### 1. `order_finance`

每个订单一条财务主记录，使用 `order_id UNIQUE`：

```sql
CREATE TABLE IF NOT EXISTS order_finance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  receivable_cents INTEGER NOT NULL CHECK (receivable_cents >= 0),
  received_cents INTEGER NOT NULL DEFAULT 0 CHECK (received_cents >= 0),
  outstanding_cents INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'overpaid')),
  proof_status TEXT NOT NULL CHECK (proof_status IN ('none', 'pending', 'approved', 'rejected')),
  invoice_status TEXT NOT NULL CHECK (invoice_status IN ('not_requested', 'incomplete', 'pending_issue', 'issued', 'sent', 'void')),
  invoice_requested_at TEXT,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_finance_payment_status ON order_finance(payment_status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_order_finance_proof_status ON order_finance(proof_status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_order_finance_invoice_status ON order_finance(invoice_status, updated_at DESC, id DESC);
```

`outstanding_cents` 允许负数，表示超收；如果希望数据库保持非负，则另增 `overpaid_cents`，但一期采用允许负数的差额字段，避免丢失超收金额。主记录由财务服务在创建订单后同步创建；旧订单由迁移补齐。

### 2. 扩展 `payment_proofs`

保留现有 `relative_path`、`original_name`、`mime_type`、`size_bytes`、`note`、`created_at`，增加：

```sql
ALTER TABLE payment_proofs ADD COLUMN payment_date TEXT;
ALTER TABLE payment_proofs ADD COLUMN amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0);
ALTER TABLE payment_proofs ADD COLUMN payment_method TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_proofs ADD COLUMN payer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_proofs ADD COLUMN transaction_no TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_proofs ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'approved', 'rejected', 'void'));
ALTER TABLE payment_proofs ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_proofs ADD COLUMN reviewed_at TEXT;
```

旧订单已有付款凭证迁移为 `status = 'pending'`、`amount_cents = NULL`、`payment_date = NULL`，财务页面要求补齐金额后才能审核。新增唯一索引防止同一订单重复流水号：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_proofs_order_transaction
  ON payment_proofs(order_id, transaction_no)
  WHERE trim(transaction_no) <> '' AND status <> 'void';
```

### 3. `finance_receipts`

正式收款记录与水单分开，支持一个订单多笔收款：

```sql
CREATE TABLE IF NOT EXISTS finance_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_proof_id INTEGER REFERENCES payment_proofs(id) ON DELETE SET NULL,
  received_at TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_receipts_proof
  ON finance_receipts(payment_proof_id)
  WHERE payment_proof_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_receipts_order ON finance_receipts(order_id, received_at, id);
```

一期不支持无水单手工入账；如业务需要手工收款，第二期增加 `source_type = 'manual' | 'proof'` 和相应权限/操作日志，而不是绕过水单审核逻辑。

### 4. `finance_invoices`

一期允许一个订单多张发票，但只做订单级关联，不做跨订单合并：

```sql
CREATE TABLE IF NOT EXISTS finance_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'incomplete'
    CHECK (status IN ('incomplete', 'pending_issue', 'issued', 'sent', 'void')),
  invoice_type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  tax_no TEXT NOT NULL DEFAULT '',
  recipient_email TEXT NOT NULL DEFAULT '',
  recipient_address TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  invoice_code TEXT NOT NULL DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT '',
  issued_at TEXT,
  sent_at TEXT,
  voided_at TEXT,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finance_invoices_order ON finance_invoices(order_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_finance_invoices_status ON finance_invoices(status, updated_at DESC, id DESC);
```

发票文件使用现有 `FileStore` 增加 `finance-invoice` 类型，存放在 `files/finance-invoices/`，另建 `finance_invoice_files` 表记录文件元数据。发票状态取该订单发票的聚合结果：无发票为 `not_requested`，存在资料不完整为 `incomplete`，全部已发送才为 `sent`，否则按最需要处理的状态展示；具体优先级在服务层固定并测试。

### 5. 备份

`BackupService.tableNames` 加入 `order_finance`、`finance_receipts`、`finance_invoices`、`finance_invoice_files`；水单已有表和文件路径继续进入备份。新增 `files/finance-invoices/...` 到 manifest，恢复时验证数据库外键和发票文件清单。

---

## 文件总览

**创建：**

- `src/shared/finance.ts`：财务状态、标签、主记录/水单/收款/发票共享类型和状态聚合辅助函数。
- `src/server/db/finance-repository.ts`：财务主记录、水单扩展字段、收款、发票及发票附件查询和事务写入。
- `src/server/services/finance-service.ts`：订单财务初始化、列表汇总、水单上传/编辑/审核/作废、收款重算、发票流程和业务校验。
- `src/server/routes/finance.ts`：财务列表、订单财务详情、水单、发票和发票文件接口。
- `src/client/pages/FinancePage.tsx`：财务工作台列表、统计卡、筛选和财务详情弹窗/抽屉。
- `src/client/components/finance/PaymentProofEditor.tsx`：水单上传、编辑和审核控件。
- `src/client/components/finance/InvoiceEditor.tsx`：开票资料、发票状态和发票文件控件。
- `tests/server/finance.test.ts`：财务迁移、服务、路由和文件上传集成测试。
- `tests/unit/finance.test.ts`：状态聚合、金额计算、发票状态优先级测试。
- `tests/e2e/finance.spec.ts`：浏览器端财务核心流程冒烟测试。

**修改：**

- `src/server/db/migrate.ts`：新增财务表、付款凭证列、索引、旧数据补齐和 schema version。
- `src/server/db/repositories.ts`：订单创建/更新/删除时联动财务主记录，或暴露统一初始化方法。
- `src/server/files/file-store.ts`：增加发票文件类型和目录，沿用附件路径安全校验。
- `src/server/config.ts`：发票目录、允许 MIME、单文件大小配置。
- `src/server/main.ts`：创建发票附件目录。
- `src/server/app.ts`：注册财务路由，注入共享数据库和 `FileStore`。
- `src/server/routes/orders.ts`：保留旧付款凭证接口兼容性，并在详情响应中附加财务摘要或明确由财务接口加载。
- `src/server/backup/backup-service.ts`：备份/恢复财务表和发票附件。
- `src/client/api.ts`：财务类型、列表、详情、水单和发票 API。
- `src/client/App.tsx`：注册财务导航、加载页面、订单详情财务摘要回调。
- `src/client/components/Sidebar.tsx`：增加“财务管理”导航项。
- `src/client/pages/OrdersPage.tsx`、`src/client/components/OrderDetailModal.tsx`：增加财务状态摘要和“查看财务”入口。
- `src/client/styles/app.css`、`src/client/styles/tokens.css`：财务列表、金额、状态徽章、审核面板的响应式样式。
- `tests/server/database.test.ts`、`tests/server/backup.test.ts`、`tests/server/order-enhancements.test.ts`：数据库、备份和旧付款凭证回归断言。

---

## 任务 1：建立财务共享类型、金额规则和失败测试

**文件：**

- 创建：`src/shared/finance.ts`
- 创建：`tests/unit/finance.test.ts`
- 创建：`tests/server/finance.test.ts`
- 修改：`src/shared/domain.ts`（仅在需要复用状态标签时；不要改现有物流状态序列）

- [ ] **步骤 1：定义状态和数据类型**

在 `src/shared/finance.ts` 定义：

```ts
export const FINANCE_PAYMENT_STATUS_LABELS = {
  unpaid: '未付款', partial: '部分付款', paid: '已付款', overpaid: '超额付款',
} as const;
export const PAYMENT_PROOF_STATUS_LABELS = {
  none: '无水单', pending: '待审核', approved: '已审核', rejected: '有驳回',
} as const;
export const INVOICE_STATUS_LABELS = {
  not_requested: '未申请', incomplete: '资料不完整', pending_issue: '待开票',
  issued: '已开票', sent: '已发送', void: '已作废',
} as const;
```

定义 `OrderFinanceSummary`、`PaymentProofRecord`、`FinanceReceipt`、`FinanceInvoice`、`FinanceInvoiceFile`、列表统计类型；金额字段全部使用 cents，日期全部使用 `YYYY-MM-DD` 或后端现有 ISO 时间格式，禁止前端浮点金额参与服务层计算。

定义纯函数：

- `deriveFinancePaymentStatus(receivableCents, receivedCents)`；
- `deriveProofStatus(proofs)`；
- `deriveInvoiceStatus(invoices)`；
- `calculateOutstandingCents(receivableCents, receivedCents)`；
- `invoiceStatusLabel` / `proofStatusLabel` / `paymentStatusLabel`。

发票聚合优先级明确为：`incomplete > pending_issue > issued > sent`；若只有作废发票则为 `void`；没有发票则由订单主记录返回 `not_requested`。

- [ ] **步骤 2：先写失败单元测试**

覆盖：

- 0 收款、部分收款、刚好收清、超额收款；
- 待审核/已审核/驳回/作废水单的主状态；
- 发票从资料不完整到发送的聚合优先级；
- 负数、非安全整数、超过应收金额的非法输入；
- 旧订单没有财务记录时返回默认摘要。

- [ ] **步骤 3：运行失败测试**

```text
npm test -- tests/unit/finance.test.ts tests/server/finance.test.ts
```

预期：因共享类型、仓储和路由尚未实现而失败。

---

## 任务 2：数据库迁移、财务仓储和订单初始化

**文件：**

- 修改：`src/server/db/migrate.ts`
- 创建：`src/server/db/finance-repository.ts`
- 修改：`src/server/db/repositories.ts`
- 修改：`src/server/services/order-service.ts`
- 修改：`src/server/routes/orders.ts`
- 修改：`tests/server/database.test.ts`
- 修改：`tests/server/finance.test.ts`

- [ ] **步骤 1：增加 schema 和迁移版本**

在 `schemaSql` 增加 `order_finance`、`finance_receipts`、`finance_invoices`、`finance_invoice_files`；通过版本迁移增加 `payment_proofs` 新列，不能只修改 `CREATE TABLE`，以兼容已有 SQLite 数据库。当前 schema 已支持到版本 11，本功能使用下一个连续版本（建议版本 12），并同步更新 preflight 最大版本检查。

迁移要求：

1. 先创建新表和索引；
2. 使用 `ALTER TABLE ... ADD COLUMN` 并检查列是否存在；
3. 把所有旧订单插入 `order_finance`，`receivable_cents = orders.amount_cents`，其余金额为 0，状态为 `unpaid`、`none`、`not_requested`；
4. 把已有 `payment_proofs` 的 `status` 设为 `pending`，不猜测金额和付款日期；
5. 迁移完成后，按现有付款凭证数量回填主记录 `proof_status = 'pending'`；
6. 迁移在事务中执行并进行 `PRAGMA foreign_key_check`。

- [ ] **步骤 2：实现 FinanceRepository**

仓储提供：

```ts
getOrderFinance(orderId: number): OrderFinanceSummary | undefined;
ensureOrderFinance(orderId: number, receivableCents: number): OrderFinanceSummary;
list(filters: FinanceListFilters): FinanceListResult;
listProofs(orderId: number): PaymentProofRecord[];
getProof(id: number): PaymentProofRecord | undefined;
updateProof(id: number, input: PaymentProofPersistenceInput): PaymentProofRecord | undefined;
insertReceipt(database: DatabaseSync, input: FinanceReceiptPersistenceInput): number;
findReceiptByProof(database: DatabaseSync, proofId: number): FinanceReceipt | undefined;
recalculateOrderFinance(database: DatabaseSync, orderId: number): OrderFinanceSummary;
listInvoices(orderId: number): FinanceInvoice[];
getInvoice(id: number): FinanceInvoice | undefined;
insertInvoice(database: DatabaseSync, input: FinanceInvoicePersistenceInput): number;
updateInvoice(database: DatabaseSync, id: number, input: FinanceInvoicePersistenceInput): boolean;
insertInvoiceFile(database: DatabaseSync, input: FinanceInvoiceFilePersistenceInput): number;
deleteInvoiceFile(database: DatabaseSync, id: number): FinanceInvoiceFile | undefined;
```

列表 SQL 需要 JOIN `orders`、`customers`、`order_finance`，支持订单号、客户、收款状态、水单状态、发票状态、物流状态和分页；统计卡片使用同一筛选条件或同一批结果，避免前后端口径不同。

- [ ] **步骤 3：把新订单接入财务初始化**

在订单创建成功的同一事务内调用 `ensureOrderFinance(orderId, amountCents)`。订单编辑时如果金额发生变化，一期不自动覆盖财务应收快照；服务层返回警告字段或在前端提示“订单金额已变化，财务应收金额仍按历史快照”，避免已开票/已收款订单被静默改账。订单删除依靠 `ON DELETE CASCADE` 清理财务记录，但已上传的发票/水单物理文件必须由服务层删除。

如果当前 `DatabaseRepositories.createOrder()` 内部事务难以注入财务仓储，则把财务初始化放入同一个 repository transaction callback；禁止先提交订单再用独立请求补建财务记录。

- [ ] **步骤 4：补充数据库测试**

验证新表、外键、唯一约束、旧库迁移、旧订单财务记录回填、新订单自动生成财务记录，以及订单删除后的财务级联。

运行：

```text
npm test -- tests/server/database.test.ts tests/server/finance.test.ts
```

---

## 任务 3：水单录入、审核和正式收款后端

**文件：**

- 创建：`src/server/services/finance-service.ts`
- 创建：`src/server/routes/finance.ts`
- 修改：`src/server/routes/orders.ts`
- 修改：`src/server/app.ts`
- 修改：`src/server/db/finance-repository.ts`
- 修改：`tests/server/finance.test.ts`

- [ ] **步骤 1：定义财务服务错误和输入校验**

`FinanceServiceError` 至少包含：

```text
FINANCE_ORDER_NOT_FOUND
PROOF_NOT_FOUND
PROOF_AMOUNT_REQUIRED
PROOF_ALREADY_REVIEWED
PROOF_ALREADY_VOID
PROOF_TRANSACTION_EXISTS
PROOF_ORDER_MISMATCH
RECEIPT_EXISTS
RECEIPT_EXCEEDS_ORDER
INVOICE_NOT_FOUND
INVOICE_AMOUNT_EXCEEDS_ORDER
INVOICE_ALREADY_VOID
INVALID_FINANCE_STATUS
```

水单金额必须是正整数分；付款日期必须是合法日期；交易号、付款方式、付款人等文本统一 trim；审核通过前可编辑基础字段，审核后只能作废；驳回可以重新编辑并再次提交审核，保留原 `reviewNote` 历史无法满足时，至少在一期保留最后一次驳回原因，二期再增加审计表。

- [ ] **步骤 2：实现水单上传和旧接口兼容**

新增接口：

```text
GET    /api/finance/orders/:orderId
GET    /api/finance/orders/:orderId/proofs
POST   /api/finance/orders/:orderId/proofs
PUT    /api/finance/proofs/:id
POST   /api/finance/proofs/:id/approve
POST   /api/finance/proofs/:id/reject
POST   /api/finance/proofs/:id/void
```

`POST` 使用 multipart，字段包括 `file`、`paymentDate`、`amountCents`、`paymentMethod`、`payerName`、`transactionNo`、`note`；文件沿用现有 `payment`/`payment-proofs` 目录、PNG/JPEG/WebP 和 10MB 限制。现有 `POST /api/orders/:id/payment-proofs` 保留，上传的旧格式水单写入 `pending`，金额为空，返回旧响应字段并附加财务字段；前端旧订单保存流程不应中断。

- [ ] **步骤 3：实现审核通过事务**

审核通过时在一个 `withTransaction` 中：

1. 读取并锁定/检查水单状态；
2. 校验金额、订单归属、非重复交易号；
3. 更新水单为 `approved`、写入 `reviewed_at`；
4. 插入 `finance_receipts`，通过唯一索引防重复入账；
5. 汇总该订单所有收款，更新 `order_finance.received_cents`、`outstanding_cents`、`payment_status`、`proof_status`、`updated_at`；
6. 返回更新后的订单财务详情。

拒绝只更新水单状态和原因，并重新聚合 `proof_status`；作废已入账水单时必须同时删除/冲销对应正式收款并重新聚合，不能保留已作废水单对应的有效收款。

- [ ] **步骤 4：实现列表和财务详情**

`GET /api/finance/orders` 返回：

```ts
{
  rows: Array<{
    orderId: number; orderNo: string; customerName: string; orderDate: string;
    receivableCents: number; receivedCents: number; outstandingCents: number;
    paymentStatus: FinancePaymentStatus; proofStatus: FinanceProofStatus;
    invoiceStatus: InvoiceStatus; orderStatus: OrderStatus; updatedAt: string;
  }>;
  total: number; page: number; pageSize: number;
  stats: { receivableCents: number; receivedCents: number; outstandingCents: number; pendingProofCount: number; pendingInvoiceCount: number };
}
```

财务详情返回订单基本信息、主记录、全部水单、正式收款、发票和金额明细；订单详情接口可以只返回轻量 `financeSummary`，避免现有订单列表为每笔订单加载全部附件。

- [ ] **步骤 5：补齐服务和路由测试**

覆盖：上传待审核水单、金额校验、重复流水号、审核通过生成收款、重复审核幂等/拒绝、驳回后重提、作废后金额回退、订单不存在、订单详情和筛选统计。

运行：

```text
npm test -- tests/server/finance.test.ts tests/server/order-enhancements.test.ts
```

---

## 任务 4：发票后端流程和附件存储

**文件：**

- 修改：`src/server/files/file-store.ts`
- 修改：`src/server/config.ts`
- 修改：`src/server/main.ts`
- 修改：`src/server/services/finance-service.ts`
- 修改：`src/server/routes/finance.ts`
- 修改：`src/server/app.ts`
- 修改：`src/server/db/finance-repository.ts`
- 修改：`tests/server/finance.test.ts`
- 修改：`tests/server/file-store-documents.test.ts`

- [ ] **步骤 1：扩展发票文件存储**

在 `FileKind` 增加 `'finance-invoice'`，公共目录增加 `'finance-invoices'`；配置允许 PDF、PNG、JPEG、WebP，单文件上限建议 20MB。可复用 `stageFile()` 的附件校验，但增加独立错误码 `UNSUPPORTED_INVOICE_TYPE`、`INVOICE_TOO_LARGE`，不要把发票误报为合同。

在 `main.ts` 创建目录，在 `app.ts` 继续使用同一个 `FileStore` 实例和统一 multipart 限制；静态文件路径必须经过现有 `resolvePublicPath()`，不允许绝对路径、`..` 或未知目录。

- [ ] **步骤 2：实现发票资料和状态接口**

新增接口：

```text
GET    /api/finance/orders/:orderId/invoices
POST   /api/finance/orders/:orderId/invoices
PUT    /api/finance/invoices/:id
POST   /api/finance/invoices/:id/submit
POST   /api/finance/invoices/:id/issue
POST   /api/finance/invoices/:id/send
POST   /api/finance/invoices/:id/void
POST   /api/finance/invoices/:id/files
DELETE /api/finance/invoice-files/:id
```

创建发票时先允许 `incomplete`，必填资料包括发票类型、抬头、税号、金额；提交开票时强校验资料完整、金额为正且该订单所有有效发票金额合计不超过应收金额。开票动作补录发票号码、代码、开票日期和税额；发送动作要求已有发票文件或明确记录“线下发送”，一期建议强制至少一个发票文件后才能进入 `sent`。作废动作要求备注并保留原记录。

- [ ] **步骤 3：实现发票状态聚合和金额校验**

发票主状态更新后重新计算订单 `invoice_status`。已作废发票不计入有效开票金额；订单发票金额统计按 `status <> 'void'` 汇总。税额由服务层按税率和不含税/含税口径明确计算，第一期建议沿用前端输入的 `amountCents` 和 `taxCents`，不在发票模块隐式反推订单金额。

- [ ] **步骤 4：测试发票流程**

覆盖：资料不完整、提交待开票、金额超订单、开票、上传 PDF/图片、发送、作废、删除文件、文件大小/类型、订单删除清理附件、备份恢复。

运行：

```text
npm test -- tests/server/finance.test.ts tests/server/file-store-documents.test.ts
```

---

## 任务 5：财务前端工作台

**文件：**

- 修改：`src/client/api.ts`
- 修改：`src/client/App.tsx`
- 修改：`src/client/components/Sidebar.tsx`
- 创建：`src/client/pages/FinancePage.tsx`
- 创建：`src/client/components/finance/PaymentProofEditor.tsx`
- 创建：`src/client/components/finance/InvoiceEditor.tsx`
- 修改：`src/client/components/OrderDetailModal.tsx`
- 修改：`src/client/pages/OrdersPage.tsx`
- 修改：`src/client/styles/app.css`
- 修改：`src/client/styles/tokens.css`

- [ ] **步骤 1：扩展客户端类型和 API**

在 `api.ts` 增加：

```ts
getFinanceOrders(filters)
getOrderFinance(orderId)
uploadFinanceProof(orderId, input)
updateFinanceProof(id, input)
approveFinanceProof(id)
rejectFinanceProof(id, note)
voidFinanceProof(id, note)
createFinanceInvoice(orderId, input)
updateFinanceInvoice(id, input)
submitFinanceInvoice(id)
issueFinanceInvoice(id, input)
sendFinanceInvoice(id)
voidFinanceInvoice(id, note)
uploadFinanceInvoiceFile(id, file)
deleteFinanceInvoiceFile(id)
```

所有接口统一使用现有 `request()` 错误包装，不在组件中拼接数据库字段名。金额类型统一用整数分，展示用共享格式化函数或 `Intl.NumberFormat`。

- [ ] **步骤 2：接入导航和 App 页面状态**

`NavigationKey` 增加 `'finance'`，侧栏在“订单管理”之后放“财务管理”。`App.tsx` 增加 FinancePage 分支，沿用现有本地存储导航和 `notify()`。财务页面独立加载列表，不把所有财务详情塞进全局 `orders` 状态。

- [ ] **步骤 3：实现财务列表和统计卡**

页面顶部显示：

```text
待审核水单 | 本期应收 | 本期已收 | 未收金额 | 待开票
```

筛选：关键词（订单号/客户）、付款状态、水单状态、发票状态、订单物流状态、日期范围。表格列：订单号、客户、订单日期、应收、已收、未收、付款状态、水单状态、发票状态、物流状态、操作。

颜色只表达状态，不改变现有品牌色：未付款使用 warning，已付款使用 success，超额付款使用 info 或 warning；金额对齐、表格支持横向滚动、空态和加载态清晰。

- [ ] **步骤 4：实现水单审核组件**

`PaymentProofEditor` 支持：

- 上传图片并填写付款日期、金额、付款方式、付款人、流水号、备注；
- 待审核状态编辑；
- 审核通过、驳回并填写原因、作废；
- 显示水单缩略图、原文件名、金额、审核状态、审核时间；
- 审核操作进行中禁用同一行按钮；
- 不再允许把“上传成功”文案显示为“已收款”，明确显示“待审核”。

保留订单编辑器现有付款凭证上传能力，但在财务模块提示“旧格式凭证需要补充金额后审核”。

- [ ] **步骤 5：实现发票组件**

`InvoiceEditor` 支持：

- 创建/编辑发票资料；
- 状态推进：提交开票、录入发票号码并标记已开票、上传文件并发送、作废；
- 发票金额合计、税额和订单应收金额提示；
- 显示开票资料快照，避免客户档案变化影响历史发票；
- 文件打开/下载/删除；
- 作废前二次确认，作废后只读。

- [ ] **步骤 6：接入订单详情摘要**

订单详情顶部增加轻量财务卡片：

```text
应收 ¥... | 已收 ¥... | 未收 ¥... | 付款状态
水单：待审核 | 发票：待开票
```

增加“打开财务详情”按钮，调用 `onOpenFinance(orderId)`，不在订单详情中直接执行审核/开票，避免弹窗层级和权限逻辑混乱。订单详情加载财务摘要失败时不影响订单主体展示。

- [ ] **步骤 7：运行前端类型检查**

```text
npm run typecheck
```

预期：PASS。

---

## 任务 6：备份、回归测试和浏览器冒烟

**文件：**

- 修改：`src/server/backup/backup-service.ts`
- 修改：`tests/server/backup.test.ts`
- 修改：`tests/server/order-enhancements.test.ts`
- 创建：`tests/e2e/finance.spec.ts`
- 修改：`tests/server/database.test.ts`

- [ ] **步骤 1：补齐备份恢复**

创建包含订单、水单、审核通过收款、发票和发票文件的临时数据；验证：

- manifest 包含财务表记录数；
- `files/payment-proofs/...` 和 `files/finance-invoices/...` 都在附件列表；
- 恢复后订单财务摘要、收款、发票状态和物理文件一致；
- 恢复非法路径或数据库外键错误时保留当前数据和安全备份。

- [ ] **步骤 2：旧功能回归**

至少运行并通过：

```text
npm test -- tests/server/order-enhancements.test.ts tests/server/backup.test.ts tests/server/database.test.ts tests/server/sales-documents.test.ts
```

重点确认：

- 旧订单付款凭证 API 响应不破坏；
- 销售单收款和付款凭证不受财务订单表影响；
- 订单状态推进、发货、报价单、客户产品库继续通过；
- 备份中已有表和附件不丢失。

- [ ] **步骤 3：浏览器端核心流程**

在 `tests/e2e/finance.spec.ts` 使用现有 Playwright 配置验证：

1. 打开财务管理，看到统计卡和订单列表；
2. 搜索订单并打开财务详情；
3. 上传一张水单，录入金额，列表显示“待审核”；
4. 审核通过后已收增加、未收减少、付款状态更新；
5. 驳回另一张水单并看到驳回原因；
6. 创建发票申请，补齐资料，上传 PDF，标记已开票并发送；
7. 回到订单详情，财务摘要显示最新付款和发票状态；
8. 刷新页面后状态和附件仍存在。

- [ ] **步骤 4：完整验证**

按顺序运行：

```text
npm run typecheck
npm test
npm run build
npm run test:e2e
 git diff --check
```

如果端到端测试服务启动失败，先运行 `npm run build`，检查 `npm run start` 使用的 `dist` 是否为本轮构建结果，再重跑；不能以跳过浏览器测试作为完成条件。

---

## 完成标准

执行完本计划后必须满足：

1. 每个订单都有财务主记录，应收金额按订单金额快照初始化；
2. 客户上传水单后状态为待审核，不会立即增加已收金额；
3. 审核通过在事务内生成正式收款并自动更新已收、未收和付款状态；
4. 水单可驳回、重提和作废，审核记录和附件不因普通删除丢失；
5. 财务模块支持订单级发票申请、开票、发送、作废和文件附件；
6. 财务列表支持金额、付款、水单、发票和物流状态筛选，并显示统计卡；
7. 订单详情能看到财务摘要，但财务状态不改变既有物流状态机；
8. 财务表、付款凭证、收款、发票和发票附件进入备份恢复；
9. 旧订单、旧付款凭证、报价单、销售单、发货和产品模块通过回归测试；
10. `npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e`、`git diff --check` 全部成功。

---

## 第二期明确不在本计划内

- 一张水单分配给多个订单；
- 多订单合并开票；
- 客户账期、逾期自动提醒和信用额度；
- 银行流水导入与自动对账；
- 手工收款、退款、冲销和完整会计凭证；
- 财务操作审计日志和角色权限；
- 发票红冲关联链；
- 财务报表、利润、成本和供应商应付账款。
