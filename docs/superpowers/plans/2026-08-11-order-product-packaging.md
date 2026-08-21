# 订单日期、客户产品与包装信息兼容升级实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不破坏现有订单、产品、箱唛和附件数据的前提下，将新建订单改为按天记录，简化客户产品库为四个字段，支持订单内直接新增客户产品，并把系统产品包装方式升级为内盒/外箱单字段尺寸结构。

**架构：** 采用兼容升级，不删除 `data/`、不重建业务表、不批量改写历史订单。前端将客户产品模型与系统产品模型分离，订单明细保存本单装箱数快照；后端通过 schema version 5 增加包装字段，同时继续读取旧长宽高字段。所有箱数计算集中到纯函数，订单箱数使用 `ceil(数量 ÷ 装箱数)`。

**技术栈：** React 19、Vite、TypeScript、Fastify、SQLite `node:sqlite`、Vitest、现有 CSS/内联样式组件。

**执行约束：** 本计划只描述实现步骤。执行时不得运行 `git reset` 或 `git clean`，不得删除或覆盖 `C:\Users\gaofu\Documents\个人工作台\data\`，未经用户要求不创建 Git commit。每个任务用测试、类型检查或构建作为检查点。

---

## 文件清单与职责

### 创建文件

- `src/shared/order-calculations.ts`：提供订单行箱数和多行总箱数的纯函数，供订单表单和单元测试共用。
- `src/shared/date-input.ts`：提供浏览器本地日期输入值格式化，避免用 UTC ISO 字符串生成新订单日期。
- `src/server/services/order-date.ts`：校验并规范化 `YYYY-MM-DD` 与历史 ISO 日期时间值。
- `src/server/db/packaging.ts`：包装尺寸文本解析与旧长宽高回退映射，保证无法识别的尺寸文本不被截断。
- `src/client/components/CustomerProductEditor.tsx`：客户产品专用四字段编辑弹窗，不再复用系统产品完整编辑器。
- `tests/unit/order-calculations.test.ts`：测试订单行箱数和总箱数规则。
- `tests/unit/date-input.test.ts`：测试新订单日期输入值和历史值日期截取。

### 修改文件

- `src/server/db/migrate.ts`：初始 schema 增加包装新列，并为已有数据库增加幂等 schema version 5 迁移。
- `src/server/db/repositories.ts`：读写新旧包装字段、保存四字段客户产品、保留历史客户产品未暴露数据、保存订单包装快照。
- `src/server/routes/products.ts`：接收新包装字段并兼容旧长宽高字段。
- `src/server/routes/customer-products.ts`：接收 `{ name, sku, specification, packCount }`，同时兼容旧 `packaging` 数组。
- `src/server/routes/orders.ts`：将订单日期输入规范化为日期字符串，并兼容编辑历史 ISO 日期；订单包装解析兼容新旧字段。
- `src/server/services/order-service.ts`：在服务层执行日期校验和包装数据校验，保证绕过 HTTP 路由调用时规则仍成立。
- `src/client/components/OrderForm.tsx`：日期控件改为 `date`、使用四字段客户产品、自动计算箱数、打开订单内新品弹窗。
- `src/client/components/ProductPicker.tsx`：无匹配结果时显示可点击的“添加新品”，并把当前搜索词交给表单。
- `src/client/components/PackagingTable.tsx`：每行显示包装名称、内盒尺寸/重量、外箱尺寸/重量/装箱数。
- `src/client/components/ProductEditor.tsx`：系统产品使用新包装类型和新包装表格，保留系统产品参数、颜色、插脚、图片等功能。
- `src/client/components/ProductDetailModal.tsx`：按内盒/外箱新字段展示包装详情，并兼容旧数据回显。
- `src/client/pages/CustomerProductsPage.tsx`：改用客户产品专用编辑器和品名、SKU、规格、装箱数列表。
- `src/client/pages/ProductsPage.tsx`：更新系统产品包装摘要，避免继续读取已不再作为新输入的长宽高控件。
- `src/client/pages/OrdersPage.tsx`：把客户产品保存回调传给 `OrderForm`，支持订单内新增产品并自动加入订单。
- `src/client/App.tsx`：映射日期前十位、区分系统/客户产品类型，并让客户产品保存函数返回保存后的产品记录。
- `src/client/api.ts`：日期直接传输、客户产品四字段请求、新包装字段映射和旧包装字段回退。
- `tests/server/database.test.ts`：验证 schema version 5、新包装列、旧数据保留和重复迁移幂等。
- `tests/server/products.test.ts`：验证新旧包装字段读写和尺寸文本不丢失。
- `tests/server/order-enhancements.test.ts`：验证订单日期规范化、客户产品四字段接口和订单箱数。

---

### 任务 1：建立可复用的日期与箱数纯函数

**文件：**
- 创建：`src/shared/order-calculations.ts`
- 创建：`src/shared/date-input.ts`
- 创建：`tests/unit/order-calculations.test.ts`
- 创建：`tests/unit/date-input.test.ts`

- [ ] **步骤 1：先编写失败的箱数测试**

在 `tests/unit/order-calculations.test.ts` 写入以下行为测试：

```ts
import { describe, expect, it } from 'vitest';
import { calculateOrderBoxes, sumOrderBoxes } from '../../src/shared/order-calculations';

describe('订单箱数计算', () => {
  it('按数量除以本单装箱数向上取整', () => {
    expect(calculateOrderBoxes(100, 24)).toBe(5);
    expect(calculateOrderBoxes(48, 24)).toBe(2);
    expect(calculateOrderBoxes(1, 24)).toBe(1);
  });

  it('拒绝非正整数数量或装箱数', () => {
    expect(() => calculateOrderBoxes(0, 24)).toThrow('数量必须是正整数');
    expect(() => calculateOrderBoxes(10, 0)).toThrow('装箱数必须是正整数');
    expect(() => calculateOrderBoxes(1.5, 24)).toThrow('数量必须是正整数');
  });

  it('多行订单总箱数是每行箱数之和', () => {
    expect(sumOrderBoxes([{ quantity: 100, packCount: 24 }, { quantity: 25, packCount: 12 }])).toBe(8);
  });
});
```

- [ ] **步骤 2：运行箱数测试确认当前失败**

运行：`npm run test -- tests/unit/order-calculations.test.ts`

预期：FAIL，原因是 `src/shared/order-calculations.ts` 尚不存在。

- [ ] **步骤 3：实现最小箱数函数**

在 `src/shared/order-calculations.ts` 实现统一规则：

```ts
export interface OrderBoxInput {
  quantity: number;
  packCount: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须是正整数`);
}

export function calculateOrderBoxes(quantity: number, packCount: number): number {
  assertPositiveInteger(quantity, '数量');
  assertPositiveInteger(packCount, '装箱数');
  return Math.ceil(quantity / packCount);
}

export function sumOrderBoxes(items: OrderBoxInput[]): number {
  return items.reduce((total, item) => total + calculateOrderBoxes(item.quantity, item.packCount), 0);
}
```

- [ ] **步骤 4：运行箱数测试确认通过**

运行：`npm run test -- tests/unit/order-calculations.test.ts`

预期：3 个测试全部 PASS。

- [ ] **步骤 5：先编写日期输入测试**

在 `tests/unit/date-input.test.ts` 覆盖本地日期、历史 ISO 和非法输入：

```ts
import { describe, expect, it } from 'vitest';
import { dateInputValue, dateOnlyValue } from '../../src/shared/date-input';

describe('日期输入值', () => {
  it('新订单使用浏览器本地日期，不经过 UTC 转换', () => {
    expect(dateInputValue(new Date(2026, 7, 11, 0, 5))).toBe('2026-08-11');
  });

  it('历史 ISO 日期只取日期部分', () => {
    expect(dateOnlyValue('2026-08-10T08:00:00.000Z')).toBe('2026-08-10');
    expect(dateOnlyValue('2026-08-10')).toBe('2026-08-10');
  });

  it('空值使用传入的本地当前日期', () => {
    expect(dateInputValue(undefined, new Date(2026, 7, 11, 23, 59))).toBe('2026-08-11');
  });
});
```

- [ ] **步骤 6：实现日期输入格式化函数并通过测试**

在 `src/shared/date-input.ts` 使用 `getFullYear()`、`getMonth()`、`getDate()`，不要调用 `toISOString()`：

```ts
function pad(value: number): string { return String(value).padStart(2, '0'); }

export function dateInputValue(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function dateOnlyValue(value: string): string {
  return value.trim().slice(0, 10);
}
```

运行：`npm run test -- tests/unit/date-input.test.ts`

预期：3 个测试全部 PASS。

---

### 任务 2：增加 schema version 5 的包装字段迁移

**文件：**
- 修改：`src/server/db/migrate.ts: product_packaging CREATE TABLE 与 migrateDatabase`
- 修改：`tests/server/database.test.ts: schema 版本和迁移用例`

- [ ] **步骤 1：先更新数据库测试断言**

在数据库基础测试中将 schema version 期望改为 `'5'`，并增加：

```ts
expect(getColumnNames(database, 'product_packaging')).toEqual(expect.arrayContaining([
  'inner_size',
  'inner_weight',
  'outer_size',
]));
```

新增旧数据库迁移测试：创建只含旧包装列的 `product_packaging` 表，插入一行旧尺寸和重量，执行 `migrateDatabase` 两次，断言新列存在且旧行仍然存在；第二次迁移不新增重复列。

- [ ] **步骤 2：运行数据库测试确认失败**

运行：`npm run test -- tests/server/database.test.ts`

预期：现有 schema version 4 与缺少新列的断言失败。

- [ ] **步骤 3：更新初始 schema 和幂等迁移**

在 `product_packaging` 建表定义中增加：

```sql
inner_size TEXT NOT NULL DEFAULT '',
inner_weight REAL NOT NULL DEFAULT 0,
outer_size TEXT NOT NULL DEFAULT '',
```

在 `migrateDatabase` 的事务中，使用 `PRAGMA table_info(product_packaging)` 检查列名；缺失时逐列执行：

```ts
for (const [column, definition] of [
  ['inner_size', "TEXT NOT NULL DEFAULT ''"],
  ['inner_weight', 'REAL NOT NULL DEFAULT 0'],
  ['outer_size', "TEXT NOT NULL DEFAULT ''"],
] as const) {
  if (!packagingColumns.includes(column)) {
    transactionDatabase.exec(`ALTER TABLE product_packaging ADD COLUMN ${column} ${definition}`);
  }
}
```

将 schema version 写入值改为 `'5'`。保留旧的 `outer_length`、`outer_width`、`outer_height`、`outer_weight`、`pack_count`，不执行表重建和数据清理。

- [ ] **步骤 4：运行数据库测试确认迁移通过**

运行：`npm run test -- tests/server/database.test.ts`

预期：完整 schema、旧表升级、重复迁移和事务回滚测试全部 PASS。

---

### 任务 3：实现包装尺寸文本的兼容读写

**文件：**
- 创建：`src/server/db/packaging.ts`
- 修改：`src/server/db/repositories.ts`
- 修改：`src/server/routes/products.ts`
- 修改：`src/server/routes/orders.ts`
- 修改：`src/server/services/order-service.ts`
- 修改：`tests/server/products.test.ts`

- [ ] **步骤 1：先增加尺寸兼容测试**

在 `tests/server/products.test.ts` 增加系统产品接口测试，覆盖以下 payload 和结果：

```ts
const packaging = {
  name: '彩盒包装',
  innerSize: '35×28×20cm',
  innerWeight: 0.8,
  outerSize: '40*30*25',
  outerWeight: 1.2,
  packCount: 24,
};

const created = await app.inject({
  method: 'POST',
  url: '/api/products',
  payload: { ...productInput('新包装产品'), packaging: [packaging] },
});
expect(created.json().data.packaging[0]).toMatchObject(packaging);

const legacy = await app.inject({
  method: 'POST',
  url: '/api/products',
  payload: { ...productInput('旧包装产品'), packaging: [{ name: '旧包装', outerLength: 40, outerWidth: 30, outerHeight: 25, outerWeight: 1.2, packCount: 24 }] },
});
expect(legacy.json().data.packaging[0].outerSize).toBe('40×30×25');

const freeText = await app.inject({
  method: 'POST',
  url: '/api/products',
  payload: { ...productInput('文本尺寸产品'), packaging: [{ ...packaging, outerSize: '按供应商外箱标签填写' }] },
});
expect(freeText.json().data.packaging[0].outerSize).toBe('按供应商外箱标签填写');
```

- [ ] **步骤 2：运行产品测试确认失败**

运行：`npm run test -- tests/server/products.test.ts`

预期：新字段未被路由接受或读取结果缺少 `innerSize`、`outerSize`。

- [ ] **步骤 3：实现尺寸文本解析和旧字段回退**

在 `src/server/db/packaging.ts` 定义统一结构和函数：

```ts
export interface PackagingDimensions {
  innerSize: string;
  innerWeight: number;
  outerSize: string;
  outerWeight: number;
  packCount: number;
}

export function parseDimensionTriplet(value: string): [number, number, number] | undefined;
export function legacyOuterSize(length: unknown, width: unknown, height: unknown): string;
```

`parseDimensionTriplet` 只在文本中恰好能提取至少三个数字时返回前三个数字；支持 `×`、`*`、`x`、`X` 和普通空格分隔，不改变原文。`legacyOuterSize` 只在三个旧值均为正数时返回 `长×宽×高`，否则返回空字符串。

- [ ] **步骤 4：扩展仓储类型和 SQL 双写逻辑**

在 `src/server/db/repositories.ts` 将 `PackagingInput` 扩展为：

```ts
export interface PackagingInput {
  name?: string;
  innerSize?: string;
  innerWeight?: number;
  outerSize?: string;
  outerWeight?: number;
  packCount: number;
  outerLength?: number;
  outerWidth?: number;
  outerHeight?: number;
}
```

更新 `listProducts()` 的 `json_object`，优先返回数据库中的 `inner_size`/`outer_size`，当 `outer_size` 为空时用旧长宽高组合。更新 `saveProduct()` 的 INSERT 为新旧字段同时写入：新尺寸文本原样写入新列；只有 `parseDimensionTriplet` 成功时才写入旧长宽高，否则旧长宽高写 0；重量和装箱数同步写入兼容字段。

`normalizePackaging` 继续被订单历史和箱唛逻辑使用，但要保留 `innerSize`、`innerWeight`、`outerSize`、`outerWeight`，并允许旧调用只传长宽高。订单的 `order_item_box_sizes` 表不改 schema；旧订单读取和箱唛仍使用已有旧字段。

- [ ] **步骤 5：更新产品、订单路由和服务层解析**

在 `src/server/routes/products.ts`、`src/server/routes/orders.ts` 中新增字段解析：

```ts
innerSize: optionalText(item.innerSize, `${prefix}.innerSize`, '内盒尺寸'),
innerWeight: finiteNumber(item.innerWeight, `${prefix}.innerWeight`, '内盒重量', 0),
outerSize: optionalText(item.outerSize, `${prefix}.outerSize`, '外箱尺寸'),
outerWeight: finiteNumber(item.outerWeight, `${prefix}.outerWeight`, '外箱重量', 0),
packCount: positiveInteger(item.packCount, `${prefix}.packCount`, '装箱数'),
```

同时保留旧 `outerLength`、`outerWidth`、`outerHeight` 的解析，并让服务层的非负数字校验同时覆盖内盒重量、外箱重量和旧尺寸数字。

- [ ] **步骤 6：运行产品及服务回归测试**

运行：`npm run test -- tests/server/products.test.ts tests/unit/packing.test.ts`

预期：新包装、旧包装、自由文本尺寸、现有自动装箱和手动合箱测试全部 PASS。

---

### 任务 4：简化客户产品仓储和 API

**文件：**
- 修改：`src/server/db/repositories.ts`
- 修改：`src/server/routes/customer-products.ts`
- 修改：`tests/server/order-enhancements.test.ts`

- [ ] **步骤 1：先增加四字段客户产品接口测试**

在 `tests/server/order-enhancements.test.ts` 增加客户产品测试：

```ts
it('客户产品只提交四个字段，并返回装箱数', async () => {
  const { app, repositories } = await makeContext();
  const created = await app.inject({
    method: 'POST',
    url: '/api/customer-products',
    payload: { name: '客户电钻', sku: 'C-001', specification: '12V', packCount: 24 },
  });
  expect(created.statusCode).toBe(201);
  expect(created.json().data).toMatchObject({ name: '客户电钻', sku: 'C-001', specification: '12V', packCount: 24 });

  const saved = repositories.getCustomerProduct(Number(created.json().data.id));
  expect(saved?.packaging[0]?.packCount).toBe(24);

  const updated = await app.inject({
    method: 'PUT',
    url: `/api/customer-products/${created.json().data.id}`,
    payload: { name: '客户电钻', sku: 'C-001', specification: '20V', packCount: 12 },
  });
  expect(updated.json().data).toMatchObject({ specification: '20V', packCount: 12 });
});
```

另加相同品名不同规格的列表查询断言，确保两条记录均保留。

- [ ] **步骤 2：运行客户产品测试确认失败**

运行：`npm run test -- tests/server/order-enhancements.test.ts`

预期：当前路由因缺少 `packaging` 数组返回 400。

- [ ] **步骤 3：扩展客户产品输入并保持旧字段**

在 `CustomerProductInput` 增加 `packCount?: number`，保留 `packaging?: PackagingInput[]` 和 `remark?: string` 作为兼容输入。路由解析规则为：

1. `packCount` 存在时校验正整数，并生成默认包装 `[{ name: '', packCount }]`；
2. 没有 `packCount` 时继续解析历史 `packaging` 数组；
3. 两者都没有时返回字段为 `packCount` 的 400 错误；
4. `mapCustomerProduct` 返回第一个有效包装的 `packCount`，同时保留 `packaging` 以便旧订单编辑和旧前端调用读取。

- [ ] **步骤 4：只更新四字段且不清空旧扩展字段**

在 `saveCustomerProduct()` 中：

- 新产品用 `packaging_json = [{ name: '', packCount }]` 保存；
- 编辑已有产品只更新 `name`、`sku`、`specification`、默认包装装箱数和 `updated_at`；
- 不把未暴露的旧 `remark` 改为空，不删除旧包装数组中的其他记录；
- 读取时优先使用第一个有效包装装箱数，没有有效值时返回 `1`，保存时要求用户明确传入正整数。

- [ ] **步骤 5：运行服务器测试确认通过**

运行：`npm run test -- tests/server/order-enhancements.test.ts tests/server/products.test.ts`

预期：四字段创建/编辑、历史客户产品兼容、订单号/来源/合同和系统产品测试全部 PASS。

---

### 任务 5：更新前端 API 类型和数据映射

**文件：**
- 修改：`src/client/api.ts`
- 修改：`src/client/App.tsx`
- 修改：`src/client/components/OrderForm.tsx`
- 修改：`src/client/components/ProductEditor.tsx`
- 修改：`src/client/components/ProductDetailModal.tsx`
- 修改：`src/client/pages/ProductsPage.tsx`

- [ ] **步骤 1：先固定前端类型边界**

在 `OrderForm.tsx` 中把客户产品模型改为：

```ts
export interface CustomerProduct {
  id: string;
  name: string;
  sku: string;
  specification: string;
  packCount: number;
}

export interface PackagingOption {
  id: string;
  name: string;
  innerSize: string;
  innerWeight: string;
  outerSize: string;
  outerWeight: string;
  packSize: number;
  length?: string;
  width?: string;
  height?: string;
}
```

旧长宽高设为可选，仅用于读取历史产品；新编辑器只使用新字段。`ProductRecord` 不再继承客户产品包装字段，而是明确包含 `packaging: PackagingOption[]` 和系统产品字段。

- [ ] **步骤 2：更新 `api.ts` 映射和请求**

实现以下规则：

- `asPackaging()` 优先读取 `innerSize`、`innerWeight`、`outerSize`、`outerWeight`，没有新尺寸时把旧长宽高组合到 `outerSize`；
- `mapProduct()` 返回四字段 `CustomerProduct`，从第一个包装取 `packCount`；
- `mapProductRecord()` 返回系统产品完整结构；
- `draftToInput()` 的 `orderedAt` 直接使用 `draft.orderedAt.slice(0, 10)`，不调用 `new Date(...).toISOString()`；
- `packagingToInput()` 发送新字段，并在可解析三段尺寸时发送旧长宽高兼容值；
- `saveCustomerProduct()`、`updateCustomerProduct()` 只发送 `{ name, sku, specification, packCount }`，并将响应映射成 `CustomerProduct`；
- `productToInput()` 继续发送系统产品的参数、分类、采购价、供应商、颜色、电池插脚、配件、备注、图片关联和多行包装。

- [ ] **步骤 3：更新 App 的历史数据日期和客户产品保存返回值**

在 `mapOrderDetail()` 将 `orderedAt` 截取为前 10 位。修改 `saveCustomerRecord()` 签名为：

```ts
const saveCustomerRecord = async (draft: CustomerProduct): Promise<CustomerProduct> => {
  const saved = /^\d+$/.test(draft.id)
    ? await updateCustomerProduct(draft.id, draft)
    : await saveCustomerProduct(draft);
  await loadCustomerProducts();
  notify('客户产品已保存', 'success');
  return saved;
};
```

失败时继续通知并重新抛出错误，使订单内新品弹窗能够保留内容并显示失败状态。

- [ ] **步骤 4：运行类型检查确认模型改动暴露全部编译点**

运行：`npm run typecheck`

预期：若仍有旧的 `product.packaging`、`row.length` 或旧客户产品字段引用，TypeScript 会准确列出待改文件；修正所有引用后再次运行，任务 5 的类型检查 PASS。

---

### 任务 6：创建客户产品专用编辑器并改造客户产品页

**文件：**
- 创建：`src/client/components/CustomerProductEditor.tsx`
- 修改：`src/client/pages/CustomerProductsPage.tsx`
- 修改：`src/client/App.tsx`

- [ ] **步骤 1：编写编辑器所需的行为测试数据约束**

由于当前前端测试未配置 React Testing Library，本任务先用类型检查和人工可操作验收固定行为：编辑器 `onSave` 的入参必须只含 `id`、`name`、`sku`、`specification`、`packCount`；`packCount` 通过 `Math.max(1, Math.trunc(Number(value) || 1))` 保存为正整数。

- [ ] **步骤 2：实现四字段 `CustomerProductEditor`**

组件使用现有 `Modal`，props 定义为：

```ts
export interface CustomerProductEditorProps {
  open: boolean;
  product?: CustomerProduct;
  onClose: () => void;
  onSave: (product: CustomerProduct) => Promise<void> | void;
}
```

界面只渲染四个输入框：品名、SKU、规格、装箱数；底部按钮为取消和保存。保存前检查品名非空、装箱数为正整数；保存异常时在弹窗内显示错误，不关闭弹窗，不清空用户填写内容。弹窗不导入 `PackagingTable`、图片、颜色、插脚、分类、价格、供应商、参数、配件或备注。

- [ ] **步骤 3：改造 `CustomerProductsPage`**

将 props 的 `products` 改为 `CustomerProduct[]`，删除对 `ProductEditor` 的依赖。列表列固定为：品名、SKU、规格、装箱数、操作；删除“包装方案”和“备注”列。新增和编辑都使用 `CustomerProductEditor`，删除前保留现有确认提示。

- [ ] **步骤 4：连接 App 保存函数并运行类型检查**

将 `App.tsx` 中客户产品页的类型转换去掉，直接传 `customerProducts`；系统产品页继续使用 `ProductRecord[]`。运行：`npm run typecheck`。

预期：客户产品页只出现四个维护字段，系统产品页原有完整产品功能不受影响，类型检查 PASS。

---

### 任务 7：实现订单内直接添加新品和箱数实时计算

**文件：**
- 修改：`src/client/components/ProductPicker.tsx`
- 修改：`src/client/components/OrderForm.tsx`
- 修改：`src/client/pages/OrdersPage.tsx`
- 修改：`src/client/App.tsx`
- 修改：`tests/unit/order-calculations.test.ts`

- [ ] **步骤 1：扩展 ProductPicker 的新品回调**

将 props 增加：

```ts
onAddNew?: () => void;
```

无匹配时渲染提示和按钮：

```tsx
{!products.length && (
  <div>
    <div>没有匹配产品</div>
    {onAddNew && <button type="button" onClick={onAddNew}>添加新品</button>}
  </div>
)}
```

按钮必须可获得焦点、可点击，且不触发表单提交。

- [ ] **步骤 2：在 OrderForm 内复用新品弹窗流程**

将 `onCreateCustomerProduct` 替换为：

```ts
onSaveCustomerProduct?: (product: CustomerProduct) => Promise<CustomerProduct | undefined>;
```

OrderForm 增加 `customerProductEditorOpen` 和 `newProductDraft` 状态；顶部“添加新品”和 ProductPicker 的“添加新品”都调用 `openNewProduct(query)`。搜索词只填入品名初始值，不填入 SKU。保存成功后执行：

```ts
const saved = await onSaveCustomerProduct?.(product);
if (saved) {
  selectProduct(saved);
  setCustomerProductEditorOpen(false);
}
```

保存失败时保持弹窗内容和错误信息，不把失败产品加入订单。

- [ ] **步骤 3：将订单行箱数统一接入纯函数**

`makeItem(product)` 使用 `product.packCount`；`updateItem` 在数量或装箱数变化时调用 `calculateOrderBoxes(nextQuantity, nextPackSize)`；输入值只能是正整数；箱数显示为只读文本，不允许直接编辑。

新订单默认日期调用 `dateInputValue()`；编辑订单调用 `dateOnlyValue(value.orderedAt)`；控件改为：

```tsx
<input type="date" value={draft.orderedAt} onChange={(event) => update('orderedAt', event.target.value)} />
```

- [ ] **步骤 4：连接 OrdersPage 和 App 的新增客户产品回调**

`OrdersPageProps` 增加：

```ts
onSaveCustomerProduct?: (product: CustomerProduct) => Promise<CustomerProduct | undefined>;
```

在 `OrderForm` 上透传该回调。`App.tsx` 将 `saveCustomerRecord` 包装为失败时通知并返回 `undefined`、成功时返回保存后的 `CustomerProduct` 的函数。

- [ ] **步骤 5：运行前端类型检查**

运行：`npm run typecheck`

预期：订单新建表单、客户产品页、系统产品页和箱唛组件全部通过类型检查。

- [ ] **步骤 6：人工浏览器验收订单内新品流程**

运行：`npm run dev`，打开订单页并验证：

1. 下单时间输入框只显示日期；
2. 搜索不存在的品名时出现“添加新品”按钮；
3. 保存新品后产品库刷新，新产品自动进入当前订单明细；
4. 数量 100、装箱数 24 显示 5 箱；修改数量或装箱数后箱数即时变化；
5. 订单可以添加多行产品，且同品名不同规格仍显示为不同选项。

---

### 任务 8：改造系统产品包装表和产品详情展示

**文件：**
- 修改：`src/client/components/PackagingTable.tsx`
- 修改：`src/client/components/ProductEditor.tsx`
- 修改：`src/client/components/ProductDetailModal.tsx`
- 修改：`src/client/pages/ProductsPage.tsx`

- [ ] **步骤 1：先固定包装表字段回归检查**

运行现有类型检查确认改造前基线：`npm run typecheck`。

记录需要消除的旧控件引用：`外箱长度`、`外箱宽度`、`外箱高度`。新表格不得再渲染这三个独立输入框。

- [ ] **步骤 2：实现包装表新字段**

将每行结构改为：

```tsx
['包装名称', '内盒尺寸', '内盒重量', '外箱尺寸', '外箱重量', '外箱装箱数', '']
```

新增行默认值：

```ts
{
  id: `pack-${Date.now()}`,
  name: '彩盒包装',
  innerSize: '',
  innerWeight: '',
  outerSize: '',
  outerWeight: '',
  packSize: 1,
}
```

尺寸控件各自只有一个文本输入框，placeholder 使用 `35×28×20cm`；重量为非负数字文本/数字输入；外箱装箱数为最小值 1 的整数输入。保留添加多行和删除行能力。

- [ ] **步骤 3：更新系统产品编辑器默认值和详情摘要**

`ProductEditor.blankProduct()` 和产品列表编辑回显使用新字段。`ProductDetailModal` 每种包装一行展示：

```text
彩盒包装 · 内盒 35×28×20cm / 0.8kg · 外箱 40×30×25cm / 1.2kg / 24个
```

没有新尺寸时调用兼容后的 `outerSize`；旧数据仍然能在详情弹窗中显示组合后的外箱尺寸。

- [ ] **步骤 4：运行类型检查和构建**

运行：`npm run typecheck && npm run build`

预期：系统产品编辑器可以添加多行包装，每行同时填写内盒和外箱信息；构建产物生成成功。

---

### 任务 9：订单日期后端规范化和订单箱数回归

**文件：**
- 创建：`src/server/services/order-date.ts`
- 修改：`src/server/routes/orders.ts`
- 修改：`src/server/services/order-service.ts`
- 修改：`tests/server/order-enhancements.test.ts`

- [ ] **步骤 1：先增加日期接口测试**

在订单增强测试中增加：

```ts
it('新订单保存 YYYY-MM-DD，编辑历史 ISO 日期时保存日期部分', async () => {
  const { app, database } = await makeContext();
  const created = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({ orderedAt: '2026-08-11' }) });
  expect(created.statusCode).toBe(201);
  expect(created.json().data.ordered_at).toBe('2026-08-11');

  const updated = await app.inject({ method: 'PUT', url: `/api/orders/${created.json().data.id}`, payload: orderInput({ orderNo: created.json().data.order_no, orderedAt: '2026-08-12T08:00:00.000Z' }) });
  expect(updated.statusCode).toBe(200);
  expect(updated.json().data.ordered_at).toBe('2026-08-12');

  const invalid = await app.inject({ method: 'POST', url: '/api/orders', payload: orderInput({ orderedAt: '2026-02-30' }) });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json().error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'orderedAt' });
  database.close();
});
```

另增加订单明细数量 100、装箱数 24 的详情断言，确认自动箱唛总箱数为 5；两行产品的总箱数等于各自 `ceil` 结果之和。

- [ ] **步骤 2：运行订单测试确认日期测试失败**

运行：`npm run test -- tests/server/order-enhancements.test.ts`

预期：现有服务保存 ISO 原值，且 `2026-02-30` 会被 JavaScript 宽松日期解析接受或错误信息不带 `orderedAt` 字段。

- [ ] **步骤 3：实现严格日期规范化**

在 `src/server/services/order-date.ts` 实现：

```ts
export function normalizeOrderDate(value: string): string {
  const text = value.trim();
  const datePart = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : /^(\d{4}-\d{2}-\d{2})T/.exec(text)?.[1] ?? '';
  if (!datePart || !isValidCalendarDate(datePart)) throw new Error('下单时间无效');
  return datePart;
}
```

`isValidCalendarDate` 使用 UTC 构造后反向比较年、月、日，拒绝 2 月 30 日、13 月和 0 日；不接受只有时间、带时区但没有日期、`MM/DD/YYYY` 等格式。

- [ ] **步骤 4：在路由和服务层应用规范化**

`parseOrderInput` 读取必填文本后调用 `normalizeOrderDate`；捕获错误时返回 `new ApiError(400, 'VALIDATION_ERROR', '下单时间无效', 'orderedAt')`。`OrderService.create` 和 `update` 再次调用同一函数，确保非 HTTP 调用也只会把日期部分交给仓储层。

订单号编辑的非空校验保持不变；合同、付款凭证、来源类型、订单状态和箱唛历史逻辑不改动。

- [ ] **步骤 5：运行订单和状态回归测试**

运行：`npm run test -- tests/server/order-enhancements.test.ts tests/unit/status.test.ts tests/unit/packing.test.ts`

预期：日期、订单号、客户来源、合同、状态流转、自动装箱和手动合箱测试全部 PASS。

---

### 任务 10：整体验收、兼容性和回归检查

**文件：**
- 修改：`tests/server/database.test.ts`
- 修改：`tests/server/products.test.ts`
- 修改：`tests/server/order-enhancements.test.ts`
- 复核：`src/client/api.ts`
- 复核：`src/client/App.tsx`
- 复核：`src/client/components/OrderForm.tsx`
- 复核：`src/client/components/CustomerProductEditor.tsx`
- 复核：`src/client/components/PackagingTable.tsx`

- [ ] **步骤 1：运行完整单元和服务器测试**

运行：`npm run test`

预期：所有 Vitest 测试 PASS，包含报价单、开单、公司资料、附件、备份、订单、产品、包装和状态回归。

- [ ] **步骤 2：运行类型检查和构建**

运行：`npm run typecheck && npm run build`

预期：客户端和服务器 TypeScript 均无错误，Vite 构建成功。

- [ ] **步骤 3：执行 diff 格式检查**

运行：`git diff --check`

预期：无空白错误。只检查当前改动，不重置其他历史未提交内容。

- [ ] **步骤 4：执行浏览器冒烟验收**

运行：`npm run dev`，逐项验证：

1. 新订单日期控件只显示 `YYYY-MM-DD`，保存后列表不出现时分秒；
2. 客户产品页的添加/编辑弹窗只有品名、SKU、规格、装箱数；
3. 订单产品搜索无结果时可点“添加新品”，保存后自动加入当前订单；
4. 同品名不同规格可以同时存在并分别选择；
5. 数量 100、装箱数 24 的订单行显示 5 箱；
6. 系统产品包装可添加“彩盒包装”“塑像包装”等多行，每行可录入内盒尺寸/重量和外箱尺寸/重量/装箱数；
7. 旧产品的长宽高数据能组合为外箱尺寸，任意文本尺寸原样保留；
8. 已有订单、箱唛编辑/打印、打印历史、备货状态、发货、报价单和开单页面能正常打开。

- [ ] **步骤 5：完成前的规格覆盖检查**

逐项确认：

- 日期只精确到天且新建订单没有时区偏移；
- 客户产品只维护四字段，历史扩展字段不被清空；
- 无匹配产品可在订单内保存并自动加入新品；
- 订单明细允许调整本单装箱数，箱数使用向上取整；
- 系统产品包装每种一行，内盒/外箱尺寸各为一个文本框；
- schema version 为 5，旧数据库迁移幂等，`data/` 未被修改；
- 旧包装字段、历史订单、箱唛和现有文档模块均通过回归测试。

完成上述检查后，将结果和实际改动文件列表反馈给用户；不执行 Git commit，除非用户另行要求。

