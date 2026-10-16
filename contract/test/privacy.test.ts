// SPDX-License-Identifier: Apache-2.0
//
// The privacy boundary, asserted against the public transcript each call would put on chain
// (see docs/PRIVACY-BOUNDARY.md). A transcript is everything an observer of the chain sees
// for a call: every ledger key addressed and every value pushed or read.
import { describe, expect, it } from 'vitest';
import { pureCircuits as pure } from '../src/index.js';
import type { CircuitResult } from '../src/simulator.js';
import { DAY, OPIOIDS, id32, keyHex, leHex, transcriptMentions, transcriptValues, world } from './harness.js';

const TRAMADOL = { drug: 'tramadol-50-tab', drugClass: OPIOIDS, quantity: 10n };

/** 32-byte cells only: keys, hashes, ids. Short cells (small integers) collide by chance. */
const wide = (res: CircuitResult): Set<string> => new Set(transcriptValues(res).filter((v) => v.length >= 40));

describe('what issuing reveals', () => {
  it('the doctor, the class and one tree insertion; never the patient, the drug or even the leaf', () => {
    const { rao, ravi, net } = world();
    const rx = rao.write(ravi, TRAMADOL);
    const before = net.ledger.prescriptions.firstFree();
    const res = rao.issue(rx);
    expect(transcriptMentions(res, rao.id)).toBe(true);
    expect(net.ledger.prescriptions.firstFree()).toBe(before + 1n);
    // The tree stores a hash of the leaf, so the leaf bytes themselves never go public.
    expect(transcriptMentions(res, pure.rxLeafOf(rx))).toBe(false);
    expect(transcriptMentions(res, ravi.key)).toBe(false);
    expect(transcriptMentions(res, ravi.sk)).toBe(false);
    expect(transcriptMentions(res, rx.drug)).toBe(false);
    expect(transcriptMentions(res, rx.salt)).toBe(false);
    expect(transcriptValues(res)).not.toContain(leHex(rx.notAfter));
    expect(net.ledger.issuedTotal).toBe(1n);
  });
});

describe('what filling reveals', () => {
  it('the pharmacy, its challenge, the doctor, the class and two nullifiers', () => {
    const { rao, ravi, lotus, net } = world();
    const rx = rao.prescribe(ravi, TRAMADOL);
    const challenge = lotus.challenge();
    const res = ravi.fill(rx, lotus, { challenge });
    const epoch = net.sim.now / net.windowOf(OPIOIDS);
    expect(transcriptMentions(res, lotus.id)).toBe(true);
    expect(transcriptMentions(res, challenge)).toBe(true);
    expect(transcriptMentions(res, rao.id)).toBe(true);
    expect(transcriptMentions(res, pure.fillNullifierOf(ravi.sk, pure.rxLeafOf(rx), 0n))).toBe(true);
    expect(transcriptMentions(res, pure.capNullifierOf(ravi.sk, OPIOIDS, epoch, 0n))).toBe(true);
  });

  it('never the patient key, the prescription leaf, the drug, the expiry or any secret', () => {
    const { rao, ravi, lotus } = world();
    const rx = rao.prescribe(ravi, { ...TRAMADOL, validFor: 9n * DAY });
    const salt = id32('counter-salt-for-lotus');
    const res = ravi.fill(rx, lotus, { inputs: { dispenseSalt: salt } });
    expect(transcriptMentions(res, ravi.key)).toBe(false);
    expect(transcriptMentions(res, ravi.sk)).toBe(false);
    expect(transcriptMentions(res, pure.rxLeafOf(rx))).toBe(false);
    expect(transcriptMentions(res, rx.drug)).toBe(false);
    expect(transcriptMentions(res, rx.salt)).toBe(false);
    expect(transcriptMentions(res, salt)).toBe(false);
    expect(transcriptValues(res)).not.toContain(leHex(rx.notAfter));
  });

  it('the stored record holds a commitment to the drug, not the drug', () => {
    const { rao, ravi, lotus, net } = world();
    const rx = rao.prescribe(ravi, TRAMADOL);
    const challenge = lotus.challenge();
    ravi.fill(rx, lotus, { challenge });
    const rec = net.ledger.fills.lookup(challenge);
    expect(keyHex(rec.dispense)).not.toBe(keyHex(rx.drug));
    expect(Object.values(rec).some((v) => v instanceof Uint8Array && keyHex(v) === keyHex(rx.drug))).toBe(false);
  });

  it('the prescribing doctor cannot recognise the fill from the nullifier', () => {
    // The doctor knows every field of the prescription. The fill nullifier is keyed by the
    // patient secret, so recomputing it from the prescription alone is impossible: the best
    // the doctor can do is hash what they know, and that value is not in the transcript.
    const { rao, ravi, lotus } = world();
    const rx = rao.prescribe(ravi, TRAMADOL);
    const res = ravi.fill(rx, lotus);
    const guesses = [pure.rxLeafOf(rx), pure.fillNullifierOf(rx.salt, pure.rxLeafOf(rx), 0n), pure.fillNullifierOf(rx.patient, pure.rxLeafOf(rx), 0n)];
    for (const g of guesses) expect(transcriptMentions(res, g)).toBe(false);
  });
});

describe('unlinkability', () => {
  it('two fills by the same person share nothing that fills by two different people do not', () => {
    const { net, rao, mehta, lotus, neem, ravi } = world();
    const meera = net.patient();
    // Same doctor, class and pharmacy pairing for both comparisons, so only identity differs.
    const raviA = ravi.fill(rao.prescribe(ravi, TRAMADOL), lotus);
    net.sim.advance(31n * DAY);
    const raviB = ravi.fill(mehta.prescribe(ravi, TRAMADOL), neem);
    net.sim.advance(31n * DAY);
    const meeraA = meera.fill(rao.prescribe(meera, TRAMADOL), lotus);
    net.sim.advance(31n * DAY);
    const meeraB = meera.fill(mehta.prescribe(meera, TRAMADOL), neem);

    const intersect = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => b.has(x)));
    const samePerson = intersect(wide(raviA), wide(raviB));
    const crossPerson = intersect(wide(raviA), wide(meeraB));
    for (const v of samePerson) expect(crossPerson.has(v)).toBe(true);
    // And a different person at the same doctor and pharmacy looks exactly as related.
    expect(intersect(wide(raviA), wide(meeraA)).size).toBeGreaterThanOrEqual(samePerson.size);
  });

  it('refused attempts leave no trace at all', () => {
    const { net, rao, mehta, lotus, neem, ravi } = world();
    ravi.fill(rao.prescribe(ravi, TRAMADOL), lotus);
    const second = mehta.prescribe(ravi, TRAMADOL);
    const before = net.sim.state;
    expect(() => ravi.fill(second, neem)).toThrow(/CAP_REACHED/);
    expect(net.sim.state).toBe(before);
  });
});

describe('what the ledger holds at rest', () => {
  it('no patient key, drug code or prescription field appears anywhere in public state', () => {
    const { net, rao, mehta, lotus, neem, ravi } = world();
    const rxs = [
      rao.prescribe(ravi, TRAMADOL),
      mehta.prescribe(ravi, { drug: 'aspirin-75-tab', quantity: 30n, fills: 3n, validFor: 90n * DAY }),
    ];
    ravi.fill(rxs[0]!, lotus);
    ravi.fill(rxs[1]!, neem);
    const l = net.ledger;
    const publicBytes: string[] = [];
    for (const [k, v] of l.fills) publicBytes.push(keyHex(k), keyHex(v.pharmacy), keyHex(v.doctor), keyHex(v.dispense));
    for (const n of l.fillNullifiers) publicBytes.push(keyHex(n));
    for (const n of l.capNullifiers) publicBytes.push(keyHex(n));
    for (const rx of rxs) {
      expect(publicBytes).not.toContain(keyHex(rx.drug));
      expect(publicBytes).not.toContain(keyHex(rx.salt));
      expect(publicBytes).not.toContain(keyHex(pure.rxLeafOf(rx)));
    }
    expect(publicBytes).not.toContain(keyHex(ravi.key));
    expect(publicBytes).not.toContain(keyHex(ravi.sk));
  });
});
