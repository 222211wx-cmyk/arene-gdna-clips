// Upload the original file straight to R2
// with 20 parallel presigned multipart parts, resumable across reloads / network loss.

const THREADS = 6;
const MAX_MB = 200, EXTS = ['mp4', 'mov', 'webm'];
const extOf = (f) => { const e = (f.name.split('.').pop() || '').toLowerCase(); return EXTS.includes(e) ? e : f.type === 'video/quicktime' ? 'mov' : f.type === 'video/webm' ? 'webm' : f.type === 'video/mp4' ? 'mp4' : null; };
const titleOf = (f) => f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
const $ = (id) => document.getElementById(id);
const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);
const originals = new Map();   // clip key -> original File (this device, this session only)
let busy = false;

/* ---------- UI ---------- */
const sheet = $('up-sheet'), bar = $('up-bar'), label = $('up-label'), result = $('up-result');
$('up-open').onclick = () => { sheet.hidden = false; };
$('up-close').onclick = () => { if (!busy) sheet.hidden = true; };
const setProgress = (txt, pct) => { label.textContent = txt; bar.style.width = pct + '%'; };

/* ---------- Studio: 1 fichier -> 2 description (AI) -> 3 publier ---------- */
const st = { file: null, music: null, fx: { eclairage: 0, couleur: 0, cartoon: false }, ctx: {} };
const fxCss = () => st.fx.cartoon ? 'contrast(1.35) saturate(2) brightness(1.05)' : `brightness(${1 + st.fx.eclairage / 100}) saturate(${1 + st.fx.couleur / 100})`;
const applyFxPreview = () => { $('st-prev').style.filter = fxCss(); };

$('up-file').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file || busy) return;
  if (!extOf(file)) { setProgress('❌ Format non supporté: utilisez mp4, mov ou webm', 0); return; }
  if (file.size > MAX_MB * 1048576) { setProgress(`❌ Fichier trop gros (${mb(file.size)} MB, max ${MAX_MB} MB)`, 0); return; }
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
    setProgress('Vérification du stockage…', 0);
    const cfg = await fetch('/api/config?force=1').then((r) => r.json()).catch(() => { throw new Error('Serveur injoignable'); });
    if (!cfg.configured) throw new Error('R2 non configuré sur le serveur (variables R2_*)');
    if (!cfg.bucketOk) throw new Error(cfg.error || 'Bucket R2 inaccessible');
    const music = st.music;
    const fp = `${file.name}|${file.size}|${file.lastModified}`;
    setProgress('Envoi… 0%', 0);
    const key = await upload(file, fp);   // direct to R2 (presigned), never through this server
    originals.set(key, file);
    setProgress('Publication…', 100);
    const rec = await api('/publish', {
      key, title: titleOf(file), description: $('st-desc').value, comment: $('st-comment').value,
      musicId: music ? music.id : null, enhancement: { ...st.fx },
    });
    setProgress('✅ Publié', 100);
    result.innerHTML = `<div>Publié ✅ ${esc(rec.title)} (${mb(file.size)} MB)${music ? ' | ♫ ' + esc(music.name) : ''}</div>`;
    const a = document.createElement('a');
    a.className = 'up-dl'; a.textContent = 'Télécharger l\u2019original'; a.href = URL.createObjectURL(file); a.download = file.name;
    result.appendChild(a);
    showClip(rec);   // feed shows the new clip immediately
    st.file = null; $('st-comment').value = ''; $('st-2').hidden = true; $('st-1').hidden = false; $('up-title').textContent = 'Nouveau clip';
  } catch (err) {
    console.error(err);
    setProgress('❌ ' + err.message + ' — appuyez sur Publier pour réessayer', 0);
  } finally { busy = false; $('st-pub').disabled = false; }
};

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
const MAX_TRIES = 6;
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
  const ext = extOf(blob), lsKey = 'upl2:' + fp;
  let s = JSON.parse(localStorage.getItem(lsKey) || 'null');
  let done = new Set();
  if (s && s.mode === 'multipart') {
    const r = await api(`/upload/parts?key=${encodeURIComponent(s.key)}&uploadId=${encodeURIComponent(s.uploadId)}`).catch(() => ({ gone: true }));
    if (r.gone) s = null; else done = new Set(r.parts.map((p) => p.partNumber));
  } else s = null;   // single PUT: just restart
  if (!s) {
    s = await api('/upload-url', { size: blob.size, ext, filename: blob.name });
    if (s.mode === 'multipart') localStorage.setItem(lsKey, JSON.stringify(s));
  }
  const size = blob.size;
  const flaky = (e, a) => { label.textContent = `Connexion instable (${e.message}), nouvel essai ${a}/${MAX_TRIES - 1}…`; };

  if (s.mode === 'single') {
    await retry(() => putPart(s.url, blob, s.contentType, (b) => paint(b, size)), (e, a) => { flaky(e, a); bar.style.width = '0%'; });
    await api('/upload-complete', { key: s.key });
    setProgress('✅ Envoi terminé 100%', 100);
    return s.key;
  }

  const total = Math.max(1, Math.ceil(size / s.partSize));
  const sent = new Array(total + 1).fill(0);
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
  await api('/upload-complete', { key: s.key, uploadId: s.uploadId, totalParts: total });
  localStorage.removeItem(lsKey);
  setProgress('✅ Envoi terminé 100%', 100);
  return s.key;
}
const paint = (sentBytes, size) => { const p = Math.min(100, Math.floor((sentBytes / size) * 100)); setProgress(`Envoi… ${p}% (${mb(sentBytes)} / ${mb(size)} MB)`, p); };

function putPart(url, chunk, contentType, onBytes) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    if (contentType) x.setRequestHeader('Content-Type', contentType);
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error('R2 a répondu ' + x.status)));
    x.onerror = () => reject(new Error('R2 injoignable (réseau ou CORS du bucket)'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.timeout = 5 * 60000;
    x.send(chunk);
  });
}

function showClip(c) {
  const m = c;
  if (m.description || m.comment) document.querySelector('.desc').textContent = m.description || m.comment;
  if (m.music) document.querySelector('.music').textContent = `♫ ${m.music.name} - ${m.music.artist}`;
  announce(m.key, m);
  const v = $('vid'); v.src = c.url; v.style.filter = fxCss(); v.load(); v.play().catch(() => {});
  const img = document.querySelector('.video-wrap img'); if (img) img.style.display = 'none';
  document.querySelector('[data-go="clips"]')?.click();
}

/* ---------- Clips page shows the compressed clip from R2 ---------- */
const announce = (key, meta) => document.dispatchEvent(new CustomEvent('clip', { detail: { id: key.slice(6, key.lastIndexOf('.')), title: (meta?.description || '').split('\n')[0] } }));
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
