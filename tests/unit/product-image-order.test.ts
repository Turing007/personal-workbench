import { describe, expect, it } from 'vitest';
import { imageLeadNumber, sortByImageLeadNumber } from '../../src/shared/product-image-order';

describe('图片文件名编号解析', () => {
  it('取扩展名之前的前导数字，支持多位与前导零', () => {
    expect(imageLeadNumber('0.jpg')).toBe(0);
    expect(imageLeadNumber('10.jpg')).toBe(10);
    expect(imageLeadNumber('007.png')).toBe(7);
    expect(imageLeadNumber('12-产品图.jpg')).toBe(12);
  });

  it('不以数字开头的文件名算无编号', () => {
    expect(imageLeadNumber('IMG20260503155537.jpg')).toBeNull();
    expect(imageLeadNumber('fe4e16d786c13310422e07286e80ce85.jpg')).toBeNull();
    expect(imageLeadNumber('产品主图.jpg')).toBeNull();
    expect(imageLeadNumber('.jpg')).toBeNull();
  });

  it('前导连续数字超过四位时不当作序号', () => {
    // IMG20260503 这类时间戳、以及 123456.jpg 这种导出编号，都不该被当成 0..n 的图序。
    expect(imageLeadNumber('12345.jpg')).toBeNull();
    expect(imageLeadNumber('20260503.jpg')).toBeNull();
    expect(imageLeadNumber('1234.jpg')).toBe(1234);
  });
});

describe('图片按编号排序', () => {
  const names = (list: Array<{ name: string }>) => list.map((item) => item.name);

  it('编号按数值升序，不再是字符串序', () => {
    const input = ['0.jpg', '10.jpg', '1.jpg', '2.jpg', '9.jpg'].map((name) => ({ name }));
    expect(names(sortByImageLeadNumber(input))).toEqual(['0.jpg', '1.jpg', '2.jpg', '9.jpg', '10.jpg']);
  });

  it('无编号的保持原相对顺序并排在编号图之后', () => {
    const input = [
      { name: 'IMG20260101.jpg' },
      { name: '10.jpg' },
      { name: 'hash-abc.png' },
      { name: '2.jpg' },
      { name: 'IMG20260102.jpg' },
    ];
    expect(names(sortByImageLeadNumber(input))).toEqual([
      '2.jpg', '10.jpg', 'IMG20260101.jpg', 'hash-abc.png', 'IMG20260102.jpg',
    ]);
  });

  it('编号重复时按原顺序并列，不互相插队', () => {
    const input = [
      { name: '0.jpg', tag: '精修' },
      { name: '0.jpg', tag: '实拍' },
      { name: '1.jpg', tag: '精修' },
    ];
    expect(names(sortByImageLeadNumber(input))).toEqual(['0.jpg', '0.jpg', '1.jpg']);
    expect(sortByImageLeadNumber(input).map((item) => item.tag)).toEqual(['精修', '实拍', '精修']);
  });

  it('不改动传入的数组本身', () => {
    const input = [{ name: '10.jpg' }, { name: '2.jpg' }];
    sortByImageLeadNumber(input);
    expect(names(input)).toEqual(['10.jpg', '2.jpg']);
  });
});
