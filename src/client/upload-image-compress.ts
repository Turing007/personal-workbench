/**
 * 上传前的手机端预压缩：产品图在联网上传前先在本地压到「长边 2048 + 质量 85」。
 *
 * 原图一张实拍图 8~12MB，走手机网络传要好一阵；而服务器本来也会把图压到这个档位。
 * 提前在本地压好，上传体积约降 80%，服务器也基本不用再压（免受 2 核 CPU 排队拖累）。
 * 上传的仍是同一张图（只缩尺寸、不裁切），EXIF 方向在解码时自动摆正。
 */
export const UPLOAD_IMAGE_MAX_EDGE = 2048;
export const UPLOAD_IMAGE_QUALITY = 0.85;
/** 长边已达标且不超过这个体积的图直接跳过，不折腾（重压反而伤画质）。 */
const SKIP_UNDER_BYTES = 700 * 1024;

/** 生成中串行排队：多张原图同时解码会瞬时叠加大块内存，一张一张来最稳。 */
let compressQueue: Promise<unknown> = Promise.resolve();

/** 压不动就用原图 —— 无论怎么失败，绝不能挡上传。 */
export function compressImageForUpload(file: File): Promise<File> {
  const run = compressQueue.then(() => compress(file), () => compress(file));
  compressQueue = run.catch(() => undefined);
  return run;
}

async function compress(file: File): Promise<File> {
  try {
    // 只处理静态 JPEG/PNG/WebP；GIF（可能带动画）、视频等一律原样上传。
    const isPng = file.type === 'image/png';
    const isWebp = file.type === 'image/webp';
    if (!isPng && !isWebp && file.type !== 'image/jpeg') return file;
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file;

    const bitmap = await createImageBitmap(file);
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    if (longestEdge <= UPLOAD_IMAGE_MAX_EDGE && file.size <= SKIP_UNDER_BYTES) {
      bitmap.close?.();
      return file;
    }

    const scale = Math.min(1, UPLOAD_IMAGE_MAX_EDGE / longestEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close?.();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const type = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), type, UPLOAD_IMAGE_QUALITY));
    // 压完反而更大（小图/已高度压缩过的图常见）就保持原文件。
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name || '图片.jpg', { type: blob.type, lastModified: file.lastModified });
  } catch {
    return file;
  }
}
