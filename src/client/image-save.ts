import { getAppBridge, saveImageDataNatively, saveImageNatively } from './app-bridge';
import { reportClientDiagnostic } from './api';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 纯函数 base64 编码：老 WebView 的 btoa 处理不了大段二进制字符，自己按 3 字节一组来。 */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    chunk += BASE64_ALPHABET[first >> 2]!;
    chunk += BASE64_ALPHABET[((first & 0b11) << 4) | ((second ?? 0) >> 4)]!;
    chunk += second === undefined ? '=' : BASE64_ALPHABET[((second & 0b1111) << 2) | ((third ?? 0) >> 6)]!;
    chunk += third === undefined ? '=' : BASE64_ALPHABET[third & 0b111111]!;
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  if (chunk) parts.push(chunk);
  return parts.join('');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

/** 用网页端网络栈抓取图片字节（壳自己的下载在个别机型上会静默失败）。 */
export async function fetchImageBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
}

export type ImageSaveStage = 'fetch' | 'download' | 'write' | 'decode' | 'url' | 'permission' | 'bridge';

const SAVE_STAGE_TEXT: Record<ImageSaveStage, string> = {
  fetch: '图片抓取失败',
  download: '图片下载失败',
  write: '写入相册失败',
  decode: '图片数据异常',
  url: '图片地址异常',
  permission: '存储权限被拒绝',
  bridge: '保存入口不可用',
};

/** 失败环节 → 用户可读文案；未知环节原样带出，便于回报。 */
export function saveStageText(stage: string): string {
  const known = SAVE_STAGE_TEXT[stage as ImageSaveStage];
  if (known) return known;
  return stage ? `保存失败（${stage}）` : '保存失败';
}

export interface SaveStartResult {
  /** true = 已交给原生并等它的完成回执；false = 这次没启动成功（不会有原生回执）。 */
  started: boolean;
  stage?: ImageSaveStage | string;
  message?: string;
}

/**
 * 启动一张图片的保存。
 * 1.18+ 的壳：网页抓图（WebView 网络栈已被证明可用）→ 原生只负责写相册；
 * 旧壳：退回「原生自己下载」的通道，地址升级为完整地址，壳不再需要自己拼接。
 */
export async function startSaveImageToAlbum(url: string, name?: string): Promise<SaveStartResult> {
  let absolute = url;
  try {
    absolute = new URL(url, window.location.origin).href;
  } catch {
    /* 不是相对地址就原样透传 */
  }
  const bridge = getAppBridge();
  if (bridge && typeof bridge.saveImageData === 'function') {
    let base64 = '';
    try {
      base64 = await fetchImageBase64(absolute);
    } catch (error) {
      return { started: false, stage: 'fetch', message: errorMessage(error) };
    }
    if (!saveImageDataNatively(base64, name)) return { started: false, stage: 'bridge', message: '' };
    return { started: true };
  }
  if (!saveImageNatively(absolute, name)) return { started: false, stage: 'bridge', message: '' };
  return { started: true };
}

/** 失败回报：界面提示用 saveStageText，服务端日志靠这里（失败也静默，不能反过来打扰用户）。 */
export function reportImageSaveFailure(stage: string, message: string): void {
  void reportClientDiagnostic({ kind: 'image-save', stage, message }).catch(() => undefined);
}
