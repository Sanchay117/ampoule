// SPDX-License-Identifier: Apache-2.0
//
// Edits the recorded scenes into the final video:
//   1. per scene, frame stamps become frame durations, and waits for the network (cut marks) are
//      squeezed to a short beat;
//   2. the scene is fitted to its narration: sped up (at most 1.5x) when the action runs long, the
//      last frame held when it runs short;
//   3. scenes are joined with short crossfades, captions and chapter labels are burned in, and the
//      loudness is normalised.
//
//   node video/assemble.mjs [--out video/out/ampoule-demo.mp4] [--no-captions]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES } from './narration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const p = (...parts) => join(HERE, ...parts);
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const OUT_FILE = resolve(arg('out', p('out', 'ampoule-demo.mp4')));
const CAPTIONS = !process.argv.includes('--no-captions');
const manifest = JSON.parse(readFileSync(p('out', 'audio', 'manifest.json'), 'utf8'));
mkdirSync(p('out', 'edit'), { recursive: true });

const FPS = 30;
const LEAD = 0.35; // silence before the narration starts in each scene
const TAIL = 0.5; // after it ends
const XFADE = 0.35; // crossfade between scenes
const CUT_KEEP = 0.5; // what is left of a wait for the network
const MAX_SPEED = 1.5;

const ffmpeg = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

function timeline(id) {
  const meta = JSON.parse(readFileSync(p('out', 'rec', id, 'meta.json'), 'utf8'));
  const cuts = [];
  for (let i = 0; i < meta.marks.length; i++) {
    if (meta.marks[i].name === 'cut-start' && meta.marks[i + 1]?.name === 'cut-end') cuts.push([meta.marks[i].t, meta.marks[i + 1].t]);
  }
  // recorded time -> edited time: each wait [a, b] is squeezed to CUT_KEEP seconds
  const map = (t) => {
    let out = t;
    for (const [a, b] of cuts) {
      const len = b - a;
      const keep = Math.min(len, CUT_KEEP);
      if (t >= b) out -= len - keep;
      else if (t > a) out -= (t - a) * (1 - keep / len);
    }
    return out;
  };
  let frames = meta.frames.map((f) => ({ file: p('out', 'rec', id, f.f), t: map(f.t) }));
  // frames that land on the same instant after squeezing: keep the last
  frames = frames.filter((f, i) => i === frames.length - 1 || frames[i + 1].t > f.t + 1e-4);
  return { frames, end: map(meta.end), cuts: cuts.length };
}

function renderScene(s) {
  const { frames, end, cuts } = timeline(s.id);
  const narration = manifest[s.id].duration;
  const want = LEAD + narration + TAIL;
  const speed = Math.min(MAX_SPEED, Math.max(1, end / want));
  const length = Math.max(want, end / speed);
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, (next - frames[i].t) / speed).toFixed(4)}`);
  }
  // hold the last frame to the scene length (concat needs the last file repeated)
  const last = frames[frames.length - 1].file;
  const held = length - end / speed;
  if (held > 0) lines.push(`file '${last}'`, `duration ${held.toFixed(4)}`);
  lines.push(`file '${last}'`);
  const list = p('out', 'edit', `${s.id}.txt`);
  writeFileSync(list, lines.join('\n'));
  const out = p('out', 'edit', `${s.id}.mov`);
  ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', list,
    '-i', p('out', 'audio', manifest[s.id].file),
    '-filter_complex',
    `[0:v]fps=${FPS},scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[v];` +
      `[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${LEAD * 1000}:all=1,apad,atrim=0:${length.toFixed(3)}[a]`,
    '-map', '[v]', '-map', '[a]', '-t', length.toFixed(3),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-c:a', 'pcm_s16le', out,
  ]);
  console.log(`${s.id.padEnd(10)} recorded ${end.toFixed(1)}s (${cuts} cuts), narration ${narration.toFixed(1)}s -> ${length.toFixed(1)}s at ${speed.toFixed(2)}x`);
  return { id: s.id, file: out, length, narration };
}

// ---------------------------------------------------------------- captions (ASS)
const ts = (t) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${s}`;
};

/** Sentence chunks, long ones split at a comma or colon near the middle. */
function chunks(text) {
  const out = [];
  for (const sentence of text.match(/[^.!?]+[.!?]+/g) ?? [text]) {
    let rest = sentence.trim();
    while (rest.length > 84) {
      const mid = rest.length / 2;
      const cands = [...rest.matchAll(/[,:] /g)].map((m) => m.index + 1);
      if (!cands.length) break;
      const cut = cands.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    out.push(rest);
  }
  return out;
}

function captions(clips) {
  // Colours are &HAABBGGRR. The chapter label uses the site's accent green, #0d7a5a.
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Helvetica Neue,42,&H00FFFFFF,&H00FFFFFF,&H18101B12,&H18101B12,0,0,0,0,100,100,0,0,3,14,0,2,260,260,52,1
Style: Chap,Helvetica Neue,27,&H00FFFFFF,&H00FFFFFF,&H005A7A0D,&H005A7A0D,1,0,0,0,100,100,0.5,0,3,11,0,8,0,0,26,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = [];
  let start = 0;
  for (const c of clips) {
    const s = SCENES.find((x) => x.id === c.id);
    const parts = chunks(s.text);
    const total = parts.reduce((a, x) => a + x.length, 0);
    let t = start + LEAD;
    for (const part of parts) {
      const d = (part.length / total) * c.narration;
      events.push(`Dialogue: 0,${ts(t)},${ts(t + d - 0.05)},Cap,,0,0,0,,${part}`);
      t += d;
    }
    if (s.chapter) events.push(`Dialogue: 1,${ts(start + 0.15)},${ts(start + Math.min(3.4, c.length - 0.3))},Chap,,0,0,0,,{\\fad(250,300)}${s.chapter}`);
    start += c.length - XFADE;
  }
  writeFileSync(p('out', 'edit', 'captions.ass'), head + events.join('\n') + '\n');
}

// ---------------------------------------------------------------- join
const missing = SCENES.filter((s) => !existsSync(p('out', 'rec', s.id, 'meta.json')));
if (missing.length && !process.argv.includes('--draft')) throw new Error(`not recorded yet: ${missing.map((s) => s.id).join(', ')} (pass --draft to cut without them)`);
const clips = SCENES.filter((s) => !missing.includes(s)).map(renderScene);
captions(clips);

const inputs = clips.flatMap((c) => ['-i', c.file]);
let v = '[0:v]';
let a = '[0:a]';
let offset = 0;
const graph = [];
for (let i = 1; i < clips.length; i++) {
  offset += clips[i - 1].length - XFADE;
  graph.push(`${v}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}[v${i}]`);
  graph.push(`${a}[${i}:a]acrossfade=d=${XFADE}:c1=tri:c2=tri[a${i}]`);
  v = `[v${i}]`;
  a = `[a${i}]`;
}
const total = offset + clips[clips.length - 1].length;
const subs = CAPTIONS ? `,ass=${p('out', 'edit', 'captions.ass')}` : '';
graph.push(`${v}fade=t=in:st=0:d=0.4,fade=t=out:st=${(total - 0.9).toFixed(2)}:d=0.9${subs}[vout]`);
graph.push(`${a}loudnorm=I=-16:TP=-1.5:LRA=9,afade=t=out:st=${(total - 0.9).toFixed(2)}:d=0.9[aout]`);

ffmpeg([
  ...inputs,
  '-filter_complex', graph.join(';'),
  '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart',
  OUT_FILE,
]);
console.log(`\n${OUT_FILE}  ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}`);
