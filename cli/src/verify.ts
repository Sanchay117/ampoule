// SPDX-License-Identifier: Apache-2.0
//
// The check anyone can run: no wallet, no keys, no proof server, just the public indexer.
//
//   npm run cli -- verify --network preview
//
// It reads the deployed contract back and runs the audit in `@ampoule/sdk` (audit.ts) against
// the newest evidence file. The web app's "On chain" page runs the same checks in a browser.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { ledger } from '@ampoule/contract';
import {
  auditState,
  auditTransactions,
  fetchContractActions,
  NETWORKS,
  type AuditCheck,
  type ChainNetwork,
  type DeploymentFile,
  type Evidence,
} from '@ampoule/sdk';
import { WebSocket } from 'ws';
import { deploymentPath, EVIDENCE_DIR, fail, flag, heading, network, readJson, say, UsageError, type Args } from './common.js';

export function newestEvidence(n: ChainNetwork): string | undefined {
  if (!existsSync(EVIDENCE_DIR)) return undefined;
  const names = readdirSync(EVIDENCE_DIR)
    .filter((f) => f.startsWith(`${n}-`) && f.endsWith('.json'))
    .sort();
  return names.length ? join(EVIDENCE_DIR, names.at(-1)!) : undefined;
}

export async function verify(args: Args): Promise<number> {
  const n = network(args);
  if (!existsSync(deploymentPath(n))) throw new UsageError(`no deployment file for ${n}`);
  const deployment = readJson<DeploymentFile>(deploymentPath(n));
  const evidencePath = flag(args, 'evidence') ?? newestEvidence(n);
  if (!evidencePath) throw new UsageError(`no evidence for ${n}; run the scenario first`);
  const evidence = readJson<Evidence>(evidencePath);
  const endpoints = NETWORKS[n];
  const checks: AuditCheck[] = [];

  heading(`verifying ${deployment.contractAddress} on ${n}`);
  say(`  evidence ${evidencePath}`);

  setNetworkId(n as NetworkId);
  const provider = indexerPublicDataProvider(endpoints.indexerHttpUrl, endpoints.indexerWsUrl, WebSocket as never);
  const state = await provider.queryContractState(deployment.contractAddress);
  checks.push({ name: 'contract exists', ok: !!state, detail: state ? deployment.contractAddress : 'the indexer has no state at this address' });
  if (!state) return report(checks);

  checks.push(...auditState(deployment, evidence, ledger(state.data)));
  checks.push(...auditTransactions(deployment, evidence, await fetchContractActions(endpoints.indexerHttpUrl, deployment.contractAddress)));
  return report(checks);
}

function report(checks: AuditCheck[]): number {
  say('');
  for (const c of checks) say(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.ok).length;
  if (failed) fail(`\n${failed} of ${checks.length} checks failed`);
  else say(`\nall ${checks.length} checks passed`);
  return failed ? 1 : 0;
}
