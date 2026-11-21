// Partager (clips + friend cards), Ajouter au Contact (vCard), Inviter (Contact Picker, user-initiated only).
const $ = (id) => document.getElementById(id);
const BASE = document.querySelector('meta[name=arena-base]').content;
const BRAND = document.querySelector('meta[name=arena-brand]').content;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sheet = $('sh-sheet');
let clip = { id: (location.pathname.match(/^\/c\/([\w.-]+)/) || [])[1] || 'demo', title: '' };
const clipTitle = () => (clip.title || document.querySelector('.desc').textContent || BRAND).split('\n')[0].trim();
document.addEventListener('clip', (e) => { clip = { ...clip, ...e.detail }; });

/* ---------- share payload ---------- */
const clipUrl = (c) => `${BASE}/c/${encodeURIComponent(c.id)}?utm_source=share&utm_campaign=${encodeURIComponent(BRAND)}&utm_content=${encodeURIComponent(c.title)}`;
const clipText = (c) => `${c.title} - عبر ${BRAND}`;
function toast(msg) { const t = $('sh-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const a = document.createElement('textarea'); a.value = text; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
  toast('تنسخ الرابط ✓');
}
const open = (u) => window.open(u, '_blank', 'noopener');
const enc = encodeURIComponent;
const PLATFORMS = [
  ['WhatsApp', (u, t) => `https://wa.me/?text=${enc(t + ' ' + u)}`],
  ['Facebook', (u) => `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}`],
  ['Instagram', null, 'https://www.instagram.com/'],
  ['TikTok', null, 'https://www.tiktok.com/'],
  ['X', (u, t) => `https://twitter.com/intent/tweet?text=${enc(t)}&url=${enc(u)}`],
  ['Telegram', (u, t) => `https://t.me/share/url?url=${enc(u)}&text=${enc(t)}`],
  ['Snapchat', (u) => `https://www.snapchat.com/scan?attachmentUrl=${enc(u)}`],
  ['LinkedIn', (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(u)}`],
  ['YouTube', null, 'https://www.youtube.com/'],
  ['Email', (u, t) => `mailto:?subject=${enc(t)}&body=${enc(t + '\n' + u)}`],
  ['Copier le lien'],
];
function openShare(c) {
  const url = clipUrl(c), text = clipText(c), native = !!navigator.share;
  sheet.innerHTML = `<div class="up-head"><span>Partager</span><button id="sh-x">✕</button></div>
    <div class="sh-sub">${esc(text)}<br>${esc(url)}</div>
    <div class="sh-grid">${native ? '<button data-p="native">Partager via…</button>' : ''}${PLATFORMS.map((p) => `<button data-p="${esc(p[0])}">${esc(p[0])}</button>`).join('')}</div>`;
  sheet.hidden = false;
  $('sh-x').onclick = () => { sheet.hidden = true; };
  sheet.querySelectorAll('[data-p]').forEach((b) => {
    b.onclick = async () => {
      const name = b.dataset.p;
      if (name === 'native') { try { await navigator.share({ title: c.title, text, url }); } catch { /* cancelled */ } return; }
      if (name === 'Copier le lien') return copy(url);
      const p = PLATFORMS.find((x) => x[0] === name);
      if (p[1]) return open(p[1](url, text));
      // Instagram / TikTok / YouTube have no web share link: native sheet if available, else copy + open the app site.
      if (native) { try { await navigator.share({ title: c.title, text, url }); } catch { /* cancelled */ } return; }
      await copy(url); toast(`تنسخ الرابط، لصقو فـ ${name}`); open(p[2]);
    };
  });
}
$('rail-share').onclick = () => openShare({ id: clip.id, title: clipTitle() });

/* ---------- Carnet d'Amis ---------- */
// Demo cards. tel / email are filled from the friend profile when known; vCard only includes what exists.
const FRIENDS = [
  { id: 'abdelmalik', name: 'El Qaisy Abdelmalik', domain: 'Musique', clip: 'petit poussin 🐥', tel: '', email: '' },
  { id: 'sara', name: 'Sara B.', domain: 'Cuisine', clip: 'Tajine express', tel: '', email: '' },
  { id: 'yassine', name: 'Yassine K.', domain: 'Sport', clip: 'But de la semaine', tel: '', email: '' },
  { id: 'imane', name: 'Imane R.', domain: 'Cinéma', clip: 'Plan séquence', tel: '', email: '' },
  { id: 'omar', name: 'Omar T.', domain: 'Éducation', clip: 'Maths en 60s', tel: '', email: '' },
];
const DOMAINS = ['Tous', 'Sport', 'Musique', 'Cuisine', 'Cinéma', 'Éducation'];
let dom = 'Tous';
function openCarnet() {
  sheet.innerHTML = `<div class="up-head"><span>Carnet d'Amis</span><button id="sh-x">✕</button></div>
    <div class="fr-chips">${DOMAINS.map((d) => `<button data-d="${d}" class="${d === dom ? 'on' : ''}">${d}</button>`).join('')}</div>
    ${FRIENDS.filter((f) => dom === 'Tous' || f.domain === dom).map((f) => `<div class="fr-card"><div class="fr-top"><div class="avatar">${esc(f.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</div><div><b>${esc(f.name)}</b><small>${esc(f.domain)} · ${esc(f.clip)}</small></div></div>
      <div class="fr-act"><button data-a="share" data-i="${f.id}">Partager</button><button data-a="vcard" data-i="${f.id}">Ajouter au Contact</button><button data-a="invite" data-i="${f.id}">Inviter</button></div></div>`).join('')}`;
  sheet.hidden = false;
  $('sh-x').onclick = () => { sheet.hidden = true; };
  sheet.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { dom = b.dataset.d; openCarnet(); }; });
  sheet.querySelectorAll('[data-a]').forEach((b) => {
    const f = FRIENDS.find((x) => x.id === b.dataset.i);
    b.onclick = () => ({ share: () => openShare({ id: 'u-' + f.id, title: `${f.name} - ${f.domain}` }), vcard: () => addContact(f), invite: () => invite(f) })[b.dataset.a]();
  });
}
$('open-carnet').onclick = openCarnet;

/* ---------- Ajouter au Contact: vCard saved by the user ---------- */
const vEsc = (t) => String(t).replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n');
function addContact(f) {
  const [first, ...rest] = f.name.split(' ');
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vEsc(f.name)}`, `N:${vEsc(rest.join(' '))};${vEsc(first)};;;`, `ORG:${vEsc(BRAND)}`,
    ...(f.tel ? [`TEL;TYPE=CELL:${vEsc(f.tel)}`] : []), ...(f.email ? [`EMAIL:${vEsc(f.email)}`] : []), `URL:${BASE}/u/${enc(f.id)}`, 'END:VCARD'];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/vcard' }));
  a.download = f.name.replace(/[^\w]+/g, '_') + '.vcf'; document.body.appendChild(a); a.click(); a.remove();
  toast('vCard prête - ouvrez-la pour l\'enregistrer');
}

/* ---------- Inviter: Contact Picker (asks the user's permission), user taps the channel ---------- */
async function invite(f) {
  let who = null;
  if ('contacts' in navigator && navigator.contacts.select) {
    try { const [c] = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: false }); if (!c) return; who = { name: (c.name || [])[0] || '', tel: (c.tel || [])[0] || '', email: (c.email || [])[0] || '' }; }
    catch { return; }   // refused or cancelled: nothing is read, nothing is sent
  }
  const text = `${who?.name ? who.name + ', ' : ''}rejoins-moi sur ${BRAND} : ${BASE}/?utm_source=invite`;
  const digits = (who?.tel || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  const ch = [
    ['WhatsApp', `https://wa.me/${digits}?text=${enc(text)}`],
    ['SMS', `sms:${who?.tel || ''}?&body=${enc(text)}`],
    ['Email', `mailto:${who?.email || ''}?subject=${enc(BRAND)}&body=${enc(text)}`],
  ];
  sheet.innerHTML = `<div class="up-head"><span>Inviter</span><button id="sh-x">✕</button></div>
    <div class="sh-sub">${who ? esc(who.name || who.tel || who.email) + ' - ' : ''}${esc(text)}<br>${who ? '' : 'Sélecteur de contacts non disponible sur cet appareil: choisissez le contact dans l\'application.'}</div>
    <div class="sh-grid">${ch.map((c) => `<button data-u="${esc(c[1])}">${c[0]}</button>`).join('')}</div>`;
  sheet.hidden = false;
  $('sh-x').onclick = () => { sheet.hidden = true; };
  sheet.querySelectorAll('[data-u]').forEach((b) => { b.onclick = () => { location.href = b.dataset.u; }; });
}
