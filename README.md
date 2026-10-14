# 个人工作台

一个仅供本机使用的轻量订单管理网页应用，覆盖客户产品库、订单录入、10×10cm 箱唛编辑与打印、备货/打包状态、发货批次、物流单号回填，以及本机数据备份恢复。

## 运行要求

- Windows 10/11
- Node.js 22 或更高版本（项目使用 Node.js 内置 `node:sqlite`）
- 首次运行需要联网执行 `npm install`

## 最简单的启动方式

双击项目目录中的：

```text
启动个人工作台.bat
```

脚本会自动：

1. 检查 Node.js；
2. 如果没有 `dist/` 构建产物，执行 `npm run build`；
3. 在本机启动服务；
4. 等待健康检查通过；
5. 打开浏览器访问 `http://127.0.0.1:52342/`。

停止时双击：

```text
停止个人工作台.bat
```

停止脚本只会停止命令行确认为本项目 `dist/server/main.js` 的 Node.js 进程，不会误杀其他 Node.js 服务。

> 本机实例读写的是项目目录下的 `data/`，和服务器上是两份独立数据。同时开两处并各自动手会分叉，之后只能覆盖其中一边 —— 需要临时用本机时，把它当离线副本看待。

## 命令行开发

在项目根目录 `C:\Users\gaofu\Documents\个人工作台` 执行：

```powershell
npm install
npm run dev
```

开发模式使用：

- 前端 Vite：`http://127.0.0.1:52343/`
- 后端 Fastify：`http://127.0.0.1:52342/`

开发模式下前端的 `/api/`、`/health` 和 `/files/` 会代理到后端。

生产构建和启动：

```powershell
npm run typecheck
npm test
npm run build
npm start
```

生产模式只需要访问：

```text
http://127.0.0.1:52342/
```

## 主要工作流程

1. **客户产品库**：维护客户常用产品，按品名、SKU、规格筛选；相同品名但规格不同视为不同产品。
2. **新建订单**：手动填写订单号、下单时间、客户来源、收件人名称、收件信息、备注和多行产品；产品区按“数量 × 单价”自动计算行金额与订单总额。订单产品会保存快照，不会因为客户产品库后续修改而改变历史订单。
3. **箱唛**：订单详情中的“箱唛”可以逐箱编辑、手动合箱或恢复自动装箱；订单列表可多选未发货订单后批量打印。打印页面按 `10cm × 10cm` 输出，每页一张。打印只记录打印历史和最近打印提醒，不改变订单状态。
4. **订单状态**：

   ```text
   待备货 → 已备货 → 待打包 → 待发货 → 已发货
   ```

   新建订单直接进入“待备货”；箱唛打印是独立的辅助功能，不影响备货、打包和发货。中间状态由用户按流程逐步确认。

5. **发货**：在“发货管理”中选择待发货订单，生成只包含“总箱数 + 收件信息”的发货表，补齐物流单号后确认发货。

## 付款凭证和图片

- 新建订单时可选择多张付款凭证；每张凭证有独立备注，例如“预付款”“尾款”。
- 在凭证区域点击后可使用 `Ctrl+V` 粘贴剪贴板图片。
- 支持 PNG、JPEG、WebP，单张图片不超过 10MB。
- 产品图片同样保存在本机附件目录。

## 手机端使用

两种方式，二选一即可：

**方式一：安卓 App（推荐）**。安装项目提供的 APK（`个人工作台-手机版.apk`，由 `android/` 目录构建，构建方法见下节），首次打开时填入工作台地址（如 `http://192.168.1.10:52342` 或 `https://你的域名`），也可以直接扫描电脑「设置 → 手机连接」页面的二维码，之后从桌面图标全屏进入，支持拍照/选图上传、备份下载、返回键后退。重新打包 APK 的方法：

```bash
# 前提：~/.workbench-android/ 已有 JDK17、Android cmdline-tools、Gradle（一次性安装）
export JAVA_HOME=~/.workbench-android/jdk17
export ANDROID_HOME=~/.workbench-android/android-sdk
cd android && ~/.workbench-android/downloads/gradle-8.9/bin/gradle assembleRelease
# 产物：android/app/build/outputs/apk/release/app-release.apk
```

**方式二：手机浏览器**。连上和电脑相同的 Wi-Fi 后访问启动脚本提示的局域网地址；部署到服务器后则访问 `https://你的域名`，在浏览器菜单选“添加到主屏幕”可全屏打开（PWA）。想出门在外也能随时查看，用 Tailscale 组网即可，完整步骤见 [docs/手机访问指南.md](docs/手机访问指南.md)。

共同说明：

- 手机端为底部 Tab 导航：订单、报价、发货、财务为高频入口，其余模块在“更多”抽屉里。
- **多网络访问**：网络切换收进「设置 → 手机连接 → App 网络」：点选局域网/隧道即可切换，还能新增/编辑，**每条右侧的删除按钮可把不再需要的地址删掉**（删当前正在用的那条会先确认，然后自动切到剩下的第一条）；**当前网络连不上时不再自动切换，而是直接弹出「选择网络」页**——逐条显示**延迟毫秒数**与环境（橙色「测试环境」/ 绿色「线上」，由各实例的 `/health` 决定），一眼能看出哪条快、连的是哪个环境，点哪条就连哪条，也可重新检测或改地址。在电脑「设置 → 手机连接」里填写隧道地址后，二维码会一次写入两条网络，标签自带环境名。
- 内网穿透（隧道）可选用 Cloudflare Tunnel、ngrok、frp 等任意方案，把本机 `52342` 端口映射到一个公网地址（建议 https），手机在流量网络下即可访问；隧道地址填在「设置 → 手机连接」中。
- 订单、财务、报价、销售单、产品库、客户产品库在窄屏自动切换为卡片视图；订单表单自动折为单列，产品明细行带字段小标签；发货工作区在窄屏改为单列。
- 界面自动跟随系统深浅色。生产构建注册 Service Worker，断网/弱网时仍可查看最近浏览过的数据（只读）。
- 首次访问会引导创建管理员账号（首个账号自动成为管理员），之后所有页面都需要登录；更多账号在「设置 → 账号与安全」管理，防止同一网络内的其他设备查看业务数据。
- 箱唛打印仍建议在连接打印机的电脑上操作，手机端可查看箱唛数据。
- 局域网直连时如手机打不开地址，多为 Windows 防火墙拦截，需放行 TCP 52342 端口；如只想本机使用，可设置 `WORKBENCH_HOST=127.0.0.1`。

## 服务器部署与上线更新

把服务端部署到云服务器后，手机和电脑在任何有网络的地方都能使用，不再依赖家里电脑开机。

**线上现状（2026-10-14）**：阿里云轻量应用服务器 `101.200.149.84`，入口 `https://www.vigortech.xyz`（Caddy 自动 HTTPS，`vigortech.xyz` 与 `www.vigortech.xyz` 共用一张证书）。服务器上**没有 git 仓库**，`~/workbench` 里是部署脚本解压出来的源码 + bind mount 的 `data/`，所以更新只能从本机推，不能在服务器上 `git pull`。

### 一键上线（其他 Agent / 会话请按这条走）

在本机项目目录的 **Git Bash** 中执行（不要用 PowerShell，脚本是 bash）：

```bash
# 上线前先确认提交已推送到 GitHub（部署包取自工作区，commit 号只用于打版本标记）
git status -sb          # 应显示 master...origin/master 无 ahead
npm run typecheck && npm test
npm run build           # 本地先验一遍打包

SSH_KEY=~/.ssh/workbench_deploy_ed25519 \
  bash scripts/deploy-to-server.sh root@101.200.149.84 'vigortech.xyz,www.vigortech.xyz'
```

域名参数写成 `vigortech.xyz,www.vigortech.xyz`（**逗号后不要空格**，远端会用 bash source `.env`，带空格会把第二个域名当成命令执行；脚本内部会规范化成逗号+空格再交给 Caddy）。

`SSH_KEY` 指向本机 `~/.ssh/workbench_deploy_ed25519` 私钥；换服务器或换密钥时改这个环境变量即可。免密登录没配好时脚本会停在第一步并提示。

**脚本五步各自做什么**（失败即中止，不会带病上线）：

| 步骤 | 动作 |
|---|---|
| 1 | SSH 检查连通性与服务器上的 Docker |
| 2 | 打包**源代码**（排除 `node_modules` `dist` `data` `.git` `android`）——注意传的是源码不是构建产物 |
| 3 | scp 上传到 `~/workbench` 并解压 |
| 4 | **部署前给线上数据库拍快照** `data/backups/部署前快照-*.sqlite`（保留最近 10 份）。快照失败直接中止 |
| 5 | 服务器上 `docker compose --profile https up -d --build` 重新构建镜像并启动，然后探活 `/health`，域名模式还会用 `--resolve` 把整条 HTTPS 链路验一遍 |

第 4 步必须先于第 5 步：数据库迁移是**容器启动时自动执行**的，一旦写坏，最近的回滚点就只剩最多 24 小时前那份定时备份。

### 上线后怎么确认成功

```bash
curl -s https://www.vigortech.xyz/health
```

返回里的 `gitCommit` 应等于刚推送的 commit 短号，`status` 为 `ok`，`environment` 为 `production`。示例：

```json
{"ok":true,"data":{"status":"ok","version":"0.3.0","buildTime":"...","gitCommit":"092454f","mode":"production","environment":"production"}}
```

`gitCommit` 来自部署脚本写入 `.env` 的 `WORKBENCH_GIT_COMMIT`，所以它是判断「线上跑的是哪一版」的唯一可靠依据。

### 出问题怎么回滚

用第 4 步那份快照，退到发布前的数据状态：

```bash
docker compose stop workbench
cp data/backups/部署前快照-<时间戳>.sqlite data/workbench.sqlite
rm -f data/workbench.sqlite-wal data/workbench.sqlite-shm   # 不删会和新库对不上
docker compose --profile https up -d
```

只回滚数据不够，还要把代码也退回去：在本机 `git revert` 或 checkout 到上一个 commit 后重跑一次部署脚本。只回滚数据、不退回代码，下次发版又会把问题带回来。

### 日常维护（SSH 到服务器后，在 `~/workbench` 目录）

```bash
docker compose --profile https logs -f workbench   # 查看日志
docker compose --profile https ps                  # 容器状态
docker volume ls                                   # Caddy 证书数据卷
df -h /                                            # 磁盘（备份 zip 单个约 900MB，注意余量）
```

> ⚠️ **不要**在服务器上执行 `docker compose pull && docker compose up -d --build` 来「更新代码」——服务器没有 git，也没有新代码可拉，这条命令只会用现有源码重建同一个版本。更新一律从本机跑部署脚本。

服务器上的每日自动备份沿用「设置 → 备份与恢复」中的配置，备份 ZIP 在 `data/backups/`，建议每月下载一份存到本地做异地容灾。

**把电脑上的旧数据迁到服务器**：电脑上「设置 → 备份与恢复 → 创建备份」下载 ZIP → 打开服务器站点 → 管理员账号「设置 → 选择备份恢复」上传 ZIP。账号数据不随备份迁移，恢复后用服务器上的账号登录即可。全量数据（图片附件数百 MB）超出界面上传上限（20MB），这种情况改用文件：把本机 `data/` 整份拷到服务器 `~/workbench/data`（compose 用的就是 bind mount），再重启容器。

**首次部署新服务器**（换机器时）：先 `bash scripts/provision-server.sh root@新IP` 装 Docker，再跑部署脚本。IP 直连模式（域名未备案时）把域名参数省略即可，脚本会只起应用不起 Caddy，记得在控制台放行 `52341/tcp`。


## 数据和备份

图片会同时生成小尺寸缩略图（WebP）供列表使用，点开大图才加载原图；缩略图缓存在 `data/thumbnails/`，不进备份 ZIP（删掉会自动重建）。静态资源与附件都带长期缓存头，第二次打开不再重复下载。

默认数据目录：

```text
C:\Users\gaofu\Documents\个人工作台\data
```

其中：

- `workbench.sqlite`：订单、产品、箱唛、打印历史等数据；
- `files/product-images/`：产品图片；
- `files/payment-proofs/`：付款凭证；
- `backups/`：创建的 ZIP 备份。

在“设置”页面：

- 点击“创建备份”会下载包含数据库和附件的 ZIP；
- 选择 ZIP 后会先预览备份清单；
- 确认恢复前，系统会自动创建当前数据的安全备份；
- 恢复失败会保留当前数据库和附件，不会直接覆盖原数据。

也可以通过环境变量修改端口或数据目录：

```powershell
$env:WORKBENCH_PORT = '52342'
$env:WORKBENCH_DATA_DIR = 'D:\个人工作台数据'
npm start
```

**本机测试 vs 线上**：`WORKBENCH_ENV` 决定页面是否显示「测试环境」横条和手机端的环境徽标。

- 不设置、写 `test`、或写成任何无法识别的值时，一律按**测试端**处理（页面上有琥珀色横条）；
- 只有显式写成 `WORKBENCH_ENV=production` 才按线上处理（无任何标识）。

默认落在测试端是刻意的：判错的代价是拿线上库当测试环境改，所以宁可在正式环境上多显示一条横条，也不能让测试实例冒充线上。本机启动脚本会自动设成 `test`，Docker 镜像与部署脚本显式设为 `production`。

## 打印设置

在浏览器打印对话框中建议：

- 纸张：自定义 `100mm × 100mm` 或与标签纸实际尺寸一致；
- 边距：无；
- 缩放：100%；
- 关闭页眉和页脚；
- 背景图形：按打印机需要开启。

箱唛仅显示收件人名称、订单号、箱号/总箱数、当前箱产品内容和打印日期，不显示客户来源、电话、收货地址、金额、付款凭证或内部备注。

## 测试

```powershell
npm run typecheck
npm test
npm run build
npx playwright test
```

如果只想验证备份恢复：

```powershell
npx vitest run tests/server/backup.test.ts
```

## 常见问题

### 双击启动后浏览器打不开

先确认 Node.js 已安装，再检查 `http://127.0.0.1:52342/health` 是否返回成功。若端口被占用，关闭占用 `52342` 的程序，或在命令行用 `WORKBENCH_PORT` 指定其他端口启动。

### 页面显示旧版本

执行：

```powershell
npm run build
```

然后重新打开浏览器并按 `Ctrl+F5` 强制刷新。

### 恢复备份前要注意什么

恢复会替换当前订单、产品、箱唛、打印历史和附件。系统会自动创建恢复前安全备份，但仍建议在重要操作前手动下载一份备份 ZIP。

### 从备份恢复（灾难恢复）

两条路，效果不同，先看清再动手：

| 方式 | 怎么用 | 账号会怎样 |
|---|---|---|
| 界面恢复 | 设置 → 备份与恢复 → 选择备份 ZIP | **保留当前账号**（备份里的账号表不参与覆盖） |
| 整库恢复 | 解压 ZIP，把 `workbench.sqlite` 与 `files/` 拷回数据目录 | 用备份里的账号，密码回到备份那一刻 |

全量数据（图片附件数百 MB）超出界面上传上限（20MB），所以真正救急只能走文件：

```bash
# 1) 停应用（保留 Caddy 运行，可省一步）
docker compose --profile https stop workbench
# 2) 解压备份
unzip 自动备份-个人工作台-20260101T010950Z.zip -d /tmp/restore
# 3) 替换数据库与附件目录；-wal/-shm 不删会和新库对不上
cp /tmp/restore/workbench.sqlite ~/workbench/data/workbench.sqlite
rm -f ~/workbench/data/workbench.sqlite-wal ~/workbench/data/workbench.sqlite-shm
cp -r /tmp/restore/files/. ~/workbench/data/files/
# 4) 起回来
docker compose --profile https up -d
```

2026-10-02 做过一次完整演练：备份里的 4422 个文件与服务器逐条一致（相对路径 + 字节数），
38 张表的行数与备份清单全部对上，`PRAGMA integrity_check` 通过；并把恢复出来的数据
真正启动应用验证过 —— 订单 35 条、产品库卡片与图片全部正常加载。

### 连续输错密码被锁了怎么办

登录失败按 **来源 IP + 用户名** 计数（别人的 IP 猜你的用户名，不会把你锁住）。连续 3 次失败开始锁定，之后继续失败逐级拉长：

| 第几次失败 | 锁定时长 |
|---|---|
| 3 | 5 分钟 |
| 4 | 15 分钟 |
| 5 | 1 小时 |
| 6 | 6 小时 |
| 7 及以上 | 24 小时（封顶，不做永久锁定） |

锁定状态存在数据库里，**重启服务不会清零**（否则攻击者等到发版重启就能继续猜）。登录成功即清零；计数窗口是 24 小时，过了就重新计数。

被锁住时的自救办法 —— 在服务器上进部署目录执行（两步都要做）：

```bash
cp scripts/clear-login-locks.mjs data/.clear-locks.mjs
docker compose exec -T workbench node /data/.clear-locks.mjs   # 清掉落盘的锁定状态
docker compose restart workbench                               # 丢掉进程内存里的计数
rm -f data/.clear-locks.mjs
```

只清库不重启没用（进程内存里的计数还在）；只重启也没用（重启后会把锁定状态读回来）。

被限流的来源 IP 与用户名会以 warn 级别写进服务日志，`docker compose logs workbench | grep 登录被限流` 能看出有没有人在外面猜密码。
