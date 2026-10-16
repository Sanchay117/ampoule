// SPDX-License-Identifier: Apache-2.0
import type { PublicView } from '@ampoule/sdk/core';
import type { LogEntry } from '../lib/demo';
import { explain } from '../lib/explain';
import { ms } from '../lib/format';

export interface ChainPanelProps {
  log: LogEntry[];
  view: PublicView;
  /** Which call to show; the latest when unset. */
  selected?: number;
  onSelect: (id: number | undefined) => void;
}

/** The dark side of the screen: only what a call publishes, decoded from its transcript. */
export function ChainPanel({ log, view, selected, onSelect }: ChainPanelProps) {
  const entry = (selected !== undefined ? log.find((e) => e.id === selected) : undefined) ?? log[log.length - 1];
  const nullifiers = view.totals.fillNullifiers + view.totals.capNullifiers;
  return (
    <aside className="chain" aria-label="What the chain sees" data-testid="chain">
      <h3>What the chain sees</h3>
      <p className="tag">
        Public state of the contract, and every operation each call adds to it, decoded from the call's real transcript.
      </p>
      <div className="counters">
        <div>
          <b data-testid="count-issued">{view.totals.issued.toString()}</b>
          <span>issued</span>
        </div>
        <div>
          <b data-testid="count-filled">{view.totals.filled.toString()}</b>
          <span>filled</span>
        </div>
        <div>
          <b>{view.totals.enrolled.toString()}</b>
          <span>enrolled</span>
        </div>
        <div>
          <b>{nullifiers.toString()}</b>
          <span>nullifiers</span>
        </div>
      </div>

      {entry ? (
        <CallView entry={entry} />
      ) : (
        <div className="call">
          <div className="refused-call" style={{ color: 'var(--chain-muted)' }}>
            Nothing yet. The contract is deployed with three authority key hashes and empty tables.
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div className="history">
          <h3>
            All calls ({log.length}){' '}
            {selected !== undefined && (
              <button className="linkish" onClick={() => onSelect(undefined)}>
                follow latest
              </button>
            )}
          </h3>
          <ol>
            {[...log].reverse().map((e) => (
              <li key={e.id} className={e.id === entry?.id ? 'sel' : ''} onClick={() => onSelect(e.id)}>
                <span className="c">{e.circuit}</span>
                <span>{e.label}</span>
                {e.outcome === 'refused' ? <span className="r">refused</span> : <span>{e.events.length} ops</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </aside>
  );
}

function CallView({ entry }: { entry: LogEntry }) {
  return (
    <article className="call" data-testid="call" data-outcome={entry.outcome}>
      <div className="call-head">
        <span className="circ">{entry.circuit}</span>
        <div className="lbl">
          {entry.label}
          <small>
            {entry.actor} · {entry.outcome === 'published' ? `${entry.events.length} public operations` : 'refused'} · ran in{' '}
            {ms(entry.durationMs)}
          </small>
        </div>
      </div>
      {entry.outcome === 'refused' && entry.refusal ? (
        <div className="refused-call" data-testid="refusal">
          <b>{entry.refusal.code}</b>
          {entry.refusal.explanation} The circuit stopped on the caller's own device, so no proof was made and no transaction
          exists. The chain saw nothing at all.
        </div>
      ) : (
        <>
          <ol className="ops">
            {entry.events.map((e, i) => {
              const x = explain(e);
              return (
                <li key={i} className={`t-${x.tone}`}>
                  <span className="v">{x.verb}</span>
                  <span>
                    {x.text}
                    {x.note && <span className="note">{x.note}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          <Scan entry={entry} />
        </>
      )}
    </article>
  );
}

function Scan({ entry }: { entry: LogEntry }) {
  const s = entry.scan;
  if (!s || s.absent.length + s.present.length === 0) return null;
  return (
    <div className="scan" data-testid="scan" data-leaks={s.present.length}>
      {s.present.length === 0 ? (
        <>
          <b>Private inputs found in this transaction: none.</b> Every value it publishes was searched for each of these:
        </>
      ) : (
        <b className="leak">Found in the transaction: {s.present.join(', ')}</b>
      )}
      <ul>
        {s.absent.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {s.controls.found.length > 0 && (
        <p className="control">
          Control: the same search does find {s.controls.found.join(' and ')}, which is public on purpose.
        </p>
      )}
    </div>
  );
}
