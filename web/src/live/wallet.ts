// SPDX-License-Identifier: Apache-2.0
//
// Finding and connecting a wallet for the live page. Two kinds reduce to the same
// `ConnectedWallet` (the part of DApp Connector API 4 Ampoule uses):
//
//   - a wallet extension such as Lace, found under `window.midnight`, which balances, signs,
//     submits and, when it can, proves inside the wallet;
//   - the CLI's wallet bridge (`npm run cli -- bridge`), for developers without Lace, which
//     balances, signs and submits while this page proves with the local proof server.
import { Buffer } from 'buffer';
import type { ConnectedWallet } from '@ampoule/sdk';

export const LIVE_NETWORK = 'preview';

export interface WalletConfig {
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri?: string;
  substrateNodeUri: string;
  networkId: string;
}

export interface Connected {
  kind: 'extension' | 'bridge';
  name: string;
  api: ConnectedWallet;
  config: WalletConfig;
  /** Coin and encryption public keys, hex, as midnight-js expects them. */
  keys: { coinPublicKey: string; encryptionPublicKey: string };
  address: string;
}

export interface WalletChoice {
  id: string;
  name: string;
  icon?: string;
  kind: Connected['kind'];
  connect(): Promise<Connected>;
}

interface InitialAPI {
  name: string;
  icon?: string;
  apiVersion: string;
  rdns?: string;
  connect(networkId: string): Promise<ConnectedWallet & { getConfiguration(): Promise<WalletConfig> }>;
}

/** DApp Connector API 4 wallets the browser has injected. */
export function extensionWallets(): WalletChoice[] {
  const found = (window as unknown as { midnight?: Record<string, InitialAPI> }).midnight ?? {};
  return Object.entries(found)
    .filter(([, w]) => typeof w?.connect === 'function' && String(w.apiVersion ?? '').startsWith('4'))
    .map(([id, w]) => ({ id, name: w.name || id, icon: w.icon, kind: 'extension' as const, connect: () => connectExtension(w) }));
}

async function connectExtension(w: InitialAPI): Promise<Connected> {
  const api = await w.connect(LIVE_NETWORK);
  const config = await api.getConfiguration();
  if (config.networkId !== LIVE_NETWORK) {
    throw new Error(`${w.name} is on ${config.networkId}. Switch it to Midnight Preview and connect again.`);
  }
  const [shielded, unshielded] = await Promise.all([api.getShieldedAddresses(), api.getUnshieldedAddress()]);
  return {
    kind: 'extension',
    name: w.name,
    api,
    config,
    keys: await decodeKeys(shielded.shieldedCoinPublicKey, shielded.shieldedEncryptionPublicKey),
    address: unshielded.unshieldedAddress,
  };
}

/** The connector hands keys over in Bech32m; midnight-js wants their hex bytes. */
async function decodeKeys(coin: string, encryption: string): Promise<Connected['keys']> {
  // wallet-sdk-address-format works on Node Buffers.
  (globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
  const { MidnightBech32m, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } = await import('@midnight-ntwrk/wallet-sdk-address-format');
  return {
    coinPublicKey: ShieldedCoinPublicKey.codec.decode(LIVE_NETWORK, MidnightBech32m.parse(coin)).toHexString(),
    encryptionPublicKey: ShieldedEncryptionPublicKey.codec.decode(LIVE_NETWORK, MidnightBech32m.parse(encryption)).toHexString(),
  };
}

/** The CLI's wallet bridge at `url`, which needs the token it printed at start. */
export function bridgeWallet(url: string, token: string): WalletChoice {
  const call = async <T,>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${url.replace(/\/$/, '')}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new Error(`wallet bridge ${path}: ${json.error ?? r.status}`);
    return json;
  };
  const keys = () => call<{ coinPublicKey: string; encryptionPublicKey: string; unshieldedAddress: string }>('GET', '/keys');
  const api: ConnectedWallet = {
    getShieldedAddresses: async () => {
      const k = await keys();
      return { shieldedAddress: '', shieldedCoinPublicKey: k.coinPublicKey, shieldedEncryptionPublicKey: k.encryptionPublicKey };
    },
    getUnshieldedAddress: async () => ({ unshieldedAddress: (await keys()).unshieldedAddress }),
    getDustBalance: async () => {
      const d = await call<{ balance: string }>('GET', '/dust');
      return { balance: BigInt(d.balance), cap: 0n };
    },
    balanceUnsealedTransaction: (tx) => call<{ tx: string }>('POST', '/balance', { tx }),
    submitTransaction: async (tx) => {
      await call('POST', '/submit', { tx });
    },
    getProvingProvider: async () => {
      throw new Error('the wallet bridge does not prove; use a proof server');
    },
    getConfiguration: () => call<WalletConfig>('GET', '/config'),
  };
  return {
    id: 'bridge',
    name: 'CLI wallet bridge',
    kind: 'bridge',
    async connect() {
      const [config, k] = await Promise.all([api.getConfiguration(), keys()]);
      if (config.networkId !== LIVE_NETWORK) throw new Error(`the bridge serves ${config.networkId}, not ${LIVE_NETWORK}`);
      return {
        kind: 'bridge',
        name: 'CLI wallet bridge',
        api,
        config,
        keys: { coinPublicKey: k.coinPublicKey, encryptionPublicKey: k.encryptionPublicKey },
        address: k.unshieldedAddress,
      };
    },
  };
}

/** The bridge address and token from the page URL (`#/live?bridge=...&token=...`), if any. */
export function bridgeFromLocation(search: string): { url: string; token: string } | undefined {
  const q = new URLSearchParams(search);
  const url = q.get('bridge');
  const token = q.get('token');
  if (!url || !token || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url)) return undefined;
  return { url, token };
}

/** Wallet errors carry a code and a reason; a rejection should read as one. */
export function walletErrorText(e: unknown): string {
  const err = e as { code?: string; reason?: string; message?: string };
  if (err?.code === 'Rejected' || err?.code === 'PermissionRejected') return 'You declined in the wallet. Nothing was sent.';
  return err?.reason ?? err?.message ?? String(e);
}
