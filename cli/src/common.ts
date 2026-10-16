// SPDX-License-Identifier: Apache-2.0
//
// Shared plumbing: arguments, paths, JSON files, the cast's keys and the fee-paying mnemonic.
//
// Two rules hold everywhere. Secrets are written only under `cli/.secrets/`, which git ignores,
// and are never printed. Files written to `deployments/` and `evidence/` are plain ASCII JSON
// with hex byte strings and decimal integers, so anyone can read them without running anything.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { fromHex, hex, randomBytes32, type ChainNetwork } from '@ampoule/sdk';

export const COMPACT_VERSION = '0.31.1';
export const CHAIN_NETWORKS: readonly ChainNetwork[] = ['undeployed', 'preview', 'preprod'];

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

// ------------------------------------------------------------------------------------- paths

export const CLI_DIR = resolve(fileURLToPath(new URL('../', import.meta.url)));
export const REPO_ROOT = resolve(CLI_DIR, '..');
export const SECRETS_DIR = join(CLI_DIR, '.secrets');
export const DEPLOYMENTS_DIR = join(CLI_DIR, 'deployments');
export const EVIDENCE_DIR = join(CLI_DIR, 'evidence');
export const ZK_ASSETS = join(REPO_ROOT, 'contract', 'src', 'managed', 'ampoule');

export const walletPath = (n: ChainNetwork) => join(SECRETS_DIR, `${n}-wallet.json`);
export const castPath = (n: ChainNetwork) => join(SECRETS_DIR, `${n}-cast.json`);
export const privateStatePath = (n: ChainNetwork) => join(SECRETS_DIR, `${n}-private-state`);
export const deploymentPath = (n: ChainNetwork) => join(DEPLOYMENTS_DIR, `${n}.json`);

/** Proving keys and ZKIR from the full compile. `compile:fast` writes none. */
export function zkAssets(args: Args): string {
  const path = flag(args, 'zk-assets') ?? process.env.AMPOULE_ZK_ASSETS ?? ZK_ASSETS;
  const keys = join(path, 'keys');
  if (!existsSync(keys) || !readdirSync(keys).some((n) => n.endsWith('.prover'))) {
    throw new UsageError(`no proving keys under ${keys}. Run \`npm run compile\` (the full build) first.`);
  }
  return path;
}

// --------------------------------------------------------------------------------- arguments

export interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: readonly string[]): Args {
  const [command = '', ...rest] = argv;
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!;
    if (!t.startsWith('--')) {
      positional.push(t);
      continue;
    }
    const eq = t.indexOf('=');
    if (eq > 0) flags.set(t.slice(2, eq), t.slice(eq + 1));
    else if (rest[i + 1] !== undefined && !rest[i + 1]!.startsWith('--')) flags.set(t.slice(2), rest[++i]!);
    else flags.set(t.slice(2), true);
  }
  return { command, positional, flags };
}

export const flag = (args: Args, name: string): string | undefined => {
  const v = args.flags.get(name);
  return typeof v === 'string' ? v : undefined;
};

export const hasFlag = (args: Args, name: string): boolean => args.flags.has(name);

export function network(args: Args): ChainNetwork {
  const v = flag(args, 'network') ?? 'preview';
  if (!CHAIN_NETWORKS.includes(v as ChainNetwork)) throw new UsageError(`unknown network "${v}"; use one of ${CHAIN_NETWORKS.join(', ')}`);
  return v as ChainNetwork;
}

// ------------------------------------------------------------------------------------ output

const started = Date.now();
export const say = (m: string): void => void process.stdout.write(`${m}\n`);
export const note = (m: string): void => say(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${m}`);
export const heading = (t: string): void => say(`\n== ${t}`);
export const fail = (m: string): void => void process.stderr.write(`${m}\n`);

/** JSON as pure ASCII, with bigints as decimal strings and bytes as hex. */
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const json = JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? hex(v) : v), 2).replace(
    /[\u0080-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  writeFileSync(path, `${json}\n`, 'utf8');
}

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

export const fileStamp = (d = new Date()): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');

// ---------------------------------------------------------------------------------- the cast

/** Every participant of the on-chain scenario, with the secret only they would hold. */
export interface CastFile {
  network: ChainNetwork;
  createdAt: string;
  council: string;
  controller: string;
  registrar: string;
  doctors: Array<{ name: string; licence: string; secretKey: string }>;
  pharmacies: Array<{ name: string; licence: string; secretKey: string }>;
  patients: Array<{ name: string; secretKey: string }>;
}

export const CAST = {
  doctors: [
    { name: 'Dr Asha Rao', licence: 'MC-DL-58213' },
    { name: 'Dr Vikram Mehta', licence: 'MC-MH-11902' },
  ],
  pharmacies: [
    { name: 'Lotus Pharmacy, Delhi', licence: 'DL-RX-20B-4471' },
    { name: 'Neem Chemists, Mumbai', licence: 'MH-RX-21B-0932' },
  ],
  patients: [{ name: 'Ravi' }, { name: 'Meera' }],
} as const;

export function loadOrCreateCast(n: ChainNetwork): CastFile {
  const path = castPath(n);
  if (existsSync(path)) return readJson<CastFile>(path);
  const sk = () => hex(randomBytes32());
  const cast: CastFile = {
    network: n,
    createdAt: new Date().toISOString(),
    council: sk(),
    controller: sk(),
    registrar: sk(),
    doctors: CAST.doctors.map((d) => ({ ...d, secretKey: sk() })),
    pharmacies: CAST.pharmacies.map((p) => ({ ...p, secretKey: sk() })),
    patients: CAST.patients.map((p) => ({ ...p, secretKey: sk() })),
  };
  writeJson(path, cast);
  return cast;
}

export const secret = (h: string): Uint8Array => fromHex(h);

// ------------------------------------------------------------------------------------ wallet

export interface WalletFile {
  network: ChainNetwork;
  createdAt: string;
  mnemonic: string;
  address?: string;
}

/** The fee payer's mnemonic: MIDNIGHT_MNEMONIC, --mnemonic-file, or cli/.secrets/<network>-wallet.json. */
export function loadMnemonic(args: Args, n: ChainNetwork): string {
  const file = flag(args, 'mnemonic-file');
  let raw = process.env.MIDNIGHT_MNEMONIC;
  if (file) {
    if (!existsSync(file)) throw new UsageError(`--mnemonic-file ${file} does not exist`);
    const text = readFileSync(file, 'utf8').trim();
    raw = text.startsWith('{') ? (JSON.parse(text) as { mnemonic?: string }).mnemonic : text;
  } else if (!raw && existsSync(walletPath(n))) {
    raw = readJson<WalletFile>(walletPath(n)).mnemonic;
  }
  if (!raw) throw new UsageError(`no wallet: run \`npm run cli -- wallet new --network ${n}\`, or set MIDNIGHT_MNEMONIC`);
  const words = raw.trim().split(/\s+/).join(' ');
  if (!validateMnemonic(words, wordlist)) throw new UsageError('the wallet mnemonic is not a valid BIP-39 phrase');
  return words;
}

export const newMnemonic = (): string => generateMnemonic(wordlist, 256);
export const seedHexOf = (mnemonic: string): string => hex(mnemonicToSeedSync(mnemonic));

/** Encrypts the local LevelDB of participant private states. Testnet personas only. */
export const privateStatePassword = (): string => process.env.AMPOULE_PRIVATE_STATE_PASSWORD ?? 'Ampoule-Local-Testnet-Private-State-2026';
