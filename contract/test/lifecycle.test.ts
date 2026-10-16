// SPDX-License-Identifier: Apache-2.0
//
// Happy paths: every circuit, driven through the simulator, with the public state it
// leaves behind asserted.
import { describe, expect, it } from 'vitest';
import { pureCircuits as pure } from '../src/index.js';
import { DAY, OPIOIDS, WINDOW, hex, id32, world } from './harness.js';

describe('authorities', () => {
  it('seals the three authority keys at deploy', () => {
    const { net } = world();
    const l = net.ledger;
    expect(hex(l.council)).toBe(hex(pure.councilKeyOf(net.council.sk)));
    expect(hex(l.controller)).toBe(hex(pure.controllerKeyOf(net.controller.sk)));
    expect(hex(l.registrar)).toBe(hex(pure.registrarKeyOf(net.registrar.sk)));
  });

  it('licenses doctors and pharmacies with zeroed counters', () => {
    const { net, rao, apollo } = world();
    const l = net.ledger;
    expect(l.doctors.lookup(rao.id)).toEqual({ keyHash: rao.keyHash, active: true });
    expect(l.pharmacies.lookup(apollo.id)).toEqual({ keyHash: apollo.keyHash, active: true });
    expect(l.issuedByDoctor.lookup(rao.id).read()).toBe(0n);
    expect(l.controlledByDoctor.lookup(rao.id).read()).toBe(0n);
    expect(l.filledByPharmacy.lookup(apollo.id).read()).toBe(0n);
  });

  it('suspends and reinstates a doctor without resetting their counters', () => {
    const { net, rao, ravi } = world();
    rao.prescribe(ravi);
    net.council.suspend(rao);
    expect(net.ledger.doctors.lookup(rao.id).active).toBe(false);
    net.council.license(rao);
    expect(net.ledger.doctors.lookup(rao.id).active).toBe(true);
    expect(net.ledger.issuedByDoctor.lookup(rao.id).read()).toBe(1n);
  });

  it('rotates a doctor key: the old key stops working, the new one works', () => {
    const { net, rao, ravi } = world();
    const fresh = net.doctor('unused');
    net.council.setDoctor(rao.id, fresh.keyHash, true);
    expect(() => rao.prescribe(ravi)).toThrow(/NOT_THIS_DOCTOR/);
    const rx = rao.write(ravi);
    fresh.issue({ ...rx });
    expect(net.ledger.issuedTotal).toBe(1n);
  });

  it('stores cap policies per controlled class', () => {
    const { net } = world();
    net.controller.setPolicy(5n, 7n * DAY, 2n);
    expect(net.ledger.policies.lookup(OPIOIDS)).toEqual({ window: WINDOW, maxFills: 1n });
    expect(net.ledger.policies.lookup(5n)).toEqual({ window: 7n * DAY, maxFills: 2n });
  });

  it('enrolls patient keys into the patient tree', () => {
    const { net, ravi } = world();
    const other = net.patient();
    const l = net.ledger;
    expect(l.patients.findPathForLeaf(ravi.key)).toBeDefined();
    expect(l.patients.findPathForLeaf(other.key)).toBeDefined();
    expect(l.patients.firstFree()).toBe(2n);
  });
});

describe('issuing', () => {
  it('seals one leaf per prescription and counts it against the doctor', () => {
    const { net, rao, ravi } = world();
    const rx = rao.prescribe(ravi);
    const l = net.ledger;
    expect(l.prescriptions.findPathForLeaf(pure.rxLeafOf(rx))).toBeDefined();
    expect(l.issuedTotal).toBe(1n);
    expect(l.issuedByDoctor.lookup(rao.id).read()).toBe(1n);
    expect(l.controlledByDoctor.lookup(rao.id).read()).toBe(0n);
  });

  it('counts controlled prescriptions separately, for pill-mill detection', () => {
    const { net, rao, ravi } = world();
    rao.prescribe(ravi, { drug: 'RXCUI:835603 tramadol 50mg', drugClass: OPIOIDS, quantity: 10n });
    rao.prescribe(ravi);
    expect(net.ledger.issuedByDoctor.lookup(rao.id).read()).toBe(2n);
    expect(net.ledger.controlledByDoctor.lookup(rao.id).read()).toBe(1n);
  });
});

describe('filling', () => {
  it('fills a general prescription and leaves a record for the pharmacy', () => {
    const { net, rao, apollo, ravi } = world();
    const rx = rao.prescribe(ravi);
    const challenge = apollo.challenge();
    const salt = id32('dispense-salt');
    ravi.fill(rx, apollo, { challenge, inputs: { dispenseSalt: salt } });
    const l = net.ledger;
    const rec = l.fills.lookup(challenge);
    expect(rec.pharmacy).toEqual(apollo.id);
    expect(rec.doctor).toEqual(rao.id);
    expect(rec.drugClass).toBe(0n);
    // The pharmacy opens the commitment with what the patient shows at the counter.
    expect(hex(rec.dispense)).toBe(hex(pure.dispenseCommitOf(rx.drug, rx.quantity, salt)));
    expect(rec.validBefore > net.sim.now).toBe(true);
    expect(l.filledTotal).toBe(1n);
    expect(l.filledByPharmacy.lookup(apollo.id).read()).toBe(1n);
    expect(l.fillNullifiers.size()).toBe(1n);
    expect(l.capNullifiers.size()).toBe(0n);
  });

  it('fills a controlled prescription and spends one cap slot', () => {
    const { net, rao, apollo, ravi } = world();
    const rx = rao.prescribe(ravi, { drug: 'RXCUI:835603 tramadol 50mg', drugClass: OPIOIDS, quantity: 10n });
    const challenge = apollo.challenge();
    ravi.fill(rx, apollo, { challenge });
    const l = net.ledger;
    expect(l.fills.lookup(challenge).drugClass).toBe(OPIOIDS);
    expect(l.capNullifiers.size()).toBe(1n);
    const epoch = net.sim.now / WINDOW;
    expect(l.capNullifiers.member(pure.capNullifierOf(ravi.sk, OPIOIDS, epoch, 0n))).toBe(true);
  });

  it('allows exactly the prescribed number of fills (refills), at any pharmacy', () => {
    const { net, rao, apollo, medplus, ravi } = world();
    const rx = rao.prescribe(ravi, { fills: 3n, validFor: 90n * DAY });
    ravi.fill(rx, apollo);
    net.sim.advance(30n * DAY);
    ravi.fill(rx, medplus);
    net.sim.advance(30n * DAY);
    ravi.fill(rx, apollo);
    expect(net.ledger.filledTotal).toBe(3n);
    expect(net.ledger.filledByPharmacy.lookup(apollo.id).read()).toBe(2n);
    expect(() => ravi.fill(rx, medplus)).toThrow(/ALREADY_FILLED/);
  });

  it('a cap of two allows a second controlled fill in the same window, not a third', () => {
    const { net, rao, mehta, apollo, medplus, ravi } = world();
    net.controller.setPolicy(4n, 7n * DAY, 2n);
    const benzo = { drug: 'RXCUI:197591 alprazolam 0.5mg', drugClass: 4n, quantity: 7n };
    ravi.fill(rao.prescribe(ravi, benzo), apollo);
    ravi.fill(mehta.prescribe(ravi, benzo), medplus);
    expect(() => ravi.fill(rao.prescribe(ravi, benzo), apollo)).toThrow(/CAP_REACHED/);
  });

  it('opens a fresh cap in the next window', () => {
    const { net, rao, mehta, apollo, medplus, ravi } = world();
    const tramadol = { drug: 'RXCUI:835603 tramadol 50mg', drugClass: OPIOIDS, quantity: 10n, validFor: 60n * DAY };
    ravi.fill(rao.prescribe(ravi, tramadol), apollo);
    const second = mehta.prescribe(ravi, tramadol);
    expect(() => ravi.fill(second, medplus)).toThrow(/CAP_REACHED/);
    // Jump to the start of the next window.
    net.sim.setTime((net.sim.now / WINDOW + 1n) * WINDOW + 60n);
    ravi.fill(second, medplus);
    expect(net.ledger.capNullifiers.size()).toBe(2n);
  });

  it('caps are per person: two patients never interfere', () => {
    const { net, rao, apollo, ravi } = world();
    const meera = net.patient();
    const tramadol = { drug: 'RXCUI:835603 tramadol 50mg', drugClass: OPIOIDS, quantity: 10n };
    ravi.fill(rao.prescribe(ravi, tramadol), apollo);
    meera.fill(rao.prescribe(meera, tramadol), apollo);
    expect(net.ledger.filledTotal).toBe(2n);
  });

  it('proves against a historic root: issuing more prescriptions does not break a fill', () => {
    const { net, rao, apollo, ravi } = world();
    const rx = rao.prescribe(ravi);
    // Path computed now, then the tree moves on before the patient submits.
    const path = net.ledger.prescriptions.findPathForLeaf(pure.rxLeafOf(rx))!;
    for (let i = 0; i < 5; i++) rao.prescribe(ravi);
    ravi.fill(rx, apollo, { inputs: { paths: { [hex(pure.rxLeafOf(rx))]: path } } });
    expect(net.ledger.filledTotal).toBe(1n);
  });
});
