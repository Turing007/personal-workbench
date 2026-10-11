import { getAppBridge } from './app-bridge';

/** 分块大小：与原生选文件回传一致（2MB），两端内存峰值都压在一块以内。 */
const SAVE_CHUNK_BYTES = 2 * 1024 * 1024;

/** Uint8Array → base64：按 32KB 分段拼接，避免一次展开超长参数把栈撑爆。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const STEP = 0x8000;
  for (let index = 0; index < bytes.length; index += STEP) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + STEP) as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * 浏览器/电脑网页的兜底下载：blob 链接 + 点击。
 * 注意：WebView 会静默忽略这种下载，所以它只适合真正的浏览器环境。
 */
export function downloadBlobInBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

/**
 * 导出文件的统一出口：跑在带保存能力的 App 壳（1.19+）里就把字节分块交给原生，
 * 由它写进手机「下载」并弹出系统分享面板；浏览器或旧版 App 回退 blob 链接下载。
 */
export async function saveFileOrDownload(blob: Blob, fileName: string): Promise<void> {
  const bridge = getAppBridge();
  if (typeof bridge?.saveFileBegin === 'function') {
    const requestId = `file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let launched = false;
    try {
      launched = bridge.saveFileBegin(requestId, fileName, blob.type || '') === true;
    } catch {
      launched = false;
    }
    if (launched) {
      try {
        for (let offset = 0; offset < blob.size; offset += SAVE_CHUNK_BYTES) {
          const bytes = new Uint8Array(await blob.slice(offset, offset + SAVE_CHUNK_BYTES).arrayBuffer());
          bridge.saveFileChunk?.(requestId, bytesToBase64(bytes));
        }
        bridge.saveFileEnd?.(requestId);
        return;
      } catch (error) {
        try {
          bridge.saveFileAbort?.(requestId);
        } catch {
          /* 中止失败也只能算了，原生侧会有暂存兜底 */
        }
        throw error;
      }
    }
  }
  downloadBlobInBrowser(blob, fileName);
}
