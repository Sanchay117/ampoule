// SPDX-License-Identifier: Apache-2.0
//
// The public audit of a deployment, shared by `npm run cli -- verify` and the web page that
// runs the same checks in a browser. Inputs are the committed deployment and evidence files
// and what the public indexer returns; no key, wallet or proof server is involved.
//
// The checks:
//   1. the public state on chain is exactly the state the scenario ended with;
//   2. the contract's call history is exactly the transactions the scenario reports, so the
//      refused attempts left nothing behind;
//   3. every prescription in the audit disclosure really was issued (its hash is in the tree);
//   4. none of those prescriptions' private fields, and no patient key, occurs anywhere in the
//      raw bytes of any transaction of the contract, while public values (licence ids) do.
import type { Ledger } from '@ampoule/contract';
import { fromHex, hex } from './bytes.js';
import type { ChainNetwork } from './networks.js';
import { publicView, viewToJson } from './view.js';

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

export interface StepRecord {
  id: string;
  label: string;
  actor: string;
  circuit: string;
  outcome: 'transaction' | 'refused' | 'checked';
  txId?: string;
  txHash?: string;
  blockHeight?: number;
  explorer?: string;
  refusal?: { code: string; explanation: string };
  /** Off-chain checks (the pharmacist's), with what they found. */
  detail?: Record<string, unknown>;
  durationMs: number;
  at: string;
}

export interface Evidence {
  project: 'ampoule';
  network: ChainNetwork;
  contractAddress: string;
  compactVersion: string;
  startedAt: string;
  finishedAt: string;
  explorer?: DeploymentFile['explorer'];
  deployTx: DeploymentFile['deployTx'];
  steps: StepRecord[];
  summary: { transactions: number; refusals: Array<{ id: string; code: string }>; firstBlock: number; lastBlock: number };
  finalState: unknown;
  disclosedForAudit?: {
    note: string;
    patients: Array<{ name: string; patientKey: string }>;
    prescriptions: Array<{
      step: string;
      drugCode: string;
      patient: string;
      doctor: string;
      quantity: string;
      drugClass: string;
      fills: string;
      notAfter: string;
      salt: string;
      leaf: string;
    }>;
    dispenseSalts: Array<{ step: string; salt: string }>;
    /** Public values the raw-transaction search must find, proving the search works. */
    publicControls: string[];
  };
}

export interface ContractAction {
  __typename: 'ContractDeploy' | 'ContractCall' | 'ContractUpdate';
  entryPoint?: string;
  transaction: { hash: string; raw: string; block: { height: number; timestamp?: number } };
}

export interface AuditCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** Every action on a contract, with each transaction's raw bytes, from the public indexer. */
export async function fetchContractActions(indexerHttpUrl: string, address: string): Promise<ContractAction[]> {
  if (!/^[0-9a-fA-F]+$/.test(address)) throw new Error('a contract address is hex');
  const query = `{ contract(address: "${address}") { actions { __typename ... on ContractCall { entryPoint } transaction { hash raw block { height timestamp } } } } }`;
  const r = await fetch(indexerHttpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  if (!r.ok) throw new Error(`indexer returned ${r.status}`);
  const body = (await r.json()) as { data?: { contract?: { actions?: ContractAction[] } }; errors?: unknown };
  if (body.errors) throw new Error(`indexer error: ${JSON.stringify(body.errors).slice(0, 200)}`);
  return body.data?.contract?.actions ?? [];
}

/** Significant bytes of a value as lower-case hex: trailing zero padding removed. */
export const needle = (b: Uint8Array): string => hex(b).replace(/(?:00)+$/, '');

/** The private values an evidence file discloses for audit, by name. */
export function auditSecrets(evidence: Evidence): Array<[string, Uint8Array]> {
  const audit = evidence.disclosedForAudit;
  if (!audit) return [];
  return [
    ...audit.patients.map((p): [string, Uint8Array] => [`${p.name}'s patient key`, fromHex(p.patientKey)]),
    ...audit.prescriptions.flatMap((rx): Array<[string, Uint8Array]> => [
      [`${rx.step} drug code (${rx.drugCode})`, new TextEncoder().encode(rx.drugCode)],
      [`${rx.step} salt`, fromHex(rx.salt)],
      [`${rx.step} leaf`, fromHex(rx.leaf)],
    ]),
    ...audit.dispenseSalts.map((d): [string, Uint8Array] => [`${d.step} dispense salt`, fromHex(d.salt)]),
  ];
}

/** Checks 1 and 3: public state, sealed keys, issued prescriptions. Needs the decoded ledger. */
export function auditState(deployment: DeploymentFile, evidence: Evidence, l: Ledger): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const onChain = JSON.stringify(viewToJson(publicView(l)));
  const same = onChain === JSON.stringify(evidence.finalState);
  checks.push({
    name: 'public state matches the evidence',
    ok: same,
    detail: same ? 'every doctor, pharmacy, policy, fill record and counter' : 'state differs (has the contract been used since?)',
  });
  checks.push({
    name: 'sealed authority keys',
    ok:
      hex(l.council) === deployment.sealed.council &&
      hex(l.controller) === deployment.sealed.controller &&
      hex(l.registrar) === deployment.sealed.registrar,
    detail: 'council, controller and registrar key hashes as deployed',
  });
  for (const rx of evidence.disclosedForAudit?.prescriptions ?? []) {
    const issued = l.prescriptions.findPathForLeaf(fromHex(rx.leaf)) !== undefined;
    checks.push({ name: `${rx.step}: issued`, ok: issued, detail: issued ? 'its hash is in the prescription tree' : 'not in the tree' });
  }
  return checks;
}

/** Checks 2 and 4: call history and the raw-transaction search. Needs only the indexer. */
export function auditTransactions(deployment: DeploymentFile, evidence: Evidence, actions: ContractAction[]): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const calls = actions.filter((a) => a.__typename === 'ContractCall');
  const reported = evidence.steps.filter((s) => s.outcome === 'transaction');
  const byHash = new Map(calls.map((a) => [a.transaction.hash, a]));
  const missing = reported.filter((s) => !s.txHash || byHash.get(s.txHash)?.entryPoint !== s.circuit);
  checks.push({
    name: 'every reported transaction is on chain',
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.map((s) => s.id).join(', ')}` : `${reported.length} transactions, each with the circuit it claims`,
  });
  checks.push({
    name: 'no other calls exist',
    ok: calls.length === reported.length,
    detail: `${calls.length} calls on chain, ${reported.length} in the evidence; the ${evidence.summary.refusals.length} refused attempts left no transaction`,
  });
  const deploys = actions.filter((a) => a.__typename === 'ContractDeploy');
  checks.push({
    name: 'deploy transaction',
    ok: deploys.length === 1 && (!deployment.deployTx.txHash || deploys[0]!.transaction.hash === deployment.deployTx.txHash),
    detail: deploys[0] ? `block ${deploys[0].transaction.block.height}` : 'not found',
  });

  const audit = evidence.disclosedForAudit;
  if (!audit) {
    checks.push({ name: 'audit disclosure', ok: false, detail: 'the evidence file has no disclosedForAudit section' });
    return checks;
  }
  const raw = actions.map((a) => a.transaction.raw.toLowerCase());
  const occurs = (b: Uint8Array) => raw.filter((r) => r.includes(needle(b))).length;
  const secrets = auditSecrets(evidence);
  const leaks = secrets.filter(([, v]) => occurs(v) > 0);
  checks.push({
    name: `no private value in ${raw.length} raw transactions`,
    ok: leaks.length === 0,
    detail: leaks.length
      ? `found: ${leaks.map(([k]) => k).join(', ')}`
      : `searched ${secrets.length} values (patient keys, drug codes, salts, leaves): none present`,
  });
  // Positive control: public values are found, so the search itself works.
  const controls = audit.publicControls.map((c): [string, number] => [c, occurs(new TextEncoder().encode(c))]);
  checks.push({
    name: 'control: public licence ids are found',
    ok: controls.every(([, k]) => k > 0),
    detail: controls.map(([c, k]) => `${c} in ${k} txs`).join(', '),
  });
  return checks;
}
