import { useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import {
  dropFileDrop,
  enterFileDrop,
  INITIAL_FILE_DROP_STATE,
  isFileDrag,
  isFileDropActive,
  leaveFileDrop,
  type FileDropState,
} from './file-drop';

export interface FileDropHandlers {
  onDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>) => void;
}

/**
 * 把「拖文件进来」做成与「选择文件」同一条入口：拿到 File[] 后交给调用方，
 * 后续的类型校验、MIME 归一化、进上传队列全部复用既有管线。
 *
 * 必须 preventDefault（dragenter / dragover 都要），否则浏览器会把拖入的文件
 * 当成导航直接打开。进入计数与高亮状态的推导见 file-drop.ts。
 */
export function useFileDrop(onFiles: (files: File[]) => void): {
  dragging: boolean;
  handlers: FileDropHandlers;
} {
  const [dragging, setDragging] = useState(false);
  const state = useRef<FileDropState>(INITIAL_FILE_DROP_STATE);

  /** 只在「是否高亮」真正翻转时写回 React，避免拖动过程频繁重渲染。 */
  const apply = (next: FileDropState) => {
    state.current = next;
    setDragging(isFileDropActive(next));
  };

  const handlers: FileDropHandlers = {
    onDragEnter: (event) => {
      if (!isFileDrag(Array.from(event.dataTransfer?.types ?? []))) return;
      event.preventDefault();
      apply(enterFileDrop(state.current));
    },
    onDragOver: (event) => {
      if (!isFileDrag(Array.from(event.dataTransfer?.types ?? []))) return;
      event.preventDefault();
      // 明确告诉浏览器这是「复制」：否则拖拽期间光标一直显示禁止符号。
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event) => {
      if (!isFileDrag(Array.from(event.dataTransfer?.types ?? []))) return;
      apply(leaveFileDrop(state.current));
    },
    onDrop: (event) => {
      if (!isFileDrag(Array.from(event.dataTransfer?.types ?? []))) return;
      event.preventDefault();
      apply(dropFileDrop());
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) onFiles(files);
    },
  };

  return { dragging, handlers };
}
