import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand,
  CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListObjectsV2Command, GetObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'node:fs';
import { BRAND_NAME, PARENT_BRAND, PARENT_URL, TAB_LABEL, CANONICAL_URL } from './brand.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nm = (p) => path.join(__dirname, 'node_modules', p);
const { R2_ACCOUNT_ID, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const endpoint = R2_ENDPOINT || (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
const configured = !!(endpoint && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
const s3 = configured && new S3Client({
  region: 'auto', endpoint, forcePathStyle: !!R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const PART_SIZE = 5 * 1024 * 1024;           // S3/R2 minimum part size (except last)
const MAX_SIZE = 2 * 1024 * 1024 * 1024;     // compressed upload cap
const keyOk = (k) => typeof k === 'string' && /^clips\/[\w.-]+\.mp4$/.test(k);

const app = express();
app.use(express.json());
const api = express.Router();
api.use((req, res, next) => configured ? next()
  : res.status(503).json({ error: 'R2 non configuré: R2_ACCOUNT_ID (ou R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET' }));
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: e.message }); });

api.post('/upload/init', wrap(async (req, res) => {
  const size = Number(req.body.size);
  if (!(size > 0) || size > MAX_SIZE) return res.status(400).json({ error: 'taille invalide' });
  const key = `clips/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp4`;
  const r = await s3.send(new CreateMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, ContentType: 'video/mp4' }));
  res.json({ key, uploadId: r.UploadId, partSize: PART_SIZE });
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

api.post('/upload/complete', wrap(async (req, res) => {
  const { key, uploadId, totalParts } = req.body;
  if (!keyOk(key) || !uploadId) return res.status(400).json({ error: 'bad request' });
  const parts = await listAllParts(key, uploadId);
  if (parts.length !== totalParts) return res.status(409).json({ error: `parties manquantes: ${parts.length}/${totalParts}` });
  await s3.send(new CompleteMultipartUploadCommand({
    Bucket: R2_BUCKET, Key: key, UploadId: uploadId,
    MultipartUpload: { Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })) },
  }));
  res.json({ key });
}));

api.post('/upload/abort', wrap(async (req, res) => {
  const { key, uploadId } = req.body;
  if (!keyOk(key) || !uploadId) return res.status(400).json({ error: 'bad request' });
  await s3.send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId }));
  res.json({ ok: true });
}));

// Newest compressed clips, each with a short-lived playback URL.
api.get('/clips', wrap(async (req, res) => {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: 'clips/' }));
  const items = (r.Contents || []).sort((a, b) => b.LastModified - a.LastModified).slice(0, 20);
  res.json({ clips: await Promise.all(items.map(async (o) => ({
    key: o.Key, size: o.Size, modified: o.LastModified,
    url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: R2_BUCKET, Key: o.Key }), { expiresIn: 3600 }),
  }))) });
}));

app.get('/api/config', (req, res) => res.json({ configured }));
app.use('/api', api);
app.use('/vendor/ffmpeg', express.static(nm('@ffmpeg/ffmpeg/dist/esm')));
app.use('/vendor/core', express.static(nm('@ffmpeg/core/dist/esm')));
const vars = { BRAND_NAME, PARENT_BRAND, PARENT_URL, TAB_LABEL, CANONICAL_URL };
const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
  .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
const sendIndex = (req, res) => res.type('html').send(indexHtml);
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use(sendIndex);

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => console.log(`listening on ${port}, R2 ${configured ? 'configured' : 'NOT configured'}`));
