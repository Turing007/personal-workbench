import { describe, expect, it } from 'vitest';
import { beianFooterItems } from '../../src/shared/site-filings';

describe('底部备案行', () => {
  it('ICP 号链工信部备案系统，公安备案号链官方查询页（带 code）', () => {
    expect(
      beianFooterItems({ icp: '粤ICP备2026000000号-1', publicSecurity: '粤公网安备 44030002000000号', publicSecurityCode: '44030002000000' }),
    ).toEqual([
      { text: '粤ICP备2026000000号-1', href: 'https://beian.miit.gov.cn/' },
      { text: '粤公网安备 44030002000000号', href: 'https://beian.mps.gov.cn/#/query/webSearch?code=44030002000000' },
    ]);
  });

  it('号码留空不产生条目（两处都不渲染）；公安号没有 code 时为纯文本', () => {
    expect(beianFooterItems({ icp: '', publicSecurity: '', publicSecurityCode: '' })).toEqual([]);
    expect(
      beianFooterItems({ icp: '', publicSecurity: '粤公网安备 44030002000000号', publicSecurityCode: '' }),
    ).toEqual([{ text: '粤公网安备 44030002000000号' }]);
  });
});
