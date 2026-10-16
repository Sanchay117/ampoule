// SPDX-License-Identifier: Apache-2.0
//
// The public view is what a regulator dashboard shows. It must carry the aggregates that make
// oversight possible (per doctor, per pharmacy, per class) and nothing about any patient.
import { describe, expect, it } from 'vitest';
import { DAY, hex, Patient, publicView, pureCircuits as pure, viewToJson } from '../src/index.js';
import { drug, OPIOIDS, T0, world } from './world.js';

describe('the public view', () => {
  it('aggregates per doctor, pharmacy and class, and names licences', async () => {
    const { backend, registrar, rao, mehta, lotus, neem, ravi } = await world();
    const meera = new Patient(backend);
    await registrar.enroll(meera.publicKey);
    const opioid = { drug: drug('tramadol-50-tab'), notAfter: T0 + 20n * DAY };
    for (const p of [ravi, meera]) {
      const rx = rao.write({ patient: p.publicKey, ...opioid });
      await rao.issue(rx);
      await p.fill(rx, lotus.counterRequest().request);
    }
    const general = mehta.write({ patient: ravi.publicKey, drug: drug('metformin-500-tab'), notAfter: T0 + 20n * DAY });
    await mehta.issue(general);
    await ravi.fill(general, neem.counterRequest().request);

    const v = publicView(await backend.ledger());
    expect(v.totals).toMatchObject({ issued: 3n, filled: 3n, enrolled: 2n, prescriptions: 3n, fillNullifiers: 3n, capNullifiers: 2n });
    expect(v.doctors.map((d) => [d.licence, d.issued, d.controlledIssued, d.filled, d.controlledFilled])).toEqual([
      ['MC-DL-58213', 2n, 2n, 2n, 2n],
      ['MC-MH-11902', 1n, 0n, 1n, 0n],
    ]);
    expect(v.pharmacies.map((p) => [p.licence, p.filled])).toEqual([
      ['DL-RX-20B-4471', 2n],
      ['MH-RX-21B-0932', 1n],
    ]);
    expect(v.policies).toEqual([{ drugClass: OPIOIDS, windowSeconds: 30n * DAY, maxFills: 1n }]);
    expect(v.fillsByClass).toEqual([{ drugClass: OPIOIDS, fills: 2n }]);
    expect(v.fills).toHaveLength(3);

    // Nothing that identifies a patient is anywhere in it.
    const json = JSON.stringify(viewToJson(v));
    for (const p of [ravi, meera]) {
      expect(json).not.toContain(hex(p.publicKey));
      expect(json).not.toContain(hex(p.persona.secretKey));
    }
    expect(json).not.toContain(hex(general.drug));
    expect(json).not.toContain(hex(pure.rxLeafOf(general)));
  });
});
