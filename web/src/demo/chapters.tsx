// SPDX-License-Identifier: Apache-2.0
//
// The guided demo, one chapter per idea. Each stage shows the screens of the people involved;
// every button runs the real circuit through the SDK, and the chain panel beside it shows what
// that call published.
import {
  className,
  decodeCounter,
  decodeRx,
  hex,
  labelOf,
  quantityText,
  type DispenseCheck,
  type RxStatus,
} from '@ampoule/sdk/core';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { COLORS, Device } from '../components/Device';
import { PublicTables } from '../components/PublicTables';
import { Qr } from '../components/Qr';
import { RxCard } from '../components/RxCard';
import type { LogEntry, PatientPerson } from '../lib/demo';
import { shortHash, utcDate, utcTime } from '../lib/format';
import type { Counter, FillAttempt, Story, StoryState } from './story';
import { useStory } from './useStory';

export interface Chapter {
  id: string;
  title: string;
  kicker: string;
  story: ReactNode;
  pub: ReactNode;
  priv: ReactNode;
  done: (s: StoryState) => boolean;
  /** The call the chain panel shows when this chapter is opened after it was played. */
  focus?: (s: StoryState) => LogEntry | undefined;
  /** Runs this chapter's steps without clicks, for "skip ahead" and the end-to-end tests. */
  autoplay: (story: Story) => Promise<void>;
  Stage: () => JSX.Element;
}

// ------------------------------------------------------------------------------ small parts

function Busy({ when }: { when: boolean }) {
  const story = useStory();
  if (!when || !story.busy) return null;
  return (
    <div className="busy-line" role="status">
      <span className="spinner" /> {story.busy}…
    </div>
  );
}

function Step({ onClick, children, kind = '', disabled, testId }: { onClick: () => void; children: ReactNode; kind?: string; disabled?: boolean; testId?: string }) {
  const story = useStory();
  return (
    <button className={`btn ${kind}`} onClick={onClick} disabled={disabled || !!story.busy} data-testid={testId}>
      {children}
    </button>
  );
}

function TokenText({ token, against }: { token: string; against?: string }) {
  const chars = [...token];
  return (
    <div className="token-text" title={token}>
      {against
        ? chars.map((c, i) => (c === against[i] ? c : <mark key={i}>{c}</mark>))
        : token.length > 64
          ? `${token.slice(0, 40)}…${token.slice(-16)}`
          : token}
    </div>
  );
}

export function Refused({ entry }: { entry?: LogEntry }) {
  if (!entry || entry.outcome !== 'refused' || !entry.refusal) return null;
  return (
    <div className="no-box" data-testid="refused" data-code={entry.refusal.code}>
      <b>Refused on this phone</b>
      <span className="code-tag">{entry.refusal.code}</span>
      <div style={{ marginTop: 4 }}>{entry.refusal.explanation}</div>
    </div>
  );
}

function CheckResult({ check, attempt }: { check?: DispenseCheck; attempt: FillAttempt }) {
  if (!check) return null;
  if (!check.ok) {
    return (
      <div className="warn-box" data-testid="check" data-ok="false">
        <b>Nothing to hand over</b>
        {check.message}
      </div>
    );
  }
  return (
    <div className="ok-box" data-testid="check" data-ok="true">
      <b>Matches the fill record. Hand it over.</b>
      {check.drug ? `${check.drug.name} ${check.drug.strength}` : labelOf(check.drugCode)}, {quantityText(check.drug, check.quantity)}
      <div style={{ marginTop: 6, fontSize: 12.5 }}>
        Prescribed by <span className="mono">{labelOf(check.doctor)}</span>, {className(check.drugClass).toLowerCase()}. Proof valid
        before {utcTime(check.validBefore)}. Nothing on this screen says who the patient is.
      </div>
    </div>
  );
}

function PatientStatus({ patient, token }: { patient: PatientPerson; token: string }) {
  const story = useStory();
  const version = story.snapshot();
  const [st, setSt] = useState<RxStatus>();
  useEffect(() => {
    let live = true;
    story
      .status(patient, token)
      .then((s) => live && setSt(s))
      .catch(() => live && setSt(undefined));
    return () => {
      live = false;
    };
  }, [story, patient, token, version]);
  if (!st) return null;
  return (
    <div className="status-box" data-testid="status">
      <div>
        <b>
          {st.fillsUsed >= st.fillsTotal ? 'Filled' : st.fillsUsed === 0 ? 'Not filled yet' : 'Partly filled'}, {st.fillsUsed} of{' '}
          {st.fillsTotal}
        </b>
        {!st.doctorActive && <span className="pill red">prescriber suspended</span>}
      </div>
      {st.cap && (
        <div>
          {className(decodeRx(token).drugClass)} cap: {st.cap.used} of {st.cap.max} used this window, which ends{' '}
          {utcDate(st.cap.windowEndsAt)}
        </div>
      )}
      <small>Worked out on this phone from public nullifiers that only this phone can compute.</small>
    </div>
  );
}

function CounterScreen({ counter, attempt, onNew, onCheck, testId }: { counter?: Counter; attempt?: FillAttempt; onNew?: () => void; onCheck?: () => void; testId?: string }) {
  if (!counter) {
    return (
      <>
        <p className="device-empty">The counter is free.</p>
        {onNew && (
          <Step onClick={onNew} testId={testId ? `${testId}-new` : undefined}>
            Next customer: show a counter request
          </Step>
        )}
      </>
    );
  }
  const req = decodeCounter(counter.token);
  return (
    <>
      {!attempt && (
        <>
          <Qr value={counter.token} caption="Counter request: this pharmacy and a fresh one-time challenge" />
          <div className="state-line muted">
            Challenge <span className="hash">{shortHash(hex(req.challenge))}</span>. A fill record can be written under it once.
          </div>
        </>
      )}
      {attempt && attempt.entry.outcome === 'published' && !attempt.check && onCheck && (
        <>
          <div className="state-line">A fill record appeared on chain under this counter request.</div>
          <Step onClick={onCheck} kind="accent" testId={testId ? `${testId}-check` : undefined}>
            Scan the patient's screen and check it
          </Step>
        </>
      )}
      {attempt && attempt.entry.outcome === 'refused' && (
        <div className="warn-box">
          <b>No fill arrived</b>
          Nothing is recorded under this counter request, so there is nothing to hand over. This screen does not learn why.
        </div>
      )}
      {attempt?.check && attempt.entry.outcome === 'published' && <CheckResult check={attempt.check} attempt={attempt} />}
    </>
  );
}

export const chapterPath = (index: number) => `/demo/${CHAPTERS[index]?.id ?? ''}`;

export const chapterIndexOf = (id: string | undefined) => Math.max(0, CHAPTERS.findIndex((c) => c.id === id));

function Next({ to, label }: { to: number; label: string }) {
  const navigate = useNavigate();
  return (
    <div className="next-row">
      <button className="btn" onClick={() => navigate(chapterPath(to))} data-testid="next">
        Next: {label} <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------- 1. the network

function NetworkStage() {
  const story = useStory();
  const w = story.world;
  const done = !!story.s.setUp;
  const tick = (ok: boolean) => <span className={`tick ${ok ? 'on' : ''}`}>{ok ? '✓' : ''}</span>;
  return (
    <>
      <div className="devices">
        <Device name="Medical council" sub="Licenses and suspends doctors" what="authority" color={COLORS.council}>
          <ul className="todo">
            <li>{tick(done)} License {w.rao.name}, {w.rao.licence}</li>
            <li>{tick(done)} License {w.mehta.name}, {w.mehta.licence}</li>
          </ul>
        </Device>
        <Device name="Drug controller" sub="Licenses pharmacies, sets caps" what="authority" color={COLORS.council}>
          <ul className="todo">
            <li>{tick(done)} Cap opioid analgesics at 1 fill per person per 30 days</li>
            <li>{tick(done)} Cap benzodiazepines at 1 fill per person per 30 days</li>
            <li>{tick(done)} License {w.lotus.name}, {w.lotus.licence}</li>
            <li>{tick(done)} License {w.neem.name}, {w.neem.licence}</li>
          </ul>
        </Device>
        <Device name="Health ID registrar" sub="Checks ID once, enrolls one key" what="authority" color={COLORS.council}>
          <ul className="todo">
            <li>{tick(done)} Enroll Ravi's patient key</li>
            <li>{tick(done)} Enroll Meera's patient key</li>
          </ul>
          <p className="muted small">
            The key comes from the patient's own phone. The registrar sees ID papers off chain and publishes only a hash of the
            key.
          </p>
        </Device>
      </div>
      <div className="next-row">
        {!done && (
          <Step onClick={story.setUpNetwork} kind="accent" testId="setup">
            Run the 8 setup transactions
          </Step>
        )}
        <Busy when={!done} />
        {done && <p className="muted small">Each setup call is in the chain panel. Click one in its list to see the operations it published.</p>}
      </div>
      {done && <Next to={1} label="Dr Rao writes a prescription" />}
    </>
  );
}

// ---------------------------------------------------------------------- 2. the prescription

function PrescriptionStage() {
  const story = useStory();
  const { rao, ravi } = story.world;
  const rx = story.s.raoRx;
  return (
    <>
      <div className="devices">
        <Device name={rao.name} sub={`${rao.role}, ${rao.city} · ${rao.licence}`} what="clinic" color={COLORS.rao} wide>
          {!rx ? (
            <>
              <div className="form">
                <label className="field">
                  Patient
                  <input readOnly value={`Ravi, patient key ${shortHash(hex(ravi.client.publicKey))}`} />
                </label>
                <label className="field">
                  Medicine
                  <input readOnly value="Tramadol 50 mg tablet (opioid analgesic)" />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label className="field">
                    Quantity
                    <input readOnly value="10 tablets" />
                  </label>
                  <label className="field">
                    Valid for
                    <input readOnly value="30 days, one fill" />
                  </label>
                </div>
              </div>
              <Step onClick={story.raoPrescribes} kind="accent" testId="rao-issue">
                Sign and issue
              </Step>
              <Busy when />
            </>
          ) : (
            <>
              <div className="ok-box">
                <b>Issued</b>
                One hash is in the prescription tree. Give Ravi the prescription itself:
              </div>
              <Qr value={rx.token} caption="Ravi scans this. It never goes on chain." />
              <TokenText token={rx.token} />
            </>
          )}
        </Device>
        <Device name={ravi.name} sub={ravi.role} what="phone" color={COLORS.ravi}>
          {!rx ? (
            <p className="device-empty">No prescriptions yet.</p>
          ) : !rx.received ? (
            <Step onClick={() => story.receive('raoRx')} testId="ravi-scan-rx">
              Scan Dr Rao's QR code
            </Step>
          ) : (
            <>
              <RxCard token={rx.token} title="Stored on this phone only" />
              <PatientStatus patient={ravi} token={rx.token} />
            </>
          )}
        </Device>
      </div>
      {rx?.received && <Next to={2} label="At the pharmacy counter" />}
    </>
  );
}

// ---------------------------------------------------------------------------- 3. the counter

function CounterStage() {
  const story = useStory();
  const { lotus, ravi } = story.world;
  const { raoRx, lotusCounter, lotusFill } = story.s;
  if (!raoRx) return <Locked />;
  return (
    <>
      <div className="devices">
        <Device name={lotus.name} sub={`${lotus.role}, ${lotus.city} · ${lotus.licence}`} what="counter" color={COLORS.lotus}>
          <CounterScreen
            counter={lotusCounter}
            attempt={lotusFill}
            onNew={() => story.newCounter('lotusCounter', lotus)}
            onCheck={story.checkLotus}
            testId="lotus"
          />
          <Busy when={!!lotusFill && !lotusFill.check} />
        </Device>
        <Device name={ravi.name} sub={ravi.role} what="phone" color={COLORS.ravi} wide>
          {!lotusCounter ? (
            <>
              <RxCard token={raoRx.token} title="Ready to fill" />
              <p className="muted small">Waiting for a counter request from the pharmacy.</p>
            </>
          ) : !lotusCounter.scanned ? (
            <Step onClick={() => story.scanCounter('lotusCounter')} testId="ravi-scan-counter">
              Scan the counter request
            </Step>
          ) : !lotusFill ? (
            <>
              <div className="state-line">
                <b>{lotus.name}</b>&nbsp;asks to fill:
              </div>
              <RxCard token={raoRx.token} />
              <div className="disclose">
                <b>This fill will publish</b>
                <ul>
                  <li>the pharmacy, {lotus.licence}</li>
                  <li>the prescriber's licence number and the class: opioid analgesics</li>
                  <li>a sealed commitment to the medicine and quantity</li>
                  <li>a deadline 30 minutes from now</li>
                  <li>two one-way nullifiers</li>
                </ul>
                <b>It will not publish</b>
                <ul>
                  <li>who you are, or your patient key</li>
                  <li>the medicine, the quantity, the expiry date</li>
                  <li>which prescription this is, or any other one you hold</li>
                </ul>
              </div>
              <Step onClick={story.fillAtLotus} kind="accent" testId="ravi-fill">
                Prove and fill
              </Step>
              <Busy when />
            </>
          ) : lotusFill.entry.outcome === 'refused' ? (
            <Refused entry={lotusFill.entry} />
          ) : (
            <>
              <div className="ok-box">
                <b>Filled</b>
                Show this to the pharmacist. It opens the sealed commitment for them alone.
              </div>
              {lotusFill.dispenseToken && <Qr value={lotusFill.dispenseToken} caption="Dispense opening: medicine, quantity, salt" />}
              <PatientStatus patient={ravi} token={raoRx.token} />
            </>
          )}
        </Device>
      </div>
      {lotusFill?.check?.ok && <Next to={3} label="The same prescription, again" />}
    </>
  );
}

// ----------------------------------------------------------------------------- 4. the refill

function RefillStage() {
  const story = useStory();
  const { neem, ravi } = story.world;
  const { raoRx, refillCounter, refill } = story.s;
  if (!raoRx || !story.s.lotusFill) return <Locked />;
  return (
    <>
      <div className="devices">
        <Device name={neem.name} sub={`${neem.role}, ${neem.city} · ${neem.licence}`} what="counter" color={COLORS.neem}>
          <CounterScreen counter={refillCounter} attempt={refill} onNew={() => story.newCounter('refillCounter', neem)} testId="neem-refill" />
        </Device>
        <Device name={ravi.name} sub={`${ravi.role}, now in Mumbai`} what="phone" color={COLORS.ravi} wide>
          <RxCard token={raoRx.token} title="Dr Rao's prescription, from a screenshot" />
          {refillCounter && !refill && (
            <>
              <Step onClick={story.refillAtNeem} kind="accent" testId="ravi-refill">
                Scan the counter request and fill
              </Step>
              <Busy when />
            </>
          )}
          {refill && <Refused entry={refill.entry} />}
          {refill && (
            <p className="muted small">
              The phone computed this prescription's fill nullifier and found it already on chain. Any device holding the same
              prescription and key computes the same value, so a copy is worth nothing.
            </p>
          )}
        </Device>
      </div>
      {refill && <Next to={4} label="Doctor shopping" />}
    </>
  );
}

// ------------------------------------------------------------------------- 5. doctor shopping

function ShoppingStage() {
  const story = useStory();
  const { mehta, neem, ravi } = story.world;
  const { mehtaRx, shopCounter, shop } = story.s;
  if (!story.s.refill) return <Locked />;
  return (
    <>
      <div className="devices">
        <Device name={mehta.name} sub={`${mehta.role}, ${mehta.city} · ${mehta.licence}`} what="clinic" color={COLORS.mehta}>
          {!mehtaRx ? (
            <>
              <RxCard
                rx={{ ...decodeRx(story.s.raoRx!.token), doctor: mehta.client.id, notAfter: story.world.now + 60n * 86_400n }}
                title="Draft: tramadol for Ravi, valid 60 days"
              />
              <p className="muted small">This screen has no way to see Dr Rao's prescription. Nor does anyone else's.</p>
              <Step onClick={story.mehtaPrescribes} kind="accent" testId="mehta-issue">
                Sign and issue
              </Step>
              <Busy when />
            </>
          ) : (
            <>
              <div className="ok-box">
                <b>Issued</b>A second, separate prescription. Both are valid.
              </div>
              <Qr value={mehtaRx.token} caption="Ravi scans this" />
            </>
          )}
        </Device>
        <Device name={neem.name} sub={`${neem.role}, ${neem.city} · ${neem.licence}`} what="counter" color={COLORS.neem}>
          {mehtaRx?.received ? (
            <CounterScreen counter={shopCounter} attempt={shop} onNew={() => story.newCounter('shopCounter', neem)} testId="neem-shop" />
          ) : (
            <p className="device-empty">Waiting for Ravi.</p>
          )}
        </Device>
        <Device name={ravi.name} sub={ravi.role} what="phone" color={COLORS.ravi}>
          {!mehtaRx ? (
            <p className="device-empty">At Dr Mehta's clinic.</p>
          ) : !mehtaRx.received ? (
            <Step onClick={() => story.receive('mehtaRx')} testId="ravi-scan-mehta">
              Scan Dr Mehta's QR code
            </Step>
          ) : (
            <>
              <RxCard token={mehtaRx.token} title="From Dr Mehta" />
              {shopCounter && !shop && (
                <>
                  <Step onClick={story.shopAtNeem} kind="accent" testId="ravi-shop">
                    Scan the counter request and fill
                  </Step>
                  <Busy when />
                </>
              )}
              {shop && <Refused entry={shop.entry} />}
              {shop && (
                <p className="muted small">
                  The cap nullifier is a hash of Ravi's secret, the class and this 30-day window. Dr Rao's fill already put it on
                  chain, and any prescription from any doctor for this class leads to the same value.
                </p>
              )}
            </>
          )}
        </Device>
      </div>
      {shop && <Next to={5} label="Forged and borrowed prescriptions" />}
    </>
  );
}

// ------------------------------------------------------------------------- 6. forgery, theft

function FraudStage() {
  const story = useStory();
  const { meera, ravi } = story.world;
  const { mehtaRx, forgedToken, forged, stolen } = story.s;
  const [qty, setQty] = useState('60');
  if (!mehtaRx || !story.s.shop) return <Locked />;
  return (
    <>
      <div className="devices">
        <Device name={ravi.name} sub={`${ravi.role}, editing a token`} what="phone" color={COLORS.ravi} wide>
          <RxCard token={forgedToken ?? mehtaRx.token} title={forgedToken ? 'Edited copy' : "Dr Mehta's prescription"} />
          {!forgedToken ? (
            <>
              <label className="field">
                Change the quantity to
                <input type="number" min={1} max={999} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="forge-qty" />
              </label>
              <Step
                onClick={() => story.forge(BigInt(Math.max(1, Math.min(999, Number(qty) || 60))))}
                testId="forge"
              >
                Re-encode the token
              </Step>
            </>
          ) : (
            <>
              <div className="small muted">The token, with the changed characters marked:</div>
              <TokenText token={forgedToken} against={mehtaRx.token} />
              {!forged && (
                <>
                  <Step onClick={story.fillForged} kind="accent" testId="fill-forged">
                    Try it at Neem Chemists
                  </Step>
                  <Busy when />
                </>
              )}
              {forged && <Refused entry={forged.entry} />}
              {forged && (
                <p className="muted small">
                  The edited prescription decodes fine, but its hash is not in the tree. Only a licensed doctor's key can add one.
                </p>
              )}
            </>
          )}
        </Device>
        <Device name={meera.name} sub="Ravi's neighbour, also enrolled" what="phone" color={COLORS.meera}>
          {!forged ? (
            <p className="device-empty">Waiting.</p>
          ) : (
            <>
              <RxCard token={mehtaRx.token} title="Ravi's prescription, scanned from his phone" />
              {!stolen && (
                <>
                  <Step onClick={story.steal} kind="accent" testId="steal">
                    Try it at Lotus Pharmacy
                  </Step>
                  <Busy when />
                </>
              )}
              {stolen && <Refused entry={stolen.entry} />}
              {stolen && (
                <p className="muted small">
                  The prescription names Ravi's patient key, and only Ravi's secret produces it. Meera's phone cannot make the proof.
                </p>
              )}
            </>
          )}
        </Device>
      </div>
      {stolen && <Next to={6} label="A month later" />}
    </>
  );
}

// ----------------------------------------------------------------------------- 7. next month

function LaterStage() {
  const story = useStory();
  const { neem, ravi } = story.world;
  const { mehtaRx, monthLater, laterCounter, later } = story.s;
  if (!mehtaRx || !story.s.stolen) return <Locked />;
  return (
    <>
      <div className="devices">
        <Device name="Calendar" sub={utcTime(story.world.now)} what="clock" color={COLORS.council}>
          {!monthLater ? (
            <>
              <p className="small">
                The opioid cap counts fills per 30-day window. Windows are fixed slices of time, so the next one starts at most 30
                days from now.
              </p>
              <Step onClick={story.advanceMonth} kind="accent" testId="advance">
                Move the chain clock forward 30 days
              </Step>
            </>
          ) : (
            <div className="ok-box">
              <b>30 days later</b>A new cap window is open.
            </div>
          )}
        </Device>
        <Device name={neem.name} sub={`${neem.role}, ${neem.city} · ${neem.licence}`} what="counter" color={COLORS.neem}>
          {monthLater ? (
            <CounterScreen
              counter={laterCounter}
              attempt={later}
              onNew={() => story.newCounter('laterCounter', neem)}
              onCheck={() => undefined}
              testId="neem-later"
            />
          ) : (
            <p className="device-empty">Closed until next month.</p>
          )}
        </Device>
        <Device name={ravi.name} sub={ravi.role} what="phone" color={COLORS.ravi}>
          <RxCard token={mehtaRx.token} title={later ? "Dr Mehta's prescription" : "Dr Mehta's prescription, still unfilled"} />
          {laterCounter && !later && (
            <>
              <Step onClick={story.fillLater} kind="accent" testId="ravi-later">
                Scan the counter request and fill
              </Step>
              <Busy when />
            </>
          )}
          {later && later.entry.outcome === 'published' && (
            <>
              <div className="ok-box">
                <b>Filled</b>A new window, a new cap nullifier.
              </div>
              <PatientStatus patient={ravi} token={mehtaRx.token} />
            </>
          )}
          {later && <Refused entry={later.entry} />}
        </Device>
      </div>
      {later?.entry.outcome === 'published' && <Unlinkable />}
      {later?.entry.outcome === 'published' && <Next to={7} label="A doctor is suspended" />}
    </>
  );
}

/** The two opioid fills side by side, as anyone reading the chain sees them. */
function Unlinkable() {
  const story = useStory();
  const view = story.world.view();
  const fills = view.fills.filter((f) => f.drugClass !== 0n);
  const caps = [...story.world.backend.sim.ledger().capNullifiers].map((b) => hex(b));
  return (
    <div className="card linkbox" data-testid="unlinkable">
      <h3>Same person, two fills. Can you tell?</h3>
      <p className="muted small">The two opioid fill records and the two cap nullifiers, exactly as public state holds them.</p>
      <table className="plain">
        <thead>
          <tr>
            <th>Pharmacy</th>
            <th>Prescriber</th>
            <th>Class</th>
            <th>Dispense commitment</th>
            <th>Valid before</th>
          </tr>
        </thead>
        <tbody>
          {fills.map((f) => (
            <tr key={f.challenge}>
              <td className="mono">{f.pharmacyLicence}</td>
              <td className="mono">{f.doctorLicence}</td>
              <td>{className(f.drugClass)}</td>
              <td>
                <span className="hash">{shortHash(f.dispense, 10, 6)}</span>
              </td>
              <td>{utcTime(f.validBefore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="small" style={{ marginTop: 10 }}>
        Cap nullifiers:{' '}
        {caps.map((c) => (
          <span key={c} className="hash" style={{ marginRight: 6 }}>
            {shortHash(c, 10, 6)}
          </span>
        ))}
      </div>
      <p className="small" style={{ marginTop: 10 }}>
        Different pharmacy, different doctor, unrelated hashes, a month apart. Nothing on chain ties them to each other or to Ravi.
        In a network this small anyone could guess; with thousands of people filling, the guess is worthless.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------ 8. suspension

function SuspensionStage() {
  const story = useStory();
  const { mehta, meera, lotus } = story.world;
  const { meeraRx, suspension, suspendedFill } = story.s;
  if (!story.s.later) return <Locked />;
  return (
    <>
      <div className="devices">
        <Device name={mehta.name} sub={`${mehta.role} · ${mehta.licence}`} what="clinic" color={COLORS.mehta}>
          {!meeraRx ? (
            <>
              <p className="small">Before the council acts, Dr Mehta writes Meera a routine prescription.</p>
              <Step onClick={story.meeraPrescribed} testId="meera-rx">
                Issue metformin for Meera
              </Step>
              <Busy when={!meeraRx} />
            </>
          ) : (
            <RxCard token={meeraRx.token} title="Issued to Meera" />
          )}
        </Device>
        <Device name="Medical council" sub="Licenses and suspends doctors" what="authority" color={COLORS.council}>
          {!meeraRx ? (
            <p className="device-empty">Reviewing a complaint.</p>
          ) : !suspension ? (
            <>
              <p className="small">
                The council does not know who holds Dr Mehta's prescriptions, and does not need to. One transaction is enough.
              </p>
              <Step onClick={story.suspendMehta} kind="danger" testId="suspend">
                Suspend {mehta.licence}
              </Step>
            </>
          ) : (
            <div className="warn-box">
              <b>Suspended</b>Every unfilled prescription Dr Mehta wrote stops working at every pharmacy, now.
            </div>
          )}
        </Device>
        <Device name={meera.name} sub="Patient" what="phone" color={COLORS.meera}>
          {!suspension || !meeraRx ? (
            <p className="device-empty">No prescriptions yet.</p>
          ) : (
            <>
              <RxCard token={meeraRx.token} title={`Filling at ${lotus.name}`} />
              {!suspendedFill && (
                <>
                  <Step onClick={story.meeraFills} kind="accent" testId="meera-fill">
                    Scan the counter request and fill
                  </Step>
                  <Busy when />
                </>
              )}
              {suspendedFill && <Refused entry={suspendedFill.entry} />}
            </>
          )}
        </Device>
      </div>
      {suspendedFill && <Next to={8} label="What the regulator sees" />}
    </>
  );
}

// ------------------------------------------------------------------------------- 9. regulator

function RegulatorStage() {
  const story = useStory();
  return (
    <>
      {!story.s.suspendedFill && <Locked />}
      <PublicTables view={story.world.view()} />
      <div className="next-row">
        <button className="btn ghost" onClick={() => story.reset()} data-testid="reset">
          Start over with fresh keys
        </button>
        <Link className="btn" to="/ledger">
          See the same story on Midnight Preview <span aria-hidden="true">→</span>
        </Link>
      </div>
    </>
  );
}

function Locked() {
  const story = useStory();
  const index = chapterIndexOf(useParams().chapter);
  return (
    <div className="card" style={{ padding: 20, marginTop: 24 }}>
      <p>This chapter continues the story from the earlier ones.</p>
      <div className="next-row">
        <Step onClick={() => void playUpTo(story, index)} kind="accent" testId="skip">
          Play chapters 1 to {index} automatically
        </Step>
        <Busy when />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------- the list

/** Plays every chapter before `index` that has not been played yet. */
export async function playUpTo(story: Story, index: number): Promise<void> {
  for (let i = 0; i < index && i < CHAPTERS.length; i++) {
    const c = CHAPTERS[i]!;
    if (!c.done(story.s)) await c.autoplay(story);
  }
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'network',
    kicker: 'Chapter 1',
    title: 'Three authorities set up the network',
    story: (
      <>
        Ampoule is run by three authorities, each with its own key: a medical council licenses doctors, a drug controller licenses
        pharmacies and caps controlled classes, and a health-ID registrar enrolls one patient key per person after checking their ID
        once, off chain. No single party controls the network.
      </>
    ),
    pub: 'Licence numbers of doctors and pharmacies, each with a hash of its signing key. The cap of each controlled class. One hash per enrolled patient.',
    priv: "Who the patients are. The patient key never appears: the tree stores a hash of it, and the key itself is a hash of a secret that never leaves the patient's phone.",
    done: (s) => !!s.setUp,
    autoplay: async (story) => {
      await story.setUpNetwork();
    },
    Stage: NetworkStage,
  },
  {
    id: 'prescribe',
    kicker: 'Chapter 2',
    title: 'Dr Rao writes a prescription',
    story: (
      <>
        Ravi hurts his knee. Dr Asha Rao, an orthopaedic surgeon in Delhi, prescribes ten tablets of tramadol, an opioid painkiller.
        Her screen proves she holds the key the council registered for her licence and appends one hash to the prescription tree.
        The prescription itself goes to Ravi as a QR code, the way a paper slip would.
      </>
    ),
    pub: 'Dr Rao issued one prescription, in a controlled class. One new hash in the prescription tree.',
    priv: "Who it is for, which medicine, how much, and when it expires. Those exist only in the QR code on Ravi's phone.",
    done: (s) => !!s.raoRx?.received,
    focus: (s) => s.raoRx?.entry,
    autoplay: async (story) => {
      if (!story.s.raoRx) await story.raoPrescribes();
      story.receive('raoRx');
    },
    Stage: PrescriptionStage,
  },
  {
    id: 'counter',
    kicker: 'Chapter 3',
    title: 'At the pharmacy counter',
    story: (
      <>
        Ravi walks into Lotus Pharmacy in Karol Bagh. The pharmacist's screen shows a one-time counter request. Ravi's phone scans it
        and proves, in one zero-knowledge proof, that a licensed doctor issued him this prescription, that it has a fill left and has
        not expired, and that he is under the opioid cap this month. Then it shows the pharmacist what to hand over.
      </>
    ),
    pub: "A fill at Lotus, on a prescription by Dr Rao, in the opioid class, valid for 30 minutes. Two nullifiers only Ravi's phone can compute. A sealed commitment to the medicine and quantity.",
    priv: "Ravi's identity and key, which prescription it was, the medicine, the quantity and the expiry. The pharmacist learns the medicine and quantity, because they hand it over, and nothing about Ravi's other prescriptions.",
    done: (s) => !!s.lotusFill?.check?.ok,
    focus: (s) => s.lotusFill?.entry,
    autoplay: async (story) => {
      if (!story.s.lotusCounter) story.newCounter('lotusCounter', story.world.lotus);
      story.scanCounter('lotusCounter');
      if (!story.s.lotusFill) await story.fillAtLotus();
      if (!story.s.lotusFill?.check) await story.checkLotus();
    },
    Stage: CounterStage,
  },
  {
    id: 'refill',
    kicker: 'Chapter 4',
    title: 'The same prescription, again',
    story: (
      <>
        Ravi kept a screenshot of Dr Rao's QR code. He takes it to Neem Chemists in Mumbai, where nobody has seen him, and tries to fill
        it a second time.
      </>
    ),
    pub: 'Nothing. The proof cannot be made, so no transaction exists.',
    priv: 'Neem does not learn that Ravi filled at Lotus, or anything else. It only sees that no fill arrived.',
    done: (s) => !!s.refill,
    focus: (s) => s.refill?.entry,
    autoplay: async (story) => {
      if (!story.s.refillCounter) story.newCounter('refillCounter', story.world.neem);
      await story.refillAtNeem();
    },
    Stage: RefillStage,
  },
  {
    id: 'shopping',
    kicker: 'Chapter 5',
    title: 'Doctor shopping',
    story: (
      <>
        Ravi books Dr Vikram Mehta in Mumbai and does not mention Dr Rao. Dr Mehta cannot see Dr Rao's prescription, so writes
        another one for tramadol. It is valid, and it is issued. But the cap is per person and class, not per prescription.
      </>
    ),
    pub: 'Dr Mehta issued a controlled prescription. The refused fill leaves no trace.',
    priv: 'Neither doctor nor either pharmacy learns about the other prescription. The refusal says only that this person is over the cap for this class in this window.',
    done: (s) => !!s.shop,
    focus: (s) => s.shop?.entry ?? s.mehtaRx?.entry,
    autoplay: async (story) => {
      if (!story.s.mehtaRx) await story.mehtaPrescribes();
      story.receive('mehtaRx');
      if (!story.s.shopCounter) story.newCounter('shopCounter', story.world.neem);
      await story.shopAtNeem();
    },
    Stage: ShoppingStage,
  },
  {
    id: 'fraud',
    kicker: 'Chapter 6',
    title: 'Forged and borrowed prescriptions',
    story: (
      <>
        Two more tricks. Ravi edits Dr Mehta's prescription from 10 tablets to 60 and re-encodes it. Then his neighbour Meera, who is
        also enrolled, scans Ravi's prescription and tries it on her own phone.
      </>
    ),
    pub: 'Nothing, twice.',
    priv: "The edited token is a well-formed prescription. It fails because its hash is not in the tree, and only a licensed doctor's key can add one.",
    done: (s) => !!s.forged && !!s.stolen,
    focus: (s) => s.forged?.entry,
    autoplay: async (story) => {
      if (!story.s.forgedToken) story.forge(60n);
      if (!story.s.forged) await story.fillForged();
      if (!story.s.stolen) await story.steal();
    },
    Stage: FraudStage,
  },
  {
    id: 'later',
    kicker: 'Chapter 7',
    title: 'A month later',
    story: (
      <>
        Thirty days pass and a new opioid cap window opens. Ravi fills Dr Mehta's prescription at Neem, legitimately this time. Then
        look at the two fills the way the rest of the world can.
      </>
    ),
    pub: 'A second opioid fill: at Neem, by Dr Mehta. A new cap nullifier, for the new window.',
    priv: 'That both fills were the same person. The nullifiers are unrelated hashes, and a fill record names only a pharmacy and a doctor.',
    done: (s) => !!s.later && s.later.entry.outcome === 'published',
    focus: (s) => s.later?.entry,
    autoplay: async (story) => {
      if (!story.s.monthLater) story.advanceMonth();
      if (!story.s.laterCounter) story.newCounter('laterCounter', story.world.neem);
      if (!story.s.later) await story.fillLater();
    },
    Stage: LaterStage,
  },
  {
    id: 'suspension',
    kicker: 'Chapter 8',
    title: 'A doctor is suspended',
    story: (
      <>
        The council finds Dr Mehta has been selling prescriptions. One transaction suspends the licence, and every unfilled
        prescription Dr Mehta ever wrote stops working at every pharmacy at once.
      </>
    ),
    pub: "Dr Mehta's licence is inactive.",
    priv: "Who holds Dr Mehta's prescriptions. The council never had that list and does not need it.",
    done: (s) => !!s.suspendedFill,
    focus: (s) => s.suspension,
    autoplay: async (story) => {
      if (!story.s.meeraRx) await story.meeraPrescribed();
      if (!story.s.suspension) await story.suspendMehta();
      if (!story.s.suspendedFill) await story.meeraFills();
    },
    Stage: SuspensionStage,
  },
  {
    id: 'regulator',
    kicker: 'Chapter 9',
    title: 'What the regulator sees',
    story: (
      <>
        This is everything a regulator, a journalist or a data broker can read from the chain. Per-doctor and per-pharmacy volumes
        are enough to spot a pill mill. There is no column for the patient, because the chain has nothing to put in it.
      </>
    ),
    pub: 'Volumes per doctor, pharmacy and class. Licence status. Fill records without people.',
    priv: 'Every patient, every medicine, every quantity.',
    done: () => false,
    autoplay: async () => {},
    Stage: RegulatorStage,
  },
];
