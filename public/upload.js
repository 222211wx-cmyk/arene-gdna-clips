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

/* ---------- Studio v2: preview + Réglages / Filtres / Couper / Audio / AI, fields on the right, one Publier button ---------- */
const FCSS = { '': '', vif: 'saturate(1.4) contrast(1.1)', chaud: 'sepia(.25) saturate(1.2)', froid: 'hue-rotate(12deg) saturate(1.05)', nb: 'grayscale(1) contrast(1.1)', vintage: 'sepia(.5) contrast(.95)', cinema: 'contrast(1.15) saturate(.9) sepia(.15)', doux: 'blur(.6px) brightness(1.04)' };
const ZERO_LOOK = () => ({ brightness: 0, contrast: 0, saturation: 0, temperature: 0 });
const BUS = { music: 70, voice: 100, fx: 50 };
const st = { filter: '', look: ZERO_LOOK(), t0: 0, t1: 0, dur: 0, cover: null, file: null, fx: { eclairage: 0, couleur: 0, cartoon: false }, ctx: {}, segs: [], ai: false, aiAsked: false,
  aud: { removeOriginal: false, origVol: 100, bus: { ...BUS }, tracks: [], mine: { music: [], song: [], voice: [], fx: [] }, cat: 'music', uid: 1 } };
const pv = $('st-prev');
const fxCss = () => st.fx.cartoon ? 'contrast(1.35) saturate(2) brightness(1.05)' : `brightness(${1 + st.fx.eclairage / 100}) saturate(${1 + st.fx.couleur / 100})`;
const lookCss = () => {
  const l = st.look, p = [];
  if (l.brightness) p.push(`brightness(${1 + l.brightness / 150})`);
  if (l.contrast) p.push(`contrast(${1 + l.contrast / 100})`);
  if (l.saturation) p.push(`saturate(${1 + l.saturation / 100})`);
  if (l.temperature > 0) p.push(`sepia(${l.temperature / 200}) saturate(${1 + l.temperature / 400})`);
  if (l.temperature < 0) p.push(`hue-rotate(${l.temperature * 0.2}deg)`);
  return p.join(' ');
};
const applyFxPreview = () => { pv.style.filter = [lookCss(), st.filter ? FCSS[st.filter] : fxCss()].filter(Boolean).join(' '); };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fold = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const note = (id, t) => { $(id).textContent = t || ''; };
const authFetch = async (url, opt) => {   // a 401 triggers one silent session refresh, never a login screen
  let r = await fetch(url, opt);
  if (r.status === 401 && window.__arena && window.__arena.refreshMe) { await window.__arena.refreshMe(); r = await fetch(url, opt); }
  return r;
};

/* tabs */
$('st-tabs').onclick = (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  document.querySelectorAll('#st-tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.st-pane').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  if (b.dataset.tab === 'audio') loadCatalog().then(renderAudList);
};

/* ---------- file chosen -> studio ---------- */
$('up-file').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file || busy) return;
  if (!extOf(file)) { const m = '❌ Format non supporté: vidéo mp4, mov, webm ou archive zip, 7z, rar, tar, gz\n(' + (file.name || '?') + ' | type: ' + (file.type || 'inconnu') + ')'; setProgress(m, 0); alert(m); return; }  // step 1 hides the progress label: alert so the rejection is never silent
  if (ARCH.includes(extOf(file))) return importArchive(file);
  resetStudio(file);
  pv.src = URL.createObjectURL(file);
  pv.onloadedmetadata = async () => {
    if (!isFinite(pv.duration)) await fixDuration();
    st.dur = pv.duration || 0; st.t0 = 0; st.t1 = st.dur; st.segs = [{ a: 0, b: st.dur, del: false }];
    for (const id of ['st-t0', 'st-t1', 'st-cv']) $(id).max = st.dur.toFixed(1);
    $('st-t0').value = 0; $('st-t1').value = st.dur.toFixed(1); syncTools(); renderCuts();
  };
  $('st-1').hidden = true; $('st-2').hidden = false; $('up-title').textContent = 'Description';
  applyIntent();
  st.ctx = await analyze(file).catch(() => ({}));
  if (st.ai && !st.aiAsked) { st.aiAsked = true; ask(''); }
};
// the ⚙️ SETTINGS menu can ask the studio to open on a given tab once a video is chosen: {tab, cat, rm, rec}
function applyIntent() {
  const it = window.__studioIntent; window.__studioIntent = null; if (!it || Date.now() - (it.ts || 0) > 120000) return;
  const tab = document.querySelector(`#st-tabs button[data-tab=${it.tab || 'adjust'}]`); if (tab) tab.click();
  if (it.cat) setTimeout(() => { const c = document.querySelector(`#au-cats button[data-cat=${it.cat}]`); if (c) c.click(); if (it.q) $('au-q').focus(); if (it.url) $('au-url').focus(); }, 60);
  if (it.rm) setTimeout(() => { if ($('au-rm').getAttribute('aria-pressed') !== 'true') $('au-rm').click(); }, 60);
}
// a MediaRecorder file reports an infinite duration until it has been read to the end once
function fixDuration() {
  return new Promise((ok) => { pv.currentTime = 1e7; const done = () => { pv.removeEventListener('timeupdate', done); pv.currentTime = 0; ok(); }; pv.addEventListener('timeupdate', done); setTimeout(ok, 3000); });
}
function resetStudio(file) {
  st.file = file; st.fx = { eclairage: 0, couleur: 0, cartoon: false }; st.look = ZERO_LOOK(); st.filter = ''; st.cover = null; st.dur = 0; st.segs = []; st.aiAsked = false;
  st.aud.removeOriginal = false; st.aud.origVol = 100; st.aud.bus = { ...BUS }; st.aud.tracks = []; syncLive();
  result.innerHTML = ''; setProgress('', 0);
  $('st-title').value = /^enregistrement-/.test(file.name) ? '' : guessTitle(file); $('st-tags').value = '';
  document.querySelectorAll('#st-filters button').forEach((b) => b.classList.toggle('on', !b.dataset.f));
  document.querySelectorAll('[data-lk]').forEach((i) => { i.value = 0; $(`lk-${i.dataset.lk}-v`).textContent = '0'; });
  document.querySelectorAll('[data-bus]').forEach((i) => { i.value = BUS[i.dataset.bus]; $(`bus-${i.dataset.bus}-v`).textContent = BUS[i.dataset.bus] + '%'; });
  $('au-ov').value = 100; $('au-ov-v').textContent = '100%';
  setRemove(false); renderMix(); renderCuts(); setAI(false); applyFxPreview();
  document.querySelector('#st-tabs button[data-tab=adjust]').click();
}

/* ---------- Réglage vidéo ---------- */
document.querySelectorAll('[data-lk]').forEach((i) => {
  i.oninput = () => { st.look[i.dataset.lk] = +i.value; $(`lk-${i.dataset.lk}-v`).textContent = i.value; applyFxPreview(); };
});
$('lk-reset').onclick = () => { st.look = ZERO_LOOK(); document.querySelectorAll('[data-lk]').forEach((i) => { i.value = 0; $(`lk-${i.dataset.lk}-v`).textContent = '0'; }); applyFxPreview(); };

/* ---------- Filtres (live preview) ---------- */
$('st-filters').onclick = (e) => { const b = e.target.closest('button[data-f]'); if (!b) return; st.filter = b.dataset.f; document.querySelectorAll('#st-filters button').forEach((x) => x.classList.toggle('on', x === b)); applyFxPreview(); };

/* ---------- Couper: début / fin, Diviser, Supprimer une partie ---------- */
function syncTools() {
  $('st-t0v').textContent = st.t0.toFixed(1); $('st-t1v').textContent = st.t1.toFixed(1);
  const c = Math.min(Math.max(st.cover ?? st.t0, st.t0), st.t1); $('st-cv').min = st.t0.toFixed(1); $('st-cv').max = st.t1.toFixed(1); $('st-cv').value = c; $('st-cvv').textContent = c.toFixed(1);
}
function fitSegs() {
  let s = st.segs.filter((g) => g.b > st.t0 + 0.05 && g.a < st.t1 - 0.05);
  if (!s.length) s = [{ a: st.t0, b: st.t1, del: false }];
  s[0].a = st.t0; s[s.length - 1].b = st.t1; st.segs = s; renderCuts();
}
$('st-t0').oninput = (e) => { st.t0 = Math.max(0, Math.min(+e.target.value, st.t1 - 1)); e.target.value = st.t0; pv.pause(); pv.currentTime = st.t0; syncTools(); fitSegs(); };
$('st-t1').oninput = (e) => { st.t1 = Math.min(st.dur, Math.max(+e.target.value, st.t0 + 1)); e.target.value = st.t1; pv.pause(); pv.currentTime = Math.max(st.t0, st.t1 - 0.1); syncTools(); fitSegs(); };
$('st-cv').oninput = (e) => { st.cover = +e.target.value; pv.pause(); pv.currentTime = st.cover; syncTools(); };
$('cut-split').onclick = () => {
  const t = pv.currentTime, i = st.segs.findIndex((g) => t > g.a + 0.3 && t < g.b - 0.3);
  if (i < 0) return note('au-msg', ''), toast('Placez la lecture au moins 0,3 s à l’intérieur d’une partie');
  const g = st.segs[i]; st.segs.splice(i, 1, { a: g.a, b: t, del: g.del }, { a: t, b: g.b, del: g.del }); renderCuts();
};
$('cut-reset').onclick = () => { st.segs = [{ a: st.t0, b: st.t1, del: false }]; renderCuts(); };
function renderCuts() {
  const box = $('cut-list');
  box.innerHTML = st.segs.length > 1 ? st.segs.map((g, i) => `<div class="it ${g.del ? 'off' : ''}"><div class="tx">Partie ${i + 1}<small>${g.a.toFixed(1)} – ${g.b.toFixed(1)} s</small></div><button class="sec" data-seek="${i}">Lire</button><button data-del="${i}">${g.del ? 'Restaurer' : 'Supprimer'}</button></div>`).join('') : '<div class="st-hint">Placez la lecture, touchez Diviser, puis supprimez la partie à retirer.</div>';
}
$('cut-list').onclick = (e) => {
  const s = e.target.closest('[data-seek]'), d = e.target.closest('[data-del]');
  if (s) { pv.currentTime = st.segs[+s.dataset.seek].a; pv.play().catch(() => {}); }
  if (d) {
    const g = st.segs[+d.dataset.del];
    if (!g.del && st.segs.filter((x) => !x.del).length < 2) return toast('Gardez au moins une partie');
    g.del = !g.del; renderCuts();
  }
};
pv.ontimeupdate = () => {
  if (!st.dur) return;
  const t = pv.currentTime; $('cut-at').textContent = t.toFixed(1);
  if (pv.paused) return;
  const d = st.segs.find((g) => g.del && t >= g.a && t < g.b - 0.02);
  if (d) { const keep = st.segs.find((g) => !g.del && g.a >= d.b - 0.01); pv.currentTime = keep ? keep.a : (st.segs.find((g) => !g.del) || { a: st.t0 }).a; return; }
  if (t >= st.t1) pv.currentTime = (st.segs.find((g) => !g.del) || { a: st.t0 }).a;
};

async function analyze(file) {
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = URL.createObjectURL(file);
  await new Promise((ok, ko) => { v.onloadeddata = ok; v.onerror = ko; setTimeout(ko, 8000); });
  const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 1, frames = []; let br = 0, sa = 0, n = 0;
  const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
  for (const t of [0.15, 0.5, 0.85]) {
    v.currentTime = d * t; await new Promise((r) => { v.onseeked = r; setTimeout(r, 2000); });
    const w = 320, h = Math.round(w * (v.videoHeight / v.videoWidth)) || 180; c.width = w; c.height = h; g.drawImage(v, 0, 0, w, h);
    frames.push(c.toDataURL('image/jpeg', 0.55));
    const px = g.getImageData(0, 0, w, h).data;
    for (let i = 0; i < px.length; i += 64) { const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]); br += (px[i] + px[i + 1] + px[i + 2]) / 765; sa += mx ? (mx - mn) / mx : 0; n++; }
  }
  URL.revokeObjectURL(v.src);
  return { frames, duration: Math.round(d), brightness: +(br / n).toFixed(2), saturation: +(sa / n).toFixed(2), orientation: v.videoWidth >= v.videoHeight ? 'landscape' : 'portrait', hint: file.name.replace(/\.[^.]+$/, '').slice(0, 80) };
}

/* ---------- Audio studio ---------- */
const busOf = (c) => (c === 'song' ? 'music' : c);
const catalog = { music: [], song: [], fx: [] };
let catalogLoaded = null;
function loadCatalog() {
  if (catalogLoaded) return catalogLoaded;
  catalogLoaded = Promise.all([fetch('/api/music').then((r) => r.json()), fetch('/api/sfx').then((r) => r.json())]).then(([m, f]) => {
    for (const t of m.tracks) catalog[t.kind === 'song' ? 'song' : 'music'].push({ ref: 'music:' + t.id, name: t.name, sub: `${t.artist} · ${t.mood}`, audio: t.audio, cat: 'music', hay: fold([t.name, t.artist, t.mood, ...t.tags].join(' ')) });
    for (const x of f.effects) catalog.fx.push({ ref: x.ref, name: x.name, sub: 'Effet sonore', audio: x.audio, cat: 'fx', hay: fold([x.name, ...x.tags].join(' ')) });
  }).catch(() => { catalogLoaded = null; note('au-msg', 'Catalogue indisponible, réessayez.'); });
  return catalogLoaded;
}
const player = new Audio(); let playingRef = null;
player.onended = () => { playingRef = null; renderAudList(); };
function renderAudList() {
  const cat = st.aud.cat, q = fold($('au-q').value.trim());
  const items = [...st.aud.mine[cat], ...(catalog[cat] || [])].filter((i) => !q || (i.hay || fold(i.name + ' ' + (i.sub || ''))).includes(q));
  $('au-list').innerHTML = items.length ? items.map((i) => `<div class="it"><button class="sec" data-pl="${esc(i.ref)}" aria-label="Écouter">${playingRef === i.ref ? '❚❚' : '▶'}</button><div class="tx">${esc(i.name)}<small>${esc(i.sub || '')}</small></div><button data-add="${esc(i.ref)}">Ajouter</button></div>`).join('')
    : `<div class="st-hint">${cat === 'voice' ? 'Aucun commentaire vocal pour le moment : enregistrez-en un, envoyez un fichier ou collez un lien.' : 'Aucun résultat.'}</div>`;
}
const findItem = (ref) => [...st.aud.mine.music, ...st.aud.mine.song, ...st.aud.mine.voice, ...st.aud.mine.fx, ...catalog.music, ...catalog.song, ...catalog.fx].find((i) => i.ref === ref);
$('au-list').onclick = (e) => {
  const p = e.target.closest('[data-pl]'), a = e.target.closest('[data-add]');
  if (p) { const i = findItem(p.dataset.pl); if (playingRef === i.ref) { player.pause(); playingRef = null; } else { pv.pause(); player.src = i.audio; player.play().catch(() => {}); playingRef = i.ref; } renderAudList(); }
  if (a) addTrack(findItem(a.dataset.add));
};
$('au-cats').onclick = (e) => {
  const b = e.target.closest('button[data-cat]'); if (!b) return;
  document.querySelectorAll('#au-cats button').forEach((x) => x.classList.toggle('on', x === b));
  st.aud.cat = b.dataset.cat; $('au-q').value = ''; $('au-rec').hidden = b.dataset.cat !== 'voice'; note('au-msg', ''); player.pause(); playingRef = null;
  loadCatalog().then(renderAudList);
};
$('au-q').oninput = renderAudList;
function addTrack(item, ai = false, offset) {
  if (!item) return;
  if (st.aud.tracks.length >= 12) return toast('12 pistes maximum');
  const cat = item.cat, off = offset ?? (cat === 'music' ? 0 : pv.currentTime || 0);
  st.aud.tracks.push({ uid: st.aud.uid++, ref: item.ref, name: item.name, cat, audio: item.audio, offset: +off.toFixed(2), ai });
  player.pause(); playingRef = null; renderAudList(); renderMix(); syncLive();
  if (cat !== 'music') toast('Ajouté à ' + off.toFixed(1) + ' s');
}
const CATNAME = { music: 'Musique', voice: 'Voix', fx: 'Effet' };
function renderMix() {
  $('au-mix').innerHTML = st.aud.tracks.length ? st.aud.tracks.map((t) => `<div class="it"><div class="tx">${esc(t.name)}<small>${CATNAME[t.cat]} · ${t.offset.toFixed(1)} s${t.ai ? ' · IA' : ''}</small></div><button class="sec" data-rm="${t.uid}" aria-label="Retirer">✕</button></div>`).join('')
    : '<div class="st-hint">Aucune piste ajoutée. Ajoutez une musique, une voix ou un effet.</div>';
}
$('au-mix').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; st.aud.tracks = st.aud.tracks.filter((t) => t.uid !== +b.dataset.rm); renderMix(); syncLive(); };
function setRemove(on) {
  st.aud.removeOriginal = on; $('au-rm').setAttribute('aria-pressed', String(on)); $('au-orig').hidden = on; pv.muted = on; pv.volume = st.aud.origVol / 100;
}
$('au-rm').onclick = () => { setRemove(!st.aud.removeOriginal); note('au-msg', st.aud.removeOriginal ? 'Le son original sera supprimé à 100 %. Ajoutez maintenant une musique, une voix ou un effet.' : ''); };
$('au-ov').oninput = (e) => { st.aud.origVol = +e.target.value; $('au-ov-v').textContent = e.target.value + '%'; pv.volume = st.aud.origVol / 100; };
document.querySelectorAll('[data-bus]').forEach((i) => { i.oninput = () => { st.aud.bus[i.dataset.bus] = +i.value; $(`bus-${i.dataset.bus}-v`).textContent = i.value + '%'; syncLive(); }; });
$('au-play').onclick = () => { if (pv.paused) { pv.currentTime = st.t0; pv.play().catch(() => {}); } else pv.pause(); };

// live mix preview: the tracks follow the video (play, pause, seek) at their own bus volume
const live = new Map();
function syncLive() {
  const now = pv.currentTime;
  for (const t of st.aud.tracks) {
    let a = live.get(t.uid); if (!a) { a = new Audio(t.audio); a.preload = 'auto'; live.set(t.uid, a); }
    a.loop = t.cat === 'music'; a.volume = Math.min(1, st.aud.bus[t.cat] / 100);
    if (!pv.paused && now >= t.offset) { if (a.paused) { try { a.currentTime = a.duration ? (now - t.offset) % a.duration : now - t.offset; } catch { /* not ready */ } a.play().catch(() => {}); } }
    else if (!a.paused) a.pause();
  }
  for (const [uid, a] of live) if (!st.aud.tracks.some((t) => t.uid === uid)) { a.pause(); live.delete(uid); }
}
pv.addEventListener('play', () => { player.pause(); playingRef = null; syncLive(); });
pv.addEventListener('pause', syncLive);
pv.addEventListener('seeking', () => live.forEach((a) => a.pause()));
pv.addEventListener('seeked', syncLive);
pv.addEventListener('timeupdate', syncLive);
setInterval(() => { if (sheet.hidden && !pv.paused) pv.pause(); }, 800);

// upload / paste / voice take -> server temp store -> a track of the project
async function addUserSound(promise, cat, offset) {
  note('au-msg', 'Ajout du son…');
  try {
    const r = await promise, j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Ajout impossible');
    const blob = await (await fetch(j.preview)).blob();
    const item = { ref: j.ref, name: j.name, sub: 'Mon son', audio: URL.createObjectURL(blob), cat: busOf(cat) };
    st.aud.mine[cat].unshift(item); note('au-msg', ''); addTrack(item, false, offset); return item;
  } catch (e) { note('au-msg', '❌ ' + e.message); }
}
$('au-file').onchange = (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.size > 30 * 1048576) return note('au-msg', '❌ Fichier trop lourd (30 Mo maximum)');
  addUserSound(authFetch('/api/audio/upload?name=' + encodeURIComponent(f.name.replace(/\.[^.]+$/, '')), { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f }), st.aud.cat);
};
async function pasteLink() {
  let u = $('au-url').value.trim();
  if (!u && navigator.clipboard && navigator.clipboard.readText) { try { u = (await navigator.clipboard.readText()).trim(); $('au-url').value = u; } catch { /* permission denied */ } }
  if (!u) return note('au-msg', 'Collez un lien MP3 / audio dans le champ.');
  const it = await addUserSound(authFetch('/api/audio/fetch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: u }) }), st.aud.cat);
  if (it) $('au-url').value = '';
}
$('au-paste').onclick = pasteLink;
$('au-url').onkeydown = (e) => { if (e.key === 'Enter') pasteLink(); };

// voice-over: the microphone records while the video plays silently from the current position
let vr = null;
$('au-rec').onclick = async () => {
  if (vr) return vr.stop();
  if (!navigator.mediaDevices || !window.MediaRecorder) return note('au-msg', 'Micro non disponible sur cet appareil : envoyez un fichier audio.');
  let ms; try { ms = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return note('au-msg', 'Autorisez le micro pour enregistrer une voix.'); }
  const mr = new MediaRecorder(ms), chunks = [], at = pv.currentTime, wasMuted = pv.muted; pv.muted = true;
  mr.ondataavailable = (e) => chunks.push(e.data);
  mr.onstop = () => {
    ms.getTracks().forEach((t) => t.stop()); pv.pause(); pv.muted = wasMuted; vr = null; $('au-rec').classList.remove('rec'); $('au-rec').textContent = 'Enregistrer un commentaire vocal';
    const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
    addUserSound(authFetch('/api/audio/upload?name=' + encodeURIComponent('Voix ' + (st.aud.mine.voice.length + 1)), { method: 'POST', headers: { 'content-type': blob.type }, body: blob }), 'voice', at);
  };
  vr = mr; mr.start(); $('au-rec').classList.add('rec'); $('au-rec').textContent = 'Arrêter l’enregistrement'; pv.play().catch(() => {});
};

/* ---------- AI / Robot: optional, OFF by default; real footage stays the default ---------- */
function setAI(on) {
  st.ai = on; $('ai-toggle').setAttribute('aria-checked', String(on)); $('ai-on').hidden = !on;
  note('ai-state', on ? 'Activé : vous pouvez mélanger réel et IA, et revenir au réel à tout moment.' : 'Désactivé : vous restez en mode réel.');
  if (on) { if (st.file && !st.aiAsked) { st.aiAsked = true; ask(''); } return; }
  st.fx = { eclairage: 0, couleur: 0, cartoon: false }; st.aud.tracks = st.aud.tracks.filter((t) => !t.ai); renderMix(); syncLive(); applyFxPreview();
  $('ai-list').innerHTML = ''; $('ai-reply').textContent = '';
}
$('ai-toggle').onclick = () => setAI(!st.ai);
async function ask(prompt) {
  $('ai-reply').textContent = '…';
  try {
    const r = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, context: { ...st.ctx, description: $('st-desc').value } }) });
    const j = await r.json(); $('ai-reply').textContent = j.reply; renderAI(j.items || []); return j;
  } catch { $('ai-reply').textContent = 'IA indisponible, réessayez.'; }
}
function renderAI(items) {
  const box = $('ai-list'); box.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div'); row.className = 'ai-item';
    row.innerHTML = (it.track ? `<img src="${it.track.cover}" width="40" height="40" style="border-radius:8px" alt="">` : '') + `<div class="tx"><b>${esc(it.title)}</b>${esc(it.text)}</div>`;
    const u = document.createElement('button'); u.className = 'use'; u.textContent = 'Utiliser';
    u.onclick = () => { applyItem(it); u.textContent = '✓ Utilisé'; u.classList.add('done'); };
    row.appendChild(u); box.appendChild(row);
  }
}
function applyItem(it) {
  if (it.track) return addTrack({ ref: 'music:' + it.track.id, name: it.track.name, sub: it.track.artist + ' · ' + it.track.mood, audio: it.track.audio, cat: 'music' }, true);
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
const SPEECH = { fr: 'fr-FR', en: 'en-US', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', tr: 'tr-TR', hi: 'hi-IN', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', ru: 'ru-RU', ar: 'ar-SA', ary: 'ar-MA' };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
$('ai-mic').onclick = () => {
  if (!SR) { $('ai-reply').textContent = 'Dictée vocale non prise en charge, écrivez votre demande.'; return; }
  const r = new SR(); r.lang = SPEECH[I18N.get()] || 'fr-FR'; r.interimResults = false;
  const mic = $('ai-mic'); mic.classList.add('rec');
  r.onresult = (e) => { $('ai-q').value = e.results[0][0].transcript; sendQ(); };
  r.onerror = () => { $('ai-reply').textContent = 'Je ne vous ai pas entendu, réessayez.'; };
  r.onend = () => mic.classList.remove('rec');
  r.start();
};
// AI voice comment: the script is written by the AI and read aloud by the phone for listening; it is not mixed into the file (that needs an external voice service)
$('ai-voice').onclick = async () => {
  const j = await ask('Écris un commentaire court pour cette vidéo'); const txt = j && ((j.items || []).find((i) => i.use && i.use.description) || {}).use;
  const say = (txt && txt.description) || (j && j.reply); if (!say) return;
  if (!$('st-comment').value) $('st-comment').value = say;
  if (window.speechSynthesis) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(say); u.lang = SPEECH[I18N.get()] || 'fr-FR'; speechSynthesis.speak(u); }
};

/* ---------- language list inside the studio (the globe next to Retour) ---------- */
function paintLangs() {
  $('up-langs').innerHTML = I18N.LANGS.map((l) => `<button data-notr data-lg="${l[0]}" class="${I18N.get() === l[0] ? 'on' : ''}">${l[1]}</button>`).join('');
}
$('up-lang').onclick = () => { const p = $('up-langs'); paintLangs(); p.hidden = !p.hidden; };
$('up-langs').onclick = (e) => { const b = e.target.closest('[data-lg]'); if (!b) return; I18N.set(b.dataset.lg); $('up-langs').hidden = true; };

/* ---------- Recording screen: video in the middle, timer on top, buttons at the bottom ---------- */
const R = { stream: null, mr: null, chunks: [], t0: 0, timer: null, facing: 'user', blob: null, mime: '' };
const rv = $('rec-v'), recEl = $('rec');
const fmtT = (ms) => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
function stopCam() { if (R.stream) R.stream.getTracks().forEach((t) => t.stop()); R.stream = null; rv.srcObject = null; }
async function startCam() {
  stopCam(); rv.removeAttribute('src'); rv.controls = false; rv.muted = true; $('rec-msg').textContent = '';
  try {
    R.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: R.facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
    rv.srcObject = R.stream; await rv.play();
  } catch { $('rec-msg').textContent = 'Caméra ou micro indisponible. Autorisez-les dans le navigateur, ou choisissez un fichier.'; }
}
function liveUi(on) { $('rec-live').hidden = !on; $('rec-review').hidden = on; $('rec-flip').hidden = !on; }
$('up-rec').onclick = () => {
  if (!navigator.mediaDevices || !window.MediaRecorder) return setProgress('❌ Enregistrement non disponible sur cet appareil : choisissez un fichier.', 0);
  recEl.hidden = false; recEl.classList.remove('live'); $('rec-t').textContent = '00:00'; liveUi(true); startCam();
};
function closeRec() { if (R.mr && R.mr.state !== 'inactive') { R.mr.onstop = null; R.mr.stop(); } R.mr = null; clearInterval(R.timer); stopCam(); rv.removeAttribute('src'); recEl.hidden = true; recEl.classList.remove('live'); }
$('rec-x').onclick = closeRec;
$('rec-flip').onclick = () => { if (R.mr) return; R.facing = R.facing === 'user' ? 'environment' : 'user'; startCam(); };
$('rec-go').onclick = () => {
  if (R.mr) { R.mr.stop(); return; }
  if (!R.stream) return startCam();
  R.chunks = []; R.mime = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  R.mr = new MediaRecorder(R.stream, R.mime ? { mimeType: R.mime } : undefined);
  R.mr.ondataavailable = (e) => { if (e.data.size) R.chunks.push(e.data); };
  R.mr.onstop = () => {
    clearInterval(R.timer); recEl.classList.remove('live'); R.blob = new Blob(R.chunks, { type: (R.mr && R.mr.mimeType) || R.mime || 'video/webm' }); R.mr = null; stopCam();
    rv.src = URL.createObjectURL(R.blob); rv.muted = false; rv.controls = true; rv.play().catch(() => {}); liveUi(false);
  };
  R.mr.start(1000); R.t0 = Date.now(); recEl.classList.add('live');
  R.timer = setInterval(() => { $('rec-t').textContent = fmtT(Date.now() - R.t0); }, 250);
};
$('rec-redo').onclick = () => { R.blob = null; $('rec-t').textContent = '00:00'; liveUi(true); startCam(); };
$('rec-use').onclick = () => {
  if (!R.blob) return;
  const ext = /mp4/.test(R.blob.type) ? 'mp4' : 'webm', f = new File([R.blob], `enregistrement-${Date.now()}.${ext}`, { type: R.blob.type });
  closeRec(); const dt = new DataTransfer(); dt.items.add(f); $('up-file').files = dt.files; $('up-file').dispatchEvent(new Event('change'));
};

/* ---------- Publier: compress (+ look, cuts, audio mix) -> upload -> record ---------- */
const hashtags = () => $('st-tags').value.split(/[\s,]+/).map((t) => t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean).map((t) => '#' + t).join(' ');
$('st-pub').onclick = async () => {
  const file = st.file;
  if (!file || busy) return;
  const title = $('st-title').value.trim();
  if (title.length < 2 || CAMERA.test(title)) { setProgress('❌ Donnez un vrai titre à votre clip (pas un nom de fichier)', 0); $('st-title').focus(); return; }
  if (st.segs.length && st.segs.every((g) => g.del)) { setProgress('❌ Toutes les parties sont supprimées', 0); return; }
  busy = true; result.innerHTML = ''; $('st-pub').disabled = true; player.pause(); pv.pause();
  try {
    setProgress('Vérification du stockage…', 0);
    const cfg = await fetch('/api/config?force=1').then((r) => r.json()).catch(() => { throw new Error('Serveur injoignable'); });
    if (!cfg.configured) throw new Error('R2 non configuré sur le serveur (variables R2_*)');
    if (!cfg.bucketOk) throw new Error(cfg.error || 'Bucket R2 inaccessible');
    const fp = `${file.name}|${file.size}|${file.lastModified}`;
    setProgress('Envoi… 0%', 0);
    const key = await upload(file, fp);   // direct to R2 (presigned), never through this server
    originals.set(key, file);
    setProgress('Miniature…', 100);
    const poster = await uploadPoster(file, key);
    setProgress('Compression 720p + 360p…', 100);
    const mus = st.aud.tracks.find((t) => t.ref.startsWith('music:'));
    const lk = Object.values(st.look).some(Boolean) ? { ...st.look } : null;
    const aud = st.aud.removeOriginal || st.aud.tracks.length || st.aud.origVol !== 100 ? { removeOriginal: st.aud.removeOriginal, originalVolume: st.aud.origVol, tracks: st.aud.tracks.map((t) => ({ ref: t.ref, cat: t.cat, volume: st.aud.bus[t.cat], offset: t.offset })) } : null;
    const rec = await publish({
      key, title, description: [$('st-desc').value.trim(), hashtags()].filter(Boolean).join('\n\n'), comment: $('st-comment').value,
      musicId: mus ? mus.ref.slice(6) : null, enhancement: { ...st.fx }, poster, filter: st.filter, privacy: $('st-priv').value,
      trim: st.dur && (st.t0 > 0.05 || st.t1 < st.dur - 0.05) ? { start: st.t0, end: st.t1 } : null,
      look: lk, cuts: st.segs.filter((g) => g.del).map((g) => [+g.a.toFixed(2), +g.b.toFixed(2)]), audio: aud,
    });
    setProgress('✅ Publié', 100);
    result.innerHTML = `<div>Publié ✅ ${esc(rec.title)} (${mb(file.size)} MB)${mus ? ' | ♫ ' + esc(mus.name) : ''}</div>`;
    st.file = null; $('st-title').value = ''; $('st-desc').value = ''; $('st-comment').value = ''; $('st-tags').value = ''; $('st-2').hidden = true; $('st-1').hidden = false; $('up-title').textContent = 'Nouveau clip';
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
    const go = () => (body ? fetch('/api' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }) : fetch('/api' + path, { signal: ctl.signal }));
    let r = await go();
    // an expired token is refreshed silently and the call is retried once: publishing never asks the user to log in again
    if (r.status === 401 && window.__arena && window.__arena.refreshMe) { await window.__arena.refreshMe(); r = await go(); }
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
      const rec = await publish({ key: c.key, title, description: '', comment: '', musicId: null, enhancement: {}, poster: false, filter: '', privacy: 'public', trim: null });
      if (n === 1) showClip(rec);
    }
    setProgress(`✅ ${job.clips.length} vidéo(s) publiée(s)`, 100);
  } catch (err) { console.error(err); setProgress('❌ ' + err.message + ' — choisissez la même archive pour reprendre', 0); }
  finally { busy = false; }
}

// Publish = compression on the server (minutes for a big file): start the job, then poll it. Never bound by a request timeout.
async function publish(body) {
  const { id } = await retry(() => api('/publish', body));
  for (;;) {
    await sleep(2000);
    const j = await retry(() => api('/publish/' + id));
    if (j.step === 'error') throw new Error(j.error);
    if (j.step === 'done') return j.clip;
  }
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
