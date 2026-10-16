// SPDX-License-Identifier: Apache-2.0
//
// The fee-paying wallet. `wallet new` makes one offline and prints where to send faucet funds;
// `wallet status` syncs it, designates its NIGHT to generate DUST, and reports balances.
import { existsSync } from 'node:fs';
import { createHeadlessWallet, walletAddressOf } from '@ampoule/sdk/node';
import {
  flag,
  hasFlag,
  heading,
  loadMnemonic,
  network,
  newMnemonic,
  note,
  readJson,
  say,
  seedHexOf,
  UsageError,
  walletPath,
  writeJson,
  type Args,
  type WalletFile,
} from './common.js';

export const FAUCETS: Record<string, string> = {
  preview: 'https://faucet.preview.midnight.network/ (or https://midnight-tmnight-preview.nethermind.dev/)',
  preprod: 'https://faucet.preprod.midnight.network/ (or https://midnight-tmnight-preprod.nethermind.dev/)',
};

export async function wallet(args: Args): Promise<number> {
  const n = network(args);
  const sub = args.positional[0] ?? 'status';

  if (sub === 'new') {
    const path = walletPath(n);
    if (existsSync(path) && !hasFlag(args, 'force')) {
      throw new UsageError(`${path} already exists; pass --force to replace it (its funds would be orphaned)`);
    }
    const mnemonic = newMnemonic();
    const address = walletAddressOf(seedHexOf(mnemonic), n);
    writeJson(path, { network: n, createdAt: new Date().toISOString(), mnemonic, address } satisfies WalletFile);
    heading(`new ${n} wallet`);
    say(`  address  ${address}`);
    say(`  secret   ${path} (gitignored, never printed)`);
    if (FAUCETS[n]) say(`\n  fund it with tNIGHT at ${FAUCETS[n]}, then run: npm run cli -- wallet status --network ${n}`);
    return 0;
  }

  if (sub === 'address') {
    const mnemonic = loadMnemonic(args, n);
    say(walletAddressOf(seedHexOf(mnemonic), n));
    return 0;
  }

  if (sub === 'status') {
    const mnemonic = loadMnemonic(args, n);
    const w = await createHeadlessWallet({
      seedHex: seedHexOf(mnemonic),
      network: n,
      syncTimeoutMs: Number(flag(args, 'sync-timeout-minutes') ?? 45) * 60_000,
      log: note,
    });
    try {
      const before = await w.balances();
      heading(`${n} wallet`);
      say(`  address    ${w.address}`);
      say(`  tNIGHT     ${before.night}`);
      say(`  DUST       ${before.dust}`);
      if (!hasFlag(args, 'no-dust')) {
        const after = await w.ensureDust();
        say(`  DUST now   ${after.dust} (ready to pay fees)`);
      }
      const saved = existsSync(walletPath(n)) ? readJson<WalletFile>(walletPath(n)) : undefined;
      if (saved && saved.address !== w.address) writeJson(walletPath(n), { ...saved, address: w.address });
      return 0;
    } finally {
      await w.close();
    }
  }

  throw new UsageError(`unknown wallet command "${sub}"; use new, address or status`);
}
