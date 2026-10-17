// SPDX-License-Identifier: Apache-2.0
//
// Contact sheets for reviewing recorded scenes: n frames per scene, evenly spaced in recorded time.
//   node video/contact.mjs [scene ...] [--n 8]
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REC = join(HERE, 'out', 'rec');
const nArg = process.argv.indexOf('--n');
const N = nArg > 0 ? Number(process.argv[nArg + 1]) : 8;
const named = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--n');
const scenes = named.length ? named : readdirSync(REC, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

for (const id of scenes) {
  const meta = JSON.parse(readFileSync(join(REC, id, 'meta.json'), 'utf8'));
  const picks = [];
  for (let i = 0; i < N; i++) {
    const t = (meta.end * (i + 0.5)) / N;
    const f = meta.frames.filter((x) => x.t <= t).at(-1) ?? meta.frames[0];
    picks.push(join(REC, id, f.f));
  }
  const list = join(REC, `${id}-contact.txt`);
  writeFileSync(list, picks.map((p) => `file '${p}'`).join('\n'));
  const out = join(HERE, 'out', `contact-${id}.jpg`);
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=640:-1,tile=2x${Math.ceil(N / 2)}:padding=6`, '-frames:v', '1', out]);
  console.log(out);
}
