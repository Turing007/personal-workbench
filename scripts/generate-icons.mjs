// 用 Playwright 渲染 scripts/icon-design.html，一次性导出 PWA 图标与安卓桌面图标。
// 运行：node scripts/generate-icons.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const designUrl = pathToFileURL(join(scriptDir, 'icon-design.html')).href;
const pwaDir = join(root, 'src/client/public/icons');
const resDir = join(root, 'android/app/src/main/res');

// 安卓 legacy 图标沿用工程现有的单密度做法（系统自行缩放）。
const targets = [
  { file: join(pwaDir, 'icon-180.png'), size: 180, layer: null },
  { file: join(pwaDir, 'icon-192.png'), size: 192, layer: null },
  { file: join(pwaDir, 'icon-512.png'), size: 512, layer: null },
  { file: join(resDir, 'mipmap-xxxhdpi/ic_launcher.png'), size: 192, layer: null },
  // 自适应图层：108dp 画布，xxxhdpi 取 432px；前景/背景各自单独导出。
  { file: join(resDir, 'drawable-nodpi/ic_launcher_background.png'), size: 432, layer: 'background' },
  { file: join(resDir, 'drawable-nodpi/ic_launcher_foreground.png'), size: 432, layer: 'foreground' },
  { file: join(resDir, 'drawable-nodpi/ic_launcher_monochrome.png'), size: 432, layer: 'foreground' },
];

const browser = await chromium.launch();
for (const target of targets) {
  mkdirSync(dirname(target.file), { recursive: true });
  const page = await browser.newPage({ viewport: { width: target.size, height: target.size } });
  await page.goto(target.layer ? `${designUrl}?layer=${target.layer}` : designUrl);
  // 单层导出必须带透明通道，否则自适应图标的前景层会盖住背景层。
  await page.screenshot({ path: target.file, omitBackground: true });
  await page.close();
  console.log(`generated ${target.file.slice(root.length + 1)} (${target.size}px${target.layer ? ` · ${target.layer}` : ''})`);
}
await browser.close();

mkdirSync(join(resDir, 'mipmap-anydpi-v26'), { recursive: true });
writeFileSync(join(resDir, 'mipmap-anydpi-v26/ic_launcher.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- 由 scripts/generate-icons.mjs 生成，请勿手改：改图形请改 scripts/icon-design.html。 -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`);
console.log(`generated ${join('android/app/src/main/res', 'mipmap-anydpi-v26/ic_launcher.xml')}`);
