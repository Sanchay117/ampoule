// SPDX-License-Identifier: Apache-2.0
//
// Renders the pitch deck, docs/deck/index.html, to docs/Ampoule-deck.pdf. The numbers from the
// Preview run are filled in from the newest committed evidence file, so the deck cannot drift
// from what is on chain.
//
//   node web/scripts/deck.mjs [--png <dir>]     (--png also writes one image per slide)
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const deckDir = join(root, 'docs', 'deck');
const evidenceDir = join(root, 'cli', 'evidence');

const newest = readdirSync(evidenceDir, { withFileTypes: true })
  .filter((f) => f.isFile() && /^preview-.*\.json$/.test(f.name))
  .map((f) => f.name)
  .sort()
  .at(-1);
const draft = process.argv.includes('--draft');
if (!newest && !draft) {
  console.error('no cli/evidence/preview-*.json yet; run the scenario on Preview first (or pass --draft)');
  process.exit(1);
}
const evidence = newest ? JSON.parse(readFileSync(join(evidenceDir, newest), 'utf8')) : undefined;
// The deploy is a transaction too.
const values = {
  TXS: evidence ? String(evidence.summary.transactions + 1) : '?',
  REFUSALS: evidence ? String(evidence.summary.refusals.length) : '?',
};

const html = readFileSync(join(deckDir, 'index.html'), 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => values[k] ?? m);
const tmp = join(deckDir, '.render.html');
writeFileSync(tmp, html);

const pngArg = process.argv.indexOf('--png');
const pngDir = pngArg > 0 ? process.argv[pngArg + 1] : undefined;

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
  if (missing.length) console.warn(`images that did not load: ${missing.join(', ')}`);
  await page.pdf({ path: join(root, 'docs', 'Ampoule-deck.pdf'), width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
  if (pngDir) {
    mkdirSync(pngDir, { recursive: true });
    const slides = page.locator('section.slide');
    const n = await slides.count();
    for (let i = 0; i < n; i++) await slides.nth(i).screenshot({ path: join(pngDir, `slide-${String(i + 1).padStart(2, '0')}.png`) });
    console.log(`${n} slide images in ${pngDir}`);
  }
} finally {
  await browser.close();
  rmSync(tmp, { force: true });
}
console.log(`docs/Ampoule-deck.pdf from ${newest}: ${values.TXS} transactions, ${values.REFUSALS} refusals`);
