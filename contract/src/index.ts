// SPDX-License-Identifier: Apache-2.0
export { Contract, ledger, pureCircuits } from './managed/ampoule/contract/index.js';
export type {
  Doctor,
  FillRecord,
  Ledger,
  Pharmacy,
  Policy,
  Prescription,
  PureCircuits,
  Witnesses,
} from './managed/ampoule/contract/index.js';
export { witnesses, dummyPath, hex } from './witnesses.js';
export {
  createPrivateState,
  withCall,
  type AmpoulePrivateState,
  type Bytes32,
  type CallInputs,
  type MerklePath,
  type Role,
} from './private-state.js';
export { REFUSALS, refusalCodeOf, type RefusalCode } from './refusals.js';
export { AmpouleSimulator, type CircuitResult, type SimulatorDeploy } from './simulator.js';

/** The circuits a deployment proves. Kept in one place for the zk-config providers. */
export const CIRCUITS = ['setDoctor', 'setPharmacy', 'setPolicy', 'enrollPatient', 'issue', 'fill'] as const;
export type AmpouleCircuit = (typeof CIRCUITS)[number];
