# 订单增强功能实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为订单管理增加 `SOYYYYMMDD001` 自动订单号、可维护客户来源类型，以及支持 PDF/Word/Excel/图片的多合同附件管理。

**架构：** 订单自动编号由 SQLite 事务内的日期流水表生成，预览接口只读取下一个可用编号，不提前消耗流水。客户来源配置使用独立表，但订单继续保存来源名称文本快照；合同使用独立附件表和 `FileStore` 的 `order-contracts` 目录，保存订单主体后再上传文件。

**技术栈：** React 19、TypeScript、Fastify、`@fastify/multipart`、Node SQLite、Vitest、Vite。

---

## 文件总览

**创建：**

- `src/server/services/order-number-service.ts`：生成、预览和格式化订单号。
- `src/server/db/order-source-repository.ts`：客户来源类型的查询、新增、删除/停用。
- `src/server/routes/order-source-types.ts`：客户来源类型的 HTTP 接口。
- `tests/server/order-enhancements.test.ts`：订单号、来源、合同接口和附件存储集成测试。

**修改：**

- `src/server/config.ts`：合同目录、允许类型和 20MB 单文件限制；暴露 `orderContractsDirectory`、`maxContractSize`、`allowedContractMimeTypes` 配置字段。
- `src/server/files/file-store.ts`：增加合同附件保存能力和 `order-contracts` 公共目录。
- `src/server/db/migrate.ts`：增加订单号流水、来源类型、合同表和索引，并初始化微信/1688。
- `src/server/db/repositories.ts`：自动订单号创建、合同记录、订单详情合同列表。
- `src/server/services/order-service.ts`：合同上传、列表、合同删除和订单级合同文件清理服务。
- `src/server/routes/orders.ts`：自动订单号和合同上传/列表接口，并区分新建与编辑订单号校验。
- `src/server/app.ts`：注册来源接口和订单附件依赖；保持 `AppOptions.fileStore` 作为所有附件路由共用的 `FileStore` 实例，并配置 multipart 的合同上限。
- `src/server/main.ts`：创建 `order-contracts` 附件目录，使用统一的 `FileStore` 配置。
- `src/server/backup/backup-service.ts`：备份新增表记录和合同文件。
- `src/client/api.ts`：订单号、来源、合同 API 与订单详情类型。
- `src/client/App.tsx`：加载来源、保存订单后上传合同、删除合同。
- `src/client/pages/OrdersPage.tsx`：向表单和详情弹窗传递来源/合同回调。
- `src/client/components/OrderForm.tsx`：自动订单号、来源管理、合同选择和待上传文件。
- `src/client/components/OrderDetailModal.tsx`：合同列表、打开/下载和删除。
- `tests/server/database.test.ts`：增加新表和迁移断言。
- `tests/server/backup.test.ts`：增加新表、来源和合同附件的备份/恢复断言。

---

### 任务 1：建立订单编号与客户来源的数据基础

**文件：**

- 创建：`src/server/services/order-number-service.ts`
- 创建：`src/server/db/order-source-repository.ts`
- 创建：`src/server/routes/order-source-types.ts`
- 修改：`src/server/db/migrate.ts`
- 修改：`src/server/db/repositories.ts`
- 修改：`src/server/routes/orders.ts`
- 修改：`src/server/app.ts`
- 修改：`tests/server/database.test.ts`
- 测试：`tests/server/order-enhancements.test.ts`

- [ ] **步骤 1：先写订单号和来源的失败测试**

在 `tests/server/order-enhancements.test.ts` 中建立临时数据库辅助函数，并加入以下测试骨架，确保当前代码先失败：

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';
import { DatabaseRepositories } from '../../src/server/db/repositories';
import { OrderNumberService } from '../../src/server/services/order-number-service';
import { OrderSourceRepository } from '../../src/server/db/order-source-repository';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-orders-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  return { database, repositories: new DatabaseRepositories(database) };
}

describe('订单号与客户来源基础设施', () => {
  it('按日期生成 SOYYYYMMDD001，并在同一天递增', async () => {
    const { database } = await makeDatabase();
    const numbers = new OrderNumberService(database);

    expect(numbers.preview(new Date('2026-08-10T00:00:00.000Z'))).toBe('SO20260810001');
    expect(numbers.next(new Date('2026-08-10T00:00:00.000Z'))).toBe('SO20260810001');
    expect(numbers.next(new Date('2026-08-10T01:00:00.000Z'))).toBe('SO20260810002');
    database.close();
  });

  it('初始化默认来源微信和1688，并允许新增来源', async () => {
    const { database } = await makeDatabase();
    const sources = new OrderSourceRepository(database);

    expect(sources.listActive().map((source) => source.name)).toEqual(['微信', '1688']);
    expect(sources.create('线下').name).toBe('线下');
    expect(sources.listActive().map((source) => source.name)).toContain('线下');
    database.close();
  });
});
```

- [ ] **步骤 2：运行失败测试，确认缺少实现**

运行：

```text
npm test -- tests/server/order-enhancements.test.ts
```

预期：FAIL，原因包括 `order-number-service.ts`、`order-source-repository.ts` 尚不存在或新表尚未创建。

- [ ] **步骤 3：实现订单号服务和迁移表**

在 `src/server/services/order-number-service.ts` 中实现以下接口：

```ts
import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from '../db/connection.js';

export function orderDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

export function formatOrderNumber(dateKey: string, sequence: number): string {
  if (!/^\d{8}$/.test(dateKey) || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('订单号日期或流水号无效');
  }
  return `SO${dateKey}${String(sequence).padStart(3, '0')}`;
}

export class OrderNumberService {
  constructor(private readonly database: DatabaseSync) {}

  preview(date = new Date()): string {
    const dateKey = orderDateKey(date);
    const current = this.database.prepare(
      'SELECT last_value FROM order_number_sequences WHERE sequence_date = ?',
    ).get(dateKey) as { last_value?: unknown } | undefined;
    let sequence = Math.max(0, Number(current?.last_value ?? 0));
    do {
      sequence += 1;
    } while (this.database.prepare('SELECT 1 FROM orders WHERE order_no = ?').get(formatOrderNumber(dateKey, sequence)));
    return formatOrderNumber(dateKey, sequence);
  }

  next(date = new Date()): string {
    const dateKey = orderDateKey(date);
    return withTransaction(this.database, (database) => {
      const row = database.prepare(
        'SELECT last_value FROM order_number_sequences WHERE sequence_date = ?',
      ).get(dateKey) as { last_value?: unknown } | undefined;
      let sequence = Math.max(0, Number(row?.last_value ?? 0));
      do {
        sequence += 1;
      } while (database.prepare('SELECT 1 FROM orders WHERE order_no = ?').get(formatOrderNumber(dateKey, sequence)));
      database.prepare(
        `INSERT INTO order_number_sequences (sequence_date, last_value) VALUES (?, ?)
         ON CONFLICT(sequence_date) DO UPDATE SET last_value = excluded.last_value`,
      ).run(dateKey, sequence);
      return formatOrderNumber(dateKey, sequence);
    });
  }
}
```

在 `src/server/db/migrate.ts` 增加：

```sql
CREATE TABLE IF NOT EXISTS order_number_sequences (
  sequence_date TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL CHECK (last_value > 0)
);

CREATE TABLE IF NOT EXISTS order_source_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

迁移事务中使用 `INSERT ... ON CONFLICT DO NOTHING` 初始化 `微信`、`1688`，再把现有 `orders.source_type` 中非空且未入表的名称插入为 `is_active = 0`。新增 `idx_order_source_types_active` 和 `idx_order_source_types_name` 索引，并把 `schema_version` 更新为 `3`。

- [ ] **步骤 4：实现来源仓储和自动编号订单创建**

在 `src/server/db/order-source-repository.ts` 实现以下方法，所有名称先 `trim()`：

```ts
export interface OrderSourceType {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export class OrderSourceRepository {
  constructor(private readonly database: DatabaseSync) {}
  list(includeInactive = false): OrderSourceType[];
  listActive(): OrderSourceType[];
  create(name: string): OrderSourceType;
  removeOrDeactivate(id: number): { source: OrderSourceType; mode: 'deleted' | 'deactivated' } | undefined;
}
```

在 `DatabaseRepositories` 构造函数中创建 `OrderNumberService`，并提供公开的 `previewNextOrderNumber(date?: Date)` 方法供路由调用。将 `CreateOrderInput.orderNo` 改成可选或空字符串可接受。`createOrder()` 插入订单前执行：

```ts
const orderNo = input.orderNo.trim() || this.orderNumbers.next();
```

该表达式必须位于已有 `withTransaction` 回调内；`withTransaction()` 已支持嵌套调用，因此流水递增和订单插入仍属于同一 SQLite 事务。`updateOrder()` 仍要求非空订单号，且不调用自动编号服务。任务 1 不改订单详情的附件字段，任务 2 完成合同查询时一次性返回真实的 `contracts` 字段。

在新建的 `src/server/routes/order-source-types.ts` 中实现：

- `GET /api/order-source-types?includeInactive=1|0`：默认只返回启用项；
- `POST /api/order-source-types`：接收 `{ name }`，名称去首尾空格，重复名称返回 `409` 和错误码 `SOURCE_TYPE_EXISTS`；
- `DELETE /api/order-source-types/:id`：删除未被订单使用的来源，返回 `mode: "deleted"`；已被历史订单使用的来源只更新为停用，返回 `mode: "deactivated"`，不能删除历史订单中的文本快照；删除前由前端确认。

路由层通过 `OrderSourceRepository` 处理业务，不直接写 SQL；`list` 的响应字段统一映射为 `id`、`name`、`isActive`、`createdAt`、`updatedAt`。

在 `src/server/app.ts` 创建 `new OrderSourceRepository(options.database)`，注册 `registerOrderSourceTypeRoutes(app, { repository })`，并与订单路由一起挂载到同一个 Fastify 实例；来源路由不依赖 `FileStore`，测试创建 app 时只需提供现有 database/repositories 参数。

订单号预览路由必须注册在动态路由之前：在 `src/server/routes/orders.ts` 中先注册 `GET /api/orders/next-number`，再注册 `GET /api/orders/:id`，避免 `next-number` 被当成订单 ID。该路由调用 `options.repositories.previewNextOrderNumber()`，只读当前日期流水和订单表，不递增流水。`POST /api/orders` 和 `PUT /api/orders/:id` 都使用同一套 `parseOrderInput()`；新建允许 `orderNo` 为空并由仓储生成，编辑必须传入非空订单号并保留原订单号，手动改号时沿用现有唯一性错误映射 `ORDER_NO_EXISTS`。

具体解析方式：将 `parseOrderInput(value, { allowEmptyOrderNo = false } = {})` 的 `orderNo` 分支写成 `allowEmptyOrderNo ? optionalText(body.orderNo, 'orderNo', '订单号') : requiredText(body.orderNo, 'orderNo', '订单号')`；POST 调用时传 `{ allowEmptyOrderNo: true }`，PUT 调用时保留默认值。`OrderService.validateInput(input, { allowEmptyOrderNo })` 也采用同一规则，避免直接调用服务层时绕过编辑订单号校验。

- [ ] **步骤 5：补充来源路由、数据库断言并运行基础测试**

更新 `tests/server/database.test.ts` 的表名期望，加入 `order_number_sequences`、`order_source_types`；检查 schema 版本为 `3`、默认来源存在、两个新表的外键和约束可用。

在 `tests/server/order-enhancements.test.ts` 中使用 `app.inject()` 增加来源接口断言：重复名称返回 `SOURCE_TYPE_EXISTS`；未被订单使用的来源删除返回 `mode: "deleted"`；被订单使用的来源删除返回 `mode: "deactivated"`，默认列表隐藏而 `includeInactive=1` 仍返回。

运行：

```text
npm test -- tests/server/database.test.ts tests/server/order-enhancements.test.ts
```

预期：新增订单号与来源测试 PASS，数据库基础测试 PASS。

- [ ] **步骤 6：提交基础设施变更**

```text
git add src/server/services/order-number-service.ts src/server/db/order-source-repository.ts src/server/db/migrate.ts src/server/db/repositories.ts tests/server/database.test.ts tests/server/order-enhancements.test.ts
git commit -m "feat: add order numbering and source types"
```

### 任务 2：增加合同文件存储、数据库记录和后端接口

**文件：**

- 修改：`src/server/config.ts`
- 修改：`src/server/files/file-store.ts`
- 修改：`src/server/db/migrate.ts`
- 修改：`src/server/db/repositories.ts`
- 修改：`src/server/services/order-service.ts`
- 修改：`src/server/routes/orders.ts`
- 修改：`src/server/app.ts`
- 修改：`src/server/main.ts`
- 修改：`src/server/backup/backup-service.ts`
- 测试：`tests/server/order-enhancements.test.ts`
- 测试：`tests/server/backup.test.ts`

- [ ] **步骤 1：先写合同附件和 FileStore 的失败测试**

在 `tests/server/order-enhancements.test.ts` 增加（复用任务 1 建立的 `makeTemporaryDirectory()` 和清理数组）：

```ts
it('保存合同到 order-contracts 目录，并拒绝不支持的类型', async () => {
  const directory = await makeTemporaryDirectory();
  const store = new FileStore(join(directory, 'files'), 10 * 1024 * 1024, 20 * 1024 * 1024);
  const stored = await store.saveContract(
    Readable.from([Buffer.from('%PDF-1.7')]),
    '合同.pdf',
    'application/pdf',
  );

  expect(stored.relativePath).toMatch(/^order-contracts\/[0-9a-f-]+\.pdf$/);
  expect(stored.originalName).toBe('合同.pdf');
  await expect(store.saveContract(
    Readable.from([Buffer.from('bad')]), '合同.txt', 'text/plain',
  )).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTRACT_TYPE' });
});
```

增加路由测试：创建一个订单后 `POST /api/orders/:id/contracts` 上传 PDF、Word、Excel 和图片，`GET` 返回四项，删除其中一项后数据库记录和文件都不存在；不支持类型返回 415，订单不存在返回 404。

- [ ] **步骤 2：运行失败测试**

运行：

```text
npm test -- tests/server/order-enhancements.test.ts
```

预期：FAIL，原因是 `saveContract`、`order_contracts` 表和合同路由尚未实现。

- [ ] **步骤 3：扩展配置和 FileStore**

在 `src/server/config.ts` 增加：

```ts
export const MAX_CONTRACT_SIZE = 20 * 1024 * 1024;
export const ALLOWED_CONTRACT_MIME_TYPES = [
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png', 'image/jpeg', 'image/webp',
] as const;
```

在 `FileStore` 中：

- `FileKind` 加入 `'order-contract'`；
- 公共目录加 `'order-contracts'`，并在 `directoryByKind` 映射；
- `StoredFile.mimeType` 改为 `string`，保持现有图片调用兼容；
- 构造函数改为 `constructor(rootDirectory: string, maxImageSize = MAX_IMAGE_SIZE, maxContractSize = MAX_CONTRACT_SIZE)`；
- 新增 `saveContract(stream, originalName, mime)`，使用 UUID 文件名、合同 MIME/扩展名白名单和 20MB 限制；
- 新增错误码 `UNSUPPORTED_CONTRACT_TYPE`、`CONTRACT_TOO_LARGE`；
- `resolvePublicPath()` 允许 `order-contracts`，继续拒绝绝对路径、`..`、未知目录和多余路径段。

图片 `saveImage()` 的 10MB 校验和原有行为保持不变。

- [ ] **步骤 4：增加合同表和仓储方法**

在 `src/server/db/migrate.ts` 增加：

```sql
CREATE TABLE IF NOT EXISTS order_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_contracts_order
  ON order_contracts(order_id, created_at DESC, id DESC);
```

在 `DatabaseRepositories` 增加：

```ts
listOrderContracts(orderId: number);
addOrderContract(orderId: number, input: { relativePath: string; originalName: string; mimeType: string; size: number });
getOrderContract(contractId: number);
deleteOrderContract(contractId: number): { relativePath: string; orderId: number } | undefined;
```

将 `getOrderDetail()` 的返回值改为 `{ ...order, items, labels, paymentProofs, contracts }`。

- [ ] **步骤 5：实现合同服务和路由**

在 `OrderService` 增加：

```ts
export interface OrderContractRecord {
  id: number;
  orderId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

listContracts(orderId: number): OrderContractRecord[];
async uploadContract(orderId: number, stream: Readable, originalName: string, mimeType: string): Promise<OrderContractRecord>;
async deleteContract(contractId: number): Promise<OrderContractRecord | undefined>;
```

上传失败时删除已经保存的物理文件；成功写入合同数据库记录后才返回响应。删除合同必须先从数据库取得并删除记录，再按返回的 `relativePath` 调用 `FileStore.deleteFile()`，即使物理文件已经不存在也要保证数据库记录被清除。将现有同步的 `delete(orderId)` 改为 `async delete(orderId): Promise<boolean>`：先读取该订单所有合同的相对路径，再删除订单数据库记录（依靠 `ON DELETE CASCADE` 清除合同记录），最后逐个删除物理文件；物理文件不存在按幂等删除处理，不能留下合同孤儿文件。订单删除路由使用 `await service.delete(...)`。映射合同响应时附加 `url: /files/${relativePath}`。

在 `src/server/routes/orders.ts` 注册：

```text
GET    /api/orders/:id/contracts
POST   /api/orders/:id/contracts
DELETE /api/order-contracts/:id
```

上传只接受一个名为 `file` 的 `file` part；使用 `request.parts()` 遍历并拒绝第二个文件，先验证订单存在，再把文件流传给 `uploadContract()`，不能在调用 `toBuffer()` 后再重复读取同一流。路由错误映射：`UNSUPPORTED_CONTRACT_TYPE` 返回 415，`CONTRACT_TOO_LARGE`、`FST_REQ_FILE_TOO_LARGE` 返回 413，没有文件返回 400，订单/合同不存在返回 404。`safeRoute()`/`serviceError()` 必须保留这些错误码，不要把它们统一转换成普通 400。

- [ ] **步骤 6：注册目录、备份和 multipart 上限**

在 `src/server/config.ts` 中把 `orderContractsDirectory` 定义为 `join(filesDirectory, 'order-contracts')`，把 `maxContractSize` 设为 `MAX_CONTRACT_SIZE`，把 `allowedContractMimeTypes` 设为 `ALLOWED_CONTRACT_MIME_TYPES`。在 `src/server/main.ts` 的启动目录列表中加入 `mkdir(config.orderContractsDirectory, { recursive: true })`，并使用 `new FileStore(config.filesDirectory, config.maxImageSize, config.maxContractSize)` 创建唯一实例传给 `createApp({ fileStore: ... })`；`createApp()` 不再自行创建第二个 `FileStore`，只使用 `options.fileStore` 供订单、产品、报价单和销售开单路由共用，静态 `/files/` 仍以 `options.filesDirectory` 为根目录。

在 `src/server/app.ts`：

- `@fastify/multipart` 的 `limits.fileSize` 使用 `MAX_CONTRACT_SIZE`，让 multipart 层允许合同达到 20MB；图片的 10MB 限制仍由 `FileStore.saveImage()` 执行；
- `FST_REQ_FILE_TOO_LARGE` 和 status 413 统一映射为 `FILE_TOO_LARGE`、HTTP 413、消息“文件不能超过 20MB”，而图片自身超出 10MB 的 `FileStoreError` 仍映射为 `IMAGE_TOO_LARGE`；
- 注册订单路由时传入同一个 `options.fileStore`，合同路由使用 `request.parts()` 只读取一个名为 `file` 的文件 part，并将 multipart 的超限错误交给统一错误处理器。

在 `BackupService` 的 `tableNames` 增加 `order_number_sequences`、`order_source_types`、`order_contracts`。更新 `tests/server/backup.test.ts`，验证合同文件出现在 manifest 的 `files/order-contracts/...` 中，恢复后合同表记录和文件都存在。

- [ ] **步骤 7：运行后端合同测试和备份测试**

运行：

```text
npm test -- tests/server/order-enhancements.test.ts tests/server/backup.test.ts tests/server/database.test.ts
```

预期：合同格式、大小、订单关联、删除、级联删除、备份恢复测试全部 PASS。

- [ ] **步骤 8：提交后端合同能力**

```text
git add src/server/config.ts src/server/files/file-store.ts src/server/db/migrate.ts src/server/db/repositories.ts src/server/services/order-service.ts src/server/routes/orders.ts src/server/app.ts src/server/main.ts src/server/backup/backup-service.ts tests/server/order-enhancements.test.ts tests/server/backup.test.ts
git commit -m "feat: add order contract attachments"
```

### 任务 3：接通前端订单号、来源和合同 API

**文件：**

- 修改：`src/client/api.ts`
- 修改：`src/client/components/OrderForm.tsx`
- 修改：`src/client/App.tsx`
- 修改：`src/client/pages/OrdersPage.tsx`

- [ ] **步骤 1：扩展前端 API 类型和函数**

在 `src/client/api.ts` 增加：

```ts
export interface ApiOrderSourceType {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiOrderContract {
  id: number;
  orderId: number;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
}

export function getNextOrderNumber() {
  return request<{ number: string; date: string }>('/api/orders/next-number');
}

export function getOrderSourceTypes(includeInactive = true) {
  return request<ApiOrderSourceType[]>(`/api/order-source-types?includeInactive=${includeInactive ? '1' : '0'}`);
}

export function createOrderSourceType(name: string) {
  return request<ApiOrderSourceType>('/api/order-source-types', { method: 'POST', body: JSON.stringify({ name }) });
}

export function deleteOrderSourceType(id: number) {
  return request<{ id: number; name: string; isActive: boolean; mode: 'deleted' | 'deactivated' }>(`/api/order-source-types/${id}`, { method: 'DELETE' });
}

export async function uploadOrderContract(orderId: number | string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<ApiOrderContract>(`/api/orders/${orderId}/contracts`, { method: 'POST', body: form });
}

export function deleteOrderContract(id: number | string) {
  return request(`/api/order-contracts/${id}`, { method: 'DELETE' });
}
```

扩展 `ApiOrderDetail`：

```ts
contracts: ApiOrderContract[];
```

将现有 `saveOrder()` 改为按草稿是否含有 `id` 选择接口：新建调用 `POST /api/orders`，编辑调用 `PUT /api/orders/:id`；两者都发送 `draftToInput(draft)` 的 JSON，合同文件不放入订单 JSON body。`draftToInput()` 继续发送 `orderNo: draft.orderNo.trim()`；新建表单自动号失败时可发送空字符串，由服务端生成。

- [ ] **步骤 2：在 OrderForm 中加入明确的合同草稿类型**

在 `src/client/components/OrderForm.tsx` 增加：

```ts
export interface OrderContractDraft {
  id: string;
  name: string;
  url: string;
  file?: File;
  mimeType?: string;
  size?: number;
  createdAt?: string;
}
```

把 `OrderDraft` 增加：

```ts
orderNoAuto: boolean;
contracts: OrderContractDraft[];
deletedContractIds: string[];
```

`defaultDraft()` 对新订单初始化 `orderNoAuto: true`、空合同数组和空删除数组；编辑订单初始化 `orderNoAuto: false`，保留已保存合同并初始化空删除数组。`draftToInput()` 不序列化 `orderNoAuto`、`contracts`、`deletedContractIds` 这三个前端字段。

- [ ] **步骤 3：为 OrderForm 增加可调用的 props**

将 `OrderFormProps` 扩展为：

```ts
sourceTypes: Array<{ id: number; name: string; isActive: boolean }>;
onAddSourceType?: (name: string) => Promise<{ id: number; name: string; isActive: boolean } | undefined>;
onDeleteSourceType?: (id: number) => Promise<void>;
onGetNextOrderNumber?: () => Promise<string | undefined>;
```

订单详情中的合同删除不在表单内部调用 API，表单只维护 `deletedContractIds`，由保存订单的上层统一删除。

- [ ] **步骤 4：实现新建订单的自动号和来源控件**

在 `OrderForm` 中：

- 新建订单且 `value?.id` 不存在时调用 `onGetNextOrderNumber()`，初始化 `orderNoAuto: true`；成功后仅当订单号仍为空或仍等于原自动预览值时写入结果；自动预览失败时保持空值并允许继续录入；
- 订单号输入框的 `onChange` 继续允许用户覆盖自动号，用户输入非空内容后将 `orderNoAuto` 置为 `false`；用户清空输入时恢复为 `true`；新建表单不因空订单号阻止提交，由服务端负责最终生成；编辑订单始终回显并保留原订单号，只有用户主动修改才发送新值；
- 来源下拉只显示 `isActive` 来源，新建订单默认选择第一项（微信）；编辑订单若当前值是停用来源，额外显示 `<option disabled>` 并保留回显；
- 在来源下拉右侧放 `Plus` 和 `Trash2` 图标按钮；添加使用 `window.prompt('请输入客户来源类型')`，调用 `onAddSourceType()` 后将新名称写入 `draft.sourceType`；删除使用 `window.confirm()`，调用当前来源对应 ID 的 `onDeleteSourceType()`，成功后刷新父级来源并清空或切换到第一个启用来源；
- 添加/删除请求进行中禁用相应按钮，错误显示在表单错误区域。

订单号输入框 placeholder 改为“自动生成，可手动修改”，不再提示“手动填写”。

- [ ] **步骤 5：实现合同选择和待上传状态**

在 `OrderForm` 增加合同区域，使用原生 `input type="file" multiple`，accept 精确写成：

```text
.pdf,.doc,.docx,.xls,.xlsx,image/png,image/jpeg,image/webp
```

文件选择时：

- 过滤扩展名和 MIME，不支持时显示“合同仅支持 PDF、Word、Excel 或 PNG/JPEG/WebP 图片”；
- 用 `URL.createObjectURL()` 只给图片提供预览，非图片显示文件类型图标和原始文件名；
- 选择的新文件写入 `draft.contracts`，`id` 使用现有前端随机 ID；
- 删除新文件仅从数组中移除并释放 object URL；
- 删除已保存文件只从显示数组移除，并把其数字 ID 放入 `deletedContractIds`；取消编辑时不调用删除接口；
- 每项显示文件名和大小。

付款凭证 `ImagePasteUpload` 区域保持原样，合同不支持 Ctrl+V，不与凭证备注共用字段。

- [ ] **步骤 6：运行前端类型检查**

运行：

```text
npm run typecheck
```

预期：如果此时 `App.tsx` 尚未补齐 props，TypeScript 会指出调用处缺失；完成任务 4 后必须恢复 PASS。

### 任务 4：接通页面状态、保存流程和订单详情

**文件：**

- 修改：`src/client/App.tsx`
- 修改：`src/client/pages/OrdersPage.tsx`
- 修改：`src/client/components/OrderDetailModal.tsx`

- [ ] **步骤 1：扩展订单详情映射**

在 `App.tsx` 的 `mapOrderDetail()` 中增加合同映射：

```ts
contracts: (Array.isArray(raw.contracts) ? raw.contracts : []).map((contract) => {
  const item = contract as Record<string, unknown>;
  const relativePath = String(item.relative_path ?? item.relativePath ?? '');
  return {
    id: String(item.id),
    name: String(item.original_name ?? item.originalName ?? '合同附件'),
    url: String(item.url ?? `/files/${relativePath}`),
    mimeType: String(item.mime_type ?? item.mimeType ?? ''),
    size: Number(item.size ?? item.size_bytes ?? 0),
    createdAt: String(item.created_at ?? item.createdAt ?? ''),
  };
}),
deletedContractIds: [],
```

已有订单映射的付款凭证和箱唛字段保持不变。

- [ ] **步骤 2：在 App 中加载来源并实现来源回调**

新增状态：

```ts
const [orderSourceTypes, setOrderSourceTypes] = useState<ApiOrderSourceType[]>([]);
```

新增 `loadOrderSourceTypes()`，在初始 `Promise.all()` 中调用。新增回调：

```ts
const addOrderSourceType = async (name: string) => {
  const created = await createOrderSourceType(name);
  await loadOrderSourceTypes();
  notify(`已添加客户来源：${created.name}`, 'success');
  return created;
};

const removeOrderSourceType = async (id: number) => {
  const result = await deleteOrderSourceType(id);
  await loadOrderSourceTypes();
  notify(result.mode === 'deactivated' ? '该来源已停用，历史订单不受影响' : '客户来源已删除', 'success');
};
```

加载失败通过现有 `notify()` 显示“客户来源加载失败”。

- [ ] **步骤 3：在 App 中完成订单保存后的合同同步**

在 `saveOrderDraft()` 中保持当前顺序：先按草稿 `id` 由 `saveOrder(draft)` 选择 POST/PUT 保存订单主体，再上传新付款凭证。之后执行：

```ts
for (const contract of draft.contracts.filter((item) => item.file)) {
  try {
    await uploadOrderContract(orderId, contract.file!);
  } catch (error) {
    notify(`${contract.name} 上传失败：${(error as { message?: string }).message ?? '未知错误'}`, 'error');
  }
}
for (const contractId of draft.deletedContractIds) {
  try {
    await deleteOrderContract(contractId);
  } catch (error) {
    notify(`合同删除失败：${(error as { message?: string }).message ?? '未知错误'}`, 'error');
  }
}
await loadOrders();
```

合同删除失败时单独提示，不回滚已保存的订单主体和已经上传成功的合同。保存成功后关闭表单的既有行为保持不变。取消编辑时不执行 `deletedContractIds` 中的删除操作。

新增 `removeContract()`：删除详情中的合同后调用 `deleteOrderContract()`、刷新订单列表并提示成功。

- [ ] **步骤 4：在 OrdersPage 传递来源和合同回调**

扩展 `OrdersPageProps`：

```ts
orderSourceTypes: ApiOrderSourceType[];
onAddOrderSourceType: (name: string) => Promise<ApiOrderSourceType | undefined>;
onDeleteOrderSourceType: (id: number) => Promise<void>;
onGetNextOrderNumber: () => Promise<string | undefined>;
onDeleteContract: (id: string) => Promise<void>;
```

将这些 props 传给 `OrderForm` 和 `OrderDetailModal`。新建订单、编辑订单和详情弹窗的关闭逻辑不改变。

- [ ] **步骤 5：在 OrderDetailModal 显示合同**

增加 `FileText` 图标和合同附件区域：

- `order.contracts.length === 0` 时显示“暂无合同附件”；
- 逐项显示原始文件名、格式（从 MIME 或扩展名计算）、`formatFileSize(size)` 和上传时间；
- “打开/下载”使用 `<a href={contract.url} target="_blank" rel="noreferrer" download={contract.name}>`；
- 删除按钮先 `window.confirm('确定删除这份合同吗？')`，确认后调用 `onDeleteContract(contract.id)`；
- 删除按钮请求期间禁用，失败由父级 toast 提示；
- 合同区域放在产品明细后、订单备注前，不改变箱唛和状态推进按钮。

- [ ] **步骤 6：更新 App 的 OrdersPage 调用并运行类型检查**

在 `App.tsx` 的 `<OrdersPage>` 调用中传入全部新增 props。运行：

```text
npm run typecheck
```

预期：PASS。

- [ ] **步骤 7：提交前端订单增强**

```text
git add src/client/api.ts src/client/components/OrderForm.tsx src/client/App.tsx src/client/pages/OrdersPage.tsx src/client/components/OrderDetailModal.tsx
git commit -m "feat: connect order sources and contracts in client"
```

### 任务 5：补齐接口边界测试、回归验证和构建检查

**文件：**

- 修改：`tests/server/order-enhancements.test.ts`
- 修改：`tests/server/database.test.ts`
- 修改：`tests/server/backup.test.ts`
- 创建：`tests/e2e/order-enhancements.spec.ts`（使用仓库已有的 `playwright.config.ts`，由 `npm run start` 自动启动生产服务）

- [ ] **步骤 1：补齐订单创建、手动编号和重复编号测试**

使用现有 `registerOrderRoutes()` 测试方式，验证：

```ts
const automatic = await app.inject({ method: 'POST', url: '/api/orders', payload: { ...validOrder, orderNo: '' } });
expect(automatic.statusCode).toBe(201);
expect(automatic.json().data.order_no).toMatch(/^SO\d{8}001$/);

const manual = await app.inject({ method: 'POST', url: '/api/orders', payload: { ...validOrder, orderNo: '客户自定义-001' } });
expect(manual.statusCode).toBe(201);
expect(manual.json().data.order_no).toBe('客户自定义-001');

const duplicate = await app.inject({ method: 'POST', url: '/api/orders', payload: { ...validOrder, orderNo: '客户自定义-001' } });
expect(duplicate.statusCode).toBe(409);
expect(duplicate.json().error.code).toBe('ORDER_NO_EXISTS');
```

同时验证 `GET /api/orders/next-number` 不改变 `order_number_sequences.last_value`，创建两个空订单后编号递增。

- [ ] **步骤 2：补齐来源接口测试**

验证：

- `GET /api/order-source-types` 默认返回微信、1688和新增的启用项；
- 重复名称返回 409、错误码 `SOURCE_TYPE_EXISTS`；
- 未使用来源删除后不再出现在列表；
- 创建一笔使用来源“线下”的订单后删除该来源，响应 `mode = deactivated`，默认列表隐藏、`includeInactive=1` 仍返回且历史订单 `source_type` 仍为“线下”。

- [ ] **步骤 3：补齐合同接口和级联测试**

验证：

- 合同列表按 `created_at DESC, id DESC` 返回；
- 文件 URL 与静态文件真实存在；
- PDF、DOCX、XLSX、PNG 至少各成功一次；
- TXT、伪造扩展名和超过 20MB 文件被拒绝；
- 删除合同后再次删除返回 404；
- 删除订单后合同数据库行和合同物理文件一并清理。

- [ ] **步骤 4：增加可执行的浏览器冒烟流程**

在 `tests/e2e/order-enhancements.spec.ts` 使用 Playwright 验证以下操作：

1. 打开新建订单弹窗，订单号显示 `SO` 开头的自动值；
2. 手动改订单号，添加一个来源类型并选中；
3. 选择一个 PDF 合同和一个图片合同，保存订单；
4. 打开订单详情，能看到两份合同的文件名和下载链接；
5. 删除一份合同，刷新详情后只剩一份；
6. 编辑订单时仍能修改订单号，历史停用来源可以回显。

Playwright 使用仓库已有的 `playwright.config.ts` 自动启动 `npm run start`；运行结果以 `npm run test:e2e` 的实际输出为准，若服务启动失败，先运行 `npm run build` 并检查旧服务进程，再重新执行测试，不跳过该冒烟流程。

- [ ] **步骤 5：运行完整验证**

按顺序运行：

```text
npm run typecheck
npm test
npm run build
git diff --check
```

预期：TypeScript 无错误、所有 Vitest 测试通过、Vite 生产构建成功、差异检查无空白错误。

- [ ] **步骤 6：检查工作区范围并提交测试变更**

只检查本轮涉及的文件，不处理用户已有的其他未提交文件：

```text
git status --short
git diff --stat HEAD
git add tests/server/order-enhancements.test.ts tests/server/database.test.ts tests/server/backup.test.ts tests/e2e/order-enhancements.spec.ts
git commit -m "test: verify order enhancement workflows"
```

## 完成标准

执行完本计划后必须满足：

1. 新建订单默认显示并最终保存 `SOYYYYMMDD001` 格式订单号，手动修改仍可保存且不能重复；
2. 客户来源默认只有微信、1688，能在订单表单旁新增、删除或停用，历史订单来源不丢失；
3. 订单能上传多份 PDF、Word、Excel 和 PNG/JPEG/WebP 合同，并在详情中打开/下载/删除；
4. 合同文件和三张新增数据库表进入备份恢复；
5. 付款凭证、箱唛、订单状态、产品库、报价单和销售开单既有功能通过回归测试；
6. `npm run typecheck`、`npm test`、`npm run build`、`git diff --check` 全部成功。
