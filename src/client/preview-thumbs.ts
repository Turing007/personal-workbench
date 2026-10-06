/**
 * 待上传图片在界面上的展示缩略图。
 *
 * 相机实拍图动辄 1200 万像素，直接把原图塞进 <img>，一张解码就要约 48MB 内存 ——
 * 手机上同时渲染多张待传图时会把 WebView 内存打爆（整个 App 闪退）。这里统一把
 * 预览压到最长边约 480px 的小图；上传用的原始 File 不动，画质不受影响。
 */
const THUMB_MAX_EDGE = 480;

/** 生成中串行排队：多张图同时解码会瞬时叠加大块内存，一张一张来最稳。 */
let thumbQueue: Promise<unknown> = Promise.resolve();

export function createImageThumbUrl(file: File, maxEdge = THUMB_MAX_EDGE): Promise<string | undefined> {
  const run = thumbQueue.then(() => generate(file, maxEdge), () => generate(file, maxEdge));
  thumbQueue = run.catch(() => undefined);
  return run;
}

async function generate(file: File, maxEdge: number): Promise<string | undefined> {
  try {
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return undefined;
    // resizeWidth 让浏览器在解码阶段就缩到目标尺寸（老内核不支持时退化为整图解码 +
    // canvas 缩放，单张峰值可控）；EXIF 方向由 createImageBitmap 默认处理。
    const bitmap = await createImageBitmap(file, { resizeWidth: maxEdge, resizeQuality: 'medium' });
    const scale = Math.min(1, maxEdge / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close?.();
      return undefined;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    // PNG 保留透明底；照片统一转 JPEG，体积最小。
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), type, 0.82));
    if (!blob) return undefined;
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}
