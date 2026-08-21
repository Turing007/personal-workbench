# 按客户分类的客户产品库实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 建立稳定的客户档案和按客户维护的产品目录，让报价单可选择部分产品同步到客户产品库，并让报价单、销售开单和订单按客户调用已完善产品及最终价格。

**架构：** 新增 `customers` 主表，将 `customer_products` 改为客户与系统产品之间的关联目录；报价、销售单和订单保存 `customerId`，同时保留客户、产品、装箱数和价格快照。报价同步由独立服务在一个外层事务中逐行使用 SQLite savepoint，单行失败只回滚该行，重复同步按系统产品或“品名 + 规格”更新最近报价，不覆盖人工维护字段。

**技术栈：** React 19、TypeScript、Fastify 5、Node SQLite、Vitest、Playwright、Vite。

**执行约束：** 不删除或重建 `C:\Users\gaofu\Documents\个人工作台\data\`，不清理当前工作区的历史未提交改动。计划中的 commit 命令仅是精确的提交边界，只有用户明确授权提交时才执行。

---

## 文件结构与职责

### 创建文件

- `src/shared/customers.ts`：客户、客户产品、完善状态、筛选条件和报价同步结果的共享类型；包含完善状态纯函数。
- `src/server/db/customer-repository.ts`：客户查询、同名检查、创建、编辑、停用、删除限制和客户统计。
- `src/server/db/customer-product-repository.ts`：按客户查询产品、系统/临时产品查重、保存人工字段、批量删除和报价同步 upsert。
- `src/server/services/customer-service.ts`：客户输入规范化、同名确认和删除/停用业务规则。
- `src/server/services/customer-product-service.ts`：客户产品输入校验、完善状态和系统产品调用逻辑。
- `src/server/services/quotation-customer-product-sync-service.ts`：报价同步预览、逐行 savepoint 同步和同步汇总。
- `src/server/routes/customers.ts`：正式客户 CRUD、同名确认、启停和删除接口。
- `src/client/components/customers/CustomerSelector.tsx`：三类单据共用的客户搜索、选择和快速新增入口。
- `src/client/components/customers/CustomerEditorModal.tsx`：新增/编辑客户资料与同名确认弹窗。
- `src/client/components/customer-products/CustomerProductEditorModal.tsx`：维护客户产品的品名、规格、SKU、装箱数和最终价格。
- `src/client/components/customer-products/CustomerProductPicker.tsx`：按客户搜索已完善/待完善产品，并支持系统产品和临时产品入口。
- `src/client/components/quotations/QuotationSyncModal.tsx`：报价产品默认全选、取消选择、同步预判和逐行结果展示。
- `tests/unit/customer-product-completeness.test.ts`：完善状态和价格字段纯函数测试。
- `tests/server/customers.test.ts`：客户 CRUD、同名确认、停用和删除限制测试。
- `tests/server/customer-products.test.ts`：按客户产品查询、查重、人工字段和删除测试。
- `tests/server/quotation-customer-product-sync.test.ts`：报价同步新增、更新、幂等、部分失败和人工字段保护测试。
- `tests/e2e/customer-product-workflow.spec.ts`：A 布局、报价同步、销售开单和订单按客户调用的浏览器验收。

### 修改文件

- `src/server/db/migrate.ts`：升级到 schema version 6；新增客户表，在不破坏 `order_items` 外键目标的前提下原位升级旧客户产品表，给三类单据及产品行增加关联和快照字段，一次性清空旧客户产品。
- `src/server/db/repositories.ts`：移除旧的全局客户产品 CRUD；订单读写增加客户快照、客户产品关联、单价和行金额。
- `src/server/db/quotation-repository.ts`：报价保存/读取 `customer_id`、同步时间、客户产品 ID 和装箱数快照。
- `src/server/db/sales-document-repository.ts`：销售单保存/读取 `customer_id`、客户产品 ID 和装箱数快照。
- `src/server/services/quotation-service.ts`：校验客户引用并保留报价客户快照。
- `src/server/services/sales-document-service.ts`：按客户产品创建销售行；从报价复制时传递客户和产品关联快照。
- `src/server/services/order-service.ts`：校验客户与客户产品归属、订单行价格和总金额。
- `src/server/routes/customer-products.ts`：改为按客户的查询、保存、系统产品调用和批量删除接口。
- `src/server/routes/quotations.ts`：解析 `customerId`，注册同步预览和执行接口。
- `src/server/routes/sales-documents.ts`：解析 `customerId` 和 `customerProductId`。
- `src/server/routes/orders.ts`：解析客户快照、客户产品 ID、单价和行金额。
- `src/server/app.ts`：实例化并注册客户、客户产品和报价同步服务。
- `src/shared/documents.ts`：报价和销售单共享类型增加客户及客户产品快照字段。
- `src/shared/domain.ts`：订单类型增加客户及价格快照字段。
- `src/client/api.ts`：正式客户、按客户产品、报价同步和三类单据的新 API 类型与请求函数。
- `src/client/documents/document-drafts.ts`：报价/销售草稿保存 `customerId`、客户产品 ID 和装箱数。
- `src/client/components/quotations/QuotationForm.tsx`：使用客户选择器和客户产品选择器。
- `src/client/components/sales/SalesDocumentForm.tsx`：使用客户选择器，按客户调用最终价格。
- `src/client/components/OrderForm.tsx`：客户与客户来源分离；按客户调用产品；自动计算行金额和总金额并允许手调。
- `src/client/pages/CustomerProductsPage.tsx`：实现左侧客户列表、右侧当前客户产品表的 A 布局。
- `src/client/pages/QuotationPage.tsx`：保存报价后打开同步弹窗并展示同步状态。
- `src/client/pages/SalesDocumentsPage.tsx`：加载客户和按客户产品，不再只调用系统产品库。
- `src/client/pages/OrdersPage.tsx`：把客户和按客户产品流程传给订单表单。
- `src/client/App.tsx`：取消启动时全量加载旧客户产品，让客户产品页和单据按客户按需加载。
- `src/client/styles/app.css`：A 布局、客户选择器、完善状态和同步弹窗的紧凑样式。
- `tests/server/database.test.ts`：schema version 6、迁移幂等、旧客户产品清空和历史单据保护。
- `tests/server/order-enhancements.test.ts`：订单客户字段、按客户产品归属、行金额和总金额。
- `tests/server/quotations.test.ts`：报价客户及产品快照。
- `tests/server/quotation-routes.test.ts`：报价 `customerId` 和同步路由。
- `tests/server/sales-documents.test.ts`：销售单按客户产品调用和报价复制。
- `tests/unit/document-drafts.test.ts`：三类文档草稿的新字段转换。
- `playwright.config.ts`：E2E 使用独立测试数据目录，避免读写正式 `data/`。

---

### 任务 1：定义客户和客户产品共享模型

**文件：**
- 创建：`src/shared/customers.ts`
- 创建：`tests/unit/customer-product-completeness.test.ts`

- [ ] **步骤 1：编写失败的完善状态测试**

```ts
import { describe, expect, it } from 'vitest';
import { getCustomerProductCompletionStatus } from '../../src/shared/customers';

describe('客户产品完善状态', () => {
  it('最终价格、SKU、装箱数全部存在时为已完善', () => {
    expect(getCustomerProductCompletionStatus({
      sku: 'ZS-001',
      packCount: 24,
      finalPriceCents: 25900,
    })).toBe('complete');
  });

  it.each([
    { sku: '', packCount: 24, finalPriceCents: 25900 },
    { sku: 'ZS-001', packCount: null, finalPriceCents: 25900 },
    { sku: 'ZS-001', packCount: 24, finalPriceCents: null },
  ])('任一人工字段缺失时为待完善', (input) => {
    expect(getCustomerProductCompletionStatus(input)).toBe('incomplete');
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm run test -- tests/unit/customer-product-completeness.test.ts`

预期：FAIL，报错无法解析 `src/shared/customers.ts`。

- [ ] **步骤 3：实现共享类型和纯函数**

在 `src/shared/customers.ts` 定义以下稳定接口；金额统一使用整数分，数据库和 API 不传浮点元：

```ts
export type CustomerProductCompletionStatus = 'incomplete' | 'complete';

export interface Customer {
  id: number;
  name: string;
  contactName: string;
  contactPhone: string;
  shippingInfo: string;
  isActive: boolean;
  productCount: number;
  incompleteProductCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSaveInput {
  name: string;
  contactName: string;
  contactPhone: string;
  shippingInfo: string;
  confirmDuplicateName?: boolean;
}

export interface CustomerProduct {
  id: number;
  customerId: number;
  systemProductId: number | null;
  name: string;
  specification: string;
  sku: string;
  packCount: number | null;
  latestQuoteCents: number | null;
  finalPriceCents: number | null;
  completionStatus: CustomerProductCompletionStatus;
  sourceQuotationId: number | null;
  imageRelativePath: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProductSaveInput {
  systemProductId?: number | null;
  name: string;
  specification: string;
  sku: string;
  packCount: number | null;
  finalPriceCents: number | null;
}

export interface CustomerProductCompletenessInput {
  sku: string;
  packCount: number | null;
  finalPriceCents: number | null;
}

export function getCustomerProductCompletionStatus(
  input: CustomerProductCompletenessInput,
): CustomerProductCompletionStatus {
  return input.sku.trim() && Number.isSafeInteger(input.packCount) && Number(input.packCount) > 0
    && Number.isSafeInteger(input.finalPriceCents) && Number(input.finalPriceCents) >= 0
    ? 'complete'
    : 'incomplete';
}
```

同文件继续定义 `CustomerProductListFilters`、`QuotationCustomerProductSyncPreview`、`QuotationCustomerProductSyncResult`；同步行的 `action` 固定为 `'create' | 'update' | 'unchanged'`，执行状态固定为 `'created' | 'updated' | 'unchanged' | 'failed'`。

- [ ] **步骤 4：运行测试和类型检查**

运行：`npm run test -- tests/unit/customer-product-completeness.test.ts && npm run typecheck`

预期：完善状态测试 PASS；现有源码尚未引用新接口，因此类型检查 PASS。

- [ ] **步骤 5：记录提交边界**

仅在用户授权提交时运行：

```powershell
git add -- src/shared/customers.ts tests/unit/customer-product-completeness.test.ts
git commit -m "feat: define customer product domain model"
```

---

### 任务 2：实现 schema version 6 幂等迁移

**文件：**
- 修改：`src/server/db/migrate.ts`
- 修改：`tests/server/database.test.ts`

- [ ] **步骤 1：先编写数据库迁移测试**

在 `tests/server/database.test.ts` 增加三个用例：

```ts
it('creates customer scoped products and document snapshot columns', () => {
  const database = new DatabaseSync(':memory:');
  migrateDatabase(database);
  expect(setting(database, 'schema_version')).toBe('6');
  expect(columns(database, 'customers')).toEqual(expect.arrayContaining([
    'id', 'name', 'contact_name', 'contact_phone', 'shipping_info', 'is_active',
  ]));
  expect(columns(database, 'customer_products')).toEqual(expect.arrayContaining([
    'customer_id', 'system_product_id', 'pack_count', 'latest_quote_cents',
    'final_price_cents', 'source_quotation_id', 'image_relative_path', 'last_synced_at',
  ]));
  expect(columns(database, 'orders')).toEqual(expect.arrayContaining(['customer_id', 'customer_name']));
  expect(columns(database, 'quotation_items')).toEqual(expect.arrayContaining(['customer_product_id', 'pack_count']));
  expect(columns(database, 'sales_document_items')).toEqual(expect.arrayContaining(['customer_product_id', 'pack_count']));
});

it('clears legacy customer products once and preserves historical order item snapshots', () => {
  const database = legacyVersionFiveDatabase();
  const customerProductId = insertLegacyCustomerProduct(database, '旧客户电钻');
  const orderId = insertLegacyOrderWithItem(database, customerProductId, '旧客户电钻');
  migrateDatabase(database);
  expect(database.prepare('SELECT COUNT(*) count FROM customer_products').get()?.count).toBe(0);
  expect(database.prepare('SELECT name, customer_product_id FROM order_items WHERE order_id = ?').get(orderId))
    .toMatchObject({ name: '旧客户电钻', customer_product_id: null });
  expect(database.prepare('SELECT COUNT(*) count FROM orders').get()?.count).toBe(1);
});

it('runs version six migration repeatedly without clearing new customer products', () => {
  const database = new DatabaseSync(':memory:');
  migrateDatabase(database);
  const customerId = insertCustomer(database, '张三');
  insertCustomerProduct(database, customerId, '电钻', '20V');
  migrateDatabase(database);
  expect(database.prepare('SELECT COUNT(*) count FROM customer_products').get()?.count).toBe(1);
});
```

- [ ] **步骤 2：运行迁移测试确认失败**

运行：`npm run test -- tests/server/database.test.ts`

预期：FAIL，当前 schema version 是 `5`，且不存在 `customers` 和新快照列。

- [ ] **步骤 3：增加新安装使用的 version 6 schema**

在 `schemaSql` 中把新安装数据库的 `customer_products` 定义替换为客户归属结构，并新增：

```sql
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  shipping_info TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  system_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  specification TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  pack_count INTEGER CHECK (pack_count IS NULL OR pack_count > 0),
  latest_quote_cents INTEGER CHECK (latest_quote_cents IS NULL OR latest_quote_cents >= 0),
  final_price_cents INTEGER CHECK (final_price_cents IS NULL OR final_price_cents >= 0),
  source_quotation_id INTEGER REFERENCES quotations(id) ON DELETE SET NULL,
  image_relative_path TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

两个客户产品部分唯一索引不要直接放进最初执行的 `schemaSql`，因为 version 5 数据库中的同名旧表还没有 `customer_id`，提前创建索引会让升级在加列前失败。将以下普通索引和唯一索引放入 version 6 升级步骤，并在所有新列存在后执行：

```sql
CREATE INDEX IF NOT EXISTS idx_customers_active_name ON customers(is_active, name, id);
CREATE INDEX IF NOT EXISTS idx_customer_products_customer_updated ON customer_products(customer_id, updated_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_products_system
  ON customer_products(customer_id, system_product_id)
  WHERE system_product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_products_temporary
  ON customer_products(customer_id, lower(trim(name)), lower(trim(specification)))
  WHERE system_product_id IS NULL;
```

三类单据增加 `customer_id`；报价增加 `customer_products_synced_at`；报价行和销售行增加 `customer_product_id`、`pack_count`；订单增加客户快照列，订单行增加 `unit_price_cents` 和 `amount_cents`。所有新外键使用 `ON DELETE SET NULL`，所有历史快照文本保留。

- [ ] **步骤 4：实现旧数据库的精确升级顺序**

在 `migrateDatabase()` 事务中读取 `settings.schema_version`。版本低于 6 时采用原位加列，不重命名 `customer_products`，从而避免 SQLite 把 `order_items.customer_product_id` 的外键目标改写成旧表名。按以下顺序执行：

1. 创建 `customers`。
2. 使用 `PRAGMA table_info(customer_products)` 给旧表原位增加 `customer_id`、`system_product_id`、`pack_count`、`latest_quote_cents`、`final_price_cents`、`source_quotation_id`、`image_relative_path`、`last_synced_at`。旧表已有的 `packaging_json` 和 `remark` 暂时保留为兼容列，新仓储不再读写它们。
3. 执行 `UPDATE order_items SET customer_product_id = NULL`，先解除历史订单行对旧客户产品的引用；随后执行 `DELETE FROM customer_products`，只清空旧客户产品。
4. 为迁移数据库创建 `customer_products_require_customer_insert` 和 `customer_products_require_customer_update` 两个触发器。当新写入或修改记录的 `customer_id IS NULL` 时使用 `RAISE(ABORT, 'customer_products.customer_id is required')` 拒绝操作。新安装数据库同时由列的 `NOT NULL` 约束保护；迁移数据库由触发器提供等价约束。
5. 使用现有 `PRAGMA table_info` 辅助函数给 `orders`、`order_items`、`quotations`、`quotation_items`、`sales_documents`、`sales_document_items` 添加缺失列。
6. 删除旧的 `idx_customer_products_name_sku_spec`，再创建 version 6 普通索引和两个部分唯一索引。
7. 写入 `customer_products_v6_initialized = '1'` 和 `schema_version = '6'`。

辅助函数使用固定表名白名单，不拼接用户输入：

```ts
function addColumnIfMissing(
  database: DatabaseSync,
  table: 'orders' | 'order_items' | 'quotations' | 'quotation_items' | 'sales_documents' | 'sales_document_items',
  column: string,
  definition: string,
): void {
  const names = database.prepare(`PRAGMA table_info(${table})`).all()
    .map((row: { name?: unknown }) => String(row.name));
  if (!names.includes(column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
```

升级逻辑只在 version 6 标记不存在时解除旧关联并清理旧客户产品。触发器使用 `CREATE TRIGGER IF NOT EXISTS`，索引使用 `CREATE INDEX IF NOT EXISTS`；重复迁移不再次清空客户产品。迁移完成后执行 `PRAGMA foreign_key_check` 并要求结果为空。不要删除订单、报价、销售单、附件、箱唛、打印历史或 `data/` 文件。

- [ ] **步骤 5：运行迁移测试两次并检查事务回滚**

运行：`npm run test -- tests/server/database.test.ts`

预期：新安装、version 5 升级、重复迁移和原有“强制迁移失败时回滚”测试全部 PASS。

- [ ] **步骤 6：记录提交边界**

```powershell
git add -- src/server/db/migrate.ts tests/server/database.test.ts
git commit -m "feat: migrate customer scoped product schema"
```

---

### 任务 3：实现正式客户档案和生命周期 API

**文件：**
- 创建：`src/server/db/customer-repository.ts`
- 创建：`src/server/services/customer-service.ts`
- 创建：`src/server/routes/customers.ts`
- 修改：`src/server/app.ts`
- 创建：`tests/server/customers.test.ts`

- [ ] **步骤 1：编写失败的客户接口测试**

```ts
it('creates, searches and edits a customer', async () => {
  const app = await testApp();
  const created = await app.inject({ method: 'POST', url: '/api/customers', payload: {
    name: '张三', contactName: '张先生', contactPhone: '13800000000',
    shippingInfo: '张三 13800000000 浙江省宁波市',
  }});
  expect(created.statusCode).toBe(201);
  expect(created.json().data).toMatchObject({ name: '张三', isActive: true });
  const listed = await app.inject({ method: 'GET', url: '/api/customers?q=1380000' });
  expect(listed.json().data.items).toHaveLength(1);
  const updated = await app.inject({ method: 'PUT', url: `/api/customers/${created.json().data.id}`, payload: {
    name: '张三', contactName: '张经理', contactPhone: '13800000000', shippingInfo: '新地址',
  }});
  expect(updated.json().data.contactName).toBe('张经理');
});

it('requires explicit confirmation for a duplicate name', async () => {
  const app = await testAppWithCustomer('张三');
  const blocked = await app.inject({ method: 'POST', url: '/api/customers', payload: customerInput(' 张三 ') });
  expect(blocked.statusCode).toBe(409);
  expect(blocked.json().error.code).toBe('CUSTOMER_NAME_EXISTS');
  const confirmed = await app.inject({ method: 'POST', url: '/api/customers', payload: {
    ...customerInput('张三'), confirmDuplicateName: true,
  }});
  expect(confirmed.statusCode).toBe(201);
});

it('deletes an unused customer and deactivates a referenced customer', async () => {
  const { app, database } = await testContext();
  const unused = await createCustomer(app, '临时客户');
  expect((await app.inject({ method: 'DELETE', url: `/api/customers/${unused.id}` })).json().data.mode).toBe('deleted');
  const referenced = await createCustomer(app, '张三');
  insertQuotationForCustomer(database, referenced.id);
  const response = await app.inject({ method: 'DELETE', url: `/api/customers/${referenced.id}` });
  expect(response.json().data).toMatchObject({ mode: 'deactivated', isActive: false });
});
```

- [ ] **步骤 2：运行客户测试确认失败**

运行：`npm run test -- tests/server/customers.test.ts`

预期：FAIL，`/api/customers` 返回 404。

- [ ] **步骤 3：实现客户仓储**

`CustomerRepository` 暴露以下完整边界：

```ts
export class CustomerRepository {
  constructor(private readonly database: DatabaseSync) {}
  list(filters: { query?: string; includeInactive?: boolean }): Customer[];
  getById(id: number): Customer | undefined;
  findByNormalizedName(name: string, excludeId?: number): Customer[];
  create(input: CustomerSaveInput): Customer;
  update(id: number, input: CustomerSaveInput): Customer | undefined;
  setActive(id: number, isActive: boolean): Customer | undefined;
  hasReferences(id: number): boolean;
  delete(id: number): boolean;
}
```

`list()` 使用聚合子查询返回 `productCount` 和 `incompleteProductCount`。排序固定为：启用客户在前、待完善数量降序、更新时间降序。搜索覆盖名称、联系人和电话，并对 `%`、`_` 使用参数绑定而不是字符串拼接。

- [ ] **步骤 4：实现客户服务和路由**

`CustomerService.create()` 在未传 `confirmDuplicateName` 且同名时抛出：

```ts
throw new ApiError(409, 'CUSTOMER_NAME_EXISTS', '已存在同名客户，请确认后继续创建', 'name');
```

前端收到该错误后调用 `getCustomers(input.name, true)`，按名称规范化后筛出同名项，展示 ID、联系人和联系电话摘要；因此不修改当前 `ApiError` 响应结构。

注册接口：

```text
GET    /api/customers?q=&includeInactive=0
GET    /api/customers/:id
POST   /api/customers
PUT    /api/customers/:id
PATCH  /api/customers/:id/status       { isActive: boolean }
DELETE /api/customers/:id
```

删除有引用的客户返回 200 和 `{ mode: 'deactivated', customer }`；无引用客户返回 `{ mode: 'deleted', id }`。停用客户仍可通过 `includeInactive=1` 查询。

- [ ] **步骤 5：运行客户测试和应用类型检查**

运行：`npm run test -- tests/server/customers.test.ts && npm run typecheck`

预期：客户接口测试全部 PASS，`src/server/app.ts` 的服务注册类型正确。

- [ ] **步骤 6：记录提交边界**

```powershell
git add -- src/server/db/customer-repository.ts src/server/services/customer-service.ts src/server/routes/customers.ts src/server/app.ts tests/server/customers.test.ts
git commit -m "feat: add customer records and lifecycle api"
```

---

### 任务 4：实现按客户维护的产品仓储和 API

**文件：**
- 创建：`src/server/db/customer-product-repository.ts`
- 创建：`src/server/services/customer-product-service.ts`
- 修改：`src/server/routes/customer-products.ts`
- 修改：`src/server/app.ts`
- 创建：`tests/server/customer-products.test.ts`
- 修改：`tests/server/order-enhancements.test.ts`

- [ ] **步骤 1：编写失败的客户产品测试**

```ts
it('lists only the selected customer products and filters completion status', async () => {
  const { app } = await testContext();
  const zhang = await createCustomer(app, '张三');
  const li = await createCustomer(app, '李四');
  await createCustomerProduct(app, zhang.id, { name: '电钻', specification: '20V', sku: '', packCount: null, finalPriceCents: null });
  await createCustomerProduct(app, zhang.id, { name: '角磨机', specification: '100mm', sku: 'ZS-002', packCount: 12, finalPriceCents: 19900 });
  await createCustomerProduct(app, li.id, { name: '电钻', specification: '20V', sku: 'LS-001', packCount: 24, finalPriceCents: 25900 });
  const response = await app.inject({ method: 'GET', url: `/api/customers/${zhang.id}/products?status=incomplete` });
  expect(response.json().data.items).toEqual([expect.objectContaining({ name: '电钻', completionStatus: 'incomplete' })]);
});

it('keeps different specifications separate and rejects a duplicate temporary key', async () => {
  const { app } = await testContext();
  const customer = await createCustomer(app, '张三');
  expect((await createCustomerProductResponse(app, customer.id, productInput('电钻', '12V'))).statusCode).toBe(201);
  expect((await createCustomerProductResponse(app, customer.id, productInput('电钻', '20V'))).statusCode).toBe(201);
  const duplicate = await createCustomerProductResponse(app, customer.id, productInput(' 电钻 ', ' 20V '));
  expect(duplicate.statusCode).toBe(409);
  expect(duplicate.json().error.code).toBe('CUSTOMER_PRODUCT_EXISTS');
});

it('imports one system product once per customer and keeps customer fields editable', async () => {
  const { app } = await testContext();
  const customer = await createCustomer(app, '张三');
  const systemProduct = await createSystemProduct(app, '无刷电钻', '20V');
  const first = await app.inject({ method: 'POST', url: `/api/customers/${customer.id}/products/from-library`, payload: { systemProductId: systemProduct.id } });
  const second = await app.inject({ method: 'POST', url: `/api/customers/${customer.id}/products/from-library`, payload: { systemProductId: systemProduct.id } });
  expect(first.statusCode).toBe(201);
  expect(second.statusCode).toBe(409);
  const edited = await app.inject({ method: 'PUT', url: `/api/customer-products/${first.json().data.id}`, payload: {
    name: '张三专用电钻', specification: '20V', sku: 'ZS-001', packCount: 24, finalPriceCents: 25900,
  }});
  expect(edited.json().data.completionStatus).toBe('complete');
});
```

- [ ] **步骤 2：运行测试确认旧全局 API 不满足需求**

运行：`npm run test -- tests/server/customer-products.test.ts tests/server/order-enhancements.test.ts`

预期：新测试 FAIL；旧四字段测试因缺少 `customerId` 需要在本任务改写。

- [ ] **步骤 3：实现客户产品仓储和重复键**

`CustomerProductRepository` 暴露：

```ts
export class CustomerProductRepository {
  constructor(private readonly database: DatabaseSync) {}
  list(customerId: number, filters: CustomerProductListFilters): CustomerProduct[];
  getById(id: number): CustomerProduct | undefined;
  findBySystemProduct(customerId: number, systemProductId: number): CustomerProduct | undefined;
  findTemporary(customerId: number, name: string, specification: string): CustomerProduct | undefined;
  create(customerId: number, input: CustomerProductSaveInput): CustomerProduct;
  update(id: number, input: CustomerProductSaveInput): CustomerProduct | undefined;
  createFromSystemProduct(customerId: number, systemProductId: number): CustomerProduct;
  delete(id: number): boolean;
  deleteMany(customerId: number, ids: number[]): number;
}
```

`list()` 通过 `LEFT JOIN products` 和系统产品第一张图片返回图片；客户产品已有 `image_relative_path` 时优先使用快照。完成状态不存冗余列，查询后统一调用 `getCustomerProductCompletionStatus()`。

- [ ] **步骤 4：实现服务校验和路由**

输入规则固定为：品名必填；规格可空；SKU 可空；装箱数可空但有值时为正整数；最终价格可空但有值时为非负整数分；客户必须存在。停用客户允许维护历史产品，但不能通过三类新单据选择。

注册接口：

```text
GET    /api/customers/:customerId/products?q=&status=all|incomplete|complete
POST   /api/customers/:customerId/products
POST   /api/customers/:customerId/products/from-library   { systemProductId }
GET    /api/customer-products/:id
PUT    /api/customer-products/:id
DELETE /api/customer-products/:id
POST   /api/customers/:customerId/products/batch-delete   { ids: number[] }
```

批量删除先验证所有 ID 都属于路径中的客户，防止跨客户删除。单条和批量删除均只删除客户目录记录，不删除系统产品和历史单据快照。

- [ ] **步骤 5：更新旧客户产品测试并运行回归**

把 `tests/server/order-enhancements.test.ts` 的旧全局四字段用例改为先创建客户，再调用 `/api/customers/:customerId/products`。运行：

`npm run test -- tests/server/customer-products.test.ts tests/server/order-enhancements.test.ts`

预期：按客户隔离、查重、完善状态、系统产品调用和原订单增强测试全部 PASS。

- [ ] **步骤 6：记录提交边界**

```powershell
git add -- src/server/db/customer-product-repository.ts src/server/services/customer-product-service.ts src/server/routes/customer-products.ts src/server/app.ts tests/server/customer-products.test.ts tests/server/order-enhancements.test.ts
git commit -m "feat: scope customer products by customer"
```

---

### 任务 5：让报价、销售单和订单保存客户及产品快照

**文件：**
- 修改：`src/shared/documents.ts`
- 修改：`src/shared/domain.ts`
- 修改：`src/server/db/quotation-repository.ts`
- 修改：`src/server/db/sales-document-repository.ts`
- 修改：`src/server/db/repositories.ts`
- 修改：`src/server/services/quotation-service.ts`
- 修改：`src/server/services/sales-document-service.ts`
- 修改：`src/server/services/order-service.ts`
- 修改：`src/server/routes/quotations.ts`
- 修改：`src/server/routes/sales-documents.ts`
- 修改：`src/server/routes/orders.ts`
- 修改：`tests/server/quotations.test.ts`
- 修改：`tests/server/sales-documents.test.ts`
- 修改：`tests/server/order-enhancements.test.ts`

- [ ] **步骤 1：先增加三类单据快照测试**

报价测试断言：

```ts
expect(saved).toMatchObject({ customerId: customer.id, customerName: '张三' });
expect(saved.items[0]).toMatchObject({
  customerProductId: customerProduct.id,
  sku: 'ZS-001',
  packCount: 24,
  unitPriceCents: 25900,
});
```

销售单测试断言同样保存 `customerId`、`customerProductId` 和 `packCount`。订单测试断言：

```ts
expect(order).toMatchObject({
  customer_id: customer.id,
  customer_name: '张三',
  customer_contact_name: '张先生',
  customer_contact_phone: '13800000000',
  customer_shipping_info: '张三 13800000000 浙江省宁波市',
  amount_cents: 51800,
});
expect(order.items[0]).toMatchObject({
  customer_product_id: customerProduct.id,
  unit_price_cents: 25900,
  amount_cents: 51800,
});
```

再修改客户产品后重新读取三类单据，断言旧单据仍显示原 SKU、装箱数和单价。

- [ ] **步骤 2：运行测试确认新字段缺失**

运行：`npm run test -- tests/server/quotations.test.ts tests/server/sales-documents.test.ts tests/server/order-enhancements.test.ts`

预期：FAIL，当前仓储不读写 `customerId`、`customerProductId` 和订单行价格。

- [ ] **步骤 3：扩展共享类型**

报价和销售输入增加：

```ts
customerId: number | null;
```

两类产品行增加：

```ts
customerProductId: number | null;
packCount: number | null;
```

订单输入增加：

```ts
customerId?: number | null;
customerName?: string;
customerContactName?: string;
customerContactPhone?: string;
customerShippingInfo?: string;
amountCents?: number;
```

订单行增加 `unitPriceCents` 和 `amountCents`。API 继续返回旧 `amount` 元字段以兼容列表，但数据库以 `amount_cents` 为权威；迁移后的旧订单首次读取时使用 `Math.round(amount * 100)` 回退。

- [ ] **步骤 4：更新三个仓储的 SQL 映射**

报价和销售的 INSERT、UPDATE、SELECT 明确加入 `customer_id`、`customer_product_id` 和 `pack_count`。订单 INSERT/UPDATE 加入客户快照和 `amount_cents`；`order_items` 加入单价与行金额。任何客户或客户产品删除只会把外键设为 NULL，快照列不改。

SQL 行映射统一使用以下规则：

```ts
customerId: row.customer_id == null ? null : Number(row.customer_id),
customerProductId: row.customer_product_id == null ? null : Number(row.customer_product_id),
packCount: row.pack_count == null ? null : Number(row.pack_count),
```

- [ ] **步骤 5：在服务层校验归属但允许缺失快照**

当 `customerId` 和 `customerProductId` 都存在时，服务必须确认客户产品属于该客户；不匹配时返回 `CUSTOMER_PRODUCT_CUSTOMER_MISMATCH`。历史单据或临时产品允许 ID 为空，只要快照品名有效。最终价格、SKU、装箱数缺失时返回 warnings 数组，不阻止保存。

订单服务重新计算每一行 `quantity * unitPriceCents`；客户端传入 `amountCents` 与计算值不一致时以服务端计算值保存。订单总金额允许人工调整，因此只校验 `amountCents >= 0`，不强制等于行金额之和。

- [ ] **步骤 6：运行三类单据回归测试**

运行：`npm run test -- tests/server/quotations.test.ts tests/server/sales-documents.test.ts tests/server/order-enhancements.test.ts`

预期：新快照测试和原有文档金额、附件、合同、订单号、状态测试全部 PASS。

- [ ] **步骤 7：记录提交边界**

```powershell
git add -- src/shared/documents.ts src/shared/domain.ts src/server/db/quotation-repository.ts src/server/db/sales-document-repository.ts src/server/db/repositories.ts src/server/services/quotation-service.ts src/server/services/sales-document-service.ts src/server/services/order-service.ts src/server/routes/quotations.ts src/server/routes/sales-documents.ts src/server/routes/orders.ts tests/server/quotations.test.ts tests/server/sales-documents.test.ts tests/server/order-enhancements.test.ts
git commit -m "feat: persist customer and product snapshots on documents"
```

---

### 任务 6：实现报价同步预览和逐行同步

**文件：**
- 创建：`src/server/services/quotation-customer-product-sync-service.ts`
- 修改：`src/server/db/customer-product-repository.ts`
- 修改：`src/server/db/quotation-repository.ts`
- 修改：`src/server/routes/quotations.ts`
- 修改：`src/server/app.ts`
- 创建：`tests/server/quotation-customer-product-sync.test.ts`
- 修改：`tests/server/quotation-routes.test.ts`

- [ ] **步骤 1：编写失败的同步行为测试**

```ts
it('previews all quotation lines and syncs only selected item ids', async () => {
  const { app } = await testContext();
  const quotation = await createQuotationWithCustomerAndTwoItems(app);
  const preview = await app.inject({ method: 'GET', url: `/api/quotations/${quotation.id}/customer-product-sync-preview` });
  expect(preview.json().data.items).toHaveLength(2);
  expect(preview.json().data.items.every((item: { selected: boolean }) => item.selected)).toBe(true);
  const selectedId = preview.json().data.items[0].quotationItemId;
  const synced = await app.inject({ method: 'POST', url: `/api/quotations/${quotation.id}/sync-customer-products`, payload: { itemIds: [selectedId] } });
  expect(synced.json().data.summary).toMatchObject({ created: 1, failed: 0 });
  const products = await listCustomerProducts(app, quotation.customerId);
  expect(products).toHaveLength(1);
});

it('updates only the latest quote and preserves manually maintained fields', async () => {
  const { app } = await testContext();
  const quotation = await createQuotationWithCustomer(app, { unitPriceCents: 19900 });
  const first = await syncAll(app, quotation.id);
  await completeCustomerProduct(app, first.items[0].customerProductId, {
    sku: 'ZS-001', packCount: 24, finalPriceCents: 18900,
  });
  await updateQuotationPrice(app, quotation.id, 20900);
  const second = await syncAll(app, quotation.id);
  expect(second.summary.created).toBe(0);
  expect(second.summary.updated).toBe(1);
  const product = await getCustomerProduct(app, first.items[0].customerProductId);
  expect(product).toMatchObject({ latestQuoteCents: 20900, finalPriceCents: 18900, sku: 'ZS-001', packCount: 24 });
});

it('uses system id or normalized temporary name and specification as idempotency keys', async () => {
  const { app } = await testContext();
  const customer = await createCustomer(app, '张三');
  const quotationA = await createMixedQuotation(app, customer.id, '20V');
  const quotationB = await createMixedQuotation(app, customer.id, '12V');
  await syncAll(app, quotationA.id);
  await syncAll(app, quotationA.id);
  await syncAll(app, quotationB.id);
  const products = await listCustomerProducts(app, customer.id);
  expect(products.filter((item) => item.systemProductId != null)).toHaveLength(1);
  expect(products.filter((item) => item.systemProductId == null)).toHaveLength(2);
});
```

另加部分失败测试：创建两行报价后直接把第二行 `name` 更新为空字符串；同步结果应为一行成功、一行 `failed`，数据库保留成功行。

- [ ] **步骤 2：运行同步测试确认接口不存在**

运行：`npm run test -- tests/server/quotation-customer-product-sync.test.ts tests/server/quotation-routes.test.ts`

预期：同步预览和执行接口返回 404。

- [ ] **步骤 3：实现预览算法**

`preview(quotationId)` 必须：

1. 读取报价及产品行；报价不存在返回 404。
2. `customerId` 为空返回 409 `QUOTATION_CUSTOMER_REQUIRED`。
3. 对有关联系统产品的行按 `customerId + productId` 查询；临时行按规范化品名和规格查询。
4. 比较 `latestQuoteCents`，返回 `create`、`update` 或 `unchanged`。
5. 每行返回 `quotationItemId`、图片、品名、规格、本次报价、当前客户产品 ID 和 `selected: true`。

- [ ] **步骤 4：实现外层事务和逐行 savepoint**

核心结构固定为：

```ts
this.database.exec('BEGIN IMMEDIATE');
try {
  for (const item of selectedItems) {
    this.database.exec('SAVEPOINT quotation_sync_item');
    try {
      const result = this.syncOne(quotation, item, syncedAt);
      rows.push(result);
      this.database.exec('RELEASE SAVEPOINT quotation_sync_item');
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT quotation_sync_item');
      this.database.exec('RELEASE SAVEPOINT quotation_sync_item');
      rows.push(failedResult(item, error));
    }
  }
  this.quotationRepository.setCustomerProductsSyncedAt(quotation.id, syncedAt);
  this.database.exec('COMMIT');
} catch (error) {
  this.database.exec('ROLLBACK');
  throw error;
}
```

新记录写入 `latest_quote_cents`、来源报价 ID、图片快照和同步时间；SKU 只在新记录时使用报价行 SKU 初始化，装箱数只使用报价行已经保存的 `packCount`，最终价格始终为 NULL。已有记录只更新最近报价、来源、图片和同步时间，不修改 `name`、`specification`、`sku`、`pack_count`、`final_price_cents`。

- [ ] **步骤 5：注册同步路由和汇总结果**

```text
GET  /api/quotations/:id/customer-product-sync-preview
POST /api/quotations/:id/sync-customer-products   { itemIds: number[] }
```

POST 拒绝空数组、重复 ID、非本报价行 ID。响应 summary 固定含 `created`、`updated`、`unchanged`、`failed`，并返回逐行结果。至少一行失败时仍返回 200，因为成功行已提交，UI 根据 `failed` 数量显示警告。

- [ ] **步骤 6：运行同步、报价路由和迁移测试**

运行：`npm run test -- tests/server/quotation-customer-product-sync.test.ts tests/server/quotation-routes.test.ts tests/server/database.test.ts`

预期：首次同步、取消部分、重复同步、人工字段保护、不同规格、部分失败和路由回归全部 PASS。

- [ ] **步骤 7：记录提交边界**

```powershell
git add -- src/server/services/quotation-customer-product-sync-service.ts src/server/db/customer-product-repository.ts src/server/db/quotation-repository.ts src/server/routes/quotations.ts src/server/app.ts tests/server/quotation-customer-product-sync.test.ts tests/server/quotation-routes.test.ts
git commit -m "feat: sync quotation items to customer products"
```

---

### 任务 7：实现前端客户 API、客户选择器和快速新增

**文件：**
- 修改：`src/client/api.ts`
- 创建：`src/client/components/customers/CustomerSelector.tsx`
- 创建：`src/client/components/customers/CustomerEditorModal.tsx`
- 修改：`src/client/styles/app.css`

- [ ] **步骤 1：在 API 层定义正式请求函数**

从 `src/shared/customers.ts` 导入共享类型，并新增：

```ts
export const getCustomers = (q = '', includeInactive = false) =>
  request<{ items: Customer[] }>(`/api/customers?q=${encodeURIComponent(q)}&includeInactive=${includeInactive ? '1' : '0'}`);
export const createCustomer = (input: CustomerSaveInput) =>
  request<Customer>('/api/customers', { method: 'POST', body: JSON.stringify(input) });
export const updateCustomer = (id: number, input: CustomerSaveInput) =>
  request<Customer>(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(input) });
export const setCustomerActive = (id: number, isActive: boolean) =>
  request<Customer>(`/api/customers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
export const deleteCustomerRecord = (id: number) =>
  request<{ mode: 'deleted' | 'deactivated'; customer?: Customer; id?: number }>(`/api/customers/${id}`, { method: 'DELETE' });
```

客户产品函数必须接收 `customerId`；删除旧的 `getDocumentCustomerSuggestions()` 调用点，但服务端旧路由可保留一个版本作为兼容层，直到本任务全部表单切换完成。

- [ ] **步骤 2：实现客户编辑弹窗**

弹窗字段固定为客户名称、联系人、联系电话、常用收件信息。首次收到 `CUSTOMER_NAME_EXISTS` 时不关闭弹窗，调用 `getCustomers(draft.name, true)` 取得同名客户，显示其 ID、联系人和联系电话摘要及“仍然创建”按钮；再次提交添加 `confirmDuplicateName: true`。保存失败保留所有输入。

- [ ] **步骤 3：实现可复用客户选择器**

组件 props 固定为：

```ts
interface CustomerSelectorProps {
  customerId: number | null;
  snapshot: { customerName: string; contactName: string; contactPhone: string; shippingInfo: string };
  onSelect: (customer: Customer) => void;
  onSnapshotChange: (snapshot: CustomerSelectorProps['snapshot']) => void;
  disabled?: boolean;
}
```

输入 200ms 防抖调用 `getCustomers()`；只显示启用客户。选择后把客户资料复制到当前单据 snapshot，随后用户编辑 snapshot 不调用客户更新 API。右侧 `Plus` 图标打开快速新增弹窗，新增成功后自动选中。

- [ ] **步骤 4：增加紧凑交互样式并运行类型检查**

样式使用现有颜色变量、5px 圆角和 32px 控件高度；搜索结果列表设置稳定最大高度，不嵌套卡片。运行：

`npm run typecheck`

预期：新组件和 API 无 TypeScript 错误；尚未替换的旧表单仍能编译。

- [ ] **步骤 5：记录提交边界**

```powershell
git add -- src/client/api.ts src/client/components/customers/CustomerSelector.tsx src/client/components/customers/CustomerEditorModal.tsx src/client/styles/app.css
git commit -m "feat: add reusable customer selector"
```

---

### 任务 8：实现客户产品库 A 布局

**文件：**
- 修改：`src/client/pages/CustomerProductsPage.tsx`
- 创建：`src/client/components/customer-products/CustomerProductEditorModal.tsx`
- 修改：`src/client/components/CustomerProductEditor.tsx`
- 修改：`src/client/styles/app.css`
- 修改：`src/client/api.ts`

- [ ] **步骤 1：补全客户产品 API 函数**

```ts
export const getCustomerProducts = (customerId: number, filters: { q?: string; status?: 'all' | 'incomplete' | 'complete' } = {}) => {
  const params = new URLSearchParams({ q: filters.q ?? '', status: filters.status ?? 'all' });
  return request<{ items: CustomerProduct[] }>(`/api/customers/${customerId}/products?${params}`);
};
export const saveCustomerProduct = (customerId: number, input: CustomerProductSaveInput) =>
  request<CustomerProduct>(`/api/customers/${customerId}/products`, { method: 'POST', body: JSON.stringify(input) });
export const importCustomerProduct = (customerId: number, systemProductId: number) =>
  request<CustomerProduct>(`/api/customers/${customerId}/products/from-library`, { method: 'POST', body: JSON.stringify({ systemProductId }) });
```

编辑、删除和批量删除函数按任务 4 的接口实现。

- [ ] **步骤 2：实现客户产品编辑弹窗**

字段顺序固定为品名、规格、客户 SKU、装箱数、最终价格；最近报价只读显示。最终价格输入以元显示，提交使用现有 `money.ts` 转整数分。清空 SKU、装箱数或最终价格后允许保存，状态立即变为待完善。

- [ ] **步骤 3：改造页面为左右 A 布局**

左侧宽度使用 `clamp(220px, 24vw, 300px)`，包含客户搜索、新增按钮、产品总数和待完善数量。默认选中排序后的第一个启用客户；URL 可使用 `?customerId=123&status=incomplete` 保存报价同步后的跳转状态。

右侧表格列固定为：状态、图片、品名、规格、SKU、装箱数、最近报价、最终价格、来源、更新时间、操作。顶部提供全部/待完善/已完善分段按钮、搜索、从系统产品库调用、新增临时产品、批量删除。没有选择客户时显示一个简短空状态，不发客户产品请求。

- [ ] **步骤 4：实现客户管理和删除规则的前端反馈**

客户编辑在紧凑弹窗完成。删除接口返回 `deactivated` 时提示“客户已有产品或历史单据，已改为停用”；停用客户仍可通过“包含停用客户”开关查看，但右侧不提供新增产品入口。

- [ ] **步骤 5：移除旧四字段全局编辑器调用并通过构建**

旧 `src/client/components/CustomerProductEditor.tsx` 不再由页面或订单表单直接调用；确认无引用后删除其导出内容或将其改为重新导出新弹窗，避免两套客户产品模型并存。

运行：`npm run typecheck && npm run build`

预期：客户产品页面 A 布局可编译，系统产品页面和订单页面不受未完成的后续接线影响。

- [ ] **步骤 6：记录提交边界**

```powershell
git add -- src/client/pages/CustomerProductsPage.tsx src/client/components/customer-products/CustomerProductEditorModal.tsx src/client/components/CustomerProductEditor.tsx src/client/styles/app.css src/client/api.ts
git commit -m "feat: build customer scoped product workspace"
```

---

### 任务 9：报价单按客户选品并提供同步弹窗

**文件：**
- 创建：`src/client/components/customer-products/CustomerProductPicker.tsx`
- 创建：`src/client/components/quotations/QuotationSyncModal.tsx`
- 修改：`src/client/components/quotations/QuotationForm.tsx`
- 修改：`src/client/pages/QuotationPage.tsx`
- 修改：`src/client/documents/document-drafts.ts`
- 修改：`src/client/api.ts`
- 修改：`tests/unit/document-drafts.test.ts`

- [ ] **步骤 1：先扩展文档草稿转换测试**

```ts
it('round trips quotation customer and customer product snapshots', () => {
  const detail = quotationDetail({
    customerId: 12,
    items: [quotationItem({ customerProductId: 34, packCount: 24 })],
  });
  const draft = quotationDetailToDraft(detail);
  expect(draft.customerId).toBe(12);
  expect(draft.items[0]).toMatchObject({ customerProductId: 34, packCount: '24' });
  const payload = quotationDraftToPayload(draft);
  expect(payload).toMatchObject({ customerId: 12 });
  expect(payload.items[0]).toMatchObject({ customerProductId: 34, packCount: 24 });
});
```

- [ ] **步骤 2：运行草稿测试确认失败**

运行：`npm run test -- tests/unit/document-drafts.test.ts`

预期：FAIL，草稿目前没有客户产品关联字段。

- [ ] **步骤 3：扩展报价草稿并替换客户建议输入**

`QuotationDraft` 增加 `customerId: number | null`；产品行增加 `customerProductId` 和 `packCount`。用 `CustomerSelector` 替换 `CustomerSuggestionInput`，选择客户后复制名称、联系人、电话和地址快照。客户切换时不自动删除已经添加的行，但把不属于新客户的 `customerProductId` 清空并显示一次提示，防止错误关联。

- [ ] **步骤 4：实现统一客户产品选择器**

选择器默认请求 `status=complete`，可切换待完善。选择已完善产品时带入品名、规格、SKU、装箱数和最终价格；待完善产品最终价格为空时单价留空并显示警告。提供“系统产品库”和“临时产品”两个入口，沿用现有 `LibraryProductPicker` 和 `TemporaryProductEditor`，保存报价行时保留快照。

- [ ] **步骤 5：实现报价同步弹窗**

打开时请求 preview，所有行默认勾选；表头复选框支持全选/取消全选。确认按钮只提交已勾选的 `quotationItemId`。同步完成后展示新增、更新、无变化、失败数量和逐行错误；提供“进入客户产品库并筛选待完善”按钮，跳转参数为 `customerId` 和 `status=incomplete`。

报价未保存时不显示同步按钮；已保存但没有 `customerId` 时按钮点击提示先选择客户。报价详情显示最近同步时间。

- [ ] **步骤 6：运行草稿测试、类型检查和报价回归**

运行：`npm run test -- tests/unit/document-drafts.test.ts tests/server/quotation-routes.test.ts && npm run typecheck && npm run build`

预期：草稿转换、报价 CRUD 和同步 API 测试 PASS，报价页面构建成功。

- [ ] **步骤 7：记录提交边界**

```powershell
git add -- src/client/components/customer-products/CustomerProductPicker.tsx src/client/components/quotations/QuotationSyncModal.tsx src/client/components/quotations/QuotationForm.tsx src/client/pages/QuotationPage.tsx src/client/documents/document-drafts.ts src/client/api.ts tests/unit/document-drafts.test.ts
git commit -m "feat: connect quotations to customer products"
```

---

### 任务 10：销售开单按客户调用产品

**文件：**
- 修改：`src/client/components/sales/SalesDocumentForm.tsx`
- 修改：`src/client/pages/SalesDocumentsPage.tsx`
- 修改：`src/client/documents/document-drafts.ts`
- 修改：`src/server/services/sales-document-service.ts`
- 修改：`tests/unit/document-drafts.test.ts`
- 修改：`tests/server/sales-documents.test.ts`

- [ ] **步骤 1：增加销售单客户产品和报价复制测试**

```ts
it('copies quotation customer and customer product snapshots into sales', async () => {
  const quotation = await saveWonQuotation({ customerId: customer.id, customerProductId: product.id, packCount: 24 });
  const sales = await service.createFromQuotation(quotation.id);
  expect(sales.customerId).toBe(customer.id);
  expect(sales.items[0]).toMatchObject({ customerProductId: product.id, packCount: 24, unitPriceCents: 25900 });
});
```

草稿测试覆盖 `customerId`、`customerProductId`、`packCount` 在详情、草稿、multipart payload 之间不丢失。

- [ ] **步骤 2：运行测试确认失败**

运行：`npm run test -- tests/server/sales-documents.test.ts tests/unit/document-drafts.test.ts`

预期：报价复制未携带新关联字段。

- [ ] **步骤 3：改造销售表单客户和产品选择流程**

使用 `CustomerSelector` 和 `CustomerProductPicker`。默认只显示已完善产品；选择后使用最终价格作为销售单价。允许查看待完善产品，缺失字段只警告、不阻止保存。从系统库调用和临时产品保存为当前销售单快照，不自动写入客户产品库。

- [ ] **步骤 4：修正报价复制服务**

`createFromQuotation()` 明确复制报价的 `customerId`、客户文本快照、每行 `customerProductId`、`packCount`、SKU、规格、单价和图片快照。销售单保存后与报价相互独立，修改任何客户产品都不改变两张历史单据。

- [ ] **步骤 5：运行销售回归、类型检查和构建**

运行：`npm run test -- tests/server/sales-documents.test.ts tests/unit/document-drafts.test.ts && npm run typecheck && npm run build`

预期：直接销售单、报价复制、收款凭证、付款状态和新客户产品流程全部 PASS。

- [ ] **步骤 6：记录提交边界**

```powershell
git add -- src/client/components/sales/SalesDocumentForm.tsx src/client/pages/SalesDocumentsPage.tsx src/client/documents/document-drafts.ts src/server/services/sales-document-service.ts tests/unit/document-drafts.test.ts tests/server/sales-documents.test.ts
git commit -m "feat: use customer products in sales documents"
```

---

### 任务 11：新建订单按客户调用产品并计算金额

**文件：**
- 修改：`src/client/components/OrderForm.tsx`
- 修改：`src/client/pages/OrdersPage.tsx`
- 修改：`src/client/api.ts`
- 修改：`src/client/App.tsx`
- 修改：`src/server/services/order-service.ts`
- 修改：`tests/server/order-enhancements.test.ts`
- 修改：`tests/unit/order-calculations.test.ts`

- [ ] **步骤 1：先增加订单金额和客户归属测试**

```ts
it('calculates order line amounts and allows an adjusted order total', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({
    customerId: customer.id,
    customerName: '张三',
    amountCents: 50000,
    items: [{ customerProductId: product.id, name: '电钻', sku: 'ZS-001', specification: '20V', packCount: 24, quantity: 2, unitPriceCents: 25900 }],
  }) });
  expect(response.statusCode).toBe(201);
  expect(response.json().data.items[0].amount_cents).toBe(51800);
  expect(response.json().data.amount_cents).toBe(50000);
});

it('rejects a customer product that belongs to another customer', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({
    customerId: zhang.id,
    items: [orderProductFrom(liProduct)],
  }) });
  expect(response.statusCode).toBe(409);
  expect(response.json().error.code).toBe('CUSTOMER_PRODUCT_CUSTOMER_MISMATCH');
});
```

- [ ] **步骤 2：运行订单测试确认失败**

运行：`npm run test -- tests/server/order-enhancements.test.ts tests/unit/order-calculations.test.ts`

预期：订单尚不返回整数分金额和客户快照。

- [ ] **步骤 3：扩展订单 draft 和 API 映射**

`OrderDraft` 增加客户 ID、客户资料快照；`OrderItemDraft` 增加 `customerProductId`、`unitPrice`、`amountCents`。`draftToInput()` 将价格转换为整数分，不再把客户产品 ID 放在名为 `productId` 的模糊字段中。

保留订单来源 `sourceType` 和 `sourceName`，它们不随客户选择器改变。选择客户只填充客户名称和常用收件信息；收件人名称仍可单独编辑，用于箱唛显示。

- [ ] **步骤 4：实现按客户选品和缺失字段提示**

未选择客户时产品区提示先选客户，但仍允许从系统产品库或临时添加当前订单产品。选择客户后默认请求已完善产品，并可切换待完善。选择客户产品时自动填入最终价格、客户 SKU、装箱数；缺少任一字段时在该行显示待完善提示，但允许保存。

- [ ] **步骤 5：实现自动总额和人工调整模式**

前端维护不入库的 `amountMode: 'auto' | 'manual'`：

- 新订单默认为 `auto`，数量或单价变化时总额等于所有行金额之和。
- 用户编辑订单金额输入框后切换为 `manual`，后续产品行变化不覆盖手调值。
- 金额输入框旁提供“恢复自动计算”图标按钮，将模式改回 `auto` 并立即重算。
- 编辑历史订单默认 `manual`，避免打开后因客户产品变化而改写旧总额。

服务端始终重算行金额，订单总金额使用客户端提交的非负 `amountCents`。

- [ ] **步骤 6：确认箱唛、备货和发货继续使用快照**

订单行的品名、SKU、规格、装箱数仍写入原快照列。箱唛生成、手动合箱、备货状态和发货表不得查询当前客户产品覆盖订单行；它们只读取订单行快照，因此客户产品后续修改不影响已创建订单。

- [ ] **步骤 7：运行订单、箱唛和状态回归**

运行：`npm run test -- tests/server/order-enhancements.test.ts tests/unit/order-calculations.test.ts tests/unit/packing.test.ts tests/unit/status.test.ts && npm run typecheck && npm run build`

预期：订单金额、客户归属、自动装箱、手动合箱、状态推进和构建全部 PASS。

- [ ] **步骤 8：记录提交边界**

```powershell
git add -- src/client/components/OrderForm.tsx src/client/pages/OrdersPage.tsx src/client/api.ts src/client/App.tsx src/server/services/order-service.ts tests/server/order-enhancements.test.ts tests/unit/order-calculations.test.ts
git commit -m "feat: use customer products in orders"
```

---

### 任务 12：整合 App、执行 E2E 和完整回归

**文件：**
- 修改：`src/client/App.tsx`
- 修改：`src/client/api.ts`
- 修改：`playwright.config.ts`
- 创建：`tests/e2e/customer-product-workflow.spec.ts`
- 复核：本计划列出的全部文件

- [ ] **步骤 1：移除 App 启动时的旧客户产品全量状态**

删除 `App.tsx` 的 `customerProducts` 全局数组、`loadCustomerProducts()` 和旧保存回调。客户产品页自行加载客户和当前客户产品；报价、销售和订单表单在选择客户后按需加载。系统产品 `products` 状态继续保留，不改产品库现有功能。

- [ ] **步骤 2：为 Playwright 配置独立数据目录**

在 `playwright.config.ts` 的 `webServer` 增加环境变量：

```ts
import { resolve } from 'node:path';

webServer: {
  command: 'npm run start',
  url: 'http://127.0.0.1:52341/health',
  reuseExistingServer: false,
  timeout: 120_000,
  env: {
    ...process.env,
    WORKBENCH_DATA_DIR: resolve('.tmp/playwright-customer-products'),
    WORKBENCH_PORT: '52341',
  },
},
```

不要把 E2E 指向正式 `data/`。测试名称使用时间戳或随机后缀，重复执行不依赖空数据库。

- [ ] **步骤 3：编写浏览器主流程测试**

`tests/e2e/customer-product-workflow.spec.ts` 覆盖：

```ts
test('quotation sync creates an incomplete customer product and order reuses the completed price', async ({ page }) => {
  const suffix = Date.now();
  await page.goto('/');
  await createCustomerThroughUi(page, `张三-${suffix}`);
  await createQuotationAndSyncOneSelectedItem(page, `张三-${suffix}`, `无刷电钻-${suffix}`, '20V', '259.00');
  await openCustomerProducts(page, `张三-${suffix}`);
  await expect(page.getByText('待完善')).toBeVisible();
  await completeCustomerProduct(page, { sku: `ZS-${suffix}`, packCount: '24', finalPrice: '249.00' });
  await createOrderWithCustomerProduct(page, `张三-${suffix}`, `无刷电钻-${suffix}`, '2');
  await expect(page.getByLabel('订单金额')).toHaveValue('498.00');
});
```

同文件再覆盖：报价弹窗默认全选后取消一行；左侧客户切换只显示对应产品；销售开单带入最终价格；订单客户来源仍显示“微信”和“1688”。辅助函数必须使用可访问名称或 `data-testid`，不要依赖 CSS 层级。

- [ ] **步骤 4：运行完整 Vitest 测试**

运行：`npm run test`

预期：数据库、客户、客户产品、报价同步、报价、销售、订单、产品、设置、附件、备份和全部纯函数测试 PASS。

- [ ] **步骤 5：运行类型检查和生产构建**

运行：`npm run typecheck && npm run build`

预期：客户端和服务端 TypeScript 无错误，`dist/client` 与 `dist/server` 构建成功。

- [ ] **步骤 6：运行隔离的 Playwright 测试**

运行：`npm run test:e2e`

预期：A 布局、报价选择同步、客户产品完善、销售开单和订单金额主流程全部 PASS；正式 `data/` 没有新增或修改记录。

- [ ] **步骤 7：执行静态差异检查**

运行：

```powershell
git diff --check
rg -n "getDocumentCustomerSuggestions|loadCustomerProducts|packaging_json" src/client src/server/routes/customer-products.ts
```

预期：`git diff --check` 无输出；旧客户建议和全量客户产品加载无业务调用；新客户产品路由不再依赖旧 `packaging_json`。

- [ ] **步骤 8：人工浏览器验收**

运行 `npm run dev`，打开 Vite 输出的本地地址，依次确认：

1. 客户产品库左侧按客户分类，右侧只显示当前客户产品。
2. 同名客户需确认后才可新增，引用中的客户删除时变为停用。
3. 报价产品默认全选，可取消部分后同步；重复同步只更新最近报价。
4. 待完善产品补齐最终价格、SKU、装箱数后切换为已完善。
5. 报价、销售开单、订单按客户搜索产品并带入最终价格。
6. 单据内修改客户资料和产品价格不改变客户档案及客户产品库。
7. 订单客户与客户来源彼此独立，微信和 1688 仍存在。
8. 历史订单、报价、销售单、合同、付款凭证、箱唛、打印、备货和发货功能可以正常打开和使用。

- [ ] **步骤 9：记录最终提交边界**

```powershell
git add -- src/client/App.tsx src/client/api.ts playwright.config.ts tests/e2e/customer-product-workflow.spec.ts
git commit -m "test: cover customer product workflow"
```

执行结束后向用户报告：实际修改文件、迁移结果、测试结果、浏览器地址，以及任何未通过的检查。未经用户要求不推送分支，不删除 `.tmp` 以外的任何目录。
