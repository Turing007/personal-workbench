/**
 * 从「收件信息」文本里提取收件人名称。
 *
 * 真实粘贴内容通常混着姓名、电话、省市区地址与括号备注，例如：
 *   收件人：张三 13800000000 广东省深圳市宝安区...
 *   李四
 *   13800000000
 *   上海市浦东新区...
 * 这里只负责找姓名；找不到就返回空串，调用方保留用户已填的值，绝不猜。
 */

const NAME_PREFIX = /^(?:收件人|收货人|联系人|姓名|名字)\s*[:：]?\s*/;
const MOBILE = /(?:\+?86[-\s]?)?1[3-9]\d{9}/g;
const LANDLINE = /0\d{2,3}[-\s]?\d{7,8}/g;
const POSTAL = /\b\d{6}\b/g;
const PARENTHESIZED = /[（(][^）)]{0,24}[）)]/g;

/** 3 个汉字以上且带这些字，基本是地址或公司，不是姓名。 */
const ADDRESS_HINT = /[省市区县镇乡村街道路号栋单元室楼层巷弄]|公司|工厂|仓库|物流|快递|驿站|商行|经营部/;
/** 两个字的常见非姓名词：避免把「仓库」「地址」「电话」当成收件人。 */
const NON_NAME = new Set(['仓库', '公司', '工厂', '单位', '办公', '前台', '地址', '电话', '手机', '收件', '收货', '备注', '默认', '联系人', '姓名']);
const HAN_NAME = /^[\u3400-\u9fff·]{2,8}$/;
const LATIN_NAME = /^[A-Za-z][A-Za-z.'’-]*(?:\s+[A-Za-z][A-Za-z.'’-]*){0,3}$/;

function cleanCandidate(value: string): string {
  return value.replace(/^[\s·:：.、,，;；-]+|[\s·:：.、,，;；-]+$/g, '');
}

function looksLikeName(value: string): boolean {
  const candidate = cleanCandidate(value);
  if (!candidate) return false;
  if (NON_NAME.has(candidate)) return false;
  if (LATIN_NAME.test(candidate)) return true;
  if (!HAN_NAME.test(candidate)) return false;
  if (candidate.length >= 3 && ADDRESS_HINT.test(candidate)) return false;
  return true;
}

export function extractRecipientName(text: string): string {
  if (!text) return '';
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    line = line.replace(NAME_PREFIX, '');
    line = line.replace(PARENTHESIZED, ' ');
    line = line.replace(MOBILE, ' ').replace(LANDLINE, ' ').replace(POSTAL, ' ');

    for (const chunk of line.split(/[，,;；、|/\\]+/).map((item) => item.trim()).filter(Boolean)) {
      // 英文名可能带空格（John Smith），先按整段判断，避免只截到名字的前半截。
      const latin = chunk.match(LATIN_NAME);
      if (latin && !/\d/.test(latin[0])) return latin[0];

      for (const part of chunk.split(/\s+/)) {
        if (looksLikeName(part)) return cleanCandidate(part);
      }
    }
  }
  return '';
}
