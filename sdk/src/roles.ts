// SPDX-License-Identifier: Apache-2.0
//
// One client per participant. Each holds a backend and the participant's own private state,
// and nothing else: a pharmacy client cannot read a patient's secret because it never has it.
// The same classes drive the simulator, the CLI on Preview and the web app.
import {
  pureCircuits as pure,
  type AmpouleCircuit,
  type AmpoulePrivateState,
  type CallInputs,
  type Ledger,
  type Prescription,
  type Role,
} from '@ampoule/contract';
import { equalBytes, hex, randomBytes32 } from './bytes.js';
import {
  encodeCounter,
  encodeDispense,
  encodeRx,
  type CounterRequest,
  type DispenseOpening,
} from './codec.js';
import { drugId, drugOf, GENERAL, type Drug } from './formulary.js';
import type { AmpouleBackend, TxReceipt } from './types.js';

export const DAY = 86_400n;

/**
 * How long a fill proof stays valid. The deadline is public and stored in the fill record, so
 * it is a deliberate trade: long enough to prove, balance and land a transaction, short enough
 * that a captured proof is useless soon after.
 */
export const FILL_SLACK_SECONDS = 1_800n;

/** The public key-hash a participant is known by, for any role. */
export function publicKeyOf(role: Role, secretKey: Uint8Array): Uint8Array {
  switch (role) {
    case 'council':
      return pure.councilKeyOf(secretKey);
    case 'controller':
      return pure.controllerKeyOf(secretKey);
    case 'registrar':
      return pure.registrarKeyOf(secretKey);
    case 'doctor':
      return pure.doctorKeyOf(secretKey);
    case 'pharmacy':
      return pure.pharmacyKeyOf(secretKey);
    case 'patient':
      return pure.patientKeyOf(secretKey);
  }
}

export class Participant {
  readonly persona: AmpoulePrivateState;

  constructor(
    readonly backend: AmpouleBackend,
    role: Role,
    secretKey: Uint8Array = randomBytes32(),
  ) {
    if (secretKey.length !== 32) throw new Error('a secret key is 32 bytes');
    this.persona = { role, secretKey };
  }

  get role(): Role {
    return this.persona.role;
  }

  /** What the ledger knows this participant by. */
  get publicKey(): Uint8Array {
    return publicKeyOf(this.persona.role, this.persona.secretKey);
  }

  protected call(circuit: AmpouleCircuit, args: unknown[], inputs?: CallInputs): Promise<TxReceipt> {
    return this.backend.call(this.persona, circuit, args, inputs);
  }
}

// --------------------------------------------------------------------------------- authorities

/** The medical council licenses and suspends doctors. */
export class Council extends Participant {
  constructor(backend: AmpouleBackend, secretKey?: Uint8Array) {
    super(backend, 'council', secretKey);
  }
  setDoctor(id: Uint8Array, keyHash: Uint8Array, active: boolean): Promise<TxReceipt> {
    return this.call('setDoctor', [id, keyHash, active]);
  }
  license(doctor: { id: Uint8Array; publicKey: Uint8Array }): Promise<TxReceipt> {
    return this.setDoctor(doctor.id, doctor.publicKey, true);
  }
  suspend(doctor: { id: Uint8Array; publicKey: Uint8Array }): Promise<TxReceipt> {
    return this.setDoctor(doctor.id, doctor.publicKey, false);
  }
}

/** The drug controller licenses pharmacies and sets the cap of each controlled class. */
export class Controller extends Participant {
  constructor(backend: AmpouleBackend, secretKey?: Uint8Array) {
    super(backend, 'controller', secretKey);
  }
  setPharmacy(id: Uint8Array, keyHash: Uint8Array, active: boolean): Promise<TxReceipt> {
    return this.call('setPharmacy', [id, keyHash, active]);
  }
  license(pharmacy: { id: Uint8Array; publicKey: Uint8Array }): Promise<TxReceipt> {
    return this.setPharmacy(pharmacy.id, pharmacy.publicKey, true);
  }
  suspend(pharmacy: { id: Uint8Array; publicKey: Uint8Array }): Promise<TxReceipt> {
    return this.setPharmacy(pharmacy.id, pharmacy.publicKey, false);
  }
  /** At most `maxFills` fills of `drugClass` per person per `windowSeconds`. */
  setPolicy(drugClass: bigint, windowSeconds: bigint, maxFills: bigint): Promise<TxReceipt> {
    return this.call('setPolicy', [drugClass, windowSeconds, maxFills]);
  }
}

/** The health-ID registrar enrolls patient keys. It learns a key, never what is prescribed. */
export class Registrar extends Participant {
  constructor(backend: AmpouleBackend, secretKey?: Uint8Array) {
    super(backend, 'registrar', secretKey);
  }
  enroll(patientKey: Uint8Array): Promise<TxReceipt> {
    return this.call('enrollPatient', [patientKey]);
  }
}

// ------------------------------------------------------------------------------------- doctor

export interface RxOrder {
  /** Patient key, from the patient's app (`Patient.publicKey`). */
  patient: Uint8Array;
  drug: Drug;
  quantity?: bigint;
  fills?: bigint;
  /** Unix seconds after which the prescription cannot be filled. */
  notAfter: bigint;
}

export class Doctor extends Participant {
  constructor(
    backend: AmpouleBackend,
    /** Public licence id, as registered by the council. */
    readonly id: Uint8Array,
    secretKey?: Uint8Array,
  ) {
    super(backend, 'doctor', secretKey);
  }

  /** Writes a prescription. Nothing is published until `issue`. */
  write(order: RxOrder): Prescription {
    return {
      patient: order.patient,
      doctor: this.id,
      drug: drugId(order.drug),
      quantity: order.quantity ?? order.drug.quantity,
      drugClass: order.drug.drugClass,
      fills: order.fills ?? 1n,
      notAfter: order.notAfter,
      salt: randomBytes32(),
    };
  }

  /**
   * Issues the prescription: proves the doctor holds the licensed key and appends a hash of
   * the prescription to the public tree. Returns the token to hand to the patient.
   */
  async issue(rx: Prescription): Promise<{ receipt: TxReceipt; token: string }> {
    const receipt = await this.call('issue', [], { prescription: rx });
    return { receipt, token: encodeRx(rx) };
  }
}

// ----------------------------------------------------------------------------------- pharmacy

export type DispenseCheck =
  | {
      ok: true;
      drug?: Drug;
      drugCode: Uint8Array;
      quantity: bigint;
      drugClass: bigint;
      doctor: Uint8Array;
      validBefore: bigint;
    }
  | { ok: false; reason: 'no-fill' | 'other-pharmacy' | 'mismatch'; message: string };

export class Pharmacy extends Participant {
  constructor(
    backend: AmpouleBackend,
    readonly id: Uint8Array,
    secretKey?: Uint8Array,
  ) {
    super(backend, 'pharmacy', secretKey);
  }

  /** A fresh counter request to show the patient. Each one can be answered exactly once. */
  counterRequest(): { request: CounterRequest; token: string } {
    const request = { pharmacy: this.id, challenge: randomBytes32() };
    return { request, token: encodeCounter(request) };
  }

  /**
   * Checks what the patient's phone shows against the fill record on chain: the record must
   * exist, name this pharmacy, and commit to exactly this drug, quantity and salt. If it does,
   * the proof behind it guarantees a licensed doctor prescribed exactly that, to this patient,
   * and that no cap was exceeded. The pharmacy never needed to see who the patient is.
   */
  async verify(opening: DispenseOpening): Promise<DispenseCheck> {
    const l = await this.backend.ledger();
    if (!l.fills.member(opening.challenge)) {
      return { ok: false, reason: 'no-fill', message: 'No fill is recorded for this counter request yet.' };
    }
    const rec = l.fills.lookup(opening.challenge);
    if (!equalBytes(rec.pharmacy, this.id)) {
      return { ok: false, reason: 'other-pharmacy', message: 'This fill was made at a different pharmacy.' };
    }
    const commitment = pure.dispenseCommitOf(opening.drug, opening.quantity, opening.salt);
    if (!equalBytes(commitment, rec.dispense)) {
      return { ok: false, reason: 'mismatch', message: 'The drug or quantity shown does not match what was proven.' };
    }
    return {
      ok: true,
      drug: drugOf(opening.drug),
      drugCode: opening.drug,
      quantity: opening.quantity,
      drugClass: rec.drugClass,
      doctor: rec.doctor,
      validBefore: rec.validBefore,
    };
  }
}

// ------------------------------------------------------------------------------------ patient

export interface FillPlan {
  pharmacy: Uint8Array;
  challenge: Uint8Array;
  epoch: bigint;
  validBefore: bigint;
}

export interface RxStatus {
  /** The prescription's hash is in the issued tree. */
  issued: boolean;
  fillsUsed: number;
  fillsTotal: number;
  expired: boolean;
  doctorActive: boolean;
  /** Controlled classes only. */
  cap?: { used: number; max: number; windowSeconds: bigint; windowEndsAt: bigint };
}

export class Patient extends Participant {
  constructor(backend: AmpouleBackend, secretKey?: Uint8Array) {
    super(backend, 'patient', secretKey);
  }

  /** The cap window of a class. General medicine has none, and its epoch is published as 0. */
  static windowOf(l: Ledger, drugClass: bigint): bigint | undefined {
    if (drugClass === GENERAL || !l.policies.member(drugClass)) return undefined;
    return l.policies.lookup(drugClass).window;
  }

  /** The public inputs a fill will publish: which pharmacy, its challenge, the window, a deadline. */
  async plan(rx: Prescription, counter: CounterRequest, slack = FILL_SLACK_SECONDS): Promise<FillPlan> {
    const [l, now] = await Promise.all([this.backend.ledger(), this.backend.now()]);
    const window = Patient.windowOf(l, rx.drugClass);
    const epoch = window === undefined ? 0n : now / window;
    let validBefore = now + slack;
    if (window !== undefined && (epoch + 1n) * window < validBefore) validBefore = (epoch + 1n) * window;
    if (rx.notAfter < validBefore) validBefore = rx.notAfter;
    return { pharmacy: counter.pharmacy, challenge: counter.challenge, epoch, validBefore };
  }

  /**
   * Fills `rx` at the pharmacy that showed `counter`. The proof says: I hold the key this
   * prescription was written for, a licensed doctor issued it, it has a fill left, it has not
   * expired, and I am under the cap for its class in this window. It says nothing else.
   * Returns the opening to show the pharmacist, which reveals the drug to them alone.
   */
  async fill(
    rx: Prescription,
    counter: CounterRequest,
    options: { plan?: Partial<FillPlan>; inputs?: CallInputs } = {},
  ): Promise<{ receipt: TxReceipt; plan: FillPlan; opening: DispenseOpening; token: string }> {
    const plan = { ...(await this.plan(rx, counter)), ...options.plan };
    const salt = options.inputs?.dispenseSalt ?? randomBytes32();
    const receipt = await this.call('fill', [plan.pharmacy, plan.challenge, plan.epoch, plan.validBefore], {
      prescription: rx,
      ...options.inputs,
      dispenseSalt: salt,
    });
    const opening = { challenge: plan.challenge, drug: rx.drug, quantity: rx.quantity, salt };
    return { receipt, plan, opening, token: encodeDispense(opening) };
  }

  /**
   * What is left on a prescription, worked out on this device from public nullifiers. Only the
   * holder of the patient secret can compute these nullifiers, so the lookup reveals nothing.
   */
  async status(rx: Prescription): Promise<RxStatus> {
    const [l, now] = await Promise.all([this.backend.ledger(), this.backend.now()]);
    const sk = this.persona.secretKey;
    const leaf = pure.rxLeafOf(rx);
    let fillsUsed = 0;
    for (let k = 0n; k < rx.fills; k++) if (l.fillNullifiers.member(pure.fillNullifierOf(sk, leaf, k))) fillsUsed++;
    const status: RxStatus = {
      issued: l.prescriptions.findPathForLeaf(leaf) !== undefined,
      fillsUsed,
      fillsTotal: Number(rx.fills),
      expired: now >= rx.notAfter,
      doctorActive: l.doctors.member(rx.doctor) && l.doctors.lookup(rx.doctor).active,
    };
    const window = Patient.windowOf(l, rx.drugClass);
    if (window !== undefined) {
      const epoch = now / window;
      const max = l.policies.lookup(rx.drugClass).maxFills;
      let used = 0;
      for (let s = 0n; s < max; s++) if (l.capNullifiers.member(pure.capNullifierOf(sk, rx.drugClass, epoch, s))) used++;
      status.cap = { used, max: Number(max), windowSeconds: window, windowEndsAt: (epoch + 1n) * window };
    }
    return status;
  }
}

/** A stable, non-secret id for a participant's private-state record: role plus a key prefix. */
export const privateStateIdOf = (persona: AmpoulePrivateState): string =>
  `${persona.role}-${hex(publicKeyOf(persona.role, persona.secretKey)).slice(0, 16)}`;
