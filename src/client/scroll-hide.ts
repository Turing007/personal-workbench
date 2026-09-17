/**
 * 悬浮搜索框的滚动收起逻辑。
 * 抽成纯函数，便于在 node 环境下直接单测（与 mobile-tabs / 打印模块同一套做法）。
 */

/** 判定「连续下滑」的累计距离（px）：小于该距离视为手指抖动，不改变收起状态。 */
export const SCROLL_HIDE_THRESHOLD = 24;

/**
 * 判定「回滑展开」的累计距离（px）。
 * 刻意比收起阈值小得多：收起后只要往上短滑一点就该把搜索框唤回来，
 * 不能要求用户一直滑回页面最顶部才能搜索。
 */
export const SCROLL_SHOW_THRESHOLD = 8;

/** 距离顶部多少像素以内始终展开搜索框（刚进页面 / 回到顶部时不该是收起的）。 */
export const SCROLL_HIDE_TOP_OFFSET = 8;

export interface ScrollHideState {
  /** 上一次判定时记录的滚动位置，用于累计连续滑动距离。 */
  lastY: number;
  /** 是否需要收起悬浮搜索框。 */
  hidden: boolean;
}

export interface ScrollHideOptions {
  threshold?: number;
  showThreshold?: number;
  topOffset?: number;
}

/**
 * 由新的滚动位置推导下一个收起状态：
 * - 连续下滑累计超过 threshold → 收起；
 * - 回滑累计超过 showThreshold（远小于 threshold）→ 展开，短滑一下就能唤回；
 * - 回到（接近）顶部 → 始终展开。
 * 未跨越阈值时保持原状态且不更新锚点，这样缓慢的小幅滑动也能累计生效。
 */
export function nextScrollHideState(state: ScrollHideState, y: number, options: ScrollHideOptions = {}): ScrollHideState {
  const threshold = options.threshold ?? SCROLL_HIDE_THRESHOLD;
  const showThreshold = options.showThreshold ?? SCROLL_SHOW_THRESHOLD;
  const topOffset = options.topOffset ?? SCROLL_HIDE_TOP_OFFSET;
  if (y <= topOffset) return { lastY: y, hidden: false };
  const delta = y - state.lastY;
  if (delta >= threshold) return { lastY: y, hidden: true };
  if (delta <= -showThreshold) return { lastY: y, hidden: false };
  return state;
}
