// SPDX-License-Identifier: Apache-2.0
//
// Renders the YouTube thumbnails in video/thumbnail.html to video/out/thumbnail-<n>.jpg (1280x720).
//   node video/thumbnail.mjs
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(HERE, 'out'), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1330, height: 800 } });
  await page.goto(pathToFileURL(join(HERE, 'thumbnail.html')).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const thumbs = page.locator('section.thumb');
  const n = await thumbs.count();
  for (let i = 0; i < n; i++) {
    const file = join(HERE, 'out', `thumbnail-${i + 1}.jpg`);
    await thumbs.nth(i).screenshot({ path: file, type: 'jpeg', quality: 92 });
    console.log(file);
  }
} finally {
  await browser.close();
}
