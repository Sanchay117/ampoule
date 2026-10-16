// SPDX-License-Identifier: Apache-2.0
//
// The whole counter flow through the role clients: doctor writes and issues, the patient
// scans the pharmacy's request and fills, the pharmacist checks the opening against the chain.
import { describe, expect, it } from 'vitest';
import {
  DAY,
  decodeCounter,
  decodeDispense,
  decodeRx,
  drugId,
  equalBytes,
  hex,
  isRefusal,
  Patient,
  randomBytes32,
  Refusal,
  type Prescription,
} from '../src/index.js';
import { drug, OPIOIDS, T0, world } from './world.js';

const refusalCode = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    if (isRefusal(e)) return e.code;
    throw e;
  }
};

describe('a prescription from desk to counter', () => {
  it('issues, fills once, and lets the pharmacist verify exactly what to hand over', async () => {
    const { backend, rao, lotus, ravi } = await world();
    const rx = rao.write({ patient: ravi.publicKey, drug: drug('tramadol-50-tab'), notAfter: T0 + 14n * DAY });
    const { token } = await rao.issue(rx);

    // The patient's phone receives only the token and decodes the prescription from it.
    const received = decodeRx(token);
    expect(hex(received.salt)).toBe(hex(rx.salt));

    const { token: counterToken } = lotus.counterRequest();
    const counter = decodeCounter(counterToken);
    const filled = await ravi.fill(received, counter);
    expect(filled.plan.epoch).toBe(T0 / (30n * DAY));
    expect(filled.plan.validBefore).toBe(T0 + 1_800n);

    const check = await lotus.verify(decodeDispense(filled.token));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.drug?.code).toBe('tramadol-50-tab');
      expect(check.quantity).toBe(10n);
      expect(check.drugClass).toBe(OPIOIDS);
      expect(equalBytes(check.doctor, rao.id)).toBe(true);
    }
    expect((await backend.ledger()).filledTotal).toBe(1n);
  });

  it('a second fill of the same prescription is refused before anything is published', async () => {
    const { backend, rao, lotus, neem, ravi } = await world();
    const rx = rao.write({ patient: ravi.publicKey, drug: drug('amoxicillin-500-cap'), notAfter: T0 + 14n * DAY });
    await rao.issue(rx);
    await ravi.fill(rx, lotus.counterRequest().request);
    const before = backend.sim.state;
    const err = await ravi.fill(rx, neem.counterRequest().request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Refusal);
    expect((err as Refusal).code).toBe('ALREADY_FILLED');
    expect((err as Refusal).explanation).toMatch(/already been filled/);
    expect(backend.sim.state).toBe(before);
  });

  it('doctor shopping: a second opioid from another doctor at another pharmacy hits the cap', async () => {
    const { rao, mehta, lotus, neem, ravi } = await world();
    const order = { patient: ravi.publicKey, drug: drug('tramadol-50-tab'), notAfter: T0 + 60n * DAY };
    const first = rao.write(order);
    const second = mehta.write(order);
    await rao.issue(first);
    await mehta.issue(second);
    await ravi.fill(first, lotus.counterRequest().request);
    expect(await refusalCode(ravi.fill(second, neem.counterRequest().request))).toBe('CAP_REACHED');
  });

  it('a forged prescription is refused even when every field is plausible', async () => {
    const { rao, lotus, ravi } = await world();
    const forged: Prescription = rao.write({ patient: ravi.publicKey, drug: drug('morphine-10-tab'), notAfter: T0 + 9n * DAY });
    expect(await refusalCode(ravi.fill(forged, lotus.counterRequest().request))).toBe('NO_SUCH_PRESCRIPTION');
  });

  it('a stolen token is useless without the patient secret', async () => {
    const { backend, registrar, rao, lotus, ravi } = await world();
    const rx = rao.write({ patient: ravi.publicKey, drug: drug('tramadol-50-tab'), notAfter: T0 + 9n * DAY });
    await rao.issue(rx);
    const thief = new Patient(backend);
    await registrar.enroll(thief.publicKey);
    expect(await refusalCode(thief.fill(rx, lotus.counterRequest().request))).toBe('NOT_YOUR_PRESCRIPTION');
  });

  it('a counter request can be answered only once', async () => {
    const { rao, lotus, ravi } = await world();
    const a = rao.write({ patient: ravi.publicKey, drug: drug('amoxicillin-500-cap'), notAfter: T0 + 9n * DAY });
    const b = rao.write({ patient: ravi.publicKey, drug: drug('metformin-500-tab'), notAfter: T0 + 9n * DAY });
    await rao.issue(a);
    await rao.issue(b);
    const { request } = lotus.counterRequest();
    await ravi.fill(a, request);
    expect(await refusalCode(ravi.fill(b, request))).toBe('CHALLENGE_USED');
  });
});

describe('the pharmacist check', () => {
  it('rejects an opening for the wrong drug, the wrong quantity or the wrong pharmacy', async () => {
    const { rao, lotus, neem, ravi } = await world();
    const rx = rao.write({ patient: ravi.publicKey, drug: drug('azithromycin-500-tab'), notAfter: T0 + 9n * DAY });
    await rao.issue(rx);
    const { opening } = await ravi.fill(rx, lotus.counterRequest().request);

    expect(await lotus.verify({ ...opening, drug: drugId(drug('morphine-10-tab')) })).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(await lotus.verify({ ...opening, quantity: opening.quantity + 1n })).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(await neem.verify(opening)).toMatchObject({ ok: false, reason: 'other-pharmacy' });
    expect(await lotus.verify({ ...opening, challenge: randomBytes32() })).toMatchObject({ ok: false, reason: 'no-fill' });
    expect(await lotus.verify(opening)).toMatchObject({ ok: true });
  });
});

describe('what the patient can see on their own device', () => {
  it('fills left, expiry and the cap window, computed from public nullifiers alone', async () => {
    const { backend, rao, lotus, ravi } = await world();
    const rx = rao.write({ patient: ravi.publicKey, drug: drug('tramadol-50-tab'), fills: 2n, notAfter: T0 + 90n * DAY });
    expect((await ravi.status(rx)).issued).toBe(false);
    await rao.issue(rx);
    expect(await ravi.status(rx)).toMatchObject({ issued: true, fillsUsed: 0, fillsTotal: 2, expired: false, doctorActive: true });
    await ravi.fill(rx, lotus.counterRequest().request);
    const after = await ravi.status(rx);
    expect(after).toMatchObject({ fillsUsed: 1, cap: { used: 1, max: 1 } });
    expect(after.cap?.windowEndsAt).toBe((T0 / (30n * DAY) + 1n) * 30n * DAY);

    // Next window: the cap resets, the second fill goes through, the prescription is used up.
    backend.setTime(after.cap!.windowEndsAt + 60n);
    expect((await ravi.status(rx)).cap?.used).toBe(0);
    await ravi.fill(rx, lotus.counterRequest().request);
    expect(await ravi.status(rx)).toMatchObject({ fillsUsed: 2, cap: { used: 1 } });

    backend.setTime(T0 + 91n * DAY);
    expect((await ravi.status(rx)).expired).toBe(true);
  });

  it('another patient computing the same status learns nothing: their nullifiers differ', async () => {
    const { backend, registrar, rao, lotus, ravi } = await world();
    const rx = rao.write({ patient: ravi.publicKey, drug: drug('tramadol-50-tab'), notAfter: T0 + 9n * DAY });
    await rao.issue(rx);
    await ravi.fill(rx, lotus.counterRequest().request);
    const meera = new Patient(backend);
    await registrar.enroll(meera.publicKey);
    expect(await meera.status(rx)).toMatchObject({ issued: true, fillsUsed: 0, cap: { used: 0 } });
  });
});

describe('fill planning', () => {
  it('never publishes a deadline past the prescription expiry or the cap window', async () => {
    const { rao, lotus, ravi } = await world();
    const soon = rao.write({ patient: ravi.publicKey, drug: drug('amoxicillin-500-cap'), notAfter: T0 + 600n });
    const plan = await ravi.plan(soon, lotus.counterRequest().request);
    expect(plan.validBefore).toBe(T0 + 600n);
    expect(plan.epoch).toBe(0n);

    const window = 30n * DAY;
    const endOfWindow = (T0 / window + 1n) * window;
    const { backend } = await world(endOfWindow - 100n);
    const p = new Patient(backend);
    const late = rao.write({ patient: p.publicKey, drug: drug('tramadol-50-tab'), notAfter: endOfWindow + 9n * DAY });
    const latePlan = await p.plan(late, lotus.counterRequest().request);
    expect(latePlan.validBefore).toBe(endOfWindow);
  });
});
