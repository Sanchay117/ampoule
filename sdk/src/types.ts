// SPDX-License-Identifier: Apache-2.0
import type { AmpouleCircuit, AmpoulePrivateState, CallInputs, Ledger } from '@ampoule/contract';

/** What a successful call left behind. */
export interface TxReceipt {
  circuit: AmpouleCircuit;
  /** `simulator`, or the network the transaction landed on. */
  network: string;
  durationMs: number;
  /** midnight-js transaction identifier (network only). */
  txId?: string;
  /** Explorer key of the transaction (network only, when the indexer resolved it). */
  txHash?: string;
  blockHeight?: number;
  /**
   * The public transcript of the call: every ledger operation it ran, with every key and value
   * in the clear. This is exactly what an observer of the chain learns. Simulator only.
   */
  transcript?: unknown[];
}

/**
 * One contract, wherever it runs. The role clients talk only to this, so the same code drives
 * the in-browser simulator, a local devnet and Preview.
 */
export interface AmpouleBackend {
  readonly kind: 'simulator' | 'network';
  readonly network: string;
  readonly contractAddress: string;
  /**
   * Runs `circuit` as `persona`. A failed assert rejects with a `Refusal` and changes nothing.
   * `inputs` are the per-call witness inputs (the prescription being issued or filled).
   */
  call(persona: AmpoulePrivateState, circuit: AmpouleCircuit, args: unknown[], inputs?: CallInputs): Promise<TxReceipt>;
  /** The public ledger as it stands now. */
  ledger(): Promise<Ledger>;
  /** Block time, unix seconds. */
  now(): Promise<bigint>;
}
