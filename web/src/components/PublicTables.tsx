// SPDX-License-Identifier: Apache-2.0
import { className, type PublicView } from '@ampoule/sdk/core';
import { shortHash, utcTime } from '../lib/format';

/** Everything anyone can read from the contract, as a regulator's dashboard. */
export function PublicTables({ view }: { view: PublicView }) {
  const maxControlled = view.doctors.reduce((m, d) => (d.controlledIssued > m ? d.controlledIssued : m), 1n);
  return (
    <div className="dash" data-testid="dashboard">
      <div className="card">
        <h3>Doctors</h3>
        <table className="plain">
          <thead>
            <tr>
              <th>Licence</th>
              <th>Status</th>
              <th className="num">Issued</th>
              <th className="num">Controlled</th>
              <th>Controlled volume</th>
              <th className="num">Filled</th>
            </tr>
          </thead>
          <tbody>
            {view.doctors.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.licence ?? shortHash(d.id)}</td>
                <td>{d.active ? <span className="pill green">licensed</span> : <span className="pill red">suspended</span>}</td>
                <td className="num">{d.issued.toString()}</td>
                <td className="num">{d.controlledIssued.toString()}</td>
                <td>
                  <div className="bar">
                    <i style={{ width: `${Number((d.controlledIssued * 100n) / maxControlled)}%` }} />
                  </div>
                </td>
                <td className="num">{d.filled.toString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Pharmacies</h3>
          <table className="plain">
            <thead>
              <tr>
                <th>Licence</th>
                <th>Status</th>
                <th className="num">Fills</th>
              </tr>
            </thead>
            <tbody>
              {view.pharmacies.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.licence ?? shortHash(p.id)}</td>
                  <td>{p.active ? <span className="pill green">licensed</span> : <span className="pill red">suspended</span>}</td>
                  <td className="num">{p.filled.toString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Caps</h3>
          <table className="plain">
            <thead>
              <tr>
                <th>Class</th>
                <th>Cap</th>
                <th className="num">Fills</th>
              </tr>
            </thead>
            <tbody>
              {view.policies.map((p) => (
                <tr key={p.drugClass.toString()}>
                  <td>{className(p.drugClass)}</td>
                  <td>
                    {p.maxFills.toString()} per {(p.windowSeconds / 86_400n).toString()} days
                  </td>
                  <td className="num">{(view.fillsByClass.find((c) => c.drugClass === p.drugClass)?.fills ?? 0n).toString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h3>Fill records</h3>
        <table className="plain">
          <thead>
            <tr>
              <th>Pharmacy</th>
              <th>Prescriber</th>
              <th>Class</th>
              <th>Dispense commitment</th>
              <th>Valid before</th>
              <th>Patient</th>
            </tr>
          </thead>
          <tbody>
            {view.fills.map((f) => (
              <tr key={f.challenge}>
                <td className="mono">{f.pharmacyLicence ?? shortHash(f.pharmacy)}</td>
                <td className="mono">{f.doctorLicence ?? shortHash(f.doctor)}</td>
                <td>{className(f.drugClass)}</td>
                <td>
                  <span className="hash">{shortHash(f.dispense, 8, 4)}</span>
                </td>
                <td>{utcTime(f.validBefore)}</td>
                <td className="muted">not on chain</td>
              </tr>
            ))}
            {view.fills.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No fills yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Totals</h3>
        <p className="small">
          {view.totals.issued.toString()} prescriptions issued, {view.totals.filled.toString()} filled, {view.totals.enrolled.toString()}{' '}
          patients enrolled. {view.totals.fillNullifiers.toString()} fill nullifiers and {view.totals.capNullifiers.toString()} cap
          nullifiers, none of which can be traced to a person.
        </p>
      </div>
    </div>
  );
}
