// SPDX-License-Identifier: Apache-2.0
//
// The demo world: the real compiled contract running in this tab on compact-runtime, driven
// through the same SDK role clients the CLI uses on Preview. Every call is logged with its
// decoded public transcript and a search of that transcript for the call's private inputs, so
// the "what the chain sees" panel is computed, never written by hand.
import {
  Controller,
  Council,
  DAY,
  decodeTranscript,
  Doctor,
  drugByCode,
  drugOf,
  id32,
  isRefusal,
  leBytes,
  Patient,
  Pharmacy,
  publicView,
  pureCircuits,
  randomBytes32,
  Registrar,
  scanTranscript,
  SimulatorBackend,
  type ChainEvent,
  type CounterRequest,
  type DispenseCheck,
  type DispenseOpening,
  type Drug,
  type Prescription,
  type PublicView,
  type RefusalCode,
  type TxReceipt,
} from '@ampoule/sdk/core';

export interface Person {
  name: string;
  /** One line under the name. */
  role: string;
  city?: string;
}

export interface DoctorPerson extends Person {
  licence: string;
  client: Doctor;
}
export interface PharmacyPerson extends Person {
  licence: string;
  client: Pharmacy;
}
export interface PatientPerson extends Person {
  client: Patient;
}

export interface LogEntry {
  id: number;
  actor: string;
  circuit: string;
  label: string;
  outcome: 'published' | 'refused';
  refusal?: { code: RefusalCode; explanation: string };
  durationMs: number;
  /** Decoded public transcript (published calls only: a refused call has none). */
  events: ChainEvent[];
  /**
   * The private inputs of this call, and whether any of them is in the transcript. `controls`
   * are values that are public by design, searched the same way to show the search works.
   */
  scan?: { absent: string[]; present: string[]; controls: { found: string[]; missing: string[] } };
  /** Block time the call ran at. */
  at: bigint;
}

export type Listener = () => void;

const need = (code: string): Drug => {
  const d = drugByCode(code);
  if (!d) throw new Error(`unknown drug ${code}`);
  return d;
};

export const DRUG = {
  tramadol: need('tramadol-50-tab'),
  amoxicillin: need('amoxicillin-500-cap'),
  metformin: need('metformin-500-tab'),
  alprazolam: need('alprazolam-0.5-tab'),
};

export class DemoWorld {
  readonly backend: SimulatorBackend;
  readonly council: Council;
  readonly controller: Controller;
  readonly registrar: Registrar;
  readonly rao: DoctorPerson;
  readonly mehta: DoctorPerson;
  readonly lotus: PharmacyPerson;
  readonly neem: PharmacyPerson;
  readonly ravi: PatientPerson;
  readonly meera: PatientPerson;
  readonly log: LogEntry[] = [];
  private nextId = 1;
  private listeners = new Set<Listener>();

  constructor(now = BigInt(Math.floor(Date.now() / 1000))) {
    const councilSk = randomBytes32();
    const controllerSk = randomBytes32();
    const registrarSk = randomBytes32();
    this.backend = SimulatorBackend.deploy({ councilSk, controllerSk, registrarSk, now });
    this.council = new Council(this.backend, councilSk);
    this.controller = new Controller(this.backend, controllerSk);
    this.registrar = new Registrar(this.backend, registrarSk);
    this.rao = { name: 'Dr Asha Rao', role: 'Orthopaedics', city: 'Delhi', licence: 'MC-DL-58213', client: new Doctor(this.backend, id32('MC-DL-58213')) };
    this.mehta = { name: 'Dr Vikram Mehta', role: 'General practice', city: 'Mumbai', licence: 'MC-MH-11902', client: new Doctor(this.backend, id32('MC-MH-11902')) };
    this.lotus = { name: 'Lotus Pharmacy', role: 'Karol Bagh', city: 'Delhi', licence: 'DL-RX-20B-4471', client: new Pharmacy(this.backend, id32('DL-RX-20B-4471')) };
    this.neem = { name: 'Neem Chemists', role: 'Bandra West', city: 'Mumbai', licence: 'MH-RX-21B-0932', client: new Pharmacy(this.backend, id32('MH-RX-21B-0932')) };
    this.ravi = { name: 'Ravi', role: 'Patient, knee injury', client: new Patient(this.backend) };
    this.meera = { name: 'Meera', role: 'Patient', client: new Patient(this.backend) };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get now(): bigint {
    return this.backend.sim.now;
  }

  view(): PublicView {
    return publicView(this.backend.sim.ledger());
  }

  advanceDays(days: bigint): void {
    this.backend.advance(days * DAY);
    this.emit();
  }

  /**
   * Runs one call and logs it. `secrets` are the private inputs the caller holds for this call;
   * the transcript is searched for each of them.
   */
  async run(
    actor: string,
    label: string,
    circuit: string,
    call: () => Promise<TxReceipt>,
    secrets: Record<string, Uint8Array> = {},
    controls: Record<string, Uint8Array> = {},
  ): Promise<LogEntry> {
    const at = this.now;
    const t = performance.now();
    let entry: LogEntry;
    try {
      const receipt = await call();
      const transcript = receipt.transcript ?? [];
      const scan = scanTranscript(transcript, secrets);
      const control = scanTranscript(transcript, controls);
      entry = {
        id: this.nextId++,
        actor,
        circuit,
        label,
        outcome: 'published',
        durationMs: Math.round(performance.now() - t),
        events: decodeTranscript(transcript),
        scan: { absent: scan.absent, present: scan.present, controls: { found: control.present, missing: control.absent } },
        at,
      };
    } catch (e) {
      if (!isRefusal(e)) throw e;
      entry = {
        id: this.nextId++,
        actor,
        circuit,
        label,
        outcome: 'refused',
        refusal: { code: e.code, explanation: e.explanation },
        durationMs: Math.round(performance.now() - t),
        events: [],
        at,
      };
    }
    this.log.push(entry);
    this.emit();
    return entry;
  }

  // ------------------------------------------------------------------------------ the story

  /** Authorities set up the network: caps, licences, enrollments. */
  async setUp(): Promise<void> {
    await this.run('Drug controller', 'Caps opioid analgesics at 1 fill per person per 30 days', 'setPolicy', () =>
      this.controller.setPolicy(1n, 30n * DAY, 1n),
    );
    await this.run('Drug controller', 'Caps benzodiazepines at 1 fill per person per 30 days', 'setPolicy', () =>
      this.controller.setPolicy(3n, 30n * DAY, 1n),
    );
    for (const d of [this.rao, this.mehta]) {
      await this.run('Medical council', `Licenses ${d.name} (${d.licence})`, 'setDoctor', () => this.council.license(d.client));
    }
    for (const p of [this.lotus, this.neem]) {
      await this.run('Drug controller', `Licenses ${p.name} (${p.licence})`, 'setPharmacy', () => this.controller.license(p.client));
    }
    for (const p of [this.ravi, this.meera]) {
      await this.run('Health ID registrar', `Enrolls ${p.name}'s patient key`, 'enrollPatient', () => this.registrar.enroll(p.client.publicKey), {
        [`${p.name}'s patient key`]: p.client.publicKey,
      });
    }
  }

  write(doctor: DoctorPerson, patient: PatientPerson, drug: Drug, opts: { days?: bigint; fills?: bigint; quantity?: bigint } = {}): Prescription {
    return doctor.client.write({
      patient: patient.client.publicKey,
      drug,
      quantity: opts.quantity,
      fills: opts.fills,
      notAfter: this.now + (opts.days ?? 30n) * DAY,
    });
  }

  async issue(doctor: DoctorPerson, rx: Prescription, patientName: string): Promise<{ entry: LogEntry; token?: string }> {
    let token: string | undefined;
    const entry = await this.run(
      doctor.name,
      `Issues ${describeRx(rx)} for ${patientName}`,
      'issue',
      async () => {
        const out = await doctor.client.issue(rx);
        token = out.token;
        return out.receipt;
      },
      rxSecrets(rx, patientName),
      { [`${doctor.name}'s licence number`]: doctor.client.id },
    );
    return { entry, token };
  }

  async fill(
    patient: PatientPerson,
    rx: Prescription,
    pharmacy: PharmacyPerson,
    counter: CounterRequest,
    label?: string,
  ): Promise<{ entry: LogEntry; opening?: DispenseOpening; token?: string }> {
    let opening: DispenseOpening | undefined;
    let token: string | undefined;
    const salt = randomBytes32();
    const entry = await this.run(
      patient.name,
      label ?? `Fills ${describeRx(rx)} at ${pharmacy.name}`,
      'fill',
      async () => {
        const out = await patient.client.fill(rx, counter, { inputs: { dispenseSalt: salt } });
        opening = out.opening;
        token = out.token;
        return out.receipt;
      },
      {
        [`${patient.name}'s secret key`]: patient.client.persona.secretKey,
        [`${patient.name}'s patient key`]: patient.client.publicKey,
        'prescription hash (leaf)': pureCircuits.rxLeafOf(rx),
        'drug code': rx.drug,
        'prescription salt': rx.salt,
        'dispense salt': salt,
        'expiry date': leBytes(rx.notAfter),
      },
      { [`${pharmacy.name}'s licence number`]: pharmacy.client.id },
    );
    return { entry, opening, token };
  }

  async verifyAtCounter(pharmacy: PharmacyPerson, opening: DispenseOpening): Promise<DispenseCheck> {
    return pharmacy.client.verify(opening);
  }

  async suspend(doctor: DoctorPerson): Promise<LogEntry> {
    return this.run('Medical council', `Suspends ${doctor.name}`, 'setDoctor', () => this.council.suspend(doctor.client));
  }
}

export function describeRx(rx: Prescription): string {
  const d = drugOf(rx.drug);
  return d ? `${d.name} ${d.strength}` : 'a prescription';
}

function rxSecrets(rx: Prescription, patientName: string): Record<string, Uint8Array> {
  return {
    [`${patientName}'s patient key`]: rx.patient,
    'prescription hash (leaf)': pureCircuits.rxLeafOf(rx),
    'drug code': rx.drug,
    'prescription salt': rx.salt,
    'expiry date': leBytes(rx.notAfter),
  };
}
