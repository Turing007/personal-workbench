export const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

/** 与后端 file-store 的报错文案保持一致，避免前后端提示不一样。 */
export const SUPPORTED_IMAGE_HINT = '仅支持 JPG、PNG、WebP 图片';

const MIME_BY_EXTENSION: Record<string, SupportedImageMime> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * 兼容老旧安卓 WebView 的取扩展名实现。
 * 不使用 String.prototype.replaceAll / Array.prototype.at 这类较新的 API：
 * 老内核（Chrome < 85）没有 replaceAll，会直接抛异常，把整条上传链路静默打断。
 */
function extensionOf(fileName: string): string {
  const normalized = fileName.split('\\').join('/');
  const segments = normalized.split('/');
  const base = segments.length > 0 ? segments[segments.length - 1] : '';
  const index = base.lastIndexOf('.');
  return index >= 0 ? base.slice(index + 1).toLowerCase() : '';
}

function isSupportedMime(mime: string): mime is SupportedImageMime {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

/** 文件头兜底：部分安卓选图/拍照回来的文件既没有 MIME 也没有扩展名，只能看魔术字节。 */
function mimeFromSignature(bytes: Uint8Array): SupportedImageMime | undefined {
  const [b0, b1, b2, b3] = bytes;
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'image/jpeg';
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'image/png';
  const isWebp = bytes.length >= 12
    && b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return isWebp ? 'image/webp' : undefined;
}

/** 用 FileReader 读文件头，作为 Blob.arrayBuffer 不可用时的兜底。 */
function readHeadWithFileReader(blob: Blob): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    if (typeof FileReader !== 'function') {
      resolve(undefined);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(result instanceof ArrayBuffer ? new Uint8Array(result) : undefined);
    };
    reader.onerror = () => resolve(undefined);
    reader.onabort = () => resolve(undefined);
    try {
      reader.readAsArrayBuffer(blob);
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * 读取文件前若干字节用于魔术字节识别。
 * Blob.prototype.arrayBuffer 需要 Chrome 76+，老 WebView 上没有，这里做降级兜底，
 * 任何一步异常都返回 undefined，绝不让异常冒泡打断上传。
 */
async function readHead(blob: Blob, length: number): Promise<Uint8Array | undefined> {
  let slice: Blob;
  try {
    slice = blob.slice(0, length);
  } catch {
    return undefined;
  }
  if (typeof slice.arrayBuffer === 'function') {
    try {
      return new Uint8Array(await slice.arrayBuffer());
    } catch {
      return readHeadWithFileReader(slice);
    }
  }
  return readHeadWithFileReader(slice);
}

/**
 * 手机端系统选图/拍照拿到的文件经常没有可用的 MIME：file.type 可能是空字符串，
 * 也可能是 application/octet-stream。之前只按 file.type 过滤，整张图被静默丢弃，
 * 唯一的提示又被手机端 CSS 隐藏，使用者感觉「点了没反应」。
 * 这里依次用 MIME、扩展名、文件头兜底识别，识别不出才判定为不支持。
 */
export async function resolveUploadImageMime(file: File): Promise<SupportedImageMime | undefined> {
  if (isSupportedMime(file.type)) return file.type;
  const byExtension = MIME_BY_EXTENSION[extensionOf(file.name || '')];
  if (byExtension) return byExtension;
  const head = await readHead(file, 12);
  return head ? mimeFromSignature(head) : undefined;
}

/**
 * 识别并统一回写 MIME，保证 FormData 上传时带的是后端允许的 Content-Type。
 * file.type 为空时浏览器会发 application/octet-stream，会被后端直接拒绝。
 * 返回 undefined 表示这不是可上传的图片格式。
 */
export async function normalizeUploadImage(file: File): Promise<File | undefined> {
  const mime = await resolveUploadImageMime(file);
  if (!mime) return undefined;
  if (file.type === mime) return file;
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return new File([file], file.name || `image.${extension}`, { type: mime, lastModified: file.lastModified });
}
