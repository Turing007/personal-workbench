# 个人工作台网页版实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 `C:\Users\gaofu\Documents\个人工作台` 创建一个仅供本机浏览器访问的轻量订单工作台，覆盖客户产品库、订单录入、自动/手动装箱、10×10cm 箱唛打印、备货与打包状态、发货批次、物流单号回填以及完整备份恢复。

**架构：** 使用一个 Node.js/Fastify 进程承载 SQLite 数据库、文件上传、业务 API 和生产环境构建后的 React 静态资源。开发环境由 Vite 提供前端热更新，前端通过明确的 `/api` 边界访问后端；后端只绑定 `127.0.0.1`，不开放局域网访问。订单明细、箱唛内容和打印记录使用快照字段，产品库后续修改不影响历史订单。

**技术栈：** React + Vite + TypeScript、Node.js 24 内置 `node:sqlite`、Fastify、Vitest、Playwright、普通 CSS、`@fastify/multipart`、`@fastify/static`、`archiver`/`unzipper`。

---

## 文件清单与职责

### 工程根目录

- 创建：`C:\Users\gaofu\Documents\个人工作台\package.json` — npm 脚本和依赖。
- 创建：`C:\Users\gaofu\Documents\个人工作台\tsconfig.json` — 共享 TypeScript 编译约束。
- 创建：`C:\Users\gaofu\Documents\个人工作台\tsconfig.server.json` — 后端构建配置。
- 创建：`C:\Users\gaofu\Documents\个人工作台\vite.config.ts` — Vite 开发代理和构建配置。
- 创建：`C:\Users\gaofu\Documents\个人工作台\vitest.config.ts` — 单元/接口测试配置。
- 创建：`C:\Users\gaofu\Documents\个人工作台\playwright.config.ts` — 浏览器验收测试配置。
- 创建：`C:\Users\gaofu\Documents\个人工作台\.gitignore` — 数据库、附件、备份、构建产物和环境文件忽略规则。
- 创建：`C:\Users\gaofu\Documents\个人工作台\启动个人工作台.bat` — 检查 Node、启动生产服务、健康检查后打开默认浏览器。
- 创建：`C:\Users\gaofu\Documents\个人工作台\停止个人工作台.bat` — 按项目 PID 安全停止服务。

### 共享领域层

- 创建：`C:\Users\gaofu\Documents\个人工作台\src\shared\domain.ts` — 订单状态、产品、包装方式、订单、箱唛、发货批次和错误响应类型。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\shared\packing.ts` — 纯函数自动装箱、手动合箱校验和箱号重排。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\shared\formatters.ts` — 日期、金额、发货文本和显示标签格式化。

### 后端

- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\config.ts` — 本机端口、数据目录、附件限制和运行环境配置。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\db\connection.ts` — `node:sqlite` 连接、WAL、外键和事务封装。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\db\migrate.ts` — 建表、索引和默认设置初始化。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\db\repositories.ts` — 产品、客户产品、订单、箱唛、打印、发货和备份所需的数据库读写。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\files\file-store.ts` — 图片/付款凭证安全写入、删除和路径解析。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\backup\backup-service.ts` — 备份包创建、预览、校验、恢复和失败回滚。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\services\order-service.ts` — 订单事务保存、产品快照和状态推进。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\services\label-service.ts` — 箱唛生成、逐箱编辑、合箱和打印历史。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\services\shipping-service.ts` — 发货批次、发货表文本、物流号校验和确认发货。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\health.ts` — `GET /health`。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\products.ts` — 系统产品库和产品图片接口。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\customer-products.ts` — 客户产品库接口。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\orders.ts` — 订单列表、保存、详情、状态推进和订单付款凭证接口。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\labels.ts` — 箱唛查询、编辑、合箱和打印历史接口。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\shipping.ts` — 发货管理接口。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\backups.ts` — 备份和恢复接口。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\app.ts` — Fastify 实例、插件、路由注册、静态资源和统一错误处理。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\main.ts` — 初始化数据目录/数据库并启动本机服务。

### 前端

- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\main.tsx` — React 入口。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\App.tsx` — 侧边栏路由和页面容器，默认订单管理。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\api.ts` — 类型安全的 `/api` 请求封装、错误转换和上传封装。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\styles\tokens.css` — 颜色、间距、字体、边框和 10×10cm 打印变量。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\styles\app.css` — 紧凑桌面布局、表格、弹窗、空状态和响应式规则。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\Sidebar.tsx` — 紧凑侧边栏。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\StatusCards.tsx` — 单行状态卡和筛选回调。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\Modal.tsx` — 可复用弹窗、焦点回收和 Esc 关闭。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\Toast.tsx` — 成功、警告、错误消息。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\ImagePasteUpload.tsx` — 图片上传和 Ctrl+V 粘贴。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\PackagingTable.tsx` — 多包装方式编辑表格。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\ProductPicker.tsx` — 客户产品库左右分栏筛选和调用。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\OrderForm.tsx` — 基础信息、付款凭证、产品明细和保存。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\OrderDetailModal.tsx` — 紧凑订单详情弹窗。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\LabelEditorModal.tsx` — 仅显示箱唛相关字段的逐箱编辑和手动合箱。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\PrintWorkspace.tsx` — 多订单批量箱唛工作区、打印 CSS 和浏览器打印调用。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\ShippingBatchPanel.tsx` — 发货批次、物流号回填和发货文本。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\pages\OrdersPage.tsx` — 订单列表、搜索、状态卡、多选和弹窗入口。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\pages\ProductsPage.tsx` — 系统产品库 CRUD、图片和包装。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\pages\CustomerProductsPage.tsx` — 客户产品库 CRUD。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\pages\ShippingPage.tsx` — 发货管理左右工作区。
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\pages\SettingsPage.tsx` — 备份、恢复和本机运行信息。

### 测试

- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\unit\packing.test.ts` — 自动装箱和手动合箱纯函数测试。
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\unit\status.test.ts` — 状态推进规则测试。
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\unit\shipping-text.test.ts` — 发货表仅包含总箱数和收件信息的测试。
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\unit\label.test.ts` — 箱唛字段和快照测试。
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\server\orders.test.ts` — 订单号唯一、多行产品事务和付款凭证接口测试。
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\server\shipping.test.ts` — 发货批次、物流号和确认发货接口测试。
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\server\backup.test.ts` — 备份预览、附件恢复和失败回滚测试。
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\e2e\workbench.spec.ts` — Playwright 关键页面验收。

---

## 任务 1：初始化可运行工程和质量门禁

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\package.json`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tsconfig.json`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tsconfig.server.json`
- 创建：`C:\Users\gaofu\Documents\个人工作台\vite.config.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\vitest.config.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\playwright.config.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\.gitignore`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\main.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\App.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\styles\tokens.css`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\styles\app.css`

- [ ] **步骤 1：写入依赖和脚本配置**

在 `package.json` 固定以下脚本，避免开发和生产启动方式漂移：

```json
{
  "scripts": {
    "dev": "concurrently -k \"vite --host 127.0.0.1\" \"tsx src/server/main.ts\"",
    "build": "tsc -p tsconfig.server.json && vite build",
    "start": "node dist/server/main.js",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.server.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

安装 `react`、`react-dom`、`fastify`、`better-sqlite3`、`@fastify/multipart`、`@fastify/static`、`archiver`、`unzipper`、`zod`、`lucide-react`，以及 `vite`、`typescript`、`tsx`、`concurrently`、`vitest`、`@playwright/test` 和 React 类型包。

- [ ] **步骤 2：创建最小 React 壳和类型检查失败基线**

让 `App.tsx` 暂时渲染一个带“订单管理”文本的页面，`main.tsx` 挂载到 `#root`；运行：

```powershell
npm install
npm run typecheck
npm run build
```

预期：当前工程通过类型检查和前端构建，后端入口尚未提供时只允许把 `build` 的后端输出配置为可编译空入口，不能用 `any` 绕过类型检查。

- [ ] **步骤 3：建立数据目录和 Git 初始提交**

创建 `.gitignore` 忽略 `node_modules/`、`dist/`、`data/workbench.sqlite`、`data/files/`、`data/backups/`、`.env*` 和 Playwright 报告；当前目录尚无 Git 仓库，执行：

```powershell
git init
git add package.json package-lock.json tsconfig.json tsconfig.server.json vite.config.ts vitest.config.ts playwright.config.ts .gitignore src
git commit -m "chore: initialize local web workbench"
```

预期：提交只包含工程源代码和配置，不包含空数据库、附件或备份。

## 任务 2：定义共享领域模型和纯函数装箱引擎

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\shared\domain.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\shared\packing.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\shared\formatters.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\unit\packing.test.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\unit\status.test.ts`

- [ ] **步骤 1：先写失败的装箱测试**

在 `packing.test.ts` 覆盖 100 个、装箱数 `[12, 24]` 产生 `24×4 + 4`；覆盖多规格各自装箱；覆盖数量为 0、负数和非整数抛出 `PackingError`；覆盖同一订单内两个相同 SKU/规格的尾箱可以合并而不同规格不能合并。

```ts
expect(autoPack({ quantity: 100, packSizes: [12, 24] }).map((b) => b.quantity))
  .toEqual([24, 24, 24, 24, 4]);
expect(() => autoPack({ quantity: 0, packSizes: [12] })).toThrow(PackingError);
expect(canMergeBoxes([boxA, boxB])).toBe(true);
expect(canMergeBoxes([boxA, differentSpecBox])).toBe(false);
```

运行 `npx vitest run tests/unit/packing.test.ts`，预期：FAIL，因为装箱函数尚未创建。

- [ ] **步骤 2：实现共享类型和最少装箱算法**

在 `domain.ts` 定义 `OrderStatus`、`PackagingOption`、`CustomerProductSnapshot`、`OrderItemSnapshot`、`CartonLabel` 和 `CartonLabelItem`；在 `packing.ts` 实现：

```ts
export function autoPack(input: PackInput): PackedBox[];
export function mergeBoxes(boxes: PackedBox[]): PackedBox[];
export function renumberBoxes(boxes: PackedBox[]): PackedBox[];
```

算法先按降序装入最大装箱数，再用次大箱规填补余数；每个箱保留产品名、SKU、规格、装箱数、当前箱数量和来源订单行快照。合箱只允许同一订单内相同 SKU 且规格完全相同的箱，超过箱规时继续拆箱，最后统一重排箱号。

- [ ] **步骤 3：实现状态推进纯函数并补测试**

在 `domain.ts` 导出固定状态顺序和 `canTransition(from, to, context)`：只允许相邻前进；“待打印箱唛”到“待备货”只能由首次打印预览动作触发；“待备货”到“已备货”、“已备货”到“待打包”、“待打包”到“待发货”必须由用户明确点击；“待发货”到“已发货”必须同时满足物流单号非空。测试非法跳跃、已备货不自动变更和缺物流号均返回可读错误。

- [ ] **步骤 4：运行纯函数测试并提交**

运行：`npx vitest run tests/unit/packing.test.ts tests/unit/status.test.ts`，预期全部 PASS；然后提交：

```powershell
git add src/shared tests/unit/packing.test.ts tests/unit/status.test.ts
git commit -m "feat: add order domain and packing engine"
```

## 任务 3：建立 SQLite 数据库和文件存储基础

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\config.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\db\connection.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\db\migrate.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\db\repositories.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\files\file-store.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\server\database.test.ts`

- [ ] **步骤 1：写数据库迁移测试**

使用临时目录创建数据库，验证迁移后存在 `products`、`product_packaging`、`product_images`、`customer_products`、`orders`、`order_items`、`order_item_box_sizes`、`carton_labels`、`carton_label_items`、`payment_proofs`、`print_histories`、`print_history_labels`、`shipments`、`shipment_batches`、`shipment_batch_orders`、`settings`，并验证 `orders.order_no` 唯一索引和外键开启。

- [ ] **步骤 2：实现 SQLite 连接和迁移**

在 `connection.ts` 使用 Node 24 的 `DatabaseSync` 设置 `PRAGMA foreign_keys = ON`、`PRAGMA journal_mode = WAL`，提供 `withTransaction<T>(fn)`；在 `migrate.ts` 建立所有表。订单表使用 `status`、`recipient_name`、`recipient_info`、`amount`、`tracking_no`、`payment_note`、`remark`、时间字段；订单明细保存产品快照，箱唛表保存订单/箱号/总箱数和手动编辑标记，发货批次表保存草稿和确认时间。

- [ ] **步骤 3：实现附件存储并测试路径安全**

`file-store.ts` 提供：

```ts
saveImage(stream: NodeJS.ReadableStream, kind: "product" | "payment", originalName: string, mime: string): Promise<StoredFile>;
deleteFile(relativePath: string): Promise<void>;
resolvePublicPath(relativePath: string): string;
```

只接受 `image/png`、`image/jpeg`、`image/webp`，单文件限制 10MB；文件名使用随机 ID 加白名单扩展名，拒绝 `..`、绝对路径和非目标目录路径。测试非法 MIME、超限和路径穿越。

- [ ] **步骤 4：实现 repositories 并运行测试**

按模块提供明确方法：`listProducts`、`saveProduct`、`deleteProduct`、`listCustomerProducts`、`saveCustomerProduct`、`createOrder`、`listOrders`、`getOrderDetail`、`saveCartonLabels`、`recordPrintHistory`、`createShipmentBatch`、`confirmShipment`。所有订单保存通过一个事务同时写订单、明细、包装快照和自动箱唛。

运行：`npx vitest run tests/server/database.test.ts`，预期 PASS；提交：

```powershell
git add src/server/config.ts src/server/db src/server/files tests/server/database.test.ts
git commit -m "feat: add sqlite persistence and file storage"
```

## 任务 4：实现产品库与客户产品库 API

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\products.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\customer-products.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\server\products.test.ts`

- [ ] **步骤 1：写失败的 CRUD 和筛选测试**

用 Fastify `app.inject` 验证系统产品和客户产品分别可新增、查询、修改、删除；按品名、SKU、规格进行包含匹配；相同品名不同规格能同时存在；客户产品新增不要求系统产品存在；空品名、空规格、非正整数装箱数返回 400。

- [ ] **步骤 2：实现产品 API**

`products.ts` 接受 JSON 产品数据和 multipart 图片上传；包装数组每行保存 `name`、`outerLength`、`outerWidth`、`outerHeight`、`outerWeight`、`packCount`；颜色默认 `蓝/红/黄`，电池插脚默认 `牧田/德伟/米沃奇`，前端可追加自定义值。系统产品删除采用“有历史引用时保留记录、标记不可用”的策略，不删除订单快照或附件。

- [ ] **步骤 3：实现客户产品 API**

客户产品独立维护同样的品名、SKU、规格和包装列表；`GET /api/customer-products?q=&name=&sku=&spec=&page=&pageSize=` 返回稳定排序的筛选结果；新品保存成功后返回完整记录，供订单录入立即调用。

- [ ] **步骤 4：运行接口测试并提交**

运行：`npx vitest run tests/server/products.test.ts`，预期 PASS；提交：

```powershell
git add src/server/routes/products.ts src/server/routes/customer-products.ts tests/server/products.test.ts
git commit -m "feat: add product catalog apis"
```

## 任务 5：实现订单 API、付款凭证和状态推进

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\services\order-service.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\orders.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\server\orders.test.ts`

- [ ] **步骤 1：写失败的订单保存测试**

测试手动订单号必填且唯一；订单没有产品、数量不是正整数、客户产品包装不存在时拒绝保存；同一订单可保存多行产品；保存后产品名称、SKU、规格、包装名称和装箱数是快照；修改客户产品后历史订单详情不变。

- [ ] **步骤 2：实现订单创建和详情服务**

定义 `CreateOrderInput`，在事务中校验基础信息、逐行校验包装方案，复制客户产品快照，调用 `autoPack` 生成箱唛和 `carton_label_items`；新订单初始状态固定为“待打印箱唛”。订单号唯一冲突映射为 `{ code: "ORDER_NO_EXISTS", field: "orderNo" }`。

- [ ] **步骤 3：实现订单列表、搜索和详情路由**

实现 `GET /api/orders?status=&q=&page=&pageSize=`，搜索订单号、客户来源、收件人、品名、SKU、规格，按 `created_at DESC, id DESC` 稳定排序；实现 `POST /api/orders`、`PUT /api/orders/:id`、`GET /api/orders/:id/detail`。

- [ ] **步骤 4：实现状态推进路由**

实现 `POST /api/orders/:id/status`，请求体为 `{ "to": OrderStatus, "reason": "manual|first-print" }`；仅 `first-print` 可触发“待打印箱唛”到“待备货”，其他状态只接受相邻手动推进；接口不得因“已备货”自动修改到待打包/待发货。

- [ ] **步骤 5：实现付款凭证上传、粘贴和删除接口**

使用 multipart 保存图片及每张图片的 `note`；接口 `POST /api/orders/:id/payment-proofs`、`DELETE /api/payment-proofs/:id` 返回凭证相对路径、原始文件名、备注和时间。上传失败时先删除临时文件，不写入数据库；删除凭证时同步删除附件。

- [ ] **步骤 6：运行订单测试并提交**

运行：`npx vitest run tests/server/orders.test.ts`，预期 PASS；提交：

```powershell
git add src/server/services/order-service.ts src/server/routes/orders.ts tests/server/orders.test.ts
git commit -m "feat: add order workflow api"
```

## 任务 6：实现前端基础壳、订单列表和新建订单

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\api.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\Sidebar.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\StatusCards.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\Modal.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\Toast.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\ImagePasteUpload.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\PackagingTable.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\ProductPicker.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\OrderForm.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\OrderDetailModal.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\pages\OrdersPage.tsx`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\App.tsx`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\styles\app.css`

- [ ] **步骤 1：写前端 API 类型和错误测试**

让 `api.ts` 提供 `getOrders`、`saveOrder`、`getOrderDetail`、`advanceOrderStatus`、`uploadPaymentProof` 等函数；错误统一转换为 `{ code, message, field? }`。测试 400/500 响应不会被当成成功。

- [ ] **步骤 2：实现紧凑侧边栏和状态卡**

`App.tsx` 只保留“订单管理、产品库、客户产品库、发货管理、设置”五个入口，默认订单管理；`StatusCards.tsx` 使用横向不换行布局，点击卡片调用 `onStatusChange(status)`，不显示独立大标题和描述区域。

- [ ] **步骤 3：实现订单列表筛选和多选状态**

`OrdersPage.tsx` 管理 `status`、`query`、分页和 `selectedIds`；表格显示订单号、下单时间、客户来源、收件人、总箱数、订单金额、订单状态、物流单号和操作；勾选后显示批量打印、批量推进状态、加入发货批次按钮。

- [ ] **步骤 4：实现新建订单弹窗**

`OrderForm.tsx` 保存手动订单号、下单时间、客户来源、单一多行收件信息、收件人名称、金额、发货单号、备注和多行产品；`ProductPicker.tsx` 左侧按品名/SKU/规格筛选客户产品，右侧显示已选行、包装方案、数量和自动箱数；筛选无结果时在同一弹窗添加客户新品。

- [ ] **步骤 5：实现付款凭证粘贴**

`ImagePasteUpload.tsx` 仅在凭证区域监听 `paste`，读取 `clipboardData.items` 中的图片，生成文件后立即展示缩略图和该凭证独立备注；上传按钮同时支持文件选择，错误提示明确到格式或大小。

- [ ] **步骤 6：实现详情弹窗和前端验证**

`OrderDetailModal.tsx` 以弹窗展示基础信息、产品快照、箱数、付款凭证、物流号、状态和备注；保存前在前端拦截订单号为空、产品为空、数量非正整数，后端错误按字段定位输入框；运行 `npm run typecheck` 和 `npm run build`，预期 PASS。

- [ ] **步骤 7：提交订单页面**

```powershell
git add src/client
git commit -m "feat: add compact order management ui"
```

## 任务 7：实现产品库和客户产品库页面

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\ProductEditor.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\pages\ProductsPage.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\pages\CustomerProductsPage.tsx`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\App.tsx`
- 修改：`C:\Users\gaofu\Documents\个人工作台\src\client\styles\app.css`

- [ ] **步骤 1：写产品编辑器测试**

使用 React Testing Library 验证核心输入框为“品名、SKU、规格、装箱数”，按钮顺序为“添加、修改、删除、清空”；清空只清空输入框，不删除数据库记录；多包装方式各自保存包装名称、外箱尺寸、重量和装箱数。

- [ ] **步骤 2：实现系统产品库页面**

列表支持品名/SKU/规格搜索；编辑区紧凑显示四个核心字段，图片、分类、采购价、供应商、颜色多选、电池插脚多选、包装表格和备注放入编辑弹窗；颜色预置蓝/红/黄，插脚预置牧田/德伟/米沃奇，新增值保留在表单中。

- [ ] **步骤 3：实现客户产品库页面**

复用包装表格和图片上传交互，但数据只访问 `/api/customer-products`；明确不把客户产品自动映射到系统产品，订单中使用客户产品快照。

- [ ] **步骤 4：完成页面检查并提交**

运行：`npm run typecheck`、`npm run build`、`npx vitest run tests/server/products.test.ts`；预期全部 PASS；提交：

```powershell
git add src/client/components/ProductEditor.tsx src/client/pages/ProductsPage.tsx src/client/pages/CustomerProductsPage.tsx src/client/App.tsx src/client/styles/app.css
git commit -m "feat: add product catalog pages"
```

## 任务 8：实现订单内箱唛编辑、手动合箱和批量打印

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\services\label-service.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\labels.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\LabelEditorModal.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\PrintWorkspace.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\unit\label.test.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\server\labels.test.ts`

- [ ] **步骤 1：写箱唛数据和打印状态测试**

测试箱唛只包含收件人名称、订单号、当前箱号/总箱数和当前箱实际 SKU/品名/规格/装箱数/箱数/总数；明确不包含客户来源、电话、地址、金额、付款凭证和内部备注。测试首次打印预览将待打印箱唛订单推进到待备货，重打不改变后续状态。

- [ ] **步骤 2：实现箱唛服务和接口**

实现 `GET /api/orders/:id/labels`、`PUT /api/carton-labels/:id`、`POST /api/carton-labels/merge` 和 `POST /api/labels/print-history`。合箱请求必须带同一订单的箱唛 ID；只允许相同 SKU 与规格的箱合并，超出选定装箱数时拆分，服务端重新编号并在事务中保存；打印历史保存完整箱唛快照。

- [ ] **步骤 3：实现紧凑箱唛编辑弹窗**

`LabelEditorModal.tsx` 只显示箱唛字段和箱内产品内容，提供逐箱修改、选择箱合并、恢复自动方案和保存；不显示客户来源、电话、地址、订单金额、付款凭证或内部备注。

- [ ] **步骤 4：实现 10×10cm 打印工作区**

`PrintWorkspace.tsx` 接收多个订单 ID，显示按订单分组的标签；使用 `@page { size: 10cm 10cm; margin: 0; }` 和每页 `.carton-label { width: 10cm; height: 10cm; break-after: page; }`，打印按钮先调用打印历史接口，再调用 `window.print()`；取消/重打不改变已完成状态。

- [ ] **步骤 5：接入订单管理批量打印和运行测试**

订单列表的“批量打印箱唛”只允许全选状态为“待打印箱唛”的订单，空选择和混合状态给出明确提示；后续状态订单从详情进入逐单重打。运行：

```powershell
npx vitest run tests/unit/label.test.ts tests/server/labels.test.ts
npm run typecheck
npm run build
```

预期全部 PASS；提交：

```powershell
git add src/server/services/label-service.ts src/server/routes/labels.ts src/client/components/LabelEditorModal.tsx src/client/components/PrintWorkspace.tsx src/client/pages/OrdersPage.tsx tests/unit/label.test.ts tests/server/labels.test.ts
git commit -m "feat: add carton label editor and printing"
```

## 任务 9：实现发货管理和发货批次

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\services\shipping-service.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\shipping.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\components\ShippingBatchPanel.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\pages\ShippingPage.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\unit\shipping-text.test.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\server\shipping.test.ts`

- [ ] **步骤 1：写失败的发货表和批次测试**

验证输入两笔订单后文本严格为每行 `总箱数 + 空格 + 收件信息`，不出现订单号、客户来源、产品、金额或付款信息；验证只有待发货订单能加入批次；物流号为空时确认接口返回 400；全部物流号存在时批次订单统一变为已发货并写入发货记录。

```ts
expect(formatShippingText([orderA, orderB])).toBe('6箱 张三\n3箱 李四');
expect(formatShippingText([orderA])).not.toContain(orderA.orderNo);
```

- [ ] **步骤 2：实现发货服务和接口**

实现 `GET /api/shipping/eligible-orders`、`POST /api/shipping/batches`、`PUT /api/shipping/batches/:id/orders/:orderId`、`GET /api/shipping/batches/:id/text`、`POST /api/shipping/batches/:id/confirm`；确认发货使用事务写 shipment、shipment batch order 和订单状态，任何一条失败整体回滚。

- [ ] **步骤 3：实现左右发货工作区**

左侧按待发货/已发货/全部筛选并多选订单，右侧显示当前草稿批次、总箱数、每单物流号输入、复制发货表和确认发货；不在发货表显示多余字段。

- [ ] **步骤 4：运行发货测试并提交**

运行：`npx vitest run tests/unit/shipping-text.test.ts tests/server/shipping.test.ts`，预期 PASS；提交：

```powershell
git add src/server/services/shipping-service.ts src/server/routes/shipping.ts src/client/components/ShippingBatchPanel.tsx src/client/pages/ShippingPage.tsx tests/unit/shipping-text.test.ts tests/server/shipping.test.ts
git commit -m "feat: add shipping batch workflow"
```

## 任务 10：实现备份恢复、静态资源服务和启动脚本

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\backup\backup-service.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\backups.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\routes\health.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\app.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\server\main.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\src\client\pages\SettingsPage.tsx`
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\server\backup.test.ts`
- 创建：`C:\Users\gaofu\Documents\个人工作台\启动个人工作台.bat`
- 创建：`C:\Users\gaofu\Documents\个人工作台\停止个人工作台.bat`

- [ ] **步骤 1：写备份失败回滚测试**

创建带产品图和付款凭证的临时数据库，验证备份包包含 `manifest.json`、数据库快照和两个附件目录；恢复后记录数量和附件内容一致；篡改 manifest 或数据库文件时恢复失败且当前数据库与附件不变化。

- [ ] **步骤 2：实现备份包服务**

`backup-service.ts` 使用版本化 zip 包，manifest 固定包含 `formatVersion: 1`、导出时间、数据库记录计数和附件清单；创建备份前执行 SQLite checkpoint；恢复前自动创建当前数据备份，解压到临时目录、校验 manifest、校验相对路径、以临时数据库通过迁移检查后原子替换数据库和附件。

- [ ] **步骤 3：实现 Fastify 应用和生产静态资源**

`app.ts` 注册 multipart、static 和所有 API 路由，统一将 Zod 校验错误映射为 400；静态资源仅在 `dist/client` 提供，未知非 API 路径返回 `index.html`；`main.ts` 监听 `127.0.0.1:52341`，先迁移数据库，再启动服务。

- [ ] **步骤 4：实现设置页面和启动/停止脚本**

设置页面显示数据目录、服务地址、创建备份、选择备份预览和恢复按钮；批处理脚本使用 `%~dp0` 定位项目目录、`where node` 检查 Node，写入 `.workbench.pid`，轮询 `http://127.0.0.1:52341/health` 成功后执行 `start "" http://127.0.0.1:52341/`；停止脚本读取并校验 PID 属于项目 Node 进程后停止，避免误杀其他 Node 服务。

- [ ] **步骤 5：运行备份和启动检查并提交**

运行：

```powershell
npx vitest run tests/server/backup.test.ts
npm run build
启动个人工作台.bat
```

预期：健康检查成功、默认浏览器打开订单管理、设置页能完成备份预览；再执行 `停止个人工作台.bat`，服务端口释放；提交：

```powershell
git add src/server/backup src/server/routes/health.ts src/server/routes/backups.ts src/server/app.ts src/server/main.ts src/client/pages/SettingsPage.tsx 启动个人工作台.bat 停止个人工作台.bat
git commit -m "feat: add backup and local startup"
```

## 任务 11：完成端到端验收和发布检查

**文件：**
- 创建：`C:\Users\gaofu\Documents\个人工作台\tests\e2e\workbench.spec.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\playwright.config.ts`
- 修改：`C:\Users\gaofu\Documents\个人工作台\README.md`

- [ ] **步骤 1：编写关键浏览器流程测试**

Playwright 覆盖：打开默认订单管理；状态卡点击筛选；新增客户产品；新建包含两行产品的订单；订单详情弹窗；箱唛编辑；批量勾选并打开打印工作区；推进“已备货”后断言仍不等于“待打包”；手动推进到待发货；发货批次生成并复制严格的两字段文本；补物流号后确认变为已发货。

- [ ] **步骤 2：运行所有质量门禁**

```powershell
npm run typecheck
npx vitest run
npm run build
npx playwright test
```

预期：类型检查、全部单元/接口测试、生产构建和浏览器验收均 PASS；失败时保留测试报告并修复后重新运行，不以跳过测试代替通过。

- [ ] **步骤 3：完成宽屏、弹窗、打印和附件检查**

在常用桌面宽度检查侧边栏和订单表格不出现无效大标题；检查订单详情与箱唛编辑弹窗不跳页；在浏览器打印预览中确认每张标签为 10×10cm、每页一张且箱唛不含电话/地址；检查 Ctrl+V 图片、文件格式/大小错误、空数据和备份恢复提示。

- [ ] **步骤 4：写使用说明并提交发布版本**

`README.md` 写明 Node.js 版本要求、`npm install`、`npm run dev`、`npm run build`、双击 `启动个人工作台.bat`、数据目录、备份恢复和打印设置；执行：

```powershell
git add README.md tests/e2e/workbench.spec.ts playwright.config.ts
git commit -m "test: verify complete workbench workflow"
git tag v1.0.0
```

---

## 规格覆盖自检

- 运行架构、仅本机访问和启动方式：任务 1、任务 10、任务 11。
- 紧凑侧边栏、默认订单页、单行状态卡和点击筛选：任务 6、任务 11。
- 产品库字段、多包装方式、颜色/电池插脚多选、图片：任务 4、任务 7。
- 客户产品库独立维护、品名/SKU/规格筛选、新品添加：任务 4、任务 6、任务 7。
- 多行订单、收件信息、订单号、金额、付款凭证 Ctrl+V 和凭证备注：任务 5、任务 6。
- 自动最优装箱、尾箱、手动合箱、逐箱快照：任务 2、任务 5、任务 8。
- 订单状态手动推进与“已备货”不自动跳转：任务 2、任务 5、任务 8、任务 11。
- 订单内箱唛编辑、批量打印、10×10cm、打印历史：任务 8、任务 11。
- 发货批次、仅“总箱数 + 收件信息”、物流号和确认发货：任务 9、任务 11。
- SQLite、附件目录、完整备份/恢复和失败回滚：任务 3、任务 10。
- 接口测试、单元测试、浏览器验收和运行说明：任务 2 至任务 11。

计划中的每个业务模块都有对应文件、测试、命令和提交边界；没有未定义的实现步骤。
