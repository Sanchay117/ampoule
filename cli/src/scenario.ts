// SPDX-License-Identifier: Apache-2.0
//
// The story, on a live network, with real proofs. Every participant acts through the SDK with
// only their own secret. Attempts the contract must refuse are made too: they fail on the
// caller's machine while the circuit runs, so they leave no transaction, and the evidence file
// records them as refusals next to the transactions that did land.
//
// The run is resumable. Progress (including the prescriptions, which are private) is kept in
// cli/.secrets/<network>-scenario.json; a step that already landed is skipped on a re-run.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DAY,
  decodeDispense,
  decodeRx,
  drugByCode,
  explorerLink,
  hex,
  isRefusal,
  labelOf,
  publicView,
  pureCircuits,
  viewToJson,
  type ChainNetwork,
  type DeploymentFile,
  type Drug,
  type Evidence,
  type Prescription,
  type StepRecord,
  type TxReceipt,
} from '@ampoule/sdk';
import {
  COMPACT_VERSION,
  EVIDENCE_DIR,
  SECRETS_DIR,
  deploymentPath,
  fileStamp,
  hasFlag,
  heading,
  loadOrCreateCast,
  network,
  note,
  readJson,
  say,
  UsageError,
  writeJson,
  type Args,
} from './common.js';
import { castOn, connect, openSession } from './session.js';

interface Progress {
  network: ChainNetwork;
  contractAddress: string;
  steps: Record<string, StepRecord>;
  /** Issued prescriptions by step id, as tokens. Private: never leaves .secrets/. */
  rx: Record<string, string>;
  openings: Record<string, string>;
}

const progressPath = (n: ChainNetwork) => join(SECRETS_DIR, `${n}-scenario.json`);

const needDrug = (code: string): Drug => {
  const d = drugByCode(code);
  if (!d) throw new Error(`no drug ${code}`);
  return d;
};

export async function scenario(args: Args): Promise<number> {
  const n = network(args);
  if (!existsSync(deploymentPath(n))) throw new UsageError(`no deployment for ${n}; run deploy first`);
  const deployment = readJson<DeploymentFile>(deploymentPath(n));
  const cast = loadOrCreateCast(n);

  let progress: Progress =
    existsSync(progressPath(n)) && !hasFlag(args, 'fresh')
      ? readJson<Progress>(progressPath(n))
      : { network: n, contractAddress: deployment.contractAddress, steps: {}, rx: {}, openings: {} };
  if (progress.contractAddress !== deployment.contractAddress) {
    progress = { network: n, contractAddress: deployment.contractAddress, steps: {}, rx: {}, openings: {} };
  }
  const save = () => writeJson(progressPath(n), progress);
  const startedAt = new Date().toISOString();

  const session = await openSession(args, n);
  try {
    const backend = connect(session, deployment.contractAddress);
    const c = castOn(backend, cast);
    const [rao, mehta] = c.doctors;
    const [lotus, neem] = c.pharmacies;
    const [ravi, meera] = c.patients;
    if (!rao || !mehta || !lotus || !neem || !ravi || !meera) throw new Error('the cast file is incomplete');

    /** Runs a step that should land on chain. */
    const tx = async (id: string, label: string, actor: string, circuit: string, run: () => Promise<TxReceipt>) => {
      if (progress.steps[id]) {
        note(`skip  ${label} (landed earlier)`);
        return;
      }
      note(`run   ${label}`);
      const t = Date.now();
      const r = await run();
      progress.steps[id] = {
        id,
        label,
        actor,
        circuit,
        outcome: 'transaction',
        txId: r.txId,
        txHash: r.txHash,
        blockHeight: r.blockHeight,
        explorer: explorerLink(n, 'tx', r.txHash),
        durationMs: Date.now() - t,
        at: new Date().toISOString(),
      };
      save();
      note(`      landed in block ${r.blockHeight} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    };

    /** Runs a step the contract must refuse; anything else is a failure of the run. */
    const refused = async (id: string, label: string, actor: string, circuit: string, want: string, run: () => Promise<unknown>) => {
      note(`try   ${label}`);
      const t = Date.now();
      try {
        await run();
      } catch (e) {
        if (isRefusal(e) && e.code === want) {
          progress.steps[id] = {
            id,
            label,
            actor,
            circuit,
            outcome: 'refused',
            refusal: { code: e.code, explanation: e.explanation },
            durationMs: Date.now() - t,
            at: new Date().toISOString(),
          };
          save();
          note(`      refused ${e.code} on the caller's machine: no transaction, no fee`);
          return;
        }
        throw e;
      }
      throw new Error(`${label}: expected the contract to refuse with ${want}, but the call went through`);
    };

    const now = await backend.now();
    const issue = (id: string, label: string, doctor: typeof rao, patient: typeof ravi, drug: string, extra: { fills?: bigint; days?: bigint } = {}) =>
      tx(id, label, doctor.name, 'issue', async () => {
        const rx = doctor.client.write({
          patient: patient.client.publicKey,
          drug: needDrug(drug),
          fills: extra.fills,
          notAfter: now + (extra.days ?? 30n) * DAY,
        });
        const out = await doctor.client.issue(rx);
        progress.rx[id] = out.token;
        return out.receipt;
      });
    const rxOf = (id: string): Prescription => {
      const t = progress.rx[id];
      if (!t) throw new Error(`prescription ${id} was not issued`);
      return decodeRx(t);
    };
    const fill = (id: string, label: string, patient: typeof ravi, rxId: string, pharmacy: typeof lotus) =>
      tx(id, label, patient.name, 'fill', async () => {
        const out = await patient.client.fill(rxOf(rxId), pharmacy.client.counterRequest().request);
        progress.openings[id] = out.token;
        return out.receipt;
      });

    heading('authorities set up the network');
    await tx('policy-opioids', 'Drug controller caps opioid analgesics at 1 fill per 30 days', 'Drug controller', 'setPolicy', () =>
      c.controller.setPolicy(1n, 30n * DAY, 1n),
    );
    await tx('license-rao', `Medical council licenses ${rao.name} (${rao.licence})`, 'Medical council', 'setDoctor', () => c.council.license(rao.client));
    await tx('license-mehta', `Medical council licenses ${mehta.name} (${mehta.licence})`, 'Medical council', 'setDoctor', () => c.council.license(mehta.client));
    await tx('license-lotus', `Drug controller licenses ${lotus.name} (${lotus.licence})`, 'Drug controller', 'setPharmacy', () => c.controller.license(lotus.client));
    await tx('license-neem', `Drug controller licenses ${neem.name} (${neem.licence})`, 'Drug controller', 'setPharmacy', () => c.controller.license(neem.client));
    await tx('enroll-ravi', `Registrar enrolls ${ravi.name}'s patient key`, 'Health ID registrar', 'enrollPatient', () => c.registrar.enroll(ravi.client.publicKey));
    await tx('enroll-meera', `Registrar enrolls ${meera.name}'s patient key`, 'Health ID registrar', 'enrollPatient', () => c.registrar.enroll(meera.client.publicKey));

    heading('an ordinary prescription');
    await issue('rx-amox', `${rao.name} prescribes amoxicillin to ${ravi.name}`, rao, ravi, 'amoxicillin-500-cap');
    await fill('fill-amox', `${ravi.name} fills it at ${lotus.name}`, ravi, 'rx-amox', lotus);
    if (!progress.steps['check-amox']) {
      const check = await lotus.client.verify(decodeDispense(progress.openings['fill-amox']!));
      if (!check.ok) throw new Error(`pharmacist check failed: ${check.message}`);
      progress.steps['check-amox'] = {
        id: 'check-amox',
        label: `${lotus.name} checks the patient's opening against the fill record on chain`,
        actor: lotus.name,
        circuit: '(read only)',
        outcome: 'checked',
        detail: { drug: check.drug?.code, quantity: check.quantity.toString(), matchesCommitment: true },
        durationMs: 0,
        at: new Date().toISOString(),
      };
      save();
    }
    await refused('refill-amox', `${ravi.name} tries to fill the same prescription again at ${neem.name}`, ravi.name, 'fill', 'ALREADY_FILLED', () =>
      ravi.client.fill(rxOf('rx-amox'), neem.client.counterRequest().request),
    );

    heading('a controlled drug, and doctor shopping');
    await issue('rx-tramadol-rao', `${rao.name} prescribes tramadol to ${ravi.name}`, rao, ravi, 'tramadol-50-tab', { days: 60n });
    await fill('fill-tramadol', `${ravi.name} fills the tramadol at ${lotus.name}`, ravi, 'rx-tramadol-rao', lotus);
    await issue('rx-tramadol-mehta', `${ravi.name} gets a second tramadol prescription from ${mehta.name}`, mehta, ravi, 'tramadol-50-tab', { days: 60n });
    await refused('shop-tramadol', `${ravi.name} tries to fill it at ${neem.name}, a different pharmacy in another city`, ravi.name, 'fill', 'CAP_REACHED', () =>
      ravi.client.fill(rxOf('rx-tramadol-mehta'), neem.client.counterRequest().request),
    );

    heading('fraud that never reaches the chain');
    await refused('stolen-token', `${meera.name} tries to fill ${ravi.name}'s tramadol prescription`, meera.name, 'fill', 'NOT_YOUR_PRESCRIPTION', () =>
      meera.client.fill(rxOf('rx-tramadol-mehta'), neem.client.counterRequest().request),
    );
    await refused('forged', `${ravi.name} edits the quantity on a prescription from 10 to 60 tablets`, ravi.name, 'fill', 'NO_SUCH_PRESCRIPTION', () =>
      ravi.client.fill({ ...rxOf('rx-tramadol-mehta'), quantity: 60n }, neem.client.counterRequest().request),
    );

    heading('a suspended licence');
    await issue('rx-metformin', `${mehta.name} prescribes metformin to ${meera.name}`, mehta, meera, 'metformin-500-tab');
    await tx('suspend-mehta', `Medical council suspends ${mehta.name}`, 'Medical council', 'setDoctor', () => c.council.suspend(mehta.client));
    await refused('suspended', `${meera.name} tries to fill ${mehta.name}'s prescription`, meera.name, 'fill', 'DOCTOR_SUSPENDED', () =>
      meera.client.fill(rxOf('rx-metformin'), lotus.client.counterRequest().request),
    );

    // ------------------------------------------------------------------------------ evidence
    const view = publicView(await backend.ledger());
    const steps = Object.values(progress.steps);
    const heights = steps.filter((s) => s.blockHeight).map((s) => s.blockHeight!);
    const evidence: Evidence = {
      project: 'ampoule',
      network: n,
      contractAddress: deployment.contractAddress,
      compactVersion: COMPACT_VERSION,
      startedAt,
      finishedAt: new Date().toISOString(),
      explorer: deployment.explorer,
      deployTx: deployment.deployTx,
      steps,
      summary: {
        transactions: steps.filter((s) => s.outcome === 'transaction').length,
        refusals: steps.filter((s) => s.outcome === 'refused').map((s) => ({ id: s.id, code: s.refusal!.code })),
        firstBlock: Math.min(...heights),
        lastBlock: Math.max(...heights),
      },
      finalState: viewToJson(view),
      disclosedForAudit: {
        note:
          'Testnet demo data, published only so anyone can check that the chain holds none of it. ' +
          "In real use these values never leave the doctor's and the patient's devices.",
        patients: c.patients.map((p) => ({ name: p.name, patientKey: hex(p.client.publicKey) })),
        prescriptions: Object.keys(progress.rx).map((step) => {
          const rx = rxOf(step);
          return {
            step,
            drugCode: labelOf(rx.drug) ?? hex(rx.drug),
            patient: hex(rx.patient),
            doctor: labelOf(rx.doctor) ?? hex(rx.doctor),
            quantity: rx.quantity.toString(),
            drugClass: rx.drugClass.toString(),
            fills: rx.fills.toString(),
            notAfter: rx.notAfter.toString(),
            salt: hex(rx.salt),
            leaf: hex(pureCircuits.rxLeafOf(rx)),
          };
        }),
        dispenseSalts: Object.entries(progress.openings).map(([step, token]) => ({ step, salt: hex(decodeDispense(token).salt) })),
        publicControls: [rao.licence, lotus.licence],
      },
    };
    const path = join(EVIDENCE_DIR, `${n}-${fileStamp()}.json`);
    writeJson(path, evidence);

    heading('done');
    say(`  ${evidence.summary.transactions} transactions landed, ${evidence.summary.refusals.length} attempts refused before submission`);
    say(`  ${view.totals.issued} prescriptions issued, ${view.totals.filled} filled; no patient identifier on chain`);
    say(`  evidence ${path}`);
    say(`  verify with: npm run cli -- verify --network ${n}`);
    return 0;
  } finally {
    await session.close();
  }
}
