// SPDX-License-Identifier: Apache-2.0
//
// The three hand-offs that happen off chain, as compact strings that fit a QR code.
//
//   doctor   -> patient   `ampoule:rx1:`        the sealed prescription itself
//   pharmacy -> patient   `ampoule:counter1:`   which pharmacy, and a one-time challenge
//   patient  -> pharmacy  `ampoule:dispense1:`  what to hand over, and the salt that proves it
//
// None of them carries a secret key. The prescription token is private (it names the drug)
// and should travel like a paper prescription does: to the patient and nobody else. Tampering
// with it is pointless, because a changed token no longer matches the leaf the doctor issued
// and the fill circuit refuses it with NO_SUCH_PRESCRIPTION.
import type { Prescription } from '@ampoule/contract';
import { fromBase64Url, toBase64Url } from './bytes.js';

export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodecError';
  }
}

export interface CounterRequest {
  /** Public licence id of the pharmacy asking. */
  pharmacy: Uint8Array;
  /** Fresh 32 bytes. The fill record is stored under it, so it can be answered only once. */
  challenge: Uint8Array;
}

export interface DispenseOpening {
  /** Which fill record this opens. */
  challenge: Uint8Array;
  drug: Uint8Array;
  quantity: bigint;
  /** Salt of the dispense commitment in the fill record. */
  salt: Uint8Array;
}

export type TokenKind = 'rx' | 'counter' | 'dispense';

const PREFIX: Record<TokenKind, string> = {
  rx: 'ampoule:rx1:',
  counter: 'ampoule:counter1:',
  dispense: 'ampoule:dispense1:',
};

export function tokenKind(token: string): TokenKind | undefined {
  const t = token.trim();
  return (Object.keys(PREFIX) as TokenKind[]).find((k) => t.startsWith(PREFIX[k]));
}

// ------------------------------------------------------------------------------------ framing

class Writer {
  private readonly parts: number[] = [];
  bytes(b: Uint8Array, length: number, what: string): this {
    if (b.length !== length) throw new CodecError(`${what} must be ${length} bytes, got ${b.length}`);
    this.parts.push(...b);
    return this;
  }
  uint(value: bigint, width: number, what: string): this {
    if (value < 0n || value >= 1n << BigInt(width * 8)) throw new CodecError(`${what} does not fit ${width} bytes`);
    let rest = value;
    for (let i = 0; i < width; i++) {
      this.parts.push(Number(rest & 0xffn));
      rest >>= 8n;
    }
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

class Reader {
  private at = 0;
  constructor(private readonly b: Uint8Array) {}
  bytes(length: number): Uint8Array {
    if (this.at + length > this.b.length) throw new CodecError('token is truncated');
    const out = this.b.slice(this.at, this.at + length);
    this.at += length;
    return out;
  }
  uint(width: number): bigint {
    const raw = this.bytes(width);
    let v = 0n;
    for (let i = width - 1; i >= 0; i--) v = (v << 8n) | BigInt(raw[i]!);
    return v;
  }
  end(): void {
    if (this.at !== this.b.length) throw new CodecError('token has trailing bytes');
  }
}

function frame(kind: TokenKind, body: Uint8Array): string {
  return PREFIX[kind] + toBase64Url(body);
}

function unframe(kind: TokenKind, token: string): Reader {
  const t = token.trim();
  if (!t.startsWith(PREFIX[kind])) {
    const got = tokenKind(t);
    throw new CodecError(got ? `expected a ${kind} token, got a ${got} token` : `not an Ampoule ${kind} token`);
  }
  try {
    return new Reader(fromBase64Url(t.slice(PREFIX[kind].length)));
  } catch {
    throw new CodecError(`the ${kind} token is damaged`);
  }
}

// ------------------------------------------------------------------------------- prescription

export function encodeRx(rx: Prescription): string {
  const body = new Writer()
    .bytes(rx.patient, 32, 'patient')
    .bytes(rx.doctor, 32, 'doctor')
    .bytes(rx.drug, 32, 'drug')
    .uint(rx.quantity, 4, 'quantity')
    .uint(rx.drugClass, 1, 'drugClass')
    .uint(rx.fills, 1, 'fills')
    .uint(rx.notAfter, 8, 'notAfter')
    .bytes(rx.salt, 32, 'salt')
    .done();
  return frame('rx', body);
}

export function decodeRx(token: string): Prescription {
  const r = unframe('rx', token);
  const rx: Prescription = {
    patient: r.bytes(32),
    doctor: r.bytes(32),
    drug: r.bytes(32),
    quantity: r.uint(4),
    drugClass: r.uint(1),
    fills: r.uint(1),
    notAfter: r.uint(8),
    salt: r.bytes(32),
  };
  r.end();
  return rx;
}

// ------------------------------------------------------------------------------------ counter

export function encodeCounter(c: CounterRequest): string {
  return frame('counter', new Writer().bytes(c.pharmacy, 32, 'pharmacy').bytes(c.challenge, 32, 'challenge').done());
}

export function decodeCounter(token: string): CounterRequest {
  const r = unframe('counter', token);
  const c = { pharmacy: r.bytes(32), challenge: r.bytes(32) };
  r.end();
  return c;
}

// ----------------------------------------------------------------------------------- dispense

export function encodeDispense(d: DispenseOpening): string {
  const body = new Writer()
    .bytes(d.challenge, 32, 'challenge')
    .bytes(d.drug, 32, 'drug')
    .uint(d.quantity, 4, 'quantity')
    .bytes(d.salt, 32, 'salt')
    .done();
  return frame('dispense', body);
}

export function decodeDispense(token: string): DispenseOpening {
  const r = unframe('dispense', token);
  const d = { challenge: r.bytes(32), drug: r.bytes(32), quantity: r.uint(4), salt: r.bytes(32) };
  r.end();
  return d;
}
