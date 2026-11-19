import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test('App 工作空间支持新增、展示账号提示和切换', async ({ page }) => {
  await page.addInitScript(() => {
    type MockNetwork = { label: string; url: string; account: string; active: boolean };
    const target = window as typeof window & {
      workbenchApp?: Record<string, unknown>;
      __workspaceNetworks: MockNetwork[];
      __switchedWorkspace?: string;
    };
    target.__workspaceNetworks = [
      { label: '公司 A · 线上', url: 'https://a.example.com', account: 'admin', active: true },
      { label: '公司 B · 测试', url: 'https://b.example.com', account: '小王', active: false },
    ];
    target.workbenchApp = {
      getNetworks: () => JSON.stringify(target.__workspaceNetworks),
      switchNetwork: (url: string) => { target.__switchedWorkspace = url; },
      openAddressEditor: () => undefined,
      openNetworkSwitcher: () => undefined,
      removeNetwork: (url: string) => {
        target.__workspaceNetworks = target.__workspaceNetworks.filter((item) => item.url !== url);
      },
      saveNetwork: (label: string, url: string, account: string) => {
        target.__workspaceNetworks.push({ label, url, account, active: false });
        return true;
      },
      updateNetwork: (url: string, label: string, account: string) => {
        target.__workspaceNetworks = target.__workspaceNetworks.map((item) => item.url === url ? { ...item, label, account } : item);
        return true;
      },
      setNetworkAccount: () => undefined,
    };
  });

  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '手机连接', exact: true }).click();
  await expect(page.getByText('工作空间', { exact: true })).toBeVisible();
  await expect(page.getByText('当前工作空间', { exact: true })).toBeVisible();
  await expect(page.getByText('公司 A · 线上', { exact: true })).toBeVisible();

  await page.getByLabel('名称').fill('公司 C · 备用');
  await page.getByLabel('服务器地址').fill('https://c.example.com');
  await page.getByLabel('账号提示').fill('备用账号');
  await page.getByRole('button', { name: '保存工作空间' }).click();
  await expect(page.getByText('公司 C · 备用', { exact: true })).toBeVisible();
  await expect(page.getByText('账号：备用账号', { exact: true })).toBeVisible();

  const companyB = page.locator('.settings-workspace-item', { hasText: '公司 B · 测试' });
  await companyB.getByRole('button', { name: '切换' }).click();
  expect(await page.evaluate(() => (window as typeof window & { __switchedWorkspace?: string }).__switchedWorkspace)).toBe('https://b.example.com');
});

test('登录页可以直接切换工作空间', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const target = window as typeof window & { workbenchApp?: Record<string, unknown>; __openedSwitcher?: boolean };
    target.workbenchApp = {
      getNetworks: () => JSON.stringify([{ label: '公司 A · 线上', url: 'https://a.example.com', account: 'admin', active: true }]),
      switchNetwork: () => undefined,
      openAddressEditor: () => undefined,
      openNetworkSwitcher: () => { target.__openedSwitcher = true; },
    };
  });
  await page.goto('/');
  await expect(page.getByText(/当前工作空间：公司 A · 线上/)).toBeVisible();
  await page.getByRole('button', { name: '切换工作空间' }).click();
  expect(await page.evaluate(() => (window as typeof window & { __openedSwitcher?: boolean }).__openedSwitcher)).toBe(true);
  await context.close();
});
