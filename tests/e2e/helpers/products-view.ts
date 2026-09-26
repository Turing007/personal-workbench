import type { BrowserContext } from '@playwright/test';

/**
 * 产品库默认是大图浏览，但不少用例断言的是表格/卡片列表里的 DOM。
 * 在页面加载前把视图偏好写成列表，用例就不必依赖切换按钮的当前状态。
 */
export async function useProductListView(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => window.localStorage.setItem('workbench:products-view', 'list'));
}
