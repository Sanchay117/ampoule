// SPDX-License-Identifier: Apache-2.0
//
// The guided story on top of DemoWorld. Hand-offs between people go through the real token
// codec: the doctor's screen shows an `ampoule:rx1:` string, the patient's phone decodes it,
// the pharmacy's counter request and the patient's dispense opening travel the same way. A
// forged token is made by decoding, changing one field and encoding again, exactly as an
// attacker would.
import {
  decodeCounter,
  decodeDispense,
  decodeRx,
  encodeRx,
  type CounterRequest,
  type DispenseCheck,
  type Drug,
  type Prescription,
  type RxStatus,
} from '@ampoule/sdk/core';
import { DemoWorld, DRUG, type DoctorPerson, type LogEntry, type PatientPerson, type PharmacyPerson } from '../lib/demo';

export interface IssuedRx {
  /** What the doctor's screen shows and the patient scans. */
  token: string;
  doctor: DoctorPerson;
  patient: PatientPerson;
  entry: LogEntry;
  /** Set once the patient's phone has scanned the token. */
  received: boolean;
}

export interface Counter {
  pharmacy: PharmacyPerson;
  token: string;
  /** Set once the patient's phone has scanned it. */
  scanned: boolean;
}

export interface FillAttempt {
  pharmacy: PharmacyPerson;
  patient: PatientPerson;
  entry: LogEntry;
  /** Only when the fill was published: what the phone shows the pharmacist. */
  dispenseToken?: string;
  /** What the pharmacist's check against the ledger said. */
  check?: DispenseCheck;
}

export interface StoryState {
  setUp?: LogEntry[];
  raoRx?: IssuedRx;
  lotusCounter?: Counter;
  lotusFill?: FillAttempt;
  refillCounter?: Counter;
  refill?: FillAttempt;
  mehtaRx?: IssuedRx;
  shopCounter?: Counter;
  shop?: FillAttempt;
  forgedToken?: string;
  forged?: FillAttempt;
  stolen?: FillAttempt;
  monthLater?: boolean;
  laterCounter?: Counter;
  later?: FillAttempt;
  meeraRx?: IssuedRx;
  suspension?: LogEntry;
  suspendedFill?: FillAttempt;
}

export class Story {
  world: DemoWorld;
  s: StoryState = {};
  /** What is running now, for disabling buttons and showing progress. */
  busy?: string;
  error?: string;
  private version = 0;
  private listeners = new Set<() => void>();
  private unsubscribeWorld: () => void;

  constructor() {
    this.world = new DemoWorld();
    this.unsubscribeWorld = this.world.subscribe(() => this.emit());
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  reset(): void {
    this.unsubscribeWorld();
    this.world = new DemoWorld();
    this.unsubscribeWorld = this.world.subscribe(() => this.emit());
    this.s = {};
    this.busy = undefined;
    this.error = undefined;
    this.emit();
  }

  private async step(label: string, fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = label;
    this.error = undefined;
    this.emit();
    // Let the browser paint the busy state before the circuit takes the main thread.
    await new Promise((r) => setTimeout(r, 30));
    try {
      await fn();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      console.error(e);
    } finally {
      this.busy = undefined;
      this.emit();
    }
  }

  private sync(fn: () => void): void {
    fn();
    this.emit();
  }

  // ------------------------------------------------------------------------------- helpers

  private async issue(doctor: DoctorPerson, patient: PatientPerson, drug: Drug, days: bigint): Promise<IssuedRx> {
    const rx = this.world.write(doctor, patient, drug, { days });
    const { entry, token } = await this.world.issue(doctor, rx, patient.name);
    if (!token) throw new Error(`${doctor.name} could not issue: ${entry.refusal?.code ?? 'unknown'}`);
    return { token, doctor, patient, entry, received: false };
  }

  private counter(pharmacy: PharmacyPerson): Counter {
    return { pharmacy, token: pharmacy.client.counterRequest().token, scanned: false };
  }

  /** The patient's phone: decode the prescription and the counter request it scanned, then fill. */
  private async fill(patient: PatientPerson, rxToken: string, counter: Counter, label?: string): Promise<FillAttempt> {
    const rx: Prescription = decodeRx(rxToken);
    const request: CounterRequest = decodeCounter(counter.token);
    const out = await this.world.fill(patient, rx, counter.pharmacy, request, label);
    return { pharmacy: counter.pharmacy, patient, entry: out.entry, dispenseToken: out.token };
  }

  /** The pharmacist's screen: decode what the phone shows and check it against the ledger. */
  private async check(attempt: FillAttempt): Promise<DispenseCheck> {
    if (!attempt.dispenseToken) return { ok: false, reason: 'no-fill', message: 'No fill is recorded for this counter request.' };
    return this.world.verifyAtCounter(attempt.pharmacy, decodeDispense(attempt.dispenseToken));
  }

  // ------------------------------------------------------------------------------ chapters

  setUpNetwork = () =>
    this.step('Setting up the network', async () => {
      const before = this.world.log.length;
      await this.world.setUp();
      this.s.setUp = this.world.log.slice(before);
    });

  raoPrescribes = () =>
    this.step('Dr Rao is issuing the prescription', async () => {
      this.s.raoRx = await this.issue(this.world.rao, this.world.ravi, DRUG.tramadol, 30n);
    });

  receive = (which: 'raoRx' | 'mehtaRx' | 'meeraRx') =>
    this.sync(() => {
      const rx = this.s[which];
      if (rx) rx.received = true;
    });

  newCounter = (which: 'lotusCounter' | 'refillCounter' | 'shopCounter' | 'laterCounter', pharmacy: PharmacyPerson) =>
    this.sync(() => {
      this.s[which] = this.counter(pharmacy);
    });

  scanCounter = (which: 'lotusCounter' | 'refillCounter' | 'shopCounter' | 'laterCounter') =>
    this.sync(() => {
      const c = this.s[which];
      if (c) c.scanned = true;
    });

  fillAtLotus = () =>
    this.step('Ravi\'s phone is running the fill circuit', async () => {
      const { raoRx, lotusCounter } = this.s;
      if (!raoRx || !lotusCounter) return;
      this.s.lotusFill = await this.fill(this.world.ravi, raoRx.token, lotusCounter);
    });

  checkLotus = () =>
    this.step('Lotus is checking the fill record', async () => {
      const f = this.s.lotusFill;
      if (f) f.check = await this.check(f);
    });

  refillAtNeem = () =>
    this.step('Ravi\'s phone is trying to fill the same prescription again', async () => {
      const { raoRx, refillCounter } = this.s;
      if (!raoRx || !refillCounter) return;
      refillCounter.scanned = true;
      this.s.refill = await this.fill(this.world.ravi, raoRx.token, refillCounter, `Tries to fill Dr Rao's tramadol again, at ${refillCounter.pharmacy.name}`);
      this.s.refill.check = await this.check(this.s.refill);
    });

  mehtaPrescribes = () =>
    this.step('Dr Mehta is issuing a second prescription', async () => {
      // Valid for 60 days, so it is still good after the next cap window opens.
      this.s.mehtaRx = await this.issue(this.world.mehta, this.world.ravi, DRUG.tramadol, 60n);
    });

  shopAtNeem = () =>
    this.step('Ravi\'s phone is trying to fill Dr Mehta\'s prescription', async () => {
      const { mehtaRx, shopCounter } = this.s;
      if (!mehtaRx || !shopCounter) return;
      shopCounter.scanned = true;
      this.s.shop = await this.fill(this.world.ravi, mehtaRx.token, shopCounter, `Tries to fill Dr Mehta's tramadol at ${shopCounter.pharmacy.name}`);
      this.s.shop.check = await this.check(this.s.shop);
    });

  forge = (quantity: bigint) =>
    this.sync(() => {
      const { mehtaRx } = this.s;
      if (!mehtaRx) return;
      const rx = decodeRx(mehtaRx.token);
      this.s.forgedToken = encodeRx({ ...rx, quantity });
    });

  fillForged = () =>
    this.step('Ravi\'s phone is trying the edited prescription', async () => {
      const { forgedToken } = this.s;
      if (!forgedToken) return;
      const counter = this.counter(this.world.neem);
      counter.scanned = true;
      this.s.forged = await this.fill(this.world.ravi, forgedToken, counter, `Tries an edited copy of Dr Mehta's prescription at ${counter.pharmacy.name}`);
    });

  steal = () =>
    this.step('Meera\'s phone is trying Ravi\'s prescription', async () => {
      const { mehtaRx } = this.s;
      if (!mehtaRx) return;
      const counter = this.counter(this.world.lotus);
      counter.scanned = true;
      this.s.stolen = await this.fill(this.world.meera, mehtaRx.token, counter, `Tries Ravi's prescription from Dr Mehta at ${counter.pharmacy.name}`);
    });

  advanceMonth = () =>
    this.sync(() => {
      this.world.advanceDays(30n);
      this.s.monthLater = true;
    });

  fillLater = () =>
    this.step('Ravi\'s phone is filling Dr Mehta\'s prescription', async () => {
      const { mehtaRx, laterCounter } = this.s;
      if (!mehtaRx || !laterCounter) return;
      laterCounter.scanned = true;
      this.s.later = await this.fill(this.world.ravi, mehtaRx.token, laterCounter, `Fills Dr Mehta's tramadol at ${laterCounter.pharmacy.name}, in the next cap window`);
      this.s.later.check = await this.check(this.s.later);
    });

  meeraPrescribed = () =>
    this.step('Dr Mehta is issuing metformin for Meera', async () => {
      const rx = await this.issue(this.world.mehta, this.world.meera, DRUG.metformin, 90n);
      rx.received = true;
      this.s.meeraRx = rx;
    });

  suspendMehta = () =>
    this.step('The medical council is suspending Dr Mehta', async () => {
      this.s.suspension = await this.world.suspend(this.world.mehta);
    });

  meeraFills = () =>
    this.step('Meera\'s phone is trying to fill', async () => {
      const { meeraRx } = this.s;
      if (!meeraRx) return;
      const counter = this.counter(this.world.lotus);
      counter.scanned = true;
      this.s.suspendedFill = await this.fill(this.world.meera, meeraRx.token, counter, `Tries to fill Dr Mehta's metformin at ${counter.pharmacy.name}`);
    });

  /** What the patient's own phone works out about a prescription it holds, from public nullifiers. */
  status(patient: PatientPerson, token: string): Promise<RxStatus> {
    return patient.client.status(decodeRx(token));
  }
}
