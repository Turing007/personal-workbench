import { describe, expect, it } from 'vitest';
import {
  SCROLL_HIDE_THRESHOLD,
  SCROLL_SHOW_THRESHOLD,
  nextScrollHideState,
  type ScrollHideState,
} from '../../src/client/scroll-hide';

function scrollTo(positions: number[], start: ScrollHideState = { lastY: 0, hidden: false }): ScrollHideState {
  return positions.reduce((state, y) => nextScrollHideState(state, y), start);
}

describe('nextScrollHideState', () => {
  it('starts expanded and keeps the search box expanded near the top', () => {
    expect(nextScrollHideState({ lastY: 0, hidden: false }, 0).hidden).toBe(false);
    expect(nextScrollHideState({ lastY: 300, hidden: true }, 4).hidden).toBe(false);
  });

  it('collapses the search box after a continuous downward scroll', () => {
    const state = scrollTo([0, 200]);
    expect(state.hidden).toBe(true);
    expect(state.lastY).toBe(200);
  });

  it('accumulates slow scrolling until the threshold is crossed', () => {
    const state = scrollTo([0, 10, 20, 30]);
    expect(state.hidden).toBe(true);
  });

  it('ignores jitter smaller than the threshold', () => {
    const state = nextScrollHideState({ lastY: 200, hidden: true }, 210);
    expect(state).toEqual({ lastY: 200, hidden: true });
    expect(SCROLL_HIDE_THRESHOLD).toBeLessThan(200);
  });

  it('expands again as soon as the user scrolls back up', () => {
    const state = scrollTo([0, 400, 300]);
    expect(state.hidden).toBe(false);
    expect(state.lastY).toBe(300);
  });

  it('reveals the search box after only a short slide back, without returning to the top', () => {
    const collapsed = scrollTo([0, 2000]);
    expect(collapsed.hidden).toBe(true);
    const revealed = nextScrollHideState(collapsed, 1985);
    expect(revealed.hidden).toBe(false);
    expect(revealed.lastY).toBe(1985);
  });

  it('uses a reveal threshold far smaller than the hide threshold', () => {
    expect(SCROLL_SHOW_THRESHOLD).toBeLessThan(SCROLL_HIDE_THRESHOLD);
    expect(SCROLL_SHOW_THRESHOLD).toBeLessThanOrEqual(10);
  });

  it('still needs a full downward gesture to collapse again after revealing', () => {
    const revealed = nextScrollHideState({ lastY: 300, hidden: true }, 290);
    expect(revealed).toEqual({ lastY: 290, hidden: false });
    expect(nextScrollHideState(revealed, 290 + SCROLL_HIDE_THRESHOLD - 1).hidden).toBe(false);
    expect(nextScrollHideState(revealed, 290 + SCROLL_HIDE_THRESHOLD).hidden).toBe(true);
  });

  it('treats a rubber-band overscroll as still expanded', () => {
    expect(nextScrollHideState({ lastY: 0, hidden: true }, -40).hidden).toBe(false);
  });

  it('honours custom thresholds and top offsets', () => {
    const collapsed = nextScrollHideState({ lastY: 0, hidden: false }, 20, { threshold: 10, topOffset: 0 });
    expect(collapsed.hidden).toBe(true);
    const revealed = nextScrollHideState({ lastY: 400, hidden: true }, 396, { showThreshold: 3 });
    expect(revealed.hidden).toBe(false);
    const forced = nextScrollHideState({ lastY: 500, hidden: true }, 5, { topOffset: 10 });
    expect(forced.hidden).toBe(false);
  });
});
