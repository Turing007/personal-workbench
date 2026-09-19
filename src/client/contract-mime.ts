import { extensionOf } from './image-mime';

/** 与后端 file-store 的 contractExtensionsByMime 一一对应：服务端要求 MIME 与扩展名互相匹配。 */
const CONTRACT_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** 与后端 file-store 的报错文案保持一致，避免前后端提示不一样。 */
export const SUPPORTED_CONTRACT_HINT = '合同仅支持 PDF、Word、Excel 或 PNG/JPEG/WebP 图片';

/** 传给原生选文件桥的 accept 列表；安卓侧识别到混合类型会放宽为任意文件。 */
export const CONTRACT_PICKER_ACCEPT = [...new Set(Object.values(CONTRACT_MIME_BY_EXTENSION))];

/**
 * 每个 MIME 的规范扩展名，取自后端 contractExtensionsByMime 的首选项。
 * 系统 Provider 可能只回传 “file-1726…” 这种没有扩展名的名字，而后端要求扩展名与 MIME 互相配对。
 */
const CONTRACT_PRIMARY_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const CONTRACT_MIME_VALUES = new Set(Object.keys(CONTRACT_PRIMARY_EXTENSION));

/**
 * 手机端选回的文件经常没有可靠 MIME：`file.type` 可能是空字符串、application/octet-stream，
 * 也可能是个别厂商报的 image/jpg。直接上传会被服务端按 MIME 白名单拒掉，所以以扩展名为准回写；
 * 没有扩展名时才退回信任 Provider 的 MIME，并把扩展名补齐。两者都对不上返回 undefined
 * （合同类型多，无法像图片那样只靠文件头识别 docx/xlsx）。
 */
export function normalizeUploadContract(file: File): File | undefined {
  const currentType = file.type.toLowerCase();
  const extension = extensionOf(file.name || '');
  const mime = CONTRACT_MIME_BY_EXTENSION[extension] ?? (CONTRACT_MIME_VALUES.has(currentType) ? currentType : undefined);
  if (!mime) return undefined;
  const name = extension ? file.name : `${file.name || '订单附件'}.${CONTRACT_PRIMARY_EXTENSION[mime]}`;
  if (currentType === mime && name === file.name) return file;
  return new File([file], name, { type: mime, lastModified: file.lastModified });
}
