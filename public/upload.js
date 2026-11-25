// P.P.O. uploader: Parallel (8 pieces at once), Piece (size chosen by the server, grows for huge files), Open (no size cap).
// Straight to R2 with presigned pieces; resumable across reloads / network loss: only the pieces R2 does not have are sent.

const THREADS = 8;
const EXTS = ['mp4', 'mov', 'webm'], ARCH = ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz'];
const extOf = (f) => { const e = (f.name.split('.').pop() || '').toLowerCase(); return EXTS.includes(e) || ARCH.includes(e) ? e : f.type === 'video/quicktime' ? 'mov' : f.type === 'video/webm' ? 'webm' : f.type === 'video/mp4' ? 'mp4' : null; };
const CAMERA = /\b(?:VID|IMG|MOV|MVI|PXL|DSC|PIC|WA|Screen[ _-]?Recording)[-_ ]*\d/i;
const guessTitle = (f) => { const t = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(); return CAMERA.test(t) || /^[\d\s.]+$/.test(t) ? '' : t; };
const $ = (id) => document.getElementById(id);
const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);
const originals = new Map();   // clip key -> original File (this device, this session only)
let busy = false;

/* ---------- UI ---------- */
const sheet = $('up-sheet'), bar = $('up-bar'), label = $('up-label'), result = $('up-result');
// open/close (X, Back, Esc) are handled by app.js through the history stack
const setProgress = (txt, pct) => { label.textContent = txt; bar.style.width = pct + '%'; };

/* ---------- Studio: 1 fichier -> 2 description (AI) -> 3 publier ---------- */
const FCSS = { '': '', vif: 'saturate(1.4) contrast(1.1)', chaud: 'sepia(.25) saturate(1.2)', froid: 'hue-rotate(12deg) saturate(1.05)', nb: 'grayscale(1) contrast(1.1)', vintage: 'sepia(.5) contrast(.95)' };
const st = { filter: '', t0: 0, t1: 0, dur: 0, cover: null, file: null, music: null, fx: { eclairage: 0, couleur: 0, cartoon: false }, ctx: {} };
const fxCss = () => st.fx.cartoon ? 'contrast(1.35) saturate(2) brightness(1.05)' : `brightness(${1 + st.fx.eclairage / 100}) saturate(${1 + st.fx.couleur / 100})`;
const applyFxPreview = () => { $('st-prev').style.filter = st.filter ? FCSS[st.filter] : fxCss(); };

$('up-file').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file || busy) return;
  if (!extOf(file)) { setProgress('❌ Format non supporté: vidéo mp4, mov, webm ou archive zip, 7z, rar, tar, gz', 0); return; }
  if (ARCH.includes(extOf(file))) return importArchive(file);
  st.file = file; st.music = null; st.fx = { eclairage: 0, couleur: 0, cartoon: false };
  result.innerHTML = ''; setProgress('', 0); renderMusic(); applyFxPreview(); $('st-title').value = guessTitle(file);
  const pv = $('st-prev'); pv.src = URL.createObjectURL(file);
  st.filter = ''; st.cover = null; st.dur = 0; document.querySelectorAll('#st-filters button').forEach((b) => b.classList.toggle('on', !b.dataset.f)); applyFxPreview();
  pv.onloadedmetadata = () => { st.dur = pv.duration || 0; st.t0 = 0; st.t1 = st.dur; for (const id of ['st-t0', 'st-t1', 'st-cv']) $(id).max = st.dur.toFixed(1); $('st-t0').value = 0; $('st-t1').value = st.dur.toFixed(1); $('st-cv').value = 0; syncTools(); };
  $('st-1').hidden = true; $('st-2').hidden = false; $('up-title').textContent = 'Description';
  $('ai-list').innerHTML = ''; $('ai-reply').textContent = 'Analyse de la vidéo…';
  st.ctx = await analyze(file).catch(() => ({}));
  ask('');   // AI already has suggestions when the user lands here
};

/* ---------- Trim / Cover / Filtres ---------- */
function syncTools() {
  $('st-t0v').textContent = st.t0.toFixed(1); $('st-t1v').textContent = st.t1.toFixed(1);
  const c = Math.min(Math.max(st.cover ?? st.t0, st.t0), st.t1); $('st-cv').min = st.t0.toFixed(1); $('st-cv').max = st.t1.toFixed(1); $('st-cv').value = c; $('st-cvv').textContent = c.toFixed(1);
}
$('st-t0').oninput = (e) => { st.t0 = Math.min(+e.target.value, st.t1 - 1); if (st.t0 < 0) st.t0 = 0; e.target.value = st.t0; const pv = $('st-prev'); pv.pause(); pv.currentTime = st.t0; syncTools(); };
$('st-t1').oninput = (e) => { st.t1 = Math.max(+e.target.value, st.t0 + 1); if (st.t1 > st.dur) st.t1 = st.dur; e.target.value = st.t1; const pv = $('st-prev'); pv.pause(); pv.currentTime = Math.max(st.t0, st.t1 - 0.1); syncTools(); };
$('st-cv').oninput = (e) => { st.cover = +e.target.value; const pv = $('st-prev'); pv.pause(); pv.currentTime = st.cover; syncTools(); };
$('st-prev').ontimeupdate = (e) => { const pv = e.target; if (st.dur && !pv.paused && pv.currentTime >= st.t1) pv.currentTime = st.t0; };   // preview loops inside the trim
$('st-filters').onclick = (e) => { const b = e.target.closest('button[data-f]'); if (!b) return; st.filter = b.dataset.f; document.querySelectorAll('#st-filters button').forEach((x) => x.classList.toggle('on', x === b)); applyFxPreview(); };

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
  } catch { $('ai-reply').textContent = 'IA indisponible, réessayez.'; }
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderAI(items) {
  const box = $('ai-list'); box.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div'); row.className = 'ai-item';
    row.innerHTML = (it.track ? `<img src="${it.track.cover}" width="40" height="40" style="border-radius:8px">` : '') + `<div class="tx"><b>${esc(it.title)}</b>${esc(it.text)}</div>`;
    if (it.track) { const pb = playBtn(it.track); row.appendChild(pb); }
    const u = document.createElement('button'); u.className = 'use'; u.textContent = 'Utiliser';
    u.onclick = () => { applyItem(it); u.textContent = '✓ Utilisé'; u.classList.add('done'); };
    row.appendChild(u); box.appendChild(row);
  }
}
function applyItem(it) {
  if (it.track) return chooseMusic(it.track);
  const u = it.use || {};
  if (u.description) (it.type === 'comment' ? $('st-comment') : $('st-desc')).value = u.description;
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
  if (!SR) { $('ai-reply').textContent = 'Dictée vocale non prise en charge, écrivez votre demande.'; return; }
  const r = new SR(); r.lang = 'fr-FR'; r.interimResults = false;
  const mic = $('ai-mic'); mic.classList.add('rec');
  r.onresult = (e) => { const q = e.results[0][0].transcript; $('ai-q').value = q; sendQ(); };
  r.onerror = () => { $('ai-reply').textContent = 'Je ne vous ai pas entendu, réessayez.'; };
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
    const u = document.createElement('button'); u.className = 'use'; u.textContent = 'Utiliser'; u.onclick = () => chooseMusic(t);
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
  const title = $('st-title').value.trim();
  if (title.length < 2 || CAMERA.test(title)) { setProgress('❌ Donnez un vrai titre à votre clip (pas un nom de fichier)', 0); $('st-title').focus(); return; }
  busy = true; result.innerHTML = ''; $('st-pub').disabled = true; player.pause();
  try {
    setProgress('Vérification du stockage…', 0);
    const cfg = await fetch('/api/config?force=1').then((r) => r.json()).catch(() => { throw new Error('Serveur injoignable'); });
    if (!cfg.configured) throw new Error('R2 non configuré sur le serveur (variables R2_*)');
    if (!cfg.bucketOk) throw new Error(cfg.error || 'Bucket R2 inaccessible');
    const music = st.music;
    const fp = `${file.name}|${file.size}|${file.lastModified}`;
    setProgress('Envoi… 0%', 0);
    const key = await upload(file, fp);   // direct to R2 (presigned), never through this server
    originals.set(key, file);
    setProgress('Miniature…', 100);
    const poster = await uploadPoster(file, key);
    setProgress('Compression 720p + 360p…', 100);
    const rec = await api('/publish', {
      key, title, description: $('st-desc').value, comment: $('st-comment').value,
      musicId: music ? music.id : null, enhancement: { ...st.fx }, poster, filter: st.filter, privacy: $('st-priv').value,
      trim: st.dur && (st.t0 > 0.05 || st.t1 < st.dur - 0.05) ? { start: st.t0, end: st.t1 } : null,
    });
    setProgress('✅ Publié', 100);
    result.innerHTML = `<div>Publié ✅ ${esc(rec.title)} (${mb(file.size)} MB)${music ? ' | ♫ ' + esc(music.name) : ''}</div>`;
    const a = document.createElement('a');
    a.className = 'up-dl'; a.textContent = 'Télécharger l\u2019original'; a.href = URL.createObjectURL(file); a.download = file.name;
    result.appendChild(a);
    st.file = null; $('st-title').value = ''; $('st-desc').value = ''; $('st-comment').value = ''; $('st-2').hidden = true; $('st-1').hidden = false; $('up-title').textContent = 'Nouveau clip';
    showClip(rec);   // feed shows the new clip immediately
  } catch (err) {
    console.error(err);
    setProgress('❌ ' + err.message + ' — appuyez sur Publier pour réessayer', 0);
  } finally { busy = false; $('st-pub').disabled = false; }
};

/* ---------- poster: first good frame as a small jpg, uploaded next to the clip (failure is not fatal) ---------- */
async function uploadPoster(file, key) {
  try {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(file);
    await new Promise((ok, ko) => { v.onloadeddata = ok; v.onerror = ko; setTimeout(ko, 8000); });
    v.currentTime = st.cover ?? Math.min(0.5, (v.duration || 1) / 2);
    await new Promise((ok) => { v.onseeked = ok; setTimeout(ok, 2000); });
    const w = Math.min(720, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g2 = cv.getContext('2d'); if (st.filter && FCSS[st.filter]) g2.filter = FCSS[st.filter]; g2.drawImage(v, 0, 0, w, h);
    URL.revokeObjectURL(v.src);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.8));
    if (!blob) return false;
    const p = await api('/poster-url', { key });
    await putPart(p.url, blob, p.contentType, () => {}, p.cacheControl);
    return true;
  } catch (e) { console.warn('poster skipped:', e.message); return false; }
}

/* ---------- direct-to-R2 upload: presigned PUT (<=10 MB) or resumable multipart ---------- */
const api = async (path, body) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await (body ? fetch('/api' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }) : fetch('/api' + path, { signal: ctl.signal }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'API ' + r.status); e.status = r.status; throw e; }
    return j;
  } catch (e) { if (e.name === 'AbortError') throw new Error('Le serveur ne répond pas (timeout)'); throw e; }
  finally { clearTimeout(t); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const online = () => navigator.onLine ? Promise.resolve() : new Promise((r) => addEventListener('online', r, { once: true }));
const MAX_TRIES = 12;
const fatal = (e) => e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;

async function retry(fn, onFail) {
  for (let a = 1; ; a++) {
    try { await online(); return await fn(); }
    catch (e) {
      if (fatal(e) || a >= MAX_TRIES) throw e;
      onFail && onFail(e, a);
      await sleep(Math.min(8000, 700 * 2 ** (a - 1)));
    }
  }
}

async function upload(blob, fp) {
  const ext = extOf(blob), lsKey = 'upl3:' + fp, size = blob.size;
  let s = JSON.parse(localStorage.getItem(lsKey) || 'null');
  let done = new Set();
  if (s) {   // resume: R2 tells us which pieces it already has
    const r = await api(`/upload/parts?key=${encodeURIComponent(s.key)}&uploadId=${encodeURIComponent(s.uploadId)}`).catch(() => ({ gone: true }));
    if (r.complete) { localStorage.removeItem(lsKey); setProgress('✅ Envoi terminé 100%', 100); return s.key; }
    if (r.gone) s = null; else done = new Set(r.parts.map((p) => p.partNumber));
  }
  if (!s) {
    s = await retry(() => api('/upload-url', { size, ext, filename: blob.name }));
    localStorage.setItem(lsKey, JSON.stringify(s));
  }
  const flaky = (e, a) => { label.textContent = `Connexion instable (${e.message}), nouvel essai ${a}/${MAX_TRIES - 1}…`; };
  const total = s.totalParts, sent = new Array(total + 1).fill(0);
  const partLen = (n) => Math.min(s.partSize, size - (n - 1) * s.partSize);
  for (const n of done) sent[n] = partLen(n);
  const render = () => paint(sent.reduce((a, b) => a + b, 0), size);
  render();
  const queue = []; for (let n = 1; n <= total; n++) if (!done.has(n)) queue.push(n);
  let failed = null;
  const worker = async () => {
    for (let n; !failed && (n = queue.shift()) !== undefined;) {
      try {
        await retry(async () => {
          const { url } = await api('/upload/part-url', { key: s.key, uploadId: s.uploadId, partNumber: n });
          await putPart(url, blob.slice((n - 1) * s.partSize, (n - 1) * s.partSize + partLen(n)), null, (b) => { sent[n] = b; render(); });
          sent[n] = partLen(n); render();
        }, (e, a) => { sent[n] = 0; render(); flaky(e, a); });
      } catch (e) { failed = e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(THREADS, queue.length) }, worker));
  if (failed) throw failed;
  await retry(() => api('/upload-complete', { key: s.key, uploadId: s.uploadId, totalParts: total }));
  localStorage.removeItem(lsKey);
  setProgress('✅ Envoi terminé 100%', 100);
  return s.key;
}
const paint = (sentBytes, size) => { const p = Math.min(100, Math.floor((sentBytes / size) * 100)); setProgress(`Envoi… ${p}% (${mb(sentBytes)} / ${mb(size)} MB)`, p); };

/* ---------- archives: upload with the same uploader, the server unpacks to R2, every video is published ---------- */
async function importArchive(file) {
  if (busy) return;
  busy = true; result.innerHTML = '';
  try {
    const key = await upload(file, `${file.name}|${file.size}|${file.lastModified}`);
    setProgress('Décompression…', 100);
    const { id } = await retry(() => api('/extract', { key }));
    let job;
    for (;;) {
      await sleep(2000);
      job = await retry(() => api('/extract/' + id));
      if (job.step === 'error') throw new Error(job.error);
      if (job.step === 'done') break;
      setProgress({ queued: 'Décompression en attente…', download: 'Décompression : lecture…', extract: 'Décompression…', upload: `Décompression : ${job.done || 0}/${job.total || '?'} vidéos` }[job.step] || 'Décompression…', job.pct || 0);
    }
    let n = 0;
    for (const c of job.clips) {
      setProgress(`Publication ${++n}/${job.clips.length}…`, 100);
      const t = c.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      const title = t.length >= 2 && !CAMERA.test(t) ? t.slice(0, 120) : `Clip importé ${n}`;
      const rec = await api('/publish', { key: c.key, title, description: '', comment: '', musicId: null, enhancement: {}, poster: false, filter: '', privacy: 'public', trim: null });
      if (n === 1) showClip(rec);
    }
    setProgress(`✅ ${job.clips.length} vidéo(s) publiée(s)`, 100);
  } catch (err) { console.error(err); setProgress('❌ ' + err.message + ' — choisissez la même archive pour reprendre', 0); }
  finally { busy = false; }
}

function putPart(url, chunk, contentType, onBytes, cacheControl) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    let t; const stall = () => { clearTimeout(t); t = setTimeout(() => { x.abort(); reject(new Error('envoi bloqué')); }, 90000); };   // no bytes moving for 90 s -> retry this piece
    x.open('PUT', url);
    if (contentType) x.setRequestHeader('Content-Type', contentType);
    if (cacheControl) x.setRequestHeader('Cache-Control', cacheControl);
    x.upload.onprogress = (e) => { stall(); onBytes(e.loaded); };
    x.onload = () => { clearTimeout(t); x.status >= 200 && x.status < 300 ? resolve() : reject(new Error('R2 a répondu ' + x.status)); };
    x.onerror = () => { clearTimeout(t); reject(new Error('R2 injoignable (réseau ou CORS du bucket)')); };
    stall();
    x.send(chunk);
  });
}

// The feed (index.html) is the single source of what is displayed: a published clip is handed to it, never drawn here.
function showClip(c) {
  window.__arena.published(c);
}
