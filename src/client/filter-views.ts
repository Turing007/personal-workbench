import { useCallback, useEffect, useRef, useState } from 'react';

export interface SavedFilterView<T> {
  id: string;
  name: string;
  filters: T;
}

function storageKey(pageKey: string): string {
  return `workbench:filter-views:${pageKey}`;
}

function loadViews<T>(pageKey: string): SavedFilterView<T>[] {
  try {
    const raw = window.localStorage.getItem(storageKey(pageKey));
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((view): view is SavedFilterView<T> => (
      Boolean(view) && typeof view === 'object'
      && typeof (view as SavedFilterView<T>).id === 'string'
      && typeof (view as SavedFilterView<T>).name === 'string'
      && 'filters' in (view as object)
    ));
  } catch {
    return [];
  }
}

function newViewId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `view-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

/** 常用筛选视图：本期存本机 localStorage，按页面隔离。 */
export function useSavedFilterViews<T>(pageKey: string, current: T, apply: (filters: T) => void) {
  const [views, setViews] = useState<SavedFilterView<T>[]>(() => loadViews<T>(pageKey));
  const [activeViewId, setActiveViewId] = useState<string>();
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(pageKey), JSON.stringify(views));
    } catch {
      // 存储失败不影响筛选使用。
    }
  }, [pageKey, views]);

  useEffect(() => {
    if (activeViewId && !views.some((view) => view.id === activeViewId)) setActiveViewId(undefined);
  }, [activeViewId, views]);

  const activeView = views.find((view) => view.id === activeViewId);
  const modified = activeView ? JSON.stringify(activeView.filters) !== JSON.stringify(current) : false;

  const applyView = useCallback((viewId: string) => {
    const view = views.find((item) => item.id === viewId);
    if (!view) return;
    applyRef.current(view.filters);
    setActiveViewId(view.id);
  }, [views]);

  const saveView = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const view: SavedFilterView<T> = { id: newViewId(), name: trimmed.slice(0, 30), filters: current };
    setViews((items) => [...items, view]);
    setActiveViewId(view.id);
  }, [current]);

  const updateView = useCallback(() => {
    if (!activeViewId) return;
    setViews((items) => items.map((item) => item.id === activeViewId ? { ...item, filters: current } : item));
  }, [activeViewId, current]);

  const renameView = useCallback((viewId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setViews((items) => items.map((item) => item.id === viewId ? { ...item, name: trimmed.slice(0, 30) } : item));
  }, []);

  const deleteView = useCallback((viewId: string) => {
    setViews((items) => items.filter((item) => item.id !== viewId));
    if (activeViewId === viewId) setActiveViewId(undefined);
  }, [activeViewId]);

  const clearActive = useCallback(() => setActiveViewId(undefined), []);

  return {
    views,
    activeViewId,
    activeView,
    modified,
    applyView,
    saveView,
    updateView,
    renameView,
    deleteView,
    clearActive,
  };
}

function railStorageKey(pageKey: string): string {
  return `workbench:filter-rail:${pageKey}`;
}

/** 桌面筛选栏展开状态：大屏默认展开，中屏默认收起，手机端不显示。 */
export function useFilterRailOpen(pageKey: string) {
  const [open, setOpen] = useState(() => {
    try {
      const stored = window.localStorage.getItem(railStorageKey(pageKey));
      if (stored != null) return stored === '1';
    } catch { /* 忽略存储失败 */ }
    // 展开后是浮层，不占主区宽度；默认仍收起，避免一进页面就盖住标题和表格。
    return false;
  });
  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      try { window.localStorage.setItem(railStorageKey(pageKey), next ? '1' : '0'); } catch { /* 忽略存储失败 */ }
      return next;
    });
  }, [pageKey]);
  return { open, toggle };
}
