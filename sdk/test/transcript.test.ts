// SPDX-License-Identifier: Apache-2.0
//
// The decoder against real transcripts: every operation of an issue and a fill is accounted
// for, the events say what they should, and no private value appears in any cell.
import { describe, expect, it } from 'vitest';
import {
  DAY,
  decodeTranscript,
  equalBytes,
  leBytes,
  pureCircuits as pure,
  scanTranscript,
  widen,
  cellToBigInt,
  type ChainEvent,
} from '../src/index.js';
import { drug, OPIOIDS, T0, world } from './world.js';

const of = <K extends ChainEvent['op']>(events: ChainEvent[], op: K) =>
  events.filter((e): e is Extract<ChainEvent, { op: K }> => e.op === op);

describe('decoding an issue', () => {
  it('reads the doctor record, checks the class policy, appends one hashed leaf, bumps three counters', async () => {
    const { rao, ravi } = await world();
    const rx = rao.write({ patient: ravi.publicKey, drug: drug('tramadol-50-tab'), notAfter: T0 + 9n * DAY });
    const { receipt } = await rao.issue(rx);
    const events = decodeTranscript(receipt.transcript!);

    expect(of(events, 'other')).toEqual([]);
    const doctorRead = of(events, 'read').find((e) => e.field === 'doctors');
    expect(doctorRead && equalBytes(widen(doctorRead.key!), rao.id)).toBe(true);
    expect(of(events, 'member').map((e) => [e.field, e.result])).toEqual([
      ['doctors', true],
      ['policies', true],
    ]);
    const tree = of(events, 'tree-insert');
    expect(tree.map((e) => e.field)).toEqual(['prescriptions']);
    // The tree holds a hash of the leaf, not the leaf.
    expect(equalBytes(widen(tree[0]!.leafHash), pure.rxLeafOf(rx))).toBe(false);
    expect(of(events, 'increment').map((e) => e.field).sort()).toEqual(['controlledByDoctor', 'issuedByDoctor', 'issuedTotal']);
  });
});

describe('decoding a fill', () => {
  it('shows the pharmacy, the challenge, two root checks, two time bounds and two fresh nullifiers', async () => {
    const { rao, lotus, ravi } = await world();
    const rx = rao.write({ patient: ravi.publicKey, drug: drug('tramadol-50-tab'), notAfter: T0 + 9n * DAY });
    await rao.issue(rx);
    const counter = lotus.counterRequest().request;
    const { receipt, plan } = await ravi.fill(rx, counter);
    const events = decodeTranscript(receipt.transcript!);
    expect(of(events, 'other')).toEqual([]);

    const members = of(events, 'member');
    expect(members.map((e) => `${e.field}${e.sub ? `/${e.sub}` : ''}:${e.result}`)).toEqual([
      'pharmacies:true',
      'fills:false',
      'patients/root history:true',
      'prescriptions/root history:true',
      'fillNullifiers:false',
      'capNullifiers:false',
    ]);
    expect(of(events, 'time')).toEqual([
      { op: 'time', relation: 'before', seconds: plan.validBefore },
      { op: 'time', relation: 'not-before', seconds: plan.epoch * 30n * DAY },
    ]);

    const inserts = of(events, 'insert');
    expect(inserts.map((e) => e.field)).toEqual(['fillNullifiers', 'capNullifiers', 'fills']);
    const leaf = pure.rxLeafOf(rx);
    expect(equalBytes(widen(inserts[0]!.key), pure.fillNullifierOf(ravi.persona.secretKey, leaf, 0n))).toBe(true);
    expect(equalBytes(widen(inserts[1]!.key), pure.capNullifierOf(ravi.persona.secretKey, OPIOIDS, plan.epoch, 0n))).toBe(true);
    expect(equalBytes(widen(inserts[2]!.key), counter.challenge)).toBe(true);
    // The stored record: pharmacy, doctor, class, dispense commitment, deadline.
    const [ph, doc, cls, , vb] = inserts[2]!.value;
    expect(equalBytes(widen(ph!), lotus.id)).toBe(true);
    expect(equalBytes(widen(doc!), rao.id)).toBe(true);
    expect(cellToBigInt(cls!)).toBe(OPIOIDS);
    expect(cellToBigInt(vb!)).toBe(plan.validBefore);
  });

  it('no secret and no prescription field is in any cell', async () => {
    const { rao, lotus, ravi } = await world();
    const rx = rao.write({ patient: ravi.publicKey, drug: drug('tramadol-50-tab'), notAfter: T0 + 9n * DAY + 77n });
    await rao.issue(rx);
    const { receipt, opening } = await ravi.fill(rx, lotus.counterRequest().request);
    const scan = scanTranscript(receipt.transcript!, {
      'patient secret': ravi.persona.secretKey,
      'patient key': ravi.publicKey,
      'prescription leaf': pure.rxLeafOf(rx),
      'drug code': rx.drug,
      'prescription salt': rx.salt,
      'dispense salt': opening.salt,
      expiry: leBytes(rx.notAfter),
      'pharmacy licence': lotus.id,
    });
    expect(scan.present).toEqual(['pharmacy licence']);
    expect(scan.absent).toEqual(['patient secret', 'patient key', 'prescription leaf', 'drug code', 'prescription salt', 'dispense salt', 'expiry']);
  });
});

describe('decoding authority calls', () => {
  it('licensing a doctor and enrolling a patient', async () => {
    const { council, registrar, backend } = await world();
    const { Doctor, Patient, id32 } = await import('../src/index.js');
    const d = new Doctor(backend, id32('MC-KA-77001'));
    const lic = decodeTranscript((await council.license(d)).transcript!);
    expect(of(lic, 'other')).toEqual([]);
    expect(of(lic, 'insert').map((e) => e.field)).toEqual(['issuedByDoctor', 'controlledByDoctor', 'doctors']);

    const p = new Patient(backend);
    const enrolled = (await registrar.enroll(p.publicKey)).transcript!;
    const enr = decodeTranscript(enrolled);
    expect(of(enr, 'other')).toEqual([]);
    expect(of(enr, 'tree-insert').map((e) => e.field)).toEqual(['patients']);
    // Even the enrollment itself publishes only a hash of the patient key.
    expect(scanTranscript(enrolled, { 'patient key': p.publicKey })).toMatchObject({ present: [], absent: ['patient key'] });
  });
});
