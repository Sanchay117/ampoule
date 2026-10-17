// SPDX-License-Identifier: Apache-2.0
//
// The live run: a short version of the story on Midnight Preview, with real proofs, paid by
// the connected wallet. It deploys a fresh contract, so this browser holds every participant's
// secret (council, controller, registrar, two doctors, two pharmacies, one patient) and each
// participant acts through the same SDK role client the CLI and the demo use.
//
// Progress, including those secrets and the prescriptions, is kept in this browser's
// localStorage so a reload can resume. They are testnet personas, and the page says so.
//
// After every transaction the page downloads its raw bytes from the public indexer and searches
// them for the step's private values, as the audit does for the whole contract.
import {
  auditState,
  auditTransactions,
  connectedWalletAdapter,
  Controller,
  Council,
  createProviders,
  DAY,
  decodeDispense,
  decodeRx,
  Doctor,
  drugByCode,
  explorerLink,
  fetchContractActions,
  fetchZkConfigProvider,
  fromHex,
  hex,
  id32,
  inMemoryPrivateStateProvider,
  isRefusal,
  labelOf,
  NetworkBackend,
  needle,
  Patient,
  Pharmacy,
  publicKeyOf,
  publicView,
  pureCircuits,
  randomBytes32,
  Registrar,
  viewToJson,
  walletProofProvider,
  type AuditCheck,
  type ContractAction,
  type DeploymentFile,
  type Evidence,
  type Prescription,
  type StepRecord,
  type TxReceipt,
} from '@ampoule/sdk';
import { LIVE_NETWORK, type Connected } from './wallet';

const STORE = 'ampoule.live.v1';
const COMPACT_VERSION = '0.31.1';

type ProofProvider = Awaited<ReturnType<typeof walletProofProvider>>;

export interface StepScan {
  /** Private values searched for, by name. */
  searched: string[];
  found: string[];
  /** Public values searched the same way; each should be found. */
  controls: Array<{ value: string; found: boolean }>;
  rawBytes: number;
}

export interface LiveStep extends StepRecord {
  scan?: StepScan;
}

export interface LiveSave {
  version: 1;
  network: typeof LIVE_NETWORK;
  startedAt: string;
  cast: Record<'council' | 'controller' | 'registrar' | 'rao' | 'mehta' | 'lotus' | 'neem' | 'ravi', string>;
  deployment?: DeploymentFile;
  steps: Record<string, LiveStep>;
  /** Prescriptions by step id, as tokens. */
  rx: Record<string, string>;
  /** Dispense openings by step id, as tokens. */
  openings: Record<string, string>;
}

export interface StepDef {
  id: string;
  label: string;
  actor: string;
  circuit: string;
  kind: 'deploy' | 'transaction' | 'refused' | 'checked';
  expect?: string;
  /** What this step shows, in one sentence. */
  why: string;
}

export const PEOPLE = {
  rao: { name: 'Dr Asha Rao', licence: 'MC-DL-58213' },
  mehta: { name: 'Dr Vikram Mehta', licence: 'MC-MH-11902' },
  lotus: { name: 'Lotus Pharmacy', licence: 'DL-RX-20B-4471' },
  neem: { name: 'Neem Chemists', licence: 'MH-RX-21B-0932' },
} as const;

export const STEPS: StepDef[] = [
  { id: 'deploy', label: 'Deploy your own Ampoule contract', actor: 'You', circuit: 'deploy', kind: 'deploy', why: 'Seals the hashes of the council, controller and registrar keys this browser just made. All six verifier keys travel in this one transaction.' },
  { id: 'policy-opioids', label: 'Drug controller caps opioid analgesics at 1 fill per person per 30 days', actor: 'Drug controller', circuit: 'setPolicy', kind: 'transaction', why: 'The rule every pharmacy will enforce.' },
  { id: 'license-rao', label: `Medical council licenses ${PEOPLE.rao.name} (${PEOPLE.rao.licence})`, actor: 'Medical council', circuit: 'setDoctor', kind: 'transaction', why: 'Publishes her licence number and a hash of her key.' },
  { id: 'license-lotus', label: `Drug controller licenses ${PEOPLE.lotus.name} (${PEOPLE.lotus.licence})`, actor: 'Drug controller', circuit: 'setPharmacy', kind: 'transaction', why: 'Only licensed pharmacies can receive a fill.' },
  { id: 'enroll-ravi', label: "Registrar enrolls Ravi's patient key", actor: 'Health ID registrar', circuit: 'enrollPatient', kind: 'transaction', why: 'Adds one hash to the patient tree. His name never goes anywhere.' },
  { id: 'rx-tramadol-rao', label: `${PEOPLE.rao.name} prescribes tramadol 50 mg, 10 tablets, to Ravi`, actor: PEOPLE.rao.name, circuit: 'issue', kind: 'transaction', why: 'The chain gets her licence number, the class and one hash. The prescription goes to Ravi.' },
  { id: 'fill-tramadol', label: `Ravi fills it at ${PEOPLE.lotus.name}`, actor: 'Ravi', circuit: 'fill', kind: 'transaction', why: 'One proof of every rule: enrolled, issued to him, licensed doctor, not expired, unused, under the cap.' },
  { id: 'check-tramadol', label: `${PEOPLE.lotus.name} checks what Ravi's phone shows against the fill record`, actor: PEOPLE.lotus.name, circuit: '(read only)', kind: 'checked', why: 'The pharmacist learns the drug and quantity from the phone and confirms the chain committed to exactly that.' },
  { id: 'refill-tramadol', label: 'Ravi tries to fill the same prescription again', actor: 'Ravi', circuit: 'fill', kind: 'refused', expect: 'ALREADY_FILLED', why: 'A copied or screenshotted prescription is worthless.' },
  { id: 'license-mehta', label: `Medical council licenses ${PEOPLE.mehta.name} (${PEOPLE.mehta.licence})`, actor: 'Medical council', circuit: 'setDoctor', kind: 'transaction', why: 'A second doctor, in another city.' },
  { id: 'license-neem', label: `Drug controller licenses ${PEOPLE.neem.name} (${PEOPLE.neem.licence})`, actor: 'Drug controller', circuit: 'setPharmacy', kind: 'transaction', why: 'A second pharmacy, in another city.' },
  { id: 'rx-tramadol-mehta', label: `Ravi gets a second tramadol prescription from ${PEOPLE.mehta.name}`, actor: PEOPLE.mehta.name, circuit: 'issue', kind: 'transaction', why: 'A real prescription from a real doctor, who has no way to know about the first.' },
  { id: 'shop-tramadol', label: `Ravi tries to fill it at ${PEOPLE.neem.name}`, actor: 'Ravi', circuit: 'fill', kind: 'refused', expect: 'CAP_REACHED', why: 'Doctor shopping: the cap holds across doctors and pharmacies, and nobody learned who Ravi is.' },
];

export function newSave(): LiveSave {
  const sk = () => hex(randomBytes32());
  return {
    version: 1,
    network: LIVE_NETWORK,
    startedAt: new Date().toISOString(),
    cast: { council: sk(), controller: sk(), registrar: sk(), rao: sk(), mehta: sk(), lotus: sk(), neem: sk(), ravi: sk() },
    steps: {},
    rx: {},
    openings: {},
  };
}

export function loadSave(): LiveSave | undefined {
  try {
    const raw = localStorage.getItem(STORE);
    const s = raw ? (JSON.parse(raw) as LiveSave) : undefined;
    return s?.version === 1 && s.network === LIVE_NETWORK ? s : undefined;
  } catch {
    return undefined;
  }
}

export function storeSave(s: LiveSave): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // Private windows may refuse storage; the run still works until the tab closes.
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORE);
  } catch {
    // nothing to clear
  }
}

/** Who proves: the wallet when it offers proving, otherwise the proof server it names (or the local one). */
async function proverFor(wallet: Connected, zk: ReturnType<typeof fetchZkConfigProvider>): Promise<{ provider?: ProofProvider; by: string; url?: string }> {
  if (wallet.kind === 'extension') {
    try {
      return { provider: await walletProofProvider(wallet.api, zk), by: `${wallet.name}, inside the wallet` };
    } catch {
      // Older wallets or settings without proving: fall through to a proof server.
    }
  }
  const url = wallet.config.proverServerUri || 'http://127.0.0.1:6300';
  return { by: `the proof server at ${url}`, url };
}

export class LiveRun {
  readonly save: LiveSave;
  provedBy = '';
  private backend?: NetworkBackend;
  private providers?: ReturnType<typeof createProviders>;

  constructor(
    readonly wallet: Connected,
    save: LiveSave,
    private readonly changed: () => void,
  ) {
    this.save = save;
  }

  get indexer(): string {
    return this.wallet.config.indexerUri;
  }

  get contractAddress(): string | undefined {
    return this.save.deployment?.contractAddress;
  }

  async init(): Promise<void> {
    const zk = fetchZkConfigProvider(new URL('zk/', window.location.href).toString());
    const prover = await proverFor(this.wallet, zk);
    this.provedBy = prover.by;
    this.providers = createProviders({
      network: LIVE_NETWORK,
      wallet: connectedWalletAdapter(this.wallet.api, this.wallet.keys),
      zkConfigProvider: zk,
      proofProvider: prover.provider,
      privateStateProvider: inMemoryPrivateStateProvider(),
      endpoints: {
        indexerHttpUrl: this.wallet.config.indexerUri,
        indexerWsUrl: this.wallet.config.indexerWsUri,
        ...(prover.url ? { proofServerUrl: prover.url } : {}),
      },
      webSocket: WebSocket,
    });
    if (this.contractAddress) {
      this.backend = NetworkBackend.connect({ network: LIVE_NETWORK, providers: this.providers, assetsPath: 'zk', contractAddress: this.contractAddress });
    }
  }

  /** The next step that has not run yet. */
  next(): StepDef | undefined {
    return STEPS.find((s) => !this.save.steps[s.id]);
  }

  private people(backend: NetworkBackend) {
    const c = this.save.cast;
    return {
      council: new Council(backend, fromHex(c.council)),
      controller: new Controller(backend, fromHex(c.controller)),
      registrar: new Registrar(backend, fromHex(c.registrar)),
      rao: new Doctor(backend, id32(PEOPLE.rao.licence), fromHex(c.rao)),
      mehta: new Doctor(backend, id32(PEOPLE.mehta.licence), fromHex(c.mehta)),
      lotus: new Pharmacy(backend, id32(PEOPLE.lotus.licence), fromHex(c.lotus)),
      neem: new Pharmacy(backend, id32(PEOPLE.neem.licence), fromHex(c.neem)),
      ravi: new Patient(backend, fromHex(c.ravi)),
    };
  }

  private record(step: StepDef, started: number, extra: Partial<LiveStep>): void {
    this.save.steps[step.id] = {
      id: step.id,
      label: step.label,
      actor: step.actor,
      circuit: step.circuit,
      outcome: step.kind === 'deploy' ? 'transaction' : step.kind,
      durationMs: Date.now() - started,
      at: new Date().toISOString(),
      ...extra,
    };
    storeSave(this.save);
    this.changed();
  }

  private rxOf(id: string): Prescription {
    const t = this.save.rx[id];
    if (!t) throw new Error(`prescription ${id} has not been issued`);
    return decodeRx(t);
  }

  /** Runs one step. Rejects with the wallet's or the proof server's error if it fails. */
  async run(step: StepDef): Promise<void> {
    if (!this.providers) throw new Error('not connected');
    const started = Date.now();

    if (step.kind === 'deploy') {
      const c = this.save.cast;
      const sealed = {
        council: publicKeyOf('council', fromHex(c.council)),
        controller: publicKeyOf('controller', fromHex(c.controller)),
        registrar: publicKeyOf('registrar', fromHex(c.registrar)),
      };
      const backend = await NetworkBackend.deploy({
        network: LIVE_NETWORK,
        providers: this.providers,
        assetsPath: 'zk',
        councilKey: sealed.council,
        controllerKey: sealed.controller,
        registrarKey: sealed.registrar,
        deployer: { role: 'council', secretKey: fromHex(c.council) },
      });
      this.backend = backend;
      const deployTx = backend.deployTx ?? { txId: '' };
      this.save.deployment = {
        project: 'ampoule',
        network: LIVE_NETWORK,
        contractAddress: backend.contractAddress,
        deployTx,
        deployedAt: new Date().toISOString(),
        compactVersion: COMPACT_VERSION,
        sealed: { council: hex(sealed.council), controller: hex(sealed.controller), registrar: hex(sealed.registrar) },
        explorer: {
          contract: explorerLink(LIVE_NETWORK, 'contract', backend.contractAddress)!,
          deployTx: explorerLink(LIVE_NETWORK, 'tx', deployTx.txHash),
        },
      };
      this.record(step, started, {
        txId: deployTx.txId,
        txHash: deployTx.txHash,
        blockHeight: deployTx.blockHeight,
        explorer: explorerLink(LIVE_NETWORK, 'tx', deployTx.txHash),
      });
      return;
    }

    if (!this.backend) throw new Error('deploy the contract first');
    const p = this.people(this.backend);
    const now = await this.backend.now();
    const tramadol = drugByCode('tramadol-50-tab');
    if (!tramadol) throw new Error('tramadol is missing from the formulary');

    const landed = async (receipt: TxReceipt, scanFor: Array<[string, Uint8Array]>, controls: string[]) => {
      this.record(step, started, {
        txId: receipt.txId,
        txHash: receipt.txHash,
        blockHeight: receipt.blockHeight,
        explorer: explorerLink(LIVE_NETWORK, 'tx', receipt.txHash),
      });
      if (receipt.txHash) {
        const scan = await this.scan(receipt.txHash, scanFor, controls).catch(() => undefined);
        if (scan) {
          this.save.steps[step.id] = { ...this.save.steps[step.id]!, scan };
          storeSave(this.save);
          this.changed();
        }
      }
    };
    const refusedAs = async (attempt: () => Promise<unknown>) => {
      try {
        await attempt();
      } catch (e) {
        if (isRefusal(e) && e.code === step.expect) {
          this.record(step, started, { refusal: { code: e.code, explanation: e.explanation } });
          return;
        }
        throw e;
      }
      throw new Error(`expected ${step.expect}, but the fill went through`);
    };
    const patientSecrets = (): Array<[string, Uint8Array]> => [
      ["Ravi's secret key", fromHex(this.save.cast.ravi)],
      ["Ravi's patient key", p.ravi.publicKey],
    ];
    const rxSecrets = (rx: Prescription): Array<[string, Uint8Array]> => [
      ['the prescription hash', pureCircuits.rxLeafOf(rx)],
      ['the prescription salt', rx.salt],
      [`the drug code (${labelOf(rx.drug) ?? 'drug'})`, new TextEncoder().encode(labelOf(rx.drug) ?? '')],
      ["Ravi's patient key", rx.patient],
    ];

    switch (step.id) {
      case 'policy-opioids':
        return landed(await p.controller.setPolicy(1n, 30n * DAY, 1n), [["the controller's secret key", fromHex(this.save.cast.controller)]], []);
      case 'license-rao':
      case 'license-mehta': {
        const doc = step.id === 'license-rao' ? p.rao : p.mehta;
        const who = step.id === 'license-rao' ? PEOPLE.rao : PEOPLE.mehta;
        return landed(await p.council.license(doc), [["the council's secret key", fromHex(this.save.cast.council)]], [who.licence]);
      }
      case 'license-lotus':
      case 'license-neem': {
        const ph = step.id === 'license-lotus' ? p.lotus : p.neem;
        const who = step.id === 'license-lotus' ? PEOPLE.lotus : PEOPLE.neem;
        return landed(await p.controller.license(ph), [["the controller's secret key", fromHex(this.save.cast.controller)]], [who.licence]);
      }
      case 'enroll-ravi':
        // The enrolment publishes a hash of the patient key, not the key.
        return landed(await p.registrar.enroll(p.ravi.publicKey), [["Ravi's patient key", p.ravi.publicKey], ["Ravi's secret key", fromHex(this.save.cast.ravi)]], []);
      case 'rx-tramadol-rao':
      case 'rx-tramadol-mehta': {
        const doc = step.id === 'rx-tramadol-rao' ? p.rao : p.mehta;
        const rx = doc.write({ patient: p.ravi.publicKey, drug: tramadol, notAfter: now + 60n * DAY });
        const out = await doc.issue(rx);
        this.save.rx[step.id] = out.token;
        storeSave(this.save);
        return landed(out.receipt, [...rxSecrets(rx), ["the doctor's secret key", step.id === 'rx-tramadol-rao' ? fromHex(this.save.cast.rao) : fromHex(this.save.cast.mehta)]], [step.id === 'rx-tramadol-rao' ? PEOPLE.rao.licence : PEOPLE.mehta.licence]);
      }
      case 'fill-tramadol': {
        const rx = this.rxOf('rx-tramadol-rao');
        const out = await p.ravi.fill(rx, p.lotus.counterRequest().request);
        this.save.openings[step.id] = out.token;
        storeSave(this.save);
        return landed(out.receipt, [...patientSecrets(), ...rxSecrets(rx), ['the dispense salt', out.opening.salt]], [PEOPLE.lotus.licence, PEOPLE.rao.licence]);
      }
      case 'check-tramadol': {
        const opening = this.save.openings['fill-tramadol'];
        if (!opening) throw new Error('fill the prescription first');
        const check = await p.lotus.verify(decodeDispense(opening));
        if (!check.ok) throw new Error(`the pharmacist's check failed: ${check.message}`);
        this.record(step, started, { detail: { drug: check.drug?.code, quantity: check.quantity.toString(), matchesCommitment: true } });
        return;
      }
      case 'refill-tramadol':
        return refusedAs(() => p.ravi.fill(this.rxOf('rx-tramadol-rao'), p.lotus.counterRequest().request));
      case 'shop-tramadol':
        return refusedAs(() => p.ravi.fill(this.rxOf('rx-tramadol-mehta'), p.neem.counterRequest().request));
      default:
        throw new Error(`unknown step ${step.id}`);
    }
  }

  /** Downloads one transaction of this contract and searches its raw bytes. */
  private async scan(txHash: string, secrets: Array<[string, Uint8Array]>, controls: string[]): Promise<StepScan | undefined> {
    const address = this.contractAddress;
    if (!address) return undefined;
    // The indexer can trail the node by a block or two.
    for (let attempt = 0; attempt < 10; attempt++) {
      const actions = await fetchContractActions(this.indexer, address);
      const tx = actions.find((a) => a.transaction.hash === txHash);
      if (tx) {
        const raw = tx.transaction.raw.toLowerCase();
        return {
          searched: secrets.map(([k]) => k),
          found: secrets.filter(([, v]) => raw.includes(needle(v))).map(([k]) => k),
          controls: controls.map((value) => ({ value, found: raw.includes(needle(new TextEncoder().encode(value))) })),
          rawBytes: raw.length / 2,
        };
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    return undefined;
  }

  /** The evidence this run produced, in the CLI's format, and the public audit of it. */
  async audit(): Promise<{ checks: AuditCheck[]; actions: ContractAction[]; evidence: Evidence }> {
    const deployment = this.save.deployment;
    if (!deployment || !this.backend) throw new Error('deploy the contract first');
    const p = this.people(this.backend);
    const l = await this.backend.ledger();
    const steps = STEPS.map((s) => this.save.steps[s.id]).filter((s): s is LiveStep => Boolean(s) && s!.circuit !== 'deploy');
    const heights = steps.filter((s) => s.blockHeight).map((s) => s.blockHeight!);
    const evidence: Evidence = {
      project: 'ampoule',
      network: LIVE_NETWORK,
      contractAddress: deployment.contractAddress,
      compactVersion: COMPACT_VERSION,
      startedAt: this.save.startedAt,
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
      finalState: viewToJson(publicView(l)),
      disclosedForAudit: {
        note: 'Testnet personas made in this browser, disclosed to this page only so it can search the chain for them.',
        patients: [{ name: 'Ravi', patientKey: hex(p.ravi.publicKey) }],
        prescriptions: Object.keys(this.save.rx).map((stepId) => {
          const rx = this.rxOf(stepId);
          return {
            step: stepId,
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
        dispenseSalts: Object.entries(this.save.openings).map(([stepId, token]) => ({ step: stepId, salt: hex(decodeDispense(token).salt) })),
        publicControls: [PEOPLE.rao.licence, PEOPLE.lotus.licence],
      },
    };
    const actions = await fetchContractActions(this.indexer, deployment.contractAddress);
    const checks = [...auditTransactions(deployment, evidence, actions), ...auditState(deployment, evidence, l)];
    return { checks, actions, evidence };
  }

  async dust(): Promise<bigint | undefined> {
    try {
      return (await this.wallet.api.getDustBalance()).balance;
    } catch {
      return undefined;
    }
  }
}
