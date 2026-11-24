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
  var soundOn = false, loops = 0, userPaused = false, maxI = 0;

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
    o = o || {};
    if (ov) { dropOv(); history.replaceState({ i: depth() }, '', path); }
    else if (o.replace) history.replaceState({ i: depth() }, '', path);
    else if (path !== location.pathname + location.search) { history.pushState({ i: depth() + 1 }, '', path); maxI = depth(); }
    render();
  }
  function goBack() { if (ov) closeOverlay(); else if (depth() > 0) history.back(); else nav('/', { replace: true }); }
  window.addEventListener('popstate', function () { if (ov) { dropOv(); maxI = depth(); updateBar(); return; } render(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (ov) closeOverlay(); else if (location.pathname !== '/') goBack(); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || ov) return;
    if (location.pathname === '/' || viewer) { if (e.key === 'ArrowDown') go(1); if (e.key === 'ArrowUp') go(-1); }
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
  function refreshMe() {
    return api('GET', '/api/me').then(function (r) { me = r.user; unread = r.unread || 0; badge(); paintEq(); }).catch(function () { me = null; });
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
  function quality() { try { return localStorage.getItem('quality') === 'saver' ? 'saver' : 'auto'; } catch (e) { return 'auto'; } }
  function lowNet() {
    var k = navigator.connection || {}, s = ''; try { s = sessionStorage.getItem('rend') || ''; } catch (e) { /* private mode */ }
    if (quality() === 'saver') return true;
    if (s) return s === 'low';
    return !!(k.saveData || /(^|-)2g|3g/.test(k.effectiveType || '') || (k.downlink && k.downlink < 1.5));
  }
  function srcOf(c) { return lowNet() && c.url360 ? c.url360 : c.url; }
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
    var c = cur(), t = Date.now(); if (!c || !c.url360 || v.src === c.url360 || v.currentTime < 0.3) return;
    stalls = stalls.filter(function (x) { return t - x < 10000; }); stalls.push(t);
    if (stalls.length >= 2) { stalls = []; try { sessionStorage.setItem('rend', 'low'); } catch (e) { /* ignore */ } var at = v.currentTime; v.src = c.url360; v.addEventListener('loadedmetadata', function h() { v.removeEventListener('loadedmetadata', h); try { v.currentTime = at; } catch (e) { /* ignore */ } if (!userPaused) tryPlay(); }); v.load(); }
  }
  // only the visible tab/route plays, and never over a clip the user paused
  function feedVisible() { return !document.hidden && page.hidden && !!shownId; }
  function canRun() { return feedVisible() && !userPaused && $('replay').hidden; }
  document.addEventListener('visibilitychange', function () { if (document.hidden) v.pause(); else if (canRun()) tryPlay(); });
  function resetLoops() { loops = 0; $('replay').hidden = true; }
  function tryPlay() { var p = v.play(); if (p && p.catch) p.catch(function () { if (!v.muted) { v.muted = true; soundOn = false; paintSound(); v.play().catch(function () { /* user taps to start */ }); } }); }
  // loopCount: every `ended` is one finished play; after the 3rd one the chain moves to the next clip
  function onEnded() {
    if (this !== v || !shownId) return;
    if (ov) { v.currentTime = 0; tryPlay(); return; }          // a sheet is open over this clip: keep it here
    loops++;
    if (loops < 3) { v.currentTime = 0; tryPlay(); return; }
    if (L.length > 1) jumpTo((idx + 1) % L.length, 1); else $('replay').hidden = false;
  }
  function onTap() {
    if (this !== v) return;
    if (!$('replay').hidden) { $('replay').click(); return; }
    if (v.muted && !v.paused) { soundOn = true; v.muted = false; paintSound(); return; }   // first tap: sound on
    if (v.paused) { userPaused = false; tryPlay(); } else { userPaused = true; v.pause(); }
  }
  [v, buf].forEach(function (el) { el.addEventListener('waiting', onWaiting); el.addEventListener('ended', onEnded); el.addEventListener('click', onTap); });
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
  $('r-snd').onclick = function () { soundOn = !soundOn; v.muted = !soundOn; paintSound(); };

  function show(dir) {
    var c = cur(); if (!c) return;
    if (shownId === c.id && v.getAttribute('src')) { if (!userPaused) tryPlay(); paint(); updateBar(); return; }
    shownId = c.id; resetLoops(); userPaused = false;
    if (buf.dataset.id === c.id && buf.readyState >= 2 && L.length > 1) {   // the next clip is already buffered: swap, no black frame
      var old = v; v = buf; buf = old;
      if (io) { io.unobserve(buf); io.observe(v); }
      v.classList.remove('invisible'); buf.classList.add('invisible'); buf.pause();
      v.muted = !soundOn; try { v.currentTime = 0; } catch (e) { /* ignore */ }
      poster.classList.add('hidden');
    } else {
      if (c.poster) { poster.src = c.poster; poster.classList.remove('hidden'); v.poster = c.poster; } else { poster.classList.add('hidden'); v.removeAttribute('poster'); }
      v.muted = !soundOn; v.dataset.id = c.id; v.src = srcOf(c); v.load();
      v.addEventListener('playing', function h() { v.removeEventListener('playing', h); poster.classList.add('hidden'); });
    }
    tryPlay();
    prime();
    if (L === feedClips && idx >= L.length - 3) more();
    paint(); updateBar();
    if (dir) { v.classList.remove('slide-up', 'slide-down'); void v.offsetWidth; v.classList.add(dir > 0 ? 'slide-up' : 'slide-down'); }
  }
  function paint() {
    var c = cur(), empty = $('empty');
    if (!c) { empty.classList.remove('hidden'); empty.classList.add('flex'); return; }
    empty.classList.add('hidden'); empty.classList.remove('flex');
    var name = (c.author && c.author.name) || 'Arena Clips', mine = me && c.author && me.handle === c.author.handle;
    $('author').textContent = name; var av = c.author && c.author.avatar; $('avatar').innerHTML = av ? '<img src="' + esc(av) + '" alt="" class="h-full w-full rounded-full object-cover">' : esc(initials(name));
    $('c-title').textContent = titleOf(c); $('caption').textContent = capOf(c);
    $('handle').textContent = '@' + ((c.author && c.author.handle) || '');
    var vw = c.viewer || {};
    $('r-like').classList.toggle('on', !!vw.liked); $('r-like').querySelector('[data-n]').textContent = c.likes || 0;
    $('r-save').classList.toggle('saved', !!vw.saved); $('r-save').querySelector('[data-n]').textContent = c.saves || 0;
    $('l-fav').classList.toggle('fav', !!vw.favorited); $('l-fav').setAttribute('aria-pressed', String(!!vw.favorited));
    $('r-comment').querySelector('[data-n]').textContent = c.comments || 0;
    $('r-share').querySelector('[data-n]').textContent = c.shares || 0;
    var f = $('follow'); f.hidden = !!mine; f.textContent = vw.following ? 'Abonné ✓' : vw.requested ? 'Demandé' : 'Suivre'; f.classList.toggle('bg-white', !!vw.following); f.classList.toggle('text-black', !!vw.following);
    $('t-msg').disabled = !!mine; $('t-msg').classList.toggle('opacity-40', !!mine);
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
    dis($('b-x'), !ov && location.pathname === '/');
  }
  // on the feed or the viewer the arrows step through clips; on other pages (and at the ends) they walk the history
  function prevNext(d) {
    if (ov) { if (d < 0) closeOverlay(); return; }
    if (canClip(d)) go(d); else if (canHist(d)) history.go(d);
  }
  $('b-prev').onclick = function () { prevNext(-1); };
  $('b-next').onclick = function () { prevNext(1); };
  // X closes the open sheet, else the clip viewer, else leaves the page for the feed; it never closes the site
  $('b-x').onclick = function () { if (ov) closeOverlay(); else if (viewer) goBack(); else if (location.pathname !== '/') nav('/'); };

  // swipe right = previous, swipe left = next (anywhere except inputs and horizontally scrolling rows)
  var sx = null, sy = 0;
  function hScroll(el) { for (; el && el !== document.body; el = el.parentElement) { if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true; } return false; }
  document.addEventListener('touchstart', function (e) {
    sx = null; if (e.touches.length !== 1 || e.target.closest('input,textarea,select,#hdr') || hScroll(e.target)) return;
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
  ph.addEventListener('touchstart', function (e) { if (e.target.closest('button,a,input,textarea,select,main,.up-sheet,#modal,header,nav')) return; y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; }, { passive: true });
  ph.addEventListener('touchend', function (e) {
    if (y0 === null) return; var dy = e.changedTouches[0].clientY - y0, dx = e.changedTouches[0].clientX - x0; y0 = null;
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) { if (viewer && dy > 0) goBack(); else go(dy < 0 ? 1 : -1); }
  });
  var lock = 0;
  ph.addEventListener('wheel', function (e) { if (ov || !page.hidden || e.target.closest('#modal,.up-sheet')) return; var t = Date.now(); if (t - lock < 600 || Math.abs(e.deltaY) < 20) return; lock = t; if (viewer && e.deltaY < 0) goBack(); else go(e.deltaY > 0 ? 1 : -1); }, { passive: true });

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
  $('author-btn').onclick = function () { var c = cur(); if (c) nav('/u/' + encodeURIComponent(c.author.handle)); };

  /* ================= left rail: EQ avatar, Settings, Title/Caption, Favorite ================= */
  function paintEq() {
    var b = $('l-eq-t'); if (!b) return;
    if (!me) { b.innerHTML = '<i data-lucide="user-round" class="h-5 w-5"></i>'; icons(); return; }
    b.innerHTML = me.avatar ? '<img src="' + esc(me.avatar) + '" alt="" class="h-full w-full object-cover">' : esc(initials(me.name));
  }
  $('l-eq').onclick = function () { nav('/profile'); };
  $('l-set').onclick = function () { nav('/settings'); };
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
    var c = cur(); if (!c) return; var url = BASE + '/c/' + encodeURIComponent(c.id), text = label(c);
    openModal(head('Partager') + '<div class="mb-3 truncate rounded-xl bg-neutral-800 px-3 py-2.5 text-sm text-neutral-300" id="sh-url">' + esc(url) + '</div><div class="flex flex-col gap-2">' +
      '<button id="sh-copy" class="' + btn + '">Copier le lien</button>' +
      (navigator.share ? '<button id="sh-native" class="' + btn2 + '">Partager via…</button>' : '') +
      '<a id="sh-wa" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(text + ' ' + url) + '" class="' + btn2 + ' text-center">WhatsApp</a></div>');
    function rec(channel) { return api('POST', '/api/clips/' + encodeURIComponent(c.id) + '/share', { channel: channel }).then(function (r) { c.shares = r.count; if (cur() === c) paint(); }).catch(function () { /* count refreshes on next load */ }); }
    $('sh-copy').onclick = function () { copyText(url).then(function () { $('sh-copy').textContent = 'Lien copié ✓'; rec('link'); }); };
    if ($('sh-native')) $('sh-native').onclick = function () { navigator.share({ title: text, url: url }).then(function () { rec('native'); }).catch(function () { /* cancelled */ }); };
    $('sh-wa').onclick = function () { rec('whatsapp'); };
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

  /* ================= upload sheet (studio itself lives in upload.js) ================= */
  var sheet = $('up-sheet');
  function openUpload() {
    if (!me) return needLogin('Connectez-vous pour publier un clip.');
    openOverlay(function () { sheet.hidden = true; }); sheet.hidden = false;
  }
  $('up-open').onclick = openUpload;
  $('up-close').onclick = closeOverlay;

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
  function authCta(t) { setPage(pageHead(t) + '<div class="rounded-2xl bg-neutral-900 p-5 text-center"><p class="mb-4 text-sm text-neutral-300">Connectez-vous pour accéder à cette page.</p><div class="flex gap-2"><button id="cta-in" class="' + btn + ' flex-1">Se connecter</button><button id="cta-up" class="' + btn2 + ' flex-1">Créer un compte</button></div></div>'); var n = encodeURIComponent(location.pathname); $('cta-in').onclick = function () { nav('/login?next=' + n); }; $('cta-up').onclick = function () { nav('/signup?next=' + n); }; }

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
      if (location.pathname === '/search') { history.replaceState(history.state, '', url); searchPage(q); } else nav(url);
    }, 200);
  });
  qEl.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') qEl.blur(); });
  $('search-form').onsubmit = function (e) { e.preventDefault(); clearTimeout(sT); var q = qEl.value.trim(), url = '/search' + (q ? '?q=' + encodeURIComponent(q) : ''); if (location.pathname === '/search') { history.replaceState(history.state, '', url); searchPage(q); } else nav(url); qEl.blur(); };
  $('q-clear').onclick = function () { qEl.value = ''; syncSearchUi(); if (location.pathname === '/search') { history.replaceState(history.state, '', '/search'); searchPage(''); } qEl.focus(); };

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
  // file -> R2 (presigned PUT) -> returns the object key
  function putFile(slot, file, onProgress) {
    var ext = EXT[file.type] || ((/\.([a-z0-9]+)$/i.exec(file.name) || [])[1] || '').toLowerCase().replace('jpeg', 'jpg');
    return api('POST', '/api/me/upload-url', { slot: slot, ext: ext, size: file.size }).then(function (u) {
      return new Promise(function (ok, ko) {
        var x = new XMLHttpRequest(); x.open('PUT', u.url);
        x.setRequestHeader('content-type', u.contentType); if (u.cacheControl) x.setRequestHeader('cache-control', u.cacheControl);
        if (onProgress) x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
        x.onload = function () { x.status < 300 ? ok(u.key) : ko(new Error('Envoi vers R2 refusé (' + x.status + ')')); };
        x.onerror = function () { ko(new Error('Envoi impossible : vérifiez votre connexion')); };
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
      body.innerHTML = (mine ? '<label for="g-pv" class="text-xs font-bold text-neutral-300">Visibilité des nouveaux ajouts</label><select id="g-pv" class="' + inp + ' mb-2 mt-1"><option value="public">Public</option><option value="followers">Abonnés uniquement</option><option value="private">Privé</option></select><label class="' + btn + ' mb-3 flex cursor-pointer items-center justify-center gap-2 text-center">' + (photo ? 'Ajouter une photo' : 'Ajouter une vidéo') + '<input id="g-file" type="file" class="sr-only" multiple accept="' + (photo ? 'image/jpeg,image/png,image/webp,image/gif' : 'video/mp4,video/quicktime,video/webm') + '"></label><div id="g-st" class="mb-2 text-xs text-neutral-400"></div>' : '') +
        (items.length ? '<div class="grid grid-cols-3 gap-2">' + items.map(function (m) { return '<div class="relative aspect-square"><button data-m="' + m.id + '" class="relative h-full w-full overflow-hidden rounded-xl bg-neutral-800">' + (photo ? '<img src="' + esc(m.url) + '" loading="lazy" alt="" class="h-full w-full object-cover">' : '<video src="' + esc(m.url) + '#t=0.1" preload="metadata" muted playsinline class="h-full w-full object-cover"></video><span class="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 text-[10px]">▶</span>') + lockIcon(m.privacy) + '</button>' + (mine ? dots('media', m.id) : '') + '</div>'; }).join('') + '</div>'
          : (mine ? '<div class="rounded-2xl bg-neutral-900 p-5 text-center text-sm text-neutral-300">' + (photo ? 'Aucune photo pour le moment. Ajoutez votre première photo.' : 'Aucune vidéo pour le moment. Ajoutez votre première vidéo.') + '</div>' : msg(photo ? 'Aucune photo.' : 'Aucune vidéo.')));
      body.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { var m = items.filter(function (x) { return String(x.id) === b.dataset.m; })[0]; view(m); }; });
      icons();
      body.querySelectorAll('[data-dots]').forEach(function (d) { d.onclick = function (e) { e.stopPropagation(); var m = items.filter(function (x) { return String(x.id) === d.dataset.dots; })[0]; privacyMenu('media', m.id, m.privacy, function (pv) { m.privacy = pv; draw(items); }); }; });
      var f = $('g-file'); if (f) f.onchange = function () {
        var files = Array.prototype.slice.call(f.files || []); f.value = ''; if (!files.length) return;
        var st = $('g-st'), n = 0, bad = 0;
        files.reduce(function (p, file, i) {
          return p.then(function () {
            return putFile(photo ? 'photo' : 'video', file, function (r) { st.textContent = 'Envoi ' + (i + 1) + '/' + files.length + ' : ' + Math.round(r * 100) + ' %'; })
              .then(function (key) { return api('POST', '/api/me/media', { kind: kind, key: key, privacy: $('g-pv').value }); })
              .then(function (r) { if (r.media) items.unshift(r.media); n++; })
              .catch(function (e) { bad++; toast(e.message); });
          });
        }, Promise.resolve()).then(function () { if ($('g-file')) { draw(items); if (n) toast(n + (photo ? ' photo(s) ajoutée(s)' : ' vidéo(s) ajoutée(s)')); } });
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
    api('POST', '/api/auth/logout').catch(function () { /* cookie cleared anyway */ }).then(function () { me = null; unread = 0; badge(); return reloadFeed(); }).then(function () { nav('/login', { replace: true }); });
  }

  /* ---- auth ---- */
  function authPage(kind) {
    var signup = kind === 'signup', next = safeNext(new URLSearchParams(location.search).get('next'));
    var alt = '/' + (signup ? 'login' : 'signup') + (next ? '?next=' + encodeURIComponent(next) : '');
    setPage(pageHead(signup ? 'Créer un compte' : 'Connexion') + '<form id="au" class="flex flex-col gap-3" action="javascript:void(0)" novalidate>' +
      (signup ? '<label for="au-u" class="text-xs font-bold text-neutral-300">Nom d’utilisateur</label><input id="au-u" name="username" type="text" inputmode="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" maxlength="24" placeholder="ex. mon_nom" class="' + inp + ' font-normal">' : '') +
      '<label for="au-e" class="text-xs font-bold text-neutral-300">E-mail</label><input id="au-e" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="vous@exemple.com" class="' + inp + ' font-normal">' +
      '<label for="au-p" class="text-xs font-bold text-neutral-300">Mot de passe</label><input id="au-p" name="password" type="password" inputmode="text" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="' + (signup ? '8 caractères minimum' : 'Votre mot de passe') + '" class="' + inp + ' font-normal">' +
      '<div id="au-err" role="alert" class="min-h-[18px] text-sm text-red-400"></div><button id="au-go" class="' + btn + '">' + (signup ? 'Créer mon compte' : 'Se connecter') + '</button></form>' +
      '<p class="mt-4 text-center text-sm text-neutral-400">' + (signup ? 'Déjà un compte ?' : 'Pas encore de compte ?') + ' <a id="au-alt" href="' + alt + '" class="font-bold text-amber-400">' + (signup ? 'Se connecter' : 'Créer un compte') + '</a></p>');
    $('au-alt').onclick = function (e) { e.preventDefault(); nav(alt, { replace: true }); };
    $('au').onsubmit = function (e) {
      e.preventDefault(); $('au-err').textContent = ''; $('au-go').disabled = true;
      var body = { email: $('au-e').value, password: $('au-p').value }; if (signup) body.username = $('au-u').value;
      api('POST', '/api/auth/' + kind, body).then(function (r) { me = r.user; return Promise.all([refreshMe(), reloadFeed()]); }).then(function () { nav(next || '/profile', { replace: true }); })
        .catch(function (err) { $('au-err').textContent = err.message; $('au-go').disabled = false; });
    };
  }

  /* ---- settings ---- */
  function settingsPage() {
    var q = quality(), s = me ? me.settings : {};
    var qBtn = function (v, t, d) { return '<button data-q="' + v + '" role="radio" aria-checked="' + (q === v) + '" class="flex w-full items-center justify-between gap-3 rounded-xl p-3 text-left text-sm ' + (q === v ? 'bg-amber-400 text-black' : 'bg-neutral-900') + '"><span><b>' + t + '</b><span class="block text-xs ' + (q === v ? 'text-black/70' : 'text-neutral-400') + '">' + d + '</span></span><span>' + (q === v ? '✓' : '') + '</span></button>'; };
    var qSec = '<h3 class="mb-2 text-xs font-bold uppercase text-neutral-400">Qualité vidéo</h3><div id="s-q" role="radiogroup" class="mb-5 flex flex-col gap-2">' + qBtn('auto', 'Auto', '720p, passe en 360p si le réseau ralentit') + qBtn('saver', 'Économiseur de données', 'Toujours 360p') + '</div>';
    var bindQ = function () { page.querySelectorAll('[data-q]').forEach(function (b) { b.onclick = function () { try { localStorage.setItem('quality', b.dataset.q); sessionStorage.removeItem('rend'); } catch (e) { /* ignore */ } shownId = null; settingsPage(); }; }); };
    if (!me) { setPage(pageHead('Paramètres') + qSec); bindQ(); return; }
    var sw = function (k, t, d) { return '<div class="flex items-center justify-between gap-3 rounded-xl bg-neutral-900 p-3"><div class="text-sm"><b>' + t + '</b><div class="text-xs text-neutral-400">' + d + '</div></div><button role="switch" data-k="' + k + '" aria-checked="' + !!s[k] + '" aria-label="' + t + '" class="relative h-7 w-12 shrink-0 rounded-full ' + (s[k] ? 'bg-amber-400' : 'bg-neutral-700') + '"><span class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ' + (s[k] ? 'left-[22px]' : 'left-0.5') + '"></span></button></div>'; };
    setPage(pageHead('Paramètres') + qSec +
      '<h3 class="mb-2 text-xs font-bold uppercase text-neutral-400">Compte</h3><div class="mb-5 flex flex-col gap-2"><div class="rounded-xl bg-neutral-900 p-3 text-sm"><div class="text-xs text-neutral-400">E-mail</div>' + esc(me.email) + '</div><form id="s-name" class="flex gap-2" action="javascript:void(0)"><input id="s-dn" maxlength="40" value="' + esc(me.name) + '" aria-label="Nom affiché" class="' + field + '"><button class="' + btn + '">Enregistrer</button></form></div>' +
      '<h3 class="mb-2 text-xs font-bold uppercase text-neutral-400">Langue</h3><div class="mb-5"><select id="s-lang" aria-label="Langue" class="' + inp + '"><option value="fr" selected>Français</option></select></div>' +
      '<h3 class="mb-2 text-xs font-bold uppercase text-neutral-400">Notifications</h3><div class="mb-5">' + sw('notifications', 'Notifications', 'Pastille de nouveaux messages sur l’onglet Messages') + '</div>' +
      '<h3 class="mb-2 text-xs font-bold uppercase text-neutral-400">Confidentialité</h3><div class="mb-5 flex flex-col gap-2">' + '<div role="radiogroup" aria-label="Visibilité du profil" class="flex flex-col gap-2">' + [[false, 'Public', 'Tout le monde voit votre profil et votre galerie'], [true, 'Privé', 'Vous seul voyez tout ; les autres envoient une demande de suivi que vous acceptez ou refusez']].map(function (o) { var on = !!s.private_profile === o[0]; return '<button data-pp="' + o[0] + '" role="radio" aria-checked="' + on + '" class="flex w-full items-center justify-between gap-3 rounded-xl p-3 text-left text-sm ' + (on ? 'bg-amber-400 text-black' : 'bg-neutral-900') + '"><span><b>' + o[1] + '</b><span class="block text-xs ' + (on ? 'text-black/70' : 'text-neutral-400') + '">' + o[2] + '</span></span><span>' + (on ? '✓' : '') + '</span></button>'; }).join('') + '</div>' + sw('allow_messages', 'Autoriser les messages', 'Les autres membres peuvent vous écrire') + '</div>' +
      '<h3 class="mb-2 text-xs font-bold uppercase text-neutral-400">Session</h3><button id="s-out" class="' + btn2 + ' mb-5 w-full">Se déconnecter</button>' +
      '<h3 class="mb-2 text-xs font-bold uppercase text-red-400">Zone dangereuse</h3><button id="s-del" class="w-full rounded-full border border-red-500 px-5 py-2.5 text-sm font-bold text-red-400">Supprimer mon compte</button>');
    bindQ();
    page.querySelectorAll('[data-k]').forEach(function (b) { b.onclick = function () { var k = b.dataset.k, p = {}; p[k] = !me.settings[k]; api('PATCH', '/api/me', p).then(function (r) { me = r.user; if (k === 'notifications') badge(); settingsPage(); }).catch(fail); }; });
    page.querySelectorAll('[data-pp]').forEach(function (b) { b.onclick = function () { api('PATCH', '/api/me', { private_profile: b.dataset.pp === 'true' }).then(function (r) { me = r.user; settingsPage(); }).catch(fail); }; });
    $('s-name').onsubmit = function (e) { e.preventDefault(); api('PATCH', '/api/me', { display_name: $('s-dn').value }).then(function (r) { me = r.user; toast('Nom enregistré'); }).catch(fail); };
    $('s-out').onclick = logout;
    $('s-del').onclick = function () {
      openModal(head('Supprimer mon compte') + '<p class="mb-3 text-sm text-neutral-300">Cette action est définitive : votre compte, vos clips, commentaires et messages seront supprimés. Entrez votre mot de passe pour confirmer.</p><form id="d-f" class="flex flex-col gap-3" action="javascript:void(0)"><input id="d-p" type="password" autocomplete="current-password" placeholder="Mot de passe" class="' + inp + '"><div id="d-err" class="min-h-[18px] text-sm text-red-400"></div><button class="rounded-full bg-red-600 px-5 py-2.5 text-sm font-extrabold text-white">Supprimer définitivement</button></form>');
      $('d-f').onsubmit = function (e) { e.preventDefault(); api('DELETE', '/api/me', { password: $('d-p').value }).then(function () { me = null; unread = 0; badge(); return reloadFeed(); }).then(function () { nav('/signup', { replace: true }); toast('Compte supprimé'); }).catch(function (err) { $('d-err').textContent = err.message; }); };
    };
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
    var p = location.pathname, q = new URLSearchParams(location.search), m;
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
  $('logo').onclick = function () { nav('/'); };
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
    openUpload: openUpload, closeOverlay: closeOverlay, me: function () { return me; },
    published: function (c) {
      addClips([c], true); feedI = 0;
      if (ov) nav('/', { replace: true });                 // the studio sheet was open: drop it and show the clip
      else { toast('Clip publié'); if (location.pathname === '/') { L = feedClips; idx = 0; shownId = null; show(0); } }
    },
  };

  /* boot */
  Promise.all([refreshMe(), loadFeed()]).then(function () { ready = true; render(); icons(); });
  window.addEventListener('load', icons);
})();
