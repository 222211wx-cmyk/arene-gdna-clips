// Video is capped at 1.1 Mbps (well under the 2.5 Mbps limit) so a 30 s clip stays under 5 MB.
// Every upload becomes two small H.264/AAC MP4s (faststart) stored in R2: a 720p one and a 360p one.
// The original is never served in the feed. One ffmpeg job at a time so a busy server cannot run out of memory.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { hasAudio, duration } from './audio.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const run = (cmd, args, ms = 15 * 60 * 1000) => new Promise((ok, ko) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  const t = setTimeout(() => p.kill('SIGKILL'), ms);
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  p.on('error', (e) => { clearTimeout(t); ko(e); });
  p.on('close', (code) => { clearTimeout(t); code === 0 ? ok(out) : ko(new Error(`${cmd} exit ${code}: ${err.split('\n').slice(-4).join(' ')}`)); });
});

// short side capped at N (portrait 720x1280 and landscape 1280x720 are both "720p"), never upscaled, even dimensions
const scale = (n) => `scale=w='if(gt(iw,ih),-2,min(${n},iw))':h='if(gt(iw,ih),min(${n},ih),-2)'`;
const enc = (maxrate, buf, crf, ab) => ['-c:v', 'libx264', '-profile:v', 'main', '-preset', 'veryfast', '-crf', String(crf), '-maxrate', maxrate, '-bufsize', buf,
  '-pix_fmt', 'yuv420p', '-g', '48', '-c:a', 'aac', '-b:a', ab, '-ac', '2', '-movflags', '+faststart'];

let chain = Promise.resolve();
// Filters are baked into the compressed files. ids match the buttons in the upload studio.
export const FILTERS = {
  vif: 'eq=saturation=1.4:contrast=1.1',
  chaud: 'colorbalance=rs=0.12:gs=0.02:bs=-0.12,eq=saturation=1.1',
  froid: 'colorbalance=rs=-0.1:bs=0.14,eq=saturation=1.05',
  nb: 'hue=s=0,eq=contrast=1.1',
  vintage: 'curves=preset=vintage',
  cinema: 'eq=contrast=1.15:saturation=0.9:brightness=-0.03,colorbalance=rs=0.06:bs=-0.06:rh=-0.04:bh=0.06',
  doux: 'gblur=sigma=1.2,eq=brightness=0.03:saturation=0.95',
};
// Montage "Réglage vidéo": brightness/contrast/saturation/temperature in -100..100 (0 = untouched)
export function lookFilter(l) {
  if (!l) return '';
  const n = (v) => Math.max(-100, Math.min(100, Number(v) || 0));
  const b = n(l.brightness), c = n(l.contrast), s = n(l.saturation), t = n(l.temperature), out = [];
  if (b || c || s) out.push(`eq=brightness=${(b / 200).toFixed(3)}:contrast=${(1 + c / 100).toFixed(3)}:saturation=${(1 + s / 100).toFixed(3)}`);
  if (t) out.push(`colorbalance=rs=${(t / 250).toFixed(3)}:gs=0:bs=${(-t / 250).toFixed(3)}:rm=${(t / 500).toFixed(3)}:bm=${(-t / 500).toFixed(3)}`);
  return out.join(',');
}
// Cut / Diviser / Supprimer une partie: ranges (seconds, relative to the trimmed start) removed from picture and sound
const dropExpr = (cuts) => `not(${cuts.map(([a, b]) => `between(t,${a},${b})`).join('+')})`;
export const keysFor = (id) => ({ v720: `v/${id}-720.mp4`, v360: `v/${id}-360.mp4` });

export function transcode({ s3, bucket, key, id, trim = null, filter = '', look = null, cuts = [], audio = null }) {
  const job = chain.then(() => work({ s3, bucket, key, id, trim, filter, look, cuts, audio }));
  chain = job.catch(() => {});
  return job;
}

async function work({ s3, bucket, key, id, trim, filter, look, cuts, audio }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tc-'));
  try {
    const src = path.join(dir, 'src');
    const g = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    await pipeline(g.Body, createWriteStream(src));
    const ms = Math.max(15 * 60 * 1000, Math.ceil((g.ContentLength || 0) / 2 ** 30) * 30 * 60 * 1000);   // 30 min per GB: no fixed ceiling for big files
    const o7 = path.join(dir, '720.mp4'), o3 = path.join(dir, '360.mp4');
    const cut = trim ? ['-ss', String(trim.start), '-t', String(+(trim.end - trim.start).toFixed(2))] : [];
    const fxs = [lookFilter(look), FILTERS[filter]].filter(Boolean);
    const cutting = cuts.length ? cuts.map(([a, b]) => [Math.max(0, a - (trim ? trim.start : 0)), Math.max(0, b - (trim ? trim.start : 0))]).filter(([a, b]) => b > a) : [];
    const vchain = [...(cutting.length ? [`select='${dropExpr(cutting)}'`, 'setpts=N/FRAME_RATE/TB'] : []), ...fxs].join(',');
    const srcHasAudio = await hasAudio(src);
    // audio graph: original (kept or removed) + catalog music / voice takes / sound effects, each at its own volume
    const ins = [], parts = [], labels = [];
    const useOrig = srcHasAudio && !(audio && audio.removeOriginal);
    if (useOrig) {
      const ov = audio ? audio.originalVolume / 100 : 1;
      parts.push(`[0:a:0]${cutting.length ? `aselect='${dropExpr(cutting)}',asetpts=N/SR/TB,` : ''}volume=${ov}[ao]`); labels.push('[ao]');
    }
    (audio ? audio.tracks : []).forEach((t, i) => {
      if (t.cat === 'music') ins.push('-stream_loop', '-1');
      ins.push('-i', t.file); const idx = 1 + i;
      const ms = Math.round(t.offset * 1000);
      parts.push(`[${idx}:a:0]aresample=44100,aformat=channel_layouts=stereo,${ms ? `adelay=${ms}|${ms},` : ''}volume=${(t.volume / 100).toFixed(3)}[at${i}]`); labels.push(`[at${i}]`);
    });
    const hasMix = labels.length > 0;
    // looped music is endless: the output is cut at the real length (trim, minus removed parts) instead of relying on -shortest
    let outLen = null;
    if (hasMix) {
      const full = trim ? trim.end - trim.start : await duration(src);
      outLen = Math.max(0.5, +(full - cutting.reduce((n, [a, b]) => n + Math.min(b, full) - Math.min(a, full), 0)).toFixed(2));
    }
    const lim = outLen ? ['-t', String(outLen)] : [];
    if (hasMix) parts.push(labels.length > 1 ? `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest[am]` : `${labels[0]}anull[am]`, '[am]asplit=2[ao7][ao3]');
    const vf = `[0:v:0]${vchain ? vchain + ',' : ''}split=2[a][b];[a]${scale(720)}[v7];[b]${scale(360)}[v3]`;
    const amap = (l) => hasMix ? ['-map', l] : audio && audio.removeOriginal ? ['-an'] : ['-map', '0:a:0?'];
    await run('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...cut, '-i', src, ...ins,
      '-filter_complex', [vf, ...parts].join(';'),
      '-map', '[v7]', ...amap('[ao7]'), ...lim, ...enc('1100k', '2200k', 25, '128k'), o7,
      '-map', '[v3]', ...amap('[ao3]'), ...lim, ...enc('450k', '900k', 28, '64k'), o3], ms);
    const k = keysFor(id), sizes = {};
    for (const [name, file, Key] of [['v720', o7, k.v720], ['v360', o3, k.v360]]) {
      const body = await readFile(file); sizes[name] = (await stat(file)).size;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body: body, ContentType: 'video/mp4', CacheControl: IMMUTABLE }));
    }
    return { ...k, sizes };
  } finally { rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
