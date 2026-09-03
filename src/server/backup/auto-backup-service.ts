import type { DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BackupService } from './backup-service.js';

export const AUTO_BACKUP_PREFIX = '自动备份-个人工作台-';
/** 每日备份时间：本机时间 03:00（避开工作时段）。 */
export const AUTO_BACKUP_HOUR = 3;
const AUTO_BACKUP_MINUTE = 0;
/** 定时器最大间隔（Node 定时器超过 2^31-1 毫秒会溢出）。 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** 默认保留最近 3 份自动备份，防止磁盘被 200MB 级附件包撑爆。 */
export const AUTO_BACKUP_KEEP = 3;
/** 保留数量允许范围。 */
export const AUTO_BACKUP_KEEP_MIN = 1;
export const AUTO_BACKUP_KEEP_MAX = 30;

const FILE_NAME_PATTERN = /^自动备份-个人工作台-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.zip$/;

/** 按 Asia/Shanghai 计算日期键（YYYY-MM-DD），与订单号日期口径一致。 */
export function shanghaiDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

/** 计算下一个备份触发时刻（本机时间每天 03:00，毫秒时间戳）。 */
function nextRunAt(now: Date): number {
  const next = new Date(now);
  next.setHours(AUTO_BACKUP_HOUR, AUTO_BACKUP_MINUTE, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export interface AutoBackupFileInfo {
  fileName: string;
  sizeBytes: number;
  /** 本机可读时间（Asia/Shanghai，YYYY-MM-DD HH:mm:ss）。 */
  createdAt: string;
}

export interface AutoBackupStatus {
  enabled: boolean;
  running: boolean;
  /** 今天（Asia/Shanghai）是否已有自动备份。 */
  todayDone: boolean;
  lastBackupAt: string | null;
  lastResult: 'success' | 'failed' | null;
  lastError: string | null;
  keepCount: number;
  /** 当前生效的自定义备份目录；空字符串表示使用默认目录。 */
  directory: string;
  files: AutoBackupFileInfo[];
}

export interface AutoBackupSettings {
  /** 自动备份保存目录；空字符串 = 使用默认目录（数据目录/backups）。 */
  directory: string;
  /** 保留份数。 */
  keepCount: number;
}

interface AutoBackupServiceOptions {
  /** 预留：后续可在备份前后做完整性校验。 */
  database: DatabaseSync;
  backupService: BackupService;
  backupsDirectory: string;
  keepCount?: number;
  /** 读取持久化设置（自定义目录/保留数）；未提供时使用构造参数。 */
  loadSettings?: () => AutoBackupSettings | null;
  /** 持久化设置变更；未提供时设置只在本次进程内生效。 */
  saveSettings?: (settings: AutoBackupSettings) => void;
  /** 测试注入用：省略时使用真实 setTimeout/clearTimeout。 */
  scheduleFn?: (callback: () => void, delayMs: number) => unknown;
  clearFn?: (handle: unknown) => void;
  now?: () => Date;
}

interface InternalBackupFile extends AutoBackupFileInfo {
  /** ISO UTC 时间，用于排序与 lastBackupAt。 */
  createdAtUtc: string;
  /** Asia/Shanghai 日期键，用于"今天是否已备份"判断。 */
  dateKey: string;
}

/**
 * 每日自动备份调度器（进程内实现，无需 Windows 任务计划程序）：
 * - 应用启动时检查今天是否已有自动备份，没有则立即补跑（应用常常不是全天开着）；
 * - 之后每天 03:00（本机时间）触发一次；
 * - 自动备份独立命名（自动备份-个人工作台-*.zip），手动备份不受影响；
 * - 超过保留数量的最旧自动备份自动清理。
 */
export class AutoBackupService {
  private readonly database: DatabaseSync;
  private readonly backupService: BackupService;
  private readonly defaultBackupsDirectory: string;
  private readonly defaultKeepCount: number;
  private readonly loadSettings?: () => AutoBackupSettings | null;
  private readonly saveSettings?: (settings: AutoBackupSettings) => void;
  private readonly scheduleFn: (callback: () => void, delayMs: number) => unknown;
  private readonly clearFn: (handle: unknown) => void;
  private readonly now: () => Date;
  private timerHandle: unknown = null;
  private running = false;
  private lastBackupAt: string | null = null;
  private lastResult: 'success' | 'failed' | null = null;
  private lastError: string | null = null;

  constructor(options: AutoBackupServiceOptions) {
    this.database = options.database;
    this.backupService = options.backupService;
    this.defaultBackupsDirectory = resolve(options.backupsDirectory);
    this.defaultKeepCount = Math.max(AUTO_BACKUP_KEEP_MIN, Math.trunc(options.keepCount ?? AUTO_BACKUP_KEEP));
    this.loadSettings = options.loadSettings;
    this.saveSettings = options.saveSettings;
    this.scheduleFn = options.scheduleFn ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearFn = options.clearFn ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.now = options.now ?? (() => new Date());
  }

  /** 当前生效的自定义备份目录（未自定义时为 null）。 */
  private configuredDirectory(): string | null {
    const settings = this.loadSettings?.();
    const directory = settings?.directory?.trim();
    return directory ? resolve(directory) : null;
  }

  /** 当前生效的保留份数。 */
  private configuredKeepCount(): number {
    const settings = this.loadSettings?.();
    const keep = Math.trunc(settings?.keepCount ?? this.defaultKeepCount);
    return Math.min(AUTO_BACKUP_KEEP_MAX, Math.max(AUTO_BACKUP_KEEP_MIN, keep));
  }

  /**
   * 校验并保存自动备份设置（设置页调用）。
   * 目录会立即做可写性验证（不存在则尝试创建），失败抛错避免保存无效配置。
   */
  async updateSettings(input: Partial<AutoBackupSettings>): Promise<AutoBackupSettings> {
    const keepCount = Math.trunc(input.keepCount ?? this.configuredKeepCount());
    if (!Number.isFinite(keepCount) || keepCount < AUTO_BACKUP_KEEP_MIN || keepCount > AUTO_BACKUP_KEEP_MAX) {
      throw new Error(`保留份数必须是 ${AUTO_BACKUP_KEEP_MIN} 到 ${AUTO_BACKUP_KEEP_MAX} 之间的整数`);
    }
    const directory = (input.directory ?? this.configuredDirectory() ?? '').trim();
    const resolvedDirectory = directory ? resolve(directory) : '';
    if (resolvedDirectory) {
      try {
        await mkdir(resolvedDirectory, { recursive: true });
        await writeFile(join(resolvedDirectory, '.workbench-backup-probe'), String(Date.now()), { flag: 'w' });
        await rm(join(resolvedDirectory, '.workbench-backup-probe'), { force: true });
      } catch (error) {
        throw new Error(`备份目录不可用（无法创建或写入）：${resolvedDirectory}，${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const settings: AutoBackupSettings = { directory: resolvedDirectory, keepCount };
    this.saveSettings?.(settings);
    return settings;
  }

  getSettings(): AutoBackupSettings {
    return {
      directory: this.configuredDirectory() ?? '',
      keepCount: this.configuredKeepCount(),
    };
  }

  /** 应用启动时调用：立即补跑当天缺失的备份，并排定下一次触发。 */
  async start(): Promise<void> {
    await this.runIfMissing();
    this.scheduleNext();
  }

  /** 进程退出时调用，取消未触发的定时器。 */
  stop(): void {
    if (this.timerHandle !== null) {
      this.clearFn(this.timerHandle);
      this.timerHandle = null;
    }
  }

  /** 立即执行一次自动备份（设置页"立即备份"按钮）。 */
  async runNow(): Promise<{ fileName: string; createdAt: string }> {
    const result = await this.execute();
    this.scheduleNext();
    return result;
  }

  async getStatus(): Promise<AutoBackupStatus> {
    const files = await this.listAutoBackups();
    const todayKey = shanghaiDateKey(this.now());
    return {
      enabled: true,
      running: this.running,
      todayDone: files.some((file) => file.dateKey === todayKey),
      lastBackupAt: this.lastBackupAt ?? files[0]?.createdAtUtc ?? null,
      lastResult: this.lastResult,
      lastError: this.lastError,
      keepCount: this.configuredKeepCount(),
      directory: this.configuredDirectory() ?? '',
      files: files.slice(0, 10).map(({ fileName, sizeBytes, createdAt }) => ({ fileName, sizeBytes, createdAt })),
    };
  }

  private scheduleNext(): void {
    if (this.timerHandle !== null) this.clearFn(this.timerHandle);
    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(1000, nextRunAt(this.now()) - this.now().getTime()));
    this.timerHandle = this.scheduleFn(() => {
      void this.runIfMissing()
        .catch(() => undefined)
        .then(() => this.scheduleNext());
    }, delay);
  }

  /** 今天还没有自动备份时执行一次（补跑 + 每日定时共用）。 */
  private async runIfMissing(): Promise<void> {
    const files = await this.listAutoBackups();
    const todayKey = shanghaiDateKey(this.now());
    if (files.some((file) => file.dateKey === todayKey)) return;
    await this.execute();
  }

  private async execute(): Promise<{ fileName: string; createdAt: string }> {
    if (this.running) throw new Error('自动备份正在进行中');
    this.running = true;
    try {
      const directory = this.configuredDirectory();
      const backup = await this.backupService.createBackup(AUTO_BACKUP_PREFIX, directory ?? undefined);
      this.lastBackupAt = backup.manifest.createdAt;
      this.lastResult = 'success';
      this.lastError = null;
      await this.pruneOldBackups();
      return { fileName: backup.fileName, createdAt: backup.manifest.createdAt };
    } catch (error) {
      this.lastResult = 'failed';
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async listAutoBackups(): Promise<InternalBackupFile[]> {
    const directory = this.configuredDirectory() ?? this.defaultBackupsDirectory;
    try {
      const entries = await readdir(directory);
      const files: InternalBackupFile[] = [];
      for (const fileName of entries) {
        const match = FILE_NAME_PATTERN.exec(fileName);
        if (!match) continue;
        const filePath = join(directory, fileName);
        try {
          const fileStat = await stat(filePath);
          if (!fileStat.isFile()) continue;
          const [, year, month, day, hour, minute, second] = match;
          const createdAtUtc = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
          const date = new Date(createdAtUtc);
          files.push({
            fileName,
            sizeBytes: fileStat.size,
            createdAtUtc,
            dateKey: shanghaiDateKey(date),
            createdAt: new Intl.DateTimeFormat('zh-CN', {
              timeZone: 'Asia/Shanghai',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
              hourCycle: 'h23',
            }).format(date).replaceAll('/', '-'),
          });
        } catch {
          // 文件可能刚好被清理，跳过
        }
      }
      files.sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? 1 : -1));
      return files;
    } catch {
      return [];
    }
  }

  private async pruneOldBackups(): Promise<void> {
    const files = await this.listAutoBackups();
    const directory = this.configuredDirectory() ?? this.defaultBackupsDirectory;
    for (const file of files.slice(this.configuredKeepCount())) {
      await unlink(join(directory, file.fileName)).catch(() => undefined);
    }
  }
}
