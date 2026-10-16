// SPDX-License-Identifier: Apache-2.0
//
// Provider wiring for the network backend. Everything here is browser-safe: no `fs`, no
// `process`, no `ws`. What differs between the CLI and a browser (where ZK artifacts come from,
// where private state is kept, who pays and proves) is injected; the Node-only pieces live in
// `../node.ts`, which a browser bundle never imports.
import type { AmpoulePrivateState } from '@ampoule/contract';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  Transaction,
  type Binding,
  type FinalizedTransaction,
  type Proof,
  type SignatureEnabled,
  type TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  createProofProvider,
  type MidnightProviders,
  type PrivateStateId,
  type PrivateStateProvider,
  type ProofProvider,
  type PublicDataProvider,
  type UnboundTransaction,
  type WalletProvider,
  type ZKConfigProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { fromHex, hex } from '../bytes.js';

/** Networks the SDK can reach. The simulator needs no providers at all. */
export type ChainNetwork = 'undeployed' | 'preview' | 'preprod';

export interface NetworkEndpoints {
  indexerHttpUrl: string;
  indexerWsUrl: string;
  nodeUrl: string;
  proofServerUrl: string;
}

/** Defaults per network. `undeployed` is a devnet on this machine. Any field can be overridden. */
export const NETWORKS: Record<ChainNetwork, NetworkEndpoints> = {
  undeployed: {
    indexerHttpUrl: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    nodeUrl: 'ws://127.0.0.1:9944',
    proofServerUrl: 'http://127.0.0.1:6300',
  },
  preview: {
    indexerHttpUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'wss://rpc.preview.midnight.network',
    proofServerUrl: 'http://127.0.0.1:6300',
  },
  preprod: {
    indexerHttpUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'wss://rpc.preprod.midnight.network',
    proofServerUrl: 'http://127.0.0.1:6300',
  },
};

/** Explorer pages per network. Midnight Explorer keys transactions by hash, not identifier. */
export const EXPLORERS: Partial<Record<ChainNetwork, { tx: string; contract: string; block: string }>> = {
  preview: {
    tx: 'https://preview.midnightexplorer.com/transactions/{txHash}',
    contract: 'https://preview.midnightexplorer.com/contracts/{address}',
    block: 'https://preview.midnightexplorer.com/blocks/{height}',
  },
  preprod: {
    tx: 'https://preprod.midnightexplorer.com/transactions/{txHash}',
    contract: 'https://preprod.midnightexplorer.com/contracts/{address}',
    block: 'https://preprod.midnightexplorer.com/blocks/{height}',
  },
};

/** `fill` proves in tens of seconds on a laptop; the 300 s default leaves too little headroom. */
export const DEFAULT_PROOF_TIMEOUT_MS = 900_000;

/**
 * Everything the SDK needs from a wallet: midnight-js's `WalletProvider` plus submission. A
 * headless wallet-sdk facade (CLI) and a DApp Connector wallet such as Lace (browser) both
 * reduce to this.
 */
export interface WalletAdapter extends WalletProvider {
  submitTx(tx: FinalizedTransaction): Promise<TransactionId>;
  close?(): Promise<void>;
}

export type AmpouleProviders = MidnightProviders<string, PrivateStateId, AmpoulePrivateState> & {
  privateStateProvider: PrivateStateProvider<PrivateStateId, AmpoulePrivateState>;
  publicDataProvider: PublicDataProvider;
  zkConfigProvider: ZKConfigProvider<string>;
  proofProvider: ProofProvider;
  walletProvider: WalletAdapter;
  midnightProvider: WalletAdapter;
};

export interface CreateProvidersOptions {
  network: ChainNetwork;
  wallet: WalletAdapter;
  /** Where proving keys and ZKIR come from: `fetchZkConfigProvider` or the Node one. */
  zkConfigProvider: ZKConfigProvider<string>;
  /** Who proves. Defaults to the proof server at `endpoints.proofServerUrl`. */
  proofProvider?: ProofProvider;
  /** Where per-participant private state is kept. Defaults to memory. */
  privateStateProvider?: PrivateStateProvider<PrivateStateId, AmpoulePrivateState>;
  endpoints?: Partial<NetworkEndpoints>;
  proofTimeoutMs?: number;
  /** WebSocket implementation for indexer subscriptions; browsers have one, Node does not. */
  webSocket?: unknown;
}

/** Builds the provider bundle and pins the global network id. Call once per process or page. */
export function createProviders(options: CreateProvidersOptions): AmpouleProviders {
  const endpoints = { ...NETWORKS[options.network], ...options.endpoints };
  setNetworkId(options.network as NetworkId);
  return {
    privateStateProvider: options.privateStateProvider ?? inMemoryPrivateStateProvider(),
    publicDataProvider: indexerPublicDataProvider(endpoints.indexerHttpUrl, endpoints.indexerWsUrl, options.webSocket as never),
    zkConfigProvider: options.zkConfigProvider,
    proofProvider:
      options.proofProvider ??
      httpClientProofProvider(endpoints.proofServerUrl, options.zkConfigProvider, {
        timeout: options.proofTimeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS,
      }),
    walletProvider: options.wallet,
    midnightProvider: options.wallet,
  };
}

/** ZK artifacts served over HTTP from `<baseUrl>/keys` and `<baseUrl>/zkir`. */
export const fetchZkConfigProvider = (baseUrl: string): ZKConfigProvider<string> => new FetchZkConfigProvider<string>(baseUrl);

/** Private state that lives as long as the page. The CLI uses the LevelDB provider instead. */
export function inMemoryPrivateStateProvider(): PrivateStateProvider<PrivateStateId, AmpoulePrivateState> {
  const states = new Map<string, AmpoulePrivateState>();
  const signingKeys = new Map<ContractAddress, SigningKey>();
  let scope: ContractAddress | undefined;
  const key = (id: PrivateStateId): string => `${scope ?? ''}:${id}`;
  const unsupported = (what: string): never => {
    throw new Error(`the in-memory private state provider cannot ${what}`);
  };
  return {
    setContractAddress: (address) => {
      scope = address;
    },
    set: async (id, state) => {
      states.set(key(id), state);
    },
    get: async (id) => states.get(key(id)) ?? null,
    remove: async (id) => {
      states.delete(key(id));
    },
    clear: async () => states.clear(),
    setSigningKey: async (address, signingKey) => {
      signingKeys.set(address, signingKey);
    },
    getSigningKey: async (address) => signingKeys.get(address) ?? null,
    removeSigningKey: async (address) => {
      signingKeys.delete(address);
    },
    clearSigningKeys: async () => signingKeys.clear(),
    exportPrivateStates: async () => unsupported('export private states'),
    importPrivateStates: async () => unsupported('import private states'),
    exportSigningKeys: async () => unsupported('export signing keys'),
    importSigningKeys: async () => unsupported('import signing keys'),
  };
}

// ------------------------------------------------------------------------------ DApp Connector

/**
 * The part of `@midnight-ntwrk/dapp-connector-api` 4.0.1's `ConnectedAPI` Ampoule uses, typed
 * structurally so the browser bundle does not depend on the connector package.
 */
export interface ConnectedWallet {
  getShieldedAddresses(): Promise<{ shieldedAddress: string; shieldedCoinPublicKey: string; shieldedEncryptionPublicKey: string }>;
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  getDustBalance(): Promise<{ cap: bigint; balance: bigint }>;
  balanceUnsealedTransaction(tx: string, options?: { payFees?: boolean }): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<void>;
  getProvingProvider(keys: {
    getZKIR(location: string): Promise<Uint8Array>;
    getProverKey(location: string): Promise<Uint8Array>;
    getVerifierKey(location: string): Promise<Uint8Array>;
  }): Promise<{
    check(preimage: Uint8Array, keyLocation: string): Promise<(bigint | undefined)[]>;
    prove(preimage: Uint8Array, keyLocation: string, overwriteBindingInput?: bigint): Promise<Uint8Array>;
  }>;
  getConfiguration(): Promise<{ indexerUri: string; indexerWsUri: string; proverServerUri?: string; substrateNodeUri: string; networkId: string }>;
}

/**
 * Wraps a connected wallet as a `WalletAdapter`. The connector speaks hex-serialized
 * transactions, so this converts both ways; the wallet balances, pays DUST fees and signs.
 * `keys` are the wallet's coin and encryption public keys in the encoding midnight-js expects
 * (decode the connector's Bech32m strings with wallet-sdk-address-format).
 */
export function connectedWalletAdapter(
  wallet: ConnectedWallet,
  keys: { coinPublicKey: string; encryptionPublicKey: string },
): WalletAdapter {
  return {
    getCoinPublicKey: () => keys.coinPublicKey,
    getEncryptionPublicKey: () => keys.encryptionPublicKey,
    async balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
      const balanced = await wallet.balanceUnsealedTransaction(hex(tx.serialize()));
      return Transaction.deserialize<SignatureEnabled, Proof, Binding>('signature', 'proof', 'binding', fromHex(balanced.tx));
    },
    async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      await wallet.submitTransaction(hex(tx.serialize()));
      return tx.identifiers()[0] ?? String(tx.transactionHash());
    },
  };
}

/**
 * Proving through the wallet, so a browser needs no proof server of its own. Falls back to the
 * caller's proof server when the wallet does not offer one.
 */
export async function walletProofProvider(
  wallet: ConnectedWallet,
  zkConfigProvider: ZKConfigProvider<string>,
): Promise<ProofProvider> {
  const proving = await wallet.getProvingProvider(zkConfigProvider.asKeyMaterialProvider());
  return createProofProvider(proving as never);
}
