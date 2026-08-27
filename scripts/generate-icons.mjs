// 用 Playwright 渲染 icon-design.html 并导出 PWA/桌面所需的 PNG 图标。
// 运行：node scripts/generate-icons.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(scriptDir, '../src/client/public/icons');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.goto(pathToFileURL(join(scriptDir, 'icon-design.html')).href);

for (const size of [180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.screenshot({ path: join(outDir, `icon-${size}.png`) });
  console.log(`generated icon-${size}.png`);
}

await browser.close();
