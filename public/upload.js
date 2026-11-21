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

$('up-file').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file || busy) return;
  busy = true; result.innerHTML = '';
  $('up-pick').classList.add('dis');
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    if (!cfg.configured) throw new Error('R2 غير مهيأ في السيرفر (R2_* variables)');
    const fp = `${file.name}|${file.size}|${file.lastModified}|${mode}`;
    let blob = await idbGet(fp);
    if (blob) setProgress('تم الضغط من قبل، كنكمل الرفع…', 100);
    else {
      blob = await compress(file, MODES[mode]);
      await idbPut(fp, blob).catch(() => {});   // lets a retry skip re-compression
    }
    const key = await upload(blob, fp);          // compressed blob only, never `file`
    await idbDel(fp).catch(() => {});
    originals.set(key, file);
    const saved = Math.max(0, Math.round((1 - blob.size / file.size) * 100));
    result.innerHTML = `<div>قبل: ${mb(file.size)} MB -> من بعد: ${mb(blob.size)} MB | وفرتي ${saved}% ✅</div>`;
    const a = document.createElement('a');
    a.className = 'up-dl'; a.textContent = 'تحميل الأصلي'; a.href = URL.createObjectURL(file); a.download = file.name;
    result.appendChild(a);
    await loadLatestClip();
  } catch (err) {
    console.error(err);
    setProgress('❌ ' + err.message + ' — اختار نفس الفيديو باش يكمل', 0);
  } finally { busy = false; $('up-pick').classList.remove('dis'); }
};

/* ---------- compression ---------- */
async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  const f = new FFmpeg();
  await f.load({ coreURL: location.origin + '/vendor/core/ffmpeg-core.js', wasmURL: location.origin + '/vendor/core/ffmpeg-core.wasm' });
  return (ffmpeg = f);
}

async function compress(file, m) {
  setProgress('كيضغط... بودرة ⏳ 0%', 0);
  const f = await getFFmpeg();
  const onProgress = ({ progress }) => {
    const p = Math.max(0, Math.min(100, Math.round(progress * 100)));
    setProgress(`كيضغط... بودرة ⏳ ${p}%`, p);
  };
  f.on('progress', onProgress);
  try {
    // Never upscale: long side capped at m.long, short side at m.short, whichever way the video is turned.
    const vf = `scale='if(gte(iw,ih),min(${m.long},iw),min(${m.short},iw))':'if(gte(iw,ih),min(${m.short},ih),min(${m.long},ih))':force_original_aspect_ratio=decrease:force_divisible_by=2`;
    await f.createDir('/in').catch(() => {});
    await f.mount('WORKERFS', { files: [file] }, '/in');   // read the big file lazily, no 200 MB copy in RAM
    const code = await f.exec([
      '-i', `/in/${file.name}`, '-vf', vf, '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${m.vb}k`, '-maxrate', `${Math.round(m.vb * 1.2)}k`, '-bufsize', `${m.vb * 2}k`,
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', `${m.ab}k`, '-movflags', '+faststart', '-y', 'out.mp4',
    ]);
    if (code !== 0) throw new Error('فشل الضغط (ffmpeg ' + code + ')');
    const data = await f.readFile('out.mp4');
    await f.deleteFile('out.mp4').catch(() => {});
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
async function loadLatestClip() {
  try {
    const { clips } = await api('/clips');
    if (!clips.length) return;
    const v = $('vid'); v.src = clips[0].url; v.load();
    const img = document.querySelector('.video-wrap img'); if (img) img.style.display = 'none';
  } catch { /* R2 not configured yet: keep the placeholder */ }
}
loadLatestClip();
