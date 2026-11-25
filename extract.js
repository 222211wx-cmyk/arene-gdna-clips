// Archive import: ZIP, 7z, RAR, TAR, GZ (and tgz/bz2/xz). The archive is already in R2 (uploaded with the normal uploader).
// Flow: R2 -> temp disk (8 ranged pieces in parallel) -> 7-Zip extracts only the videos -> 3 videos at a time go back to R2
// as clips/ objects -> temp folder deleted. Pure Node + the 7-Zip binary (7zz / 7z / 7za, or 7z.exe on Windows): no Linux-only code.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, open, readdir, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const ARCHIVE_EXTS = ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz'];
export const VIDEO_TYPES = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
const IMMUTABLE = 'public, max-age=31536000, immutable';
const MiB = 1048576;
const PARALLEL = 8, FILES_AT_ONCE = 3;

// Piece size for R2 multipart: 12 MiB, growing once a file passes ~100 GiB so we stay under R2's 10,000-part limit (and its 5 GiB part limit).
export const pieceSize = (size) => Math.max(12 * MiB, Math.ceil(size / 8500 / MiB) * MiB);

const BIN = [process.env.SEVENZIP_PATH, '7zz', '7z', '7za', 'C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'].filter(Boolean);
const run = (bin, args) => new Promise((ok, ko) => {
  const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
  p.on('error', ko);
  p.on('close', (code) => (code === 0 || code === 1 ? ok() : ko(new Error(`7-Zip exit ${code}: ${err.split(/\r?\n/).filter(Boolean).slice(-3).join(' ')}`))));  // 1 = warnings only
});
async function sevenZip(args) {
  for (const bin of BIN) { try { return await run(bin, args); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  throw new Error('7-Zip introuvable sur le serveur');
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

// R2 -> disk, 8 ranged pieces at a time, each streamed (never held in RAM).
async function download(s3, bucket, key, file, size) {
  const fh = await open(file, 'w'); await fh.truncate(size); await fh.close();
  const piece = pieceSize(size), total = Math.ceil(size / piece);
  let next = 0;
  const worker = async () => {
    while (next < total) {
      const i = next++, start = i * piece, end = Math.min(size, start + piece) - 1;
      const g = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=${start}-${end}` }));
      await pipeline(g.Body, createWriteStream(file, { flags: 'r+', start }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, total) }, worker));
}

const isVideo = (f) => !!VIDEO_TYPES[f.split('.').pop().toLowerCase()];
const extractAll = async (archive, dir) => {
  const filt = ['mp4', 'mov', 'webm'].map((e) => `-ir!*.${e}`), withTar = [...filt, '-ir!*.tar'];
  const stream = /\.(gz|tgz|bz2|xz)$/i.test(archive);       // single-stream formats: the inner file has no useful name filter
  await sevenZip(['x', archive, `-o${dir}`, '-y', '-bd', '-aoa', ...(stream ? [] : withTar)]);
  // .tar.gz / .tgz / .tar.bz2 (and tars inside zip/7z): the first pass gives a tar, unpack it too
  for (let round = 0; round < 3; round++) {
    const left = (await walk(dir)).filter((f) => !isVideo(f) && path.resolve(f) !== path.resolve(archive) && (f.toLowerCase().endsWith('.tar') || (stream && round === 0)));
    if (!left.length) break;
    for (const t of left) {
      try { await sevenZip(['x', t, `-o${path.join(dir, `_t${round}`)}`, '-y', '-bd', '-aoa', ...withTar]); } catch (e) { if (!stream) throw e; }
      await rm(t, { force: true });
    }
  }
};

export async function extractArchive({ s3, bucket, key, onProgress = () => {} }) {
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ex-'));
  try {
    const ext = key.split('.').pop().toLowerCase();
    const archive = path.join(dir, `archive.${ext}`), out = path.join(dir, 'out');
    onProgress({ step: 'download', pct: 0 });
    await download(s3, bucket, key, archive, head.ContentLength);
    onProgress({ step: 'extract', pct: 30 });
    await extractAll(archive, out);
    await rm(archive, { force: true });                       // free the disk before re-uploading
    const videos = (await walk(out)).filter((f) => VIDEO_TYPES[f.split('.').pop().toLowerCase()]);
    if (!videos.length) throw new Error('Aucune vidéo (mp4, mov, webm) dans cette archive');
    const done = []; let n = 0;
    const worker = async () => {
      while (n < videos.length) {
        const f = videos[n++], e = f.split('.').pop().toLowerCase(), size = (await stat(f)).size;
        const k = `clips/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${e}`;
        await new Upload({
          client: s3, queueSize: 3, partSize: Math.max(pieceSize(size), 5 * MiB), leavePartsOnError: false,
          params: { Bucket: bucket, Key: k, Body: createReadStream(f), ContentType: VIDEO_TYPES[e], CacheControl: IMMUTABLE },
        }).done();
        await rm(f, { force: true });                         // delete each temp video as soon as it is back in R2
        done.push({ key: k, name: path.basename(f), size });
        onProgress({ step: 'upload', pct: 30 + Math.round(70 * done.length / videos.length), done: done.length, total: videos.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(FILES_AT_ONCE, videos.length) }, worker));
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});   // archive no longer needed
    return done;
  } finally { rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
