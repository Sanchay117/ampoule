// SPDX-License-Identifier: Apache-2.0
//
// A funded wallet, its provider bundle, and the participants of the cast bound to a backend.
import {
  Controller,
  Council,
  createProviders,
  Doctor,
  id32,
  NetworkBackend,
  Patient,
  Pharmacy,
  Registrar,
  type AmpouleBackend,
  type AmpouleProviders,
  type ChainNetwork,
  type WalletAdapter,
} from '@ampoule/sdk';
import { createHeadlessWallet, levelPrivateState, nodeZkConfigProvider, type HeadlessWallet } from '@ampoule/sdk/node';
import {
  flag,
  loadMnemonic,
  loadOrCreateCast,
  note,
  privateStatePassword,
  privateStatePath,
  secret,
  seedHexOf,
  zkAssets,
  type Args,
  type CastFile,
} from './common.js';

export interface Session {
  network: ChainNetwork;
  wallet: HeadlessWallet;
  providers: AmpouleProviders;
  assets: string;
  /** Every transaction id submitted through this session, in order. */
  submitted: string[];
  close(): Promise<void>;
}

export async function openSession(args: Args, n: ChainNetwork): Promise<Session> {
  const assets = zkAssets(args);
  const mnemonic = loadMnemonic(args, n);
  const wallet = await createHeadlessWallet({
    seedHex: seedHexOf(mnemonic),
    network: n,
    syncTimeoutMs: Number(flag(args, 'sync-timeout-minutes') ?? 45) * 60_000,
    log: note,
  });
  const balances = await wallet.ensureDust();
  note(`fee payer ${wallet.address} holds ${balances.dust} DUST`);

  const submitted: string[] = [];
  const recording: WalletAdapter = {
    ...wallet.adapter,
    async submitTx(tx) {
      const id = await wallet.adapter.submitTx(tx);
      submitted.push(id);
      return id;
    },
  };
  const providers = createProviders({
    network: n,
    wallet: recording,
    zkConfigProvider: nodeZkConfigProvider(assets),
    privateStateProvider: levelPrivateState({
      path: privateStatePath(n),
      password: privateStatePassword(),
      accountId: String(wallet.adapter.getCoinPublicKey()),
    }),
    webSocket: globalThis.WebSocket,
  });
  return { network: n, wallet, providers, assets, submitted, close: () => wallet.close() };
}

export function connect(session: Session, contractAddress: string): NetworkBackend {
  return NetworkBackend.connect({ network: session.network, providers: session.providers, assetsPath: session.assets, contractAddress });
}

/** The participants of the scenario, each holding only their own secret. */
export function castOn(backend: AmpouleBackend, cast: CastFile) {
  return {
    council: new Council(backend, secret(cast.council)),
    controller: new Controller(backend, secret(cast.controller)),
    registrar: new Registrar(backend, secret(cast.registrar)),
    doctors: cast.doctors.map((d) => ({ ...d, client: new Doctor(backend, id32(d.licence), secret(d.secretKey)) })),
    pharmacies: cast.pharmacies.map((p) => ({ ...p, client: new Pharmacy(backend, id32(p.licence), secret(p.secretKey)) })),
    patients: cast.patients.map((p) => ({ ...p, client: new Patient(backend, secret(p.secretKey)) })),
  };
}

export { loadOrCreateCast };
