// SPDX-License-Identifier: Apache-2.0
//
// Private state held by each participant. None of it ever leaves the participant's device:
// circuits read it through witnesses and only disclose what the contract asserts on.
import type { Prescription } from './managed/ampoule/contract/index.js';

export type Bytes32 = Uint8Array;

export type Role = 'council' | 'controller' | 'registrar' | 'doctor' | 'pharmacy' | 'patient';

/** Merkle path as returned by `ledger.<tree>.findPathForLeaf(leaf)`. */
export interface MerklePath {
  leaf: Uint8Array;
  path: { sibling: { field: bigint }; goes_left: boolean }[];
}

/** Per-call witness inputs, set right before a circuit runs and dropped afterwards. */
export interface CallInputs {
  /** The prescription being issued (doctor) or filled (patient). */
  prescription?: Prescription;
  /** Which fill of the prescription this is; found from the ledger when absent. */
  fillIndex?: bigint;
  /** Which cap slot of the current window this uses; found from the ledger when absent. */
  capSlot?: bigint;
  /** Opens the dispense commitment for the pharmacy; random when absent. */
  dispenseSalt?: Uint8Array;
  /** Merkle paths keyed by leaf hex; resolved from the ledger when absent. */
  paths?: Record<string, MerklePath>;
}

export interface AmpoulePrivateState {
  role: Role;
  /** The participant's secret. Its role-specific hash is what the ledger knows them by. */
  secretKey: Bytes32;
  call?: CallInputs;
}

export function createPrivateState(role: Role, secretKey: Bytes32): AmpoulePrivateState {
  if (secretKey.length !== 32) throw new Error('secretKey must be 32 bytes');
  return { role, secretKey };
}

export function withCall(state: AmpoulePrivateState, call: CallInputs | undefined): AmpoulePrivateState {
  return call === undefined ? { role: state.role, secretKey: state.secretKey } : { ...state, call };
}
