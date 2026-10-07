import { describe, expect, it } from 'vitest';
import {
  dropFileDrop,
  enterFileDrop,
  FILE_DRAG_TYPE,
  INITIAL_FILE_DROP_STATE,
  isFileDrag,
  isFileDropActive,
  leaveFileDrop,
  type FileDropState,
} from '../../src/client/file-drop';

function enters(state: FileDropState, times: number): FileDropState {
  let next = state;
  for (let index = 0; index < times; index += 1) next = enterFileDrop(next);
  return next;
}

describe('附件拖拽区的进入计数', () => {
  it('拖进一次就高亮，拖出后恢复', () => {
    const entered = enterFileDrop(INITIAL_FILE_DROP_STATE);
    expect(isFileDropActive(entered)).toBe(true);
    expect(isFileDropActive(leaveFileDrop(entered))).toBe(false);
  });

  it('拖过子元素造成的连续进出不会把高亮闪掉', () => {
    // 进入父元素 → 进入子元素（再次 dragenter）→ 离开子元素（一次 dragleave）
    const nested = leaveFileDrop(enters(INITIAL_FILE_DROP_STATE, 2));
    expect(isFileDropActive(nested)).toBe(true);
    // 真正离开整个区域后才熄灭
    expect(isFileDropActive(leaveFileDrop(nested))).toBe(false);
  });

  it('未配对的事件不会把计数拖成负数', () => {
    const state = leaveFileDrop(leaveFileDrop(INITIAL_FILE_DROP_STATE));
    expect(state.depth).toBe(0);
    expect(isFileDropActive(enterFileDrop(state))).toBe(true);
  });

  it('drop 后直接归零，即使拖拽期间计数虚高', () => {
    const messy = enters(INITIAL_FILE_DROP_STATE, 5);
    expect(dropFileDrop().depth).toBe(0);
    // 归零后再拖进来仍能正常高亮
    expect(isFileDropActive(enterFileDrop(dropFileDrop()))).toBe(true);
    expect(messy.depth).toBe(5);
  });
});

describe('只接受文件拖拽', () => {
  it('dataTransfer.types 含 Files 才算文件拖拽', () => {
    expect(isFileDrag([FILE_DRAG_TYPE])).toBe(true);
    expect(isFileDrag(['Files', 'text/plain'])).toBe(true);
  });

  it('页面内拖文字/元素不触发附件区', () => {
    expect(isFileDrag(['text/plain'])).toBe(false);
    expect(isFileDrag([])).toBe(false);
    expect(isFileDrag(undefined)).toBe(false);
  });
});
