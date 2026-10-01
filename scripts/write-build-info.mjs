import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// 镜像里没有 .git，构建时由 WORKBENCH_GIT_COMMIT 传进来；本地构建仍走 git 查询。
let gitCommit = (process.env.WORKBENCH_GIT_COMMIT ?? '').trim();
if (!gitCommit) {
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    // 非 git 环境下留空
  }
}

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(
  join(root, 'dist', 'build-info.json'),
  `${JSON.stringify({ version: pkg.version, buildTime: new Date().toISOString(), gitCommit }, null, 2)}\n`,
);
