import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_BACKUP_KEEP,
  AUTO_BACKUP_PREFIX,
  AutoBackupService,
  shanghaiDateKey,
} from '../../src/server/backup/auto-backup-service';
import { BackupService } from '../../src/server/backup/backup-service';
import { openDatabase } from '../../src/server/db/connection';
import { migrateDatabase } from '../../src/server/db/migrate';

const temporaryDirectories: string[] = [];
const databases: DatabaseSync[] = [];

/** 距下一个 03:00（Asia/Shanghai）的毫秒数（与调度器算法一致；服务器容器是 UTC，不能按本地时区算）。 */
function msUntilNextThreeAm(now: Date): number {
  const offset = 8 * 60 * 60 * 1000;
  const shanghai = new Date(now.getTime() + offset);
  shanghai.setUTCHours(3, 0, 0, 0);
  let next = shanghai.getTime() - offset;
  if (next <= now.getTime()) next += 24 * 60 * 60 * 1000;
  return next - now.getTime();
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => {
    try { database.close(); } catch { /* 已关闭 */ }
    return Promise.resolve();
  }));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function makeFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-workbench-auto-backup-'));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, 'workbench.sqlite'));
  migrateDatabase(database);
  databases.push(database);
  const backupsDirectory = join(directory, 'backups');
  const backupService = new BackupService({
    database,
    databasePath: join(directory, 'workbench.sqlite'),
    dataDirectory: directory,
    backupsDirectory,
  });
  return { directory, database, backupsDirectory, backupService };
}

/** 记录调度调用的假定时器：不真实触发，只记录延迟和回调。 */
function makeFakeScheduler() {
  const scheduled: Array<{ delayMs: number; callback: () => void }> = [];
  return {
    scheduled,
    scheduleFn: (callback: () => void, delayMs: number) => {
      scheduled.push({ delayMs, callback });
      return scheduled.length;
    },
    clearFn: () => undefined,
  };
}

async function touchAutoBackup(backupsDirectory: string, isoUtc: string): Promise<string> {
  await mkdir(backupsDirectory, { recursive: true });
  // 去掉毫秒部分，与 BackupService 的文件名时间戳格式一致（YYYYMMDDTHHMMSSZ）
  const stamp = isoUtc.replace(/\.\d{3}Z$/, 'Z').replaceAll('-', '').replaceAll(':', '');
  const fileName = `${AUTO_BACKUP_PREFIX}${stamp}.zip`;
  await writeFile(join(backupsDirectory, fileName), 'fake-zip');
  return fileName;
}

describe('shanghaiDateKey', () => {
  it('按 Asia/Shanghai 计算日期键', () => {
    // UTC 2026-08-27 17:30 = 上海 2026-08-28 01:30
    expect(shanghaiDateKey(new Date('2026-08-27T17:30:00Z'))).toBe('2026-08-28');
    // UTC 2026-08-27 16:00 = 上海 2026-08-28 00:00（零点边界）
    expect(shanghaiDateKey(new Date('2026-08-27T16:00:00Z'))).toBe('2026-08-28');
    // UTC 2026-08-27 15:59 = 上海 2026-08-27 23:59（边界前一天）
    expect(shanghaiDateKey(new Date('2026-08-27T15:59:00Z'))).toBe('2026-08-27');
  });
});

describe('AutoBackupService', () => {
  it('启动时当天没有备份则立即补跑，文件使用自动备份前缀命名', async () => {
    const { database, backupsDirectory, backupService } = await makeFixture();
    const scheduler = makeFakeScheduler();
    const service = new AutoBackupService({
      database,
      backupService,
      backupsDirectory,
      scheduleFn: scheduler.scheduleFn,
      clearFn: scheduler.clearFn,
    });

    await service.start();

    const files = await readdir(backupsDirectory);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^自动备份-个人工作台-\d{8}T\d{6}Z\.zip$/);
    const status = await service.getStatus();
    expect(status.todayDone).toBe(true);
    expect(status.lastResult).toBe('success');
    expect(status.lastError).toBeNull();
    expect(status.lastBackupAt).toBeTruthy();
    // 下一次调度指向明天本机时间 03:00（允许毫秒级执行误差）
    expect(scheduler.scheduled.length).toBe(1);
    expect(Math.abs(scheduler.scheduled[0].delayMs - msUntilNextThreeAm(new Date()))).toBeLessThan(1000);
  });

  it('当天（上海时区）已有备份时不重复执行，并正确排定下一次时间', async () => {
    const { database, backupsDirectory, backupService } = await makeFixture();
    // 假设备份文件时间戳为"今天"（上海口径）：取真实当前 UTC 时间戳
    const nowIso = new Date().toISOString();
    await touchAutoBackup(backupsDirectory, nowIso);
    const scheduler = makeFakeScheduler();
    const spy = vi.spyOn(backupService, 'createBackup');
    const service = new AutoBackupService({
      database,
      backupService,
      backupsDirectory,
      scheduleFn: scheduler.scheduleFn,
      clearFn: scheduler.clearFn,
    });

    await service.start();

    expect(spy).not.toHaveBeenCalled();
    const status = await service.getStatus();
    expect(status.todayDone).toBe(true);
    expect(status.lastResult).toBeNull();
    // 下一次调度 = 距下一个本机 03:00（可能在几分钟后，也可能在明天；允许毫秒级误差）
    expect(Math.abs(scheduler.scheduled[0].delayMs - msUntilNextThreeAm(new Date()))).toBeLessThan(1000);
  });

  it('runNow 立即执行、返回文件名且磁盘上存在，同时排定下一次调度', async () => {
    const { database, backupsDirectory, backupService } = await makeFixture();
    const scheduler = makeFakeScheduler();
    const service = new AutoBackupService({
      database,
      backupService,
      backupsDirectory,
      scheduleFn: scheduler.scheduleFn,
      clearFn: scheduler.clearFn,
    });

    const result = await service.runNow();

    expect(result.fileName.startsWith(AUTO_BACKUP_PREFIX)).toBe(true);
    const fileStat = await stat(join(backupsDirectory, result.fileName));
    expect(fileStat.isFile()).toBe(true);
    const status = await service.getStatus();
    expect(status.todayDone).toBe(true);
    expect(status.running).toBe(false);
    expect(scheduler.scheduled[0].delayMs).toBeGreaterThanOrEqual(msUntilNextThreeAm(new Date()) - 1000);
    expect(scheduler.scheduled[0].delayMs).toBeLessThanOrEqual(msUntilNextThreeAm(new Date()) + 1000);
  });

  it(`超过保留数量（默认 ${AUTO_BACKUP_KEEP} 份）时清理最旧的自动备份，不影响手动备份`, async () => {
    const { database, backupsDirectory, backupService } = await makeFixture();
    for (let i = 0; i < AUTO_BACKUP_KEEP + 2; i++) {
      const day = String(10 + i).padStart(2, '0');
      await touchAutoBackup(backupsDirectory, `2026-08-${day}T19:00:00Z`);
    }
    await writeFile(join(backupsDirectory, '个人工作台备份-20260827T000000Z.zip'), 'manual-zip');
    const scheduler = makeFakeScheduler();
    const service = new AutoBackupService({
      database,
      backupService,
      backupsDirectory,
      scheduleFn: scheduler.scheduleFn,
      clearFn: scheduler.clearFn,
    });

    await service.start(); // 今天已有 → 不补跑
    await service.runNow(); // 手动触发 → 产生第 AUTO_BACKUP_KEEP+3 份 → 清理到 AUTO_BACKUP_KEEP

    const names = await readdir(backupsDirectory);
    const autoNames = names.filter((name) => name.startsWith(AUTO_BACKUP_PREFIX));
    expect(autoNames.length).toBe(AUTO_BACKUP_KEEP);
    expect(names.some((name) => name.startsWith('个人工作台备份-'))).toBe(true);
  });

  it('updateSettings 可修改保留份数并按新数量清理', async () => {
    const { database, backupsDirectory, backupService } = await makeFixture();
    // 预置 5 份自动备份
    for (let i = 0; i < 5; i++) {
      const day = String(10 + i).padStart(2, '0');
      await touchAutoBackup(backupsDirectory, `2026-08-${day}T19:00:00Z`);
    }
    const scheduler = makeFakeScheduler();
    let saved: { directory: string; keepCount: number } | null = null;
    const service = new AutoBackupService({
      database,
      backupService,
      backupsDirectory,
      scheduleFn: scheduler.scheduleFn,
      clearFn: scheduler.clearFn,
      loadSettings: () => saved,
      saveSettings: (settings) => { saved = settings; },
    });

    const settings = await service.updateSettings({ keepCount: 2 });
    expect(settings.keepCount).toBe(2);
    await service.runNow(); // 新增 1 份 = 6 份 → 清理到 2 份
    const names = await readdir(backupsDirectory);
    expect(names.filter((name) => name.startsWith(AUTO_BACKUP_PREFIX)).length).toBe(2);
  });

  it('自定义目录生效：新备份写入自定义目录并从那里清理', async () => {
    const { database, backupsDirectory, backupService, directory } = await makeFixture();
    const customDirectory = join(directory, 'custom-backup-target');
    const scheduler = makeFakeScheduler();
    let saved: { directory: string; keepCount: number } | null = { directory: customDirectory, keepCount: 2 };
    const service = new AutoBackupService({
      database,
      backupService,
      backupsDirectory,
      scheduleFn: scheduler.scheduleFn,
      clearFn: scheduler.clearFn,
      loadSettings: () => saved,
      saveSettings: (settings) => { saved = settings; },
    });

    const result = await service.runNow();

    // 备份写入自定义目录，默认目录保持为空（或尚未创建）
    const customNames = await readdir(customDirectory);
    expect(customNames).toContain(result.fileName);
    let defaultNames: string[] = [];
    try {
      defaultNames = await readdir(backupsDirectory);
    } catch {
      // 默认目录从未被创建也是合法状态
    }
    expect(defaultNames.filter((name) => name.endsWith('.zip'))).toEqual([]);
    // 状态接口列出自定义目录中的文件
    const status = await service.getStatus();
    expect(status.directory).toBe(resolve(customDirectory));
    expect(status.files.map((file) => file.fileName)).toContain(result.fileName);
  });

  it('updateSettings 拒绝无效保留份数并验证目录可写', async () => {
    const { database, backupsDirectory, backupService, directory } = await makeFixture();
    const scheduler = makeFakeScheduler();
    const service = new AutoBackupService({
      database,
      backupService,
      backupsDirectory,
      scheduleFn: scheduler.scheduleFn,
      clearFn: scheduler.clearFn,
    });
    await expect(service.updateSettings({ keepCount: 0 })).rejects.toThrow('保留份数');
    await expect(service.updateSettings({ keepCount: 31 })).rejects.toThrow('保留份数');
    // 不可写目录（占用/权限）应报错 —— 用一个"文件"充当目录路径
    const blockedPath = join(directory, 'blocked');
    await writeFile(blockedPath, 'not-a-directory');
    await expect(service.updateSettings({ directory: blockedPath })).rejects.toThrow('备份目录不可用');
    // 空目录字符串 = 恢复默认目录
    const settings = await service.updateSettings({ directory: '' });
    expect(settings.directory).toBe('');
  });

  it('getSettings 返回当前生效配置', async () => {
    const { database, backupsDirectory, backupService } = await makeFixture();
    const scheduler = makeFakeScheduler();
    let saved: { directory: string; keepCount: number } | null = null;
    const service = new AutoBackupService({
      database,
      backupService,
      backupsDirectory,
      scheduleFn: scheduler.scheduleFn,
      clearFn: scheduler.clearFn,
      loadSettings: () => saved,
      saveSettings: (settings) => { saved = settings; },
    });
    expect(service.getSettings()).toEqual({ directory: '', keepCount: 3 });
    await service.updateSettings({ directory: 'D:\\备份', keepCount: 5 });
    expect(service.getSettings().keepCount).toBe(5);
    expect(service.getSettings().directory).toContain('备份');
  });

  it('备份失败时记录 lastError，状态可查询且 running 复位', async () => {
    const { database, backupsDirectory } = await makeFixture();
    const failingBackupService = {
      createBackup: async () => {
        throw new Error('磁盘已满');
      },
    } as unknown as BackupService;
    const scheduler = makeFakeScheduler();
    const service = new AutoBackupService({
      database,
      backupService: failingBackupService,
      backupsDirectory,
      scheduleFn: scheduler.scheduleFn,
      clearFn: scheduler.clearFn,
    });

    await expect(service.start()).rejects.toThrow('磁盘已满');
    const status = await service.getStatus();
    expect(status.lastResult).toBe('failed');
    expect(status.lastError).toBe('磁盘已满');
    expect(status.running).toBe(false);
  });

  it('stop() 之后不再持有定时器（可安全重复调用）', async () => {
    const { database, backupsDirectory, backupService } = await makeFixture();
    await touchAutoBackup(backupsDirectory, new Date().toISOString());
    const scheduler = makeFakeScheduler();
    const service = new AutoBackupService({
      database,
      backupService,
      backupsDirectory,
      scheduleFn: scheduler.scheduleFn,
      clearFn: scheduler.clearFn,
    });
    await service.start();
    service.stop();
    service.stop(); // 幂等
    expect((service as unknown as { timerHandle: unknown }).timerHandle).toBeNull();
  });
});
