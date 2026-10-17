// SPDX-License-Identifier: Apache-2.0
//
// Live mode: the core of the story on Midnight Preview, from this browser, with a real wallet
// and real proofs. Everything the demo shows in the simulator happens here as transactions.
import { explorerLink, type AuditCheck } from '@ampoule/sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { shortHash } from '../lib/format';
import { clearSave, LiveRun, loadSave, newSave, STEPS, storeSave, type LiveStep, type StepDef } from '../live/run';
import { bridgeFromLocation, bridgeWallet, extensionWallets, LIVE_NETWORK, walletErrorText, type Connected, type WalletChoice } from '../live/wallet';

type Busy = { step: StepDef; since: number } | undefined;

export default function LivePage() {
  const location = useLocation();
  const bridge = useMemo(() => bridgeFromLocation(location.search), [location.search]);
  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  const [connecting, setConnecting] = useState<string>();
  const [run, setRun] = useState<LiveRun>();
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState<Busy>();
  const [error, setError] = useState<string>();
  const [dust, setDust] = useState<bigint>();
  const [audit, setAudit] = useState<{ checks: AuditCheck[] } | 'running'>();
  const stopAll = useRef(false);

  // Extensions inject `window.midnight` after the page loads, so look again for a few seconds.
  useEffect(() => {
    const look = () => setWallets([...extensionWallets(), ...(bridge ? [bridgeWallet(bridge.url, bridge.token)] : [])]);
    look();
    const timers = [300, 1000, 2500].map((ms) => window.setTimeout(look, ms));
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [bridge]);

  async function connect(choice: WalletChoice) {
    setError(undefined);
    setConnecting(choice.id);
    try {
      const wallet: Connected = await choice.connect();
      const save = loadSave() ?? newSave();
      storeSave(save);
      const r = new LiveRun(wallet, save, () => setTick((t) => t + 1));
      await r.init();
      setRun(r);
      setDust(await r.dust());
    } catch (e) {
      setError(walletErrorText(e));
    } finally {
      setConnecting(undefined);
    }
  }

  async function runSteps(all: boolean) {
    if (!run) return;
    setError(undefined);
    stopAll.current = false;
    for (let step = run.next(); step; step = all && !stopAll.current ? run.next() : undefined) {
      setBusy({ step, since: Date.now() });
      try {
        await run.run(step);
      } catch (e) {
        setError(`${step.label}: ${walletErrorText(e)}`);
        break;
      } finally {
        setBusy(undefined);
      }
      setDust(await run.dust());
    }
  }

  async function runAudit() {
    if (!run) return;
    setAudit('running');
    try {
      setAudit({ checks: (await run.audit()).checks });
    } catch (e) {
      setAudit({ checks: [{ name: 'audit', ok: false, detail: walletErrorText(e) }] });
    }
  }

  function startOver() {
    if (!window.confirm('Forget this run and deploy a new contract? The old one stays on chain.')) return;
    clearSave();
    const save = newSave();
    storeSave(save);
    if (run) {
      const r = new LiveRun(run.wallet, save, () => setTick((t) => t + 1));
      void r.init().then(() => setRun(r));
    }
    setAudit(undefined);
  }

  const done = run ? STEPS.filter((s) => run.save.steps[s.id]).length : 0;
  const next = run?.next();

  return (
    <div className="wrap page" data-testid="live">
      <div className="kicker">Live on Midnight Preview</div>
      <h1 style={{ marginTop: 10 }}>Run it yourself, with real proofs</h1>
      <p className="sub">
        This page deploys your own copy of the contract on Midnight's Preview testnet and plays the core of the story on it: a
        prescription, a fill, a second fill of the same prescription, and doctor shopping. Your browser makes a key for every participant,
        so each one acts with only their own secret, exactly as in the <Link to="/demo">demo</Link>. Each step that should land is one
        transaction your wallet balances and submits. The two attempts that must fail are refused here, before anything is proven or
        sent.
      </p>

      <div className="grid2" style={{ marginTop: 26 }}>
        <div className="card" style={{ padding: '18px 20px' }}>
          <h3>1. Connect a wallet</h3>
          {run ? (
            <dl className="kv" style={{ marginTop: 10 }} data-testid="wallet">
              <dt>Wallet</dt>
              <dd>{run.wallet.name}</dd>
              <dt>Address</dt>
              <dd className="mono">{shortHash(run.wallet.address, 14, 6)}</dd>
              <dt>DUST</dt>
              <dd>{dust === undefined ? 'unknown' : dust === 0n ? 'none yet' : 'available for fees'}</dd>
              <dt>Proofs by</dt>
              <dd>{run.provedBy}</dd>
            </dl>
          ) : wallets.length ? (
            <div className="next-row" style={{ marginTop: 14 }}>
              {wallets.map((w) => (
                <button key={w.id} className="btn accent" onClick={() => void connect(w)} disabled={Boolean(connecting)} data-testid={`connect-${w.kind}`}>
                  {w.icon && <img src={w.icon} alt="" width={18} height={18} />}
                  {connecting === w.id ? 'Connecting…' : `Connect ${w.name}`}
                </button>
              ))}
            </div>
          ) : (
            <div className="warn-box" style={{ marginTop: 12 }} data-testid="no-wallet">
              <b>No Midnight wallet in this browser</b>
              Install Lace, switch it to the Preview network, get tNIGHT from the{' '}
              <a href="https://faucet.preview.midnight.network/" target="_blank" rel="noreferrer">
                Preview faucet
              </a>{' '}
              and let it generate DUST, then reload this page.
            </div>
          )}
        </div>

        <div className="card" style={{ padding: '18px 20px' }}>
          <h3>What you need</h3>
          <ul className="small" style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>A DApp Connector 4 wallet on Midnight Preview, such as Lace, with some DUST. Fees here are paid in DUST.</li>
            <li>
              Proving. A wallet that proves does it inside the wallet. Otherwise the page uses the proof server the wallet names, or
              your own on port 6300: <code>docker compose -f proof-server.yml up -d</code>. Whoever proves sees the witnesses, so it
              should be your machine.
            </li>
            <li>About ten minutes. There are 10 transactions, and a fill proof takes up to a minute.</li>
            <li>
              No Lace? Developers can lend this page the CLI's wallet: <code>npm run cli -- bridge</code> prints a link that opens it
              here.
            </li>
          </ul>
        </div>
      </div>

      {error && (
        <div className="no-box" style={{ marginTop: 16 }} data-testid="live-error">
          <b>That did not go through</b>
          {error}
        </div>
      )}

      {run && (
        <div className="card" style={{ padding: '18px 20px', marginTop: 16 }}>
          <div className="live-head">
            <h3>2. The run</h3>
            {run.contractAddress && (
              <a className="mono small" href={explorerLink(LIVE_NETWORK, 'contract', run.contractAddress)} target="_blank" rel="noreferrer" data-testid="live-contract">
                contract {shortHash(run.contractAddress, 10, 6)}
              </a>
            )}
            <span className="pill">
              {done} of {STEPS.length} steps
            </span>
          </div>
          <ol className="live-steps">
            {STEPS.map((s) => (
              <StepRow key={s.id} def={s} rec={run.save.steps[s.id]} busy={busy?.step.id === s.id ? busy : undefined} />
            ))}
          </ol>
          <div className="next-row">
            {next && (
              <>
                <button className="btn accent" onClick={() => void runSteps(false)} disabled={Boolean(busy)} data-testid="live-next">
                  {busy ? 'Working…' : `Run step ${STEPS.indexOf(next) + 1}`}
                </button>
                <button className="btn ghost" onClick={() => void runSteps(true)} disabled={Boolean(busy)} data-testid="live-all">
                  Run all the remaining steps
                </button>
                {busy && (
                  <button className="btn ghost" onClick={() => (stopAll.current = true)}>
                    Stop after this step
                  </button>
                )}
              </>
            )}
            {!next && (
              <button className="btn accent" onClick={() => void runAudit()} disabled={audit === 'running'} data-testid="live-audit">
                {audit === 'running' ? 'Auditing…' : 'Audit your contract'}
              </button>
            )}
            <button className="btn ghost" onClick={startOver} disabled={Boolean(busy)}>
              Start over with a new contract
            </button>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>
            The participants' keys and the prescriptions are kept in this browser's storage so a reload can resume. They are testnet
            personas made for this run.
          </p>
        </div>
      )}

      {audit && audit !== 'running' && (
        <div className="card" style={{ padding: '18px 20px', marginTop: 16 }} data-testid="live-audit-result">
          <h3>3. The public audit of your contract</h3>
          <p className="small" style={{ marginTop: 6 }}>
            The same checks as the <Link to="/ledger">on-chain page</Link> and <code>npm run cli -- verify</code>, run on what this
            browser just did.
          </p>
          <ul className="checks" style={{ marginTop: 12 }}>
            {audit.checks.map((c, i) => (
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
    </div>
  );
}

function StepRow({ def, rec, busy }: { def: StepDef; rec?: LiveStep; busy?: { since: number } }) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!busy) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [busy]);
  const state = busy ? 'busy' : rec ? (rec.outcome === 'refused' ? 'refused' : 'done') : 'todo';
  return (
    <li className={`live-step ${state}`} data-testid={`live-step-${def.id}`} data-state={state}>
      <div>
        <b>{def.label}</b>
        <div className="small muted">
          {def.actor} · <span className="mono">{def.circuit}</span> · {def.why}
        </div>
        {rec?.scan && (
          <div className={`small ${rec.scan.found.length ? 'no-box' : 'ok-box'} scan-line`} data-testid="live-scan" data-leaks={rec.scan.found.length}>
            Searched the {rec.scan.rawBytes.toLocaleString()} bytes of this transaction for {rec.scan.searched.join(', ')}:{' '}
            {rec.scan.found.length ? <b>found {rec.scan.found.join(', ')}</b> : 'none found.'}
            {rec.scan.controls.length > 0 &&
              ` Public on purpose, and found: ${rec.scan.controls.filter((c) => c.found).map((c) => c.value).join(', ') || 'none'}.`}
          </div>
        )}
      </div>
      <div className="live-result">
        {busy && (
          <span className="busy-line">
            <span className="spinner" /> {def.kind === 'refused' ? 'checking' : 'proving, then your wallet'} ·{' '}
            {Math.round((Date.now() - busy.since) / 1000)}s
          </span>
        )}
        {rec?.outcome === 'transaction' &&
          (rec.explorer ? (
            <a className="mono" href={rec.explorer} target="_blank" rel="noreferrer">
              {shortHash(rec.txHash ?? rec.txId ?? '', 8, 4)}
            </a>
          ) : (
            <span className="mono">{shortHash(rec.txId ?? '', 8, 4)}</span>
          ))}
        {rec?.outcome === 'transaction' && (
          <div className="small muted">
            {rec.blockHeight ? `block ${rec.blockHeight}, ` : ''}
            {(rec.durationMs / 1000).toFixed(0)}s
          </div>
        )}
        {rec?.outcome === 'refused' && (
          <span className="pill red" data-testid="live-refused" data-code={rec.refusal?.code}>
            {rec.refusal?.code}, nothing sent
          </span>
        )}
        {rec?.outcome === 'checked' && <span className="pill green">matches the record</span>}
      </div>
    </li>
  );
}
