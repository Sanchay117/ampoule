// SPDX-License-Identifier: Apache-2.0
//
// Endpoints and explorer links per network. Plain data, so a page can link to the explorer
// without loading the wallet and proof stack.

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

export const explorerLink = (n: ChainNetwork, kind: 'tx' | 'contract' | 'block', value: string | number | undefined): string | undefined => {
  const t = EXPLORERS[n]?.[kind];
  if (!t || value === undefined) return undefined;
  return t.replace(/\{txHash\}|\{address\}|\{height\}/, String(value));
};
