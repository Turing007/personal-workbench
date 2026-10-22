/**
 * 网站备案信息：挂在登录页（域名首页）与客户图册页底部。
 * 公安联网备案通过后 30 日内必须悬挂（《计算机信息网络国际联网安全保护管理办法》）。
 * 号码留空时两处都不渲染，本地/测试环境不受影响。
 */
export interface SiteFilings {
  /** 工信部 ICP 备案号，例：粤ICP备2026000000号-1（阿里云备案控制台复制）。 */
  icp: string;
  /** 公安联网备案号，例：粤公网安备 44030002000000号（beian.mps.gov.cn 备案详情里复制）。 */
  publicSecurity: string;
  /** 公安备案号里的数字段，拼官方查询链接用。 */
  publicSecurityCode: string;
}

export const SITE_FILINGS: SiteFilings = {
  icp: '鄂ICP备2026056865号',
  publicSecurity: '苏公网安备32068102810696号',
  publicSecurityCode: '32068102810696',
};

export interface BeianFooterItem {
  text: string;
  /** 官方查询/备案系统链接；无链接时按纯文本渲染。 */
  href?: string;
}

/** 组装底部备案行：ICP 号链工信部备案系统，公安号链官方查询页（带备案号 code）。 */
export function beianFooterItems(filings: SiteFilings): BeianFooterItem[] {
  const items: BeianFooterItem[] = [];
  const icp = filings.icp.trim();
  if (icp) items.push({ text: icp, href: 'https://beian.miit.gov.cn/' });
  const publicSecurity = filings.publicSecurity.trim();
  if (publicSecurity) {
    const code = filings.publicSecurityCode.trim();
    items.push({
      text: publicSecurity,
      href: code ? `https://beian.mps.gov.cn/#/query/webSearch?code=${encodeURIComponent(code)}` : undefined,
    });
  }
  return items;
}
