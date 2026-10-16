// SPDX-License-Identifier: Apache-2.0
//
// The Preview deployment, from the committed deployment and evidence files, and the same
// public audit the CLI's `verify` runs, done from this browser against the public indexer.
import {
  auditState,
  auditTransactions,
  explorerLink,
  fetchContractActions,
  NETWORKS,
  publicView,
  viewFromJson,
  type AuditCheck,
  type ContractAction,
  type DeploymentFile,
  type Evidence,
  type PublicView,
} from '@ampoule/sdk/core';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicTables } from '../components/PublicTables';
import { shortHash } from '../lib/format';

const deployments = import.meta.glob<DeploymentFile>('../../../cli/deployments/*.json', { eager: true, import: 'default' });
const evidences = import.meta.glob<Evidence>('../../../cli/evidence/*.json', { eager: true, import: 'default' });

const NET = 'preview' as const;
const deployment = Object.values(deployments).find((d) => d.network === NET);
const evidence = Object.entries(evidences)
  .filter(([, e]) => e.network === NET && e.contractAddress === deployment?.contractAddress)
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([, e]) => e)
  .at(-1);

type Run = { state: 'idle' } | { state: 'running'; stage: string } | { state: 'done'; checks: AuditCheck[]; live?: PublicView; actions: ContractAction[] };

/** Decodes the contract's public state with the same libraries the CLI uses, loaded on demand. */
async function liveLedger(address: string) {
  const [{ indexerPublicDataProvider }, { setNetworkId }, { ledger }] = await Promise.all([
    import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),
    import('@midnight-ntwrk/midnight-js-network-id'),
    import('@ampoule/contract'),
  ]);
  setNetworkId(NET);
  // The package's default WebSocket comes from isomorphic-ws, which has no named export in browsers.
  const provider = indexerPublicDataProvider(NETWORKS[NET].indexerHttpUrl, NETWORKS[NET].indexerWsUrl, WebSocket as never);
  const state = await provider.queryContractState(address);
  return state ? ledger(state.data) : undefined;
}

export default function LedgerPage() {
  const [run, setRun] = useState<Run>({ state: 'idle' });

  async function audit() {
    if (!deployment || !evidence) return;
    const checks: AuditCheck[] = [];
    setRun({ state: 'running', stage: 'Downloading every transaction of the contract from the Preview indexer' });
    let actions: ContractAction[] = [];
    try {
      actions = await fetchContractActions(NETWORKS[NET].indexerHttpUrl, deployment.contractAddress);
      checks.push({ name: 'contract exists', ok: actions.length > 0, detail: `${actions.length} actions on ${deployment.contractAddress.slice(0, 12)}…` });
      checks.push(...auditTransactions(deployment, evidence, actions));
    } catch (e) {
      checks.push({ name: 'read the indexer', ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
    setRun({ state: 'running', stage: 'Decoding the public state' });
    let live: PublicView | undefined;
    try {
      const l = await liveLedger(deployment.contractAddress);
      if (l) {
        live = publicView(l);
        checks.push(...auditState(deployment, evidence, l));
      } else checks.push({ name: 'public state', ok: false, detail: 'the indexer has no state at this address' });
    } catch (e) {
      checks.push({
        name: 'public state',
        ok: false,
        detail: `could not decode it in this browser (${e instanceof Error ? e.message : String(e)}). The CLI's verify runs this check.`,
      });
    }
    setRun({ state: 'done', checks, live, actions });
  }

  if (!deployment) {
    return (
      <div className="wrap page">
        <div className="kicker">On chain</div>
        <h1 style={{ marginTop: 10 }}>Midnight Preview</h1>
        <div className="card" style={{ padding: 22, marginTop: 24 }}>
          <h3>The Preview deployment is not published in this build yet.</h3>
          <p className="small" style={{ marginTop: 10 }}>
            The CLI deploys the contract and runs the story with real proofs. To do it yourself, with a funded Preview wallet and a local
            proof server:
          </p>
          <pre className="code-block">{`npm run cli -- wallet new --network preview
npm run cli -- deploy --network preview
npm run cli -- scenario --network preview
npm run cli -- verify --network preview`}</pre>
          <p className="small">
            Meanwhile, the <Link to="/demo">guided demo</Link> runs the same compiled contract in this tab.
          </p>
        </div>
      </div>
    );
  }

  const view = run.state === 'done' && run.live ? run.live : evidence ? viewFromJson(evidence.finalState) : undefined;
  const passed = run.state === 'done' ? run.checks.filter((c) => c.ok).length : 0;

  return (
    <div className="wrap page" data-testid="ledger">
      <div className="kicker">On chain</div>
      <h1 style={{ marginTop: 10 }}>The story, on Midnight Preview</h1>
      <p className="sub">
        The same people and the same attempts as the demo, run by the CLI on Midnight's Preview testnet with real zero-knowledge proofs
        from a local proof server. Every step that landed has a transaction. Every refused attempt has none, because it failed on the
        caller's machine before anything was proven.
      </p>

      <div className="grid2" style={{ marginTop: 26 }}>
        <div className="card" style={{ padding: '18px 20px' }}>
          <h3>Contract</h3>
          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>Address</dt>
            <dd>
              <a className="mono" href={explorerLink(NET, 'contract', deployment.contractAddress)} target="_blank" rel="noreferrer">
                {shortHash(deployment.contractAddress, 12, 8)}
              </a>
            </dd>
            <dt>Deployed</dt>
            <dd>
              {new Date(deployment.deployedAt).toUTCString().replace(' GMT', ' UTC')}
              {deployment.deployTx.blockHeight ? `, block ${deployment.deployTx.blockHeight}` : ''}
            </dd>
            <dt>Deploy tx</dt>
            <dd>
              {deployment.deployTx.txHash ? (
                <a className="mono" href={explorerLink(NET, 'tx', deployment.deployTx.txHash)} target="_blank" rel="noreferrer">
                  {shortHash(deployment.deployTx.txHash, 10, 6)}
                </a>
              ) : (
                <span className="mono">{shortHash(deployment.deployTx.txId, 10, 6)}</span>
              )}
            </dd>
            <dt>Compiler</dt>
            <dd>compactc {deployment.compactVersion}</dd>
          </dl>
        </div>
        <div className="card" style={{ padding: '18px 20px' }}>
          <h3>Check it from this browser</h3>
          <p className="small" style={{ marginTop: 8 }}>
            Downloads every transaction of the contract from the public indexer, compares the call history and the public state with
            the evidence below, and searches the raw bytes of every transaction for the private values the run used. Same code as{' '}
            <code>npm run cli -- verify</code>.
          </p>
          <div className="next-row" style={{ marginTop: 14 }}>
            <button className="btn accent" onClick={() => void audit()} disabled={!evidence || run.state === 'running'} data-testid="audit">
              {run.state === 'done' ? 'Run the checks again' : 'Run the checks'}
            </button>
            {run.state === 'running' && (
              <span className="busy-line">
                <span className="spinner" /> {run.stage}…
              </span>
            )}
            {run.state === 'done' && (
              <span className={`pill ${passed === run.checks.length ? 'green' : 'red'}`} data-testid="audit-result">
                {passed} of {run.checks.length} checks passed
              </span>
            )}
          </div>
        </div>
      </div>

      {run.state === 'done' && (
        <div className="card" style={{ padding: '18px 20px', marginTop: 16 }}>
          <ul className="checks">
            {run.checks.map((c, i) => (
              <li key={i}>
                <span className={`res ${c.ok ? 'pass' : 'fail'}`}>{c.ok ? 'PASS' : 'FAIL'}</span>
                <span>
                  <b>{c.name}</b>: {c.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {evidence && (
        <>
          <h2 style={{ marginTop: 48, fontSize: 30 }}>Every step</h2>
          <p className="sub">
            {evidence.summary.transactions} transactions in blocks {evidence.summary.firstBlock} to {evidence.summary.lastBlock}, and{' '}
            {evidence.summary.refusals.length} attempts the contract refused.
          </p>
          <div className="card" style={{ marginTop: 18, overflowX: 'auto' }}>
            <table className="plain">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Circuit</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {evidence.steps.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.label}
                      <div className="muted small">{s.actor}</div>
                    </td>
                    <td className="mono">{s.circuit}</td>
                    <td>
                      {s.outcome === 'transaction' && s.txHash ? (
                        <a href={explorerLink(NET, 'tx', s.txHash)} target="_blank" rel="noreferrer" className="mono">
                          {shortHash(s.txHash, 8, 4)}
                        </a>
                      ) : s.outcome === 'refused' ? (
                        <span className="pill red">{s.refusal?.code}, no transaction</span>
                      ) : (
                        <span className="pill green">checked off chain</span>
                      )}
                      {s.blockHeight ? <div className="muted small">block {s.blockHeight}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {view && (
            <>
              <h2 style={{ marginTop: 48, fontSize: 30 }}>Public state{run.state === 'done' && run.live ? ', live' : ', at the end of the run'}</h2>
              <PublicTables view={view} />
            </>
          )}

          {evidence.disclosedForAudit && (
            <details className="card disclosed" style={{ marginTop: 32, padding: '16px 20px' }}>
              <summary>
                <b>The private values, disclosed for this audit</b>
              </summary>
              <p className="small" style={{ marginTop: 10 }}>
                {evidence.disclosedForAudit.note}
              </p>
              <table className="plain" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Prescription</th>
                    <th>Drug</th>
                    <th>Quantity</th>
                    <th>Salt</th>
                    <th>Leaf</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.disclosedForAudit.prescriptions.map((p) => (
                    <tr key={p.step}>
                      <td className="mono">{p.step}</td>
                      <td className="mono">{p.drugCode}</td>
                      <td>{p.quantity}</td>
                      <td className="mono">{shortHash(p.salt, 8, 4)}</td>
                      <td className="mono">{shortHash(p.leaf, 8, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </div>
  );
}
