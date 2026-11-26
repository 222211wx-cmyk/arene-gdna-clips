/* Arena Clips front end: one page, History-API router, every action stored through /api (Postgres). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var BASE = document.querySelector('meta[name=arena-base]').content.replace(/\/+$/, '');
  var v = $('vid'), poster = $('poster'), page = $('page'), modal = $('modal'), back = $('back');

  /* ================= state ================= */
  var me = null, unread = 0;
  var feedClips = [], seen = {}, feedNext = null, feedI = 0, busy = false;
  var L = feedClips, idx = 0, shownId = null, viewer = false, vlist = null;
  var soundOn = (function () { try { return sessionStorage.getItem('sound') !== '0'; } catch (e) { return true; } })(), loops = 0, userPaused = false, maxI = 0;

  /* ================= stay signed in: the session token is also kept on this device and sent with every /api call ================= */
  var TOK = 'sid';
  var tokGet = function () { try { return localStorage.getItem(TOK) || ''; } catch (e) { return ''; } };
  var tokSet = function (t) { try { if (t) localStorage.setItem(TOK, t); else localStorage.removeItem(TOK); } catch (e) { /* private mode */ } };
  (function () {
    var f = window.fetch;
    window.fetch = function (u, o) {
      var t = tokGet(), url = typeof u === 'string' ? u : (u && u.url) || '';
      if (t && /^(\/(?!\/)|https?:\/\/[^/]*)\/?api\//.test(url.replace(location.origin, ''))) { o = o || {}; o.headers = Object.assign({}, o.headers instanceof Headers ? Object.fromEntries(o.headers) : o.headers, { 'x-sid': t }); }
      return f.call(this, u, o);
    };
  })();

  // /arena-clips opens the same feed as / (direct link to Arena Clips)
  var PATHN = function () { return location.pathname.replace(/^\/arena-clips(?=\/|$)/i, '') || '/'; };
  // Entered through /arena-clips (any letter case)? Every in-app URL keeps that prefix, so tabs, refresh (F5) and shared links stay on the same entry link.
  var PFX = (/^\/arena-clips(?=\/|$)/i.exec(location.pathname) || [''])[0];
  var U = function (path) {
    if (!PFX || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(path) || path.slice(0, PFX.length).toLowerCase() === PFX.toLowerCase() && /^[/?#]|^$/.test(path.slice(PFX.length))) return path;
    return path === '/' ? PFX : PFX + (path.charAt(0) === '/' ? path : '/' + path);
  };
  var SITE = (document.querySelector('meta[name=arena-site]') || {}).content || 'https://gdnaarena.app/';

  /* ================= helpers ================= */
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var icons = function () { if (window.lucide) window.lucide.createIcons(); };
  function toast(m) { var t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600); }
  function api(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Une erreur est survenue'); e.auth = r.status === 401; e.field = j.field; throw e; } return j; }); });
  }
  function fail(e) { if (e && e.auth) needLogin(); else toast((e && e.message) || 'Une erreur est survenue'); }
  // Camera file names (VID_2025..., IMG_...) are never shown as a title.
  function cleanTitle(t) {
    return String(t || '').replace(/\b(?:VID|IMG|MOV|MVI|PXL|DSC|PIC|WA|Screenrecording|Screen[ _-]?Recording)[-_ ]*\d[\d_\s-]*/gi, ' ').replace(/\.(?:mp4|mov|webm)\b/gi, ' ')
      .replace(/\b\d{4}[-_.]\d{2}[-_.]\d{2}\b/g, ' ').replace(/\d{10,}/g, ' ').replace(/\s+/g, ' ').replace(/^[\s_.\-–—:,;]+|[\s_.\-–—:,;]+$/g, '');
  }
  var titleOf = function (c) { return cleanTitle(c.title); };
  var capOf = function (c) { return cleanTitle(c.description); };
  var label = function (c) { return titleOf(c) || capOf(c) || 'Clip de ' + ((c.author && c.author.name) || 'Arena Clips'); };
  var initials = function (n) { return String(n || 'AC').split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase() || 'AC'; };
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(function () { fb(t); });
    fb(t); return Promise.resolve();
  }
  function fb(t) { var a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } a.remove(); }
  function ago(d) { var s = (Date.now() - new Date(d)) / 1000; if (s < 60) return 'à l’instant'; if (s < 3600) return 'il y a ' + Math.floor(s / 60) + ' min'; if (s < 86400) return 'il y a ' + Math.floor(s / 3600) + ' h'; return 'il y a ' + Math.floor(s / 86400) + ' j'; }
  var btn = 'rounded-full bg-gold px-5 py-2.5 text-sm font-extrabold text-black disabled:opacity-40';
  var btn2 = 'rounded-full border border-neutral-600 bg-neutral-800 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40';
  var field = 'min-w-0 flex-1 rounded-full border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-white outline-none';
  var inp = 'w-full rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-3 text-[15px] text-white outline-none focus:border-amber-400';
  var safeNext = function (n) { return n && n[0] === '/' && n[1] !== '/' ? n : null; };

  /* ================= history: overlays, navigation, back ================= */
  var ov = null;                                   // the open overlay (modal or upload sheet), if any
  var depth = function () { return (history.state && history.state.i) || 0; };
  function dropOv() { var o = ov; ov = null; if (o) o.close(); }
  function openOverlay(closeFn) {
    if (ov) { dropOv(); history.replaceState({ i: depth(), ov: 1 }, '', location.href); }
    else history.pushState({ i: depth() + 1, ov: 1 }, '', location.href);
    ov = { close: closeFn }; updateBar();
  }
  function closeOverlay() { if (ov) history.back(); }
  function nav(path, o) {
    o = o || {}; path = U(path);
    if (ov) { dropOv(); history.replaceState({ i: depth() }, '', path); }
    else if (o.replace) history.replaceState({ i: depth() }, '', path);
    else if (path !== location.pathname + location.search) { history.pushState({ i: depth() + 1 }, '', path); maxI = depth(); }
    render();
  }
  function goBack() { if (ov) closeOverlay(); else if (depth() > 0) history.back(); else nav('/', { replace: true }); }
  window.addEventListener('popstate', function () { if (ov) { dropOv(); maxI = depth(); updateBar(); return; } render(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (ov) closeOverlay(); else if (PATHN() !== '/') goBack(); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || ov) return;
    if (PATHN() === '/' || viewer) { if (e.key === 'ArrowDown') go(1); if (e.key === 'ArrowUp') go(-1); }
  });

  /* modal (X on all of them) */
  var head = function (t) { return '<div class="mb-3 flex items-center justify-between"><h2 class="text-lg font-extrabold">' + t + '</h2><button data-x aria-label="Fermer" class="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800 text-lg">✕</button></div>'; };
  function hideModal() { modal.hidden = true; back.hidden = true; modal.innerHTML = ''; }
  function openModal(html) {
    openOverlay(hideModal);
    modal.innerHTML = html; modal.hidden = false; back.hidden = false; icons();
    var x = modal.querySelector('[data-x]'); if (x) x.onclick = closeOverlay;
  }
  back.onclick = closeOverlay;
  function needLogin(msg) {
    var next = encodeURIComponent(location.pathname + location.search);
    openModal(head('Connexion requise') + '<p class="mb-4 text-sm text-neutral-300">' + esc(msg || 'Connectez-vous pour continuer. Votre activité est enregistrée sur votre compte.') + '</p><div class="flex gap-2"><button id="nl-in" class="' + btn + ' flex-1">Se connecter</button><button id="nl-up" class="' + btn2 + ' flex-1">Créer un compte</button></div>');
    $('nl-in').onclick = function () { nav('/login?next=' + next); };
    $('nl-up').onclick = function () { nav('/signup?next=' + next); };
  }
  var guard = function (fn) { return function () { if (!me) return needLogin(); return fn.apply(this, arguments); }; };

  /* ================= session ================= */
  // choices saved on the account follow the user to a new device (language, main colour); this device's own choice wins
  function syncPrefs() {
    var p = (me && me.settings && me.settings.prefs) || {};
    try {
      if (p.accent && !localStorage.getItem('accent')) { localStorage.setItem('accent', p.accent); applyTheme(); }
      if (p.lang && !localStorage.getItem('lang') && window.I18N) I18N.set(p.lang);
    } catch (e) { /* private mode */ }
  }
  function refreshMe() {
    // only an explicit 401 means signed out: a network blip or a 5xx keeps the session (the user is never asked to log in again for that)
    return api('GET', '/api/me').then(function (r) { me = r.user; unread = r.unread || 0; badge(); paintEq(); syncPrefs(); }).catch(function (e) { if (e && e.auth) me = null; });
  }
  function badge() { var b = $('msg-badge'), n = me && me.settings.notifications ? unread : 0; b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }
  setInterval(function () { if (me && !document.hidden) refreshMe(); }, 30000);

  /* ================= feed data ================= */
  function addClips(list, top) {
    if (top) { list.forEach(function (c) { if (seen[c.id]) feedClips = feedClips.filter(function (x) { return x.id !== c.id; }); seen[c.id] = 1; }); feedClips = list.concat(feedClips); }
    else list.forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; feedClips.push(c); } });
    if (L !== vlist) L = feedClips;
  }
  function loadFeed() {
    return fetch('/api/clips?limit=10', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { clips: [] }; }).catch(function () { return { clips: [] }; }).then(function (d) {
      feedClips = []; seen = {}; if (!viewer) L = feedClips; addClips(d.clips || []); feedNext = d.next; feedI = 0; if (!viewer) idx = 0;
    });
  }
  function more() {
    if (busy || !feedNext) return; busy = true;
    fetch('/api/clips?limit=10&before=' + encodeURIComponent(feedNext), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { addClips(d.clips || []); feedNext = d.next; }).catch(function () { /* retry on next swipe */ }).then(function () { busy = false; });
  }
  function reloadFeed() { shownId = null; return loadFeed(); }
  var cur = function () { return L[idx]; };

  /* ================= video: muted autoplay, 3 loops per clip, then the next clip starts by itself ================= */
  /* Two real <video> elements trade places: `v` is on screen, `buf` already holds the NEXT clip, and a detached `warm`
     element fetches the one after it. Advancing swaps v and buf, so the next clip starts with no black frame. */
  var buf = v.cloneNode(false); buf.id = 'vid2'; buf.preload = 'auto'; buf.classList.add('invisible'); buf.removeAttribute('poster');
  v.parentNode.insertBefore(buf, v.nextSibling);
  var warm = document.createElement('video'); warm.preload = 'auto'; warm.muted = true; warm.setAttribute('playsinline', '');
  // 360p on a slow or data-saving connection (or after a stall), 720p otherwise; the choice sticks for the session
  function quality() { try { var q = localStorage.getItem('quality'); return q === 'saver' ? '480' : ['1080', '720', '480'].indexOf(q) >= 0 ? q : 'auto'; } catch (e) { return 'auto'; } }
  function lowNet() {
    var k = navigator.connection || {}, s = '', q = quality(); try { s = sessionStorage.getItem('rend') || ''; } catch (e) { /* private mode */ }
    if (q === '480') return true;      // 480p setting -> the 360p rendition
    if (q !== 'auto') return false;    // 1080p / 720p -> the best rendition we have (720p)
    if (s) return s === 'low';
    return !!(k.saveData || /(^|-)2g|3g/.test(k.effectiveType || '') || (k.downlink && k.downlink < 1.5));
  }
  function srcOf(c) { return lowNet() && c.url360 ? c.url360 : c.url; }
  // a quality change takes effect right away: same position, new rendition
  function requalify() {
    var c = cur(); if (!c) return; var s = srcOf(c);
    if (v.getAttribute('src') !== s) { var at = v.currentTime, was = !v.paused; v.src = s; v.addEventListener('loadedmetadata', function h() { v.removeEventListener('loadedmetadata', h); try { v.currentTime = at; } catch (e) { /* ignore */ } if (was) v.play().catch(function () { /* user taps */ }); }); v.load(); }
    prime();
  }
  var nextOf = function (i) { return L.length > 1 ? (i + 1) % L.length : -1; };
  function aim(el, c) {
    if (!c) { if (el.getAttribute('src')) { el.removeAttribute('src'); el.load(); } delete el.dataset.id; return; }
    var s = srcOf(c);
    if (el.dataset.id !== c.id || el.getAttribute('src') !== s) { el.dataset.id = c.id; el.src = s; el.load(); }
  }
  function prime() { var n = nextOf(idx), m = n < 0 ? -1 : nextOf(n); aim(buf, n < 0 ? null : L[n]); aim(warm, m < 0 || m === idx ? null : L[m]); }
  var stalls = [];
  function onWaiting() {
    if (this !== v) return;
    var c = cur(), t = Date.now(); if (quality() !== 'auto' || !c || !c.url360 || v.src === c.url360 || v.currentTime < 0.3) return;
    stalls = stalls.filter(function (x) { return t - x < 10000; }); stalls.push(t);
    if (stalls.length >= 2) { stalls = []; try { sessionStorage.setItem('rend', 'low'); } catch (e) { /* ignore */ } var at = v.currentTime; v.src = c.url360; v.addEventListener('loadedmetadata', function h() { v.removeEventListener('loadedmetadata', h); try { v.currentTime = at; } catch (e) { /* ignore */ } if (!userPaused) tryPlay(); }); v.load(); }
  }
  // only the visible tab/route plays, and never over a clip the user paused
  function feedVisible() { return !document.hidden && page.hidden && !!shownId; }
  function canRun() { return feedVisible() && !userPaused && $('replay').hidden; }
  document.addEventListener('visibilitychange', function () { if (document.hidden) v.pause(); else if (canRun()) tryPlay(); });
  function resetLoops() { loops = 0; $('replay').hidden = true; }
  function tryPlay() { var p = v.play(); if (p && p.catch) p.catch(function () { if (!v.muted) { v.muted = true; v.play().catch(function () { /* user taps to start */ }); } }); }   // browser blocked sound-on autoplay: play silently, icon stays open, first touch unmutes
  // loopCount: every `ended` is one finished play; after the 3rd one the chain moves to the next clip
  var lastHist = null;
  var FILTERS = { '': ['Aucun', ''], bw: ['Noir et blanc', 'grayscale(1)'], sepia: ['Sépia', 'sepia(.8)'], warm: ['Chaud', 'saturate(1.4) hue-rotate(-10deg)'], cool: ['Froid', 'hue-rotate(20deg) saturate(1.1)'], contrast: ['Contraste', 'contrast(1.3)'], soft: ['Doux', 'blur(1px) brightness(1.05)'] };
  var rate = (function () { try { return parseFloat(sessionStorage.getItem('rate')) || 1; } catch (e) { return 1; } })();
  function applyRate() { [v, buf, $('pc-v')].forEach(function (el) { try { el.playbackRate = rate; } catch (e) { /* ignore */ } }); }
  function rememberClip(c) {
    try { var h = JSON.parse(localStorage.getItem('hist') || '[]').filter(function (x) { return x.id !== c.id; }); h.unshift({ id: c.id, t: titleOf(c) || 'Clip' }); localStorage.setItem('hist', JSON.stringify(h.slice(0, 30))); } catch (e) { /* ignore */ }
  }
  function startAt() { var c = cur(); return (c && c.trimStart) || 0; }
  // Couper is non-destructive: playback stays inside [trimStart, trimEnd]
  function onTrim() { if (this !== v || !shownId) return; var c = cur(); if (c && c.trimEnd && this.currentTime >= c.trimEnd) onEnded.call(this); }
  function onEnded() {
    if (this !== v || !shownId) return;
    if (ov) { v.currentTime = startAt(); tryPlay(); return; }          // a sheet is open over this clip: keep it here
    loops++;
    if (loops < 3) { v.currentTime = startAt(); tryPlay(); return; }
    if (L.length > 1) jumpTo((idx + 1) % L.length, 1); else $('replay').hidden = false;
  }
  function onTap() {
    if (this !== v) return;
    if (!$('replay').hidden) { $('replay').click(); return; }
    if (v.muted && !v.paused) { soundOn = true; v.muted = false; paintSound(); return; }   // first tap: sound on
    if (v.paused) { userPaused = false; tryPlay(); } else { userPaused = true; v.pause(); }
  }
  [v, buf].forEach(function (el) { el.addEventListener('waiting', onWaiting); el.addEventListener('ended', onEnded); el.addEventListener('timeupdate', onTrim); el.addEventListener('playing', applyRate); el.addEventListener('click', onTap); });
  // IntersectionObserver: the clip plays only while at least half of it is on screen
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      if (en.target !== v || !v.getAttribute('src')) return;
      if (en.isIntersecting && en.intersectionRatio >= 0.5) { if (canRun()) tryPlay(); } else v.pause();
    });
  }, { threshold: [0, 0.5, 1] }) : null;
  if (io) io.observe(v);
  $('replay').onclick = function () { resetLoops(); userPaused = false; v.currentTime = 0; tryPlay(); };
  function paintSound() { $('r-snd').querySelector('i,svg').outerHTML = '<i data-lucide="' + (soundOn ? 'volume-2' : 'volume-x') + '" class="h-5 w-5"></i>'; icons(); }
  // volume button: one tap = sound on (open), next tap = mute; the choice is kept until the user changes it
  var vol = 1;
  function applyVol() { [v, buf, $('pc-v')].forEach(function (el) { try { el.volume = 1; } catch (e) { /* iOS: read-only */ } }); }
  function setSound(on) { soundOn = on; try { sessionStorage.setItem('sound', on ? '1' : '0'); } catch (e) { /* ignore */ } v.muted = !on; buf.muted = !on; applyVol(); paintSound(); if (on) tryPlay(); }
  // open on load: only the user's tap on the button closes it; a blocked autoplay is un-muted by the first touch anywhere
  function unlockSound(e) { if (soundOn && v.muted && !(e.target.closest && e.target.closest('#r-snd'))) { v.muted = false; buf.muted = false; applyVol(); } }
  document.addEventListener('pointerdown', unlockSound, true);
  $('r-snd').onclick = function () { if (soundOn && v.muted) { v.muted = false; applyVol(); toast('Son activé'); return; } setSound(!soundOn); toast(soundOn ? 'Son activé' : 'Son coupé'); };
  applyVol(); paintSound();

  function show(dir) {
    var c = cur(); if (!c) { v.removeAttribute('src'); v.load(); poster.classList.add('hidden'); shownId = null; $('views-n').textContent = '0'; return paint(); }
    if (shownId === c.id && v.getAttribute('src')) { if (!userPaused) tryPlay(); paint(); updateBar(); return; }
    shownId = c.id; resetLoops(); userPaused = false;
    if (buf.dataset.id === c.id && buf.readyState >= 2 && L.length > 1) {   // the next clip is already buffered: swap, no black frame
      var old = v; v = buf; buf = old;
      if (io) { io.unobserve(buf); io.observe(v); }
      v.classList.remove('invisible'); buf.classList.add('invisible'); buf.pause();
      v.muted = !soundOn; try { v.currentTime = startAt(); } catch (e) { /* ignore */ }
      poster.classList.add('hidden');
    } else {
      if (c.poster) { poster.src = c.poster; poster.classList.remove('hidden'); v.poster = c.poster; } else { poster.classList.add('hidden'); v.removeAttribute('poster'); }
      v.muted = !soundOn; v.dataset.id = c.id; v.src = srcOf(c); v.load(); if (c.trimStart) v.addEventListener('loadedmetadata', function h() { v.removeEventListener('loadedmetadata', h); try { v.currentTime = c.trimStart; } catch (e) { /* ignore */ } });
      v.addEventListener('playing', function h() { v.removeEventListener('playing', h); poster.classList.add('hidden'); });
    }
    tryPlay();
    prime();
    if (L === feedClips && idx >= L.length - 3) more();
    applyVol(); zoomReset(); countView(c);
    paint(); updateBar();
    if (dir) { v.classList.remove('slide-up', 'slide-down'); void v.offsetWidth; v.classList.add(dir > 0 ? 'slide-up' : 'slide-down'); }
  }
  window.paint = function () { paint(); };
  function paint() {
    var c = cur(), empty = $('empty');
    if (!c) { empty.classList.remove('hidden'); empty.classList.add('flex'); return; }
    empty.classList.add('hidden'); empty.classList.remove('flex');
    var name = (c.author && c.author.name) || 'Arena Clips', mine = me && c.author && me.handle === c.author.handle;
    paintEq();
    $('c-title').textContent = titleOf(c); $('caption').textContent = capOf(c);
    var vw = c.viewer || {};
    $('r-like').classList.toggle('on', !!vw.liked); $('r-like').querySelector('[data-n]').textContent = c.likes || 0;
    $('r-save').classList.toggle('saved', !!vw.saved); $('r-save').querySelector('[data-n]').textContent = c.saves || 0;
    $('l-fav').classList.toggle('fav', !!vw.favorited); $('l-fav').setAttribute('aria-pressed', String(!!vw.favorited));
    $('r-comment').querySelector('[data-n]').textContent = c.comments || 0;
    $('r-share').querySelector('[data-n]').textContent = c.shares || 0;
    var f = $('follow'); f.hidden = !!mine; f.textContent = vw.following ? 'Abonné ✓' : vw.requested ? 'Demandé' : 'Suivre'; f.classList.toggle('bg-white', !!vw.following); f.classList.toggle('text-black', !!vw.following);
    $('views-n').textContent = fmtN(c.views || 0); $('acc-ov').textContent = (c.accessories || []).join(' ');
    $('txt-ov').textContent = c.overlayText || ''; var wm = $('wm-ov'); wm.hidden = !c.watermark; wm.textContent = '@' + ((c.author && c.author.handle) || '') + ' · Arena Clips';
    v.style.filter = ((FILTERS[c.filter || ''] || FILTERS[''])[1] + (isLight ? ' invert(1) hue-rotate(180deg)' : '')).trim(); buf.style.filter = '';
    if (c.id !== lastHist) { lastHist = c.id; rememberClip(c); }
    $('t-msg').disabled = !!mine; $('t-msg').classList.toggle('opacity-40', !!mine);
  }
  var fmtN = function (n) { return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' M' : n >= 1e4 ? Math.round(n / 1e3) + ' k' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + ' k' : String(n); };
  // one view per clip per browser session, counted in the database (the owner's own views are not counted by the server)
  var counted = {};
  function countView(c) {
    if (!c || counted[c.id]) return; counted[c.id] = 1;
    api('POST', '/api/clips/' + encodeURIComponent(c.id) + '/view').then(function (r) { c.views = r.views; if (cur() === c) $('views-n').textContent = fmtN(c.views); }).catch(function () { delete counted[c.id]; });
  }
  function jumpTo(n, dir) { idx = n; if (L === feedClips) feedI = n; show(dir); }
  function go(d) { var n = idx + d; if (n < 0 || n >= L.length) return; jumpTo(n, d); }

  /* ================= fixed top bar: < Home Arena Clips > X ================= */
  var canClip = function (d) { var n = idx + d; return !ov && page.hidden && !!shownId && n >= 0 && n < L.length; };
  var canHist = function (d) { return d < 0 ? depth() > 0 : depth() < maxI; };
  function dis(b, off) { b.setAttribute('aria-disabled', off ? 'true' : 'false'); b.style.opacity = off ? '.35' : ''; }
  function updateBar() {
    dis($('b-prev'), !(ov || canClip(-1) || canHist(-1)));
    dis($('b-next'), !(!ov && (canClip(1) || canHist(1))));
    dis($('b-x'), !ov && PATHN() === '/');
  }
  // on the feed or the viewer the arrows step through clips; on other pages (and at the ends) they walk the history
  function prevNext(d) {
    if (ov) { if (d < 0) closeOverlay(); return; }
    if (canClip(d)) go(d); else if (canHist(d)) history.go(d);
  }
  $('b-prev').onclick = function () { prevNext(-1); };
  $('b-next').onclick = function () { prevNext(1); };
  // X closes the open sheet, else the clip viewer, else leaves the page for the feed; it never closes the site
  $('b-x').onclick = function () { if (ov) closeOverlay(); else if (viewer) goBack(); else if (PATHN() !== '/') nav('/'); };

  // swipe right = previous, swipe left = next (anywhere except inputs and horizontally scrolling rows)
  var sx = null, sy = 0;
  function hScroll(el) { for (; el && el !== document.body; el = el.parentElement) { if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true; } return false; }
  document.addEventListener('touchstart', function (e) {
    sx = null; if (zoomK > 1 || e.touches.length !== 1 || e.target.closest('input,textarea,select,#hdr') || hScroll(e.target)) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (sx === null) return; var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) prevNext(dx > 0 ? -1 : 1);
  });

  /* keyboard: the visible area shrinks to what the keyboard leaves, the bar follows it, the focused field scrolls into view */
  var vv = window.visualViewport;
  function fit() { if (!vv) return; $('phone').style.setProperty('--vh', vv.height + 'px'); $('hdr').style.transform = 'translateY(' + vv.offsetTop + 'px)'; }
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit(); }
  // never block focus or touch on inputs: the browser opens the keyboard itself. After it opens, bring the field to the middle and keep the bar visible.
  document.addEventListener('focusin', function (e) {
    var t = e.target; if (!/INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
    var again = function () { if (document.activeElement !== t) return; try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) { /* ignore */ } $('phone').scrollTop = 0; fit(); };
    setTimeout(again, 120); setTimeout(again, 450);
  });
  if (vv) vv.addEventListener('resize', function () { var t = document.activeElement; if (t && /INPUT|TEXTAREA/.test(t.tagName)) { try { t.scrollIntoView({ block: 'center' }); } catch (x) { /* ignore */ } $('phone').scrollTop = 0; } });

  /* gestures: feed = swipe up/down for next/previous; fullscreen viewer = swipe down closes */
  var y0 = null, x0 = 0, ph = $('phone');
  ph.addEventListener('touchstart', function (e) { if (zoomK > 1 || e.target.closest('button,a,input,textarea,select,main,.up-sheet,#modal,header,nav')) return; y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; }, { passive: true });
  ph.addEventListener('touchend', function (e) {
    if (y0 === null) return; var dy = e.changedTouches[0].clientY - y0, dx = e.changedTouches[0].clientX - x0; y0 = null;
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) { if (viewer && dy > 0) goBack(); else go(dy < 0 ? 1 : -1); }
  });
  var lock = 0;
  ph.addEventListener('wheel', function (e) { if (ov || zoomK > 1 || !page.hidden || e.target.closest('#modal,.up-sheet')) return; var t = Date.now(); if (t - lock < 600 || Math.abs(e.deltaY) < 20) return; lock = t; if (viewer && e.deltaY < 0) goBack(); else go(e.deltaY > 0 ? 1 : -1); }, { passive: true });

  /* ================= rail: like / comment / share / save / follow ================= */
  function toggle(kind) {
    var c = cur(); if (!c) return;
    var key = kind === 'like' ? 'liked' : 'saved', cnt = kind === 'like' ? 'likes' : 'saves', vw = c.viewer || (c.viewer = {});
    var was = !!vw[key], wasN = c[cnt] || 0, on = !was;
    vw[key] = on; c[cnt] = Math.max(0, wasN + (on ? 1 : -1)); paint();
    api('PUT', '/api/clips/' + encodeURIComponent(c.id) + '/' + kind, { on: on }).then(function (r) { c[cnt] = r.count; if (cur() === c) paint(); })
      .catch(function (e) { vw[key] = was; c[cnt] = wasN; if (cur() === c) paint(); fail(e); });
  }
  $('r-like').onclick = function () { toggle('like'); };
  $('r-save').onclick = function () { toggle('save'); };
  function setFollowEverywhere(handle, on, status) { feedClips.concat(vlist || []).forEach(function (x) { if (x.author.handle === handle) { var w = x.viewer || (x.viewer = {}); w.following = on && status !== 'pending'; w.requested = on && status === 'pending'; } }); }
  $('follow').onclick = guard(function () {
    var c = cur(); if (!c) return; var w = c.viewer || {}, on = !(w.following || w.requested), h = c.author.handle;
    setFollowEverywhere(h, on); paint();
    api('PUT', '/api/clips/' + encodeURIComponent(c.id) + '/follow', { on: on }).then(function (r) { setFollowEverywhere(h, on, r.status); if (r.status === 'pending') toast('Demande de suivi envoyée'); paint(); }).catch(function (e) { setFollowEverywhere(h, !on); paint(); fail(e); });
  });

  /* ================= left rail: EQ avatar, Settings, Title/Caption, Favorite ================= */
  // ONE profile button (ProfileButton): the clip author's avatar, same row as the 👁️ counter; tap opens that profile
  function paintEq() {
    var b = $('l-eq-t'); if (!b) return;
    var c = cur(), u = c && c.author ? c.author : me;
    if (!u) { b.innerHTML = '<i data-lucide="user-round" class="h-5 w-5"></i>'; $('l-eq-n').textContent = ''; $('l-eq-h').textContent = ''; icons(); return; }
    var nm = u.name || u.handle || 'Arena Clips';
    b.innerHTML = u.avatar ? '<img src="' + esc(u.avatar) + '" alt="" class="h-full w-full object-cover">' : esc(initials(nm));
    $('l-eq-n').textContent = nm; $('l-eq-h').textContent = u.handle ? '@' + u.handle : '';
  }
  $('l-eq').onclick = function () { var c = cur(); if (c && c.author && c.author.handle && !(me && me.handle === c.author.handle)) nav('/u/' + encodeURIComponent(c.author.handle)); else nav('/profile'); };
  $('l-cap').onclick = function () {
    var c = cur(); if (!c) return;
    var t = titleOf(c), d = capOf(c), cm = cleanTitle(c.comment);
    openModal(head('Titre et légende') + '<div class="text-sm">' + (t ? '<div class="mb-2 text-lg font-extrabold">' + esc(t) + '</div>' : '') + (d ? '<p class="mb-2 whitespace-pre-wrap break-words text-neutral-200">' + esc(d) + '</p>' : '') + (cm ? '<p class="mb-2 whitespace-pre-wrap break-words text-neutral-400">' + esc(cm) + '</p>' : '') +
      (!t && !d && !cm ? '<p class="text-neutral-400">Ce clip n’a ni titre ni légende.</p>' : '') + (c.tags && c.tags.length ? '<div class="mt-2 flex flex-wrap gap-2">' + c.tags.map(function (g) { return '<span class="rounded-full bg-neutral-800 px-3 py-1 text-xs text-amber-400">#' + esc(g) + '</span>'; }).join('') + '</div>' : '') +
      (c.music ? '<div class="mt-3 text-xs text-neutral-400">♫ ' + esc(c.music.name) + (c.music.artist ? ' · ' + esc(c.music.artist) : '') + '</div>' : '') + '</div>');
  };
  $('l-fav').onclick = guard(function () {
    var c = cur(); if (!c) return; var vw = c.viewer || (c.viewer = {}), was = !!vw.favorited;
    vw.favorited = !was; paint(); toast(was ? 'Retiré des favoris' : 'Ajouté aux favoris');
    api('PUT', '/api/clips/' + encodeURIComponent(c.id) + '/favorite', { on: !was }).catch(function (e) { vw.favorited = was; if (cur() === c) paint(); fail(e); });
  });

  /* share sheet: copy / native share / WhatsApp, each recorded in the database */
  $('r-share').onclick = function () {
    var c = cur(); if (!c) return; var url = location.origin + '/c/' + encodeURIComponent(c.id), text = label(c);
    openModal(head('Partager') + '<div class="mb-3 truncate rounded-xl bg-neutral-800 px-3 py-2.5 text-sm text-neutral-300" id="sh-url">' + esc(url) + '</div><div class="flex flex-col gap-2">' +
      '<button id="sh-copy" class="' + btn + '">Copier le lien</button>' +
      (navigator.canShare ? '<button id="sh-file" class="' + btn + '">Envoyer la vidéo</button>' : '') + (navigator.share ? '<button id="sh-native" class="' + btn2 + '">Envoyer le lien…</button>' : '<a id="sh-sms" href="sms:?&body=' + encodeURIComponent(text + ' ' + url) + '" class="' + btn2 + ' text-center">Envoyer par SMS</a>') +
      '<a id="sh-wa" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(text + ' ' + url) + '" class="' + btn2 + ' text-center">WhatsApp</a></div>');
    function rec(channel) { return api('POST', '/api/clips/' + encodeURIComponent(c.id) + '/share', { channel: channel }).then(function (r) { c.shares = r.count; if (cur() === c) paint(); }).catch(function () { /* count refreshes on next load */ }); }
    $('sh-copy').onclick = function () { copyText(url).then(function () { $('sh-copy').textContent = 'Lien copié ✓'; rec('link'); }); };
    if ($('sh-native')) $('sh-native').onclick = function () { navigator.share({ title: text, url: url }).then(function () { rec('native'); }).catch(function () { /* cancelled */ }); };
    if ($('sh-file')) $('sh-file').onclick = function () {
      var b = $('sh-file'); b.textContent = 'Préparation de la vidéo…'; b.disabled = true;
      fetch('/api/clips/' + encodeURIComponent(c.id) + '/download').then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || 'Vidéo indisponible'); });
        return r.blob();
      }).then(function (blob) {
        var f = new File([blob], (c.title || 'clip').replace(/[^\w\-]+/g, '_') + '.mp4', { type: blob.type || 'video/mp4' });
        if (!navigator.canShare({ files: [f] })) throw new Error('Votre téléphone ne peut pas envoyer ce fichier');
        return navigator.share({ files: [f], title: text, text: text + ' ' + url }).then(function () { rec('file'); });
      }).catch(function (e) { if (e && e.name !== 'AbortError') toast(e.message || 'Envoi impossible'); })
        .then(function () { b.textContent = 'Envoyer la vidéo'; b.disabled = false; });
    };
    $('sh-wa').onclick = function () { rec('whatsapp'); };
    if ($('sh-sms')) $('sh-sms').onclick = function () { rec('sms'); };
  };

  /* comments */
  $('r-comment').onclick = function () {
    var c = cur(); if (!c) return;
    openModal(head('Commentaires') + '<div id="cm-list" class="mb-3 flex max-h-[45vh] flex-col gap-2 overflow-y-auto text-sm"><div class="text-neutral-400">Chargement…</div></div>' +
      '<form id="cm-form" class="flex gap-2" action="javascript:void(0)"><input id="cm-in" maxlength="500" autocomplete="off" placeholder="Ajouter un commentaire…" class="' + field + '"><button class="' + btn + '">Envoyer</button></form>');
    var list = $('cm-list');
    function row(m) { return '<div class="rounded-xl bg-neutral-800 px-3 py-2"><div class="text-xs font-bold text-gold">' + esc(m.name) + ' <span class="font-normal text-neutral-400">' + ago(m.created_at) + '</span></div><div class="break-words">' + esc(m.body) + '</div></div>'; }
    api('GET', '/api/clips/' + encodeURIComponent(c.id) + '/comments').then(function (r) { list.innerHTML = r.comments.length ? r.comments.map(row).join('') : '<div class="text-neutral-400">Aucun commentaire pour le moment. Soyez le premier.</div>'; list.scrollTop = list.scrollHeight; }).catch(function (e) { list.textContent = e.message; });
    if ($('cm-form')) $('cm-form').onsubmit = function (e) {
      e.preventDefault(); var b = $('cm-in').value.trim(); if (!b) return;
      api('POST', '/api/clips/' + encodeURIComponent(c.id) + '/comments', { body: b }).then(function (r) {
        if (!list.querySelector('.rounded-xl')) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', row(r)); list.scrollTop = list.scrollHeight; $('cm-in').value = ''; c.comments = r.count; if (cur() === c) paint();
      }).catch(fail);
    };
  };

  /* Citizen Card (from the database) */
  function cardHtml(u) {
    return '<div class="rounded-2xl bg-gradient-to-br from-[#FFF3C4] to-[#F3E6B8] p-4 text-neutral-900"><div class="flex items-center gap-3"><div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-black text-lg font-extrabold text-amber-400">' + esc(initials(u.name)) + '</div><div class="min-w-0"><div class="truncate text-lg font-extrabold">' + esc(u.name) + '</div><div class="text-xs font-semibold opacity-70">@' + esc(u.handle) + '</div>' + (u.verified ? '<div class="mt-1 inline-flex items-center gap-1 rounded-full bg-black px-2 py-0.5 text-[11px] font-bold text-amber-400">Verified</div>' : '') + '</div></div>' +
      '<div class="mt-4 text-xs font-semibold uppercase opacity-60">ID</div><div class="font-mono text-base font-bold">' + esc(u.citizenId) + '</div>' +
      '<div class="mt-4 grid grid-cols-3 gap-2 text-center"><div class="rounded-xl bg-white/60 py-2"><div class="text-xl font-extrabold">' + u.clips + '</div><div class="text-xs">Clips</div></div><div class="rounded-xl bg-white/60 py-2"><div class="text-xl font-extrabold">' + u.followers + '</div><div class="text-xs">Abonnés</div></div><div class="rounded-xl bg-white/60 py-2"><div class="text-xl font-extrabold">' + u.following + '</div><div class="text-xs">Abonnements</div></div></div></div>' +
      '<button id="cc-profile" class="' + btn + ' mt-3 w-full">Voir le profil</button>';
  }
  $('t-card').onclick = function () {
    var c = cur(); if (!c) return;
    openModal(head('Citizen Card') + '<div id="cc" class="text-sm text-neutral-300">Chargement…</div>');
    api('GET', '/api/citizen/' + encodeURIComponent(c.author.handle)).then(function (u) {
      $('cc').innerHTML = cardHtml(u); $('cc-profile').onclick = function () { nav('/u/' + encodeURIComponent(u.handle)); };
    }).catch(function (e) { $('cc').textContent = e.message; });
  };

  /* Message */
  function bubble(m) { return '<div class="' + (m.mine ? 'self-end bg-amber-400 text-black' : 'self-start bg-neutral-800') + ' max-w-[85%] break-words rounded-2xl px-3 py-2">' + esc(m.body) + '</div>'; }
  $('t-msg').onclick = (function () {
    var c = cur(); if (!c) return; var h = c.author.handle;
    openModal(head('Message · ' + esc(c.author.name)) + '<div id="mg-list" class="mb-3 flex max-h-[40vh] flex-col gap-2 overflow-y-auto text-sm"><div class="text-neutral-400">Chargement…</div></div><form id="mg" class="flex gap-2" action="javascript:void(0)"><input id="mg-b" maxlength="1000" autocomplete="off" placeholder="Écrire à @' + esc(h) + '…" class="' + field + '"><button class="' + btn + '">Envoyer</button></form>');
    var list = $('mg-list');
    api('GET', '/api/messages?with=' + encodeURIComponent(h)).then(function (r) { list.innerHTML = r.messages.length ? r.messages.map(bubble).join('') : '<div class="text-neutral-400">Aucun message. Écrivez le premier.</div>'; list.scrollTop = list.scrollHeight; refreshMe(); }).catch(function (e) { list.textContent = e.message; });
    $('mg').onsubmit = function (e) {
      e.preventDefault(); var b = $('mg-b').value.trim(); if (!b) return;
      api('POST', '/api/messages', { to: h, clip: c.id, body: b }).then(function (r) { if (!list.querySelector('div.rounded-2xl')) list.innerHTML = ''; list.insertAdjacentHTML('beforeend', bubble({ mine: true, body: r.body })); list.scrollTop = list.scrollHeight; $('mg-b').value = ''; }).catch(fail);
    };
  });

  /* Ask AI: Envoyer + Copier */
  $('t-ai').onclick = function () {
    var c = cur(); if (!c) return;
    var chips = [['Hashtags', 'Propose-moi des hashtags'], ['Commentaire', 'Écris un commentaire pour ce clip'], ['Résumé', 'Résume ce clip'], ['Titre', 'Propose un titre']];
    openModal(head('Ask AI') + '<div class="mb-3 flex flex-wrap gap-2">' + chips.map(function (x) { return '<button type="button" data-p="' + esc(x[1]) + '" class="rounded-full border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-xs font-bold">' + x[0] + '</button>'; }).join('') + '</div>' +
      '<form id="ai" class="flex gap-2" action="javascript:void(0)"><input id="ai-in" maxlength="500" autocomplete="off" placeholder="Posez votre question sur ce clip…" class="' + field + '"><button id="ai-go" class="' + btn + '">Envoyer</button></form>' +
      '<div id="ai-out" class="mt-3 hidden"><div id="ai-txt" class="whitespace-pre-wrap break-words rounded-2xl bg-neutral-800 p-3 text-sm"></div><button id="ai-copy" class="mt-2 flex items-center gap-1.5 rounded-full border border-neutral-600 px-4 py-2 text-sm font-bold">Copier</button></div>');
    modal.querySelectorAll('[data-p]').forEach(function (b) { b.onclick = function () { $('ai-in').value = b.dataset.p; $('ai').requestSubmit(); }; });
    $('ai').onsubmit = function (e) {
      e.preventDefault(); var q = $('ai-in').value.trim(); if (!q) return;
      $('ai-go').disabled = true; $('ai-out').classList.remove('hidden'); $('ai-txt').textContent = 'Réflexion en cours…';
      api('POST', '/api/ask', { prompt: q, clip: { caption: [titleOf(c), capOf(c)].filter(Boolean).join('. '), author: c.author.name } })
        .then(function (r) { $('ai-txt').textContent = r.reply;  })
        .catch(function (e2) { $('ai-txt').textContent = e2.message; }).then(function () { $('ai-go').disabled = false; });
    };
    $('ai-copy').onclick = function () { var t = $('ai-txt').textContent; if (!t || t === 'Réflexion en cours…') return; copyText(t).then(function () { $('ai-copy').textContent = 'Copié ✓'; setTimeout(function () { var b = $('ai-copy'); if (b) b.textContent = 'Copier'; }, 1600); }); };
  };


  function deleteAccountModal() {
      openModal(head('Supprimer mon compte') + '<p class="mb-3 text-sm text-neutral-300">Cette action est définitive : votre compte, vos clips, commentaires et messages seront supprimés. Entrez votre mot de passe pour confirmer.</p><form id="d-f" class="flex flex-col gap-3" action="javascript:void(0)"><input id="d-p" type="password" autocomplete="current-password" placeholder="Mot de passe" class="' + inp + '"><div class="flex items-center gap-2"><button type="button" id="d-eye" aria-label="Afficher le mot de passe" class="flex h-10 items-center gap-1.5 rounded-full border border-neutral-600 bg-neutral-800 px-4 text-sm font-bold"><i data-lucide="eye" class="h-5 w-5"></i><span>Afficher</span></button><button type="button" id="d-chk" class="h-10 rounded-full border border-neutral-600 bg-neutral-800 px-4 text-sm font-bold">Vérifier</button><span id="d-ok" role="status" class="min-w-0 flex-1 text-sm font-bold"></span></div><div id="d-err" class="min-h-[18px] text-sm text-red-400"></div><button class="rounded-full bg-red-600 px-5 py-2.5 text-sm font-extrabold text-white">Supprimer définitivement</button></form>');
      var okEl = function (good, t) { var o = $('d-ok'); o.className = 'min-w-0 flex-1 text-sm font-bold ' + (good ? 'text-green-400' : 'text-red-400'); o.textContent = t; };
      $('d-p').oninput = function () { $('d-ok').textContent = ''; $('d-err').textContent = ''; };
      $('d-eye').onclick = function () { var show = $('d-p').type === 'password'; $('d-p').type = show ? 'text' : 'password'; $('d-eye').innerHTML = '<i data-lucide="' + (show ? 'eye-off' : 'eye') + '" class="h-5 w-5"></i><span>' + (show ? 'Masquer' : 'Afficher') + '</span>'; $('d-eye').setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'); icons(); };
      $('d-chk').onclick = function () {
        var pw = $('d-p').value; if (!pw) return okEl(false, 'Saisissez le mot de passe');
        $('d-chk').disabled = true; $('d-ok').textContent = '';
        api('POST', '/api/me/check-password', { password: pw }).then(function (r) { r.ok ? okEl(true, '✓ Mot de passe correct') : okEl(false, '✗ Mot de passe incorrect'); }).catch(function (e) { okEl(false, e.message); }).then(function () { $('d-chk').disabled = false; });
      };
      $('d-f').onsubmit = function (e) { e.preventDefault(); api('DELETE', '/api/me', { password: $('d-p').value }).then(function () { tokSet(''); me = null; unread = 0; badge(); return reloadFeed(); }).then(function () { nav('/signup', { replace: true }); toast('Compte supprimé'); }).catch(function (err) { $('d-err').textContent = err.message; }); };
  }


  /* ================= Settings hub: the SAME seven entries in the ⋮ toolbox, the Settings button and /settings ================= */
  var SET_ROWS = [['lang', 'languages', 'Langue'], ['quality', 'gauge', 'Qualité vidéo'], ['notif', 'bell', 'Notifications'], ['account', 'user-round', 'Compte'], ['privacy', 'lock', 'Confidentialité'], ['theme', 'palette', 'Thème'], ['help', 'life-buoy', 'Aide'], ['about', 'info', 'À propos']];
  var isLight = false;
  function applyTheme() {
    var t = 'dark'; try { t = localStorage.getItem('theme') || 'dark'; } catch (e) { /* ignore */ }
    isLight = t === 'light' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
    $('phone').classList.toggle('light', isLight); document.body.style.background = isLight ? '#fff' : '#000';
    var ac = '#fbbf24'; try { ac = localStorage.getItem('accent') || ac; } catch (e) { /* ignore */ }
    var sty = $('accent-css'); if (!sty) { sty = document.createElement('style'); sty.id = 'accent-css'; document.head.appendChild(sty); }
    sty.textContent = ac === '#fbbf24' ? '' : ':root{--ac:' + ac + '}.text-amber-400{color:var(--ac)!important}.bg-amber-400,.bg-amber-400\\/90,.bg-gold{background-color:var(--ac)!important}.border-amber-400,.focus\\:border-amber-400:focus{border-color:var(--ac)!important}.dot-pulse{background:var(--ac)!important}';
    if (window.paint) window.paint();
  }
  var headB = function (t, back) { return '<div class="mb-3 flex items-center gap-2"><button data-bk class="flex h-11 items-center gap-1 rounded-full bg-neutral-800 px-3 text-sm font-bold"><i data-lucide="chevron-left" class="h-5 w-5"></i>Retour</button><h2 class="min-w-0 flex-1 truncate text-center text-lg font-extrabold">' + t + '</h2><button data-x aria-label="Fermer" class="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800 text-lg">✕</button></div>'; };
  function setHint(k) {
    var st = me ? me.settings : {};
    if (k === 'lang') return '<span data-notr>' + esc(I18N.name(I18N.get())) + '</span>';
    if (k === 'quality') return QL[quality()][0];
    if (k === 'notif') return me ? (st.notifications ? 'Activées' : 'Désactivées') : '';
    if (k === 'account') return me ? '<span data-notr>@' + esc(me.handle) + '</span>' : 'Non connecté';
    if (k === 'privacy') return me ? (st.private_profile ? 'Privé' : 'Public') : '';
    if (k === 'theme') { var t = 'dark'; try { t = localStorage.getItem('theme') || 'dark'; } catch (e) { /* ignore */ } return { dark: 'Sombre', light: 'Clair', auto: 'Automatique' }[t] || ''; }
    return '';
  }
  function settingsRows() {
    return SET_ROWS.map(function (r) { return '<button data-set="' + r[0] + '" class="flex w-full items-center gap-3 rounded-xl bg-neutral-800 p-3 text-left text-sm"><i data-lucide="' + r[1] + '" class="h-5 w-5 shrink-0 text-amber-400"></i><span class="flex-1 font-bold">' + r[2] + '</span><span class="text-xs text-neutral-400">' + setHint(r[0]) + '</span><i data-lucide="chevron-right" class="h-4 w-4 shrink-0 text-neutral-500"></i></button>'; }).join('');
  }
  function bindSettingsRows(root, back) {
    root.querySelectorAll('[data-set]').forEach(function (b) { b.onclick = function () { setSub(b.dataset.set, back); }; });
  }
  function settingsModal() { openModal(head('Paramètres') + '<div class="flex flex-col gap-2">' + settingsRows() + '</div>'); bindSettingsRows(modal, settingsModal); }
  var setOpt = function (attr, val, on, t, d) { return '<button ' + attr + '="' + val + '" role="radio" aria-checked="' + on + '" class="flex w-full items-center justify-between gap-3 rounded-xl p-3 text-left text-sm ' + (on ? 'bg-amber-400 text-black' : 'bg-neutral-800') + '"><span><b>' + t_(t) + '</b>' + (d ? '<span class="block text-xs ' + (on ? 'text-black/70' : 'text-neutral-400') + '">' + d + '</span>' : '') + '</span>' + (on ? '<span aria-hidden="true">✓</span>' : '') + '</button>'; };
  var t_ = function (x) { return x; };
  var setSw = function (k, t, d, on) { return '<div class="flex items-center justify-between gap-3 rounded-xl bg-neutral-800 p-3"><div class="text-sm"><b>' + t + '</b><div class="text-xs text-neutral-400">' + d + '</div></div><button role="switch" data-sk="' + k + '" aria-checked="' + !!on + '" aria-label="' + t + '" class="relative h-7 w-12 shrink-0 rounded-full ' + (on ? 'bg-amber-400' : 'bg-neutral-600') + '"><span class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ' + (on ? 'left-[22px]' : 'left-0.5') + '"></span></button></div>'; };
  var loginPrompt = function (m) { return '<div class="rounded-xl bg-neutral-800 p-4 text-sm text-neutral-300"><p class="mb-3">' + m + '</p><div class="flex gap-2"><button id="sl-in" class="' + btn + ' flex-1">Se connecter</button><button id="sl-up" class="' + btn2 + ' flex-1">Créer un compte</button></div></div>'; };
  // ---- helpers shared by the settings pages ----
  var prefs = function () { return (me && me.settings && me.settings.prefs) || {}; };
  var ACCENTS = [['#fbbf24', 'Or'], ['#ef4444', 'Rouge'], ['#ec4899', 'Rose'], ['#8b5cf6', 'Violet'], ['#3b82f6', 'Bleu'], ['#22c55e', 'Vert']];
  var NOTIF_TYPES = [['clip', 'Nouveau clip', 'Un créateur que vous suivez publie'], ['like', 'Like', 'Quelqu’un aime votre clip'], ['comment', 'Commentaire', 'Quelqu’un commente votre clip'], ['follow', 'Abonnement', 'Quelqu’un s’abonne à vous']];
  var setSw2 = function (attr, k, t, d, on) { return setSw(k, t, d, on).replace('data-sk="' + k + '"', attr + '="' + k + '"'); };
  var card = function (h) { return '<div class="rounded-xl bg-neutral-800 p-3 text-sm">' + h + '</div>'; };
  var lbl = function (t) { return '<div class="mt-3 mb-1 text-xs font-bold uppercase text-neutral-400">' + t + '</div>'; };
  var rowBtn = function (id, t, d) { return '<button id="' + id + '" class="flex w-full items-center justify-between gap-3 rounded-xl bg-neutral-800 p-3 text-left text-sm"><span><b>' + t + '</b>' + (d ? '<span class="block text-xs text-neutral-400">' + d + '</span>' : '') + '</span><i data-lucide="chevron-right" class="h-4 w-4 shrink-0 text-neutral-500"></i></button>'; };
  var SUB_TITLES = { faq: 'FAQ', tuto: 'Tutoriel', contact: 'Contacter le support', bug: 'Signaler un problème', terms: 'Conditions d’utilisation', policy: 'Politique de confidentialité' };
  var FAQ = [
    ['Comment publier un clip ?', 'Touchez Importer, choisissez ou enregistrez une vidéo, réglez le montage et l’audio, puis Publier.'],
    ['Dois-je me reconnecter à chaque clip ?', 'Non. Vous vous connectez une seule fois : la session est gardée sur cet appareil et se renouvelle seule.'],
    ['Comment retirer le son d’origine ?', 'Dans le studio, onglet Audio, touchez « Supprimer l’audio original », puis ajoutez une musique, une voix ou un effet.'],
    ['L’IA est-elle obligatoire ?', 'Non. Le mode AI / Robot est désactivé par défaut : vous restez sur votre vidéo réelle tant que vous ne l’activez pas.'],
    ['Comment changer la qualité de lecture ?', 'Paramètres, Qualité vidéo. Auto s’adapte à votre connexion ; les autres choix fixent la qualité.'],
    ['Comment supprimer mon compte ?', 'Paramètres, Confidentialité, Supprimer mon compte. Votre mot de passe est demandé pour confirmer.']
  ];
  var TUTO = [
    ['1. Créez votre compte', 'Inscrivez-vous une seule fois : vous restez connecté.'],
    ['2. Importez ou enregistrez', 'Touchez Importer, puis choisissez une vidéo ou enregistrez avec la caméra.'],
    ['3. Montez votre clip', 'Réglages, Filtres, Couper et Audio : l’aperçu se met à jour en direct.'],
    ['4. Publiez', 'Donnez un titre, une description et des hashtags, puis touchez Publier.'],
    ['5. Faites-le vivre', 'Likez, commentez, partagez et sauvegardez les clips depuis le fil.']
  ];
  var TERMS = ['Arena Clips permet de publier et regarder de courtes vidéos. En l’utilisant, vous acceptez ces règles.', 'Vous publiez uniquement des contenus dont vous détenez les droits (images, musique, voix). Les contenus illégaux, haineux ou qui portent atteinte à autrui sont interdits et peuvent être supprimés.', 'Vous êtes responsable de votre compte et de votre mot de passe. Vous pouvez supprimer votre compte à tout moment depuis Confidentialité.', 'Le service est fourni tel quel ; des interruptions sont possibles. Ces conditions peuvent évoluer, la version en vigueur est celle affichée ici.'];
  var POLICY = ['Données conservées : votre e-mail, votre nom affiché, votre mot de passe (stocké chiffré), votre profil et vos clips, likes, commentaires et messages.', 'Vos données ne sont ni vendues ni partagées avec des tiers, et l’application n’utilise aucun traceur publicitaire.', 'Vous gardez le contrôle : profil public ou privé, qui peut commenter, qui peut télécharger, notifications. Vos réglages de lecture, de thème et de langue sont gardés sur votre appareil.', 'La suppression du compte efface votre profil et vos contenus de la plateforme.'];
  var paras = function (a) { return '<div class="flex flex-col gap-3 text-sm text-neutral-300">' + a.map(function (x) { return '<p>' + x + '</p>'; }).join('') + '</div>'; };
  var QL = { auto: ['Auto', 'S’adapte à votre connexion (720p, ou 360p si elle ralentit)'], '1080': ['1080p', 'Meilleure qualité disponible : 720p'], '720': ['720p', 'Qualité haute'], '480': ['480p', 'Économie de données : 360p'] };
  function savePrefs(p, again) { return api('PATCH', '/api/me', { prefs: p }).then(function (r) { me = r.user; if (again) again(); }).catch(fail); }
  var ago = function (t) { var s = Math.max(1, Math.round((Date.now() - new Date(t)) / 1000)); return s < 90 ? 'à l’instant' : s < 5400 ? Math.round(s / 60) + ' min' : s < 129600 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' j'; };

  function setSub(k, back) {
    var row = SET_ROWS.filter(function (r) { return r[0] === k; })[0], title = row ? row[2] : SUB_TITLES[k] || k;
    var again = function () { setSub(k, back); }, body = '', st = me ? me.settings : {}, pf = prefs(), after = null;
    switch (k) {
      case 'lang':
        body = '<div role="radiogroup" class="flex flex-col gap-2">' + I18N.LANGS.map(function (l) { return setOpt('data-lg', l[0], I18N.get() === l[0], '<span data-notr>' + l[1] + '</span>', ''); }).join('') + '</div><p class="mt-3 text-xs text-neutral-400">Le changement est immédiat, sans recharger l’appli, et votre choix est gardé.</p>';
        break;
      case 'quality': {
        var q = quality();
        body = '<div role="radiogroup" class="flex flex-col gap-2">' + ['auto', '1080', '720', '480'].map(function (o) { return setOpt('data-sq', o, q === o, QL[o][0], QL[o][1]); }).join('') + '</div><p class="mt-3 text-xs text-neutral-400">S’applique à la lecture des clips, tout de suite.</p>';
        break;
      }
      case 'notif': {
        if (!me) { body = loginPrompt('Connectez-vous pour régler les notifications.'); break; }
        var nt = pf.notif || {};
        body = setSw('notifications', 'Notifications', 'Activer ou couper toutes les notifications', st.notifications) + lbl('Types') + '<div class="flex flex-col gap-2">' + NOTIF_TYPES.map(function (t) { return setSw2('data-sn', t[0], t[1], t[2], nt[t[0]] !== false); }).join('') + '</div>' + lbl('Récentes') + '<div id="nf-list" class="flex flex-col gap-2">' + card('Chargement…') + '</div>';
        after = function () {
          api('GET', '/api/notifications').then(function (r) {
            var el = $('nf-list'); if (!el) return;
            var tx = { like: 'a aimé votre clip', comment: 'a commenté : ', follow: 's’est abonné à vous', clip: 'a publié un clip : ' };
            el.innerHTML = r.off ? card('Les notifications sont désactivées.') : r.items.length ? r.items.map(function (i) { return card('<b data-notr>' + esc(i.who) + '</b> ' + tx[i.type] + (i.type === 'comment' || i.type === 'clip' ? '<span data-notr>' + esc(i.detail || '') + '</span>' : '') + '<div class="mt-0.5 text-xs text-neutral-400">' + ago(i.at) + '</div>'); }).join('') : card('Rien de nouveau pour le moment.');
            if (r.fresh) api('PATCH', '/api/me', { prefs: { notif_seen: true } }).then(function (u) { me = u.user; }).catch(function () { /* optional */ });
          }).catch(function () { if ($('nf-list')) $('nf-list').innerHTML = card('Impossible de charger les notifications.'); });
        };
        break;
      }
      case 'account':
        if (!me) { body = loginPrompt('Connectez-vous pour gérer votre compte.'); break; }
        body = '<div class="flex flex-col gap-2">' + card('<div class="text-xs text-neutral-400">E-mail</div><span data-notr>' + esc(me.email) + '</span>') + rowBtn('ac-prof', 'Profil', 'Nom, @utilisateur, bio, ville, lien') + rowBtn('ac-photo', 'Photo', 'Changer ma photo de profil') +
          '<form id="ts-name" class="flex gap-2" action="javascript:void(0)"><input id="ts-dn" maxlength="40" value="' + esc(me.name) + '" aria-label="Nom affiché" class="' + field + '"><button class="' + btn + '">Nom</button></form>' +
          '<form id="ts-bio" class="flex flex-col gap-2" action="javascript:void(0)"><textarea id="ts-b" maxlength="300" rows="3" aria-label="Bio" placeholder="Votre bio" class="' + inp + '">' + esc(me.bio || '') + '</textarea><button class="' + btn2 + '">Enregistrer la bio</button></form>' +
          lbl('Mot de passe') + '<form id="ts-pw" class="flex flex-col gap-2" action="javascript:void(0)"><input id="pw-c" type="password" autocomplete="current-password" placeholder="Mot de passe actuel" aria-label="Mot de passe actuel" class="' + inp + '"><input id="pw-n" type="password" autocomplete="new-password" placeholder="Nouveau mot de passe (8 caractères minimum)" aria-label="Nouveau mot de passe" class="' + inp + '"><input id="pw-n2" type="password" autocomplete="new-password" placeholder="Confirmer le nouveau mot de passe" aria-label="Confirmer" class="' + inp + '"><div id="pw-e" class="text-xs text-red-400" role="alert"></div><button class="' + btn2 + '">Changer le mot de passe</button></form>' +
          '<button id="st-out" class="mt-2 w-full rounded-full border border-red-500 px-5 py-2.5 text-sm font-bold text-red-400">Déconnexion</button></div>';
        break;
      case 'privacy':
        if (!me) { body = loginPrompt('Connectez-vous pour choisir la confidentialité de votre compte.') + card('Vos données restent les vôtres : aucun traceur publicitaire, aucune vente ni partage avec des tiers.'); break; }
        body = '<div role="radiogroup" class="flex flex-col gap-2">' + setOpt('data-pp', 'false', !st.private_profile, 'Compte public', 'Tout le monde voit vos clips') + setOpt('data-pp', 'true', !!st.private_profile, 'Compte privé', 'Seuls vos abonnés acceptés voient vos clips') + '</div>' +
          lbl('Qui peut commenter') + '<div role="radiogroup" class="flex flex-col gap-2">' + [['everyone', 'Tout le monde'], ['followers', 'Mes abonnés'], ['nobody', 'Personne']].map(function (o) { return setOpt('data-pr', 'who_comments:' + o[0], (pf.who_comments || 'everyone') === o[0], o[1], ''); }).join('') + '</div>' +
          lbl('Qui peut télécharger') + '<div role="radiogroup" class="flex flex-col gap-2">' + [['everyone', 'Tout le monde'], ['nobody', 'Personne']].map(function (o) { return setOpt('data-pr', 'who_download:' + o[0], (pf.who_download || 'everyone') === o[0], o[1], o[0] === 'nobody' ? 'Vos clips ne peuvent pas être téléchargés' : ''); }).join('') + '</div>' +
          '<div class="mt-3">' + setSw('allow_messages', 'Autoriser les messages', 'Les autres membres peuvent vous écrire', st.allow_messages) + '</div>' +
          '<div class="mt-3 rounded-xl bg-neutral-800 p-3 text-xs text-neutral-300">Vos données restent les vôtres : aucun traceur publicitaire, aucune vente ni partage avec des tiers. Vous choisissez qui voit vos clips, qui peut commenter et télécharger, et vous pouvez supprimer votre compte à tout moment.</div>' +
          '<button id="tb-del2" class="mt-2 w-full rounded-full border border-red-500 px-5 py-2.5 text-sm font-bold text-red-400">Supprimer mon compte</button>';
        break;
      case 'theme': {
        var th = 'dark', ac = '#fbbf24'; try { th = localStorage.getItem('theme') || 'dark'; ac = localStorage.getItem('accent') || ac; } catch (e) { /* ignore */ }
        body = '<div role="radiogroup" class="flex flex-col gap-2">' + setOpt('data-th', 'dark', th === 'dark', 'Sombre', '') + setOpt('data-th', 'light', th === 'light', 'Clair', '') + setOpt('data-th', 'auto', th === 'auto', 'Automatique', 'Suit votre téléphone') + '</div>' +
          lbl('Couleur principale') + '<div role="radiogroup" class="flex flex-wrap gap-3">' + ACCENTS.map(function (a) { return '<button data-ac="' + a[0] + '" role="radio" aria-checked="' + (ac === a[0]) + '" aria-label="' + a[1] + '" class="flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold text-black ' + (ac === a[0] ? 'ring-2 ring-white' : '') + '" style="background:' + a[0] + '">' + (ac === a[0] ? '✓' : '') + '</button>'; }).join('') + '</div>';
        break;
      }
      case 'help':
        body = '<div class="flex flex-col gap-2">' + rowBtn('hp-faq', 'FAQ', 'Questions fréquentes') + rowBtn('hp-tuto', 'Tutoriel', 'Publier un clip en 5 étapes') + rowBtn('hp-contact', 'Contacter le support', 'Écrivez-nous') + rowBtn('hp-bug', 'Signaler un problème', 'Quelque chose ne marche pas') + '</div>';
        break;
      case 'faq':
        body = '<div class="flex flex-col gap-2">' + FAQ.map(function (f) { return '<details class="rounded-xl bg-neutral-800 p-3 text-sm"><summary class="cursor-pointer font-bold">' + f[0] + '</summary><p class="mt-2 text-neutral-300">' + f[1] + '</p></details>'; }).join('') + '</div>';
        back = (function (b) { return function () { setSub('help', b); }; })(back);
        break;
      case 'tuto':
        body = '<ol class="flex flex-col gap-2">' + TUTO.map(function (t) { return '<li>' + card('<b>' + t[0] + '</b><div class="text-neutral-300">' + t[1] + '</div>') + '</li>'; }).join('') + '</ol>';
        back = (function (b) { return function () { setSub('help', b); }; })(back);
        break;
      case 'contact':
      case 'bug':
        body = '<form id="sp-f" class="flex flex-col gap-2" action="javascript:void(0)"><p class="text-sm text-neutral-300">' + (k === 'bug' ? 'Décrivez le problème : ce que vous faisiez et ce qui s’est passé.' : 'Écrivez votre message, nous le lisons.') + '</p><textarea id="sp-m" rows="5" maxlength="2000" aria-label="Message" placeholder="Votre message" class="' + inp + '"></textarea><input id="sp-c" maxlength="200" aria-label="Contact" placeholder="Votre e-mail pour la réponse (facultatif)" value="' + esc(me ? me.email : '') + '" class="' + inp + '"><div id="sp-e" class="text-xs text-red-400" role="alert"></div><button class="' + btn + '">Envoyer</button></form>';
        back = (function (b) { return function () { setSub('help', b); }; })(back);
        break;
      case 'about':
        body = '<div class="flex flex-col gap-2">' + card('<div class="text-xs text-neutral-400">Version</div><span id="ab-v" data-notr>…</span>') + rowBtn('ab-terms', 'Conditions d’utilisation', '') + rowBtn('ab-policy', 'Politique de confidentialité', '') + '</div>';
        after = function () { fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) { if ($('ab-v')) $('ab-v').textContent = 'Arena Clips · build ' + (c.build || '—'); }).catch(function () { if ($('ab-v')) $('ab-v').textContent = 'Arena Clips'; }); };
        break;
      case 'terms':
        body = paras(TERMS); back = (function (b) { return function () { setSub('about', b); }; })(back); break;
      case 'policy':
        body = paras(POLICY); back = (function (b) { return function () { setSub('about', b); }; })(back); break;
    }
    openModal(headB(title) + body);
    var go = function (id, sub) { if ($(id)) $(id).onclick = function () { setSub(sub, back); }; };
    go('hp-faq', 'faq'); go('hp-tuto', 'tuto'); go('hp-contact', 'contact'); go('hp-bug', 'bug'); go('ab-terms', 'terms'); go('ab-policy', 'policy');
    var bk = modal.querySelector('[data-bk]'); bk.onclick = function () { if (back === closeOverlay) closeOverlay(); else back(); };
    modal.querySelectorAll('[data-lg]').forEach(function (b) { b.onclick = function () { I18N.set(b.dataset.lg); if (me) savePrefs({ lang: b.dataset.lg }); again(); }; });
    modal.querySelectorAll('[data-sq]').forEach(function (b) { b.onclick = function () { try { localStorage.setItem('quality', b.dataset.sq); sessionStorage.removeItem('rend'); } catch (e) { /* ignore */ } requalify(); again(); toast('Qualité : ' + QL[b.dataset.sq][0]); }; });
    modal.querySelectorAll('[data-th]').forEach(function (b) { b.onclick = function () { try { localStorage.setItem('theme', b.dataset.th); } catch (e) { /* ignore */ } applyTheme(); again(); }; });
    modal.querySelectorAll('[data-ac]').forEach(function (b) { b.onclick = function () { try { localStorage.setItem('accent', b.dataset.ac); } catch (e) { /* ignore */ } applyTheme(); if (me) savePrefs({ accent: b.dataset.ac }); again(); }; });
    modal.querySelectorAll('[data-sk]').forEach(function (b) { b.onclick = function () { var kk = b.dataset.sk, p = {}; p[kk] = !me.settings[kk]; api('PATCH', '/api/me', p).then(function (r) { me = r.user; if (kk === 'notifications') badge(); again(); }).catch(fail); }; });
    modal.querySelectorAll('[data-sn]').forEach(function (b) { b.onclick = function () { var n = Object.assign({ clip: true, like: true, comment: true, follow: true }, prefs().notif || {}); n[b.dataset.sn] = !n[b.dataset.sn]; savePrefs({ notif: n }, again); }; });
    modal.querySelectorAll('[data-pr]').forEach(function (b) { b.onclick = function () { var kv = b.dataset.pr.split(':'), p = {}; p[kv[0]] = kv[1]; savePrefs(p, again); }; });
    modal.querySelectorAll('[data-pp]').forEach(function (b) { b.onclick = function () { api('PATCH', '/api/me', { private_profile: b.dataset.pp === 'true' }).then(function (r) { me = r.user; again(); }).catch(fail); }; });
    var f = $('ts-name'); if (f) f.onsubmit = function (e) { e.preventDefault(); api('PATCH', '/api/me', { display_name: $('ts-dn').value }).then(function (r) { me = r.user; paintEq(); toast('Nom enregistré'); }).catch(fail); };
    f = $('ts-bio'); if (f) f.onsubmit = function (e) { e.preventDefault(); api('PATCH', '/api/me', { bio: $('ts-b').value }).then(function (r) { me = r.user; toast('Bio enregistrée'); }).catch(fail); };
    f = $('ts-pw'); if (f) f.onsubmit = function (e) {
      e.preventDefault(); var er = $('pw-e'); er.textContent = '';
      if ($('pw-n').value.length < 8) { er.textContent = 'Nouveau mot de passe : 8 caractères minimum'; return; }
      if ($('pw-n').value !== $('pw-n2').value) { er.textContent = 'Les deux mots de passe ne correspondent pas'; return; }
      api('POST', '/api/me/password', { current: $('pw-c').value, next: $('pw-n').value }).then(function () { toast('Mot de passe changé'); f.reset(); }).catch(function (x) { er.textContent = (x && x.message) || 'Erreur'; });
    };
    f = $('sp-f'); if (f) f.onsubmit = function (e) {
      e.preventDefault(); var er = $('sp-e'); er.textContent = '';
      api('POST', '/api/support', { kind: k, message: $('sp-m').value, contact: $('sp-c').value }).then(function () { toast('Message envoyé, merci'); back(); }).catch(function (x) { er.textContent = (x && x.message) || 'Envoi impossible'; });
    };
    var editMe = function (focus) { closeOverlay(); setTimeout(function () { api('GET', '/api/users/' + encodeURIComponent(me.handle)).then(function (u) { editProfile(u, focus); }).catch(fail); }, 80); };
    if ($('ac-prof')) $('ac-prof').onclick = function () { editMe(); };
    if ($('ac-photo')) $('ac-photo').onclick = function () { editMe('avatar'); };
    if ($('st-out')) $('st-out').onclick = function () { logout(); };
    if ($('tb-del2')) $('tb-del2').onclick = deleteAccountModal;
    if ($('sl-in')) $('sl-in').onclick = function () { nav('/login?next=' + encodeURIComponent(location.pathname)); };
    if ($('sl-up')) $('sl-up').onclick = function () { nav('/signup?next=' + encodeURIComponent(location.pathname)); };
    if (after) after();
  }
  // the globe next to Retour: language list only
  function languagePicker() { setSub('lang', closeOverlay); }
  applyTheme();

  /* ================= Toolbox (⋮ under Home): clip tools + profile / account tools ================= */
  var zoomK = 1, zx = 0, zy = 0, ZSTEPS = [1, 1.5, 2];
  function zoomApply() {
    [v, buf].forEach(function (el) { el.style.transform = zoomK > 1 ? 'translate(' + zx + 'px,' + zy + 'px) scale(' + zoomK + ')' : ''; el.style.touchAction = zoomK > 1 ? 'none' : ''; });
    poster.style.transform = v.style.transform; $('z-v').textContent = Math.round(zoomK * 100) + '%';
  }
  function zoomClamp() { var mx = (zoomK - 1) * v.clientWidth / 2 / zoomK, my = (zoomK - 1) * v.clientHeight / 2 / zoomK; zx = Math.max(-mx, Math.min(mx, zx)); zy = Math.max(-my, Math.min(my, zy)); }
  function zoomSet(k) { zoomK = k; if (k === 1) { zx = 0; zy = 0; } zoomClamp(); zoomApply(); }
  function zoomStep(d) { var i = ZSTEPS.indexOf(zoomK) + d; zoomSet(ZSTEPS[Math.max(0, Math.min(ZSTEPS.length - 1, i))]); }
  function zoomReset() { zoomSet(1); $('zoom-bar').hidden = true; }
  $('z-in').onclick = function () { zoomStep(1); };
  $('z-out').onclick = function () { zoomStep(-1); };
  $('z-reset').onclick = function () { zoomSet(1); };
  $('z-x').onclick = zoomReset;
  // drag to move the zoomed video (and a drag never counts as a tap)
  var drag = null, dragged = false;
  ph.addEventListener('pointerdown', function (e) { if (zoomK > 1 && (e.target === v || e.target === buf)) { drag = { x: e.clientX, y: e.clientY, zx: zx, zy: zy }; dragged = false; } });
  ph.addEventListener('pointermove', function (e) {
    if (!drag) return; var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
    zx = drag.zx + dx / zoomK; zy = drag.zy + dy / zoomK; zoomClamp(); zoomApply();
  });
  var dragEnd = function () { drag = null; setTimeout(function () { dragged = false; }, 0); };
  ph.addEventListener('pointerup', dragEnd); ph.addEventListener('pointercancel', dragEnd);
  ph.addEventListener('click', function (e) { if (dragged) { e.stopPropagation(); e.preventDefault(); } }, true);

  var isMine = function (c) { return !!(me && c && c.author && me.handle === c.author.handle); };
  var tbtn = function (id, icon, text, sub, off) { return '<button id="' + id + '" ' + (off ? 'disabled' : '') + ' class="flex w-full items-center gap-3 rounded-xl bg-neutral-800 p-3 text-left text-sm disabled:opacity-40"><span class="flex h-8 w-8 shrink-0 items-center justify-center text-lg">' + icon + '</span><span class="min-w-0 flex-1"><b>' + text + '</b>' + (sub ? '<span class="block text-xs text-neutral-400">' + sub + '</span>' : '') + '</span></button>'; };
  var tgroup = function (t) { return '<h3 class="mb-2 mt-4 text-xs font-bold uppercase text-neutral-400">' + t + '</h3>'; };
  // all settings live in the Toolbox: video quality, language, notifications, messages, name, delete account
  function settingsBox() {
    var q = quality(), st = me ? me.settings : {};
    var opt = function (attr, val, on, t, d) { return '<button ' + attr + '="' + val + '" role="radio" aria-checked="' + on + '" class="flex w-full items-center justify-between gap-3 rounded-xl p-3 text-left text-sm ' + (on ? 'bg-amber-400 text-black' : 'bg-neutral-800') + '"><span><b>' + t + '</b><span class="block text-xs ' + (on ? 'text-black/70' : 'text-neutral-400') + '">' + d + '</span></span><span>' + (on ? '✓' : '') + '</span></button>'; };
    var sw = function (k, t, d) { return '<div class="flex items-center justify-between gap-3 rounded-xl bg-neutral-800 p-3"><div class="text-sm"><b>' + t + '</b><div class="text-xs text-neutral-400">' + d + '</div></div><button role="switch" data-sk="' + k + '" aria-checked="' + !!st[k] + '" aria-label="' + t + '" class="relative h-7 w-12 shrink-0 rounded-full ' + (st[k] ? 'bg-amber-400' : 'bg-neutral-600') + '"><span class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ' + (st[k] ? 'left-[22px]' : 'left-0.5') + '"></span></button></div>'; };
    return '<div class="flex flex-col gap-2"><div class="text-xs font-bold text-neutral-300">Qualité vidéo</div>' + opt('data-sq', 'auto', q === 'auto', 'Auto', '720p, 360p si le réseau ralentit') + opt('data-sq', 'saver', q === 'saver', 'Économiseur de données', 'Toujours 360p') +
      '<div class="mt-2 text-xs font-bold text-neutral-300">Langue</div><select id="ts-lang" aria-label="Langue" class="' + inp + '"><option value="fr" selected>Français</option></select>' +
      (me ? '<div class="mt-2 text-xs font-bold text-neutral-300">Compte</div><div class="rounded-xl bg-neutral-800 p-3 text-sm"><div class="text-xs text-neutral-400">E-mail</div>' + esc(me.email) + '</div>' +
        '<form id="ts-name" class="flex gap-2" action="javascript:void(0)"><input id="ts-dn" maxlength="40" value="' + esc(me.name) + '" aria-label="Nom affiché" class="' + field + '"><button class="' + btn + '">Enregistrer</button></form>' +
        sw('notifications', 'Notifications', 'Pastille de nouveaux messages') + sw('allow_messages', 'Autoriser les messages', 'Les autres membres peuvent vous écrire') +
        '<button id="tb-del2" class="mt-1 w-full rounded-full border border-red-500 px-5 py-2.5 text-sm font-bold text-red-400">Supprimer mon compte</button>'
        : '<div class="rounded-xl bg-neutral-800 p-3 text-sm text-neutral-300">Connectez-vous pour régler le compte, les notifications et les messages.</div>') + '</div>';
  }
  function bindSettings(again) {
    modal.querySelectorAll('[data-sq]').forEach(function (b) { b.onclick = function () { try { localStorage.setItem('quality', b.dataset.sq); sessionStorage.removeItem('rend'); } catch (e) { /* ignore */ } shownId = null; again(); toast('Qualité : ' + (b.dataset.sq === 'saver' ? 'économiseur' : 'auto')); }; });
    modal.querySelectorAll('[data-sk]').forEach(function (b) { b.onclick = function () { var k = b.dataset.sk, p = {}; p[k] = !me.settings[k]; api('PATCH', '/api/me', p).then(function (r) { me = r.user; if (k === 'notifications') badge(); again(); }).catch(fail); }; });
    var f = $('ts-name'); if (f) f.onsubmit = function (e) { e.preventDefault(); api('PATCH', '/api/me', { display_name: $('ts-dn').value }).then(function (r) { me = r.user; paintEq(); toast('Nom enregistré'); }).catch(fail); };
  }
  function toolbox() {
    var c = viewer || PATHN() === '/' ? cur() : null, mine = isMine(c), none = !c ? 'Ouvrez un clip' : '';
    var dl = c && (c.allowDownload !== false || mine);
    var own = function (sub) { return c ? (mine ? sub : 'Réservé au propriétaire') : none; };
    openModal(head('Boîte à outils') + '<div class="flex flex-col gap-2">' + '<h3 class="mb-0 text-xs font-bold uppercase text-neutral-400">Paramètres</h3>' + settingsRows() + tgroup('Éditer le clip') +
      tbtn('tb-desc', '📝', 'Description et titre', own('Titre, description, Coller'), !c || !mine) +
      tbtn('tb-text', '🔤', 'Texte sur le clip', own('Afficher un texte sur la vidéo'), !c || !mine) +
      tbtn('tb-acc', '✨', 'Accessoires et emoji', own('Autocollants emoji sur le clip'), !c || !mine) +
      tbtn('tb-fx', '🎨', 'Filtres et effets', own('Noir et blanc, sépia, chaud…'), !c || !mine) +
      tbtn('tb-cut', '✂️', 'Couper', own('Garder seulement un passage'), !c || !mine) +
      (c && mine ? tbtn('tb-wm', '💧', 'Watermark : ' + (c.watermark ? 'activé' : 'désactivé'), 'Toucher pour changer') : tbtn('tb-wm', '💧', 'Watermark', own(''), true)) +
      tgroup('Lecture') +
      tbtn('tb-speed', '⏩', 'Vitesse de lecture : ×' + rate, 'Ralentir ou accélérer') +
      tbtn('tb-vol', soundOn ? '🔊' : '🔇', 'Son / Volume', soundOn ? 'Son activé : toucher pour couper' : 'Son coupé : toucher pour activer', !c) +
      tbtn('tb-zoom', '🔍', 'Zoom + / − / Reset', none || '100 % → 150 % → 200 %', !c) +
      tbtn('tb-pc', '🖥️', 'Mode PC / Petit écran', none || 'Fenêtre fixe 800×450', !c) +
      tbtn('tb-fs', '⛶', 'Plein écran', none || 'Lire le clip en plein écran', !c) +
      tgroup('Ce clip') +
      tbtn('tb-copy', '📋', 'Copier', none || 'Copier le lien du clip', !c) +
      tbtn('tb-share', '🔗', 'Ouvrir / Partager', none || 'Lien, SMS, WhatsApp, partage externe', !c) +
      tbtn('tb-save', '🔖', 'Sauvegarder', none || (c.viewer && c.viewer.saved ? 'Déjà enregistré : toucher pour retirer' : 'Garder dans vos enregistrés'), !c) +
      tbtn('tb-dl', '📥', 'Télécharger', c ? (dl ? 'Enregistrer le clip' : 'Désactivé par le propriétaire') : none, !c || !dl) +
      (mine ? tbtn('tb-dlset', '🔓', c.allowDownload !== false ? 'Téléchargement : autorisé' : 'Téléchargement : interdit', 'Toucher pour changer') : '') +
      tbtn('tb-rep', '🚩', 'Signaler', none || 'Signaler ce clip', !c) +
      tbtn('tb-del', '🗑️', 'Supprimer', own('Supprimer ce clip'), !c || !mine) +
      tgroup('Mon espace') +
      tbtn('tb-imp', '⬆️', 'Importer', 'Ajouter un clip') +
      tbtn('tb-gal', '🖼️', 'Galerie / Gestion des clips', 'Mes clips publiés') +
      tbtn('tb-hist', '🕘', 'Historique', 'Derniers clips vus sur cet appareil') +
      tbtn('tb-prof', '👤', 'Profil : modifier, bio, photo', me ? '@' + esc(me.handle) : 'Se connecter pour voir son profil') +
      tbtn('tb-priv', '🔒', 'Confidentialité : ' + (me ? (me.settings.private_profile ? 'Privé' : 'Public') : 'Public / Privé'), me ? 'Toucher pour passer en ' + (me.settings.private_profile ? 'Public' : 'Privé') : 'Connexion requise') +
      tbtn('tb-out', '🚪', me ? 'Déconnexion' : 'Connexion', me ? 'Quitter ce compte' : 'Se connecter') + '</div>');
    var on = function (id, fn) { var b = $(id); if (b) b.onclick = fn; };

    on('tb-del', function () {
      openModal(head('Supprimer le clip') + '<p class="mb-4 text-sm text-neutral-200">Wach bghiti tsupprimer had clip ?</p><div class="flex gap-2"><button id="dl-yes" class="flex-1 rounded-full bg-red-600 px-5 py-2.5 text-sm font-extrabold text-white">Oui</button><button id="dl-no" class="' + btn2 + ' flex-1">Non</button></div>');
      $('dl-no').onclick = closeOverlay;
      $('dl-yes').onclick = function () {
        $('dl-yes').disabled = true;
        api('DELETE', '/api/clips/' + encodeURIComponent(c.id)).then(function () { afterDelete(c); toast('Clip supprimé'); }).catch(function (e) { $('dl-yes').disabled = false; fail(e); });
      };
    });
    function edit(body) { return api('PATCH', '/api/clips/' + encodeURIComponent(c.id) + '/edit', body); }
    on('tb-copy', function () { copyText(location.origin + '/c/' + encodeURIComponent(c.id)).then(function () { closeOverlay(); toast('Lien copié'); }); });
    on('tb-wm', function () { var w = !c.watermark; edit({ watermark: w }).then(function () { c.watermark = w; closeOverlay(); paint(); toast(w ? 'Watermark activé' : 'Watermark retiré'); }).catch(fail); });
    on('tb-text', function () {
      openModal(head('Texte sur le clip') + '<form id="tx-f" class="flex flex-col gap-2" action="javascript:void(0)"><input id="tx-t" maxlength="80" value="' + esc(c.overlayText || '') + '" placeholder="Votre texte (80 caractères max)" aria-label="Texte" class="' + field + '"><div class="flex gap-2"><button class="' + btn + ' flex-1">Enregistrer</button><button type="button" id="tx-rm" class="' + btn2 + ' flex-1">Retirer</button></div></form>');
      function save(t) { edit({ overlayText: t }).then(function () { c.overlayText = t; closeOverlay(); paint(); toast(t ? 'Texte ajouté' : 'Texte retiré'); }).catch(fail); }
      $('tx-f').onsubmit = function (e) { e.preventDefault(); save($('tx-t').value.trim()); };
      $('tx-rm').onclick = function () { save(''); };
    });
    on('tb-fx', function () {
      openModal(head('Filtres et effets') + '<div class="grid grid-cols-2 gap-2">' + Object.keys(FILTERS).map(function (k) { var on = (c.filter || '') === k; return '<button data-f="' + k + '" aria-pressed="' + on + '" class="rounded-xl p-3 text-sm font-bold ' + (on ? 'bg-amber-400 text-black' : 'bg-neutral-800') + '">' + FILTERS[k][0] + '</button>'; }).join('') + '</div>');
      modal.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { var k = b.dataset.f; edit({ filter: k }).then(function () { c.filter = k; closeOverlay(); paint(); toast('Filtre : ' + FILTERS[k][0]); }).catch(fail); }; });
    });
    on('tb-speed', function () {
      openModal(head('Vitesse de lecture') + '<div class="grid grid-cols-3 gap-2">' + [0.5, 0.75, 1, 1.25, 1.5, 2].map(function (r) { return '<button data-r="' + r + '" class="rounded-xl p-3 text-sm font-bold ' + (r === rate ? 'bg-amber-400 text-black' : 'bg-neutral-800') + '">×' + r + '</button>'; }).join('') + '</div>');
      modal.querySelectorAll('[data-r]').forEach(function (b) { b.onclick = function () { rate = parseFloat(b.dataset.r); try { sessionStorage.setItem('rate', String(rate)); } catch (e) { /* ignore */ } applyRate(); closeOverlay(); toast('Vitesse ×' + rate); }; });
    });
    on('tb-imp', function () { closeOverlay(); setTimeout(function () { $('up-open').click(); }, 80); });
    on('tb-gal', function () { if ($('up-gal').onclick) $('up-gal').onclick(); });
    on('tb-save', function () { $('r-save').click(); closeOverlay(); });
    on('tb-hist', function () {
      var h = []; try { h = JSON.parse(localStorage.getItem('hist') || '[]'); } catch (e) { /* ignore */ }
      openModal(head('Historique') + (h.length ? '<div class="flex flex-col gap-2">' + h.map(function (x) { return '<button data-h="' + esc(x.id) + '" class="rounded-xl bg-neutral-800 p-3 text-left text-sm">' + esc(x.t) + '</button>'; }).join('') + '</div><button id="hs-clear" class="' + btn2 + ' mt-3 w-full">Effacer l’historique</button>' : '<p class="text-sm text-neutral-400">Aucun clip vu pour le moment.</p>'));
      modal.querySelectorAll('[data-h]').forEach(function (b) { b.onclick = function () { closeOverlay(); nav('/c/' + encodeURIComponent(b.dataset.h)); }; });
      if ($('hs-clear')) $('hs-clear').onclick = function () { try { localStorage.removeItem('hist'); } catch (e) { /* ignore */ } closeOverlay(); toast('Historique effacé'); };
    });
    on('tb-cut', function () {
      var dur = v.duration || 0, a = c.trimStart || 0, b = c.trimEnd || dur;
      openModal(head('Couper') + '<p class="mb-3 text-sm text-neutral-300">Le clip ne joue que ce passage (secondes). L’original reste intact.</p><div class="mb-3 flex gap-2"><label class="flex-1 text-xs text-neutral-400">Début<input id="ct-a" type="number" min="0" step="0.1" value="' + a.toFixed(1) + '" class="' + field + '"></label><label class="flex-1 text-xs text-neutral-400">Fin<input id="ct-b" type="number" min="0" step="0.1" value="' + (b ? b.toFixed(1) : '') + '" class="' + field + '"></label></div><div class="flex gap-2"><button id="ct-ok" class="' + btn + ' flex-1">Enregistrer</button><button id="ct-rm" class="' + btn2 + ' flex-1">Retirer la coupe</button></div>');
      function save(ts, te) { edit({ trimStart: ts, trimEnd: te }).then(function () { c.trimStart = ts; c.trimEnd = te; closeOverlay(); try { v.currentTime = ts || 0; } catch (e) { /* ignore */ } toast('Coupe enregistrée'); }).catch(fail); }
      $('ct-ok').onclick = function () { var ts = parseFloat($('ct-a').value), te = parseFloat($('ct-b').value); if (!(ts >= 0) || !(te > ts)) return toast('La fin doit suivre le début'); save(ts, te); };
      $('ct-rm').onclick = function () { save(null, null); };
    });
    on('tb-acc', function () {
      var all = ['😎', '🎩', '👑', '🕶️', '❤️', '🔥', '⭐', '🎉', '💎', '🏆', '🎵', '🌟'], sel = (c.accessories || []).slice();
      function draw() { return all.map(function (e) { var on = sel.indexOf(e) >= 0; return '<button data-e="' + e + '" aria-pressed="' + on + '" class="h-14 rounded-xl text-3xl ' + (on ? 'bg-amber-400' : 'bg-neutral-800') + '">' + e + '</button>'; }).join(''); }
      openModal(head('Accessoires') + '<p class="mb-3 text-sm text-neutral-300">Jusqu’à 6 emojis affichés sur le clip.</p><div id="ac-g" class="mb-3 grid grid-cols-4 gap-2">' + draw() + '</div><button id="ac-ok" class="' + btn + ' w-full">Enregistrer</button>');
      function bind() { $('ac-g').querySelectorAll('[data-e]').forEach(function (b) { b.onclick = function () { var e = b.dataset.e, i = sel.indexOf(e); if (i >= 0) sel.splice(i, 1); else if (sel.length < 6) sel.push(e); else toast('6 maximum'); $('ac-g').innerHTML = draw(); bind(); }; }); }
      bind();
      $('ac-ok').onclick = function () { edit({ accessories: sel }).then(function () { c.accessories = sel; closeOverlay(); paint(); toast('Accessoires enregistrés'); }).catch(fail); };
    });
    on('tb-desc', function () {
      openModal(head('Description') + '<form id="ds-f" class="flex flex-col gap-2" action="javascript:void(0)"><input id="ds-t" maxlength="120" value="' + esc(c.title || '') + '" aria-label="Titre" class="' + field + '"><textarea id="ds-d" rows="5" maxlength="2000" aria-label="Description" class="' + field + '">' + esc(c.description || '') + '</textarea><button type="button" id="ds-paste" class="' + btn2 + '">Coller</button><button class="' + btn + '">Enregistrer</button></form>');
      $('ds-paste').onclick = function () { if (!navigator.clipboard || !navigator.clipboard.readText) return toast('Collage non disponible ici'); navigator.clipboard.readText().then(function (t) { var d = $('ds-d'); d.value = (d.value ? d.value + ' ' : '') + t; }).catch(function () { toast('Collage refusé'); }); };
      $('ds-f').onsubmit = function (e) { e.preventDefault(); var t = $('ds-t').value.trim(), d = $('ds-d').value; if (!t) return toast('Le titre est requis'); edit({ title: t, description: d }).then(function () { c.title = t; c.description = d.trim(); closeOverlay(); paint(); toast('Description enregistrée'); }).catch(fail); };
    });
    on('tb-zoom', function () { closeOverlay(); setTimeout(function () { $('zoom-bar').hidden = false; zoomSet(1.5); }, 60); });
    on('tb-pc', function () { openPc(c); });
    on('tb-fs', function () {
      closeOverlay();
      setTimeout(function () {
        var el = $('phone');
        if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
        var rq = el.requestFullscreen || el.webkitRequestFullscreen;
        if (rq) rq.call(el).catch(function () { toast('Plein écran non disponible'); });
        else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
        else toast('Plein écran non disponible sur cet appareil');
      }, 80);
    });
    on('tb-vol', function () { setSound(!soundOn); closeOverlay(); toast(soundOn ? 'Son activé' : 'Son coupé'); });
    on('tb-dl', function () { var a = document.createElement('a'); a.href = '/api/clips/' + encodeURIComponent(c.id) + '/download'; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); toast('Téléchargement…'); });
    on('tb-dlset', guard(function () {
      var allow = !(c.allowDownload !== false);
      api('PATCH', '/api/clips/' + encodeURIComponent(c.id) + '/download', { allow: allow }).then(function () { c.allowDownload = allow; toolbox(); toast(allow ? 'Téléchargement autorisé' : 'Téléchargement interdit'); }).catch(fail);
    }));
    on('tb-share', function () { $('r-share').onclick(); });
    on('tb-rep', function () {
      var why = ['Contenu inapproprié', 'Spam ou arnaque', 'Harcèlement', 'Violence', 'Droits d’auteur', 'Autre'];
      openModal(head('Signaler ce clip') + '<div class="flex flex-col gap-2" id="rp-l">' + why.map(function (w, i) { return '<button data-w="' + esc(w) + '" class="flex items-center justify-between rounded-xl bg-neutral-800 p-3 text-left text-sm"><b>' + esc(w) + '</b><span></span></button>'; }).join('') + '</div><div id="rp-e" class="mt-2 min-h-[18px] text-sm text-red-400"></div><button id="rp-go" disabled class="' + btn + ' mt-2 w-full">Envoyer le signalement</button>');
      var pick = null;
      modal.querySelectorAll('[data-w]').forEach(function (b) { b.onclick = function () { pick = b.dataset.w; modal.querySelectorAll('[data-w]').forEach(function (x) { var s = x === b; x.className = 'flex items-center justify-between rounded-xl p-3 text-left text-sm ' + (s ? 'bg-amber-400 text-black' : 'bg-neutral-800'); x.lastChild.textContent = s ? '✓' : ''; }); $('rp-go').disabled = false; }; });
      $('rp-go').onclick = function () { $('rp-go').disabled = true; api('POST', '/api/clips/' + encodeURIComponent(c.id) + '/report', { reason: pick }).then(function () { closeOverlay(); toast('Merci, signalement envoyé'); }).catch(function (e) { $('rp-go').disabled = false; $('rp-e').textContent = e.message; }); };
    });
    on('tb-prof', function () {
      nav('/profile');
      var tries = 0, t = setInterval(function () { var e = $('p-edit'); if (e) { clearInterval(t); e.click(); } else if (++tries > 20) clearInterval(t); }, 150);
    });
    on('tb-priv', function () {
      if (!me) return needLogin('Connectez-vous pour choisir la confidentialité de votre profil.');
      api('PATCH', '/api/me', { private_profile: !me.settings.private_profile }).then(function (r) { me = r.user; toolbox(); toast('Profil : ' + (me.settings.private_profile ? 'Privé' : 'Public')); }).catch(fail);
    });
    bindSettingsRows(modal, toolbox);
    on('tb-out', function () { if (me) logout(); else nav('/login'); });
  }
  // ⋮ sits DIRECTLY ABOVE the T (Titre) button, same left edge, same size; follows T if the layout moves
  (function () {
    var b = $('b-tools');
    try { localStorage.removeItem('toolsPos'); } catch (e) { /* old drag position, no longer used */ }
    function dock() {
      var t = $('l-cap').getBoundingClientRect(), P = (b.offsetParent || document.body).getBoundingClientRect();
      if (!t.width) { b.style.left = ''; b.style.top = ''; return; }   // T hidden on this page: CSS spot under Home
      b.style.left = Math.round(t.left - P.left) + 'px'; b.style.top = Math.round(t.top - P.top - 40 - 8) + 'px';
    }
    dock(); addEventListener('resize', dock); setInterval(dock, 500);
    b.onclick = toolbox;
  })();
  $('b-set').onclick = settingsModal;

  // after a delete: drop the clip everywhere and go to the next one (or back to the feed when none is left)
  function afterDelete(c) {
    var nextC = L.length > 1 ? L[(idx + 1) % L.length] : null, at = idx;
    var drop = function (a) { return a.filter(function (x) { return x.id !== c.id; }); };
    feedClips = drop(feedClips); if (vlist) vlist = drop(vlist); delete seen[c.id];
    if (L !== feedClips && L !== vlist) L = feedClips;
    L = viewer && vlist ? vlist : feedClips;
    shownId = null; v.pause(); delete v.dataset.id; delete buf.dataset.id;
    if (viewer && nextC && nextC.id !== c.id) return nav('/c/' + encodeURIComponent(nextC.id), { replace: true });
    feedI = Math.min(at, Math.max(0, feedClips.length - 1)); idx = feedI;
    if (PATHN() !== '/') return nav('/', { replace: true });
    nav('/', { replace: true });
  }

  // Mode PC: a fixed 800x450 window, centered, with X; the feed video pauses and the page behind is untouched
  function openPc(c) {
    var pcv = $('pc-v'), box = $('pc-back');
    v.pause();
    openOverlay(function () { pcv.pause(); pcv.removeAttribute('src'); pcv.load(); box.hidden = true; });
    $('pc-t').textContent = label(c); pcv.src = srcOf(c); pcv.muted = !soundOn; applyVol(); box.hidden = false;
    var p = pcv.play(); if (p && p.catch) p.catch(function () { /* user presses play */ });
    modal.hidden = true; back.hidden = true; modal.innerHTML = '';
  }
  $('pc-x').onclick = closeOverlay;
  $('pc-back').addEventListener('click', function (e) { if (e.target === this) closeOverlay(); });
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement) { v.controls = false; buf.controls = false; } });
  document.addEventListener('webkitfullscreenchange', function () { if (!document.webkitFullscreenElement) { v.controls = false; buf.controls = false; } });

  /* ================= upload sheet (studio itself lives in upload.js) ================= */
  var sheet = $('up-sheet');
  function openUpload() {
    // already signed in: straight to the studio. Not loaded yet (slow start): refresh silently first, ask to log in only if the server says so
    if (!me && tokGet()) return refreshMe().then(function () { if (me) openUpload(); else needLogin('Connectez-vous pour publier un clip.'); });
    if (!me) return needLogin('Connectez-vous pour publier un clip.');
    openOverlay(function () { sheet.hidden = true; }); sheet.hidden = false;
  }
  $('up-open').onclick = openUpload;
  $('up-close').onclick = closeOverlay;
  // Retour: from the edit step back to the file picker (gallery); from the picker, close the sheet
  // in-app gallery: my published clips, with ‹ Retour (back to Importer) and ✕
  $('up-gal').onclick = function () {
    if (!me) return needLogin('Connectez-vous pour voir votre galerie.');
    openModal('<div class="mb-3 flex items-center justify-between gap-2"><button id="gl-back" class="' + btn2 + ' !py-2">‹ Retour</button><h2 class="flex-1 text-center text-lg font-extrabold">Ma galerie</h2><button data-x aria-label="Fermer" class="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800 text-lg">✕</button></div><div id="gl-body" class="text-sm text-neutral-400">Chargement…</div>');
    $('gl-back').onclick = openUpload;
    api('GET', '/api/users/' + encodeURIComponent(me.handle) + '/clips').then(function (r) {
      var b = $('gl-body'); if (!b) return;
      b.innerHTML = r.clips.length ? '<div class="grid grid-cols-3 gap-2">' + r.clips.map(tile).join('') + '</div>' : 'Aucun clip publié pour le moment.';
      bindClips(b, r.clips); icons();
    }).catch(function (e) { var b = $('gl-body'); if (b) b.textContent = e.message; });
  };
  $('up-back').onclick = function () {
    if ($('st-2').hidden) return closeOverlay();
    try { $('st-prev').pause(); } catch (e) { /* ignore */ }
    $('st-2').hidden = true; $('st-1').hidden = false; $('up-title').textContent = 'Nouveau clip'; $('up-file').value = '';
    $('up-result').innerHTML = ''; $('up-label').textContent = ''; $('up-bar').style.width = '0';
  };

  /* ================= pages ================= */
  var TAB = { '/': 'home', '/search': 'search', '/clips': 'clips', '/messages': 'messages' };
  function tabOf(p) { if (TAB[p]) return TAB[p]; if (/^\/messages\//.test(p)) return 'messages'; if (/^\/(profile|profil|settings|login|signup|u\/)/.test(p)) return 'profile'; return 'home'; }
  var pageHead = function (t, extra) { return '<div class="mb-3 flex items-center justify-between"><h2 class="text-lg font-extrabold">' + t + '</h2>' + (extra || '') + '</div>'; };
  var msg = function (t) { return '<div class="text-sm text-neutral-400">' + t + '</div>'; };
  function thumb(c, cls) { return c.poster ? '<img src="' + esc(c.poster) + '" loading="lazy" alt="" class="' + cls + '">' : '<video src="' + esc(c.url360 || c.url) + '#t=0.1" preload="metadata" muted playsinline class="' + cls + '"></video>'; }
  function tile(c) { return '<button data-id="' + esc(c.id) + '" class="relative aspect-[9/14] overflow-hidden rounded-xl bg-neutral-800 text-left">' + thumb(c, 'h-full w-full object-cover') + '<div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 p-2 text-[11px] leading-tight"><div class="line-clamp-2 font-semibold">' + esc(label(c)) + '</div><div class="mt-0.5 text-white/70">♥ ' + (c.likes || 0) + '</div></div></button>'; }
  function row(c) { return '<button data-id="' + esc(c.id) + '" class="mb-2 flex w-full items-center gap-3 rounded-xl bg-neutral-900 p-2 text-left"><div class="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-neutral-800">' + thumb(c, 'h-full w-full object-cover') + '</div><div class="min-w-0 text-sm"><div class="line-clamp-1 font-bold">' + esc(label(c)) + '</div>' + (titleOf(c) && capOf(c) ? '<div class="line-clamp-1 text-xs text-neutral-300">' + esc(capOf(c)) + '</div>' : '') + '<div class="text-xs text-neutral-400">@' + esc(c.author.handle) + ' · ' + esc(c.author.name) + '</div></div></button>'; }
  function bindClips(root, list) { root.querySelectorAll('[data-id]').forEach(function (b) { b.onclick = function () { openViewer(list, b.dataset.id); }; }); }
  function setPage(html) { page.innerHTML = html; page.scrollTop = 0; icons(); }
  function openViewer(list, id) { vlist = list.slice(); nav('/c/' + encodeURIComponent(id)); }
  function authCta(t) { setPage(pageHead(t) + '<div class="rounded-2xl bg-neutral-900 p-5 text-center"><p class="mb-4 text-sm text-neutral-300">Connectez-vous pour accéder à cette page.</p><div class="flex gap-2"><button id="cta-in" class="' + btn + ' flex-1">Se connecter</button><button id="cta-up" class="' + btn2 + ' flex-1">Créer un compte</button></div></div>'); var n = encodeURIComponent(PATHN()); $('cta-in').onclick = function () { nav('/login?next=' + n); }; $('cta-up').onclick = function () { nav('/signup?next=' + n); }; }

  /* ---- search: one bar, title + caption + tags + creator, accent-insensitive, live ---- */
  var sT, sSeq = 0, qEl = $('q');
  function searchPage(q) {
    q = q.trim();
    var my = ++sSeq;
    if (!q) {
      setPage(pageHead('Recherche') + msg('Saisissez un titre, un #tag ou le nom d’un créateur.') + '<h3 class="mb-2 mt-5 text-sm font-bold text-neutral-300">Clips récents</h3><div id="sr"></div>');
      fetch('/api/clips?limit=6', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { if (my !== sSeq) return; var el = $('sr'); if (!el) return; el.innerHTML = (d.clips || []).map(row).join('') || msg('Aucun clip pour le moment.'); bindClips(el, d.clips || []); });
      return;
    }
    setPage(pageHead('Recherche') + msg('Recherche…'));
    fetch('/api/clips?limit=30&q=' + encodeURIComponent(q), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (my !== sSeq) return; var list = d.clips || [];
      if (list.length) { setPage(pageHead('Résultats (' + list.length + (d.next ? '+' : '') + ')') + list.map(row).join('') + '<button id="sr-all" class="' + btn2 + ' mt-2 w-full">Voir tous les clips</button>'); bindClips(page, list); $('sr-all').onclick = seeAll; return; }
      setPage(pageHead('Aucun résultat') + msg('Aucun clip ne correspond à « ' + esc(q) + ' ». Essayez un autre mot, un #tag ou un créateur.') + '<h3 class="mb-2 mt-5 text-sm font-bold text-neutral-300">Suggestions</h3><div id="sr"></div><button id="sr-all" class="' + btn + ' mt-2 w-full">Voir tous</button>');
      $('sr-all').onclick = seeAll;
      fetch('/api/clips?limit=6', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) { if (my !== sSeq) return; var el = $('sr'); if (!el) return; el.innerHTML = (s.clips || []).map(row).join('') || msg('Aucune suggestion.'); bindClips(el, s.clips || []); });
    }).catch(function () { if (my === sSeq) setPage(pageHead('Recherche') + msg('Recherche indisponible. Réessayez.')); });
  }
  function seeAll() { qEl.value = ''; $('q-clear').hidden = true; nav('/clips'); }
  function syncSearchUi() { $('q-clear').hidden = !qEl.value; }
  qEl.addEventListener('input', function () {
    syncSearchUi(); clearTimeout(sT);
    sT = setTimeout(function () {
      var q = qEl.value.trim(), url = '/search' + (q ? '?q=' + encodeURIComponent(q) : '');
      if (PATHN() === '/search') { history.replaceState(history.state, '', U(url)); searchPage(q); } else nav(url);
    }, 200);
  });
  qEl.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') qEl.blur(); });
  $('search-form').onsubmit = function (e) { e.preventDefault(); clearTimeout(sT); var q = qEl.value.trim(), url = '/search' + (q ? '?q=' + encodeURIComponent(q) : ''); if (PATHN() === '/search') { history.replaceState(history.state, '', U(url)); searchPage(q); } else nav(url); qEl.blur(); };
  $('q-clear').onclick = function () { qEl.value = ''; syncSearchUi(); if (PATHN() === '/search') { history.replaceState(history.state, '', U('/search')); searchPage(''); } qEl.focus(); };

  /* ---- clips grid ---- */
  function clipsPage() {
    function draw() {
      setPage(pageHead('Clips') + (feedClips.length ? '<div class="grid grid-cols-3 gap-2">' + feedClips.map(tile).join('') + '</div>' : msg('Aucun clip pour le moment.')) + (feedNext ? '<button id="pg-more" class="' + btn2 + ' mt-4 w-full">Charger plus</button>' : ''));
      bindClips(page, feedClips);
      var m = $('pg-more'); if (m) m.onclick = function () { m.disabled = true; fetch('/api/clips?limit=12&before=' + encodeURIComponent(feedNext), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { addClips(d.clips || []); feedNext = d.next; var y = page.scrollTop; draw(); page.scrollTop = y; }).catch(function () { m.disabled = false; }); };
    }
    draw();
  }

  /* ---- messages ---- */
  function messagesPage() {
    setPage(pageHead('Messages') + msg('Chargement…'));
    api('GET', '/api/messages').then(function (r) {
      var cs = r.conversations;
      setPage(pageHead('Messages') + (cs.length ? cs.map(function (m) { return '<button data-h="' + esc(m.handle) + '" class="mb-2 flex w-full items-center gap-3 rounded-xl bg-neutral-900 p-3 text-left"><span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400 font-extrabold text-black">' + esc(initials(m.name)) + '</span><span class="min-w-0 flex-1 text-sm"><span class="flex justify-between"><b class="truncate">' + esc(m.name) + '</b><span class="text-xs text-neutral-400">' + ago(m.created_at) + '</span></span><span class="block truncate text-neutral-300">' + (m.mine ? 'Vous : ' : '') + esc(m.body) + '</span></span>' + (m.unread ? '<span class="rounded-full bg-red-500 px-2 text-xs font-bold">' + m.unread + '</span>' : '') + '</button>'; }).join('') : msg('Aucun message. Ouvrez un clip puis utilisez Message pour écrire à un créateur.')));
      page.querySelectorAll('[data-h]').forEach(function (b) { b.onclick = function () { nav('/messages/' + encodeURIComponent(b.dataset.h)); }; });
    }).catch(fail);
  }
  function threadPage(h) {
    setPage(pageHead('Conversation') + msg('Chargement…'));
    api('GET', '/api/messages?with=' + encodeURIComponent(h)).then(function (r) {
      setPage(pageHead(esc(r.with.name) + ' <span class="text-sm font-normal text-neutral-400">@' + esc(r.with.handle) + '</span>') + '<div id="th" class="mb-3 flex flex-col gap-2 text-sm">' + (r.messages.length ? r.messages.map(bubble).join('') : msg('Aucun message. Écrivez le premier.')) + '</div><form id="th-f" class="sticky bottom-0 flex gap-2 bg-neutral-950 pt-2" action="javascript:void(0)"><input id="th-b" maxlength="1000" autocomplete="off" placeholder="Votre message…" class="' + field + '"><button class="' + btn + '">Envoyer</button></form>');
      page.scrollTop = page.scrollHeight; refreshMe();
      $('th-f').onsubmit = function (e) { e.preventDefault(); var b = $('th-b').value.trim(); if (!b) return; api('POST', '/api/messages', { to: h, body: b }).then(function (m) { var t = $('th'); if (!t.querySelector('.rounded-2xl')) t.innerHTML = ''; t.insertAdjacentHTML('beforeend', bubble({ mine: true, body: m.body })); $('th-b').value = ''; page.scrollTop = page.scrollHeight; }).catch(fail); };
    }).catch(function (e) { setPage(pageHead('Conversation') + msg(esc(e.message))); });
  }

  /* ---- profile (me / others): header, edit, gallery [Photos | Vidéos | Clips] ---- */
  function statBox(n, l, id) { return '<button ' + (id ? 'data-tabgo="' + id + '"' : '') + ' class="rounded-xl bg-neutral-900 py-2 text-center"><div class="text-xl font-extrabold">' + n + '</div><div class="text-xs text-neutral-400">' + l + '</div></button>'; }
  var EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
  var upXhr = null, upCancel = false;
  // file -> R2 (presigned PUT) -> returns the object key
  function putFile(slot, file, onProgress) {
    var ext = EXT[file.type] || ((/\.([a-z0-9]+)$/i.exec(file.name) || [])[1] || '').toLowerCase().replace('jpeg', 'jpg');
    return api('POST', '/api/me/upload-url', { slot: slot, ext: ext, size: file.size }).then(function (u) {
      return new Promise(function (ok, ko) {
        var x = upXhr = new XMLHttpRequest(); x.open('PUT', u.url);
        x.setRequestHeader('content-type', u.contentType); if (u.cacheControl) x.setRequestHeader('cache-control', u.cacheControl);
        if (onProgress) x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
        x.onload = function () { x.status < 300 ? ok(u.key) : ko(new Error('Envoi vers R2 refusé (' + x.status + ')')); };
        x.onerror = function () { ko(new Error('Envoi impossible : vérifiez votre connexion')); }; x.onabort = function () { ko(new Error('Envoi annulé')); };
        x.send(file);
      });
    });
  }
  var PRIV = { public: 'Public', followers: 'Abonnés uniquement', private: 'Privé' };
  var lockIcon = function (p) { return p === 'private' ? '<span class="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70" title="Privé"><i data-lucide="lock" class="h-3.5 w-3.5"></i></span>' : p === 'followers' ? '<span class="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70" title="Abonnés uniquement"><i data-lucide="users" class="h-3.5 w-3.5"></i></span>' : ''; };
  var dots = function (kind, id) { return '<span data-dots="' + id + '" data-kind="' + kind + '" role="button" aria-label="Options" class="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/70"><i data-lucide="ellipsis-vertical" class="h-4 w-4"></i></span>'; };
  // 3-dot menu: Public / Abonnés uniquement / Privé (saved in the database)
  function privacyMenu(kind, id, cur, done) {
    openModal(head('Visibilité') + '<div class="flex flex-col gap-2">' + ['public', 'followers', 'private'].map(function (k) { return '<button data-pv="' + k + '" class="flex w-full items-center justify-between rounded-xl p-3 text-left text-sm ' + (k === cur ? 'bg-amber-400 text-black' : 'bg-neutral-800') + '"><b>' + (k === 'public' ? 'Rendre public' : k === 'private' ? 'Rendre privé' : 'Abonnés uniquement') + '</b><span>' + (k === cur ? '✓' : '') + '</span></button>'; }).join('') + '</div>');
    modal.querySelectorAll('[data-pv]').forEach(function (b) { b.onclick = function () {
      api('PATCH', (kind === 'clip' ? '/api/clips/' : '/api/me/media/') + encodeURIComponent(id) + (kind === 'clip' ? '/privacy' : ''), { privacy: b.dataset.pv }).then(function (r) { toast('Visibilité : ' + PRIV[r.privacy]); closeOverlay(); setTimeout(function () { done(r.privacy); }, 0); }).catch(fail);
    }; });
  }
  var ava = function (u, size, cls) { return '<div class="' + (cls || '') + ' flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gold font-extrabold text-black" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size / 3) + 'px">' + (u.avatar ? '<img src="' + esc(u.avatar) + '" alt="" class="h-full w-full object-cover">' : esc(initials(u.name))) + '</div>'; };
  function profilePage(handle) {
    var mine = !handle || (me && handle === me.handle);
    if (mine && !me) { authCta('Profil'); page.insertAdjacentHTML('beforeend', '<button id="cta-set" class="' + btn2 + ' mt-3 w-full">Paramètres</button>'); $('cta-set').onclick = function () { nav('/settings'); }; return; }
    var h = mine ? me.handle : handle;
    setPage(pageHead('Profil') + msg('Chargement…'));
    api('GET', '/api/users/' + encodeURIComponent(h)).then(function (u) {
      if (u.private) {   // private profile, visitor not accepted: avatar + name + request button, nothing else
        setPage(pageHead(esc(u.name)) + '<div class="flex flex-col items-center rounded-2xl bg-neutral-900 p-6 text-center">' + ava(u, 88) + '<div class="mt-3 text-lg font-extrabold">' + esc(u.name) + '</div><div class="text-xs text-neutral-400">@' + esc(u.handle) + '</div><div class="mt-4 text-sm text-neutral-300"><i data-lucide="lock" class="mr-1 inline h-4 w-4"></i>Ce profil est privé</div><button id="p-req" class="' + btn + ' mt-4"></button></div>');
        var rq = u.requested, rb = $('p-req'), pr = function () { rb.textContent = rq ? 'Demande envoyée (annuler)' : 'Demande de suivi'; }; pr();
        rb.onclick = guard(function () { var on = !rq; api('PUT', '/api/users/' + encodeURIComponent(u.handle) + '/follow', { on: on }).then(function (r) { rq = on && r.status === 'pending'; setFollowEverywhere(u.handle, on, r.status); if (r.status === 'accepted') return profilePage(u.handle); pr(); }).catch(fail); });
        return;
      }
      var tabs = mine ? [['photos', 'Photos'], ['videos', 'Vidéos'], ['clips', 'Clips'], ['saved', 'Enregistrés']] : [['photos', 'Photos'], ['videos', 'Vidéos'], ['clips', 'Clips']];
      var empty = mine && !u.bio && !u.avatar && !u.cover;
      var shortLink = u.link ? u.link.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
      setPage(pageHead(mine ? 'Mon profil' : esc(u.name), mine ? '<button id="p-set" aria-label="Paramètres" class="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800"><i data-lucide="settings" class="h-5 w-5"></i></button>' : '') +
        '<div class="mb-4 overflow-hidden rounded-2xl bg-neutral-900">' +
        '<div class="h-28 w-full bg-gradient-to-br from-amber-500/40 to-neutral-800">' + (u.cover ? '<img src="' + esc(u.cover) + '" alt="" class="h-full w-full object-cover">' : '') + '</div>' +
        '<div class="px-4 pb-4"><div class="-mt-8 flex items-end justify-between">' + ava(u, 72, 'border-4 border-neutral-900') + (mine ? '<button id="p-edit" class="' + btn2 + ' !py-2">Modifier</button>' : '') + '</div>' +
        '<div class="mt-2 truncate text-lg font-extrabold">' + esc(u.name) + '</div><div class="text-xs text-neutral-400">@' + esc(u.handle) + ' · ' + esc(u.citizenId) + '</div>' +
        (u.bio ? '<p class="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-200">' + esc(u.bio) + '</p>' : '') +
        ((u.city || u.link) ? '<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400">' + (u.city ? '<span>📍 ' + esc(u.city) + '</span>' : '') + (u.link ? '<a href="' + esc(u.link) + '" target="_blank" rel="noopener nofollow" class="text-amber-400">🔗 ' + esc(shortLink) + '</a>' : '') + '</div>' : '') +
        (mine ? '<div id="p-req-box"></div>' : '') + (u.privateProfile && mine ? '<div class="mt-2 text-xs text-neutral-400"><i data-lucide="lock" class="mr-1 inline h-3 w-3"></i>Profil privé</div>' : '') + (empty ? '<div class="mt-3 flex flex-wrap gap-2"><button id="p-addph" class="' + btn + ' !py-2">Ajouter une photo</button><button id="p-addbio" class="' + btn2 + ' !py-2">Ajouter une bio</button></div>' : '') +
        '<div class="mt-4 grid grid-cols-3 gap-2">' + statBox(u.clips, 'Clips', 'clips') + statBox('<span id="p-fol">' + u.followers + '</span>', 'Abonnés', mine ? 'followers' : '') + statBox(u.following, 'Abonnements') + '</div>' +
        (mine ? '<div class="mt-3 flex gap-2"><button id="p-out" class="' + btn2 + ' flex-1">Se déconnecter</button><button id="p-up" class="' + btn + ' flex-1">Importer un clip</button></div>'
          : '<div class="mt-3 flex gap-2"><button id="p-follow" class="' + btn + ' flex-1"></button><button id="p-msg" class="' + btn2 + ' flex-1">Message</button></div>') + '</div></div>' +
        '<div id="p-tabs" class="mb-3 flex gap-1.5">' + tabs.map(function (t, k) { return '<button data-t="' + t[0] + '" class="tabbtn flex-1 rounded-full border px-2 py-2 text-xs font-bold ' + (k ? 'border-neutral-700 text-neutral-300' : 'border-amber-400 bg-amber-400 text-black') + '">' + t[1] + '</button>'; }).join('') + '</div><div id="p-body"></div>');
      if (mine) {
        $('p-set').onclick = function () { nav('/settings'); }; $('p-out').onclick = logout; $('p-up').onclick = openUpload;
        $('p-edit').onclick = function () { editProfile(u); };
        api('GET', '/api/me/follow-requests').then(function (r) {
          var box = $('p-req-box'); if (!box || !r.requests.length) return;
          box.innerHTML = '<div class="mt-3 rounded-xl bg-neutral-800 p-3 text-sm"><div class="mb-2 font-bold">Demandes de suivi (' + r.requests.length + ')</div>' + r.requests.map(function (q) { return '<div class="mb-2 flex items-center gap-2" data-q="' + esc(q.handle) + '"><span class="min-w-0 flex-1 truncate"><b>' + esc(q.name) + '</b> <span class="text-xs text-neutral-400">@' + esc(q.handle) + '</span></span><button data-a="1" class="rounded-full bg-gold px-3 py-1.5 text-xs font-extrabold text-black">Accepter</button><button data-a="0" class="rounded-full border border-neutral-600 px-3 py-1.5 text-xs font-bold">Refuser</button></div>'; }).join('') + '</div>';
          box.querySelectorAll('[data-a]').forEach(function (b) { b.onclick = function () { var row = b.closest('[data-q]'); api('POST', '/api/me/follow-requests/' + encodeURIComponent(row.dataset.q), { accept: b.dataset.a === '1' }).then(function () { row.remove(); if (!box.querySelector('[data-q]')) box.innerHTML = ''; if (b.dataset.a === '1') $('p-fol').textContent = (+$('p-fol').textContent || 0) + 1; }).catch(fail); }; });
        }).catch(function () { /* requests load on next visit */ });
        if (empty) { $('p-addph').onclick = function () { editProfile(u, 'avatar'); }; $('p-addbio').onclick = function () { editProfile(u, 'bio'); }; }
      } else {
        var fol = u.following_by_me, req = u.requested, fb = $('p-follow');
        var pf = function () { fb.textContent = fol ? 'Abonné ✓' : req ? 'Demandé' : 'Suivre'; }; pf();
        fb.onclick = guard(function () { var on = !(fol || req); api('PUT', '/api/users/' + encodeURIComponent(u.handle) + '/follow', { on: on }).then(function (r) { fol = on && r.status !== 'pending'; req = on && r.status === 'pending'; $('p-fol').textContent = r.followers; setFollowEverywhere(u.handle, on, r.status); pf(); }).catch(fail); });
        $('p-msg').onclick = (function () { if (!u.allowMessages) return toast('Ce créateur n’accepte pas les messages'); nav('/messages/' + encodeURIComponent(u.handle)); });
      }
      function tab(t) {
        page.querySelectorAll('.tabbtn').forEach(function (b) { var on = b.dataset.t === t; b.className = 'tabbtn flex-1 rounded-full border px-2 py-2 text-xs font-bold ' + (on ? 'border-amber-400 bg-amber-400 text-black' : 'border-neutral-700 text-neutral-300'); });
        var body = $('p-body'); body.innerHTML = msg('Chargement…');
        if (t === 'photos' || t === 'videos') return gallery(body, u, t === 'videos' ? 'video' : 'photo', mine);
        var url = t === 'clips' ? '/api/users/' + encodeURIComponent(h) + '/clips' : t === 'saved' ? '/api/me/saved' : '/api/users/' + encodeURIComponent(h) + '/followers';
        api('GET', url).then(function (r) {
          if (r.private) { body.innerHTML = msg('Ce profil est privé.'); return; }
          if (t === 'followers') { body.innerHTML = r.followers.length ? r.followers.map(function (f) { return '<button data-u="' + esc(f.handle) + '" class="mb-2 flex w-full items-center gap-3 rounded-xl bg-neutral-900 p-3 text-left text-sm"><span class="flex h-9 w-9 items-center justify-center rounded-full bg-amber-400 font-extrabold text-black">' + esc(initials(f.name)) + '</span><span><b>' + esc(f.name) + '</b><br><span class="text-xs text-neutral-400">@' + esc(f.handle) + '</span></span></button>'; }).join('') : msg('Aucun abonné pour le moment.'); body.querySelectorAll('[data-u]').forEach(function (b) { b.onclick = function () { nav('/u/' + encodeURIComponent(b.dataset.u)); }; }); return; }
          body.innerHTML = r.clips.length ? '<div class="grid grid-cols-3 gap-2">' + r.clips.map(function (c) { return mine && t === 'clips' ? '<div class="relative">' + tile(c).replace('</button>', lockIcon(c.privacy) + '</button>') + dots('clip', c.id) + '</div>' : tile(c); }).join('') + '</div>' : msg(t === 'saved' ? 'Rien d’enregistré pour le moment. Touchez le marque-page sous un clip.' : (mine ? 'Vous n’avez encore publié aucun clip.' : 'Aucun clip publié.'));
          bindClips(body, r.clips); icons();
          body.querySelectorAll('[data-dots]').forEach(function (d) { d.onclick = function (e) { e.stopPropagation(); var c = r.clips.filter(function (x) { return x.id === d.dataset.dots; })[0]; privacyMenu('clip', c.id, c.privacy, function () { tab(t); }); }; });
        }).catch(function (e) { body.textContent = e.message; });
      }
      page.querySelectorAll('.tabbtn').forEach(function (b) { b.onclick = function () { tab(b.dataset.t); }; });
      page.querySelectorAll('[data-tabgo]').forEach(function (b) { b.onclick = function () { tab(b.dataset.tabgo); }; });
      tab('photos');
    }).catch(function (e) { setPage(pageHead('Profil') + msg(esc(e.message))); });
  }

  // gallery tab: photos or videos stored in R2; the owner can add (gallery or camera) and delete
  function gallery(body, u, kind, mine) {
    var photo = kind === 'photo';
    function draw(items) {
      body.innerHTML = '<div class="sticky -top-4 z-10 -mx-4 mb-3 flex items-center justify-between bg-neutral-950 px-4 py-2"><button id="g-back" class="' + btn2 + ' !py-2">‹ Retour</button><button id="g-x" aria-label="Fermer" class="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800 text-lg">✕</button></div>' + (mine ? '<label for="g-pv" class="text-xs font-bold text-neutral-300">Visibilité des nouveaux ajouts</label><select id="g-pv" class="' + inp + ' mb-2 mt-1"><option value="public">Public</option><option value="followers">Abonnés uniquement</option><option value="private">Privé</option></select><label class="' + btn + ' mb-3 flex cursor-pointer items-center justify-center gap-2 text-center">' + (photo ? 'Ajouter une photo' : 'Ajouter une vidéo') + '<input id="g-file" type="file" class="sr-only" multiple accept="' + (photo ? 'image/jpeg,image/png,image/webp,image/gif' : 'video/mp4,video/quicktime,video/webm') + '"></label><div id="g-st" class="mb-2 text-xs text-neutral-400"></div>' : '') +
        (items.length ? '<div class="grid grid-cols-3 gap-2">' + items.map(function (m) { return '<div class="relative aspect-square"><button data-m="' + m.id + '" class="relative h-full w-full overflow-hidden rounded-xl bg-neutral-800">' + (photo ? '<img src="' + esc(m.url) + '" loading="lazy" alt="" class="h-full w-full object-cover">' : '<video src="' + esc(m.url) + '#t=0.1" preload="metadata" muted playsinline class="h-full w-full object-cover"></video><span class="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 text-[10px]">▶</span>') + lockIcon(m.privacy) + '</button>' + (mine ? dots('media', m.id) : '') + '</div>'; }).join('') + '</div>'
          : (mine ? '<div class="rounded-2xl bg-neutral-900 p-5 text-center text-sm text-neutral-300">' + (photo ? 'Aucune photo pour le moment. Ajoutez votre première photo.' : 'Aucune vidéo pour le moment. Ajoutez votre première vidéo.') + '</div>' : msg(photo ? 'Aucune photo.' : 'Aucune vidéo.')));
      body.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { var m = items.filter(function (x) { return String(x.id) === b.dataset.m; })[0]; view(m); }; });
      $('g-back').onclick = goBack; $('g-x').onclick = goBack;
      icons();
      body.querySelectorAll('[data-dots]').forEach(function (d) { d.onclick = function (e) { e.stopPropagation(); var m = items.filter(function (x) { return String(x.id) === d.dataset.dots; })[0]; privacyMenu('media', m.id, m.privacy, function (pv) { m.privacy = pv; draw(items); }); }; });
      var f = $('g-file'); if (f) f.onchange = function () {
        var files = Array.prototype.slice.call(f.files || []); f.value = ''; if (!files.length) return;
        var st = $('g-st'), n = 0, bad = 0; upCancel = false;
        st.innerHTML = '<button id="g-cancel" class="' + btn2 + ' !py-1.5 text-xs">Annuler l’envoi</button> <span id="g-pr"></span>';
        $('g-cancel').onclick = function () { upCancel = true; if (upXhr) upXhr.abort(); };
        files.reduce(function (p, file, i) {
          return p.then(function () {
            if (upCancel) return;
            return putFile(photo ? 'photo' : 'video', file, function (r) { var pr = $('g-pr'); if (pr) pr.textContent = 'Envoi ' + (i + 1) + '/' + files.length + ' : ' + Math.round(r * 100) + ' %'; })
              .then(function (key) { return api('POST', '/api/me/media', { kind: kind, key: key, privacy: $('g-pv').value }); })
              .then(function (r) { if (r.media) items.unshift(r.media); n++; })
              .catch(function (e) { bad++; if (!upCancel) toast(e.message); });
          });
        }, Promise.resolve()).then(function () { if (upCancel) { toast('Envoi annulé'); return goBack(); } if ($('g-file')) { draw(items); if (n) toast(n + (photo ? ' photo(s) ajoutée(s)' : ' vidéo(s) ajoutée(s)')); } });
      };
    }
    function view(m) {
      if (!m) return;
      openModal(head(photo ? 'Photo' : 'Vidéo') + (photo ? '<img src="' + esc(m.url) + '" alt="" class="max-h-[60vh] w-full rounded-xl object-contain">' : '<video src="' + esc(m.url) + '" controls autoplay playsinline class="max-h-[60vh] w-full rounded-xl bg-black"></video>') + (mine ? '<button id="g-del" class="mt-3 w-full rounded-full border border-red-500 px-5 py-2.5 text-sm font-bold text-red-400">Supprimer</button>' : ''));
      if (mine) $('g-del').onclick = function () { api('DELETE', '/api/me/media/' + m.id).then(function () { var k = items.indexOf(m); if (k >= 0) items.splice(k, 1); closeOverlay(); setTimeout(function () { draw(items); }, 0); }).catch(fail); };
    }
    var items = [];
    api('GET', '/api/users/' + encodeURIComponent(u.handle) + '/media?kind=' + kind).then(function (r) {
      if (r.private) { body.innerHTML = msg('Ce profil est privé.'); return; }
      items = r.items; draw(items);
    }).catch(function (e) { body.textContent = e.message; });
  }

  // edit form (in the page, so the keyboard never covers a sheet): name, @username, bio, city, link, avatar, cover
  function editProfile(u, focusId) {
    var avatarFile = null, coverFile = null, fld = function (id, label, val, extra) { return '<label for="' + id + '" class="text-xs font-bold text-neutral-300">' + label + '</label>' + extra.replace('{v}', esc(val)); };
    setPage(pageHead('Modifier le profil') +
      '<form id="ed" class="flex flex-col gap-3" action="javascript:void(0)" novalidate>' +
      '<div class="text-xs font-bold text-neutral-300">Photo de couverture</div><label class="relative block h-28 cursor-pointer overflow-hidden rounded-xl bg-neutral-800"><img id="ed-cv" alt="" class="h-full w-full object-cover ' + (u.cover ? '' : 'hidden') + '" ' + (u.cover ? 'src="' + esc(u.cover) + '"' : '') + '><span class="absolute inset-0 flex items-center justify-center bg-black/30 text-sm font-bold">Changer la couverture</span><input id="ed-cvf" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only"></label>' +
      '<div class="text-xs font-bold text-neutral-300">Photo de profil</div><label class="flex cursor-pointer items-center gap-3"><span id="ed-av" class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gold text-xl font-extrabold text-black">' + (u.avatar ? '<img src="' + esc(u.avatar) + '" alt="" class="h-full w-full object-cover">' : esc(initials(u.name))) + '</span><span class="' + btn2 + '">Changer la photo</span><input id="ed-avf" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only"></label>' +
      fld('ed-n', 'Nom', u.name, '<input id="ed-n" name="name" type="text" autocomplete="name" enterkeyhint="next" maxlength="40" value="{v}" class="' + inp + '">') +
      fld('ed-u', 'Nom d’utilisateur', u.handle, '<input id="ed-u" name="username" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" maxlength="24" value="{v}" class="' + inp + '">') +
      fld('ed-b', 'Bio', u.bio || '', '<textarea id="ed-b" name="bio" rows="3" maxlength="300" enterkeyhint="enter" placeholder="Parlez de vous…" class="' + inp + '">{v}</textarea>') +
      fld('ed-c', 'Ville', u.city || '', '<input id="ed-c" name="city" type="text" autocomplete="address-level2" enterkeyhint="next" maxlength="60" value="{v}" class="' + inp + '">') +
      fld('ed-l', 'Lien', u.link || '', '<input id="ed-l" name="link" type="url" inputmode="url" autocomplete="url" autocapitalize="none" enterkeyhint="done" maxlength="200" placeholder="https://…" value="{v}" class="' + inp + '">') +
      '<div id="ed-err" role="alert" class="min-h-[18px] text-sm text-red-400"></div><div class="flex gap-2"><button type="button" id="ed-x" class="' + btn2 + ' flex-1">Annuler</button><button id="ed-go" class="' + btn + ' flex-1">Enregistrer</button></div></form>');
    function pick(inpId, fn) { $(inpId).onchange = function () { var f = this.files && this.files[0]; if (!f) return; fn(f, URL.createObjectURL(f)); }; }
    pick('ed-avf', function (f, url) { avatarFile = f; $('ed-av').innerHTML = '<img src="' + url + '" alt="" class="h-full w-full object-cover">'; });
    pick('ed-cvf', function (f, url) { coverFile = f; var i = $('ed-cv'); i.src = url; i.classList.remove('hidden'); });
    $('ed-x').onclick = function () { profilePage(); };
    $('ed').onsubmit = function (e) {
      e.preventDefault(); var go = $('ed-go'), err = $('ed-err'); err.textContent = ''; go.disabled = true; go.textContent = 'Enregistrement…';
      var body = { display_name: $('ed-n').value, username: $('ed-u').value, bio: $('ed-b').value, city: $('ed-c').value, link: $('ed-l').value };
      var up = function (slot, file, k) { return file ? putFile(slot, file).then(function (key) { body[k] = key; }) : Promise.resolve(); };
      up('avatar', avatarFile, 'avatar_key').then(function () { return up('cover', coverFile, 'cover_key'); }).then(function () { return api('PATCH', '/api/me', body); })
        .then(function (r) { me = r.user; paintEq(); toast('Profil enregistré'); profilePage(); })
        .catch(function (x) { err.textContent = x.message; go.disabled = false; go.textContent = 'Enregistrer'; });
    };
    if (focusId === 'bio') { $('ed-b').focus(); } else if (focusId === 'avatar') { try { $('ed-avf').click(); } catch (x) { /* user taps */ } }
  }
  function logout() {
    api('POST', '/api/auth/logout').catch(function () { /* cookie cleared anyway */ }).then(function () { tokSet(''); me = null; unread = 0; badge(); return reloadFeed(); }).then(function () { nav('/login', { replace: true }); });
  }

  /* ---- auth ---- */
  function authPage(kind) {
    var signup = kind === 'signup', next = safeNext(new URLSearchParams(location.search).get('next'));
    var alt = '/' + (signup ? 'login' : 'signup') + (next ? '?next=' + encodeURIComponent(next) : '');
    setPage(pageHead(signup ? 'Créer un compte' : 'Connexion') + '<form id="au" class="flex flex-col gap-3" action="javascript:void(0)" novalidate>' +
      (signup ? '<label for="au-n" class="text-xs font-bold text-neutral-300">Nom complet</label><input id="au-n" name="name" type="text" inputmode="text" autocomplete="name" autocapitalize="words" enterkeyhint="next" maxlength="40" placeholder="Ex: El Qaisy Abdelmalik" class="' + inp + ' font-normal"><div id="au-n-h" class="min-h-[16px] text-xs text-neutral-400"></div>' +
        '<label for="au-u" class="text-xs font-bold text-neutral-300">Nom d’utilisateur @</label><input id="au-u" name="username" type="text" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" maxlength="24" placeholder="ex: el_qaisy" class="' + inp + ' font-normal"><div id="au-u-h" class="min-h-[16px] text-xs text-neutral-400">Lettres minuscules, chiffres, _ et . (3 à 24)</div>' : '') +
      '<label for="au-e" class="text-xs font-bold text-neutral-300">E-mail</label><input id="au-e" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="vous@exemple.com" class="' + inp + ' font-normal">' +
      '<label for="au-p" class="text-xs font-bold text-neutral-300">Mot de passe</label><div class="relative"><input id="au-p" name="password" type="password" inputmode="text" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="' + (signup ? '8 caractères minimum' : 'Votre mot de passe') + '" class="' + inp + ' pr-12 font-normal"><button type="button" id="au-eye" aria-label="Afficher le mot de passe" class="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-neutral-400"><i data-lucide="eye" class="h-5 w-5"></i></button></div><div id="au-p-h" class="min-h-[16px] text-xs text-neutral-400"></div>' +
      '<div id="au-err" role="alert" class="min-h-[18px] text-sm text-red-400"></div><div class="sticky bottom-0 -mx-4 -mb-4 bg-neutral-950 px-4 pb-4 pt-2"><button id="au-go" class="' + btn + ' w-full">' + (signup ? 'Créer mon compte' : 'Se connecter') + '</button></div></form>' +
      '<p class="mt-4 text-center text-sm text-neutral-400">' + (signup ? 'Déjà un compte ?' : 'Pas encore de compte ?') + ' <a id="au-alt" href="' + alt + '" class="font-bold text-amber-400">' + (signup ? 'Se connecter' : 'Créer un compte') + '</a></p>');
    $('au-alt').onclick = function (e) { e.preventDefault(); nav(alt, { replace: true }); };
    var slug = function (t) { return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_.]/g, '').slice(0, 24); };
    var eye = $('au-eye'); eye.onclick = function () { var show = $('au-p').type === 'password'; $('au-p').type = show ? 'text' : 'password'; eye.innerHTML = '<i data-lucide="' + (show ? 'eye-off' : 'eye') + '" class="h-5 w-5"></i>'; eye.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'); icons(); };
    $('au-p').oninput = function () { $('au-p-h').textContent = this.value && this.value.length < 8 ? 'Encore ' + (8 - this.value.length) + ' caractère' + (8 - this.value.length > 1 ? 's' : '') + ' (8 minimum)' : ''; };
    if (signup) {
      var touched = false, uh = $('au-u-h'), hint = 'Lettres minuscules, chiffres, _ et . (3 à 24)';
      $('au-n').oninput = function () { if (!touched) $('au-u').value = slug(this.value); $('au-n-h').textContent = this.value.trim() && this.value.trim().length < 3 ? '3 caractères minimum' : ''; uh.textContent = hint; };
      $('au-u').oninput = function () {
        var v = this.value, had = /\s/.test(v); touched = true;
        v = v.toLowerCase().replace(/\s+/g, '_'); var c = v.replace(/[^a-z0-9_.]/g, ''); this.value = c;
        uh.className = 'min-h-[16px] text-xs ' + (had || c !== v ? 'text-amber-400' : 'text-neutral-400');
        uh.textContent = had ? 'Le @ ne peut pas contenir d’espace, on a mis _ à la place' : c !== v ? 'Seuls a-z, 0-9, _ et . sont permis, on a retiré le reste' : c && c.length < 3 ? '3 caractères minimum' : hint;
      };
    }
    $('au').onsubmit = function (e) {
      e.preventDefault(); $('au-err').textContent = '';
      var body = { email: $('au-e').value.trim(), password: $('au-p').value };
      if (signup) { body.name = $('au-n').value.trim().replace(/\s+/g, ' '); body.username = $('au-u').value;
        if (body.name.length < 3) { $('au-err').textContent = 'Écrivez votre nom complet (3 caractères minimum)'; $('au-n').focus(); return; }
        if (body.username.length < 3) { $('au-err').textContent = 'Le nom d’utilisateur doit faire 3 caractères minimum'; $('au-u').focus(); return; } }
      if (body.password.length < 8) { $('au-err').textContent = 'Le mot de passe doit faire 8 caractères minimum'; return; }
      $('au-go').disabled = true;
      api('POST', '/api/auth/' + kind, body).then(function (r) { tokSet(r.token); me = r.user; return Promise.all([refreshMe(), reloadFeed()]); }).then(function () { nav(next || '/profile', { replace: true }); })
        .catch(function (err) { $('au-err').textContent = err.message; $('au-go').disabled = false; });
    };
  }

  /* ---- settings ---- */
  function settingsPage() {
    setPage(pageHead('Paramètres') + '<div class="flex flex-col gap-2">' + settingsRows() + '</div>' + (me ? '<button id="s-out" class="' + btn2 + ' mt-4 w-full">Déconnexion</button>' : ''));
    bindSettingsRows(page, closeOverlay);
    if ($('s-out')) $('s-out').onclick = logout;
  }

  /* ================= router ================= */
  var ready = false;
  function setChrome(p) {
    var feedRoute = p === '/';
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === tabOf(p)); });
    $('hdr').classList.toggle('bare', feedRoute || viewer);
    $('l-rail').hidden = !(feedRoute || viewer);
    updateBar();
  }
  function render() {
    if (!ready) return;
    var p = PATHN(), q = new URLSearchParams(location.search), m;
    viewer = false; if (hideModalIfStale()) { /* no-op */ }
    if (p !== '/search' && p !== '/c' && !/^\/c\//.test(p)) { /* keep search text only on search */ }
    if (p === '/search') qEl.value = q.get('q') || ''; syncSearchUi();
    if (p === '/' || (m = /^\/c\/([\w.-]+)$/.exec(p))) {
      if (m) {
        viewer = true; var id = m[1];
        var go2 = function () { var k = vlist.findIndex(function (x) { return x.id === id; }); L = vlist; idx = k < 0 ? 0 : k; page.hidden = true; setChrome(p); shownId = null; show(0); };
        if (vlist && vlist.some(function (x) { return x.id === id; })) return go2();
        fetch('/api/clips/' + encodeURIComponent(id), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
          if (!c) { viewer = false; page.hidden = false; v.pause(); setChrome(p); return setPage(pageHead('Clip introuvable') + msg('Ce clip n’existe pas ou a été supprimé.') + '<button id="nf" class="' + btn + ' mt-4 w-full">Retour au fil</button>'), $('nf').onclick = function () { nav('/', { replace: true }); }; }
          vlist = [c].concat(feedClips.filter(function (x) { return x.id !== c.id; })); go2();
        });
        return;
      }
      L = feedClips; idx = Math.min(feedI, Math.max(0, feedClips.length - 1)); page.hidden = true; setChrome(p); show(0); return;
    }
    v.pause(); page.hidden = false; setChrome(p);
    if (p === '/search') searchPage(q.get('q') || '');
    else if (p === '/clips') clipsPage();
    else if (p === '/messages') messagesPage();
    else if ((m = /^\/messages\/([^/]+)$/.exec(p))) threadPage(decodeURIComponent(m[1]));
    else if (p === '/profile' || p === '/profil') profilePage();
    else if ((m = /^\/u\/([^/]+)$/.exec(p))) profilePage(decodeURIComponent(m[1]));
    else if (p === '/settings') settingsPage();
    else if (p === '/login' || p === '/signup') { if (me) return nav(safeNext(q.get('next')) || '/profile', { replace: true }); authPage(p.slice(1)); }
    else nav('/', { replace: true });
  }
  function hideModalIfStale() { return false; }

  /* chrome: Home, logo, back, close, bottom nav */
  $('b-home').onclick = function () { nav('/'); };
  // fixed tab title: always shown and active; already on /Arena-Clips it stays on the tab, otherwise it opens gdnaarena.app/Arena-Clips
  $('tab-clips').onclick = function () { if (/^\/arena-clips(\/|$)/i.test(location.pathname)) { /* already on the tab: stay */ } else location.href = SITE.replace(/\/?$/, '/') + 'Arena-Clips'; };
  $('b-lang').onclick = languagePicker;
  document.querySelectorAll('.tab').forEach(function (t) {
    t.onclick = function () {
      var g = t.dataset.tab;
      if (g === 'home') return nav('/');
      if (g === 'search') { nav('/search' + (qEl.value.trim() ? '?q=' + encodeURIComponent(qEl.value.trim()) : '')); qEl.focus(); return; }
      nav(g === 'profile' ? '/profile' : '/' + g);
    };
  });

  /* published clips go to the top of the feed (called by upload.js) */
  window.__arena = {
    toast: toast, refreshMe: refreshMe, needLogin: needLogin, esc: esc, api: api,
    openUpload: openUpload, closeOverlay: closeOverlay, me: function () { return me; },
    published: function (c) {
      addClips([c], true); feedI = 0;
      if (ov) nav('/', { replace: true });                 // the studio sheet was open: drop it and show the clip
      else { toast('Clip publié'); if (PATHN() === '/') { L = feedClips; idx = 0; shownId = null; show(0); } }
    },
  };

  /* ================= top-left ⋮ button: ONE native-DOM panel with everything ================= */
  (function () {
    var KEY = 'arena-clips:more', panel = null;
    var S = { muteOriginal: false, voice: false, syncAi: false };
    try { var sv = JSON.parse(localStorage.getItem(KEY) || '{}'); for (var k in sv) if (k in S) S[k] = sv[k]; } catch (e) { /* ignore */ }
    var save = function () { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };
    function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
    function close() { if (panel) { panel.remove(); panel = null; } }
    // run an action of the Toolbox (same permissions, same API calls) without depending on how it is drawn
    function viaToolbox(id, why) {
      close(); toolbox();
      var b = $(id);
      if (!b || b.disabled) { closeOverlay(); toast(why || 'Indisponible : ouvrez un clip'); return; }
      b.click();
    }
    function viaSub(k) { close(); setSub(k, closeOverlay); }
    var ROW = 'display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:14px 16px;border:0;border-bottom:1px solid #f1f1f1;background:none;color:#111;font:inherit;font-size:15px;text-align:left;cursor:pointer';
    function open() {
      if (panel) return;
      panel = el('aside', 'position:fixed;top:0;left:0;width:320px;max-width:100%;height:100%;overflow-y:auto;z-index:9999;background:white;color:#111;font-family:system-ui,sans-serif;box-shadow:4px 0 24px rgba(0,0,0,.45)');
      panel.id = 'more-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Settings');
      var head = el('div', 'display:flex;align-items:center;justify-content:space-between;padding:14px 16px;position:sticky;top:0;background:white;border-bottom:1px solid #eee;z-index:1');
      var x = el('button', 'border:0;background:none;font-size:18px;cursor:pointer;padding:4px 10px;color:#111', 'X'); x.setAttribute('aria-label', 'Fermer'); x.onclick = close;
      head.appendChild(el('strong', '', '⚙️ SETTINGS')); head.appendChild(x); panel.appendChild(head);
      function title(t) { panel.appendChild(el('h3', 'margin:0;padding:14px 16px 6px;font-size:12px;letter-spacing:.08em;color:#666', t)); }
      function row(emoji, label, fn, red) { var b = el('button', ROW + (red ? ';color:#d00000;font-weight:700' : ''), (emoji ? emoji + ' ' : '') + label); b.type = 'button'; b.onclick = fn; panel.appendChild(b); return b; }
      function toggleRow(label, key, after) {
        var b = el('button', ROW), s = el('b', 'font-size:13px');
        var paint = function () { s.textContent = S[key] ? 'ON' : 'OFF'; }; paint();
        b.type = 'button'; b.appendChild(el('span', '', label)); b.appendChild(s);
        b.onclick = function () { S[key] = !S[key]; paint(); save(); if (after) after(); }; panel.appendChild(b);
      }
      var soon = function () { toast('Bientôt disponible'); };
      var feedNow = function () { var q = PATHN(); return q === '/' || /^\/c\//.test(q); };
      var needClip = function (fn) { return function () { if (!cur() || !feedNow()) { toast('Ouvrez un clip'); return; } fn(); }; };

      var studio = function (msg, then) { close(); $('up-open').click(); if (msg) toast(msg); if (then) setTimeout(then, 200); };
      var audioHint = 'Choisissez une vidéo, puis l’onglet Audio du studio';

      title('LANGUE & COMPTE');
      row('', 'Langue', function () { close(); $('b-lang').click(); });
      row('', 'Mon Compte', function () { viaSub('account'); });
      row('', 'Notifications', function () { viaSub('notif'); });

      title('VIDÉO');
      row('🎨', 'Filtres', function () { viaToolbox('tb-fx', 'Réservé au propriétaire du clip'); });
      row('⚙️', 'Réglage Vidéo', function () { viaSub('quality'); });
      row('✂️', 'Cut', function () { viaToolbox('tb-cut', 'Réservé au propriétaire du clip'); });
      row('📷', 'Caméra', function () { studio('', function () { var r = $('up-rec'); if (r) r.click(); }); });
      row('⬆️', 'Importer', function () { studio(''); });

      title('AUDIO STUDIO');
      toggleRow('Supprimer Audio Original', 'muteOriginal', function () { setSound(!S.muteOriginal); });
      row('🎵', 'Musique : Liste', function () { studio(audioHint); });
      row('🎵', 'Musique : Paste', function () { studio(audioHint); });
      row('🎵', 'Musique : Recherche', function () { studio(audioHint); });
      row('🎙️', 'Commentaire Vocal', function () { studio(audioHint); });
      row('✨', 'Effets', function () { studio(audioHint); });
      toggleRow('Sync AI', 'syncAi');

      title('VIDÉO ACTUELLE');
      row('💾', 'Enregistrer', function () { viaToolbox('tb-save'); });
      row('📤', 'Partager', needClip(function () { close(); $('r-share').onclick(); }));
      row('🔗', 'Copier Lien', needClip(function () { copyText(location.origin + '/c/' + encodeURIComponent(cur().id)).then(function () { toast('Lien copié'); }); }));
      row('📝', 'Modifier', function () { viaToolbox('tb-desc', 'Réservé au propriétaire du clip'); });
      row('🗑️', 'Supprimer', function () { viaToolbox('tb-del', 'Suppression réservée au propriétaire du clip'); }, true);

      title('PLATEFORME');
      row('', 'Coins & XP', soon); row('', 'Clip Challenges', soon); row('', 'Arena Tagging', soon);
      row('', 'Aide', function () { viaSub('help'); });
      document.body.appendChild(panel);
    }
    // the main ⋯ button (right rail, under Save) opens this panel, with or without an active clip. The left ⋮ (b-tools) keeps its own toolbox.
    $('r-more').onclick = function (e) { if (e) e.stopPropagation(); open(); };   // MAIN ⋯ button (right rail) opens the full panel
  })();

  /* boot */
  Promise.all([refreshMe(), loadFeed()]).then(function () { ready = true; render(); icons(); });
  window.addEventListener('load', icons);
})();
