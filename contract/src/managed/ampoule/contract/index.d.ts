import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Prescription = { patient: Uint8Array;
                             doctor: Uint8Array;
                             drug: Uint8Array;
                             quantity: bigint;
                             drugClass: bigint;
                             fills: bigint;
                             notAfter: bigint;
                             salt: Uint8Array
                           };

export type Doctor = { keyHash: Uint8Array; active: boolean };

export type Pharmacy = { keyHash: Uint8Array; active: boolean };

export type Policy = { window: bigint; maxFills: bigint };

export type FillRecord = { pharmacy: Uint8Array;
                           doctor: Uint8Array;
                           drugClass: bigint;
                           dispense: Uint8Array;
                           validBefore: bigint
                         };

export type Witnesses<PS> = {
  secretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  prescription(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Prescription];
  patientPath(context: __compactRuntime.WitnessContext<Ledger, PS>,
              leaf_0: Uint8Array): [PS, { leaf: Uint8Array,
                                          path: { sibling: { field: bigint },
                                                  goes_left: boolean
                                                }[]
                                        }];
  prescriptionPath(context: __compactRuntime.WitnessContext<Ledger, PS>,
                   leaf_0: Uint8Array): [PS, { leaf: Uint8Array,
                                               path: { sibling: { field: bigint
                                                                },
                                                       goes_left: boolean
                                                     }[]
                                             }];
  fillIndex(context: __compactRuntime.WitnessContext<Ledger, PS>,
            leaf_0: Uint8Array): [PS, bigint];
  capSlot(context: __compactRuntime.WitnessContext<Ledger, PS>,
          drugClass_0: bigint,
          epoch_0: bigint): [PS, bigint];
  dispenseSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  setDoctor(context: __compactRuntime.CircuitContext<PS>,
            id_0: Uint8Array,
            keyHash_0: Uint8Array,
            active_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  setPharmacy(context: __compactRuntime.CircuitContext<PS>,
              id_0: Uint8Array,
              keyHash_0: Uint8Array,
              active_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  setPolicy(context: __compactRuntime.CircuitContext<PS>,
            drugClass_0: bigint,
            window_0: bigint,
            maxFills_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  enrollPatient(context: __compactRuntime.CircuitContext<PS>,
                patientKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  issue(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  fill(context: __compactRuntime.CircuitContext<PS>,
       pharmacyId_0: Uint8Array,
       challenge_0: Uint8Array,
       epoch_0: bigint,
       validBefore_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  setDoctor(context: __compactRuntime.CircuitContext<PS>,
            id_0: Uint8Array,
            keyHash_0: Uint8Array,
            active_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  setPharmacy(context: __compactRuntime.CircuitContext<PS>,
              id_0: Uint8Array,
              keyHash_0: Uint8Array,
              active_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  setPolicy(context: __compactRuntime.CircuitContext<PS>,
            drugClass_0: bigint,
            window_0: bigint,
            maxFills_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  enrollPatient(context: __compactRuntime.CircuitContext<PS>,
                patientKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  issue(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  fill(context: __compactRuntime.CircuitContext<PS>,
       pharmacyId_0: Uint8Array,
       challenge_0: Uint8Array,
       epoch_0: bigint,
       validBefore_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  councilKeyOf(sk_0: Uint8Array): Uint8Array;
  controllerKeyOf(sk_0: Uint8Array): Uint8Array;
  registrarKeyOf(sk_0: Uint8Array): Uint8Array;
  doctorKeyOf(sk_0: Uint8Array): Uint8Array;
  pharmacyKeyOf(sk_0: Uint8Array): Uint8Array;
  patientKeyOf(sk_0: Uint8Array): Uint8Array;
  rxLeafOf(rx_0: Prescription): Uint8Array;
  fillNullifierOf(sk_0: Uint8Array, leaf_0: Uint8Array, index_0: bigint): Uint8Array;
  capNullifierOf(sk_0: Uint8Array,
                 drugClass_0: bigint,
                 epoch_0: bigint,
                 slot_0: bigint): Uint8Array;
  dispenseCommitOf(drug_0: Uint8Array, quantity_0: bigint, salt_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  councilKeyOf(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  controllerKeyOf(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  registrarKeyOf(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  doctorKeyOf(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  pharmacyKeyOf(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  patientKeyOf(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  rxLeafOf(context: __compactRuntime.CircuitContext<PS>, rx_0: Prescription): __compactRuntime.CircuitResults<PS, Uint8Array>;
  fillNullifierOf(context: __compactRuntime.CircuitContext<PS>,
                  sk_0: Uint8Array,
                  leaf_0: Uint8Array,
                  index_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  capNullifierOf(context: __compactRuntime.CircuitContext<PS>,
                 sk_0: Uint8Array,
                 drugClass_0: bigint,
                 epoch_0: bigint,
                 slot_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  dispenseCommitOf(context: __compactRuntime.CircuitContext<PS>,
                   drug_0: Uint8Array,
                   quantity_0: bigint,
                   salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  setDoctor(context: __compactRuntime.CircuitContext<PS>,
            id_0: Uint8Array,
            keyHash_0: Uint8Array,
            active_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  setPharmacy(context: __compactRuntime.CircuitContext<PS>,
              id_0: Uint8Array,
              keyHash_0: Uint8Array,
              active_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  setPolicy(context: __compactRuntime.CircuitContext<PS>,
            drugClass_0: bigint,
            window_0: bigint,
            maxFills_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  enrollPatient(context: __compactRuntime.CircuitContext<PS>,
                patientKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  issue(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  fill(context: __compactRuntime.CircuitContext<PS>,
       pharmacyId_0: Uint8Array,
       challenge_0: Uint8Array,
       epoch_0: bigint,
       validBefore_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly council: Uint8Array;
  readonly controller: Uint8Array;
  readonly registrar: Uint8Array;
  doctors: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Doctor;
    [Symbol.iterator](): Iterator<[Uint8Array, Doctor]>
  };
  pharmacies: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Pharmacy;
    [Symbol.iterator](): Iterator<[Uint8Array, Pharmacy]>
  };
  policies: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Policy;
    [Symbol.iterator](): Iterator<[bigint, Policy]>
  };
  patients: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  prescriptions: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  fillNullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  capNullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  fills: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): FillRecord;
    [Symbol.iterator](): Iterator<[Uint8Array, FillRecord]>
  };
  readonly issuedTotal: bigint;
  readonly filledTotal: bigint;
  issuedByDoctor: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): { read(): bigint }
  };
  controlledByDoctor: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): { read(): bigint }
  };
  filledByPharmacy: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): { read(): bigint }
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               councilKey_0: Uint8Array,
               controllerKey_0: Uint8Array,
               registrarKey_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
