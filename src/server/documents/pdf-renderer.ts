import { chromium, type Browser, type Page } from 'playwright';

interface ChromiumLauncher {
  launch(options: { channel?: string; headless: boolean }): Promise<Browser>;
}

export class PdfRendererError extends Error {
  readonly code = 'PDF_RENDER_FAILED' as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PdfRendererError';
  }
}

export class PdfRenderer {
  constructor(private readonly browserLauncher: ChromiumLauncher = chromium) {}

  async render(html: string): Promise<Buffer> {
    let browser: Browser | undefined;
    try {
      browser = await this.launchBrowser();
      const page = await browser.newPage();
      return await this.renderPage(page, html);
    } catch (error) {
      if (error instanceof PdfRendererError) throw error;
      throw new PdfRendererError('PDF 生成失败，请稍后重试', { cause: error });
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // The PDF bytes are already complete; a close failure must not discard them.
        }
      }
    }
  }

  private async launchBrowser(): Promise<Browser> {
    let edgeError: unknown;
    try {
      return await this.browserLauncher.launch({ channel: 'msedge', headless: true });
    } catch (error) {
      edgeError = error;
    }

    try {
      return await this.browserLauncher.launch({ headless: true });
    } catch (chromiumError) {
      throw new PdfRendererError('无法启动 PDF 渲染浏览器，请安装 Microsoft Edge 或 Playwright Chromium', {
        cause: new AggregateError([edgeError, chromiumError], 'PDF browser launch failed'),
      });
    }
  }

  private async renderPage(page: Page, html: string): Promise<Buffer> {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    const bytes = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
    return Buffer.from(bytes);
  }
}
