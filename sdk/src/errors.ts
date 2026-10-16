// SPDX-License-Identifier: Apache-2.0
//
// A refusal is a circuit assert that failed while the transaction was being built. It happens
// on the caller's own device, before any proof is made: nothing is submitted, nothing is paid,
// and the ledger never learns that the attempt happened.
import { REFUSALS, refusalCodeOf, type RefusalCode } from '@ampoule/contract';

export class Refusal extends Error {
  constructor(
    readonly code: RefusalCode,
    readonly circuit: string,
    options?: { cause?: unknown },
  ) {
    super(`${circuit} refused (${code}): ${REFUSALS[code]}`, options);
    this.name = 'Refusal';
  }

  get explanation(): string {
    return REFUSALS[this.code];
  }
}

export const isRefusal = (e: unknown): e is Refusal => e instanceof Refusal;

/** Rethrows a circuit failure as a `Refusal` when it carries an assert code, unchanged otherwise. */
export function rethrowAsRefusal(error: unknown, circuit: string): never {
  if (error instanceof Refusal) throw error;
  const code = refusalCodeOf(error);
  if (code) throw new Refusal(code, circuit, { cause: error });
  throw error;
}
