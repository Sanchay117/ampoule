// SPDX-License-Identifier: Apache-2.0
//
// The check anyone can run: no wallet, no keys, no proof server, just the public indexer.
//
//   npm run cli -- verify --network preview
//
// It reads the deployed contract back and asserts four things against the newest evidence file:
//   1. the public state on chain is exactly the state the scenario ended with;
//   2. the contract's call history is exactly the transactions the scenario reports, so the
//      refused attempts left nothing behind;
//   3. every prescription in the audit disclosure really was issued (its hash is in the tree);
//   4. none of those prescriptions' private fields, and no patient key, occurs anywhere in the
//      raw bytes of any transaction of the contract, while public values (licence ids) do.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { ledger } from '@ampoule/contract';
import { fromHex, hex, NETWORKS, publicView, viewToJson, type ChainNetwork } from '@ampoule/sdk';
import { WebSocket } from 'ws';
import { deploymentPath, EVIDENCE_DIR, fail, flag, heading, network, readJson, say, UsageError, type Args } from './common.js';
import type { DeploymentFile } from './deploy.js';
import type { Evidence } from './scenario.js';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface Action {
  __typename: 'ContractDeploy' | 'ContractCall' | 'ContractUpdate';
  entryPoint?: string;
  transaction: { hash: string; raw: string; block: { height: number } };
}

export function newestEvidence(n: ChainNetwork): string | undefined {
  if (!existsSync(EVIDENCE_DIR)) return undefined;
  const names = readdirSync(EVIDENCE_DIR)
    .filter((f) => f.startsWith(`${n}-`) && f.endsWith('.json'))
    .sort();
  return names.length ? join(EVIDENCE_DIR, names.at(-1)!) : undefined;
}

async function contractActions(indexer: string, address: string): Promise<Action[]> {
  const query = `{ contract(address: "${address}") { actions { __typename ... on ContractCall { entryPoint } transaction { hash raw block { height } } } } }`;
  const r = await fetch(indexer, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  if (!r.ok) throw new Error(`indexer returned ${r.status}`);
  const body = (await r.json()) as { data?: { contract?: { actions?: Action[] } }; errors?: unknown };
  if (body.errors) throw new Error(`indexer error: ${JSON.stringify(body.errors).slice(0, 200)}`);
  return body.data?.contract?.actions ?? [];
}

/** Significant bytes of a value as lower-case hex: trailing zero padding removed. */
const needle = (b: Uint8Array): string => hex(b).replace(/(?:00)+$/, '');

export async function verify(args: Args): Promise<number> {
  const n = network(args);
  if (!existsSync(deploymentPath(n))) throw new UsageError(`no deployment file for ${n}`);
  const deployment = readJson<DeploymentFile>(deploymentPath(n));
  const evidencePath = flag(args, 'evidence') ?? newestEvidence(n);
  if (!evidencePath) throw new UsageError(`no evidence for ${n}; run the scenario first`);
  const evidence = readJson<Evidence>(evidencePath);
  const endpoints = NETWORKS[n];
  const checks: Check[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  heading(`verifying ${deployment.contractAddress} on ${n}`);
  say(`  evidence ${evidencePath}`);

  // 1. Public state.
  setNetworkId(n as NetworkId);
  const provider = indexerPublicDataProvider(endpoints.indexerHttpUrl, endpoints.indexerWsUrl, WebSocket as never);
  const state = await provider.queryContractState(deployment.contractAddress);
  if (!state) {
    push('contract exists', false, 'the indexer has no state at this address');
    return report(checks);
  }
  push('contract exists', true, deployment.contractAddress);
  const l = ledger(state.data);
  const onChain = JSON.stringify(viewToJson(publicView(l)));
  push('public state matches the evidence', onChain === JSON.stringify(evidence.finalState), onChain === JSON.stringify(evidence.finalState) ? 'every doctor, pharmacy, policy, fill record and counter' : 'state differs (has the contract been used since?)');
  push('sealed authority keys', hex(l.council) === deployment.sealed.council && hex(l.controller) === deployment.sealed.controller && hex(l.registrar) === deployment.sealed.registrar, 'council, controller and registrar key hashes as deployed');

  // 2. Call history.
  const actions = await contractActions(endpoints.indexerHttpUrl, deployment.contractAddress);
  const calls = actions.filter((a) => a.__typename === 'ContractCall');
  const reported = evidence.steps.filter((s) => s.outcome === 'transaction');
  const byHash = new Map(calls.map((a) => [a.transaction.hash, a]));
  const missing = reported.filter((s) => !s.txHash || byHash.get(s.txHash)?.entryPoint !== s.circuit);
  push('every reported transaction is on chain', missing.length === 0, missing.length ? `missing: ${missing.map((s) => s.id).join(', ')}` : `${reported.length} transactions, each with the circuit it claims`);
  push('no other calls exist', calls.length === reported.length, `${calls.length} calls on chain, ${reported.length} in the evidence; the ${evidence.summary.refusals.length} refused attempts left no transaction`);
  const deploys = actions.filter((a) => a.__typename === 'ContractDeploy');
  push('deploy transaction', deploys.length === 1 && (!deployment.deployTx.txHash || deploys[0]!.transaction.hash === deployment.deployTx.txHash), deploys[0] ? `block ${deploys[0].transaction.block.height}` : 'not found');

  // 3 and 4. The audit disclosure.
  const audit = evidence.disclosedForAudit;
  if (audit) {
    const raw = actions.map((a) => a.transaction.raw.toLowerCase());
    const occurs = (b: Uint8Array) => raw.filter((r) => r.includes(needle(b))).length;
    for (const rx of audit.prescriptions) {
      const issued = l.prescriptions.findPathForLeaf(fromHex(rx.leaf)) !== undefined;
      push(`${rx.step}: issued`, issued, issued ? 'its hash is in the prescription tree' : 'not in the tree');
    }
    const secrets: Array<[string, Uint8Array]> = [
      ...audit.patients.map((p): [string, Uint8Array] => [`${p.name}'s patient key`, fromHex(p.patientKey)]),
      ...audit.prescriptions.flatMap((rx): Array<[string, Uint8Array]> => [
        [`${rx.step} drug code (${rx.drugCode})`, new TextEncoder().encode(rx.drugCode)],
        [`${rx.step} salt`, fromHex(rx.salt)],
        [`${rx.step} leaf`, fromHex(rx.leaf)],
      ]),
      ...audit.dispenseSalts.map((d): [string, Uint8Array] => [`${d.step} dispense salt`, fromHex(d.salt)]),
    ];
    const leaks = secrets.filter(([, v]) => occurs(v) > 0);
    push(
      `no private value in ${raw.length} raw transactions`,
      leaks.length === 0,
      leaks.length ? `found: ${leaks.map(([k]) => k).join(', ')}` : `searched ${secrets.length} values (patient keys, drug codes, salts, leaves): none present`,
    );
    // Positive control: public values are found, so the search itself works.
    const licence = audit.publicControls.map((c): [string, number] => [c, occurs(new TextEncoder().encode(c))]);
    push('control: public licence ids are found', licence.every(([, k]) => k > 0), licence.map(([c, k]) => `${c} in ${k} txs`).join(', '));
  } else {
    push('audit disclosure', false, 'the evidence file has no disclosedForAudit section');
  }

  return report(checks);
}

function report(checks: Check[]): number {
  say('');
  for (const c of checks) say(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.ok).length;
  if (failed) fail(`\n${failed} of ${checks.length} checks failed`);
  else say(`\nall ${checks.length} checks passed`);
  return failed ? 1 : 0;
}
