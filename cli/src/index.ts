// SPDX-License-Identifier: Apache-2.0
//
// Ampoule command line. Commands load lazily, so `verify` (the one anyone can run) never loads
// the wallet SDK or the proving keys.
import { fail, parseArgs, say, UsageError, type Args } from './common.js';

const USAGE = `ampoule cli (network defaults to preview)

  wallet new      [--network <id>] [--force]
      Creates the fee-paying wallet offline, saves it to cli/.secrets/ and prints the address
      to fund from the faucet.
  wallet status   [--network <id>]
      Syncs the wallet, designates its tNIGHT to generate DUST, prints balances.

  deploy          [--network <id>] [--force]
      Deploys Ampoule (one transaction, six verifier keys) and writes cli/deployments/<id>.json.

  scenario        [--network <id>] [--fresh]
      Runs the story with real proofs: authorities, two doctors, two pharmacies, two patients,
      fills, a doctor-shopping attempt, a stolen token, a forgery and a suspension. Resumable.
      Writes cli/evidence/<id>-<time>.json.

  verify          [--network <id>] [--evidence <path>]
      Reads the contract back through the public indexer and checks it against the evidence:
      state, call history, issuance, and a search of every raw transaction for private values.
      Needs no wallet. Exits non-zero on any failure.

  bridge          [--network <id>] [--port 6301]
      Lends the funded wallet to the site's live page on localhost, in place of Lace. The page
      proves with the local proof server; the bridge balances, signs and submits.

Networks: undeployed (local devnet), preview, preprod.`;

async function run(args: Args): Promise<number> {
  switch (args.command) {
    case 'wallet':
      return (await import('./wallet.js')).wallet(args);
    case 'deploy':
      return (await import('./deploy.js')).deploy(args);
    case 'scenario':
      return (await import('./scenario.js')).scenario(args);
    case 'verify':
      return (await import('./verify.js')).verify(args);
    case 'bridge':
      return (await import('./bridge.js')).bridge(args);
    case '':
    case 'help':
    case '--help':
      say(USAGE);
      return 0;
    default:
      throw new UsageError(`unknown command "${args.command}"\n\n${USAGE}`);
  }
}

let code = 0;
try {
  code = await run(parseArgs(process.argv.slice(2)));
} catch (error) {
  code = 1;
  fail(error instanceof UsageError ? `\n${error.message}` : `\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
}
// The wallet and the indexer client hold sockets open; nothing is buffered by now.
process.exit(code);
