import { describe, expect, it } from 'vitest';
import { buildCompanyInvoiceInfoText, formatInvoiceCategories, normalizeInvoiceCategories } from '../../src/shared/companies';

describe('公司开票信息', () => {
  it('可开票类目兼容数组、JSON、顿号/逗号分隔文本，并去空去重限长', () => {
    expect(normalizeInvoiceCategories(['电动工具', ' 电池 ', '电动工具', ''])).toEqual(['电动工具', '电池']);
    expect(normalizeInvoiceCategories('["电动工具","配件"]')).toEqual(['电动工具', '配件']);
    expect(normalizeInvoiceCategories('电动工具、配件,电池；充电器\n其他')).toEqual(['电动工具', '配件', '电池', '充电器', '其他']);
    expect(normalizeInvoiceCategories('   ')).toEqual([]);
    expect(normalizeInvoiceCategories(null)).toEqual([]);
  });

  it('表单展示用中文顿号连接', () => {
    expect(formatInvoiceCategories(['电动工具', '电池'])).toBe('电动工具、电池');
    expect(formatInvoiceCategories(undefined)).toBe('');
  });

  it('一键复制文本包含客户需要的完整开票信息，空字段整行省略', () => {
    const text = buildCompanyInvoiceInfoText({
      shortName: '宁波公司',
      fullName: '宁波某某工具有限公司',
      taxNo: '91330200MA2XXXXXXX',
      bankName: '中国银行宁波分行',
      bankAccount: '123456789012345',
      address: '浙江省宁波市鄞州区某某路 1 号',
      phone: '0574-12345678',
      invoiceCategories: ['电动工具', '电池', '充电器'],
    });
    expect(text).toBe([
      '【开票信息】',
      '公司名称：宁波某某工具有限公司',
      '纳税人识别号：91330200MA2XXXXXXX',
      '注册地址：浙江省宁波市鄞州区某某路 1 号',
      '联系电话：0574-12345678',
      '开户行：中国银行宁波分行',
      '银行账号：123456789012345',
      '可开票类目：电动工具、电池、充电器',
    ].join('\n'));

    expect(buildCompanyInvoiceInfoText({ shortName: '宁波公司', fullName: '', taxNo: '', address: '', phone: '', bankName: '', bankAccount: '', invoiceCategories: [] }))
      .toBe('【开票信息】\n公司名称：宁波公司');
  });
});
