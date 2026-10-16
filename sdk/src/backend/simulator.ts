// SPDX-License-Identifier: Apache-2.0
//
// The contract running in this process, on compact-runtime, with a block clock the caller
// controls. Same circuits, same witnesses, same asserts as on chain; what is missing is the
// proof and the network. The web demo uses it so anyone can drive the full protocol in a
// browser tab, and every call hands back the public transcript it would have published.
import { AmpouleSimulator, type AmpouleCircuit, type AmpoulePrivateState, type CallInputs, type Ledger } from '@ampoule/contract';
import { rethrowAsRefusal } from '../errors.js';
import type { AmpouleBackend, TxReceipt } from '../types.js';

export interface SimulatorBackendOptions {
  councilSk: Uint8Array;
  controllerSk: Uint8Array;
  registrarSk: Uint8Array;
  /** Initial block time, unix seconds. Defaults to the wall clock. */
  now?: bigint;
}

export class SimulatorBackend implements AmpouleBackend {
  readonly kind = 'simulator' as const;
  readonly network = 'simulator';
  readonly contractAddress: string;
  readonly sim: AmpouleSimulator;

  private constructor(sim: AmpouleSimulator) {
    this.sim = sim;
    this.contractAddress = sim.address;
  }

  static deploy(options: SimulatorBackendOptions): SimulatorBackend {
    const now = options.now ?? BigInt(Math.floor(Date.now() / 1000));
    return new SimulatorBackend(AmpouleSimulator.deploy({ ...options, now }));
  }

  async call(persona: AmpoulePrivateState, circuit: AmpouleCircuit, args: unknown[], inputs?: CallInputs): Promise<TxReceipt> {
    const started = performance.now();
    try {
      const res = this.sim.call(persona, circuit, args, inputs);
      return {
        circuit,
        network: this.network,
        durationMs: Math.round(performance.now() - started),
        transcript: (res.proofData as { publicTranscript?: unknown[] }).publicTranscript ?? [],
      };
    } catch (error) {
      rethrowAsRefusal(error, circuit);
    }
  }

  async ledger(): Promise<Ledger> {
    return this.sim.ledger();
  }

  async now(): Promise<bigint> {
    return this.sim.now;
  }

  /** Moves the block clock forward. */
  advance(seconds: bigint): void {
    this.sim.advance(seconds);
  }

  setTime(unixSeconds: bigint): void {
    this.sim.setTime(unixSeconds);
  }
}
