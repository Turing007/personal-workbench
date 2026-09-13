import type { FastifyInstance, FastifyRequest } from 'fastify';
import { basename, join } from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { BackupError, BackupService } from '../backup/backup-service.js';
import { AutoBackupService } from '../backup/auto-backup-service.js';
import { ApiError, asRecord, sendFailure, sendSuccess } from './api-response.js';
import { requireAdmin } from './auth.js';

interface BackupRouteOptions {
  service: BackupService;
  backupsDirectory: string;
  autoBackupService?: AutoBackupService;
}

function asBackupError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof BackupError) {
    return new ApiError(error.code === 'INVALID_BACKUP' ? 400 : 500, error.code, error.message);
  }
  return new ApiError(500, 'BACKUP_FAILED', error instanceof Error ? error.message : '备份操作失败');
}

async function readMultipartBuffer(request: FastifyRequest): Promise<Buffer> {
  const file = await request.file();
  if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择备份 ZIP 文件', 'file');
  return file.toBuffer();
}

function safeBackupFileName(value: string): string {
  const fileName = basename(value);
  if (fileName !== value || !/^(?:个人工作台备份|自动备份-个人工作台)-[0-9TZ]+\.zip$/.test(fileName)) {
    throw new ApiError(400, 'INVALID_BACKUP_NAME', '备份文件名无效');
  }
  return fileName;
}

export async function registerBackupRoutes(app: FastifyInstance, options: BackupRouteOptions): Promise<void> {
  const { service, autoBackupService } = options;

  if (autoBackupService) {
    app.get('/api/backups/auto/status', async (_request, reply) => {
      try {
        return sendSuccess(reply, await autoBackupService.getStatus());
      } catch (error) {
        return sendFailure(reply, asBackupError(error));
      }
    });

    app.get('/api/backups/auto/settings', async (_request, reply) => {
      try {
        return sendSuccess(reply, autoBackupService.getSettings());
      } catch (error) {
        return sendFailure(reply, asBackupError(error));
      }
    });

    app.put('/api/backups/auto/settings', async (request, reply) => {
      try {
        const body = asRecord(request.body);
        const input: { directory?: string; keepCount?: number } = {};
        if ('directory' in body) {
          if (body.directory !== null && typeof body.directory !== 'string') {
            throw new ApiError(400, 'VALIDATION_ERROR', '备份目录必须是文本', 'directory');
          }
          input.directory = String(body.directory ?? '');
        }
        if ('keepCount' in body) {
          const keep = Number(body.keepCount);
          if (!Number.isInteger(keep)) {
            throw new ApiError(400, 'VALIDATION_ERROR', '保留份数必须是整数', 'keepCount');
          }
          input.keepCount = keep;
        }
        return sendSuccess(reply, await autoBackupService.updateSettings(input));
      } catch (error) {
        if (error instanceof ApiError) return sendFailure(reply, error);
        return sendFailure(reply, new ApiError(400, 'VALIDATION_ERROR', error instanceof Error ? error.message : '自动备份设置无效'));
      }
    });

    app.post('/api/backups/auto/run', async (_request, reply) => {
      try {
        const result = await autoBackupService.runNow();
        return sendSuccess(reply, { ...result, downloadUrl: `/api/backups/download/${encodeURIComponent(result.fileName)}` }, 201);
      } catch (error) {
        return sendFailure(reply, asBackupError(error));
      }
    });
  }

  app.post('/api/backups', async (_request, reply) => {
    try {
      const backup = await service.createBackup();
      return sendSuccess(reply, {
        fileName: backup.fileName,
        createdAt: backup.manifest.createdAt,
        recordCounts: backup.manifest.recordCounts,
        downloadUrl: `/api/backups/download/${encodeURIComponent(backup.fileName)}`,
      }, 201);
    } catch (error) {
      return sendFailure(reply, asBackupError(error));
    }
  });

  app.post('/api/backups/preview', async (request, reply) => {
    try {
      const manifest = await service.previewBackup(await readMultipartBuffer(request));
      return sendSuccess(reply, manifest);
    } catch (error) {
      return sendFailure(reply, asBackupError(error));
    }
  });

  app.post('/api/backups/restore', async (request, reply) => {
    try {
      // 恢复会覆盖全库，属于破坏性操作，仅管理员可执行。
      requireAdmin(request);
      const result = await service.restoreBackup(await readMultipartBuffer(request));
      return sendSuccess(reply, result);
    } catch (error) {
      return sendFailure(reply, asBackupError(error));
    }
  });

  app.get('/api/backups/download/:fileName', async (request: FastifyRequest<{ Params: { fileName: string } }>, reply) => {
    try {
      const fileName = safeBackupFileName(request.params.fileName);
      // 自动备份可能保存在自定义目录：先找默认目录，找不到再找自定义目录（反之亦然）。
      const candidateDirectories = [options.backupsDirectory];
      if (autoBackupService) {
        const customDirectory = autoBackupService.getSettings().directory;
        if (customDirectory && candidateDirectories[0] !== customDirectory) candidateDirectories.push(customDirectory);
      }
      let filePath: string | null = null;
      for (const directory of candidateDirectories) {
        const candidate = join(directory, fileName);
        try {
          const fileStat = await stat(candidate);
          if (fileStat.isFile()) {
            filePath = candidate;
            break;
          }
        } catch {
          // 尝试下一个候选目录
        }
      }
      if (!filePath) throw new ApiError(404, 'NOT_FOUND', '备份文件不存在');
      const stream = createReadStream(filePath);
      stream.on('error', () => {
        if (!reply.sent) void reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: '备份文件不存在' } });
      });
      return reply
        .type('application/zip')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
        .send(stream);
    } catch (error) {
      return sendFailure(reply, asBackupError(error));
    }
  });
}
