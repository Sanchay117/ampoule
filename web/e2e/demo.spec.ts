// SPDX-License-Identifier: Apache-2.0
//
// The guided demo, clicked through the way a person would. Every published call's transcript is
// searched for that call's private inputs by the page itself; these tests require that search to
// come back empty every time, and every refused attempt to carry the expected code.
import { expect, test, type Page } from '@playwright/test';

const tid = (page: Page, id: string) => page.getByTestId(id);

/** The call the chain panel shows, after it has settled. */
async function expectNoLeak(page: Page) {
  const scan = page.locator('[data-testid=call] [data-testid=scan]');
  if (await scan.count()) await expect(scan).toHaveAttribute('data-leaks', '0');
}

async function expectRefused(page: Page, code: string) {
  await expect(page.locator(`[data-testid=refused][data-code=${code}]`)).toBeVisible();
  await expect(page.locator('[data-testid=chain] [data-testid=refusal]')).toContainText(code);
}

test.describe('guided demo', () => {
  test.skip(({ isMobile }) => isMobile, 'the full click-through runs on desktop; the phone test plays it automatically');

  test('every chapter, by hand', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('./');
    await tid(page, 'cta-demo').click();
    await expect(page.getByRole('heading', { name: 'Three authorities set up the network' })).toBeVisible();

    // 1. Setup: eight transactions.
    await tid(page, 'setup').click();
    await expect(page.locator('.history li')).toHaveCount(8);
    await expectNoLeak(page);
    await tid(page, 'next').click();

    // 2. Dr Rao issues; Ravi's phone scans the QR.
    await tid(page, 'rao-issue').click();
    await expect(page.locator('.qr img').first()).toBeVisible();
    await expect(tid(page, 'count-issued')).toHaveText('1');
    await expectNoLeak(page);
    await tid(page, 'ravi-scan-rx').click();
    await expect(page.locator('.rx-card .drug').last()).toHaveText('Tramadol 50 mg');
    await tid(page, 'next').click();

    // 3. The counter: request, scan, prove and fill, pharmacist's check.
    await tid(page, 'lotus-new').click();
    await tid(page, 'ravi-scan-counter').click();
    await tid(page, 'ravi-fill').click();
    await expect(tid(page, 'count-filled')).toHaveText('1');
    await expectNoLeak(page);
    await tid(page, 'lotus-check').click();
    await expect(tid(page, 'check')).toHaveAttribute('data-ok', 'true');
    await expect(tid(page, 'check')).toContainText('Tramadol 50 mg, 10 tablets');
    await tid(page, 'next').click();

    // 4. The same prescription at another pharmacy.
    await tid(page, 'neem-refill-new').click();
    await tid(page, 'ravi-refill').click();
    await expectRefused(page, 'ALREADY_FILLED');
    await tid(page, 'next').click();

    // 5. Doctor shopping.
    await tid(page, 'mehta-issue').click();
    await expectNoLeak(page);
    await tid(page, 'ravi-scan-mehta').click();
    await tid(page, 'neem-shop-new').click();
    await tid(page, 'ravi-shop').click();
    await expectRefused(page, 'CAP_REACHED');
    await tid(page, 'next').click();

    // 6. An edited token, then someone else's.
    await tid(page, 'forge').click();
    await expect(page.locator('.token-text mark').first()).toBeVisible();
    await tid(page, 'fill-forged').click();
    await expectRefused(page, 'NO_SUCH_PRESCRIPTION');
    await tid(page, 'steal').click();
    await expect(page.locator('[data-testid=refused][data-code=NOT_YOUR_PRESCRIPTION]')).toBeVisible();
    await tid(page, 'next').click();

    // 7. Next cap window: the same patient fills, and the two fills share nothing.
    await tid(page, 'advance').click();
    await tid(page, 'neem-later-new').click();
    await tid(page, 'ravi-later').click();
    await expect(tid(page, 'count-filled')).toHaveText('2');
    await expectNoLeak(page);
    await expect(tid(page, 'check')).toHaveAttribute('data-ok', 'true');
    await expect(tid(page, 'unlinkable').locator('tbody tr')).toHaveCount(2);
    await tid(page, 'next').click();

    // 8. Suspension stops the doctor's open prescriptions.
    await tid(page, 'meera-rx').click();
    await tid(page, 'suspend').click();
    await expectNoLeak(page);
    await tid(page, 'meera-fill').click();
    await expectRefused(page, 'DOCTOR_SUSPENDED');
    await tid(page, 'next').click();

    // 9. The regulator's view.
    const dash = tid(page, 'dashboard');
    await expect(dash).toContainText('MC-MH-11902');
    const doctors = dash.locator('.card').first();
    await expect(doctors.locator('tr', { hasText: 'MC-MH-11902' })).toContainText('suspended');
    await expect(doctors.locator('tr', { hasText: 'MC-DL-58213' })).toContainText('licensed');
    await expect(dash).toContainText('not on chain');

    // Every published call in the session: none of them leaked a private input.
    const calls = page.locator('.history li');
    const n = await calls.count();
    expect(n).toBeGreaterThan(15);
    for (let i = 0; i < n; i++) {
      await calls.nth(i).click();
      await expectNoLeak(page);
    }
    expect(errors).toEqual([]);
  });
});

test('the whole story plays on a phone without horizontal scrolling', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await page.goto('./#/demo');
  await tid(page, 'play-all').click();
  await expect(page.locator('.chapter-link.done')).toHaveCount(8, { timeout: 60_000 });
  for (const id of ['network', 'prescribe', 'counter', 'refill', 'shopping', 'fraud', 'later', 'suspension', 'regulator']) {
    await page.goto(`./#/demo/${id}`);
    await expect(page.locator('.stage-head h2')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `chapter ${id}`).toBeLessThanOrEqual(0);
  }
});

test('the live page says what it needs, and refuses a wallet on the wrong network', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./#/live');
  await expect(tid(page, 'no-wallet')).toBeVisible();

  // A DApp Connector 4 wallet that is on Preprod, injected the way an extension would be.
  await page.addInitScript(() => {
    (window as unknown as { midnight: unknown }).midnight = {
      testWallet: {
        name: 'Test wallet',
        apiVersion: '4.0.1',
        icon: '',
        rdns: 'test.wallet',
        connect: async () => ({
          getConfiguration: async () => ({ networkId: 'preprod', indexerUri: '', indexerWsUri: '', substrateNodeUri: '' }),
        }),
      },
    };
  });
  await page.reload();
  await tid(page, 'connect-extension').click();
  await expect(tid(page, 'live-error')).toContainText('Switch it to Midnight Preview');
  expect(errors).toEqual([]);
});

test('the landing page and the on-chain page render', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One prescription, one fill');
  await page.getByRole('link', { name: 'On chain' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
