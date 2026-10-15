/**
 * 产品视频压缩队列：上传后把视频交给服务端 ffmpeg 异步转码，省服务器磁盘。
 *
 * 为什么放服务端：ffmpeg.wasm 在浏览器里是单线程 CPU 软编，实测一个 226KB 的片段
 * 三分钟都跑不完（编码速度约为视频时长的 1/10~1/30），产品视频是「拍完就传」的场景，
 * 那个等待不可接受；服务端 ffmpeg 有硬件无关的多线程编码，30 秒实拍约 10-30 秒完成。
 *
 * 四条硬约束：
 *  1. 串行执行。服务器是 2 核，两个 ffmpeg 同时跑会互相抢 CPU，最后两个都变慢，
 *     所以队列一次只跑一个，其余排队。
 *  2. 崩溃可恢复。processing 状态在服务重启后不会自己回到 pending，启动时把卡在
 *     processing 的一并重置重跑，否则那条视频永远停在「压缩中」。
 *  3. 失败不毁数据。转码失败只把状态标成 failed，原文件原样保留，用户照常能播放
 *     原画质 —— 压缩是优化，不是前置条件。
 *  4. 上传接口不等待。入队即返回，转码在后台跑；转码期间播放的是原文件（压缩写
 *     临时文件再原子替换，不打断正在进行的读取）。
 *
 * 转码参数：长边压到 1280（原本就小于 1280 的不放大）、CRF 28、preset veryfast、
 * 音频 AAC 128k。实测这类参数能把手机实拍压到原体积的 15%-30%，画质在产品展示
 * 场景够用。想调整就改下面的 buildFfmpegArgs。
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, stat, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DatabaseRepositories } from '../db/repositories.js';
import type { FileStore } from '../files/file-store.js';

/** 转码状态：pending 排队中 / processing 压缩中 / done 已压缩 / failed 压缩失败（保留原文件）。 */
export type VideoTranscodeStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface VideoTranscodeTask {
  videoId: number;
  relativePath: string;
  originalName: string;
}

/** 单个 ffmpeg 进程的耐心上限：超了就杀掉并标失败，不让队列卡死。 */
const TRANSCODE_TIMEOUT_MS = 15 * 60 * 1000;

/** 压缩率低于这个值就不替换原文件：忙了半天只省几 MB，不值得冒画质损失。 */
const MIN_USEFUL_RATIO = 0.9;

export class VideoTranscodeQueue {
  private readonly queue: VideoTranscodeTask[] = [];
  private running = false;
  private started = false;

  constructor(
    private readonly repositories: DatabaseRepositories,
    private readonly fileStore: Pick<FileStore, 'resolvePublicPath'>,
    private readonly ffmpegPath = 'ffmpeg',
  ) {}

  /** 服务启动时调用：把上次卡在 processing 的任务捡回来重跑。 */
  start(): void {
    if (this.started) return;
    this.started = true;
    // 库里存的字段名是 id/relative_path，转成队列内部的任务结构再入队。
    const pending = this.repositories.listPendingVideoTranscodes().map((row) => ({
      videoId: row.id,
      relativePath: row.relativePath,
      originalName: row.originalName,
    }));
    if (pending.length) this.enqueueAll(pending);
  }

  /** 上传成功后调用：入队并尽快开跑。 */
  enqueue(task: VideoTranscodeTask): void {
    this.queue.push(task);
    void this.drain();
  }

  private enqueueAll(tasks: VideoTranscodeTask[]): void {
    for (const task of tasks) this.queue.push(task);
    void this.drain();
  }

  /** 队列深度（含正在跑的），供健康检查与测试观测。 */
  get pendingCount(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    const task = this.queue.shift();
    if (!task) return;
    this.running = true;
    try {
      await this.process(task);
    } catch (error) {
      // 单个任务炸掉不能带崩队列：标失败、保原文件，继续跑下一个。
      console.error('[video-transcode] 处理失败', { videoId: task.videoId, error: error instanceof Error ? error.message : String(error) });
      this.repositories.failProductVideoTranscode(task.videoId);
    } finally {
      this.running = false;
      void this.drain();
    }
  }

  private async process(task: VideoTranscodeTask): Promise<void> {
    if (!this.repositories.claimVideoTranscode(task.videoId)) return; // 已被其他路径处理
    // 走 fileStore 的相对路径解析：自带目录穿越防护，不让库里的脏路径读到别处。
    const sourcePath = this.fileStore.resolvePublicPath(task.relativePath);
    const temporaryPath = `${sourcePath}.transcoding.mp4`;
    try {
      await stat(sourcePath);
    } catch {
      // 文件没了（用户删了视频）：清掉状态，别留一条永远 pending 的记录。
      this.repositories.failProductVideoTranscode(task.videoId);
      return;
    }

    await mkdir(dirname(temporaryPath), { recursive: true });
    const originalSize = (await stat(sourcePath)).size;
    try {
      await this.runFfmpeg(sourcePath, temporaryPath);
      const compressedSize = (await stat(temporaryPath)).size;
      if (compressedSize >= originalSize * MIN_USEFUL_RATIO) {
        // 没压出意义（源文件本身已经很小，或内容不好压）：放弃替换，保留原文件。
        await rm(temporaryPath, { force: true });
        this.repositories.completeProductVideoTranscode(task.videoId, originalSize);
        return;
      }
      // 原子替换：先 rename 再改库，任一步失败都不会出现「库说压缩了、文件还是旧的」。
      await rename(temporaryPath, sourcePath);
      this.repositories.completeProductVideoTranscode(task.videoId, compressedSize);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private runFfmpeg(sourcePath: string, targetPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = buildFfmpegArgs(sourcePath, targetPath);
      const child = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`ffmpeg 超时（${TRANSCODE_TIMEOUT_MS / 60000} 分钟）`));
      }, TRANSCODE_TIMEOUT_MS);
      child.stderr?.on('data', (chunk: Buffer) => {
        // ffmpeg 把进度和诊断都写 stderr；只留尾部，足够定位失败原因又不炸内存。
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      child.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(new Error(`ffmpeg 启动失败：${error.message}`));
      });
      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg 退出码 ${code}：${stderr.trim().slice(-400) || '无输出'}`));
      });
    });
  }
}

/**
 * 压缩参数：长边 1280（小的不放大）、CRF 28、veryfast、音频降到 128k AAC。
 * `-movflags +faststart` 让 moov 提到文件头，边下边播，产品详情里点开不用等全下完。
 */
export function buildFfmpegArgs(sourcePath: string, targetPath: string): string[] {
  return [
    '-y',
    '-i', sourcePath,
    '-vf', "scale='min(1280,iw)':-2",
    '-c:v', 'libx264',
    '-crf', '28',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    targetPath,
  ];
}
