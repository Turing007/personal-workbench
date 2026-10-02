// 手工清除登录失败计数与锁定状态 —— 误锁时的自救通道。
//
// 服务器上在部署目录里执行（两步都要做，缺一不可）：
//   cp scripts/clear-login-locks.mjs data/.clear-locks.mjs
//   docker compose exec -T workbench node /data/.clear-locks.mjs   # 清掉落盘的状态
//   docker compose restart workbench                               # 让进程丢掉内存里的计数
//   rm -f data/.clear-locks.mjs
//
// 只清库不重启没用：进程里还留着内存中的计数，会继续按旧的锁定时长拦人；
// 只重启不清理也没用：重启后进程会从库里把锁定状态读回来。
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const dataDirectory = process.env.WORKBENCH_DATA_DIR || '/data';
const database = new DatabaseSync(join(dataDirectory, 'workbench.sqlite'));

const row = database.prepare('SELECT value FROM settings WHERE key = ?').get('login_lockouts');
let entries = 0;
try {
  const parsed = JSON.parse(String(row?.value ?? '{}'));
  entries = parsed && typeof parsed === 'object' ? Object.keys(parsed).length : 0;
} catch {
  entries = 0;
}

database.prepare('DELETE FROM settings WHERE key = ?').run('login_lockouts');
database.close();

console.log(`已清除落盘的登录锁定记录（原有 ${entries} 条：IP+用户名 组合）。`);
console.log('还需要执行 docker compose restart workbench，否则进程内存里的计数仍然有效。');
