import { describe, expect, it } from 'vitest';
import { cartonLabelRequirement } from '../../src/shared/customers';

describe('箱唛打印取字规则：只印要求，备注不外流', () => {
  it('填了箱唛要求就印要求，内部备注不会跟出去', () => {
    expect(cartonLabelRequirement({ labelRequirement: '外箱贴条码箱唛', remark: '含税运 单价100包邮' }))
      .toBe('外箱贴条码箱唛');
  });

  it('历史数据只有备注时回退打印备注，老订单箱唛不会突然少一行', () => {
    expect(cartonLabelRequirement({ remark: '机器套气泡袋' })).toBe('机器套气泡袋');
  });

  it('要求只剩空格也算没填，仍回退备注', () => {
    expect(cartonLabelRequirement({ labelRequirement: '   ', remark: '贴MUKITOL标' })).toBe('贴MUKITOL标');
  });

  it('两边都没有时返回空串，箱唛上不出这一行', () => {
    expect(cartonLabelRequirement({ labelRequirement: null, remark: undefined })).toBe('');
    expect(cartonLabelRequirement({})).toBe('');
  });

  it('取字时顺手去掉首尾空白，避免箱面上出现悬空空格', () => {
    expect(cartonLabelRequirement({ labelRequirement: '  内盒贴二维码  ' })).toBe('内盒贴二维码');
  });
});
