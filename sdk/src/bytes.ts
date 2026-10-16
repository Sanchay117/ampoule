// SPDX-License-Identifier: Apache-2.0
//
// Byte helpers shared by the codecs, the public views and the role clients.

export const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function fromHex(text: string): Uint8Array {
  const s = text.startsWith('0x') ? text.slice(2) : text;
  if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new Error(`not a hex string: ${text.slice(0, 16)}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const randomBytes32 = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * A short label as a zero-padded 32-byte id. Licence numbers and drug codes are stored this
 * way, so a public id reads back as the licence number a regulator already knows.
 */
export function id32(label: string): Uint8Array {
  const bytes = new TextEncoder().encode(label);
  if (bytes.length === 0 || bytes.length > 32) throw new Error(`label must be 1 to 32 bytes: "${label}"`);
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
}

/** The label inside an `id32` value, or undefined when the bytes are not a printable label. */
export function labelOf(b: Uint8Array): string | undefined {
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  if (end === 0) return undefined;
  const body = b.subarray(0, end);
  if (body.includes(0)) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return /^[\x20-\x7e]+$/.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/** `a1b2c3…e4f5` for display. */
export const shortHex = (b: Uint8Array | string, head = 6, tail = 4): string => {
  const h = typeof b === 'string' ? b : hex(b);
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
};

export function toBase64Url(b: Uint8Array): string {
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  if (/[^A-Za-z0-9_-]/.test(text)) throw new Error('not a base64url string');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
