import { describe, expect, it } from 'vitest';
import { extractRecipientName } from '../../src/client/order-recipient';

describe('从收件信息提取收件人名称', () => {
  it('识别常见前缀、电话与省市区地址', () => {
    expect(extractRecipientName('收件人：张三 13800000000 广东省深圳市宝安区演示路 88 号')).toBe('张三');
    expect(extractRecipientName('收货人: 陈经理\n联系电话：13800000000\n上海市浦东新区')).toBe('陈经理');
  });

  it('多行文本优先使用第一行的姓名', () => {
    expect(extractRecipientName('李四\n13800000000\n广东省广州市天河区')).toBe('李四');
  });

  it('电话写在姓名前面也能找到姓名', () => {
    expect(extractRecipientName('13800000000 王五 浙江省义乌市')).toBe('王五');
  });

  it('英文名保留完整姓名，不截成半截', () => {
    expect(extractRecipientName('John Smith, +86 13800000000, Shenzhen')).toBe('John Smith');
  });

  it('括号备注不进入姓名', () => {
    expect(extractRecipientName('收件人：欧阳娜娜（前台） 13800000000')).toBe('欧阳娜娜');
  });

  it('只有地址或非姓名词时保持为空，不瞎猜', () => {
    expect(extractRecipientName('广东省深圳市宝安区演示路 88 号')).toBe('');
    expect(extractRecipientName('仓库 13800000000 上海市')).toBe('');
    expect(extractRecipientName('电话：13800000000')).toBe('');
    expect(extractRecipientName('')).toBe('');
  });
});
