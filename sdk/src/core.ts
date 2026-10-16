// SPDX-License-Identifier: Apache-2.0
//
// Everything that runs without a network: the role clients, codecs, the transcript decoder,
// the public view and the in-memory simulator. The web demo imports this entry so that its
// bundle does not carry the wallet, indexer and proof-server stack it never uses.
export * from './audit.js';
export * from './bytes.js';
export * from './codec.js';
export * from './networks.js';
export * from './errors.js';
export * from './formulary.js';
export * from './roles.js';
export * from './transcript.js';
export * from './types.js';
export * from './view.js';
export * from './backend/simulator.js';
export {
  CIRCUITS,
  REFUSALS,
  pureCircuits,
  refusalCodeOf,
  type AmpouleCircuit,
  type AmpoulePrivateState,
  type CallInputs,
  type FillRecord,
  type Ledger,
  type Prescription,
  type RefusalCode,
  type Role,
} from '@ampoule/contract';
