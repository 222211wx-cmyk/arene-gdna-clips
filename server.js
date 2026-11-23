import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand,
  CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadBucketCommand, PutBucketCorsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'node:fs';
import { BRAND_NAME, TAB_LABEL, CANONICAL_URL } from './brand.js';
import { search as searchMusic, byId as musicById, coverSvg } from './music.js';
import { ask as askAI } from './ai.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nm = (p) => path.join(__dirname, 'node_modules', p);
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
// Tolerate misconfigured vars: bucket must be a bare name, endpoint a bare origin.
const rawBucket = (process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || '').trim();
let R2_ENDPOINT = (process.env.R2_ENDPOINT || '').trim();
let R2_BUCKET = rawBucket;
if (/[/:]/.test(rawBucket)) {
  let name = '';
  try {
    const u = new URL(/^https?:\/\//i.test(rawBucket) ? rawBucket : `https://${rawBucket}`);
    name = u.pathname.split('/').filter(Boolean)[0] || '';
    if (!R2_ENDPOINT && /^https?:\/\//i.test(rawBucket)) R2_ENDPOINT = u.origin;
  } catch { name = rawBucket.split('/').filter(Boolean).pop() || ''; }
  console.warn(`[r2] R2_BUCKET_NAME contained a URL or '/': using bucket "${name || '(none)'}". Set it to the bucket name only (e.g. arena-clips).`);
  R2_BUCKET = name;
}
if (/^https?:\/\//i.test(R2_ENDPOINT)) {
  try { const o = new URL(R2_ENDPOINT); if (o.pathname !== '/' ) { console.warn('[r2] R2_ENDPOINT had a path; using origin only.'); R2_ENDPOINT = o.origin; } } catch {}
}
const endpoint = R2_ENDPOINT || (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
const configured = !!(endpoint && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
const s3 = configured && new S3Client({
  region: 'auto', endpoint, forcePathStyle: !!R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const PART_SIZE = 10 * 1024 * 1024;          // multipart part size (R2 minimum is 5 MB except last)
const SINGLE_MAX = 10 * 1024 * 1024;         // <= 10 MB: one presigned PUT; above: multipart
const MAX_SIZE = 200 * 1024 * 1024;          // upload cap
const TYPES = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
const keyOk = (k) => typeof k === 'string' && /^clips\/[\w.-]+\.(mp4|mov|webm)$/.test(k);
const idOf = (k) => k.slice(6, k.lastIndexOf('.'));
const metaKey = (k) => `meta/${idOf(k)}.json`;

// Bucket health (cached) + best-effort CORS so browsers may PUT straight to R2.
let health = { at: 0, ok: false, error: 'not checked' };
async function checkBucket(force = false) {
  if (!configured) return { ok: false, error: 'R2 non configuré' };
  if (!force && Date.now() - health.at < 30000) return health;
  try { await s3.send(new HeadBucketCommand({ Bucket: R2_BUCKET })); health = { at: Date.now(), ok: true }; }
  catch (e) {
    const code = e.$metadata?.httpStatusCode;
    health = { at: Date.now(), ok: false, error: code === 404 ? `Bucket "${R2_BUCKET}" introuvable sur ${new URL(endpoint).host}: le compte (Account ID / R2_ENDPOINT) ou R2_BUCKET_NAME ne correspond pas aux clés R2` : code === 403 || code === 401 ? 'Clés R2 refusées (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)' : e.message };
  }
  return health;
}
async function ensureCors() {
  if (!configured) return;
  try {
    await s3.send(new PutBucketCorsCommand({ Bucket: R2_BUCKET, CORSConfiguration: { CORSRules: [{ AllowedOrigins: ['*'], AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }] } }));
    console.log('[r2] CORS set');
  } catch (e) { console.warn('[r2] could not set CORS (set it in Cloudflare: allow PUT/GET from your origin):', e.message); }
}
checkBucket(true).then((h) => { console.log(h.ok ? `[r2] bucket ${R2_BUCKET} OK` : `[r2] ${h.error}`); if (h.ok) ensureCors(); });

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: e.message }); });

const app = express();
app.use(express.json({ limit: '4mb' }));

// Music playlist + AI (work without R2)
app.get('/api/music', (req, res) => res.json({ tracks: searchMusic(String(req.query.q || '')) }));
app.get('/api/music/:id/cover.svg', (req, res) => { const t = musicById(req.params.id); if (!t) return res.sendStatus(404); res.type('image/svg+xml').set('cache-control', 'public,max-age=86400').send(coverSvg(t)); });
app.get('/api/music/:id/audio', wrap(async (req, res) => {
  const t = musicById(req.params.id); if (!t) return res.sendStatus(404);
  const r = await fetch(t.src); if (!r.ok) return res.sendStatus(502);
  res.type('audio/mpeg').set('cache-control', 'public,max-age=86400').send(Buffer.from(await r.arrayBuffer()));
}));
app.post('/api/ai', wrap(async (req, res) => res.json(await askAI(String(req.body.prompt || '').slice(0, 500), req.body.context || {}))));
const api = express.Router();
api.use((req, res, next) => configured ? next()
  : res.status(503).json({ error: 'R2 non configuré: R2_ACCOUNT_ID (ou R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET' }));

// Step 1: presigned URL. Small file -> one PUT; large file -> multipart (parts signed via /upload/part-url).
api.post('/upload-url', wrap(async (req, res) => {
  const size = Number(req.body.size);
  const ext = String(req.body.ext || 'mp4').toLowerCase();
  if (!TYPES[ext]) return res.status(400).json({ error: 'format non supporté (mp4, mov, webm)' });
  if (!(size > 0) || size > MAX_SIZE) return res.status(400).json({ error: `taille invalide (max ${MAX_SIZE / 1048576} MB)` });
  const h = await checkBucket();
  if (!h.ok) return res.status(503).json({ error: h.error });
  const key = `clips/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const ContentType = TYPES[ext];
  if (size <= SINGLE_MAX) {
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType }), { expiresIn: 3600 });
    return res.json({ mode: 'single', key, url, contentType: ContentType });
  }
  const r = await s3.send(new CreateMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, ContentType }));
  res.json({ mode: 'multipart', key, uploadId: r.UploadId, partSize: PART_SIZE, contentType: ContentType });
}));

api.post('/upload/part-url', wrap(async (req, res) => {
  const { key, uploadId, partNumber } = req.body;
  if (!keyOk(key) || !uploadId || !(partNumber >= 1 && partNumber <= 10000)) return res.status(400).json({ error: 'bad request' });
  const url = await getSignedUrl(s3, new UploadPartCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn: 3600 });
  res.json({ url });
}));

async function listAllParts(key, uploadId) {
  const parts = []; let marker;
  for (;;) {
    const r = await s3.send(new ListPartsCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
    parts.push(...(r.Parts || []).map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag, Size: p.Size })));
    if (!r.IsTruncated) return parts;
    marker = r.NextPartNumberMarker;
  }
}

// Resume: which parts R2 already has for this upload.
api.get('/upload/parts', wrap(async (req, res) => {
  const { key, uploadId } = req.query;
  if (!keyOk(key) || !uploadId) return res.status(400).json({ error: 'bad request' });
  try { res.json({ parts: (await listAllParts(key, uploadId)).map((p) => ({ partNumber: p.PartNumber, size: p.Size })) }); }
  catch (e) { if (e.name === 'NoSuchUpload') return res.json({ gone: true, parts: [] }); throw e; }
}));

// Step 3: confirm. Verifies the object exists in R2 (completes multipart first when needed).
api.post(['/upload-complete', '/upload/complete'], wrap(async (req, res) => {
  const { key, uploadId, totalParts } = req.body;
  if (!keyOk(key)) return res.status(400).json({ error: 'bad request' });
  if (!uploadId) {
    try { const h = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })); return res.json({ key, size: h.ContentLength }); }
    catch { return res.status(404).json({ error: 'fichier absent de R2: envoi incomplet' }); }
  }
  const parts = await listAllParts(key, uploadId);
  if (parts.length !== totalParts) return res.status(409).json({ error: `parties manquantes: ${parts.length}/${totalParts}` });
  await s3.send(new CompleteMultipartUploadCommand({
    Bucket: R2_BUCKET, Key: key, UploadId: uploadId,
    MultipartUpload: { Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })) },
  }));
  const h = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })).catch(() => null);
  res.json({ key, size: h?.ContentLength });
}));

// One record per clip: video_url (R2 key), title, description, comment, music, enhancement - saved together.
api.post('/publish', wrap(async (req, res) => {
  const { key, title = '', description = '', comment = '', musicId = null, enhancement = {} } = req.body;
  if (!keyOk(key)) return res.status(400).json({ error: 'bad request' });
  const music = musicId ? musicById(musicId) : null;
  if (musicId && !music) return res.status(400).json({ error: 'musique inconnue' });
  const fx = { eclairage: Number(enhancement.eclairage) || 0, couleur: Number(enhancement.couleur) || 0, cartoon: !!enhancement.cartoon };
  const meta = {
    key, video_url: key, id: idOf(key), title: String(title).slice(0, 120), description: String(description).slice(0, 2200),
    comment: String(comment).slice(0, 2200), musicId, music: music ? { id: music.id, name: music.name, artist: music.artist } : null,
    enhancement: fx, publishedAt: new Date().toISOString(),
  };
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: metaKey(key), Body: JSON.stringify(meta), ContentType: 'application/json' }));
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 3600 });
  res.json({ ...meta, url });
}));

api.post('/upload/abort', wrap(async (req, res) => {
  const { key, uploadId } = req.body;
  if (!keyOk(key) || !uploadId) return res.status(400).json({ error: 'bad request' });
  await s3.send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId }));
  res.json({ ok: true });
}));

const meta = async (k) => { try { const g = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: metaKey(k) })); return JSON.parse(await g.Body.transformToString()); } catch { return null; } };
const findKey = async (id) => { for (const e of Object.keys(TYPES)) { const k = `clips/${id}.${e}`; try { await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: k })); return k; } catch {} } return null; };
const metaOf = async (id) => { const k = await findKey(id); return k ? meta(k) : null; };
const clipId = (id) => typeof id === 'string' && /^[\w.-]+$/.test(id) && id.length < 80;

// One clip by id (deep link /c/:id).
api.get('/clips/:id', wrap(async (req, res) => {
  if (!clipId(req.params.id)) return res.status(400).json({ error: 'bad request' });
  const key = await findKey(req.params.id);
  if (!key) return res.status(404).json({ error: 'clip introuvable' });
  res.json({ key, meta: await meta(key), url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 3600 }) });
}));

// Download: redirect to a short-lived signed R2 URL (bytes never pass through this server).
api.get('/clips/:id/download', wrap(async (req, res) => {
  if (!clipId(req.params.id)) return res.status(400).json({ error: 'bad request' });
  const key = await findKey(req.params.id);
  if (!key) return res.status(404).json({ error: 'clip introuvable' });
  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: R2_BUCKET, Key: key,
    ResponseContentDisposition: `attachment; filename="${key.slice(6)}"`,
  }), { expiresIn: 300 });
  res.set('Cache-Control', 'no-store').redirect(302, url);
}));

// Newest compressed clips, each with a short-lived playback URL.
api.get('/clips', wrap(async (req, res) => {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: 'clips/' }));
  const items = (r.Contents || []).filter((o) => keyOk(o.Key)).sort((a, b) => b.LastModified - a.LastModified).slice(0, 20);
  res.json({ clips: await Promise.all(items.map(async (o) => ({
    key: o.Key, size: o.Size, modified: o.LastModified, meta: await meta(o.Key),
    url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: R2_BUCKET, Key: o.Key }), { expiresIn: 3600 }),
  }))) });
}));

app.get('/api/config', async (req, res) => {
  const h = await checkBucket(req.query.force === '1');
  res.json({ configured, bucketOk: !!h.ok, error: h.ok ? undefined : h.error, maxMB: MAX_SIZE / 1048576 });
});
app.use('/api', api);
app.use('/vendor/ffmpeg', express.static(nm('@ffmpeg/ffmpeg/dist/esm')));
app.use('/vendor/core', express.static(nm('@ffmpeg/core/dist/esm')));
const vars = { BRAND_NAME, TAB_LABEL, CANONICAL_URL };
const template = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const attr = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const render = (extra = {}) => template.replace(/\{\{(\w+)\}\}/g, (_, k) => attr({ ...vars, OG_TITLE: BRAND_NAME, PAGE_URL: CANONICAL_URL, ...extra }[k] ?? ''));
const indexHtml = render();
const sendIndex = (req, res) => res.type('html').send(indexHtml);
// Shared clip link: same app, with the clip's title in the link preview.
app.get('/c/:id', async (req, res) => {
  const id = req.params.id; let title = '';
  if (configured && clipId(id)) { const m = await metaOf(id).catch(() => null); title = (m?.description || '').split('\n')[0].slice(0, 90); }
  res.type('html').send(render({ OG_TITLE: title ? `${title} - ${BRAND_NAME}` : BRAND_NAME, PAGE_URL: `${CANONICAL_URL}/c/${id}` }));
});
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use(sendIndex);

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => console.log(`listening on ${port}, R2 ${configured ? 'configured' : 'NOT configured'}`));
