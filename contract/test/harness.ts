// SPDX-License-Identifier: Apache-2.0
//
// Test harness over the in-process simulator: personas for every role, a ready-made
// network, and helpers to read the public transcript a call would put on chain.
import { expect } from 'vitest';
import {
  pureCircuits as pure,
  refusalCodeOf,
  type AmpoulePrivateState,
  type CallInputs,
  type Prescription,
  type Role,
} from '../src/index.js';
import { AmpouleSimulator, type CircuitResult } from '../src/simulator.js';

export const DAY = 86_400n;
/** 2026-10-16T00:00:00Z, the default block time for tests. */
export const T0 = 1_792_108_800n;
/** Class 1 (opioid analgesics) in the test policy: one fill per 30 days per person. */
export const OPIOIDS = 1n;
export const WINDOW = 30n * DAY;

export const randomBytes32 = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));
export const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** A 32-byte id from a short label, the way the SDK encodes drug codes and licence ids. */
export function id32(label: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(label).slice(0, 32));
  return out;
}

export function refusalOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    const code = refusalCodeOf(e);
    if (code) return code;
    throw e;
  }
  return undefined;
}

/** Asserts that `fn` is refused by a circuit assert carrying exactly `code`. */
export function expectRefusal(fn: () => unknown, code: string): void {
  expect(refusalOf(fn)).toBe(code);
}

// ---------------------------------------------------------------------------------------------
// Public transcript
//
// What a call reveals on chain is its transcript: the ledger operations it ran, with every
// key it addressed and every value it pushed or read, in the clear. Circuit arguments and
// witnesses are not in it. These helpers read it back so the privacy boundary is a tested
// claim rather than a promise.

/** Every value cell in the transcript, as lower-case hex, trailing zero bytes trimmed. */
export function transcriptValues(res: CircuitResult): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.value) && Array.isArray(record.alignment)) {
      for (const cell of record.value as Array<Record<string, number>>) {
        out.push(
          Object.values(cell ?? {})
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''),
        );
      }
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk((res.proofData as unknown as { publicTranscript: unknown[] }).publicTranscript ?? []);
  return out;
}

/** A 32-byte value as the transcript carries it (trailing zero bytes trimmed). */
export const keyHex = (b: Uint8Array): string => hex(b).replace(/(?:00)+$/, '');

/** A number as the transcript carries it: little-endian, trailing zero bytes trimmed. */
export function leHex(value: bigint): string {
  let rest = value;
  let out = '';
  while (rest > 0n) {
    out += Number(rest & 0xffn).toString(16).padStart(2, '0');
    rest >>= 8n;
  }
  return out;
}

/** True when any transcript cell contains the given bytes (as a substring of its hex). */
export const transcriptMentions = (res: CircuitResult, b: Uint8Array): boolean => {
  const needle = keyHex(b);
  return needle.length > 0 && transcriptValues(res).some((v) => v.includes(needle));
};

// ---------------------------------------------------------------------------------------------
// Personas

export class Persona {
  readonly ps: AmpoulePrivateState;
  constructor(
    readonly net: Network,
    role: Role,
    readonly sk: Uint8Array = randomBytes32(),
  ) {
    this.ps = { role, secretKey: sk };
  }
  protected call(circuit: string, args: unknown[], inputs?: CallInputs): CircuitResult {
    return this.net.sim.call(this.ps, circuit, args, inputs);
  }
}

export class Council extends Persona {
  setDoctor(doctorId: Uint8Array, keyHash: Uint8Array, active = true) {
    return this.call('setDoctor', [doctorId, keyHash, active]);
  }
  license(doc: DoctorPersona) {
    return this.setDoctor(doc.id, doc.keyHash, true);
  }
  suspend(doc: DoctorPersona) {
    return this.setDoctor(doc.id, doc.keyHash, false);
  }
}

export class Controller extends Persona {
  setPharmacy(pharmacyId: Uint8Array, keyHash: Uint8Array, active = true) {
    return this.call('setPharmacy', [pharmacyId, keyHash, active]);
  }
  license(ph: PharmacyPersona) {
    return this.setPharmacy(ph.id, ph.keyHash, true);
  }
  suspend(ph: PharmacyPersona) {
    return this.setPharmacy(ph.id, ph.keyHash, false);
  }
  setPolicy(drugClass: bigint, window: bigint, maxFills: bigint) {
    return this.call('setPolicy', [drugClass, window, maxFills]);
  }
}

export class Registrar extends Persona {
  enroll(patient: Patient) {
    return this.call('enrollPatient', [patient.key]);
  }
}

export interface RxOrder {
  drug?: string;
  quantity?: bigint;
  drugClass?: bigint;
  fills?: bigint;
  /** Validity from the current block time, seconds. */
  validFor?: bigint;
  notAfter?: bigint;
}

export class DoctorPersona extends Persona {
  constructor(
    net: Network,
    readonly id: Uint8Array,
  ) {
    super(net, 'doctor');
  }
  get keyHash(): Uint8Array {
    return pure.doctorKeyOf(this.sk);
  }
  /** Writes (but does not issue) a prescription for `patient`. */
  write(patient: Patient, o: RxOrder = {}): Prescription {
    return {
      patient: patient.key,
      doctor: this.id,
      drug: id32(o.drug ?? 'amoxicillin-500-cap'),
      quantity: o.quantity ?? 21n,
      drugClass: o.drugClass ?? 0n,
      fills: o.fills ?? 1n,
      notAfter: o.notAfter ?? this.net.sim.now + (o.validFor ?? 14n * DAY),
      salt: randomBytes32(),
    };
  }
  issue(rx: Prescription, inputs: CallInputs = {}) {
    return this.call('issue', [], { prescription: rx, ...inputs });
  }
  /** Writes and issues; returns the prescription the patient receives. */
  prescribe(patient: Patient, o: RxOrder = {}): Prescription {
    const rx = this.write(patient, o);
    this.issue(rx);
    return rx;
  }
}

export class PharmacyPersona extends Persona {
  constructor(
    net: Network,
    readonly id: Uint8Array,
  ) {
    super(net, 'pharmacy');
  }
  get keyHash(): Uint8Array {
    return pure.pharmacyKeyOf(this.sk);
  }
  /** A fresh one-time counter challenge, shown to the patient as a QR code. */
  challenge(): Uint8Array {
    return randomBytes32();
  }
}

export interface FillOptions {
  challenge?: Uint8Array;
  epoch?: bigint;
  validBefore?: bigint;
  inputs?: CallInputs;
}

export class Patient extends Persona {
  constructor(net: Network) {
    super(net, 'patient');
  }
  get key(): Uint8Array {
    return pure.patientKeyOf(this.sk);
  }
  /** Fills `rx` at `pharmacy` with the public inputs a wallet would pick by default. */
  fill(rx: Prescription, pharmacy: PharmacyPersona, o: FillOptions = {}) {
    const now = this.net.sim.now;
    const window = this.net.windowOf(rx.drugClass);
    const epoch = o.epoch ?? now / window;
    const windowEnd = (epoch + 1n) * window;
    const hour = now + 3_600n;
    const validBefore = o.validBefore ?? [hour, rx.notAfter, windowEnd].reduce((a, b) => (b < a ? b : a));
    return this.call('fill', [pharmacy.id, o.challenge ?? pharmacy.challenge(), epoch, validBefore], {
      prescription: rx,
      ...o.inputs,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// A ready-made network: three authorities, two doctors, two pharmacies, an opioid cap.

export class Network {
  readonly sim: AmpouleSimulator;
  readonly council: Council;
  readonly controller: Controller;
  readonly registrar: Registrar;

  constructor(now: bigint = T0) {
    const councilSk = randomBytes32();
    const controllerSk = randomBytes32();
    const registrarSk = randomBytes32();
    this.sim = AmpouleSimulator.deploy({ councilSk, controllerSk, registrarSk, now });
    this.council = new Council(this, 'council', councilSk);
    this.controller = new Controller(this, 'controller', controllerSk);
    this.registrar = new Registrar(this, 'registrar', registrarSk);
  }

  get ledger() {
    return this.sim.ledger();
  }

  /** The cap window of a class, or one day for general medicines (any value works there). */
  windowOf(drugClass: bigint): bigint {
    const l = this.ledger;
    return drugClass !== 0n && l.policies.member(drugClass) ? l.policies.lookup(drugClass).window : DAY;
  }

  doctor(label: string, licensed = true): DoctorPersona {
    const d = new DoctorPersona(this, id32(label));
    if (licensed) this.council.license(d);
    return d;
  }

  pharmacy(label: string, licensed = true): PharmacyPersona {
    const p = new PharmacyPersona(this, id32(label));
    if (licensed) this.controller.license(p);
    return p;
  }

  patient(enrolled = true): Patient {
    const p = new Patient(this);
    if (enrolled) this.registrar.enroll(p);
    return p;
  }
}

/** The default story world: Dr Rao and Dr Mehta, two pharmacies, an opioid cap, Ravi. */
export function world(now: bigint = T0) {
  const net = new Network(now);
  net.controller.setPolicy(OPIOIDS, WINDOW, 1n);
  const rao = net.doctor('MC-DL-58213');
  const mehta = net.doctor('MC-MH-11902');
  const lotus = net.pharmacy('DL-RX-20B-4471');
  const neem = net.pharmacy('DL-RX-21B-0932');
  const ravi = net.patient();
  return { net, rao, mehta, lotus, neem, ravi };
}
