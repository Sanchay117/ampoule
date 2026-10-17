// SPDX-License-Identifier: Apache-2.0
//
// Copies the proving keys, verifier keys and ZKIR from the full compile into web/public/zk/,
// where the live page fetches them to deploy the contract and to prove. They are build output
// (about 26 MB) and git-ignored; `npm run compile` makes them, deterministically.
//
//   npm run compile && npm run -w web zk:stage
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const from = join(root, 'contract', 'src', 'managed', 'ampoule');
const to = join(root, 'web', 'public', 'zk');

const keys = join(from, 'keys');
if (!existsSync(keys) || !readdirSync(keys).some((f) => f.endsWith('.prover'))) {
  console.error(`no proving keys in ${keys}; run \`npm run compile\` (the full build, not compile:fast) first`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const dir of ['keys', 'zkir']) cpSync(join(from, dir), join(to, dir), { recursive: true });
const files = ['keys', 'zkir'].flatMap((d) => readdirSync(join(to, d)));
console.log(`staged ${files.length} files into ${to}`);
