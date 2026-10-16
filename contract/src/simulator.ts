// SPDX-License-Identifier: Apache-2.0
//
// In-process simulator: runs the compiled circuits with compact-runtime against a local
// copy of the contract state, with a controllable block clock. No proofs, no network, no
// wallet. The test suite drives the contract through it, and the web demo runs exactly the
// same circuits in the browser tab.
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits, type Ledger } from './managed/ampoule/contract/index.js';
import { witnesses } from './witnesses.js';
import type { AmpoulePrivateState, CallInputs } from './private-state.js';

const COIN_PK = '0'.repeat(64);

export type CircuitResult = RT.CircuitResults<AmpoulePrivateState, unknown>;
type CircuitFn = (ctx: RT.CircuitContext<AmpoulePrivateState>, ...args: unknown[]) => CircuitResult;

export interface SimulatorDeploy {
  councilSk: Uint8Array;
  controllerSk: Uint8Array;
  registrarSk: Uint8Array;
  /** Initial block time, unix seconds. */
  now: bigint;
}

export class AmpouleSimulator {
  readonly contract = new Contract(witnesses);
  readonly address = RT.dummyContractAddress();
  state: RT.ContractState | RT.ChargedState;
  /** Block time of the next call, unix seconds. */
  now: bigint;
  last?: CircuitResult;

  private constructor(state: RT.ContractState, now: bigint) {
    this.state = state;
    this.now = now;
  }

  static deploy(p: SimulatorDeploy): AmpouleSimulator {
    const contract = new Contract(witnesses);
    const deployer: AmpoulePrivateState = { role: 'council', secretKey: p.councilSk };
    const init = contract.initialState(
      RT.createConstructorContext(deployer, COIN_PK),
      pureCircuits.councilKeyOf(p.councilSk),
      pureCircuits.controllerKeyOf(p.controllerSk),
      pureCircuits.registrarKeyOf(p.registrarSk),
    );
    return new AmpouleSimulator(init.currentContractState, p.now);
  }

  setTime(unixSeconds: bigint): void {
    this.now = unixSeconds;
  }

  advance(seconds: bigint): void {
    this.now += seconds;
  }

  /**
   * Runs one circuit as `persona`. The state advances only when every assert passes; a
   * refusal throws (use `refusalCodeOf` to read the code) and leaves the state untouched.
   */
  call(persona: AmpoulePrivateState, circuit: string, args: unknown[], inputs?: CallInputs): CircuitResult {
    const ps: AmpoulePrivateState = inputs === undefined ? persona : { ...persona, call: inputs };
    const ctx = RT.createCircuitContext(this.address, COIN_PK, this.state, ps, undefined, undefined, Number(this.now));
    const fn = (this.contract.impureCircuits as unknown as Record<string, CircuitFn>)[circuit];
    if (!fn) throw new Error(`circuit ${circuit} is not exported by the contract`);
    const res = fn(ctx, ...args);
    this.state = res.context.currentQueryContext.state;
    this.last = res;
    return res;
  }

  ledger(): Ledger {
    const s = this.state;
    return ledger(s instanceof RT.ContractState ? s.data : s);
  }
}
