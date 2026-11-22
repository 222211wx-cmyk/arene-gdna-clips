// Compress in the browser (ffmpeg.wasm, H.264/AAC MP4) -> upload ONLY the compressed file to R2
// with 20 parallel presigned multipart parts, resumable across reloads / network loss.
import { FFmpeg } from '/vendor/ffmpeg/index.js';

const MODES = {
  normal: { vb: 1000, ab: 96, long: 1280, short: 720 },   // 720p, 1 Mbps
  powder: { vb: 500, ab: 64, long: 854, short: 480 },     // 480p, 500 kbps
};
const THREADS = 20;
const $ = (id) => document.getElementById(id);
const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);
const originals = new Map();   // clip key -> original File (this device, this session only)
let mode = 'normal', busy = false, ffmpeg = null;

/* ---------- UI ---------- */
const sheet = $('up-sheet'), bar = $('up-bar'), label = $('up-label'), result = $('up-result');
$('up-open').onclick = () => { sheet.hidden = false; };
$('up-close').onclick = () => { if (!busy) sheet.hidden = true; };
for (const b of document.querySelectorAll('[data-mode]')) {
  b.onclick = () => { if (busy) return; mode = b.dataset.mode; document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b)); };
}
const setProgress = (txt, pct) => { label.textContent = txt; bar.style.width = pct + '%'; };

/* ---------- Studio: 1 fichier -> 2 description (AI) -> 3 publier ---------- */
const st = { file: null, music: null, fx: { eclairage: 0, couleur: 0, cartoon: false }, ctx: {} };
const fxCss = () => st.fx.cartoon ? 'contrast(1.35) saturate(2) brightness(1.05)' : `brightness(${1 + st.fx.eclairage / 100}) saturate(${1 + st.fx.couleur / 100})`;
const applyFxPreview = () => { $('st-prev').style.filter = fxCss(); };

$('up-file').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file || busy) return;
  st.file = file; st.music = null; st.fx = { eclairage: 0, couleur: 0, cartoon: false };
  result.innerHTML = ''; setProgress('', 0); renderMusic(); applyFxPreview();
  const pv = $('st-prev'); pv.src = URL.createObjectURL(file);
  $('st-1').hidden = true; $('st-2').hidden = false; $('up-title').textContent = 'Description';
  $('ai-list').innerHTML = ''; $('ai-reply').textContent = 'كنشوف الفيديو…';
  st.ctx = await analyze(file).catch(() => ({}));
  ask('');   // AI already has suggestions when the user lands here
};

async function analyze(file) {
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = URL.createObjectURL(file);
  await new Promise((ok, ko) => { v.onloadeddata = ok; v.onerror = ko; setTimeout(ko, 8000); });
  const d = v.duration || 1, frames = []; let br = 0, sa = 0, n = 0;
  const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
  for (const t of [0.15, 0.5, 0.85]) {
    v.currentTime = d * t; await new Promise((r) => { v.onseeked = r; setTimeout(r, 2000); });
    const w = 320, h = Math.round(w * (v.videoHeight / v.videoWidth)) || 180; c.width = w; c.height = h; g.drawImage(v, 0, 0, w, h);
    frames.push(c.toDataURL('image/jpeg', 0.55));
    const px = g.getImageData(0, 0, w, h).data;
    for (let i = 0; i < px.length; i += 64) { const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]); br += (px[i] + px[i + 1] + px[i + 2]) / 765; sa += mx ? (mx - mn) / mx : 0; n++; }
  }
  URL.revokeObjectURL(v.src);
  return { frames, duration: Math.round(d), brightness: +(br / n).toFixed(2), saturation: +(sa / n).toFixed(2), orientation: v.videoWidth >= v.videoHeight ? 'landscape' : 'portrait', hint: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') };
}

/* ---------- AI ---------- */
async function ask(prompt) {
  $('ai-reply').textContent = '…';
  try {
    const r = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, context: { ...st.ctx, description: $('st-desc').value } }) });
    const j = await r.json(); $('ai-reply').textContent = j.reply; renderAI(j.items || []);
  } catch { $('ai-reply').textContent = 'تعذر الوصول لـ AI، عاود حاول.'; }
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderAI(items) {
  const box = $('ai-list'); box.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div'); row.className = 'ai-item';
    row.innerHTML = (it.track ? `<img src="${it.track.cover}" width="40" height="40" style="border-radius:8px">` : '') + `<div class="tx"><b>${esc(it.title)}</b>${esc(it.text)}</div>`;
    if (it.track) { const pb = playBtn(it.track); row.appendChild(pb); }
    const u = document.createElement('button'); u.className = 'use'; u.textContent = 'استعمل هادا';
    u.onclick = () => { applyItem(it); u.textContent = '✓ تم'; u.classList.add('done'); };
    row.appendChild(u); box.appendChild(row);
  }
}
function applyItem(it) {
  if (it.track) return chooseMusic(it.track);
  const u = it.use || {};
  if (u.description) $('st-desc').value = u.description;
  if (u.fx === 'enhance') { st.fx.cartoon = false; st.fx.eclairage = u.eclairage; st.fx.couleur = u.couleur; }
  if (u.fx === 'cartoon') st.fx.cartoon = true;
  applyFxPreview();
}
document.querySelectorAll('.ai-chips [data-q]').forEach((b) => { b.onclick = () => ask(b.dataset.q); });
const sendQ = () => { const q = $('ai-q').value.trim(); if (q) { ask(q); $('ai-q').value = ''; } };
$('ai-send').onclick = sendQ;
$('ai-q').onkeydown = (e) => { if (e.key === 'Enter') sendQ(); };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
$('ai-mic').onclick = () => {
  if (!SR) { $('ai-reply').textContent = 'المتصفح ما كيدعمش الصوت، كتب الطلب.'; return; }
  const r = new SR(); r.lang = 'ar-MA'; r.interimResults = false;
  const mic = $('ai-mic'); mic.classList.add('rec');
  r.onresult = (e) => { const q = e.results[0][0].transcript; $('ai-q').value = q; sendQ(); };
  r.onerror = () => { $('ai-reply').textContent = 'ما قدرتش نسمعك، عاود.'; };
  r.onend = () => mic.classList.remove('rec');
  r.start();
};

/* ---------- Musique: playlist + search + preview ---------- */
const player = new Audio(); let playingId = null;
player.onended = () => { playingId = null; document.querySelectorAll('.mu-play').forEach((b) => { b.textContent = '▶'; }); };
function playBtn(t) {
  const b = document.createElement('button'); b.className = 'mu-play'; b.textContent = playingId === t.id ? '❚❚' : '▶'; b.dataset.id = t.id; b.title = 'Play';
  b.onclick = () => {
    const was = playingId === t.id; player.pause(); document.querySelectorAll('.mu-play').forEach((x) => { x.textContent = '▶'; });
    if (was) { playingId = null; return; }
    player.src = t.audio; player.play().catch(() => {}); playingId = t.id;
    document.querySelectorAll(`.mu-play[data-id="${t.id}"]`).forEach((x) => { x.textContent = '❚❚'; });
  };
  return b;
}
async function loadPlaylist(q = '') {
  const { tracks } = await fetch('/api/music?q=' + encodeURIComponent(q)).then((r) => r.json());
  const box = $('mu-list'); box.innerHTML = tracks.length ? '' : '<div style="padding:8px;color:#aaa">Aucun résultat</div>';
  for (const t of tracks) {
    const row = document.createElement('div'); row.className = 'mu-item';
    row.innerHTML = `<img src="${t.cover}" alt=""><div class="tx">${esc(t.name)}<small>${esc(t.artist)} · ${esc(t.mood)}</small></div>`;
    row.appendChild(playBtn(t));
    const u = document.createElement('button'); u.className = 'use'; u.textContent = 'استعمل هادي'; u.onclick = () => chooseMusic(t);
    row.appendChild(u); box.appendChild(row);
  }
}
let qT; $('mu-q').oninput = (e) => { clearTimeout(qT); qT = setTimeout(() => loadPlaylist(e.target.value), 200); };
$('st-music-btn').onclick = () => { const p = $('mu-panel'); p.hidden = !p.hidden; if (!p.hidden) loadPlaylist($('mu-q').value); };
function chooseMusic(t) { st.music = t; player.pause(); playingId = null; $('mu-panel').hidden = true; renderMusic(); }
function renderMusic() {
  $('st-music-btn').textContent = st.music ? `♫ ${st.music.name} — ${st.music.artist}` : '♫ Choisir une musique';
  $('st-music-del').hidden = !st.music;
  const pv = $('st-prev'); pv.muted = !!st.music;   // original sound is replaced by the chosen music
}
$('st-music-del').onclick = () => { st.music = null; renderMusic(); };

/* ---------- Publier: compress (+ fx + music mix) -> upload -> record description & MusicId ---------- */
$('st-pub').onclick = async () => {
  const file = st.file;
  if (!file || busy) return;
  busy = true; result.innerHTML = ''; $('st-pub').disabled = true; player.pause();
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    if (!cfg.configured) throw new Error('R2 غير مهيأ في السيرفر (R2_* variables)');
    const music = st.music, fx = { ...st.fx }, description = $('st-desc').value;
    const fp = `${file.name}|${file.size}|${file.lastModified}|${mode}|${music ? music.id : '-'}|${JSON.stringify(fx)}`;
    let blob = await idbGet(fp);
    if (blob) setProgress('تم الضغط من قبل، كنكمل الرفع…', 100);
    else {
      blob = await compress(file, MODES[mode], { music, fx });
      await idbPut(fp, blob).catch(() => {});
    }
    const key = await upload(blob, fp);
    await idbDel(fp).catch(() => {});
    originals.set(key, file);
    await api('/publish', { key, description, musicId: music ? music.id : null });
    const saved = Math.max(0, Math.round((1 - blob.size / file.size) * 100));
    result.innerHTML = `<div>تم النشر ✅ قبل: ${mb(file.size)} MB -> من بعد: ${mb(blob.size)} MB | وفرتي ${saved}%${music ? ' | ♫ ' + esc(music.name) : ''}</div>`;
    const a = document.createElement('a');
    a.className = 'up-dl'; a.textContent = 'تحميل الأصلي'; a.href = URL.createObjectURL(file); a.download = file.name;
    result.appendChild(a);
    await loadLatestClip();
    st.file = null; $('st-2').hidden = true; $('st-1').hidden = false; $('up-title').textContent = 'Nouveau clip';
  } catch (err) {
    console.error(err);
    setProgress('❌ ' + err.message + ' — ضغط Publier باش يكمل', 0);
  } finally { busy = false; $('st-pub').disabled = false; }
};

/* ---------- compression ---------- */
async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  const f = new FFmpeg();
  await f.load({ coreURL: location.origin + '/vendor/core/ffmpeg-core.js', wasmURL: location.origin + '/vendor/core/ffmpeg-core.wasm' });
  return (ffmpeg = f);
}

async function compress(file, m, { music = null, fx = {} } = {}) {
  setProgress('كيضغط... بودرة ⏳ 0%', 0);
  const f = await getFFmpeg();
  const onProgress = ({ progress }) => {
    const p = Math.max(0, Math.min(100, Math.round(progress * 100)));
    setProgress(`كيضغط... بودرة ⏳ ${p}%`, p);
  };
  f.on('progress', onProgress);
  try {
    // Never upscale: long side capped at m.long, short side at m.short, whichever way the video is turned.
    let vf = `scale='if(gte(iw,ih),min(${m.long},iw),min(${m.short},iw))':'if(gte(iw,ih),min(${m.short},ih),min(${m.long},ih))':force_original_aspect_ratio=decrease:force_divisible_by=2`;
    if (fx.cartoon) vf += `,eq=saturation=1.9:contrast=1.25,lutrgb=r='trunc(val/40)*40+20':g='trunc(val/40)*40+20':b='trunc(val/40)*40+20'`;
    else if (fx.eclairage || fx.couleur) vf += `,eq=brightness=${(fx.eclairage / 200).toFixed(3)}:saturation=${(1 + fx.couleur / 100).toFixed(2)}`;
    if (music) {
      setProgress('كنجيب الموسيقى…', 0);
      const buf = await fetch(`/api/music/${music.id}/audio`).then((r) => { if (!r.ok) throw new Error('الموسيقى ما تحملاتش'); return r.arrayBuffer(); });
      await f.writeFile('music.mp3', new Uint8Array(buf));
    }
    await f.createDir('/in').catch(() => {});
    // Fixed ASCII name: any container/extension/odd characters in the original name work. ffmpeg probes content, not the name.
    await f.mount('WORKERFS', { files: [new File([file], 'input')] }, '/in');   // read the big file lazily, no copy in RAM
    const code = await f.exec([
      '-i', '/in/input', ...(music ? ['-stream_loop', '-1', '-i', 'music.mp3', '-map', '0:v:0', '-map', '1:a:0', '-shortest'] : ['-map', '0:v:0', '-map', '0:a:0?']), '-sn', '-dn', '-vf', vf, '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${m.vb}k`, '-maxrate', `${Math.round(m.vb * 1.2)}k`, '-bufsize', `${m.vb * 2}k`,
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', `${m.ab}k`, '-movflags', '+faststart', '-y', 'out.mp4',
    ]);
    if (code !== 0) throw new Error('فشل الضغط (ffmpeg ' + code + ')');
    const data = await f.readFile('out.mp4');
    await f.deleteFile('out.mp4').catch(() => {});
    if (music) await f.deleteFile('music.mp3').catch(() => {});
    setProgress('كيضغط... بودرة ⏳ 100%', 100);
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    f.off('progress', onProgress);
    await f.unmount('/in').catch(() => {});
    await f.deleteDir('/in').catch(() => {});
  }
}

/* ---------- resumable multipart upload ---------- */
const api = async (path, body) => {
  const r = await (body ? fetch('/api' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) : fetch('/api' + path));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'API ' + r.status);
  return j;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const online = () => navigator.onLine ? Promise.resolve() : new Promise((r) => addEventListener('online', r, { once: true }));

async function upload(blob, fp) {
  const lsKey = 'upl:' + fp;
  let s = JSON.parse(localStorage.getItem(lsKey) || 'null');
  let done = new Set();
  if (s) {
    const r = await api(`/upload/parts?key=${encodeURIComponent(s.key)}&uploadId=${encodeURIComponent(s.uploadId)}`).catch(() => ({ gone: true }));
    if (r.gone) s = null; else done = new Set(r.parts.map((p) => p.partNumber));
  }
  if (!s) {
    const i = await api('/upload/init', { size: blob.size });
    s = { key: i.key, uploadId: i.uploadId, partSize: i.partSize };
    localStorage.setItem(lsKey, JSON.stringify(s));
  }
  const total = Math.max(1, Math.ceil(blob.size / s.partSize));
  const sent = new Array(total + 1).fill(0);           // bytes sent per part (live)
  const partLen = (n) => Math.min(s.partSize, blob.size - (n - 1) * s.partSize);
  for (const n of done) sent[n] = partLen(n);
  const render = () => { const t = sent.reduce((a, b) => a + b, 0); const p = Math.min(100, Math.floor((t / blob.size) * 100)); setProgress(`كيرفع ⬆️ ${p}% (${mb(t)}/${mb(blob.size)} MB)`, p); };
  render();

  const queue = []; for (let n = 1; n <= total; n++) if (!done.has(n)) queue.push(n);
  const worker = async () => {
    for (let n; (n = queue.shift()) !== undefined;) {
      for (let attempt = 0; ; attempt++) {
        try {
          await online();
          const { url } = await api('/upload/part-url', { key: s.key, uploadId: s.uploadId, partNumber: n });
          await putPart(url, blob.slice((n - 1) * s.partSize, (n - 1) * s.partSize + partLen(n)), (b) => { sent[n] = b; render(); });
          sent[n] = partLen(n); render(); break;
        } catch (e) {
          sent[n] = 0; render();
          if (attempt >= 30) throw e;
          await sleep(Math.min(5000, 500 * 2 ** Math.min(attempt, 4)));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(THREADS, queue.length) }, worker));
  await api('/upload/complete', { key: s.key, uploadId: s.uploadId, totalParts: total });
  localStorage.removeItem(lsKey);
  setProgress('✅ تم الرفع 100%', 100);
  return s.key;
}

function putPart(url, chunk, onBytes) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error('PUT ' + x.status)));
    x.onerror = () => reject(new Error('network'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.timeout = 120000;
    x.send(chunk);
  });
}

/* ---------- IndexedDB: keep the compressed blob so a retry doesn't re-compress ---------- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('clips', 1); r.onupgradeneeded = () => r.result.createObjectStore('blobs'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbOp = async (mode, fn) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('blobs', mode); const rq = fn(t.objectStore('blobs')); t.oncomplete = () => res(rq.result); t.onerror = () => rej(t.error); }); };
const idbGet = (k) => idbOp('readonly', (s) => s.get(k)).catch(() => null);
const idbPut = (k, v) => idbOp('readwrite', (s) => s.put(v, k));
const idbDel = (k) => idbOp('readwrite', (s) => s.delete(k));

/* ---------- Clips page shows the compressed clip from R2 ---------- */
const announce = (key, meta) => document.dispatchEvent(new CustomEvent('clip', { detail: { id: key.slice(6, -4), title: (meta?.description || '').split('\n')[0] } }));
async function loadLatestClip() {
  try {
    const deep = (location.pathname.match(/^\/c\/([\w.-]+)/) || [])[1];
    const one = deep && deep !== 'demo' && !deep.startsWith('u-') ? await api('/clips/' + encodeURIComponent(deep)).catch(() => null) : null;
    if (deep && deep !== 'demo' && !one && !deep.startsWith('u-')) return;   // unknown shared clip: never show a different one
    const c = one || (await api('/clips')).clips[0];
    if (!c) return;
    const m = c.meta;
    if (m) { if (m.description) document.querySelector('.desc').textContent = m.description; if (m.musicId) { const t = (await api('/music?q=')).tracks.find((x) => x.id === m.musicId); if (t) document.querySelector('.music').textContent = `♫ ${t.name} - ${t.artist}`; } }
    announce(c.key, m);
    const v = $('vid'); v.src = c.url; v.load();
    const img = document.querySelector('.video-wrap img'); if (img) img.style.display = 'none';
  } catch { /* R2 not configured yet: keep the placeholder */ }
}
loadLatestClip();
