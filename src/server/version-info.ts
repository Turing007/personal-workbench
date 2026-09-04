import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
// src/server 与 dist/server 都位于项目根的下两级
const projectRoot = resolve(moduleDir, '..', '..');
// 从 src 直接运行（tsx 开发模式）时模块路径包含 /src/，生产构建则运行于 dist/server。
const isDevelopment = moduleDir.replaceAll('\\', '/').includes('/src/');

export interface WorkbenchVersionInfo {
  version: string;
  buildTime?: string;
  gitCommit?: string;
  mode: 'production' | 'development';
}

let cached: WorkbenchVersionInfo | undefined;

export function getVersionInfo(): WorkbenchVersionInfo {
  if (cached) return cached;
  let version = '';
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version?: string };
    version = String(pkg.version ?? '');
  } catch {
    // 读取失败时回落到 unknown
  }
  let buildTime: string | undefined;
  let gitCommit: string | undefined;
  if (!isDevelopment) {
    try {
      const info = JSON.parse(readFileSync(join(projectRoot, 'dist', 'build-info.json'), 'utf8')) as {
        buildTime?: string;
        gitCommit?: string;
      };
      if (info.buildTime) {
        buildTime = String(info.buildTime);
        gitCommit = info.gitCommit ? String(info.gitCommit) : undefined;
      }
    } catch {
      // 构建信息缺失（旧版构建产物）
    }
  }
  cached = {
    version: version || 'unknown',
    buildTime,
    gitCommit,
    mode: isDevelopment ? 'development' : 'production',
  };
  return cached;
}
