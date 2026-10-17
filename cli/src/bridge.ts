// SPDX-License-Identifier: Apache-2.0
//
// A local stand-in for a DApp Connector wallet. It lends this CLI's synced, funded wallet to the
// site's live page, so the whole browser path (deploy, prove, balance, sign, submit) can run
// without installing Lace. Like a wallet extension, the bridge only balances, signs and
// submits; the page proves with the local proof server and never sees the wallet's keys.
//
// Two locks keep other sites away from the wallet: browsers may call it only from the allowed
// origins, and every call must carry the token printed at start.
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fromHex, hex, NETWORKS } from '@ampoule/sdk';
import { Transaction, type Binding, type PreBinding, type Proof, type SignatureEnabled } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { createHeadlessWallet } from '@ampoule/sdk/node';
import { flag, heading, loadMnemonic, network, note, say, seedHexOf, type Args } from './common.js';

const ORIGINS = ['http://localhost:5199', 'http://127.0.0.1:5199', 'https://sanchay117.github.io'];

export async function bridge(args: Args): Promise<number> {
  const n = network(args);
  const port = Number(flag(args, 'port') ?? 6301);
  const origins = [...ORIGINS, ...(flag(args, 'origin')?.split(',') ?? [])];
  const token = hex(randomBytes(16));
  const endpoints = NETWORKS[n];

  const wallet = await createHeadlessWallet({
    seedHex: seedHexOf(loadMnemonic(args, n)),
    network: n,
    syncTimeoutMs: Number(flag(args, 'sync-timeout-minutes') ?? 45) * 60_000,
    log: note,
  });
  const balances = await wallet.ensureDust();
  note(`fee payer ${wallet.address} holds ${balances.dust} DUST`);

  const routes: Record<string, (body: { tx?: string }) => Promise<unknown>> = {
    'GET /config': async () => ({
      indexerUri: endpoints.indexerHttpUrl,
      indexerWsUri: endpoints.indexerWsUrl,
      proverServerUri: endpoints.proofServerUrl,
      substrateNodeUri: endpoints.nodeUrl,
      networkId: n,
    }),
    // Hex keys, not Bech32m: the page knows it is talking to the bridge.
    'GET /keys': async () => ({
      coinPublicKey: String(wallet.adapter.getCoinPublicKey()),
      encryptionPublicKey: String(wallet.adapter.getEncryptionPublicKey()),
      unshieldedAddress: wallet.address,
    }),
    'GET /dust': async () => {
      const b = await wallet.balances();
      return { balance: b.dust.toString(), night: b.night.toString() };
    },
    'POST /balance': async ({ tx }) => {
      const unbound = Transaction.deserialize<SignatureEnabled, Proof, PreBinding>('signature', 'proof', 'pre-binding', fromHex(tx ?? ''));
      const sealed = await wallet.adapter.balanceTx(unbound as never);
      return { tx: hex(sealed.serialize()) };
    },
    'POST /submit': async ({ tx }) => {
      const sealed = Transaction.deserialize<SignatureEnabled, Proof, Binding>('signature', 'proof', 'binding', fromHex(tx ?? ''));
      note(`submitting ${sealed.identifiers()[0] ?? 'a transaction'}`);
      return { txId: await wallet.adapter.submitTx(sealed) };
    },
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return void res.writeHead(origin && origins.includes(origin) ? 204 : 403).end();
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if ((origin && !origins.includes(origin)) || req.headers.authorization !== `Bearer ${token}`) return send(403, { error: 'forbidden' });
    const route = routes[`${req.method} ${(req.url ?? '').split('?')[0]}`];
    if (!route) return send(404, { error: 'not found' });
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (raw += c));
    req.on('end', () => {
      Promise.resolve()
        .then(() => route(raw ? (JSON.parse(raw) as { tx?: string }) : {}))
        .then((body) => send(200, body))
        .catch((e: unknown) => {
          note(`error: ${e instanceof Error ? e.message : String(e)}`);
          send(500, { error: e instanceof Error ? e.message : String(e) });
        });
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const bridgeUrl = `http://127.0.0.1:${port}`;
  heading('wallet bridge ready');
  say(`  wallet     ${wallet.address} on ${n}`);
  say(`  proving    the page uses the proof server at ${endpoints.proofServerUrl}`);
  say(`  open       http://localhost:5199/#/live?bridge=${encodeURIComponent(bridgeUrl)}&token=${token}`);
  say('  Ctrl+C to stop.');
  await new Promise<void>((resolve) => process.once('SIGINT', resolve));
  server.close();
  await wallet.close();
  return 0;
}
