import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

let gitCommit = null;
try {
  gitCommit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
} catch {
  // 非 git 环境下忽略
}

const info = {
  version: typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0',
  buildTime: new Date().toISOString(),
  gitCommit,
};

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`build-info: v${info.version} built at ${info.buildTime}${gitCommit ? ` (${gitCommit})` : ''}`);
