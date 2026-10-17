// SPDX-License-Identifier: Apache-2.0
//
// Records the demo video's scenes from the running site, with a visible cursor, as CDP screencast
// frames stamped on arrival. Each scene is paced against its narration (out/audio/manifest.json).
// Waits for real transactions are marked so the edit can squeeze them to a beat.
//
//   npm run dev                                    (the site, on port 5199)
//   npm run cli -- bridge > out/bridge.log         (only for the live scenes)
//   node video/record.mjs [--only setup,counter] [--bridge-log video/out/bridge.log]
//
// Card scenes show one slide of docs/deck/index.html, with the Preview numbers filled in.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { SCENES } from './narration.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BASE = arg('base', 'http://localhost:5199/');
const ONLY = arg('only', null)?.split(',');
const OUT = join(HERE, 'out', 'rec');
const manifest = JSON.parse(readFileSync(join(HERE, 'out', 'audio', 'manifest.json'), 'utf8'));
mkdirSync(OUT, { recursive: true });

// The live link the bridge printed (it carries a one-run token, so it is read from its log, not typed).
const bridgeLog = arg('bridge-log', null);
const LIVE_URL = bridgeLog ? readFileSync(bridgeLog, 'utf8').match(/http:\/\/localhost:5199\/#\/live\?\S+/)?.[0] : undefined;

// ---------------------------------------------------------------- the deck, for card scenes
const evidenceDir = join(ROOT, 'cli', 'evidence');
const newest = readdirSync(evidenceDir).filter((f) => /^preview-.*\.json$/.test(f)).sort().at(-1);
const evidence = newest ? JSON.parse(readFileSync(join(evidenceDir, newest), 'utf8')) : undefined;
const values = { TXS: evidence ? String(evidence.summary.transactions + 1) : '?', REFUSALS: evidence ? String(evidence.summary.refusals.length) : '?' };
const deckFile = join(OUT, 'deck.html');
writeFileSync(
  deckFile,
  readFileSync(join(ROOT, 'docs', 'deck', 'index.html'), 'utf8')
    .replace('<head>', `<head><base href="${pathToFileURL(join(ROOT, 'docs', 'deck')).href}/">`)
    .replace(/\{\{(\w+)\}\}/g, (m, k) => values[k] ?? m),
);

// 1280x720 CSS pixels at 1.5x: the site's desktop layout fills a 1920x1080 frame.
const VIEW = { width: 1280, height: 720 };
const DPR = 1.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now() / 1000;

// ---------------------------------------------------------------- a cursor (headless has none)
const CURSOR = `(() => {
  if (window.__cursorInstalled) return;
  window.__cursorInstalled = true;
  const install = () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 28 28"><path d="M4 3 L4 22 L9.2 17.2 L12.8 25 L16.4 23.4 L12.9 15.8 L19.8 15.8 Z" fill="#fff" stroke="#12201b" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-200px,-200px)', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.35))' });
    document.documentElement.appendChild(c);
    const style = document.createElement('style');
    style.textContent = '@keyframes __ripple{from{transform:translate(-50%,-50%) scale(.3);opacity:.85}to{transform:translate(-50%,-50%) scale(1.6);opacity:0}}';
    document.documentElement.appendChild(style);
    const pos = window.__cursorPos;
    if (pos) c.style.transform = 'translate(' + (pos[0] - 4) + 'px,' + (pos[1] - 3) + 'px)';
    addEventListener('mousemove', (e) => {
      window.__cursorPos = [e.clientX, e.clientY];
      c.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 3) + 'px)';
    }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      Object.assign(r.style, { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', width: '44px', height: '44px', borderRadius: '50%', border: '2px solid #0d7a5a', background: 'rgba(13,122,90,.16)', pointerEvents: 'none', zIndex: 2147483646, animation: '__ripple .55s ease-out forwards' });
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})()`;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [`--force-device-scale-factor=${DPR}`] });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR, colorScheme: 'light' });
await context.addInitScript(CURSOR);
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const cdp = await context.newCDPSession(page);
page.on('console', (m) => m.type() === 'error' && console.log('  [console]', m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));

// ---------------------------------------------------------------- screencast recorder
const rec = {
  dir: null,
  frames: [],
  marks: [],
  t0: 0,
  async start(id) {
    this.dir = join(OUT, id);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    this.marks = [];
    this.t0 = now();
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080 });
  },
  mark(name) {
    this.marks.push({ name, t: now() - this.t0 });
  },
  async stop() {
    await cdp.send('Page.stopScreencast');
    await sleep(100);
    const meta = { frames: this.frames, marks: this.marks, end: now() - this.t0 };
    writeFileSync(join(this.dir, 'meta.json'), JSON.stringify(meta));
    this.dir = null;
    return meta;
  },
};
cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
  if (rec.dir) {
    const f = `${String(rec.frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(rec.dir, f), Buffer.from(data, 'base64'));
    rec.frames.push({ f, t: now() - rec.t0 });
  }
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

// ---------------------------------------------------------------- input helpers
let mouse = { x: VIEW.width * 0.6, y: VIEW.height * 0.55 };
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const tid = (id) => page.getByTestId(id);

async function moveTo(x, y, ms) {
  const from = { ...mouse };
  ms ??= Math.min(900, Math.max(300, 240 + Math.hypot(x - from.x, y - from.y) * 0.5));
  const steps = Math.max(6, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const p = ease(i / steps);
    await page.mouse.move(from.x + (x - from.x) * p, from.y + (y - from.y) * p);
    await sleep(ms / steps);
  }
  mouse = { x, y };
}

async function inView(loc) {
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + Math.min(r.height / 2, 40);
    if (cy < 80 || cy > innerHeight - 40 || cx < 0 || cx > innerWidth) return false;
    const hit = document.elementFromPoint(cx, cy);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  });
}

/** Waits until the page has stopped scrolling (smooth scrolls over a long way take over a second). */
async function settle() {
  await page.evaluate(
    () =>
      new Promise((done) => {
        let last = scrollY;
        let still = 0;
        const t = setInterval(() => {
          still = scrollY === last ? still + 1 : 0;
          last = scrollY;
          if (still >= 4) {
            clearInterval(t);
            done();
          }
        }, 60);
        setTimeout(() => (clearInterval(t), done()), 3000);
      }),
  );
}

async function reveal(loc, block = 'center') {
  await loc.waitFor({ state: 'visible' });
  if (!(await inView(loc))) {
    await loc.evaluate((el, block) => el.scrollIntoView({ behavior: 'smooth', block }), block);
    await sleep(200);
    await settle();
  }
}

/** Scrolls an element to just under the sticky site header. */
async function scrollToEl(loc, gap = 84) {
  await loc.waitFor({ state: 'visible' });
  await loc.evaluate((el, gap) => scrollTo({ top: el.getBoundingClientRect().top + scrollY - gap, behavior: 'smooth' }), gap);
  await sleep(200);
  await settle();
}

/** Moves the cursor onto an element without scrolling. */
async function glide(loc, ms) {
  const b = await loc.first().boundingBox();
  await moveTo(b.x + Math.min(b.width / 2, 60), b.y + Math.min(b.height / 2, 16), ms);
}

async function point(loc) {
  loc = loc.first();
  await reveal(loc);
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 24) };
}

async function hover(loc, ms) {
  const p = await point(loc);
  await moveTo(p.x, p.y, ms);
}

async function click(loc) {
  await hover(loc);
  await sleep(120);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(150);
}

/** Smoothly scrolls the chain panel (it scrolls on its own, beside the page) to an element in it. */
async function chainTo(selector) {
  await page.evaluate(async (selector) => {
    const el = document.querySelector(selector);
    const panel = el?.closest('.chain');
    if (!el || !panel) return;
    const top = el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 90;
    panel.scrollTo({ top, behavior: 'smooth' });
    await new Promise((r) => setTimeout(r, 900));
  }, selector);
}

async function go(hash) {
  await page.goto(BASE + hash);
  await page.waitForLoadState('domcontentloaded');
  await page.mouse.move(mouse.x, mouse.y);
}

/** Waits for a live step to reach one of `states`, failing at once if the page reports an error. */
async function untilStep(id, states) {
  await page.waitForFunction(
    ([id, states]) => states.includes(document.querySelector(`[data-testid=live-step-${id}]`)?.dataset.state) || document.querySelector('[data-testid=live-error]'),
    [id, states],
    { timeout: 600_000 },
  );
  if (await tid('live-error').count()) throw new Error(`live step ${id}: ${(await tid('live-error').innerText()).slice(0, 600)}`);
}

/** Marks a wait for the network as a cut, keeping a moment of it on each side. */
async function waitCut(fn, { keepStart = 1.0, keepEnd = 0.8 } = {}) {
  await sleep(keepStart * 1000);
  rec.mark('cut-start');
  const r = await fn();
  rec.mark('cut-end');
  await sleep(keepEnd * 1000);
  return r;
}

// ---------------------------------------------------------------- scene runner
async function scene(id, { prepare, act }) {
  if (ONLY && !ONLY.includes(id)) return;
  const dur = manifest[id].duration * 1000;
  console.log(`scene ${id} (${(dur / 1000).toFixed(1)}s narration)`);
  if (prepare) await prepare();
  await rec.start(id);
  const t0 = Date.now();
  const beat = async (frac) => {
    const wait = t0 + frac * dur - Date.now();
    if (wait > 0) await sleep(wait);
  };
  try {
    await act({ beat, dur });
    await beat(1);
    await sleep(500);
  } catch (e) {
    await page.screenshot({ path: join(OUT, `${id}-error.png`) });
    throw e;
  } finally {
    const meta = await rec.stop();
    console.log(`  ${meta.frames.length} frames, ${meta.end.toFixed(1)}s`);
  }
}

/** A screenshot for the docs and the deck, taken between scenes so the hidden cursor never shows. */
async function still(name) {
  const cursor = (v) => page.evaluate((v) => document.getElementById('__cursor')?.style.setProperty('visibility', v), v);
  await cursor('hidden');
  await page.screenshot({ path: join(ROOT, 'docs', 'img', name) });
  await cursor('visible');
  console.log(`  docs/img/${name}`);
}

/** One slide, alone in the frame, its blocks appearing on the given beats while it slowly zooms. */
function card(id, beats) {
  const n = SCENES.find((s) => s.id === id).card;
  return scene(id, {
    prepare: async () => {
      await page.goto(pathToFileURL(deckFile).href);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        ({ n, dur }) => {
          document.getElementById('__cursor')?.remove();
          document.documentElement.style.background = '#0b1210';
          document.querySelectorAll('section.slide').forEach((s, i) => {
            s.style.display = i === n - 1 ? 'flex' : 'none';
            s.style.margin = '0';
          });
          const slide = document.querySelectorAll('section.slide')[n - 1];
          // Slides without their own spacers sit centred, so the frame is not half empty.
          if (!slide.querySelector('.grow')) slide.style.justifyContent = 'center';
          slide.style.transformOrigin = '50% 45%';
          slide.style.transition = `transform ${dur}ms linear`;
          for (const el of slide.querySelectorAll('.cols > *, p.lede, .links > div, .road > *')) {
            el.style.opacity = '0';
            el.style.transform = 'translateY(12px)';
            el.style.transition = 'opacity .6s ease, transform .6s ease';
            el.dataset.reveal = '';
          }
        },
        { n, dur: manifest[id].duration * 1000 + 1500 },
      );
      await sleep(300);
    },
    act: async ({ beat }) => {
      await page.evaluate((n) => (document.querySelectorAll('section.slide')[n - 1].style.transform = 'scale(1.035)'), n);
      const items = await page.locator('[data-reveal]').count();
      for (let i = 0; i < items; i++) {
        await beat(beats[Math.min(i, beats.length - 1)] + (i >= beats.length ? (i - beats.length + 1) * 0.06 : 0));
        await page.evaluate((i) => {
          const el = document.querySelectorAll('[data-reveal]')[i];
          el.style.opacity = '1';
          el.style.transform = 'none';
        }, i);
      }
    },
  });
}

// ---------------------------------------------------------------- the scenes
await page.goto(BASE);
await page.evaluate(() => localStorage.clear());

try {
  await card('hook', [0.08, 0.42, 0.78]);
  await card('today', [0.2, 0.5]);

  await scene('answer', {
    prepare: async () => {
      await go('#/');
      await page.getByRole('heading', { level: 1 }).waitFor();
      await sleep(1200);
    },
    act: async ({ beat }) => {
      await hover(page.locator('.split-visual .private'));
      await beat(0.3);
      await hover(page.locator('.split-visual .redacted'));
      await beat(0.55);
      await scrollToEl(page.getByRole('heading', { name: 'Who learns what' }), 110);
      await glide(page.locator('table.plain tbody tr').first().locator('td').nth(1));
      await beat(0.85);
      await glide(page.locator('table.plain tbody tr').nth(5).locator('td').nth(1));
    },
  });

  await scene('setup', {
    prepare: async () => {
      await go('#/demo/network');
      await page.getByRole('heading', { name: 'Three authorities set up the network' }).waitFor();
      await sleep(800);
    },
    act: async ({ beat }) => {
      await click(tid('setup'));
      await page.locator('.history li').nth(7).waitFor();
      await beat(0.3);
      await click(tid('next'));
      await page.locator('.stage-head h2').waitFor();
      await beat(0.42);
      await click(tid('rao-issue'));
      await page.locator('.qr img').first().waitFor();
      await hover(page.locator('.qr img').first());
      await beat(0.78);
      await click(tid('ravi-scan-rx'));
      await hover(page.locator('.rx-card .drug').last());
    },
  });

  await scene('counter', {
    prepare: async () => {
      await click(tid('next'));
      await page.locator('.stage-head h2').waitFor();
      await page.evaluate(() => scrollTo(0, 0));
      await sleep(600);
    },
    act: async ({ beat }) => {
      await click(tid('lotus-new'));
      await click(tid('ravi-scan-counter'));
      await beat(0.12);
      await click(tid('ravi-fill'));
      await page.getByTestId('count-filled').filter({ hasText: '1' }).waitFor();
      await beat(0.5);
      await chainTo('[data-testid=call] [data-testid=scan]');
      await hover(page.locator('[data-testid=call] [data-testid=scan]'));
      await beat(0.86);
      await click(tid('lotus-check'));
      await hover(tid('check'));
    },
  });

  await scene('attacks', {
    prepare: async () => {
      await click(tid('next'));
      await page.locator('.stage-head h2').waitFor();
      await page.evaluate(() => scrollTo(0, 0));
      await sleep(500);
    },
    act: async ({ beat }) => {
      await click(tid('neem-refill-new'));
      await click(tid('ravi-refill'));
      await hover(page.locator('[data-testid=refused][data-code=ALREADY_FILLED]'));
      await beat(0.4);
      await click(tid('next'));
      await page.locator('.stage-head h2').waitFor();
      await click(tid('mehta-issue'));
      await click(tid('ravi-scan-mehta'));
      await click(tid('neem-shop-new'));
      await click(tid('ravi-shop'));
      await hover(page.locator('[data-testid=refused][data-code=CAP_REACHED]'));
      await chainTo('[data-testid=chain] [data-testid=refusal]');
    },
  });

  await scene('regulator', {
    prepare: async () => {
      await go('#/demo/regulator');
      await tid('skip').click();
      await tid('skip').waitFor({ state: 'detached', timeout: 60_000 });
      await page.evaluate(() => scrollTo(0, 0));
      await sleep(800);
    },
    act: async ({ beat }) => {
      await hover(tid('dashboard').locator('tr', { hasText: 'MC-MH-11902' }));
      await beat(0.4);
      await scrollToEl(tid('dashboard').getByRole('heading', { name: 'Fill records' }));
      await glide(tid('dashboard').getByText('not on chain').first());
    },
  });

  if (LIVE_URL || !ONLY || ONLY.some((id) => id.startsWith('live'))) {
    if (!LIVE_URL) throw new Error('the live scenes need --bridge-log <file with the bridge output>');

    await scene('live', {
      prepare: async () => {
        await page.goto(LIVE_URL);
        await page.evaluate(() => localStorage.removeItem('ampoule.live.v1'));
        await page.reload();
        await page.mouse.move(mouse.x, mouse.y);
        await tid('connect-bridge').waitFor();
        await sleep(800);
      },
      act: async ({ beat }) => {
        await hover(page.locator('p.sub').first());
        await beat(0.12);
        await click(tid('connect-bridge'));
        await waitCut(() => tid('wallet').waitFor({ timeout: 120_000 }), { keepStart: 0.6 });
        await hover(tid('wallet'));
        await beat(0.45);
        await click(tid('live-next'));
        await scrollToEl(page.getByRole('heading', { name: '2. The run' }), 96);
        await glide(tid('live-step-deploy').locator('.live-result'));
        await waitCut(() => untilStep('deploy', ['done']), { keepStart: 1.2 });
        await hover(tid('live-contract'));
      },
    });

    await scene('liverun', {
      act: async () => {
        const ids = await page.$$eval('[data-testid^=live-step-]', (els) => els.map((e) => e.dataset.testid.slice('live-step-'.length)));
        await click(tid('live-all'));
        for (const id of ids.slice(1)) {
          const state = () => page.evaluate((id) => document.querySelector(`[data-testid=live-step-${id}]`)?.dataset.state, id);
          await untilStep(id, ['busy', 'done', 'refused']);
          await reveal(tid(`live-step-${id}`));
          if ((await state()) === 'busy') await waitCut(() => untilStep(id, ['done', 'refused']), { keepStart: 0.7, keepEnd: 0.9 });
          else await sleep(900);
        }
        await hover(tid('live-step-shop-tramadol').getByTestId('live-refused'));
      },
    });
    if (!ONLY || ONLY.includes('liverun')) await still('live.png');

    await scene('liveaudit', {
      act: async ({ beat }) => {
        await click(tid('live-audit'));
        await waitCut(() => tid('live-audit-result').waitFor({ timeout: 300_000 }), { keepStart: 0.8 });
        await scrollToEl(tid('live-audit-result'));
        await glide(tid('live-audit-result').locator('.checks li').first());
        await beat(0.7);
        await glide(tid('live-audit-result').locator('.checks li').last());
      },
    });
  }

  await scene('ledger', {
    prepare: async () => {
      await go('#/ledger');
      await tid('audit').waitFor();
      await sleep(800);
    },
    act: async ({ beat }) => {
      await click(tid('audit'));
      await waitCut(() => tid('audit-result').waitFor({ timeout: 300_000 }), { keepStart: 0.8 });
      await hover(tid('audit-result'));
      await beat(0.55);
      await scrollToEl(page.locator('.checks').first(), 120);
      await glide(page.locator('.checks li').filter({ hasText: 'no private value' }));
    },
  });
  if (!ONLY || ONLY.includes('ledger')) await still('ledger.png');

  await card('evidence', [0.05, 0.16, 0.5, 0.78, 0.88]);
  await card('outro', [0.15, 0.3, 0.45, 0.6, 0.75]);
} finally {
  await browser.close();
}
console.log(`recorded into ${OUT}`);
