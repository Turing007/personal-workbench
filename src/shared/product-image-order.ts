/**
 * 产品图片的文件名编号排序规则。
 *
 * 上传一批 0.jpg…10.jpg 时，浏览器/系统返回的顺序常是字符串序（0,10,1,2…），
 * 直接落库就成了产品图乱序，所以统一按文件名前导编号排。
 */

/** 取文件名最前面的编号；IMG2026…、哈希名这类不以数字开头的一律算「无编号」。 */
export function imageLeadNumber(name: string): number | null {
  const base = name.replace(/\.[A-Za-z0-9]{2,5}$/i, '');
  const match = /^0*(\d{1,4})(?!\d)/.exec(base);
  return match ? Number(match[1]) : null;
}

/**
 * 按编号给同一产品的图片排序：编号小的在前；无编号的保持原相对顺序、统一跟在后面；
 * 编号相同（不同文件夹里都有 0.jpg）也保持原相对顺序，不让它们互相插队。
 */
export function sortByImageLeadNumber<T extends { name: string }>(images: readonly T[]): T[] {
  return images
    .map((image, index) => ({ image, index, number: imageLeadNumber(image.name) }))
    .sort((left, right) => {
      if (left.number === null || right.number === null) {
        if (left.number === right.number) return left.index - right.index;
        return left.number === null ? 1 : -1;
      }
      return left.number - right.number || left.index - right.index;
    })
    .map((entry) => entry.image);
}
