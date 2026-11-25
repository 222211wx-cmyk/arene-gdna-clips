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
};
export const keysFor = (id) => ({ v720: `v/${id}-720.mp4`, v360: `v/${id}-360.mp4` });

export function transcode({ s3, bucket, key, id, trim = null, filter = '' }) {
  const job = chain.then(() => work({ s3, bucket, key, id, trim, filter }));
  chain = job.catch(() => {});
  return job;
}

async function work({ s3, bucket, key, id, trim, filter }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tc-'));
  try {
    const src = path.join(dir, 'src');
    const g = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    await pipeline(g.Body, createWriteStream(src));
    const ms = Math.max(15 * 60 * 1000, Math.ceil((g.ContentLength || 0) / 2 ** 30) * 30 * 60 * 1000);   // 30 min per GB: no fixed ceiling for big files
    const o7 = path.join(dir, '720.mp4'), o3 = path.join(dir, '360.mp4');
    const cut = trim ? ['-ss', String(trim.start), '-t', String(+(trim.end - trim.start).toFixed(2))] : [];
    const fx = FILTERS[filter] ? FILTERS[filter] + ',' : '';
    await run('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...cut, '-i', src,
      '-filter_complex', `[0:v:0]${fx}split=2[a][b];[a]${scale(720)}[v7];[b]${scale(360)}[v3]`,
      '-map', '[v7]', '-map', '0:a:0?', ...enc('1100k', '2200k', 25, '128k'), o7,
      '-map', '[v3]', '-map', '0:a:0?', ...enc('450k', '900k', 28, '64k'), o3], ms);
    const k = keysFor(id), sizes = {};
    for (const [name, file, Key] of [['v720', o7, k.v720], ['v360', o3, k.v360]]) {
      const body = await readFile(file); sizes[name] = (await stat(file)).size;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body: body, ContentType: 'video/mp4', CacheControl: IMMUTABLE }));
    }
    return { ...k, sizes };
  } finally { rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
