# 产品库参数列实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为系统产品库增加可保存的多行“参数”字段，并在产品列表、SKU 详情、图片交互、报价单和销售单中正确传递该字段。

**架构：** 在 SQLite 的 `products` 表增加 `parameters` 文本列，使用幂等迁移兼容现有数据库；产品 API 和产品编辑器负责字段的校验、读写和展示。报价单、销售单分别保存从系统产品库或报价单复制而来的参数快照，因此产品库后续修改不会改变历史单据。订单模块继续使用已确认的独立客户产品库，本计划不修改订单数据模型、路由或页面。

**技术栈：** TypeScript、React、Fastify、SQLite、Vitest、Vite、现有 CSS 和 `lucide-react`。

---

## 范围边界

本次只实现以下三类数据：

1. 系统产品库：`products.parameters`；
2. 报价单明细快照：`quotation_items.parameters`；
3. 销售单明细快照：`sales_document_items.parameters`。

订单模块保持现状：订单继续使用独立的客户产品库 `customer_products`，客户产品与系统产品库不互通；订单允许人工录入和多行添加，但本次不增加 `parameters`，不修改订单表、订单接口、订单页面和订单服务。

明确不修改以下订单文件：

- `C:\Users\gaofu\Documents\个人工作台\src\client\components\OrderForm.tsx`
- `C:\Users\gaofu\Documents\个人工作台\src\server\routes\orders.ts`
- `C:\Users\gaofu\Documents\个人工作台\src\server\services\order-service.ts`
- 订单相关仓储、数据库表和测试文件。

---

## 文件范围和职责

### 创建

- `C:\Users\gaofu\Documents\个人工作台\tests\server\product-parameters.test.ts`：覆盖产品参数字段、兼容迁移、API 校验以及报价单/销售单快照隔离。
- `C:\Users\gaofu\Documents\个人工作台\src\client\components\ProductDetailModal.tsx`：只读展示 SKU 详情、完整参数和产品图片入口。
- `C:\Users\gaofu\Documents\个人工作台\src\client\components\ProductImagesModal.tsx`：展示产品全部图片，支持选择图片和复制所选图片。

### 修改

- `C:\Users\gaofu\Documents\个人工作台\src\server\db\migrate.ts`：新建表包含三个参数字段，并为旧数据库执行幂等 `ALTER TABLE`。
- `C:\Users\gaofu\Documents\个人工作台\src\server\db\repositories.ts`：产品仓储读写 `products.parameters`，并保持现有通用仓储职责；不增加订单参数 SQL。
- `C:\Users\gaofu\Documents\个人工作台\src\server\routes\products.ts`：只接受字符串参数，缺省/null 归一化为空字符串，非法类型返回 `400 VALIDATION_ERROR`。
- `C:\Users\gaofu\Documents\个人工作台\src\client\components\ProductEditor.tsx`：增加多行参数输入框，支持回填、修改、清空和保存。
- `C:\Users\gaofu\Documents\个人工作台\src\client\api.ts`：增加产品参数的 API 类型、读取映射和保存映射；不把参数加入 `CustomerProduct`。
- `C:\Users\gaofu\Documents\个人工作台\src\client\pages\ProductsPage.tsx`：按确认顺序展示参数列，接入 SKU 详情弹窗和图片弹窗。
- `C:\Users\gaofu\Documents\个人工作台\src\client\components\documents\LibraryProductPicker.tsx`：从系统产品库选择报价单产品时复制参数快照。
- `C:\Users\gaofu\Documents\个人工作台\src\client\components\quotations\QuotationForm.tsx`：维护报价单草稿行的参数并提交保存。
- `C:\Users\gaofu\Documents\个人工作台\src\server\services\quotation-service.ts`：解析、保存和读取报价单参数快照。
- `C:\Users\gaofu\Documents\个人工作台\src\server\db\quotation-repository.ts`：报价单明细 `INSERT`、`UPDATE`、`SELECT` 和映射增加参数字段。
- `C:\Users\gaofu\Documents\个人工作台\src\client\components\sales\SalesDocumentForm.tsx`：销售单从报价单或系统产品库填充明细时保留参数快照。
- `C:\Users\gaofu\Documents\个人工作台\src\server\services\sales-document-service.ts`：解析、保存和读取销售单参数快照。
- `C:\Users\gaofu\Documents\个人工作台\src\server\db\sales-document-repository.ts`：销售单明细 `INSERT`、`UPDATE`、`SELECT` 和映射增加参数字段。
- `C:\Users\gaofu\Documents\个人工作台\src\shared\documents.ts`：报价单、销售单、产品快照和明细输入类型增加 `parameters: string`。
- `C:\Users\gaofu\Documents\个人工作台\src\client\documents\document-drafts.ts`：报价单/销售单草稿和 payload 映射传递参数。
- `C:\Users\gaofu\Documents\个人工作台\src\client\styles\app.css`：仅增加参数摘要、详情弹窗和图片弹窗所需的最小样式。
- `C:\Users\gaofu\Documents\个人工作台\tests\server\database.test.ts`：补充三个参数列存在且可重复迁移的数据库断言。
- `C:\Users\gaofu\Documents\个人工作台\tests\server\products.test.ts`：补充产品 API/仓储参数保存、更新和校验断言，或复用新测试文件中的专用辅助方法。
- `C:\Users\gaofu\Documents\个人工作台\tests\server\quotations.test.ts`：补充报价单参数快照断言。
- `C:\Users\gaofu\Documents\个人工作台\tests\server\sales-documents.test.ts`：补充销售单从产品库/报价单复制参数快照断言。

---

## 实施任务

### 任务 1：数据库字段和兼容迁移

**文件：**
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\server\db\migrate.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\tests\server\database.test.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\server\product-parameters.test.ts`

- [ ] **步骤 1：编写迁移失败测试。**

在测试中使用现有临时数据库辅助函数和 `migrateDatabase`，不使用项目真实 `data/`。增加以下可执行断言：

```ts
it('新数据库包含三个参数列，旧产品默认空字符串', () => {
  const { database } = makeDatabase();
  migrateDatabase(database);

  for (const table of ['products', 'quotation_items', 'sales_document_items']) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all()
      .map((row) => String((row as { name: string }).name));
    expect(columns).toContain('parameters');
  }

  const row = database.prepare(
    "INSERT INTO products (name, created_at, updated_at) VALUES ('旧产品', '2026-08-10', '2026-08-10') RETURNING parameters",
  ).get() as { parameters: string };
  expect(row.parameters).toBe('');
});

it('重复迁移不会覆盖已有参数', () => {
  const { database } = makeDatabase();
  migrateDatabase(database);
  database.prepare("UPDATE products SET parameters = '扭矩：35N·m'").run();
  migrateDatabase(database);
  expect((database.prepare('SELECT parameters FROM products').get() as { parameters: string }).parameters)
    .toBe('扭矩：35N·m');
});
```

- [ ] **步骤 2：运行测试确认当前实现失败。**

运行：`npm test -- tests/server/product-parameters.test.ts tests/server/database.test.ts`

预期：新断言因 `parameters` 列尚未存在而失败；既有数据库测试的原有断言不应被删除。

- [ ] **步骤 3：实现幂等迁移。**

在三个建表 SQL 中加入：

```sql
parameters TEXT NOT NULL DEFAULT ''
```

在同一个迁移事务内分别读取 `PRAGMA table_info(products)`、`PRAGMA table_info(quotation_items)`、`PRAGMA table_info(sales_document_items)`；缺少 `parameters` 时才执行对应的：

```sql
ALTER TABLE <table_name> ADD COLUMN parameters TEXT NOT NULL DEFAULT ''
```

迁移必须保留已有行和已有参数，不删除或重建 `data/`，重复运行不改变已保存值，并沿用项目当前最新的 schema 版本号。

- [ ] **步骤 4：运行迁移测试确认通过。**

运行：`npm test -- tests/server/product-parameters.test.ts tests/server/database.test.ts`

预期：参数列、旧产品默认值和重复迁移保护测试全部通过。

- [ ] **步骤 5：提交迁移变更。**

```powershell
git add src/server/db/migrate.ts tests/server/database.test.ts tests/server/product-parameters.test.ts
git commit -m "feat: add parameter columns to product documents"
```

### 任务 2：产品仓储与 API 参数读写

**文件：**
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\server\db\repositories.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\products.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\tests\server\product-parameters.test.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\tests\server\products.test.ts`

- [ ] **步骤 1：编写产品字段失败测试。**

覆盖创建、更新、空值兼容和非法类型：

```ts
it('产品可以保存、更新和读取多行参数', () => {
  const { repositories } = makeRepositories();
  const saved = repositories.saveProduct({
    name: '电钻', specification: '12V',
    parameters: '扭矩：35N·m\n转速：0-1500rpm',
    packaging: [{ name: '彩盒包装', packCount: 10 }],
  });
  expect(saved?.parameters).toBe('扭矩：35N·m\n转速：0-1500rpm');

  const updated = repositories.saveProduct({
    name: '电钻', specification: '12V', parameters: '',
    packaging: [{ name: '彩盒包装', packCount: 10 }],
  }, Number(saved?.id));
  expect(updated?.parameters).toBe('');
});
```

产品接口测试还要断言：省略 `parameters` 或传 `null` 返回空字符串；传数字、数组或对象返回 HTTP `400` 且错误码为 `VALIDATION_ERROR`。

- [ ] **步骤 2：运行产品测试确认失败。**

运行：`npm test -- tests/server/product-parameters.test.ts tests/server/products.test.ts`

预期：在未实现字段前，新增的保存/读取断言失败。

- [ ] **步骤 3：实现后端字段契约。**

在 `ProductInput` 增加 `parameters?: string`。`saveProduct` 的产品 `UPDATE` 和 `INSERT` 显式写入 `parameters`；`mapProduct` 使用 `String(row.parameters ?? '')` 输出。

在 `src/server/routes/products.ts` 使用现有 `optionalText()` 或等价局部函数：`undefined`、`null`、`''` 归一为空字符串；只有字符串可以通过；数字、数组和对象不得隐式转换，返回统一 `400 VALIDATION_ERROR`。

- [ ] **步骤 4：运行测试和类型检查。**

运行：

```powershell
npm test -- tests/server/product-parameters.test.ts tests/server/products.test.ts
npm run typecheck
```

预期：产品参数创建、更新、兼容和校验测试通过，类型检查退出码为 0。

- [ ] **步骤 5：提交后端产品字段。**

```powershell
git add src/server/db/repositories.ts src/server/routes/products.ts tests/server/product-parameters.test.ts tests/server/products.test.ts
git commit -m "feat: persist product parameters"
```

### 任务 3：产品编辑器和前端产品 API 映射

**文件：**
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\components\ProductEditor.tsx`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\api.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\styles\app.css`

- [ ] **步骤 1：增加受控参数字段。**

在系统产品的 `ProductRecord`、空白草稿和产品 API 类型中增加 `parameters: string`；不要修改 `CustomerProduct` 类型。编辑器在品名、SKU、规格区域附近加入：

```tsx
<label style={labelStyle}>
  参数
  <textarea
    rows={5}
    value={draft.parameters}
    onChange={(event) => set('parameters', event.target.value)}
    placeholder={'每行填写一项，例如：\n扭矩：35N·m\n转速：0-1500rpm'}
  />
</label>
```

回填旧产品时缺失值按 `''` 处理；保存、修改、清空均提交文本原值，保留换行。

- [ ] **步骤 2：运行类型检查和构建。**

运行：`npm run typecheck`、`npm run build`。

预期：产品编辑器和现有客户产品库不产生类型错误，构建成功。

- [ ] **步骤 3：提交前端字段。**

```powershell
git add src/client/components/ProductEditor.tsx src/client/api.ts src/client/styles/app.css
git commit -m "feat: add product parameter editor"
```

### 任务 4：报价单和销售单参数快照

**文件：**
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\shared\documents.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\documents\document-drafts.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\components\documents\LibraryProductPicker.tsx`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\components\quotations\QuotationForm.tsx`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\server\services\quotation-service.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\server\db\quotation-repository.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\components\sales\SalesDocumentForm.tsx`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\server\services\sales-document-service.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\server\db\sales-document-repository.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\tests\server\quotations.test.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\tests\server\sales-documents.test.ts`
- 不修改：订单页面、订单路由、订单服务、订单仓储和订单数据库表。

- [ ] **步骤 1：编写报价单和销售单快照失败测试。**

测试流程固定为：创建系统产品并写入两行参数；从产品库创建报价单，读取报价单明细并断言换行文本；修改系统产品参数，再次读取报价单并断言仍为旧文本；从报价单创建销售单并断言销售单保留报价单旧文本；另测直接从系统产品库创建销售单和空参数。

核心断言形态：

```ts
expect(quotation.items[0].parameters).toBe('扭矩：35N·m\n转速：0-1500rpm');
expect(salesDocument.items[0].parameters).toBe('扭矩：35N·m\n转速：0-1500rpm');
```

- [ ] **步骤 2：运行领域测试确认失败。**

运行：`npm test -- tests/server/quotations.test.ts tests/server/sales-documents.test.ts`

预期：新增的参数快照断言在字段尚未贯通时失败，原有报价单和销售单断言继续保留。

- [ ] **步骤 3：贯通共享类型和草稿映射。**

在 `documents.ts` 和 `document-drafts.ts` 中为 `DocumentProductSnapshot`、`QuotationItemInput`、`QuotationPersistenceItem`、`QuotationItem`、`SalesDocumentItemInput`、`SalesDocumentPersistenceItem`、`SalesDocumentItem`、`DocumentItemDraft`、`DocumentItemPayload` 增加 `parameters: string`。产品选择器将 `ProductRecord.parameters` 复制到新行；从报价单复制到销售单时沿用报价单的参数，不重新查询产品库覆盖已保存快照。

- [ ] **步骤 4：实现报价单和销售单服务/仓储字段。**

在两个 service 中对缺失参数使用 `String(value ?? '')` 的兼容映射，并在两个 repository 中显式修改以下 SQL：

```sql
INSERT INTO quotation_items (..., parameters) VALUES (..., ?)
UPDATE quotation_items SET parameters = ? WHERE id = ?
SELECT ..., parameters FROM quotation_items

INSERT INTO sales_document_items (..., parameters) VALUES (..., ?)
UPDATE sales_document_items SET parameters = ? WHERE id = ?
SELECT ..., parameters FROM sales_document_items
```

参数只作为快照保存；产品库修改不得触发历史单据回写。沿用已有单据状态流转和展示规则，箱唛不默认加入参数。

- [ ] **步骤 5：运行领域测试和类型检查。**

运行：

```powershell
npm test -- tests/server/quotations.test.ts tests/server/sales-documents.test.ts
npm run typecheck
```

预期：快照隔离测试、既有报价单/销售单测试和类型检查全部通过。

- [ ] **步骤 6：提交单据快照变更。**

```powershell
git add src/shared/documents.ts src/client/documents/document-drafts.ts src/client/components/documents/LibraryProductPicker.tsx src/client/components/quotations/QuotationForm.tsx src/server/services/quotation-service.ts src/server/db/quotation-repository.ts src/client/components/sales/SalesDocumentForm.tsx src/server/services/sales-document-service.ts src/server/db/sales-document-repository.ts tests/server/quotations.test.ts tests/server/sales-documents.test.ts
git commit -m "feat: preserve product parameters in document snapshots"
```

### 任务 5：产品列表、SKU 详情和图片弹窗

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\ProductDetailModal.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\ProductImagesModal.tsx`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\pages\ProductsPage.tsx`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\styles\app.css`

- [ ] **步骤 1：实现 SKU 详情弹窗。**

使用项目现有 `Modal`，组件 props 固定为 `open: boolean`、`product?: ProductRecord`、`onClose: () => void`，另接收打开图片弹窗的回调。展示 SKU、品名、规格、完整参数、包装信息、颜色、插脚、供应商和价格；参数使用 `white-space: pre-wrap`，空参数显示“暂无参数”。详情弹窗只读，不复制编辑提交逻辑。

- [ ] **步骤 2：实现图片选择与复制弹窗。**

先按现有 `ImageAttachment` 类型使用 `{ id, name, url }` 字段，不假定 `relativePath`。默认选择第一张，缩略图使用原生 `<button>` 并设置当前选择状态；复制按钮获取所选 `url` 的 blob，然后调用：

```ts
await navigator.clipboard.write([
  new ClipboardItem({ [blob.type]: blob }),
]);
```

无图片时显示空状态；浏览器不支持剪贴板、请求失败或权限拒绝时显示“当前浏览器不支持复制图片，请右键保存”，不得抛出未处理异常。

- [ ] **步骤 3：重排列表并接入弹窗入口。**

表头和单元格严格按以下顺序：

```ts
['SKU', '图片', '品名', '规格', '参数', '包装信息', '颜色', '插脚', '供应商', '价格', '操作']
```

SKU 点击打开详情；图片缩略图或数量打开图片弹窗；参数摘要取前两行，超过两行追加省略号，空值显示“—”；颜色和插脚用“、”连接；价格显示采购价和 `¥`，空值显示“—”。搜索仍只使用现有品名、SKU、规格、供应商、分类条件，不新增参数搜索。

- [ ] **步骤 4：运行前端检查。**

运行：`npm run typecheck`、`npm run build`。

使用现有本地服务检查无图片、单图片、多图片、空参数、长参数、SKU 点击和窄窗口横向滚动；确认详情弹窗显示完整换行参数，图片弹窗选择/复制失败提示正常。

- [ ] **步骤 5：提交产品库交互。**

```powershell
git add src/client/components/ProductDetailModal.tsx src/client/components/ProductImagesModal.tsx src/client/pages/ProductsPage.tsx src/client/styles/app.css
git commit -m "feat: add product details and image copy"
```

### 任务 6：全量验证和收尾

**文件：**
- 仅在测试或文档确有必要时修改：`C:\Users\gaofu\Documents\个人工作台\tests\server\database.test.ts`、`C:\Users\gaofu\Documents\个人工作台\README.md`

- [ ] **步骤 1：运行全量验证。**

按顺序运行：

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

预期：Vitest 全部通过，TypeScript 检查、Vite 构建和 diff 检查均以退出码 0 结束。

- [ ] **步骤 2：在临时数据库副本验证迁移保护。**

使用临时复制的 SQLite 文件执行服务启动/迁移，断言旧产品数量、已有 SKU、图片数量、包装数量和既有报价单/销售单数量不变；新增参数字段为空；再次迁移后手动写入的参数仍保持不变。不得直接重置、删除或重建项目真实 `data/`。

- [ ] **步骤 3：核对改动范围。**

运行：`git status --short`、`git diff --check`，并逐项确认改动只涉及本计划列出的产品库、报价单、销售单和测试文件；不得清理工作区中的其他未提交文件，不得提交订单模块文件。

- [ ] **步骤 4：提交必要的验证修正。**

若全量验证只产生本功能相关的测试或文档修正，执行：

```powershell
git add tests README.md
git commit -m "test: verify product parameter integration"
```

若没有额外修正，不创建空提交。

---

## 验收标准

1. 产品编辑器可以保存、修改和清空多行参数，旧产品打开时参数为空且不报错。
2. 产品列表顺序为 SKU、图片、品名、规格、参数、包装信息、颜色、插脚、供应商、价格、操作。
3. 点击 SKU 可在紧凑弹窗查看完整产品参数；点击图片可查看全部图片、选择并复制图片。
4. 报价单从系统产品库调用时保存参数快照；销售单从系统产品库或报价单调用时保存参数快照；产品库后续修改不影响历史单据。
5. 订单的独立客户产品库及订单流程不被修改。
6. 迁移可重复执行且不覆盖已有数据，所有测试、类型检查、构建和 diff 检查通过。
