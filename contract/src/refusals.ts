// SPDX-License-Identifier: Apache-2.0
//
// Every assert message in ampoule.compact, with what it means for the person who hit it.
// A refusal happens while the transaction is being built, before anything is proven or
// submitted: nothing reaches the chain and no fee is paid.

export const REFUSALS = {
  NOT_COUNCIL: 'Only the medical council can license or suspend doctors.',
  NOT_CONTROLLER: 'Only the drug controller can license pharmacies or set caps.',
  NOT_REGISTRAR: 'Only the health-ID registrar can enroll patients.',
  GENERAL_CLASS_HAS_NO_CAP: 'Class 0 is for general medicines and has no cap.',
  BAD_POLICY: 'A cap needs a window and at least one fill.',
  UNKNOWN_DOCTOR: 'This doctor is not licensed on the network.',
  NOT_THIS_DOCTOR: 'The signing key does not belong to this doctor.',
  DOCTOR_SUSPENDED: "The prescribing doctor's licence is suspended.",
  NO_FILLS: 'A prescription needs at least one fill.',
  NO_QUANTITY: 'A prescription needs a quantity.',
  UNKNOWN_CLASS: 'No cap policy exists for this controlled class.',
  UNKNOWN_PHARMACY: 'This pharmacy is not licensed on the network.',
  PHARMACY_SUSPENDED: "This pharmacy's licence is suspended.",
  CHALLENGE_USED: 'This counter request was already answered. Ask the pharmacy for a new one.',
  NOT_ENROLLED: 'This patient key is not enrolled with the registrar.',
  NOT_YOUR_PRESCRIPTION: 'This prescription was written for someone else.',
  NO_SUCH_PRESCRIPTION: 'No doctor issued this prescription. It is forged or was altered.',
  REQUEST_EXPIRED: 'The proof was made for a time that has passed. Make a new one.',
  PRESCRIPTION_EXPIRED: 'This prescription has expired.',
  ALREADY_FILLED: 'This prescription has already been filled as many times as prescribed.',
  WRONG_WINDOW: 'The proof names the wrong cap window.',
  CAP_REACHED: 'The cap for this controlled class is reached for this window, across all pharmacies.',
} as const;

export type RefusalCode = keyof typeof REFUSALS;

/** Pulls the refusal code out of a circuit error ("failed assert: CODE"), if there is one. */
export function refusalCodeOf(error: unknown): RefusalCode | undefined {
  const e = error as { message?: string; cause?: { message?: string } } | undefined;
  const text = `${e?.message ?? String(error)} ${e?.cause?.message ?? ''}`;
  const m = /failed assert: ([A-Z_]+)/.exec(text);
  if (m && m[1] && m[1] in REFUSALS) return m[1] as RefusalCode;
  return undefined;
}
