// SPDX-License-Identifier: Apache-2.0
//
// The formulary: which medicines exist and which controlled class each belongs to. It is
// off-chain reference data. The contract only knows class numbers and the cap policy of each
// class; a drug code never reaches the ledger, only a commitment to it.
import { equalBytes, id32 } from './bytes.js';

export interface DrugClass {
  id: bigint;
  name: string;
  /** Why this class is controlled, in one line. */
  rationale: string;
  /** The cap a fresh network starts with: at most `maxFills` fills per person per window. */
  defaultPolicy?: { windowDays: number; maxFills: number };
}

/** Class 0 is general medicine and is never capped; every other class needs a policy. */
export const GENERAL = 0n;

export const CLASSES: readonly DrugClass[] = [
  { id: 0n, name: 'General', rationale: 'Ordinary prescription medicine. Refills are limited by the prescription itself.' },
  {
    id: 1n,
    name: 'Opioid analgesics',
    rationale: 'Tramadol and similar painkillers, the most diverted prescription drugs.',
    defaultPolicy: { windowDays: 30, maxFills: 1 },
  },
  {
    id: 2n,
    name: 'Codeine preparations',
    rationale: 'Codeine cough syrups, a common route to dependence.',
    defaultPolicy: { windowDays: 30, maxFills: 1 },
  },
  {
    id: 3n,
    name: 'Benzodiazepines',
    rationale: 'Sedatives with high dependence risk when stacked across prescribers.',
    defaultPolicy: { windowDays: 30, maxFills: 1 },
  },
  {
    id: 4n,
    name: 'Stimulants',
    rationale: 'ADHD stimulants, prone to resale.',
    defaultPolicy: { windowDays: 30, maxFills: 1 },
  },
];

export interface Drug {
  /** Short code, stored as the 32-byte `drug` field of a prescription. */
  code: string;
  name: string;
  strength: string;
  form: string;
  drugClass: bigint;
  /** A typical quantity for one fill. */
  quantity: bigint;
}

export const DRUGS: readonly Drug[] = [
  { code: 'amoxicillin-500-cap', name: 'Amoxicillin', strength: '500 mg', form: 'capsule', drugClass: 0n, quantity: 21n },
  { code: 'azithromycin-500-tab', name: 'Azithromycin', strength: '500 mg', form: 'tablet', drugClass: 0n, quantity: 3n },
  { code: 'metformin-500-tab', name: 'Metformin', strength: '500 mg', form: 'tablet', drugClass: 0n, quantity: 60n },
  { code: 'atorvastatin-20-tab', name: 'Atorvastatin', strength: '20 mg', form: 'tablet', drugClass: 0n, quantity: 30n },
  { code: 'amlodipine-5-tab', name: 'Amlodipine', strength: '5 mg', form: 'tablet', drugClass: 0n, quantity: 30n },
  { code: 'tramadol-50-tab', name: 'Tramadol', strength: '50 mg', form: 'tablet', drugClass: 1n, quantity: 10n },
  { code: 'tapentadol-100-tab', name: 'Tapentadol', strength: '100 mg', form: 'tablet', drugClass: 1n, quantity: 10n },
  { code: 'morphine-10-tab', name: 'Morphine sulfate', strength: '10 mg', form: 'tablet', drugClass: 1n, quantity: 10n },
  { code: 'codeine-cpm-100ml', name: 'Codeine and chlorpheniramine', strength: '100 ml', form: 'syrup', drugClass: 2n, quantity: 1n },
  { code: 'alprazolam-0.5-tab', name: 'Alprazolam', strength: '0.5 mg', form: 'tablet', drugClass: 3n, quantity: 10n },
  { code: 'clonazepam-0.5-tab', name: 'Clonazepam', strength: '0.5 mg', form: 'tablet', drugClass: 3n, quantity: 10n },
  { code: 'methylphenidate-10-tab', name: 'Methylphenidate', strength: '10 mg', form: 'tablet', drugClass: 4n, quantity: 30n },
];

export const classOf = (id: bigint): DrugClass | undefined => CLASSES.find((c) => c.id === id);

export const className = (id: bigint): string => classOf(id)?.name ?? `Class ${id}`;

export const isControlled = (id: bigint): boolean => id !== GENERAL;

export const drugByCode = (code: string): Drug | undefined => DRUGS.find((d) => d.code === code);

/** The 32-byte value a prescription carries for this drug. */
export const drugId = (drug: Drug | string): Uint8Array => id32(typeof drug === 'string' ? drug : drug.code);

/** The formulary entry behind a prescription's `drug` field, if it is one we know. */
export const drugOf = (id: Uint8Array): Drug | undefined => DRUGS.find((d) => equalBytes(drugId(d), id));

export const describeDrug = (d: Drug): string => `${d.name} ${d.strength} ${d.form}`;

/** Unit for a quantity of this drug: "10 tablets", "1 bottle". */
export function quantityText(d: Drug | undefined, quantity: bigint): string {
  const unit = d?.form === 'syrup' ? 'bottle' : (d?.form ?? 'unit');
  return `${quantity} ${unit}${quantity === 1n ? '' : 's'}`;
}
