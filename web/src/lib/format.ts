// SPDX-License-Identifier: Apache-2.0

/** `a1b2c3…e4f5`. */
export const shortHash = (h: string, head = 6, tail = 4): string => (h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `16 Oct 2026` from unix seconds. */
export function utcDate(seconds: bigint): string {
  const d = new Date(Number(seconds) * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `16 Oct 2026, 14:32 UTC` from unix seconds. */
export function utcTime(seconds: bigint): string {
  const d = new Date(Number(seconds) * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${utcDate(seconds)}, ${hh}:${mm} UTC`;
}

export const plural = (n: number | bigint, one: string, many = `${one}s`): string => `${n} ${BigInt(n) === 1n ? one : many}`;

export const ms = (n: number): string => (n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);
