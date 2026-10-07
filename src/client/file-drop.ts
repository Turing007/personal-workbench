/**
 * 附件拖拽区的进入计数逻辑。
 * 抽成纯函数便于单测（与 scroll-hide / mobile-tabs 同一套做法）：
 * 拖过子元素会连续触发 dragenter / dragleave，用计数而不是布尔值才不会让高亮闪烁。
 */

export interface FileDropState {
  /** 当前仍在拖拽区内的层级深度：大于 0 表示应该高亮。 */
  depth: number;
}

export const INITIAL_FILE_DROP_STATE: FileDropState = { depth: 0 };

/** 浏览器在 dataTransfer.types 里用固定字符串标记「拖的是文件」。 */
export const FILE_DRAG_TYPE = 'Files';

/** 拖进来的必须是文件：页面内拖文字、拖元素不应触发附件区高亮。 */
export function isFileDrag(types: readonly string[] | undefined): boolean {
  return Boolean(types && types.indexOf(FILE_DRAG_TYPE) >= 0);
}

export function enterFileDrop(state: FileDropState): FileDropState {
  return { depth: state.depth + 1 };
}

/** 离开时减一，但不低于 0（事件顺序异常时也不会把计数拖成负数）。 */
export function leaveFileDrop(state: FileDropState): FileDropState {
  return { depth: Math.max(0, state.depth - 1) };
}

/**
 * drop 后直接归零，而不是减一：拖拽期间子元素会让计数虚高，
 * 逐个配对不可靠，落点结束后必须回到干净状态。
 */
export function dropFileDrop(): FileDropState {
  return INITIAL_FILE_DROP_STATE;
}

export function isFileDropActive(state: FileDropState): boolean {
  return state.depth > 0;
}
