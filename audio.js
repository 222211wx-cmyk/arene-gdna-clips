// Audio studio server side: temporary sound store (uploads, voice takes, pasted links), synthetic sound effects, and track resolution for the final mix.
// Nothing here touches R2: sounds live on local disk for a few hours, only the mixed video is stored.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { byId as musicById } from './music.js';

const DIR = path.join(os.tmpdir(), 'arena-audio');
fs.mkdirSync(DIR, { recursive: true });
export const MAX_BYTES = 30 * 1024 * 1024;
const TTL = 12 * 3600 * 1000;
setInterval(() => { for (const f of fs.readdirSync(DIR)) { const p = path.join(DIR, f); try { if (Date.now() - fs.statSync(p).mtimeMs > TTL) fs.rmSync(p, { force: true }); } catch {} } }, 3600 * 1000).unref();

const run = (cmd, args, ms = 60000) => new Promise((ok, ko) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = '';
  const t = setTimeout(() => p.kill('SIGKILL'), ms);
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  p.on('error', (e) => { clearTimeout(t); ko(e); });
  p.on('close', (c) => { clearTimeout(t); c === 0 ? ok(out) : ko(new Error(err.split('\n').slice(-3).join(' '))); });
});
export const duration = async (file) => Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).trim()) || 0;
export const hasAudio = async (file) => (await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).catch(() => '')).trim() !== '';

/* ---------- sound effects: generated with ffmpeg, cached ---------- */
export const SFX = [
  { id: 'whoosh', name: 'Whoosh', tags: ['whoosh', 'transition', 'vent', 'swipe'], src: 'anoisesrc=d=1.2:c=pink:a=0.7,highpass=f=250,lowpass=f=5000,afade=t=in:d=0.5,afade=t=out:st=0.6:d=0.6' },
  { id: 'applause', name: 'Applaudissements', tags: ['applaudissements', 'applause', 'public', 'foule', 'bravo'], src: 'anoisesrc=d=4:c=white:a=0.6,highpass=f=1500,lowpass=f=7000,tremolo=f=14:d=0.9,afade=t=in:d=0.4,afade=t=out:st=3:d=1' },
  { id: 'ding', name: 'Ding', tags: ['ding', 'cloche', 'notification', 'succes'], src: 'sine=f=1320:d=1.4,afade=t=out:st=0.05:d=1.3' },
  { id: 'boom', name: 'Impact grave', tags: ['boom', 'impact', 'explosion', 'tonnerre'], src: 'sine=f=55:d=1.6,afade=t=out:st=0.05:d=1.5,volume=2' },
  { id: 'horror', name: 'Drone horreur', tags: ['horreur', 'horror', 'peur', 'suspense', 'sombre', 'triste'], src: 'sine=f=70:d=5,tremolo=f=5:d=0.8,afade=t=in:d=1.5,afade=t=out:st=3.5:d=1.5' },
  { id: 'alarm', name: 'Alarme', tags: ['alarme', 'alarm', 'sirene', 'danger'], src: 'aevalsrc=0.6*sin(2*PI*(900+300*sin(2*PI*2*t))*t):d=3' },
  { id: 'rain', name: 'Pluie', tags: ['pluie', 'rain', 'calme', 'nature', 'triste'], src: 'anoisesrc=d=6:c=pink:a=0.5,lowpass=f=3500,highpass=f=300,tremolo=f=30:d=0.3,afade=t=in:d=0.8,afade=t=out:st=5:d=1' },
  { id: 'rise', name: 'Montée tension', tags: ['montee', 'tension', 'riser', 'motivation', 'epique'], src: 'aevalsrc=0.5*sin(2*PI*(120+90*t)*t):d=4,afade=t=out:st=3.5:d=0.5' },
];
export const sfxById = (id) => SFX.find((x) => x.id === id);
const sfxCache = new Map();
export function sfxFile(id) {
  const x = sfxById(id); if (!x) return Promise.reject(Object.assign(new Error('effet inconnu'), { status: 404 }));
  const out = path.join(DIR, `sfx-${id}.mp3`);
  if (!sfxCache.has(id)) sfxCache.set(id, (fs.existsSync(out) ? Promise.resolve() : run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', x.src, '-ac', '2', '-ar', '44100', '-b:a', '128k', out + '.tmp.mp3']).then(() => fs.renameSync(out + '.tmp.mp3', out))).then(() => out, (e) => { sfxCache.delete(id); throw e; }));
  return sfxCache.get(id);
}

/* ---------- catalog music: downloaded once, cached ---------- */
const musicCache = new Map();
export function musicFile(id) {
  const t = musicById(id); if (!t) return Promise.reject(Object.assign(new Error('musique inconnue'), { status: 404 }));
  const out = path.join(DIR, `music-${id}.mp3`);
  if (!musicCache.has(id)) musicCache.set(id, (fs.existsSync(out) ? Promise.resolve() : fetch(t.src).then(async (r) => { if (!r.ok) throw new Error('source musique indisponible'); fs.writeFileSync(out + '.tmp', Buffer.from(await r.arrayBuffer())); fs.renameSync(out + '.tmp', out); })).then(() => out, (e) => { musicCache.delete(id); throw e; }));
  return musicCache.get(id);
}

/* ---------- user sounds (upload / voice take / pasted link) ---------- */
const idOk = (s) => /^[a-f0-9]{24}$/.test(s);
const upPath = (id) => path.join(DIR, `up-${id}`);
const metaPath = (id) => upPath(id) + '.json';
export const upFile = (id, userId) => {
  if (!idOk(id) || !fs.existsSync(upPath(id))) return null;
  try { if (JSON.parse(fs.readFileSync(metaPath(id), 'utf8')).userId !== userId) return null; } catch { return null; }
  return upPath(id);
};
async function keep(tmp, userId, name) {
  if (!(await hasAudio(tmp))) { fs.rmSync(tmp, { force: true }); throw Object.assign(new Error('Ce fichier ne contient pas de son lisible'), { status: 400 }); }
  const id = crypto.randomBytes(12).toString('hex');
  fs.renameSync(tmp, upPath(id)); fs.writeFileSync(metaPath(id), JSON.stringify({ userId, name }));
  return { ref: 'up:' + id, name, preview: `/api/audio/up/${id}` };
}
// raw bytes from the phone / microphone
export async function saveUpload(stream, userId, name) {
  const tmp = path.join(DIR, 'in-' + crypto.randomBytes(8).toString('hex')); let n = 0;
  try {
    await pipeline(stream, async function* (src) { for await (const c of src) { n += c.length; if (n > MAX_BYTES) throw Object.assign(new Error('Fichier trop lourd (30 Mo maximum)'), { status: 413 }); yield c; } }, fs.createWriteStream(tmp));
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  if (!n) { fs.rmSync(tmp, { force: true }); throw Object.assign(new Error('Fichier vide'), { status: 400 }); }
  return keep(tmp, userId, name);
}
const privateIp = (ip) => {
  if (net.isIPv6(ip)) { const l = ip.toLowerCase(); return l === '::1' || l === '::' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || (l.startsWith('::ffff:') && privateIp(l.slice(7))); }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128) || a >= 224;
};
// pasted link: only direct audio files; never internal addresses; YouTube & co cannot be downloaded
export async function saveFromUrl(raw, userId) {
  let u; try { u = new URL(String(raw).trim()); } catch { throw Object.assign(new Error('Lien invalide'), { status: 400 }); }
  for (let hop = 0; ; hop++) {
    if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Lien invalide'), { status: 400 });
    if (/(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|spotify\.com|soundcloud\.com)$/i.test(u.hostname)) throw Object.assign(new Error('Les liens YouTube, TikTok, Spotify… ne peuvent pas être importés (droits d’auteur). Collez un lien direct vers un fichier MP3 / audio, ou envoyez le fichier.'), { status: 400 });
    const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true }).catch(() => []);
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw Object.assign(new Error('Adresse non autorisée'), { status: 400 });
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'ArenaClips/1.0' } }).catch(() => { throw Object.assign(new Error('Lien injoignable'), { status: 400 }); });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location') && hop < 3) { u = new URL(r.headers.get('location'), u); continue; }
    if (!r.ok || !r.body) throw Object.assign(new Error('Lien injoignable (' + r.status + ')'), { status: 400 });
    if (/text\/html/i.test(r.headers.get('content-type') || '')) throw Object.assign(new Error('Ce lien est une page web, pas un fichier audio'), { status: 400 });
    const name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'Son collé').slice(0, 60);
    return saveUpload(Readable.fromWeb(r.body), userId, name);
  }
}

/* ---------- resolve the tracks of a publish request into local files ---------- */
export async function resolveTrack(ref, userId) {
  const [kind, id] = String(ref).split(':');
  if (kind === 'music') return musicFile(id);
  if (kind === 'fx') return sfxFile(id);
  if (kind === 'up') { const f = upFile(id, userId); if (!f) throw Object.assign(new Error('Son introuvable (expiré ?), ajoutez-le à nouveau'), { status: 400 }); return f; }
  throw Object.assign(new Error('Son invalide'), { status: 400 });
}
export const CATS = ['music', 'voice', 'fx'];
const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
// Raw body -> safe audio spec, or null when the clip keeps its sound untouched.
export function cleanAudio(a) {
  if (!a || typeof a !== 'object') return null;
  const tracks = (Array.isArray(a.tracks) ? a.tracks : []).slice(0, 12).filter((t) => t && /^(music:m\d+|fx:[a-z]+|up:[a-f0-9]{24})$/.test(String(t.ref)) && CATS.includes(t.cat))
    .map((t) => ({ ref: String(t.ref), cat: t.cat, volume: num(t.volume, 0, 100, 100), offset: num(t.offset, 0, 3600, 0) }));
  const removeOriginal = !!a.removeOriginal, originalVolume = num(a.originalVolume, 0, 100, 100);
  if (!removeOriginal && !tracks.length && originalVolume === 100) return null;
  return { removeOriginal, originalVolume, tracks };
}
