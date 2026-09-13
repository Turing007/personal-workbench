import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface WorkbenchVersionInfo {
  version: string;
  buildTime: string | null;
  gitCommit: string | null;
  mode: 'production' | 'development';
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, '..', '..');

let cachedVersion: string | undefined;

function packageVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version?: string };
    cachedVersion = typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

function readBuildInfoFromDisk(): WorkbenchVersionInfo {
  // tsx 直接运行 src 时是开发模式：源码即最新代码，没有构建产物版本。
  if (moduleDir.replaceAll('\\', '/').includes('/src/')) {
    return { version: packageVersion(), buildTime: null, gitCommit: null, mode: 'development' };
  }
  try {
    const info = JSON.parse(readFileSync(join(projectRoot, 'dist', 'build-info.json'), 'utf8')) as {
      version?: string;
      buildTime?: string;
      gitCommit?: string;
    };
    return {
      version: typeof info.version === 'string' && info.version ? info.version : packageVersion(),
      buildTime: typeof info.buildTime === 'string' ? info.buildTime : null,
      gitCommit: typeof info.gitCommit === 'string' ? info.gitCommit : null,
      mode: 'production',
    };
  } catch {
    return { version: packageVersion(), buildTime: null, gitCommit: null, mode: 'production' };
  }
}

/** 进程启动时读取一次构建信息并缓存：/health 报告的是“正在运行的代码”的版本，重建后旧进程不会谎报新版本。 */
const runningBuildInfo = readBuildInfoFromDisk();

/** 读取当前服务的版本信息。 */
export function readVersionInfo(): WorkbenchVersionInfo {
  return runningBuildInfo;
}
