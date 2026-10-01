// 部署前给线上数据库拍一份在线一致性快照，作为「这次发布改坏了」的当日回滚点。
//
// 由 scripts/deploy-to-server.sh 在上传代码之后、重新构建镜像之前调用，
// 在应用容器内执行（那里一定有匹配版本的 Node 与 node:sqlite）：
//
//   docker compose exec -T workbench node /data/.deploy-snapshot.mjs
//
// 手工执行也可以，同样在容器里跑。产物落在 <数据目录>/backups/部署前快照-*.sqlite，
// 自动备份的清理逻辑只认「自动备份-个人工作台-*.zip」，不会碰这些文件，所以保留份数
// 由本文件自己控制（KEEP）。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dataDirectory = process.env.WORKBENCH_DATA_DIR || '/data';
const sourcePath = join(dataDirectory, 'workbench.sqlite');
const backupDirectory = join(dataDirectory, 'backups');
const snapshotPrefix = '部署前快照-';
const snapshotPattern = /^部署前快照-\d{8}T\d{6}Z\.sqlite$/;
const KEEP = 10;

function fail(reason) {
  console.log(`SNAPSHOT_FAIL ${reason}`);
  process.exitCode = 1;
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace(/\..+/, '') + 'Z';
const targetPath = join(backupDirectory, `${snapshotPrefix}${stamp}.sqlite`);

let source;
try {
  mkdirSync(backupDirectory, { recursive: true });
  statSync(sourcePath);

  // VACUUM INTO 只读源库、写出独立文件，不打断应用自己的写入。
  // 目标路径必须是单引号 SQL 字面量（双引号会被当成列名），内部单引号按 SQL 规则翻倍转义。
  source = new DatabaseSync(sourcePath);
  source.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
  source.close();
} catch (error) {
  if (source) { try { source.close(); } catch { /* 已损坏的连接忽略 */ } }
  try { rmSync(targetPath, { force: true }); } catch { /* 半截文件清不掉就交给保留策略 */ }
  fail(`生成快照失败：${error?.message ?? error}`);
}

// 验货：能打开、integrity 过、行数不为负 —— 一份打不开的备份等于没有备份。
let summary;
try {
  const snapshot = new DatabaseSync(targetPath, { readOnly: true });
  const integrity = snapshot.prepare('PRAGMA integrity_check').get().integrity_check;
  if (integrity !== 'ok') {
    snapshot.close();
    fail(`快照校验未通过：integrity_check=${integrity}`);
  }
  summary = {
    bytes: statSync(targetPath).size,
    tables: snapshot.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c,
    products: snapshot.prepare('SELECT COUNT(*) c FROM products').get().c,
    orders: snapshot.prepare('SELECT COUNT(*) c FROM orders').get().c,
  };
  snapshot.close();
} catch (error) {
  fail(`快照校验异常：${error?.message ?? error}`);
}

// 保留最近 KEEP 份，其余删除；只认自己生成的文件名，别碰自动备份的 ZIP。
try {
  const stale = readdirSync(backupDirectory)
    .filter((name) => snapshotPattern.test(name))
    .sort()
    .reverse()
    .slice(KEEP);
  for (const name of stale) rmSync(join(backupDirectory, name), { force: true });
  if (stale.length) console.log(`已清理 ${stale.length} 份更早的部署前快照`);
} catch (error) {
  // 清理失败不该让部署停下来，快照本身已经安全落地。
  console.log(`SNAPSHOT_PRUNE_WARN ${error?.message ?? error}`);
}

console.log(
  `SNAPSHOT_OK ${targetPath} ${summary.bytes}B tables=${summary.tables} ` +
  `products=${summary.products} orders=${summary.orders}`,
);
