// SPDX-License-Identifier: Apache-2.0
//
// One scenario per refusal code, plus attacks that lie through witnesses. Every refusal
// must leave the ledger exactly as it was.
import { describe, expect, it } from 'vitest';
import { REFUSALS, dummyPath, pureCircuits as pure, type Prescription } from '../src/index.js';
import { DAY, OPIOIDS, WINDOW, expectRefusal, hex, id32, randomBytes32, refusalOf, world } from './harness.js';

const TRAMADOL = { drug: 'tramadol-50-tab', drugClass: OPIOIDS, quantity: 10n };

/** Runs `fn`, expects `code`, and checks the contract state did not move. */
function refusedWithoutEffect(net: ReturnType<typeof world>['net'], fn: () => unknown, code: string) {
  const before = net.sim.state;
  expectRefusal(fn, code);
  expect(net.sim.state).toBe(before);
}

describe('authority refusals', () => {
  it('NOT_COUNCIL: a doctor cannot license themselves', () => {
    const { net, rao } = world();
    refusedWithoutEffect(net, () => net.sim.call(rao.ps, 'setDoctor', [id32('fake'), rao.keyHash, true]), 'NOT_COUNCIL');
  });

  it('NOT_COUNCIL: the controller cannot license doctors either (separation of duties)', () => {
    const { net, rao } = world();
    refusedWithoutEffect(net, () => net.sim.call(net.controller.ps, 'setDoctor', [rao.id, rao.keyHash, false]), 'NOT_COUNCIL');
  });

  it('NOT_CONTROLLER: only the controller licenses pharmacies and sets caps', () => {
    const { net, lotus } = world();
    refusedWithoutEffect(net, () => net.sim.call(net.council.ps, 'setPharmacy', [lotus.id, lotus.keyHash, false]), 'NOT_CONTROLLER');
    refusedWithoutEffect(net, () => net.sim.call(lotus.ps, 'setPolicy', [OPIOIDS, WINDOW, 9n]), 'NOT_CONTROLLER');
  });

  it('NOT_REGISTRAR: nobody else can enroll patients', () => {
    const { net, rao } = world();
    refusedWithoutEffect(net, () => net.sim.call(rao.ps, 'enrollPatient', [randomBytes32()]), 'NOT_REGISTRAR');
  });

  it('GENERAL_CLASS_HAS_NO_CAP and BAD_POLICY', () => {
    const { net } = world();
    refusedWithoutEffect(net, () => net.controller.setPolicy(0n, WINDOW, 1n), 'GENERAL_CLASS_HAS_NO_CAP');
    refusedWithoutEffect(net, () => net.controller.setPolicy(7n, 0n, 1n), 'BAD_POLICY');
    refusedWithoutEffect(net, () => net.controller.setPolicy(7n, WINDOW, 0n), 'BAD_POLICY');
  });
});

describe('issuing refusals', () => {
  it('UNKNOWN_DOCTOR: an unlicensed doctor cannot issue', () => {
    const { net, ravi } = world();
    const quack = net.doctor('MC-XX-00000', false);
    refusedWithoutEffect(net, () => quack.prescribe(ravi), 'UNKNOWN_DOCTOR');
  });

  it('NOT_THIS_DOCTOR: nobody can issue in a licensed doctor’s name without their key', () => {
    const { net, rao, mehta, ravi } = world();
    const rx = rao.write(ravi);
    refusedWithoutEffect(net, () => mehta.issue(rx), 'NOT_THIS_DOCTOR');
  });

  it('DOCTOR_SUSPENDED: a suspended doctor cannot issue', () => {
    const { net, rao, ravi } = world();
    net.council.suspend(rao);
    refusedWithoutEffect(net, () => rao.prescribe(ravi), 'DOCTOR_SUSPENDED');
  });

  it('NO_FILLS and NO_QUANTITY', () => {
    const { net, rao, ravi } = world();
    refusedWithoutEffect(net, () => rao.prescribe(ravi, { fills: 0n }), 'NO_FILLS');
    refusedWithoutEffect(net, () => rao.prescribe(ravi, { quantity: 0n }), 'NO_QUANTITY');
  });

  it('UNKNOWN_CLASS: a controlled class needs a cap policy before anyone can prescribe it', () => {
    const { net, rao, ravi } = world();
    refusedWithoutEffect(net, () => rao.prescribe(ravi, { drugClass: 9n }), 'UNKNOWN_CLASS');
  });
});

describe('filling refusals', () => {
  it('UNKNOWN_PHARMACY and PHARMACY_SUSPENDED', () => {
    const { net, rao, lotus, ravi } = world();
    const rx = rao.prescribe(ravi);
    const backroom = net.pharmacy('DL-RX-00000', false);
    refusedWithoutEffect(net, () => ravi.fill(rx, backroom), 'UNKNOWN_PHARMACY');
    net.controller.suspend(lotus);
    refusedWithoutEffect(net, () => ravi.fill(rx, lotus), 'PHARMACY_SUSPENDED');
  });

  it('CHALLENGE_USED: a counter challenge answers one fill only', () => {
    const { net, rao, lotus, ravi } = world();
    const challenge = lotus.challenge();
    ravi.fill(rao.prescribe(ravi), lotus, { challenge });
    const another = rao.prescribe(ravi);
    refusedWithoutEffect(net, () => ravi.fill(another, lotus, { challenge }), 'CHALLENGE_USED');
  });

  it('NOT_ENROLLED: an unenrolled key cannot fill, even holding a real prescription for it', () => {
    const { net, rao, lotus } = world();
    const stranger = net.patient(false);
    const rx = rao.prescribe(stranger);
    refusedWithoutEffect(net, () => stranger.fill(rx, lotus), 'NOT_ENROLLED');
  });

  it('NOT_ENROLLED: a fake membership path is refused', () => {
    const { net, rao, lotus } = world();
    const stranger = net.patient(false);
    const rx = rao.prescribe(stranger);
    const fake = dummyPath(stranger.key);
    refusedWithoutEffect(net, () => stranger.fill(rx, lotus, { inputs: { paths: { [hex(stranger.key)]: fake } } }), 'NOT_ENROLLED');
  });

  it('NOT_YOUR_PRESCRIPTION: a stolen prescription cannot be filled by someone else', () => {
    const { net, rao, lotus, ravi } = world();
    const thief = net.patient();
    const rx = rao.prescribe(ravi, TRAMADOL);
    refusedWithoutEffect(net, () => thief.fill(rx, lotus), 'NOT_YOUR_PRESCRIPTION');
  });

  it('NO_SUCH_PRESCRIPTION: a forged prescription has no leaf', () => {
    const { net, rao, lotus, ravi } = world();
    const forged = rao.write(ravi, TRAMADOL); // written, never issued
    refusedWithoutEffect(net, () => ravi.fill(forged, lotus), 'NO_SUCH_PRESCRIPTION');
  });

  it('NO_SUCH_PRESCRIPTION: altering any field of a real prescription breaks it', () => {
    const { net, rao, lotus, ravi } = world();
    const rx = rao.prescribe(ravi, TRAMADOL);
    const tampered: Prescription[] = [
      { ...rx, quantity: 100n },
      { ...rx, fills: 5n },
      { ...rx, drug: id32('oxycodone-30-tab') },
      { ...rx, notAfter: rx.notAfter + 365n * DAY },
      { ...rx, drugClass: 0n },
    ];
    for (const t of tampered) refusedWithoutEffect(net, () => ravi.fill(t, lotus), 'NO_SUCH_PRESCRIPTION');
  });

  it('NO_SUCH_PRESCRIPTION: a path for another leaf does not help', () => {
    const { net, rao, lotus, ravi } = world();
    const real = rao.prescribe(ravi);
    const forged = { ...real, quantity: 999n };
    const path = net.ledger.prescriptions.findPathForLeaf(pure.rxLeafOf(real))!;
    const inputs = { paths: { [hex(pure.rxLeafOf(forged))]: path } };
    refusedWithoutEffect(net, () => ravi.fill(forged, lotus, { inputs }), 'NO_SUCH_PRESCRIPTION');
  });

  it('DOCTOR_SUSPENDED: suspending a doctor stops their open prescriptions everywhere', () => {
    const { net, mehta, lotus, ravi } = world();
    const rx = mehta.prescribe(ravi, TRAMADOL);
    net.council.suspend(mehta);
    refusedWithoutEffect(net, () => ravi.fill(rx, lotus), 'DOCTOR_SUSPENDED');
  });

  it('PRESCRIPTION_EXPIRED: an expired prescription cannot be filled', () => {
    const { net, rao, lotus, ravi } = world();
    const rx = rao.prescribe(ravi, { validFor: 7n * DAY });
    net.sim.advance(8n * DAY);
    refusedWithoutEffect(net, () => ravi.fill(rx, lotus), 'REQUEST_EXPIRED');
    // A wallet that picks validBefore = notAfter (already past) hits the same wall.
    refusedWithoutEffect(net, () => ravi.fill(rx, lotus, { validBefore: rx.notAfter }), 'REQUEST_EXPIRED');
    // Claiming a future validity bound beyond the prescription's expiry is refused too.
    refusedWithoutEffect(net, () => ravi.fill(rx, lotus, { validBefore: net.sim.now + 3_600n }), 'PRESCRIPTION_EXPIRED');
  });

  it('REQUEST_EXPIRED: a proof made for a past time cannot be replayed later', () => {
    const { net, rao, lotus, ravi } = world();
    const rx = rao.prescribe(ravi);
    refusedWithoutEffect(net, () => ravi.fill(rx, lotus, { validBefore: net.sim.now - 1n }), 'REQUEST_EXPIRED');
  });

  it('ALREADY_FILLED: one prescription, one fill, across every pharmacy', () => {
    const { net, rao, lotus, neem, ravi } = world();
    const rx = rao.prescribe(ravi, { ...TRAMADOL, validFor: 60n * DAY });
    ravi.fill(rx, lotus);
    net.sim.advance(31n * DAY); // even after the cap window resets
    refusedWithoutEffect(net, () => ravi.fill(rx, neem), 'ALREADY_FILLED');
  });

  it('ALREADY_FILLED: lying about the fill index does not reopen a used fill', () => {
    const { net, rao, lotus, ravi } = world();
    const rx = rao.prescribe(ravi, { fills: 2n });
    ravi.fill(rx, lotus);
    refusedWithoutEffect(net, () => ravi.fill(rx, lotus, { inputs: { fillIndex: 0n } }), 'ALREADY_FILLED');
    refusedWithoutEffect(net, () => ravi.fill(rx, lotus, { inputs: { fillIndex: 2n } }), 'ALREADY_FILLED');
  });

  it('WRONG_WINDOW: a past or future window cannot be used to dodge the cap', () => {
    const { net, rao, lotus, ravi } = world();
    const now = net.sim.now;
    const epoch = now / WINDOW;
    const rx = rao.prescribe(ravi, TRAMADOL);
    // Next window: it has not started yet.
    refusedWithoutEffect(net, () => ravi.fill(rx, lotus, { epoch: epoch + 1n }), 'WRONG_WINDOW');
    // Previous window: the validity bound must fall inside the claimed window.
    refusedWithoutEffect(net, () => ravi.fill(rx, lotus, { epoch: epoch - 1n, validBefore: now + 3_600n }), 'WRONG_WINDOW');
  });

  it('CAP_REACHED: doctor shopping is refused, without anyone learning who', () => {
    const { net, rao, mehta, lotus, neem, ravi } = world();
    ravi.fill(rao.prescribe(ravi, TRAMADOL), lotus);
    const second = mehta.prescribe(ravi, TRAMADOL);
    refusedWithoutEffect(net, () => ravi.fill(second, neem), 'CAP_REACHED');
  });

  it('CAP_REACHED: lying about the cap slot does not help', () => {
    const { net, rao, mehta, lotus, neem, ravi } = world();
    ravi.fill(rao.prescribe(ravi, TRAMADOL), lotus);
    const second = mehta.prescribe(ravi, TRAMADOL);
    refusedWithoutEffect(net, () => ravi.fill(second, neem, { inputs: { capSlot: 0n } }), 'CAP_REACHED');
    refusedWithoutEffect(net, () => ravi.fill(second, neem, { inputs: { capSlot: 1n } }), 'CAP_REACHED');
  });
});

describe('the refusal catalogue', () => {
  it('every assert in the contract has a human explanation, and every explanation is used', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/ampoule.compact', import.meta.url), 'utf8');
    const codes = new Set([...src.matchAll(/assert\([^;]*?"([A-Z_]+)"\)/gs)].map((m) => m[1]));
    expect([...codes].sort()).toEqual(Object.keys(REFUSALS).sort());
  });

  it('refusalOf passes through non-assert errors', () => {
    expect(() => refusalOf(() => { throw new Error('boom'); })).toThrow('boom');
  });
});
