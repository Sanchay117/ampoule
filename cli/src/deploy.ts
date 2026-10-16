// SPDX-License-Identifier: Apache-2.0
//
// Deploys Ampoule. The constructor seals three key hashes (council, controller, registrar) into
// the contract; all six verifier keys travel in the same transaction. The deployment file
// records the address and the deploy transaction with explorer links, and is committed.
import { existsSync } from 'node:fs';
import {
  EXPLORERS,
  hex,
  NetworkBackend,
  publicKeyOf,
  publicView,
  type ChainNetwork,
} from '@ampoule/sdk';
import {
  COMPACT_VERSION,
  deploymentPath,
  hasFlag,
  heading,
  loadOrCreateCast,
  network,
  note,
  say,
  secret,
  UsageError,
  writeJson,
  type Args,
} from './common.js';
import { openSession } from './session.js';

export interface DeploymentFile {
  project: 'ampoule';
  network: ChainNetwork;
  contractAddress: string;
  deployTx: { txId: string; txHash?: string; blockHeight?: number };
  deployedAt: string;
  compactVersion: string;
  /** The key hashes sealed at deploy time. Public by design. */
  sealed: { council: string; controller: string; registrar: string };
  explorer?: { contract: string; deployTx?: string };
}

export const explorerLink = (n: ChainNetwork, kind: 'tx' | 'contract' | 'block', value: string | number | undefined): string | undefined => {
  const t = EXPLORERS[n]?.[kind];
  if (!t || value === undefined) return undefined;
  return t.replace(/\{txHash\}|\{address\}|\{height\}/, String(value));
};

export async function deploy(args: Args): Promise<number> {
  const n = network(args);
  const path = deploymentPath(n);
  if (existsSync(path) && !hasFlag(args, 'force')) throw new UsageError(`${path} exists; pass --force to deploy a new contract`);
  const cast = loadOrCreateCast(n);
  const session = await openSession(args, n);
  try {
    heading(`deploying Ampoule to ${n}`);
    const sealed = {
      council: publicKeyOf('council', secret(cast.council)),
      controller: publicKeyOf('controller', secret(cast.controller)),
      registrar: publicKeyOf('registrar', secret(cast.registrar)),
    };
    note('proving and submitting the deploy transaction');
    const backend = await NetworkBackend.deploy({
      network: n,
      providers: session.providers,
      assetsPath: session.assets,
      councilKey: sealed.council,
      controllerKey: sealed.controller,
      registrarKey: sealed.registrar,
      deployer: { role: 'council', secretKey: secret(cast.council) },
    });
    const tx = backend.deployTx ?? { txId: session.submitted[0] ?? '' };
    const file: DeploymentFile = {
      project: 'ampoule',
      network: n,
      contractAddress: backend.contractAddress,
      deployTx: tx,
      deployedAt: new Date().toISOString(),
      compactVersion: COMPACT_VERSION,
      sealed: { council: hex(sealed.council), controller: hex(sealed.controller), registrar: hex(sealed.registrar) },
      explorer: EXPLORERS[n]
        ? { contract: explorerLink(n, 'contract', backend.contractAddress)!, deployTx: explorerLink(n, 'tx', tx.txHash) }
        : undefined,
    };
    writeJson(path, file);

    const view = publicView(await backend.ledger());
    heading('deployed');
    say(`  contract   ${file.contractAddress}`);
    say(`  deploy tx  ${tx.txId}${tx.blockHeight ? ` (block ${tx.blockHeight})` : ''}`);
    if (file.explorer) say(`  explorer   ${file.explorer.contract}`);
    say(`  read back through the indexer: council ${view.authorities.council.slice(0, 16)}..., ${view.doctors.length} doctors, ${view.totals.issued} prescriptions`);
    say(`\nwritten to ${path}\nnext: npm run cli -- scenario --network ${n}`);
    return 0;
  } finally {
    await session.close();
  }
}
