import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand,
  CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadBucketCommand, PutBucketCorsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'node:fs';
import { BRAND_NAME, TAB_LABEL, CANONICAL_URL } from './brand.js';
import { search as searchMusic, byId as musicById, coverSvg } from './music.js';
import { ask as askAI, askClip } from './ai.js';
import { transcode, FILTERS } from './transcode.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as db from './db.js';
import { dbConfigured, migrate, getDefaultUserId, feed as dbFeed, clipById, upsertClip, knownKeys } from './db.js';

// One build id per deployment: injected in the HTML and in asset URLs (?v=) so a new deploy is never mixed with an old cache.
const BUILD_ID = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_DEPLOYMENT_ID || String(Date.now())).slice(0, 12);
// Public CDN base for R2 (r2.dev or a custom domain). Objects are immutable, so browsers/CDN cache them for a year.
const CDN = (process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const IMMUTABLE = 'public, max-age=31536000, immutable';
const POSTER_EXT = 'jpg';

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
const MAX_SIZE = 4 * 1024 * 1024 * 1024;          // upload cap
const TYPES = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
const keyOk = (k) => typeof k === 'string' && /^clips\/[\w.-]+\.(mp4|mov|webm)$/.test(k);
const idOf = (k) => k.slice(6, k.lastIndexOf('.'));
const metaKey = (k) => `meta/${idOf(k)}.json`;
const posterKey = (k) => `posters/${idOf(k)}.jpg`;

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
app.post('/api/ask', wrap(async (req, res) => res.json(await askClip(String(req.body.prompt || '').slice(0, 500), req.body.clip || {}))));
app.post('/api/ai', wrap(async (req, res) => res.json(await askAI(String(req.body.prompt || '').slice(0, 500), req.body.context || {}))));
const api = express.Router();
api.use(['/upload-url', '/poster-url', '/upload', '/upload-complete', '/publish'], (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Connexion requise', code: 'auth' })));
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
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType, CacheControl: IMMUTABLE }), { expiresIn: 3600 });
    return res.json({ mode: 'single', key, url, contentType: ContentType, cacheControl: IMMUTABLE });
  }
  const r = await s3.send(new CreateMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, ContentType, CacheControl: IMMUTABLE }));
  res.json({ mode: 'multipart', key, uploadId: r.UploadId, partSize: PART_SIZE, contentType: ContentType });
}));

// Poster (first-frame jpg) uploaded straight to R2 next to the clip.
api.post('/poster-url', wrap(async (req, res) => {
  if (!keyOk(req.body.key)) return res.status(400).json({ error: 'bad request' });
  const key = posterKey(req.body.key);
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: 'image/jpeg', CacheControl: IMMUTABLE }), { expiresIn: 3600 });
  res.json({ key, url, contentType: 'image/jpeg', cacheControl: IMMUTABLE });
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

// Clip URLs: CDN when R2_PUBLIC_URL is set, otherwise short-lived signed R2 URLs.
const mediaUrl = async (key, ver) => CDN ? `${CDN}/${key}${ver ? `?v=${ver}` : ''}` : getSignedUrl(s3, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 3600 });
const ver = (row) => Math.floor(new Date(row.created_at).getTime() / 1000);
const present = async (row, vs = {}) => ({
  id: row.id, key: row.key,
  // the feed never serves the original: 720p, and a 360p fallback (legacy clips without renditions keep the original until backfilled)
  url: await mediaUrl(row.v720_key || row.key, ver(row)), url360: row.v360_key ? await mediaUrl(row.v360_key, ver(row)) : null,
  poster: row.poster_key ? await mediaUrl(row.poster_key, ver(row)) : null,
  privacy: row.privacy, title: row.title, description: row.description, comment: row.comment,
  music: row.music_name ? { id: row.music_id, name: row.music_name, artist: row.music_artist } : null,
  author: { handle: row.handle, name: row.display_name, avatar: row.avatar_key && configured ? await mediaUrl(row.avatar_key) : null },
  tags: row.tags ? row.tags.split(' ') : [],
  likes: row.likes, comments: row.comments, saves: row.saves, shares: row.shares, views: row.views, createdAt: row.created_at,
  viewer: { liked: !!vs.liked, saved: !!vs.saved, following: !!vs.following, requested: !!vs.requested, favorited: !!vs.favorited },
});
// ---- accounts: session cookie `sid` -> users row. Reads work anonymously; every write needs a login. ----
const SID = 'sid';
const sidOf = (req) => (/(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '') || [])[1] || null;
const secure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';
const setSid = (req, res, token) => res.cookie(SID, token, { maxAge: 30 * 864e5, httpOnly: true, sameSite: 'lax', secure: secure(req), path: '/' });
const presentUser = async (u) => u && ({ id: u.id, handle: u.handle, name: u.display_name, email: u.email, bio: u.bio, city: u.city, link: u.link, avatar: u.avatar_key && configured ? await mediaUrl(u.avatar_key) : null, settings: { notifications: u.notifications, private_profile: u.private_profile, allow_messages: u.allow_messages, language: u.language } });
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', wrapMw(async (req) => {
  req.user = dbConfigured ? await db.userBySession(sidOf(req)) : null;
  const gid = (/(?:^|;\s*)gid=([a-f0-9]{32})/.exec(req.headers.cookie || '') || [])[1];
  req.guest = !req.user && gid && dbConfigured ? await db.guestByToken(gid) : null;
  req.viewer = req.user || req.guest;
}));
function wrapMw(fn) { return (req, res, next) => fn(req).then(() => next(), (e) => { console.error(e); res.status(500).json({ error: e.message }); }); }
// Like, save, comment, share and messages work for guests: a guest row is created on the first write.
const needViewer = wrapMw2(async (req, res) => {
  if (req.viewer) return;
  if (!dbConfigured) throw Object.assign(new Error('Base de données non configurée'), { status: 503 });
  const g = await db.createGuest(); req.guest = req.viewer = g.user;
  res.cookie('gid', g.token, { maxAge: 365 * 864e5, httpOnly: true, sameSite: 'lax', secure: secure(req), path: '/' });
});
function wrapMw2(fn) { return (req, res, next) => fn(req, res).then(() => next(), (e) => res.status(e.status || 500).json({ error: e.message })); }
const needUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Connexion requise', code: 'auth' });
const presentAll = async (req, rows) => {
  const vs = await db.viewerState(req.viewer?.id, rows.map((r) => r.id));
  return Promise.all(rows.map((r) => present(r, vs[r.id])));
};
const needDb = (req, res, next) => dbConfigured ? next() : res.status(503).json({ error: 'Base de données non configurée (DATABASE_URL)' });

// tiny in-memory throttle for login/signup (per IP, 20 tries / 10 min)
const tries = new Map();
const throttle = (req, res, next) => {
  const k = req.ip, now = Date.now(), t = (tries.get(k) || []).filter((x) => now - x < 600000);
  if (t.length >= 20) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans quelques minutes' });
  t.push(now); tries.set(k, t); next();
};

const auth = express.Router();
auth.use(needDb);
auth.post('/signup', throttle, wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase(), username = String(req.body?.username || '').trim().toLowerCase(), password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return res.status(400).json({ error: 'Adresse e-mail invalide', field: 'email' });
  if (!/^[a-z0-9_.]{3,24}$/.test(username)) return res.status(400).json({ error: 'Nom d’utilisateur : 3 à 24 caractères (lettres, chiffres, _ ou .)', field: 'username' });
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum', field: 'password' });
  const r = await db.signup({ email, username, password });
  if (r.error) return res.status(409).json({ error: r.error === 'email' ? 'Cette adresse e-mail a déjà un compte' : 'Ce nom d’utilisateur est déjà pris', field: r.error });
  setSid(req, res, await db.createSession(r.user.id));
  res.json({ user: await presentUser(r.user) });
}));
auth.post('/login', throttle, wrap(async (req, res) => {
  const u = await db.login(String(req.body?.email || '').trim(), String(req.body?.password || ''));
  if (!u) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect' });
  setSid(req, res, await db.createSession(u.id));
  res.json({ user: await presentUser(u) });
}));
auth.post('/logout', wrap(async (req, res) => { await db.endSession(sidOf(req)); res.clearCookie(SID, { path: '/' }); res.json({ ok: true }); }));
app.use('/api/auth', auth);

// ---- Social: like / save / share / comments / follow / citizen card / messages / profile (all stored in Postgres) ----
const social = express.Router();
social.use(needDb);
const clipOr404 = async (req, res) => {
  if (!clipId(req.params.id)) { res.status(400).json({ error: 'requête invalide' }); return null; }
  const row = await clipById(req.params.id);
  if (!row) res.status(404).json({ error: 'clip introuvable' });
  return row;
};
const flag = (req) => (typeof req.body?.on === 'boolean' ? req.body.on : true);
social.put('/clips/:id/like', needViewer, wrap(async (req, res) => { const c = await clipOr404(req, res); if (!c) return; res.json(await db.setLike(req.viewer.id, c.id, flag(req))); }));
social.put('/clips/:id/save', needViewer, wrap(async (req, res) => { const c = await clipOr404(req, res); if (!c) return; res.json(await db.setSave(req.viewer.id, c.id, flag(req))); }));
social.post('/clips/:id/share', wrap(async (req, res) => {
  const c = await clipOr404(req, res); if (!c) return;
  const ch = ['link', 'native', 'whatsapp', 'message'].includes(req.body?.channel) ? req.body.channel : 'link';
  res.json(await db.addShare(req.viewer?.id, c.id, ch));
}));
social.get('/clips/:id/comments', wrap(async (req, res) => { const c = await clipOr404(req, res); if (!c) return; res.json({ comments: await db.listComments(c.id) }); }));
social.post('/clips/:id/comments', needViewer, wrap(async (req, res) => {
  const c = await clipOr404(req, res); if (!c) return;
  const body = String(req.body?.body || '').trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: 'commentaire vide' });
  res.json({ ...(await db.addComment(req.viewer.id, c.id, body)), name: req.viewer.display_name });
}));
const followHandle = async (req, res, handle) => {
  const u = await db.citizen(String(handle).slice(0, 80), null);
  if (!u) return res.status(404).json({ error: 'créateur introuvable' });
  const r = await db.setFollow(req.user.id, u.id, flag(req));
  if (r.error) return res.status(400).json({ error: 'vous ne pouvez pas vous suivre vous-même' });
  res.json(r);
};
social.put('/clips/:id/follow', needUser, wrap(async (req, res) => { const c = await clipOr404(req, res); if (!c) return; const r = await db.setFollow(req.user.id, c.author_id, flag(req)); if (r.error) return res.status(400).json({ error: 'vous ne pouvez pas vous suivre vous-même' }); res.json(r); }));
social.put('/users/:handle/follow', needUser, wrap(async (req, res) => followHandle(req, res, req.params.handle)));
const PRIVACY = ['public', 'private', 'followers'];
const profileOf = async (req, handle) => {
  const u = await db.citizen(String(handle).slice(0, 80), req.viewer?.id || req.user?.id);
  if (!u) return null;
  // a private profile shows only avatar + name (and the follow-request button) until the owner accepts the visitor
  const me = req.user?.id === u.id, hidden = u.private_profile && !me && u.follow_status !== 'accepted';
  const base = { handle: u.handle, name: u.display_name, me, private: hidden, privateProfile: u.private_profile, follow_status: u.follow_status || null, following_by_me: u.follow_status === 'accepted', requested: u.follow_status === 'pending', avatar: u.avatar_key && configured ? await mediaUrl(u.avatar_key) : null, _id: u.id };
  if (hidden) return base;
  return { ...base, citizenId: `#${u.year}-${u.seq}`, verified: u.clips > 0, clips: u.clips, followers: u.followers, following: u.following, allowMessages: u.allow_messages, bio: u.bio, city: u.city, link: u.link, cover: u.cover_key && configured ? await mediaUrl(u.cover_key) : null };
};
social.get('/citizen/:handle', wrap(async (req, res) => { const p = await profileOf(req, req.params.handle); if (!p) return res.status(404).json({ error: 'créateur introuvable' }); delete p._id; res.json(p); }));
social.get('/users/:handle', wrap(async (req, res) => { const p = await profileOf(req, req.params.handle); if (!p) return res.status(404).json({ error: 'créateur introuvable' }); delete p._id; res.json(p); }));
social.get('/users/:handle/clips', wrap(async (req, res) => {
  const p = await profileOf(req, req.params.handle); if (!p) return res.status(404).json({ error: 'créateur introuvable' });
  if (p.private) return res.json({ clips: [], next: null, private: true });
  const { rows, next } = await dbFeed({ limit: 30, authorHandle: p.handle, viewerId: req.user?.id });
  res.json({ clips: await presentAll(req, rows), next });
}));
social.get('/users/:handle/followers', wrap(async (req, res) => {
  const p = await profileOf(req, req.params.handle); if (!p) return res.status(404).json({ error: 'créateur introuvable' });
  res.json({ followers: p.private ? [] : await db.followers(p._id), private: p.private });
}));
social.post('/messages', needViewer, wrap(async (req, res) => {
  const body = String(req.body?.body || '').trim().slice(0, 1000);
  if (!body) return res.status(400).json({ error: 'message vide' });
  const to = await db.citizen(String(req.body?.to || ''), null);
  if (!to) return res.status(404).json({ error: 'destinataire introuvable' });
  if (req.viewer.id === to.id) return res.status(400).json({ error: 'destinataire invalide' });
  if (!to.allow_messages) return res.status(403).json({ error: 'Ce créateur n’accepte pas les messages' });
  res.json(await db.sendMessage(req.viewer.id, to.id, clipId(req.body?.clip) ? req.body.clip : null, body));
}));
social.get('/messages', needViewer, wrap(async (req, res) => {
  const w = String(req.query.with || '').slice(0, 80);
  if (!w) return res.json({ conversations: await db.conversations(req.viewer.id) });
  const t = await db.thread(req.viewer.id, w); if (!t) return res.status(404).json({ error: 'créateur introuvable' });
  res.json(t);
}));
social.get('/me', wrap(async (req, res) => res.json({ user: await presentUser(req.user), unread: req.user ? await db.unreadCount(req.user.id) : 0 })));
social.get('/me/saved', needViewer, wrap(async (req, res) => res.json({ clips: await presentAll(req, await db.savedClips(req.viewer.id)) })));
const MEDIA_EXT = { photo: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }, video: { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' } };
const MEDIA_MAX = { photo: 25 * 1048576, video: 500 * 1048576 };
const profileKeyOk = (uid, k) => typeof k === 'string' && k.startsWith(`profile/${uid}/`) && /^profile\/[\w-]+\/[\w.-]+\.(jpg|jpeg|png|webp|gif|mp4|mov|webm)$/.test(k);
const needR2 = (req, res, next) => configured ? next() : res.status(503).json({ error: 'Stockage R2 non configuré' });
// Presigned PUT straight to R2 for profile photos, cover, avatar and gallery items.
social.post('/me/upload-url', needUser, needR2, wrap(async (req, res) => {
  const slot = String(req.body?.slot || ''), ext = String(req.body?.ext || '').toLowerCase().replace('jpeg', 'jpg'), size = Number(req.body?.size);
  const kind = slot === 'video' ? 'video' : ['avatar', 'cover', 'photo'].includes(slot) ? 'photo' : null;
  if (!kind) return res.status(400).json({ error: 'type invalide' });
  const ct = MEDIA_EXT[kind][ext] || MEDIA_EXT[kind][ext === 'jpg' ? 'jpeg' : ext];
  if (!ct) return res.status(400).json({ error: kind === 'photo' ? 'Format non supporté (jpg, png, webp)' : 'Format non supporté (mp4, mov, webm)' });
  if (!(size > 0) || size > MEDIA_MAX[kind]) return res.status(400).json({ error: `Fichier trop volumineux (max ${MEDIA_MAX[kind] / 1048576} Mo)` });
  const key = `profile/${req.user.id}/${slot}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: ct, CacheControl: IMMUTABLE }), { expiresIn: 3600 });
  res.json({ key, url, contentType: ct, cacheControl: IMMUTABLE });
}));
// Registers an uploaded gallery item (after checking it exists in R2).
social.post('/me/media', needUser, needR2, wrap(async (req, res) => {
  const kind = req.body?.kind === 'video' ? 'video' : req.body?.kind === 'photo' ? 'photo' : null, key = req.body?.key;
  if (!kind || !profileKeyOk(req.user.id, key) || !/\/(photo|video)-/.test(key)) return res.status(400).json({ error: 'requête invalide' });
  try { await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })); } catch { return res.status(404).json({ error: 'Fichier absent de R2 : envoi incomplet' }); }
  const privacy = PRIVACY.includes(req.body?.privacy) ? req.body.privacy : 'public';
  const m = await db.addMedia(req.user.id, kind, key, privacy);
  res.json({ media: m ? { id: m.id, kind, privacy, url: await mediaUrl(key), createdAt: m.created_at } : null });
}));
social.delete('/me/media/:id', needUser, wrap(async (req, res) => {
  const key = /^\d+$/.test(req.params.id) ? await db.deleteMedia(req.user.id, req.params.id) : null;
  if (!key) return res.status(404).json({ error: 'introuvable' });
  if (configured) s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })).catch(() => {});
  res.json({ ok: true });
}));
social.get('/users/:handle/media', wrap(async (req, res) => {
  const p = await profileOf(req, req.params.handle); if (!p) return res.status(404).json({ error: 'créateur introuvable' });
  const kind = req.query.kind === 'video' ? 'video' : 'photo';
  if (p.private) return res.json({ items: [], private: true });
  const rows = configured ? await db.listMedia(p._id, kind, req.user?.id) : [];
  res.json({ items: await Promise.all(rows.map(async (r) => ({ id: r.id, kind: r.kind, privacy: r.privacy, url: await mediaUrl(r.key), createdAt: r.created_at }))) });
}));
social.patch('/me/media/:id', needUser, wrap(async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !PRIVACY.includes(req.body?.privacy)) return res.status(400).json({ error: 'requête invalide' });
  if (!(await db.setMediaPrivacy(req.user.id, req.params.id, req.body.privacy))) return res.status(404).json({ error: 'introuvable' });
  res.json({ ok: true, privacy: req.body.privacy });
}));
social.patch('/clips/:id/privacy', needUser, wrap(async (req, res) => {
  if (!clipId(req.params.id) || !PRIVACY.includes(req.body?.privacy)) return res.status(400).json({ error: 'requête invalide' });
  if (!(await db.setClipPrivacy(req.user.id, req.params.id, req.body.privacy))) return res.status(404).json({ error: 'clip introuvable' });
  res.json({ ok: true, privacy: req.body.privacy });
}));
social.get('/me/follow-requests', needUser, wrap(async (req, res) => res.json({ requests: await db.pendingRequests(req.user.id) })));
social.post('/me/follow-requests/:handle', needUser, wrap(async (req, res) => {
  if (!(await db.answerRequest(req.user.id, String(req.params.handle).slice(0, 80), req.body?.accept === true))) return res.status(404).json({ error: 'demande introuvable' });
  res.json({ ok: true });
}));
social.put('/clips/:id/favorite', needUser, wrap(async (req, res) => { const c = await clipOr404(req, res); if (!c) return; res.json(await db.setFavorite(req.user.id, c.id, flag(req))); }));
social.patch('/me', needUser, wrap(async (req, res) => {
  const b = req.body || {}, s = {};
  for (const k of ['notifications', 'private_profile', 'allow_messages']) if (typeof b[k] === 'boolean') s[k] = b[k];
  if (typeof b.display_name === 'string') { const n = b.display_name.trim().slice(0, 40); if (n.length < 2) return res.status(400).json({ error: 'Nom trop court', field: 'name' }); s.display_name = n; }
  if (typeof b.username === 'string') { const h = b.username.trim().replace(/^@/, '').toLowerCase(); if (!/^[a-z0-9_.]{3,24}$/.test(h)) return res.status(400).json({ error: 'Nom d’utilisateur : 3 à 24 caractères (lettres, chiffres, _ ou .)', field: 'username' }); if (h !== req.user.handle) s.handle = h; }
  if (typeof b.bio === 'string') s.bio = b.bio.trim().slice(0, 300);
  if (typeof b.city === 'string') s.city = b.city.trim().slice(0, 60);
  if (typeof b.link === 'string') {
    let l = b.link.trim().slice(0, 200);
    if (l) { if (!/^https?:\/\//i.test(l)) l = 'https://' + l; try { const u = new URL(l); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw 0; l = u.href; } catch { return res.status(400).json({ error: 'Lien invalide', field: 'link' }); } }
    s.link = l;
  }
  for (const [k, col] of [['avatar_key', 'avatar_key'], ['cover_key', 'cover_key']]) if (b[k] != null) {
    if (!profileKeyOk(req.user.id, b[k]) || !b[k].includes(`/${k.split('_')[0]}-`)) return res.status(400).json({ error: 'image invalide' });
    s[col] = b[k];
  }
  const r = await db.updateSettings(req.user.id, s);
  if (r.error) return res.status(409).json({ error: 'Ce nom d’utilisateur est déjà pris', field: 'username' });
  res.json({ user: await presentUser(r.user) });
}));
social.delete('/me', needUser, wrap(async (req, res) => {
  const keys = await db.deleteAccount(req.user.id, String(req.body?.password || ''));
  if (!keys) return res.status(403).json({ error: 'Mot de passe incorrect' });
  res.clearCookie(SID, { path: '/' });
  if (configured) for (const Key of keys) s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key })).catch(() => {});
  res.json({ ok: true });
}));
app.use('/api', social);

// One DB row per clip (id is the primary key, so a retry can never create a duplicate).
api.post('/publish', needDb, needUser, wrap(async (req, res) => {
  const { key, title = '', description = '', comment = '', musicId = null, enhancement = {}, poster = false, trim = null, filter = '', privacy = 'public' } = req.body;
  if (!PRIVACY.includes(privacy)) return res.status(400).json({ error: 'visibilité invalide' });
  if (!keyOk(key)) return res.status(400).json({ error: 'bad request' });
  if (String(title).trim().length < 2 || /\b(?:VID|IMG|MOV|MVI|PXL|DSC|WA)[-_ ]*\d/i.test(title)) return res.status(400).json({ error: 'Titre requis (pas un nom de fichier)' });
  const music = musicId ? musicById(musicId) : null;
  if (musicId && !music) return res.status(400).json({ error: 'musique inconnue' });
  const fx = { eclairage: Number(enhancement.eclairage) || 0, couleur: Number(enhancement.couleur) || 0, cartoon: !!enhancement.cartoon };
  let pk = null;
  if (poster) { try { await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: posterKey(key) })); pk = posterKey(key); } catch {} }
  const tr = trim && Number.isFinite(+trim.start) && Number.isFinite(+trim.end) && +trim.start >= 0 && +trim.end - +trim.start >= 1 ? { start: +trim.start, end: +trim.end } : null;
  if (filter && !FILTERS[filter]) return res.status(400).json({ error: 'filtre inconnu' });
  let rend;
  try { rend = await transcode({ s3, bucket: R2_BUCKET, key, id: idOf(key), trim: tr, filter }); }
  catch (e) { console.error('[transcode]', e.message); return res.status(500).json({ error: 'Compression de la vidéo impossible : ' + e.message.slice(0, 160) }); }
  const row = await upsertClip({
    id: idOf(key), userId: req.user.id, key, posterKey: pk, v720Key: rend.v720, v360Key: rend.v360, title: String(title).trim().slice(0, 120),
    description: String(description).slice(0, 2200), comment: String(comment).slice(0, 2200),
    privacy, musicId, musicName: music?.name || null, musicArtist: music?.artist || null, enhancement: fx,
  });
  res.json((await presentAll(req, [row]))[0]);
}));

api.post('/upload/abort', wrap(async (req, res) => {
  const { key, uploadId } = req.body;
  if (!keyOk(key) || !uploadId) return res.status(400).json({ error: 'bad request' });
  await s3.send(new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: key, UploadId: uploadId }));
  res.json({ ok: true });
}));

const findKey = async (id) => { const row = dbConfigured ? await clipById(id) : null; if (row) return row.key; for (const e of Object.keys(TYPES)) { const k = `clips/${id}.${e}`; try { await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: k })); return k; } catch {} } return null; };
const clipId = (id) => typeof id === 'string' && /^[\w.-]+$/.test(id) && id.length < 80;

// One clip by id (deep link /c/:id).
api.get('/clips/:id', needDb, wrap(async (req, res) => {
  if (!clipId(req.params.id)) return res.status(400).json({ error: 'bad request' });
  const row = await clipById(req.params.id);
  if (!row || !(await db.clipVisible(row.id, req.user?.id))) return res.status(404).json({ error: 'clip introuvable' });
  res.set('Cache-Control', 'no-store').json((await presentAll(req, [row]))[0]);
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

// The feed: straight from the database, newest first, keyset-paginated (?limit=&before=).
api.get('/clips', needDb, wrap(async (req, res) => {
  const { rows, next } = await dbFeed({ limit: Number(req.query.limit) || 10, before: /^[\w:.+-]+_[\w.-]+$/.test(req.query.before || '') ? req.query.before : undefined, q: String(req.query.q || '').trim().slice(0, 80) || undefined, viewerId: req.user?.id });
  res.set('Cache-Control', 'no-store').json({ clips: await presentAll(req, rows), next, build: BUILD_ID });
}));

// One-time import of clips that already live in R2 (old meta/*.json records) into the database.
async function backfill() {
  if (!configured || !dbConfigured) return;
  const known = await knownKeys(); let n = 0, token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: 'clips/', ContinuationToken: token }));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
    for (const o of (r.Contents || []).filter((o) => keyOk(o.Key) && !known.has(o.Key))) {
      let m = {};
      try { const g = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: metaKey(o.Key) })); m = JSON.parse(await g.Body.transformToString()); } catch {}
      await upsertClip({
        id: idOf(o.Key), userId: getDefaultUserId(), key: o.Key, title: m.title || '', description: m.description || '', comment: m.comment || '',
        musicId: m.music?.id || null, musicName: m.music?.name || null, musicArtist: m.music?.artist || null, enhancement: m.enhancement || {},
        createdAt: m.publishedAt || o.LastModified.toISOString(),
      }); n++;
    }
  } while (token);
  if (n) console.log(`[db] imported ${n} existing clip(s) from R2`);
}
// Clips published before compression existed get their 720p/360p renditions in the background, one at a time.
async function backfillRenditions() {
  if (!configured || !dbConfigured) return;
  const { rows } = await db.pool.query('SELECT id, key FROM clips.clips WHERE v720_key IS NULL ORDER BY created_at DESC');
  for (const r of rows) {
    try {
      const o = await transcode({ s3, bucket: R2_BUCKET, key: r.key, id: r.id });
      await db.pool.query('UPDATE clips.clips SET v720_key = $2, v360_key = $3 WHERE id = $1', [r.id, o.v720, o.v360]);
      console.log(`[transcode] backfilled ${r.id}`, o.sizes);
    } catch (e) { console.error(`[transcode] backfill ${r.id} failed:`, e.message); }
  }
}
migrate().then(() => { console.log(dbConfigured ? '[db] ready' : '[db] DATABASE_URL not set'); return backfill(); }).then(backfillRenditions)
  .catch((e) => console.error('[db] startup failed:', e.message));

app.get('/api/config', async (req, res) => {
  const h = await checkBucket(req.query.force === '1');
  res.json({ configured, db: dbConfigured, cdn: !!CDN, build: BUILD_ID, bucketOk: !!h.ok, error: h.ok ? undefined : h.error, maxMB: MAX_SIZE / 1048576 });
});
app.use('/api', api);
app.use('/vendor/ffmpeg', express.static(nm('@ffmpeg/ffmpeg/dist/esm')));
app.use('/vendor/core', express.static(nm('@ffmpeg/core/dist/esm')));
const vars = { BRAND_NAME, TAB_LABEL, CANONICAL_URL, BUILD_ID };
const template = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const attr = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const render = (extra = {}) => template.replace(/\{\{(\w+)\}\}/g, (_, k) => attr({ ...vars, OG_TITLE: BRAND_NAME, PAGE_URL: CANONICAL_URL, ...extra }[k] ?? ''));
const indexHtml = render();
const noStore = (res) => res.set('Cache-Control', 'no-store').set('X-Build-Id', BUILD_ID);
const sendIndex = (req, res) => noStore(res).type('html').send(indexHtml);
// Shared clip link: same app, with the clip's title in the link preview.
app.get('/c/:id', async (req, res) => {
  const id = req.params.id; let title = '';
  if (dbConfigured && clipId(id)) { const m = await clipById(id).catch(() => null); title = (m?.description || m?.title || '').split('\n')[0].slice(0, 90); }
  noStore(res).type('html').send(render({ OG_TITLE: title ? `${title} - ${BRAND_NAME}` : BRAND_NAME, PAGE_URL: `${CANONICAL_URL}/c/${id}` }));
});
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(path.join(__dirname, 'public'), { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
app.use(sendIndex);

const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => console.log(`listening on ${port}, R2 ${configured ? 'configured' : 'NOT configured'}`));
