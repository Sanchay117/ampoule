// SPDX-License-Identifier: Apache-2.0
import { Link } from 'react-router-dom';
import { REPO_URL } from '../config';

const REFUSALS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Fraud',
    items: [
      ['ALREADY_FILLED', 'A copied or screenshotted prescription, filled twice.'],
      ['CAP_REACHED', 'A second opioid fill this month, from any doctor, at any pharmacy.'],
      ['NO_SUCH_PRESCRIPTION', 'A forged or edited prescription.'],
      ['NOT_YOUR_PRESCRIPTION', "Someone else's prescription."],
      ['PRESCRIPTION_EXPIRED', 'A prescription past its date.'],
      ['CHALLENGE_USED', 'A replayed proof at the counter.'],
    ],
  },
  {
    title: 'Licensing',
    items: [
      ['UNKNOWN_DOCTOR', 'A prescriber the council never licensed.'],
      ['NOT_THIS_DOCTOR', "A real licence number without that doctor's key."],
      ['DOCTOR_SUSPENDED', 'Any open prescription of a suspended doctor.'],
      ['UNKNOWN_PHARMACY', 'A counter that is not a licensed pharmacy.'],
      ['PHARMACY_SUSPENDED', 'A pharmacy whose licence was pulled.'],
      ['NOT_ENROLLED', 'A patient key the registrar never enrolled.'],
    ],
  },
  {
    title: 'Authority',
    items: [
      ['NOT_COUNCIL', 'Licensing a doctor without the council key.'],
      ['NOT_CONTROLLER', 'Licensing a pharmacy or changing a cap without the controller key.'],
      ['NOT_REGISTRAR', 'Enrolling a patient without the registrar key.'],
      ['WRONG_WINDOW', 'A fill that claims a cap window other than the current one.'],
      ['REQUEST_EXPIRED', 'A proof used after its 30-minute deadline.'],
      ['UNKNOWN_CLASS', 'A controlled class with no cap set.'],
    ],
  },
];

const BOUNDARY: Array<[string, string, string, string]> = [
  ['Who the patient is', 'Never', 'Holds the secret', 'Never'],
  ['Medicine and quantity', 'A sealed commitment', 'Yes', 'At the counter, to hand it over'],
  ['Expiry date', 'Never (only a 30-minute deadline)', 'Yes', 'No'],
  ['Prescribing doctor', 'Licence number', 'Yes', 'Licence number'],
  ['Drug class (opioid, sedative...)', 'Yes, for volume statistics', 'Yes', 'Yes'],
  ["The patient's other prescriptions", 'Never', 'Yes', 'Never'],
  ['That a fill happened, where', 'Yes', 'Yes', 'Yes'],
];

export default function Landing() {
  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="kicker">Zero-knowledge prescriptions on Midnight</div>
            <h1 style={{ marginTop: 14 }}>
              One prescription, one fill, <em>no patient data on chain.</em>
            </h1>
            <p className="lede">
              Ampoule seals each prescription as a single hash. At the pharmacy, the patient's phone proves that the prescription is
              real, is theirs, has not expired or been filled, and that they are under the monthly cap for opioids and other
              controlled drugs across every pharmacy in the network. The chain enforces all of it and learns none of it.
            </p>
            <div className="ctas">
              <Link className="btn accent" to="/demo" data-testid="cta-demo">
                Run the demo in your browser
              </Link>
              <Link className="btn ghost" to="/live">
                Run it live with Lace
              </Link>
              <Link className="btn ghost" to="/ledger">
                Check it on Midnight Preview
              </Link>
              {REPO_URL && (
                <a className="btn ghost" href={REPO_URL} target="_blank" rel="noreferrer">
                  Source
                </a>
              )}
            </div>
            <div className="proofline">
              <span>Compact contract, 6 circuits</span>
              <span>No wallet needed for the demo</span>
              <span>Fictional people and pharmacies</span>
            </div>
          </div>

          <div className="split-visual" aria-label="The same fill, seen privately and publicly">
            <div className="private">
              <h4>At the counter: the patient's phone and the pharmacist</h4>
              <dl className="kv">
                <dt>Patient</dt>
                <dd>Ravi, knee injury</dd>
                <dt>Medicine</dt>
                <dd>Tramadol 50 mg, 10 tablets</dd>
                <dt>Prescriber</dt>
                <dd>Dr Asha Rao, Delhi</dd>
                <dt>Valid until</dt>
                <dd>15 Nov 2026</dd>
                <dt>Opioid cap</dt>
                <dd>1 of 1 this month, from any doctor</dd>
              </dl>
            </div>
            <div className="public">
              <h4>On chain: what everyone can read</h4>
              <dl className="kv">
                <dt>Patient</dt>
                <dd>
                  <span className="redacted">no such field</span>
                </dd>
                <dt>Medicine</dt>
                <dd>commitment 9f2c41…e1a7</dd>
                <dt>Prescriber</dt>
                <dd>MC-DL-58213</dd>
                <dt>Pharmacy</dt>
                <dd>DL-RX-20B-4471</dd>
                <dt>Class</dt>
                <dd>Opioid analgesics</dd>
                <dt>Nullifiers</dt>
                <dd>3b7e90…41c2, c04d1f…9a0e</dd>
              </dl>
              <p className="illustration">Illustration. The demo computes the real values.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="kicker">The problem</div>
          <h2 style={{ marginTop: 10 }}>Stopping prescription fraud usually means building a list of who takes what.</h2>
          <p className="sub">
            Paper and PDF prescriptions are easy to copy, edit and fill twice. Doctor shopping, collecting the same opioid from several
            prescribers and pharmacies, is invisible to each one of them. The standard fix is a central monitoring database that records
            every controlled prescription against a named patient. It works, and it is a register of everyone on painkillers, sedatives
            or ADHD medication, kept forever, by someone. Ampoule enforces the same rules with nothing to leak.
          </p>
          <div className="steps3">
            <div className="card step3">
              <div className="n">01 / DOCTOR</div>
              <h3>Seals it</h3>
              <p>
                The prescription is hashed with a random salt and appended to a Merkle tree. The circuit proves the doctor holds the key
                the council registered for their licence. The chain learns that this doctor issued one prescription, and its class.
              </p>
            </div>
            <div className="card step3">
              <div className="n">02 / PATIENT</div>
              <h3>Proves it</h3>
              <p>
                At the counter, the phone proves the prescription is in the tree without saying which leaf, that it was written for the
                holder of this phone's secret, and publishes two nullifiers: one per fill, one per person, class and 30-day window.
              </p>
            </div>
            <div className="card step3">
              <div className="n">03 / PHARMACIST</div>
              <h3>Checks it</h3>
              <p>
                The fill record lands under the pharmacy's one-time counter request, with a commitment to the medicine and quantity. The
                patient's phone opens it for the pharmacist alone, who hands over exactly what was proven.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="kicker">The privacy boundary</div>
          <h2 style={{ marginTop: 10 }}>Who learns what</h2>
          <p className="sub">
            Every value that reaches the ledger is marked with <code>disclose()</code> in the contract source, so this table can be read
            straight off the code. The demo searches every transaction it makes for the private values, and shows you the result.
          </p>
          <div className="card" style={{ marginTop: 28, overflowX: 'auto' }}>
            <table className="plain">
              <thead>
                <tr>
                  <th />
                  <th>Public ledger</th>
                  <th>Patient's phone</th>
                  <th>Pharmacy</th>
                </tr>
              </thead>
              <tbody>
                {BOUNDARY.map(([what, chain, phone, pharmacy]) => (
                  <tr key={what}>
                    <td>
                      <b>{what}</b>
                    </td>
                    <td>{chain}</td>
                    <td>{phone}</td>
                    <td>{pharmacy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="kicker">The rules</div>
          <h2 style={{ marginTop: 10 }}>What the contract refuses</h2>
          <p className="sub">
            A refusal happens on the caller's own device while the proof is being built. Nothing is submitted, no fee is paid, and the
            chain never sees the attempt.
          </p>
          <div className="rules">
            {REFUSALS.map((g) => (
              <div className="card" key={g.title}>
                <h3>{g.title}</h3>
                <ul>
                  {g.items.map(([code, text]) => (
                    <li key={code}>
                      <code>{code}</code>
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="kicker">Why Midnight</div>
          <h2 style={{ marginTop: 10 }}>Private inputs, public rules, and nothing in between to trust</h2>
          <p className="sub">
            The cap has to hold across pharmacies that do not trust each other, so it needs shared state everyone can verify. The
            inputs are medical records, so they cannot be in that state. Midnight's Compact contracts take private witnesses, prove the
            rules over them in zero knowledge, and publish only what the code explicitly discloses. Authorization is always proof of a
            secret, never a wallet address, so whoever pays the fee learns nothing and links nothing.
          </p>
          <div className="stack-grid">
            <div className="card stat">
              <b>6</b>
              <span>circuits: three authority, issue, enroll, fill</span>
            </div>
            <div className="card stat">
              <b>2</b>
              <span>historic Merkle trees: patients and prescriptions</span>
            </div>
            <div className="card stat">
              <b>2</b>
              <span>nullifier sets: per fill, and per person per class per window</span>
            </div>
            <div className="card stat">
              <b>0</b>
              <span>fields that hold anything about a patient</span>
            </div>
          </div>
          <div className="ctas" style={{ display: 'flex', gap: 12, marginTop: 32, flexWrap: 'wrap' }}>
            <Link className="btn accent" to="/demo">
              Run the demo
            </Link>
            <Link className="btn ghost" to="/live">
              Run it live with Lace
            </Link>
            <Link className="btn ghost" to="/ledger">
              See the Preview deployment
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
