// SPDX-License-Identifier: Apache-2.0
import { className, decodeRx, drugOf, isControlled, labelOf, quantityText, type Prescription } from '@ampoule/sdk/core';
import { utcDate } from '../lib/format';

/** The prescription as the patient's phone shows it, decoded from the token it holds. */
export function RxCard({ token, rx: given, title }: { token?: string; rx?: Prescription; title?: string }) {
  const rx = given ?? (token ? decodeRx(token) : undefined);
  if (!rx) return null;
  const drug = drugOf(rx.drug);
  const controlled = isControlled(rx.drugClass);
  return (
    <div className="rx-card">
      {title && <div className="kicker" style={{ marginBottom: 6 }}>{title}</div>}
      <div className="drug">{drug ? `${drug.name} ${drug.strength}` : (labelOf(rx.drug) ?? 'Unknown drug')}</div>
      <div className="meta">
        {quantityText(drug, rx.quantity)}, {rx.fills === 1n ? 'one fill' : `${rx.fills} fills`}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <span className={`pill ${controlled ? 'amber' : ''}`}>{controlled ? `Controlled: ${className(rx.drugClass)}` : 'General medicine'}</span>
      </div>
      <div className="meta" style={{ marginTop: 8 }}>
        Prescriber <span className="mono">{labelOf(rx.doctor) ?? 'unknown'}</span>, valid until {utcDate(rx.notAfter)}
      </div>
    </div>
  );
}
