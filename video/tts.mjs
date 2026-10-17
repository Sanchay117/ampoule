// SPDX-License-Identifier: Apache-2.0
//
// Narration audio, one clip per scene, from Deepgram's text-to-speech.
//
//   node video/tts.mjs [--env path/to/.env] [--model aura-2-thalia-en] [--only hook,today]
//
// DEEPGRAM_KEY comes from the environment or from the --env file. Clips are cached by
// (model, text), so a re-run only synthesizes what changed. Each clip is then checked for its
// speaking rate and for long silences, the usual signs of a garbled render.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SCENES } from './narration.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const MODEL = arg('model', 'aura-2-thalia-en');
const ONLY = arg('only', null)?.split(',');
const OUT = new URL('out/audio/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const envFile = arg('env', null);
const key = process.env.DEEPGRAM_KEY ?? (envFile && readFileSync(envFile, 'utf8').match(/^DEEPGRAM_KEY=(\S+)/m)?.[1]);
if (!key) throw new Error('set DEEPGRAM_KEY or pass --env <file containing DEEPGRAM_KEY=...>');

async function synth(text) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.deepgram.com/v1/speak?model=${MODEL}&encoding=mp3`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = await res.text();
    if (attempt >= 4 || [400, 401, 402, 403].includes(res.status)) throw new Error(`${res.status} ${body.slice(0, 300)}`);
    console.log(`  ${res.status}, retrying in ${attempt * 5}s`);
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
}

/** Internal silences longer than 0.7 s (ffmpeg prints silencedetect results on stderr). */
function silences(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=n=-40dB:d=0.7', '-f', 'null', '-'], { encoding: 'utf8' });
  return [...r.stderr.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
}

const manifestFile = new URL('manifest.json', OUT);
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};

for (const s of SCENES) {
  if (ONLY && !ONLY.includes(s.id)) continue;
  const input = s.say ?? s.text;
  const hash = createHash('sha256').update(`${MODEL}|${input}`).digest('hex').slice(0, 12);
  const file = new URL(`${s.id}.mp3`, OUT).pathname;
  if (manifest[s.id]?.hash !== hash || !existsSync(file)) {
    process.stdout.write(`synth ${s.id} (${input.length} chars)... `);
    writeFileSync(file, await synth(input));
    console.log('ok');
  }
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
  const wpm = Math.round((s.text.split(/\s+/).length / duration) * 60);
  const gaps = silences(file);
  const warn = [wpm < 110 && 'slow', wpm > 200 && 'fast', gaps.some((g) => g > 1.2) && `long silence ${Math.max(...gaps).toFixed(1)}s`].filter(Boolean);
  manifest[s.id] = { hash, model: MODEL, file: `${s.id}.mp3`, duration, wpm };
  console.log(`${s.id.padEnd(10)} ${duration.toFixed(2)}s  ${wpm} wpm${warn.length ? '  WARN ' + warn.join(', ') : ''}`);
}
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
const total = SCENES.reduce((a, s) => a + (manifest[s.id]?.duration ?? 0), 0);
console.log(`total narration ${total.toFixed(1)}s`);
