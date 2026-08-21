# 产品库编辑与图片多选复制实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 优化产品编辑器字段布局，并让产品图片弹窗支持多选复制及浏览器不支持时的批量下载兜底。

**架构：** 产品编辑器继续由 `ProductEditor` 管理草稿状态，只调整字段渲染顺序和新增/编辑 SKU 显示条件。图片弹窗由 `ProductImagesModal` 管理当前预览图和多选集合，复制时优先使用 Clipboard API；对不能写入多张图片的浏览器，提供所选图片的逐张下载入口。样式集中在现有 `app.css`，不引入新业务状态或后端接口。

**技术栈：** React 19、TypeScript、lucide-react、Vite、Vitest。

---

### 任务 1：调整产品编辑器字段布局

**文件：**
- 修改：`src/client/components/ProductEditor.tsx`

- [x] **步骤 1：隐藏新增产品的 SKU 输入**

使用已有的 `editingExisting` 判断，让 SKU 标签只在编辑已有产品时渲染；保存逻辑仍保留 `draft.sku`，由现有后端生成 `VT-0000`。

- [x] **步骤 2：调整字段顺序**

将首行字段改为 `品名`、`分类`、`规格`、`采购价`、`供应商`，并调整网格列数；保留原有字段绑定和样式。

- [x] **步骤 3：将配件和备注紧跟参数**

在参数字段之后渲染配件、备注；颜色、电池插脚、包装、图片继续置于后面。

- [x] **步骤 4：运行类型检查**

运行 `npm run typecheck`，预期通过。

### 任务 2：实现图片多选和复制降级

**文件：**
- 修改：`src/client/components/ProductImagesModal.tsx`
- 修改：`src/client/styles/app.css`

- [x] **步骤 1：用选中 ID 集合替换单选状态**

使用 `Set<string>` 保存选中图片，保留一个 `previewId` 只控制大图预览。点击缩略图时更新预览并切换选中状态；弹窗打开或图片变化时默认选中第一张。

- [x] **步骤 2：增加全选/取消全选和选中计数**

在缩略图区域上方添加“全选”或“取消全选”，复制按钮显示 `复制所选图片（N）`，无选中项时禁用。

- [x] **步骤 3：实现优先复制和批量下载**

将选中图片转换为 Blob。优先调用 `navigator.clipboard.write`：单张使用一个 `ClipboardItem`，多张尝试写入多个 `ClipboardItem`；若 API 不存在、权限失败或多项写入失败，则显示兼容提示并提供“下载所选图片”按钮。下载兜底通过动态 `<a download>` 逐张下载，不修改服务端。

- [x] **步骤 4：补充交互样式**

为选择工具栏、全选控件、批量下载按钮、提示信息增加现有风格下的 CSS，并保持移动端单列布局。

### 任务 3：验证

**文件：**
- 检查：`src/client/components/ProductEditor.tsx`
- 检查：`src/client/components/ProductImagesModal.tsx`
- 检查：`src/client/styles/app.css`

- [x] **步骤 1：运行单元测试**

运行 `npm test`，预期现有测试全部通过。

- [x] **步骤 2：运行构建**

运行 `npm run build`，预期 TypeScript 编译和 Vite 构建均通过。

- [x] **步骤 3：检查差异**

运行 `git diff --check` 和 `git status --short`，确认只包含本轮产品编辑器、图片弹窗、样式和计划文档变化，没有修改订单或报价单业务逻辑。
