// SPDX-License-Identifier: Apache-2.0
//
// The same `AmpouleBackend`, against a deployed contract through midnight-js 4.1.1. Role
// clients cannot tell it apart from the simulator.
//
// Two properties carry over from the simulator on purpose. Each participant gets their own
// private-state record, so the witnesses of a call see only that participant's secret. And a
// refusal is raised while the circuit runs locally, before proving and before submission: a
// fraudulent fill is never built, never paid for and never seen by the chain.
import {
  Contract,
  ledger,
  witnesses,
  withCall,
  type AmpouleCircuit,
  type AmpoulePrivateState,
  type CallInputs,
  type Ledger,
} from '@ampoule/contract';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { rethrowAsRefusal } from '../errors.js';
import { privateStateIdOf } from '../roles.js';
import type { AmpouleBackend, TxReceipt } from '../types.js';
import { NETWORKS, type AmpouleProviders, type ChainNetwork, type NetworkEndpoints } from './providers.js';

type CallTx = (...args: unknown[]) => Promise<{ public: { txId: string; txHash?: string; blockHeight: number } }>;

interface BoundContract {
  callTx: Record<string, CallTx | undefined>;
}

/**
 * The compiled contract with its witnesses and ZK assets. `assetsPath` is a directory (Node) or
 * a URL path (browser) holding `keys/` and `zkir/`; it must match the ZK config provider.
 */
export function compiledAmpoule(assetsPath: string) {
  return CompiledContract.make('ampoule', Contract as never).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(assetsPath as never),
  );
}

export interface NetworkBackendOptions {
  network: ChainNetwork;
  providers: AmpouleProviders;
  /** Same meaning as for `compiledAmpoule`. */
  assetsPath: string;
  endpoints?: Partial<NetworkEndpoints>;
}

export interface DeployOptions extends NetworkBackendOptions {
  /** Key hashes sealed into the contract at deploy time. */
  councilKey: Uint8Array;
  controllerKey: Uint8Array;
  registrarKey: Uint8Array;
  /** Private state the constructor runs under (any participant; the constructor reads none). */
  deployer: AmpoulePrivateState;
}

export class NetworkBackend implements AmpouleBackend {
  readonly kind = 'network' as const;
  readonly network: ChainNetwork;
  readonly contractAddress: string;
  /** The deploy transaction, when this instance deployed the contract. */
  readonly deployTx?: { txId: string; txHash?: string; blockHeight?: number };

  private readonly providers: AmpouleProviders;
  private readonly compiled: ReturnType<typeof compiledAmpoule>;
  private readonly endpoints: NetworkEndpoints;
  private readonly bound = new Map<string, Promise<BoundContract>>();

  private constructor(options: NetworkBackendOptions & { contractAddress: string; deployTx?: NetworkBackend['deployTx'] }) {
    this.network = options.network;
    this.contractAddress = options.contractAddress;
    this.deployTx = options.deployTx;
    this.providers = options.providers;
    this.compiled = compiledAmpoule(options.assetsPath);
    this.endpoints = { ...NETWORKS[options.network], ...options.endpoints };
    this.providers.privateStateProvider.setContractAddress(options.contractAddress);
  }

  /**
   * Deploys a fresh contract. All six verifier keys (about 13 kB) travel in the one deploy
   * transaction, under the per-transaction write limit of a Midnight block.
   */
  static async deploy(options: DeployOptions): Promise<NetworkBackend> {
    const deployed = await deployContract(options.providers as never, {
      compiledContract: compiledAmpoule(options.assetsPath) as never,
      privateStateId: privateStateIdOf(options.deployer),
      initialPrivateState: options.deployer,
      args: [options.councilKey, options.controllerKey, options.registrarKey],
    } as never);
    const data = (deployed as unknown as { deployTxData: { public: { contractAddress: string; txId: string; txHash?: string; blockHeight?: number } } })
      .deployTxData.public;
    return new NetworkBackend({
      ...options,
      contractAddress: data.contractAddress,
      deployTx: { txId: data.txId, txHash: data.txHash, blockHeight: data.blockHeight },
    });
  }

  /** Connects to a contract someone already deployed. */
  static connect(options: NetworkBackendOptions & { contractAddress: string }): NetworkBackend {
    return new NetworkBackend(options);
  }

  async call(persona: AmpoulePrivateState, circuit: AmpouleCircuit, args: unknown[], inputs?: CallInputs): Promise<TxReceipt> {
    const started = Date.now();
    const id = privateStateIdOf(persona);
    const contract = await this.contractFor(id, persona);
    const fn = contract.callTx[circuit];
    if (!fn) throw new Error(`circuit ${circuit} is not exported by the contract`);
    // Witnesses read the private state through the provider, so the per-call inputs are written
    // just before the circuit runs and dropped again afterwards.
    await this.providers.privateStateProvider.set(id, withCall(persona, inputs));
    try {
      const result = await fn(...args);
      return {
        circuit,
        network: this.network,
        durationMs: Date.now() - started,
        txId: result.public.txId,
        txHash: result.public.txHash,
        blockHeight: result.public.blockHeight,
      };
    } catch (error) {
      rethrowAsRefusal(error, circuit);
    } finally {
      await this.providers.privateStateProvider.set(id, withCall(persona, undefined));
    }
  }

  async ledger(): Promise<Ledger> {
    const state = await this.providers.publicDataProvider.queryContractState(this.contractAddress);
    if (!state) throw new Error(`no contract state at ${this.contractAddress}`);
    return ledger(state.data);
  }

  /** Block time of the chain tip, from the indexer. */
  async now(): Promise<bigint> {
    return chainTime(this.endpoints.indexerHttpUrl);
  }

  /** Forgets cached per-participant contract handles. */
  clearCache(): void {
    this.bound.clear();
  }

  private contractFor(id: string, persona: AmpoulePrivateState): Promise<BoundContract> {
    const existing = this.bound.get(id);
    if (existing) return existing;
    const found = findDeployedContract(this.providers as never, {
      compiledContract: this.compiled as never,
      contractAddress: this.contractAddress,
      privateStateId: id,
      initialPrivateState: persona,
    } as never).then((c) => c as unknown as BoundContract);
    // A failed lookup must not poison the cache.
    found.catch(() => this.bound.delete(id));
    this.bound.set(id, found);
    return found;
  }
}

/** Unix seconds of the latest block the indexer has seen. */
export async function chainTime(indexerHttpUrl: string): Promise<bigint> {
  const response = await fetch(indexerHttpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ block { timestamp } }' }),
  });
  if (!response.ok) throw new Error(`indexer returned ${response.status} for the latest block`);
  const body = (await response.json()) as { data?: { block?: { timestamp?: number } } };
  const timestamp = body.data?.block?.timestamp;
  if (timestamp === undefined) throw new Error('indexer returned no block timestamp');
  return BigInt(Math.floor(timestamp / 1000));
}

export interface TxAnchor {
  identifier: string;
  txHash?: string;
  blockHeight?: number;
  blockHash?: string;
  blockTimestamp?: string;
}

/**
 * Resolves midnight-js transaction identifiers to the hashes explorers index by, in one
 * aliased GraphQL query.
 */
export async function resolveTransactions(indexerHttpUrl: string, identifiers: readonly string[]): Promise<Map<string, TxAnchor>> {
  const unique = [...new Set(identifiers.filter(Boolean))];
  const anchors = new Map<string, TxAnchor>(unique.map((identifier) => [identifier, { identifier }]));
  if (unique.length === 0) return anchors;
  const query = `{ ${unique
    .map((id, i) => `t${i}: transactions(offset: {identifier: "${id}"}) { hash block { height hash timestamp } }`)
    .join(' ')} }`;
  const response = await fetch(indexerHttpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) return anchors;
  const body = (await response.json()) as {
    data?: Record<string, Array<{ hash?: string; block?: { height?: number; hash?: string; timestamp?: number } }>>;
  };
  unique.forEach((identifier, i) => {
    const tx = body.data?.[`t${i}`]?.[0];
    if (!tx) return;
    anchors.set(identifier, {
      identifier,
      txHash: tx.hash,
      blockHeight: tx.block?.height,
      blockHash: tx.block?.hash,
      blockTimestamp: tx.block?.timestamp === undefined ? undefined : new Date(tx.block.timestamp).toISOString(),
    });
  });
  return anchors;
}
