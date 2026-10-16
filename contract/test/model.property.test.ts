// SPDX-License-Identifier: Apache-2.0
//
// Random histories against a reference model. fast-check generates sequences of issuing,
// filling (honest and dishonest), time jumps and licence changes; after every step the
// contract's verdict must match what a plain TypeScript model of the rules predicts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Prescription } from '../src/index.js';
import { DAY, OPIOIDS, WINDOW, refusalOf, world } from './harness.js';

type Cmd =
  | { kind: 'issue'; doctor: number; patient: number; controlled: boolean; fills: number; validDays: number }
  | { kind: 'fill'; rx: number; pharmacy: number; thief: boolean }
  | { kind: 'advance'; seconds: number }
  | { kind: 'toggle'; doctor: number };

const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('issue' as const), doctor: fc.nat(1), patient: fc.nat(1), controlled: fc.boolean(), fills: fc.integer({ min: 1, max: 2 }), validDays: fc.integer({ min: 1, max: 45 }) }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('fill' as const), rx: fc.nat(40), pharmacy: fc.nat(1), thief: fc.integer({ min: 0, max: 6 }).map((n) => n === 0) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('advance' as const), seconds: fc.integer({ min: 0, max: 20 * 86_400 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('toggle' as const), doctor: fc.nat(1) }) },
);

interface ModelRx { rx: Prescription; patient: number; doctor: number; used: number }

describe('random histories match the reference model', () => {
  it('fills, caps, expiry and suspensions', () => {
    fc.assert(
      fc.property(fc.array(cmd, { minLength: 1, maxLength: 24 }), (cmds) => {
        const { net, rao, mehta, apollo, medplus, ravi } = world();
        const doctors = [rao, mehta];
        const pharmacies = [apollo, medplus];
        const patients = [ravi, net.patient()];
        const active = [true, true];
        const rxs: ModelRx[] = [];
        const capUse = new Map<string, number>();
        let issued = 0;
        let filled = 0;

        for (const c of cmds) {
          if (c.kind === 'advance') {
            net.sim.advance(BigInt(c.seconds));
            continue;
          }
          if (c.kind === 'toggle') {
            active[c.doctor] = !active[c.doctor];
            net.council.setDoctor(doctors[c.doctor]!.id, doctors[c.doctor]!.keyHash, active[c.doctor]!);
            continue;
          }
          if (c.kind === 'issue') {
            const d = doctors[c.doctor]!;
            const rx = d.write(patients[c.patient]!, {
              drugClass: c.controlled ? OPIOIDS : 0n,
              fills: BigInt(c.fills),
              validFor: BigInt(c.validDays) * DAY,
            });
            const want = active[c.doctor] ? undefined : 'DOCTOR_SUSPENDED';
            expect(refusalOf(() => d.issue(rx))).toBe(want);
            if (!want) {
              rxs.push({ rx, patient: c.patient, doctor: c.doctor, used: 0 });
              issued++;
            }
            continue;
          }
          // fill
          if (rxs.length === 0) continue;
          const m = rxs[c.rx % rxs.length]!;
          const filler = c.thief ? 1 - m.patient : m.patient;
          const now = net.sim.now;
          const epoch = now / WINDOW;
          const capKey = `${filler}:${epoch}`;
          let want: string | undefined;
          if (filler !== m.patient) want = 'NOT_YOUR_PRESCRIPTION';
          else if (!active[m.doctor]) want = 'DOCTOR_SUSPENDED';
          else if (m.rx.notAfter <= now) want = 'REQUEST_EXPIRED';
          else if (m.used >= Number(m.rx.fills)) want = 'ALREADY_FILLED';
          else if (m.rx.drugClass !== 0n && (capUse.get(capKey) ?? 0) >= 1) want = 'CAP_REACHED';
          const got = refusalOf(() => patients[filler]!.fill(m.rx, pharmacies[c.pharmacy]!));
          expect(got).toBe(want);
          if (!want) {
            m.used++;
            filled++;
            if (m.rx.drugClass !== 0n) capUse.set(capKey, (capUse.get(capKey) ?? 0) + 1);
          }
        }

        const l = net.ledger;
        expect(l.issuedTotal).toBe(BigInt(issued));
        expect(l.filledTotal).toBe(BigInt(filled));
        expect(l.fillNullifiers.size()).toBe(BigInt(filled));
        expect(l.capNullifiers.size()).toBe(BigInt([...capUse.values()].reduce((a, b) => a + b, 0)));
        expect(l.fills.size()).toBe(BigInt(filled));
      }),
      { numRuns: 40 },
    );
  });
});
