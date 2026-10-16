// SPDX-License-Identifier: Apache-2.0
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CodecError,
  decodeCounter,
  decodeDispense,
  decodeRx,
  encodeCounter,
  encodeDispense,
  encodeRx,
  fromBase64Url,
  fromHex,
  hex,
  id32,
  labelOf,
  toBase64Url,
  tokenKind,
  type Prescription,
} from '../src/index.js';

const bytes32 = fc.uint8Array({ minLength: 32, maxLength: 32 });
const uint = (bits: number) => fc.bigInt({ min: 0n, max: (1n << BigInt(bits)) - 1n });

const prescription: fc.Arbitrary<Prescription> = fc.record({
  patient: bytes32,
  doctor: bytes32,
  drug: bytes32,
  quantity: uint(32),
  drugClass: uint(8),
  fills: uint(8),
  notAfter: uint(64),
  salt: bytes32,
});

const plain = (x: unknown) => JSON.stringify(x, (_k, v) => (v instanceof Uint8Array ? hex(v) : typeof v === 'bigint' ? `${v}` : v));

/** Property bodies return nothing: fast-check treats a returned `false` as a failure. */
const same = (a: unknown, b: unknown): void => {
  expect(plain(a)).toBe(plain(b));
};

describe('tokens round-trip exactly', () => {
  it('prescriptions', () => {
    fc.assert(fc.property(prescription, (rx) => same(decodeRx(encodeRx(rx)), rx)), { numRuns: 200 });
  });
  it('counter requests', () => {
    fc.assert(fc.property(bytes32, bytes32, (pharmacy, challenge) => same(decodeCounter(encodeCounter({ pharmacy, challenge })), { pharmacy, challenge })));
  });
  it('dispense openings', () => {
    fc.assert(
      fc.property(bytes32, bytes32, uint(32), bytes32, (challenge, drug, quantity, salt) =>
        same(decodeDispense(encodeDispense({ challenge, drug, quantity, salt })), { challenge, drug, quantity, salt }),
      ),
    );
  });
  it('a prescription token fits comfortably in a QR code', () => {
    fc.assert(
      fc.property(prescription, (rx) => {
        expect(encodeRx(rx).length).toBeLessThan(220);
      }),
    );
  });
});

describe('tokens refuse to be misread', () => {
  const rx: Prescription = {
    patient: id32('p'),
    doctor: id32('d'),
    drug: id32('x'),
    quantity: 1n,
    drugClass: 0n,
    fills: 1n,
    notAfter: 1n,
    salt: id32('s'),
  };
  it('names the kind of token it is', () => {
    expect(tokenKind(encodeRx(rx))).toBe('rx');
    expect(tokenKind(encodeCounter({ pharmacy: rx.doctor, challenge: rx.salt }))).toBe('counter');
    expect(tokenKind('hello')).toBeUndefined();
  });
  it('a token of one kind is not accepted as another', () => {
    expect(() => decodeRx(encodeCounter({ pharmacy: rx.doctor, challenge: rx.salt }))).toThrow(/expected a rx token, got a counter token/);
  });
  it('truncated or padded tokens are rejected', () => {
    const t = encodeRx(rx);
    expect(() => decodeRx(t.slice(0, -4))).toThrow(CodecError);
    expect(() => decodeRx(t + 'AAAA')).toThrow(/trailing/);
    expect(() => decodeRx(t.replace(/.$/, '*'))).toThrow(/damaged/);
  });
  it('out-of-range fields are rejected when encoding', () => {
    expect(() => encodeRx({ ...rx, quantity: 1n << 32n })).toThrow(/quantity/);
    expect(() => encodeRx({ ...rx, salt: new Uint8Array(31) })).toThrow(/salt must be 32 bytes/);
  });
});

describe('byte helpers', () => {
  it('hex and base64url round-trip', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (b) => {
        expect(hex(fromHex(hex(b)))).toBe(hex(b));
        expect(hex(fromBase64Url(toBase64Url(b)))).toBe(hex(b));
      }),
    );
  });
  it('licence labels read back, and non-labels do not', () => {
    expect(labelOf(id32('MC-DL-58213'))).toBe('MC-DL-58213');
    expect(labelOf(fromHex('ff'.repeat(32)))).toBeUndefined();
    expect(labelOf(new Uint8Array(32))).toBeUndefined();
    expect(() => id32('x'.repeat(33))).toThrow();
  });
});
