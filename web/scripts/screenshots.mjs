// SPDX-License-Identifier: Apache-2.0
//
// Screenshots for the README and the social preview, from a running dev server.
//
//   npm run dev            (in another terminal)
//   node web/scripts/screenshots.mjs
//
// Each chapter is photographed right after it is played, so the clock and the counters are
// the ones a visitor sees at that point of the story.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const img = join(root, 'docs', 'img');
mkdirSync(img, { recursive: true });
const base = process.env.BASE_URL ?? 'http://localhost:5199/';
const CHAPTERS = ['network', 'prescribe', 'counter', 'refill', 'shopping', 'fraud', 'later', 'suspension', 'regulator'];

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });

// Social preview: the landing hero, scaled to fit 1200x630.
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 788 }, deviceScaleFactor: 0.8 });
  await page.goto(base);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(root, 'web', 'public', 'og.png') });
  await page.close();
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(base);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: join(img, 'landing.png') });

/** Plays the story up to and including `id`, then photographs that chapter. */
async function shoot(id, file) {
  const next = CHAPTERS[CHAPTERS.indexOf(id) + 1];
  if (next) {
    await page.goto(`${base}#/demo/${next}`);
    // The skip button renders with the chapter, so wait for the chapter before asking for it.
    await page.locator('.stage-head h2').waitFor();
    await page.waitForTimeout(300);
    const skip = page.getByTestId('skip');
    if (await skip.count()) {
      await skip.click();
      await page.getByTestId('skip').waitFor({ state: 'detached' });
    }
  }
  await page.goto(`${base}#/demo/${id}`);
  await page.locator('.stage-head h2').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(img, file) });
}

await page.goto(`${base}#/demo`);
await shoot('counter', 'demo-counter.png');
await shoot('shopping', 'demo-shopping.png');
await shoot('fraud', 'demo-fraud.png');
await shoot('later', 'demo-later.png');
await page.goto(`${base}#/demo/regulator`);
await page.getByTestId('skip').click();
await page.getByTestId('skip').waitFor({ state: 'detached' });
await page.waitForTimeout(500);
await page.screenshot({ path: join(img, 'demo-regulator.png') });

await browser.close();
console.log(`screenshots in ${img} and web/public/og.png`);
