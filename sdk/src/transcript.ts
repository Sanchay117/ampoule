// SPDX-License-Identifier: Apache-2.0
//
// Reading a public transcript. A transcript is the program of ledger operations a call runs on
// chain: which fields it touched, which keys it looked up, which values it read and wrote, and
// which block-time bounds it asserted. It is published with the proof, so it is precisely what
// an observer of the chain learns from a call. Circuit arguments and witnesses are not in it.
//
// `decodeTranscript` turns the raw operations into events ("checked fillNullifiers for X: not
// present", "inserted fills[C] = ...") that the web app shows next to the private inputs, and
// `scanTranscript` answers the question that matters: does any private value appear anywhere?

/** Ledger field of each state path, as compactc 0.31.1 lays out ampoule.compact. */
const FIELDS: Record<string, string> = {
  '0.0': 'council',
  '1.0': 'controller',
  '1.1': 'registrar',
  '1.2': 'doctors',
  '1.3': 'pharmacies',
  '1.4': 'policies',
  '1.5': 'patients',
  '1.6': 'prescriptions',
  '1.7': 'fillNullifiers',
  '1.8': 'capNullifiers',
  '1.9': 'fills',
  '1.10': 'issuedTotal',
  '1.11': 'filledTotal',
  '1.12': 'issuedByDoctor',
  '1.13': 'controlledByDoctor',
  '1.14': 'filledByPharmacy',
};

export const LEDGER_FIELDS: readonly string[] = Object.values(FIELDS);

export type ChainEvent =
  /** A membership test: "is `key` in `field`?" and the answer the proof commits to. */
  | { op: 'member'; field: string; sub?: string; key: Uint8Array; result: boolean }
  /** A value read out of the ledger and pinned by the proof. */
  | { op: 'read'; field: string; key?: Uint8Array; value: Uint8Array[] }
  /** A counter going up by `by`. */
  | { op: 'increment'; field: string; key?: Uint8Array; by: number }
  /** An element added to a set or an entry written to a map. */
  | { op: 'insert'; field: string; key: Uint8Array; value: Uint8Array[] }
  /** A leaf appended to a Merkle tree; trees store a hash of the leaf, never the leaf. */
  | { op: 'tree-insert'; field: string; leafHash: Uint8Array }
  /** A bound on block time the node re-checks when the transaction lands. */
  | { op: 'time'; relation: 'before' | 'not-before'; seconds: bigint }
  /** Anything else, kept so nothing in the transcript is ever hidden from the reader. */
  | { op: 'other'; name: string; cells: Uint8Array[] };

type RawOp = string | Record<string, unknown>;

interface AlignedValue {
  value: Uint8Array[];
  alignment: unknown[];
}

const isAligned = (x: unknown): x is AlignedValue =>
  !!x && typeof x === 'object' && Array.isArray((x as AlignedValue).value) && Array.isArray((x as AlignedValue).alignment);

/** Every cell inside an operation, in order. */
function cellsOf(node: unknown, out: Uint8Array[] = []): Uint8Array[] {
  if (Array.isArray(node)) node.forEach((n) => cellsOf(n, out));
  else if (isAligned(node)) out.push(...node.value.map((c) => (c instanceof Uint8Array ? c : Uint8Array.from(Object.values(c as object)))));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => cellsOf(n, out));
  return out;
}

/** A transcript cell as an unsigned little-endian integer (cells drop trailing zero bytes). */
export function cellToBigInt(cell: Uint8Array): bigint {
  let v = 0n;
  for (let i = cell.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(cell[i]!);
  return v;
}

/** Restores a cell to its declared width: cells are stored with trailing zero bytes dropped. */
export function widen(cell: Uint8Array, width = 32): Uint8Array {
  if (cell.length >= width) return cell;
  const out = new Uint8Array(width);
  out.set(cell);
  return out;
}

const opName = (op: RawOp): string => (typeof op === 'string' ? op : (Object.keys(op)[0] ?? '?'));
const opBody = (op: RawOp): Record<string, unknown> =>
  typeof op === 'string' ? {} : ((Object.values(op)[0] ?? {}) as Record<string, unknown>);

/** The cells of an `idx` operation's path. */
const pathOf = (op: RawOp): Uint8Array[] => cellsOf(opBody(op).path);

function fieldOf(path: Uint8Array[]): string | undefined {
  if (path.length < 2) return undefined;
  return FIELDS[`${cellToBigInt(path[0]!)}.${cellToBigInt(path[1]!)}`];
}

const pushed = (op: RawOp | undefined, storage: boolean): Uint8Array[] | undefined => {
  if (!op || opName(op) !== 'push') return undefined;
  const body = opBody(op);
  return body.storage === storage ? cellsOf(body.value) : undefined;
};

const truthy = (cells: Uint8Array[]): boolean => cells.some((c) => c.some((b) => b !== 0));

/**
 * Decodes the operation patterns compactc emits for the ledger types Ampoule uses (Map, Set,
 * Counter, HistoricMerkleTree, block-time bounds). An operation outside those patterns is
 * reported as `other`, with its cells, rather than dropped.
 */
export function decodeTranscript(transcript: readonly unknown[]): ChainEvent[] {
  const ops = transcript as RawOp[];
  const events: ChainEvent[] = [];
  let i = 0;
  const at = (k: number) => ops[i + k];
  const is = (k: number, name: string) => at(k) !== undefined && opName(at(k)!) === name;

  while (i < ops.length) {
    const op = ops[i]!;
    const name = opName(op);
    const body = opBody(op);

    // Reads start from a copy of the state: dup, then one or more idx hops into it.
    if (name === 'dup' && is(1, 'idx')) {
      // Block-time bound: dup 2, idx [2] (cached), push t, lt, popeq.
      if (body.n === 2 && is(2, 'push') && is(3, 'lt') && is(4, 'popeq')) {
        const t = cellToBigInt(pushed(at(2), false)?.[0] ?? new Uint8Array());
        const lt = truthy(cellsOf(opBody(at(4)!).result));
        events.push({ op: 'time', relation: lt ? 'before' : 'not-before', seconds: t });
        i += 5;
        continue;
      }
      const path = pathOf(at(1)!);
      const field = fieldOf(path);
      // Membership: dup, idx [field], (idx [sub],) push key, member, popeq.
      let j = 2;
      let sub: string | undefined;
      if (is(j, 'idx') && is(j + 1, 'push')) {
        sub = String(cellToBigInt(pathOf(at(j)!)[0] ?? new Uint8Array()));
        j += 1;
      }
      const key = pushed(at(j), false);
      if (field && key && is(j + 1, 'member') && is(j + 2, 'popeq')) {
        const result = truthy(cellsOf(opBody(at(j + 2)!).result));
        events.push({ op: 'member', field, sub: sub === undefined ? undefined : field === 'patients' || field === 'prescriptions' ? 'root history' : sub, key: key[0] ?? new Uint8Array(), result });
        i += j + 3;
        continue;
      }
      // Lookup: dup, idx [field], idx [key], popeq value.
      if (field && is(2, 'idx') && is(3, 'popeq')) {
        events.push({ op: 'read', field, key: pathOf(at(2)!)[0], value: cellsOf(opBody(at(3)!).result) });
        i += 4;
        continue;
      }
      // Whole-field read: dup, idx [field], popeq.
      if (field && is(2, 'popeq')) {
        events.push({ op: 'read', field, value: cellsOf(opBody(at(2)!).result) });
        i += 3;
        continue;
      }
    }

    // Writes descend with pushPath, then insert back up.
    if (name === 'idx' && body.pushPath === true) {
      const path = pathOf(op);
      const field = fieldOf(path);
      if (field) {
        // Counter: idx [field(, key)], addi n, ins.
        if (is(1, 'addi') && is(2, 'ins')) {
          const by = Number(opBody(at(1)!).immediate ?? 1);
          events.push({ op: 'increment', field, key: path[2], by });
          i += 3;
          continue;
        }
        // Set or map insert: idx [field], push key, push(storage) value, ins, ins.
        const key = pushed(at(1), false);
        const value = pushed(at(2), true);
        if (key && value && is(3, 'ins') && is(4, 'ins')) {
          events.push({ op: 'insert', field, key: key[0] ?? new Uint8Array(), value });
          i += 5;
          continue;
        }
        // Merkle tree append: the leaf hash is the one storage push inside the block, which
        // ends with the root being folded into the history.
        if (is(1, 'idx')) {
          let k = 1;
          let leafHash: Uint8Array | undefined;
          while (at(k) !== undefined && !(opName(at(k)!) === 'ins' && opBody(at(k)!).n === 3)) {
            const v = pushed(at(k), true);
            if (v && v.length > 0 && !leafHash) leafHash = v[0];
            k++;
          }
          if (leafHash && at(k) !== undefined) {
            events.push({ op: 'tree-insert', field, leafHash });
            i += k + 1;
            continue;
          }
        }
      }
    }

    events.push({ op: 'other', name, cells: cellsOf(body) });
    i += 1;
  }
  return events;
}

/** Every cell of a transcript, flattened, as hex. */
export function transcriptCells(transcript: readonly unknown[]): Uint8Array[] {
  return cellsOf(transcript as unknown[]);
}

const trimmedHex = (b: Uint8Array): string => {
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return Array.from(b.subarray(0, end), (x) => x.toString(16).padStart(2, '0')).join('');
};

/**
 * Which of `secrets` appear anywhere in the transcript. A value counts as present if its bytes
 * (trailing zeros trimmed, as cells store them) occur inside any cell, so a secret embedded in
 * a larger cell is found too. Values shorter than four significant bytes are skipped: small
 * numbers collide with field indices and flags by chance and prove nothing either way.
 */
export function scanTranscript(
  transcript: readonly unknown[],
  secrets: Record<string, Uint8Array>,
): { present: string[]; absent: string[]; skipped: string[] } {
  const cells = transcriptCells(transcript).map(trimmedHex);
  const present: string[] = [];
  const absent: string[] = [];
  const skipped: string[] = [];
  for (const [label, value] of Object.entries(secrets)) {
    const needle = trimmedHex(value);
    if (needle.length < 8) skipped.push(label);
    else if (cells.some((c) => c.includes(needle))) present.push(label);
    else absent.push(label);
  }
  return { present, absent, skipped };
}

/** A number as a transcript cell carries it, for scanning: little-endian bytes. */
export function leBytes(value: bigint, width = 8): Uint8Array {
  const out = new Uint8Array(width);
  let rest = value;
  for (let i = 0; i < width; i++) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}
