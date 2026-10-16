// SPDX-License-Identifier: Apache-2.0
//
// Plain-English lines for decoded transcript events. Every line is derived from an event the
// decoder pulled out of a real transcript; nothing here invents an operation.
import { cellToBigInt, className, hex, labelOf, widen, type ChainEvent } from '@ampoule/sdk/core';
import { shortHash, utcTime } from './format';

export type Tone = 'check' | 'read' | 'write' | 'count' | 'time' | 'other';

export interface Explained {
  tone: Tone;
  verb: string;
  text: string;
  /** Why this operation does not reveal anything about the patient, when that needs saying. */
  note?: string;
}

const who = (cell: Uint8Array | undefined): string => {
  if (!cell) return '?';
  const w = widen(cell);
  return labelOf(w) ?? shortHash(hex(w));
};

const num = (cell: Uint8Array | undefined): bigint => (cell ? cellToBigInt(cell) : 0n);

export function explain(e: ChainEvent): Explained {
  switch (e.op) {
    case 'member': {
      const k = e.key;
      const yes = e.result;
      switch (e.field) {
        case 'doctors':
          return { tone: 'check', verb: 'CHECK', text: `Is ${who(k)} a registered doctor? ${yes ? 'Yes' : 'No'}.` };
        case 'pharmacies':
          return { tone: 'check', verb: 'CHECK', text: `Is ${who(k)} a registered pharmacy? ${yes ? 'Yes' : 'No'}.` };
        case 'policies':
          return { tone: 'check', verb: 'CHECK', text: `Is there a cap for class ${num(k)} (${className(num(k))})? ${yes ? 'Yes' : 'No'}.` };
        case 'fills':
          return { tone: 'check', verb: 'CHECK', text: `Was counter request ${shortHash(hex(widen(k)))} answered before? ${yes ? 'Yes' : 'No'}.` };
        case 'patients':
          return {
            tone: 'check',
            verb: 'CHECK',
            text: `Is ${shortHash(cellToBigInt(k).toString(16))} a past root of the patient tree? ${yes ? 'Yes' : 'No'}.`,
            note: 'Proves the patient is enrolled without saying which leaf is theirs.',
          };
        case 'prescriptions':
          return {
            tone: 'check',
            verb: 'CHECK',
            text: `Is ${shortHash(cellToBigInt(k).toString(16))} a past root of the prescription tree? ${yes ? 'Yes' : 'No'}.`,
            note: 'Proves a licensed doctor issued this prescription without saying which one it is.',
          };
        case 'fillNullifiers':
          return {
            tone: 'check',
            verb: 'CHECK',
            text: `Is fill nullifier ${shortHash(hex(widen(k)))} new? ${yes ? 'No, it was used' : 'Yes'}.`,
          };
        case 'capNullifiers':
          return {
            tone: 'check',
            verb: 'CHECK',
            text: `Is cap nullifier ${shortHash(hex(widen(k)))} new? ${yes ? 'No, it was used' : 'Yes'}.`,
          };
        default:
          return { tone: 'check', verb: 'CHECK', text: `${e.field} contains ${shortHash(hex(widen(k)))}? ${yes ? 'Yes' : 'No'}.` };
      }
    }
    case 'read': {
      const [a, b] = e.value;
      switch (e.field) {
        case 'doctors':
          return { tone: 'read', verb: 'READ', text: `Doctor ${who(e.key)}: key hash ${shortHash(hex(widen(a!)))}, ${num(b) ? 'licensed' : 'suspended'}.` };
        case 'pharmacies':
          return { tone: 'read', verb: 'READ', text: `Pharmacy ${who(e.key)}: key hash ${shortHash(hex(widen(a!)))}, ${num(b) ? 'licensed' : 'suspended'}.` };
        case 'policies': {
          const days = num(a) / 86_400n;
          return { tone: 'read', verb: 'READ', text: `Class ${num(e.key)} cap: ${num(b)} fill${num(b) === 1n ? '' : 's'} per ${days} days.` };
        }
        case 'council':
        case 'controller':
        case 'registrar':
          return { tone: 'read', verb: 'READ', text: `The sealed ${e.field} key hash, to check the caller holds it.` };
        default:
          return { tone: 'read', verb: 'READ', text: `${e.field}${e.key ? `[${who(e.key)}]` : ''}` };
      }
    }
    case 'increment': {
      switch (e.field) {
        case 'issuedByDoctor':
          return { tone: 'count', verb: '+1', text: `Prescriptions issued by ${who(e.key)}.` };
        case 'controlledByDoctor':
          return { tone: 'count', verb: '+1', text: `Controlled-drug prescriptions issued by ${who(e.key)}.` };
        case 'filledByPharmacy':
          return { tone: 'count', verb: '+1', text: `Fills at ${who(e.key)}.` };
        case 'issuedTotal':
          return { tone: 'count', verb: '+1', text: 'Prescriptions issued, network-wide.' };
        case 'filledTotal':
          return { tone: 'count', verb: '+1', text: 'Fills, network-wide.' };
        default:
          return { tone: 'count', verb: `+${e.by}`, text: e.field };
      }
    }
    case 'insert': {
      switch (e.field) {
        case 'fillNullifiers':
          return {
            tone: 'write',
            verb: 'WRITE',
            text: `Fill nullifier ${shortHash(hex(widen(e.key)))}.`,
            note: "A one-way hash of the patient's secret, the prescription and the fill number. Only the patient can compute it, so it links to nobody.",
          };
        case 'capNullifiers':
          return {
            tone: 'write',
            verb: 'WRITE',
            text: `Cap nullifier ${shortHash(hex(widen(e.key)))}.`,
            note: "Hash of the patient's secret, the drug class and the 30-day window. A second fill in the same window would need the same value, and it is now taken.",
          };
        case 'fills': {
          const [ph, doc, cls, commit, vb] = e.value;
          return {
            tone: 'write',
            verb: 'WRITE',
            text: `Fill record ${shortHash(hex(widen(e.key)))}: pharmacy ${who(ph)}, doctor ${who(doc)}, class ${num(cls)}, dispense commitment ${shortHash(hex(widen(commit!)))}, valid before ${utcTime(num(vb))}.`,
            note: 'The commitment hides the drug and quantity. Only the pharmacy, shown the opening by the patient, can check it.',
          };
        }
        case 'doctors': {
          const [kh, active] = e.value;
          return { tone: 'write', verb: 'WRITE', text: `Doctor ${who(e.key)}: key hash ${shortHash(hex(widen(kh!)))}, ${num(active) ? 'licensed' : 'suspended'}.` };
        }
        case 'pharmacies': {
          const [kh, active] = e.value;
          return { tone: 'write', verb: 'WRITE', text: `Pharmacy ${who(e.key)}: key hash ${shortHash(hex(widen(kh!)))}, ${num(active) ? 'licensed' : 'suspended'}.` };
        }
        case 'policies': {
          const [w, max] = e.value;
          return { tone: 'write', verb: 'WRITE', text: `Class ${num(e.key)} (${className(num(e.key))}) cap: ${num(max)} per ${num(w) / 86_400n} days.` };
        }
        case 'issuedByDoctor':
        case 'controlledByDoctor':
        case 'filledByPharmacy':
          return { tone: 'write', verb: 'OPEN', text: `A counter for ${who(e.key)} (${e.field}).` };
        default:
          return { tone: 'write', verb: 'WRITE', text: `${e.field}[${shortHash(hex(widen(e.key)))}]` };
      }
    }
    case 'tree-insert':
      return e.field === 'prescriptions'
        ? {
            tone: 'write',
            verb: 'APPEND',
            text: `One hash to the prescription tree: ${shortHash(hex(widen(e.leafHash)))}.`,
            note: "A hash of a hash of the prescription and a random salt. Without the token in the patient's hands it matches nothing.",
          }
        : {
            tone: 'write',
            verb: 'APPEND',
            text: `One hash to the patient tree: ${shortHash(hex(widen(e.leafHash)))}.`,
            note: 'Even the patient key is hashed before it is stored.',
          };
    case 'time':
      return e.relation === 'before'
        ? { tone: 'time', verb: 'TIME', text: `Block time is before ${utcTime(e.seconds)}, the proof's deadline.` }
        : { tone: 'time', verb: 'TIME', text: `Block time is on or after ${utcTime(e.seconds)}, the start of this cap window.` };
    case 'other':
      return { tone: 'other', verb: e.name.toUpperCase(), text: e.cells.map((c) => hex(c)).join(' ') || '(no values)' };
  }
}
