// SPDX-License-Identifier: Apache-2.0
//
// Witness implementations. Witnesses only *supply* private data. Every property that
// matters (membership, ownership, freshness, caps) is re-checked by circuit asserts, so a
// lying witness produces a refusal, never an invalid state transition.
//
// The fill and cap witnesses look the caller's own nullifiers up in the public ledger to
// pick an unused slot. That lookup happens locally: the ledger never learns which slots a
// person has tried, only the one nullifier the final proof discloses.
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { pureCircuits, type Ledger, type Prescription, type Witnesses } from './managed/ampoule/contract/index.js';
import type { AmpoulePrivateState, MerklePath } from './private-state.js';

type Ctx = WitnessContext<Ledger, AmpoulePrivateState>;

const DEPTH = 16;

export const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** A path that cannot verify: right leaf, zero siblings. The circuit then refuses cleanly. */
export const dummyPath = (leaf: Uint8Array): MerklePath => ({
  leaf,
  path: Array.from({ length: DEPTH }, () => ({ sibling: { field: 0n }, goes_left: false })),
});

function resolvePath(ctx: Ctx, tree: 'patients' | 'prescriptions', leaf: Uint8Array): MerklePath {
  const supplied = ctx.privateState.call?.paths?.[hex(leaf)];
  if (supplied) return supplied;
  return (ctx.ledger[tree].findPathForLeaf(leaf) as MerklePath | undefined) ?? dummyPath(leaf);
}

function requirePrescription(ctx: Ctx): Prescription {
  const rx = ctx.privateState.call?.prescription;
  if (!rx) throw new Error('witness prescription: privateState.call.prescription is not set');
  return rx;
}

/** First fill index whose nullifier is unused, or `fills` (which the circuit refuses). */
function firstFreeFill(ctx: Ctx, leaf: Uint8Array): bigint {
  const fixed = ctx.privateState.call?.fillIndex;
  if (fixed !== undefined) return fixed;
  const rx = requirePrescription(ctx);
  for (let k = 0n; k < rx.fills; k++) {
    const n = pureCircuits.fillNullifierOf(ctx.privateState.secretKey, leaf, k);
    if (!ctx.ledger.fillNullifiers.member(n)) return k;
  }
  return rx.fills;
}

/** First cap slot in this window whose nullifier is unused, or `maxFills` (refused). */
function firstFreeSlot(ctx: Ctx, drugClass: bigint, epoch: bigint): bigint {
  const fixed = ctx.privateState.call?.capSlot;
  if (fixed !== undefined) return fixed;
  if (!ctx.ledger.policies.member(drugClass)) return 0n;
  const max = ctx.ledger.policies.lookup(drugClass).maxFills;
  for (let s = 0n; s < max; s++) {
    const n = pureCircuits.capNullifierOf(ctx.privateState.secretKey, drugClass, epoch, s);
    if (!ctx.ledger.capNullifiers.member(n)) return s;
  }
  return max;
}

export const witnesses: Witnesses<AmpoulePrivateState> = {
  secretKey: (ctx) => [ctx.privateState, ctx.privateState.secretKey],
  prescription: (ctx) => [ctx.privateState, requirePrescription(ctx)],
  patientPath: (ctx, leaf) => [ctx.privateState, resolvePath(ctx, 'patients', leaf)],
  prescriptionPath: (ctx, leaf) => [ctx.privateState, resolvePath(ctx, 'prescriptions', leaf)],
  fillIndex: (ctx, leaf) => [ctx.privateState, firstFreeFill(ctx, leaf)],
  capSlot: (ctx, drugClass, epoch) => [ctx.privateState, firstFreeSlot(ctx, drugClass, epoch)],
  dispenseSalt: (ctx) => [
    ctx.privateState,
    ctx.privateState.call?.dispenseSalt ?? crypto.getRandomValues(new Uint8Array(32)),
  ],
};
