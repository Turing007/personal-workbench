import { useEffect, useState } from 'react';
import { nextScrollHideState, type ScrollHideState } from './scroll-hide';

const DEFAULT_OFFSET_PARENT_SELECTOR = '.app-content';

/**
 * 当前真实的滚动位置。本应用 .app-layout / .app-content 只设了 min-height，
 * 内容变高后是文档本身在滚；但若某天布局改成固定高度、由 .app-content 内部滚动，
 * 这里也能同时兼容，取两者较大值即可。
 */
function readScrollTop(inner: HTMLElement | null): number {
  const innerTop = inner ? inner.scrollTop : 0;
  const outerTop = window.scrollY || document.scrollingElement?.scrollTop || 0;
  return Math.max(innerTop, outerTop);
}

/**
 * 滚动方向感知：连续下滑时返回 true（用于收起悬浮搜索框），回滑或回到顶部时返回 false。
 * enabled 传入 false 会立即复位为「展开」，并能顺带在输入框获得焦点时锁住展开状态。
 */
export function useHideOnScroll(enabled: boolean, containerSelector = DEFAULT_OFFSET_PARENT_SELECTOR): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    const container = document.querySelector(containerSelector);
    const inner = container instanceof HTMLElement ? container : null;

    let state: ScrollHideState = { lastY: readScrollTop(inner), hidden: false };
    const handleScroll = () => {
      state = nextScrollHideState(state, readScrollTop(inner));
      setHidden(state.hidden);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    inner?.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener('scroll', handleScroll);
      inner?.removeEventListener('scroll', handleScroll);
    };
  }, [enabled, containerSelector]);

  return hidden;
}
