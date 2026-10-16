// SPDX-License-Identifier: Apache-2.0
//
// Node-only helpers: a headless fee-paying wallet, filesystem ZK artifacts and LevelDB private
// state. Nothing else in the SDK imports this module, so a browser bundle never pulls in `fs` or
// `ws`. Import it as `@ampoule/sdk/node`.
//
// The wallet-sdk facade types its configuration and sub-wallets loosely, so the calls that cross
// into it are the one place in the SDK that uses `any`; everything handed back is typed.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AmpoulePrivateState } from '@ampoule/contract';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import * as ledgerApi from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { PrivateStateId, PrivateStateProvider, ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types';
import {
  createKeystore,
  DustWallet,
  HDWallet,
  InMemoryTransactionHistoryStorage,
  mergeWalletEntries,
  PublicKey,
  Roles,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
} from '@midnight-ntwrk/wallet-sdk';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { NETWORKS, type ChainNetwork, type NetworkEndpoints, type WalletAdapter } from './backend/providers.js';

export * from './index.js';

/** The wallet SDK and the indexer client subscribe over WebSockets, which Node lacks globally. */
export function installWebSocket(): void {
  const g = globalThis as { WebSocket?: unknown };
  g.WebSocket ??= WebSocket;
}

/** Proving keys and ZKIR read from `<directory>/keys` and `<directory>/zkir`. */
export const nodeZkConfigProvider = (directory: string): ZKConfigProvider<string> => new NodeZkConfigProvider<string>(directory);

export interface LevelPrivateStateOptions {
  /** Directory of the LevelDB store. Keep it out of version control. */
  path: string;
  /** Encrypts the store at rest; the provider enforces a minimum strength. */
  password: string;
  /** Scopes the store to one wallet: the coin public key of the fee payer. */
  accountId: string;
}

/** Private state that survives between CLI runs, one record per participant. */
export const levelPrivateState = (options: LevelPrivateStateOptions): PrivateStateProvider<PrivateStateId, AmpoulePrivateState> =>
  levelPrivateStateProvider<PrivateStateId, AmpoulePrivateState>({
    midnightDbName: options.path,
    privateStateStoreName: 'ampoule',
    privateStoragePasswordProvider: () => options.password,
    accountId: options.accountId,
  } as any);

export interface HeadlessWalletOptions {
  /** 64-byte hex BIP-39 seed of the fee-paying account. */
  seedHex: string;
  network: ChainNetwork;
  endpoints?: Partial<NetworkEndpoints>;
  /** How long to wait for the first sync. A public network syncs from genesis. */
  syncTimeoutMs?: number;
  /** Progress messages for a CLI. */
  log?: (message: string) => void;
}

export interface WalletBalances {
  /** tNIGHT, in its smallest unit. */
  night: bigint;
  /** Spendable DUST right now. */
  dust: bigint;
  /** NIGHT coins not yet designated to generate DUST. */
  unregisteredCoins: number;
}

export interface HeadlessWallet {
  adapter: WalletAdapter;
  /** Bech32m unshielded address: where to send tNIGHT from the faucet. */
  address: string;
  balances(): Promise<WalletBalances>;
  /**
   * Designates every unregistered NIGHT coin to generate DUST, then waits until DUST can pay a
   * fee. Fees on Midnight are paid only in DUST, and only designated NIGHT generates it.
   */
  ensureDust(timeoutMs?: number): Promise<WalletBalances>;
  close(): Promise<void>;
}

/** Derives the three wallet keys (shielded, unshielded, DUST) at account 0, index 0. */
function deriveKeys(seedHex: string) {
  const hd = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('the wallet seed is not valid hex');
  const derived = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('could not derive wallet keys from the seed');
  hd.hdWallet.clear();
  return derived.keys;
}

/** The unshielded (Bech32m) address of a seed, computed offline: where the faucet should pay. */
export function walletAddressOf(seedHex: string, network: ChainNetwork): string {
  const keys = deriveKeys(seedHex);
  return createKeystore(keys[Roles.NightExternal], network as any)
    .getBech32Address()
    .asString();
}

/**
 * Starts a wallet-sdk 1.2.0 facade and exposes it as a `WalletAdapter`. `balanceTx` signs the
 * recipe between balancing and finalizing, which a transaction spending unshielded coins needs.
 */
export async function createHeadlessWallet(options: HeadlessWalletOptions): Promise<HeadlessWallet> {
  installWebSocket();
  const log = options.log ?? (() => {});
  const endpoints = { ...NETWORKS[options.network], ...options.endpoints };
  const keys = deriveKeys(options.seedHex);
  const shieldedSecretKeys = ledgerApi.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledgerApi.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const keystore = createKeystore(keys[Roles.NightExternal], options.network as any);

  const wallet: any = await WalletFacade.init({
    configuration: {
      networkId: options.network,
      indexerClientConnection: { indexerHttpUrl: endpoints.indexerHttpUrl, indexerWsUrl: endpoints.indexerWsUrl },
      provingServerUrl: new URL(endpoints.proofServerUrl),
      relayURL: new URL(endpoints.nodeUrl),
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
      costParameters: { additionalFeeOverhead: 1_000n, feeBlocksMargin: 5 },
    },
    shielded: (cfg: any) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg: any) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: (cfg: any) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledgerApi.LedgerParameters.initialParameters().dust),
  } as any);
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  const address: string = keystore.getBech32Address().asString();
  log(`wallet address ${address}; syncing with ${options.network}`);

  const complete = (p: any): boolean => typeof p?.isStrictlyComplete === 'function' && p.isStrictlyComplete();
  const synced = (s: any): boolean => complete(s.shielded.progress) && complete(s.unshielded.progress) && complete(s.dust.progress);
  await Rx.firstValueFrom(wallet.state().pipe(Rx.filter(synced), Rx.timeout(options.syncTimeoutMs ?? 2_700_000)));
  log('wallet synced');

  const nightOf = (s: any): bigint => s.unshielded.balances[ledgerApi.unshieldedToken().raw] ?? 0n;
  const balancesOf = (s: any): WalletBalances => ({
    night: nightOf(s),
    dust: s.dust.balance(new Date()),
    unregisteredCoins: s.unshielded.availableCoins.filter((c: any) => c.meta?.registeredForDustGeneration !== true).length,
  });
  const current = async (): Promise<any> => Rx.firstValueFrom(wallet.state().pipe(Rx.filter(synced)));

  const adapter: WalletAdapter = {
    getCoinPublicKey: () => shieldedSecretKeys.coinPublicKey as any,
    getEncryptionPublicKey: () => shieldedSecretKeys.encryptionPublicKey as any,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys, dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60_000) },
      );
      const signed = await wallet.signRecipe(recipe, (data: Uint8Array) => keystore.signData(data));
      return wallet.finalizeRecipe(signed);
    },
    submitTx: (tx: any) => wallet.submitTransaction(tx),
    close: () => wallet.stop(),
  };

  return {
    adapter,
    address,
    balances: async () => balancesOf(await current()),
    async ensureDust(timeoutMs = 1_800_000) {
      let s = await current();
      if (nightOf(s) === 0n) {
        log(`no tNIGHT yet; fund ${address} from the faucet. Waiting...`);
        s = await Rx.firstValueFrom(
          wallet.state().pipe(Rx.filter((x: any) => synced(x) && nightOf(x) > 0n), Rx.timeout(timeoutMs)),
        );
      }
      const unregistered = s.unshielded.availableCoins.filter((c: any) => c.meta?.registeredForDustGeneration !== true);
      if (unregistered.length > 0 && s.dust.balance(new Date()) === 0n) {
        log(`designating ${unregistered.length} NIGHT coin(s) to generate DUST`);
        const recipe = await wallet.registerNightUtxosForDustGeneration(unregistered, keystore.getPublicKey(), (payload: Uint8Array) =>
          keystore.signData(payload),
        );
        await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
      }
      if (s.dust.balance(new Date()) === 0n) {
        log('waiting for DUST to accrue (a few minutes)');
        s = await Rx.firstValueFrom(
          wallet.state().pipe(
            Rx.throttleTime(5_000),
            Rx.filter((x: any) => synced(x) && x.dust.balance(new Date()) > 0n),
            Rx.timeout(timeoutMs),
          ),
        );
      }
      return balancesOf(s);
    },
    close: () => wallet.stop(),
  };
}
