import { chromium, type Browser, type Page } from 'playwright';

interface ChromiumLauncher {
  launch(options: { channel?: string; headless: boolean }): Promise<Browser>;
}

interface SharedBrowserEntry {
  launcher: ChromiumLauncher;
  browserPromise: Promise<Browser>;
}

// 浏览器启动是 PDF 生成最大的开销（秒级）。进程内共享一个常驻浏览器，
// 每次渲染只新建独立页面，渲染完仅关闭页面；浏览器崩溃后自动重启并重试。
let sharedBrowser: SharedBrowserEntry | undefined;

// 串行化浏览器的获取过程，避免并发渲染在浏览器崩溃时各自重启出多个实例。
let acquireChain: Promise<unknown> = Promise.resolve();

export class PdfRendererError extends Error {
  readonly code = 'PDF_RENDER_FAILED' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PdfRendererError';
  }
}

async function launchWithFallback(launcher: ChromiumLauncher): Promise<Browser> {
  let edgeError: unknown;
  try {
    return await launcher.launch({ channel: 'msedge', headless: true });
  } catch (error) {
    edgeError = error;
  }

  try {
    return await launcher.launch({ headless: true });
  } catch (chromiumError) {
    throw new PdfRendererError('无法启动 PDF 渲染浏览器，请安装 Microsoft Edge 或 Playwright Chromium', {
      cause: new AggregateError([edgeError, chromiumError], 'PDF browser launch failed'),
    });
  }
}

async function acquireSharedBrowser(launcher: ChromiumLauncher): Promise<Browser> {
  const entry = sharedBrowser;
  if (entry && entry.launcher === launcher) {
    const browser = await entry.browserPromise.catch(() => undefined);
    if (browser?.isConnected()) return browser;
    if (sharedBrowser === entry) sharedBrowser = undefined;
    // 关闭已失效的浏览器，避免残留进程。
    await browser?.close().catch(() => undefined);
  }

  const browserPromise = Promise.resolve().then(() => launchWithFallback(launcher));
  sharedBrowser = { launcher, browserPromise };
  // 启动失败时清空缓存，让下一次渲染可以重试，而不是永远拿到失败的 Promise。
  browserPromise.catch(() => {
    if (sharedBrowser?.browserPromise === browserPromise) sharedBrowser = undefined;
  });
  return browserPromise;
}

function acquireSerialized(launcher: ChromiumLauncher): Promise<Browser> {
  const queued = acquireChain.then(() => acquireSharedBrowser(launcher));
  acquireChain = queued.catch(() => undefined);
  return queued;
}

export async function closeSharedPdfRenderer(): Promise<void> {
  const entry = sharedBrowser;
  sharedBrowser = undefined;
  if (!entry) return;
  try {
    const browser = await entry.browserPromise;
    await browser.close();
  } catch {
    // 关闭失败不应影响服务关闭流程。
  }
}

export class PdfRenderer {
  constructor(private readonly browserLauncher: ChromiumLauncher = chromium) {}

  async render(html: string): Promise<Buffer> {
    for (let attempt = 1; ; attempt += 1) {
      let browser: Browser | undefined;
      let page: Page | undefined;
      try {
        browser = await acquireSerialized(this.browserLauncher);
        page = await browser.newPage();
        return await this.renderPage(page, html);
      } catch (error) {
        // 常驻浏览器崩溃时重启一次再试，避免用户看到一次性失败。
        const browserCrashed = browser !== undefined && !browser.isConnected();
        if (attempt === 1 && browserCrashed) continue;
        if (error instanceof PdfRendererError) throw error;
        throw new PdfRendererError('PDF 生成失败，请稍后重试', { cause: error });
      } finally {
        if (page) {
          try {
            await page.close();
          } catch {
            // 页面关闭失败不应丢弃已生成的 PDF 字节。
          }
        }
      }
    }
  }

  private async renderPage(page: Page, html: string): Promise<Buffer> {
    // 先切换到打印媒体再注入内容，避免一次多余的排版计算。
    await page.emulateMedia({ media: 'print' });
    // 模板中的图片全部内联为 data URL，没有外部请求，等待 load 即可；
    // networkidle 会额外强制等待 500ms 静默期。
    await page.setContent(html, { waitUntil: 'load' });
    const bytes = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
    return Buffer.from(bytes);
  }
}
