// SPDX-License-Identifier: Apache-2.0
//
// The public ledger as plain data: what anyone can read from the indexer without a key. The
// regulator dashboard and the ledger explorer render this, and the CLI writes it into the
// evidence file. Everything here is public by construction; nothing about a patient is in it.
import type { Ledger } from '@ampoule/contract';
import { hex, labelOf } from './bytes.js';

export interface DoctorView {
  id: string;
  /** Licence number, when the id is a readable label. */
  licence?: string;
  keyHash: string;
  active: boolean;
  issued: bigint;
  /** Prescriptions this doctor issued for a controlled class. */
  controlledIssued: bigint;
  /** Fills of this doctor's prescriptions, any class. */
  filled: bigint;
  controlledFilled: bigint;
}

export interface PharmacyView {
  id: string;
  licence?: string;
  keyHash: string;
  active: boolean;
  filled: bigint;
}

export interface PolicyView {
  drugClass: bigint;
  windowSeconds: bigint;
  maxFills: bigint;
}

export interface FillView {
  challenge: string;
  pharmacy: string;
  pharmacyLicence?: string;
  doctor: string;
  doctorLicence?: string;
  drugClass: bigint;
  /** Commitment to drug, quantity and a salt only the patient and the pharmacy know. */
  dispense: string;
  /** The proof was valid only before this block time. A coarse, public upper bound. */
  validBefore: bigint;
}

export interface PublicView {
  authorities: { council: string; controller: string; registrar: string };
  doctors: DoctorView[];
  pharmacies: PharmacyView[];
  policies: PolicyView[];
  fills: FillView[];
  totals: {
    issued: bigint;
    filled: bigint;
    /** Leaves in the patient tree: how many enrollments, not who. */
    enrolled: bigint;
    /** Leaves in the prescription tree. */
    prescriptions: bigint;
    fillNullifiers: bigint;
    capNullifiers: bigint;
  };
  /** Current Merkle roots, as decimal field elements. */
  roots: { patients: string; prescriptions: string };
  /** Fills per controlled class. */
  fillsByClass: Array<{ drugClass: bigint; fills: bigint }>;
}

const counter = (m: { member(k: Uint8Array): boolean; lookup(k: Uint8Array): { read(): bigint } }, k: Uint8Array) =>
  m.member(k) ? m.lookup(k).read() : 0n;

const byString = <T>(key: (v: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

export function publicView(l: Ledger): PublicView {
  const fills: FillView[] = [];
  const fillsByDoctor = new Map<string, { all: bigint; controlled: bigint }>();
  const byClass = new Map<bigint, bigint>();
  for (const [challenge, f] of l.fills) {
    const doctor = hex(f.doctor);
    fills.push({
      challenge: hex(challenge),
      pharmacy: hex(f.pharmacy),
      pharmacyLicence: labelOf(f.pharmacy),
      doctor,
      doctorLicence: labelOf(f.doctor),
      drugClass: f.drugClass,
      dispense: hex(f.dispense),
      validBefore: f.validBefore,
    });
    const d = fillsByDoctor.get(doctor) ?? { all: 0n, controlled: 0n };
    d.all += 1n;
    if (f.drugClass !== 0n) {
      d.controlled += 1n;
      byClass.set(f.drugClass, (byClass.get(f.drugClass) ?? 0n) + 1n);
    }
    fillsByDoctor.set(doctor, d);
  }

  const doctors: DoctorView[] = [];
  for (const [id, d] of l.doctors) {
    const f = fillsByDoctor.get(hex(id));
    doctors.push({
      id: hex(id),
      licence: labelOf(id),
      keyHash: hex(d.keyHash),
      active: d.active,
      issued: counter(l.issuedByDoctor, id),
      controlledIssued: counter(l.controlledByDoctor, id),
      filled: f?.all ?? 0n,
      controlledFilled: f?.controlled ?? 0n,
    });
  }

  const pharmacies: PharmacyView[] = [];
  for (const [id, p] of l.pharmacies) {
    pharmacies.push({
      id: hex(id),
      licence: labelOf(id),
      keyHash: hex(p.keyHash),
      active: p.active,
      filled: counter(l.filledByPharmacy, id),
    });
  }

  const policies: PolicyView[] = [];
  for (const [drugClass, p] of l.policies) policies.push({ drugClass, windowSeconds: p.window, maxFills: p.maxFills });

  return {
    authorities: { council: hex(l.council), controller: hex(l.controller), registrar: hex(l.registrar) },
    doctors: doctors.sort(byString((d) => d.licence ?? d.id)),
    pharmacies: pharmacies.sort(byString((p) => p.licence ?? p.id)),
    policies: policies.sort((a, b) => Number(a.drugClass - b.drugClass)),
    fills: fills.sort((a, b) => (a.validBefore === b.validBefore ? byString<FillView>((f) => f.challenge)(a, b) : Number(a.validBefore - b.validBefore))),
    totals: {
      issued: l.issuedTotal,
      filled: l.filledTotal,
      enrolled: l.patients.firstFree(),
      prescriptions: l.prescriptions.firstFree(),
      fillNullifiers: l.fillNullifiers.size(),
      capNullifiers: l.capNullifiers.size(),
    },
    roots: { patients: l.patients.root().field.toString(), prescriptions: l.prescriptions.root().field.toString() },
    fillsByClass: [...byClass.entries()].sort((a, b) => Number(a[0] - b[0])).map(([drugClass, n]) => ({ drugClass, fills: n })),
  };
}

/**
 * The public view as JSON-safe data (bigints as decimal strings), for evidence files and for
 * comparing two reads of the same state.
 */
export function viewToJson(view: PublicView): unknown {
  return JSON.parse(JSON.stringify(view, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
