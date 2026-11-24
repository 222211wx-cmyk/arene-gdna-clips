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
  var soundOn = false, loops = 0, lastT = 0;

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
    ov = { close: closeFn };
  }
  function closeOverlay() { if (ov) history.back(); }
  function nav(path, o) {
    o = o || {};
    if (ov) { dropOv(); history.replaceState({ i: depth() }, '', path); }
    else if (o.replace) history.replaceState({ i: depth() }, '', path);
    else if (path !== location.pathname + location.search) history.pushState({ i: depth() + 1 }, '', path);
    render();
  }
  function goBack() { if (ov) closeOverlay(); else if (depth() > 0) history.back(); else nav('/', { replace: true }); }
  window.addEventListener('popstate', function () { if (ov) { dropOv(); return; } render(); });
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
    return api('GET', '/api/me').then(function (r) { me = r.user; unread = r.unread || 0; badge(); }).catch(function () { me = null; });
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

  /* ================= video: autoplay loop, 3 replays then a Replay button ================= */
  var nv = document.createElement('video'); nv.preload = 'auto'; nv.muted = true; nv.setAttribute('playsinline', '');
  function resetLoops() { loops = 0; lastT = 0; $('replay').hidden = true; }
  function tryPlay() { var p = v.play(); if (p && p.catch) p.catch(function () { if (!v.muted) { v.muted = true; soundOn = false; paintSound(); v.play().catch(function () { /* user taps to start */ }); } }); }
  setInterval(function () {
    if (v.paused || v.ended || !shownId) return;
    var t = v.currentTime;
    if (lastT > 0.5 && t < lastT - 0.4) {              // the clip wrapped around: one more play finished
      loops++;
      if (loops >= 3) { v.pause(); $('replay').hidden = false; }
    }
    lastT = t;
  }, 100);
  $('replay').onclick = function () { resetLoops(); v.currentTime = 0; tryPlay(); };
  v.addEventListener('click', function () { if (v.paused) { if (!$('replay').hidden) $('replay').click(); else tryPlay(); } else v.pause(); });
  function paintSound() { $('r-snd').querySelector('i,svg').outerHTML = '<i data-lucide="' + (soundOn ? 'volume-2' : 'volume-x') + '" class="h-7 w-7"></i>'; icons(); }
  $('r-snd').onclick = function () { soundOn = !soundOn; v.muted = !soundOn; paintSound(); };

  function show(dir) {
    var c = cur(); if (!c) return;
    if (shownId === c.id && v.src) { tryPlay(); paint(); return; }
    shownId = c.id; resetLoops();
    if (c.poster) { poster.src = c.poster; poster.classList.remove('hidden'); v.poster = c.poster; } else { poster.classList.add('hidden'); v.removeAttribute('poster'); }
    v.muted = !soundOn; v.src = c.url; v.load();
    v.addEventListener('playing', function h() { v.removeEventListener('playing', h); poster.classList.add('hidden'); });
    tryPlay();
    var n = L[idx + 1]; if (n) { if (nv.src !== n.url) { nv.src = n.url; nv.load(); } } else nv.removeAttribute('src');
    if (L === feedClips && idx >= L.length - 3) more();
    paint();
    if (dir) { v.classList.remove('slide-up', 'slide-down'); void v.offsetWidth; v.classList.add(dir > 0 ? 'slide-up' : 'slide-down'); }
  }
  function paint() {
    var c = cur(), empty = $('empty');
    if (!c) { empty.classList.remove('hidden'); empty.classList.add('flex'); return; }
    empty.classList.add('hidden'); empty.classList.remove('flex');
    var name = (c.author && c.author.name) || 'Arena Clips', mine = me && c.author && me.handle === c.author.handle;
    $('author').textContent = name; $('avatar').textContent = initials(name);
    $('c-title').textContent = titleOf(c); $('c-title').hidden = !titleOf(c);
    $('caption').textContent = capOf(c); $('caption').hidden = !capOf(c);
    $('handle').textContent = '@' + ((c.author && c.author.handle) || '');
    $('music').lastElementChild.textContent = c.music ? c.music.name + (c.music.artist ? ' - ' + c.music.artist : '') : 'Son original';
    var vw = c.viewer || {};
    $('r-like').classList.toggle('on', !!vw.liked); $('r-like').querySelector('[data-n]').textContent = c.likes || 0;
    $('r-save').classList.toggle('saved', !!vw.saved); $('r-save').querySelector('[data-n]').textContent = c.saves || 0;
    $('r-comment').querySelector('[data-n]').textContent = c.comments || 0;
    $('r-share').querySelector('[data-n]').textContent = c.shares || 0;
    var f = $('follow'); f.hidden = !!mine; f.textContent = vw.following ? 'Abonné ✓' : 'Suivre'; f.classList.toggle('bg-white', !!vw.following); f.classList.toggle('text-black', !!vw.following);
    $('t-msg').disabled = !!mine; $('t-msg').classList.toggle('opacity-40', !!mine);
  }
  function go(d) {
    var n = idx + d; if (n < 0 || n >= L.length) return;
    idx = n; if (L === feedClips) feedI = n; show(d);
  }

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
  $('r-like').onclick = guard(function () { toggle('like'); });
  $('r-save').onclick = guard(function () { toggle('save'); });
  function setFollowEverywhere(handle, on) { feedClips.concat(vlist || []).forEach(function (x) { if (x.author.handle === handle) (x.viewer || (x.viewer = {})).following = on; }); }
  $('follow').onclick = guard(function () {
    var c = cur(); if (!c) return; var on = !(c.viewer && c.viewer.following), h = c.author.handle;
    setFollowEverywhere(h, on); paint();
    api('PUT', '/api/clips/' + encodeURIComponent(c.id) + '/follow', { on: on }).catch(function (e) { setFollowEverywhere(h, !on); paint(); fail(e); });
  });
  $('author-btn').onclick = function () { var c = cur(); if (c) nav('/u/' + encodeURIComponent(c.author.handle)); };

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
      (me ? '<form id="cm-form" class="flex gap-2" action="javascript:void(0)"><input id="cm-in" maxlength="500" autocomplete="off" placeholder="Ajouter un commentaire…" class="' + field + '"><button class="' + btn + '">Envoyer</button></form>'
        : '<button id="cm-login" class="' + btn + ' w-full">Se connecter pour commenter</button>'));
    var list = $('cm-list');
    function row(m) { return '<div class="rounded-xl bg-neutral-800 px-3 py-2"><div class="text-xs font-bold text-gold">' + esc(m.name) + ' <span class="font-normal text-neutral-400">' + ago(m.created_at) + '</span></div><div class="break-words">' + esc(m.body) + '</div></div>'; }
    api('GET', '/api/clips/' + encodeURIComponent(c.id) + '/comments').then(function (r) { list.innerHTML = r.comments.length ? r.comments.map(row).join('') : '<div class="text-neutral-400">Aucun commentaire pour le moment. Soyez le premier.</div>'; list.scrollTop = list.scrollHeight; }).catch(function (e) { list.textContent = e.message; });
    if ($('cm-login')) $('cm-login').onclick = function () { nav('/login?next=' + encodeURIComponent(location.pathname)); };
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
  $('t-msg').onclick = guard(function () {
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
  function tabOf(p) { if (TAB[p]) return TAB[p]; if (/^\/messages\//.test(p)) return 'messages'; if (/^\/(profile|settings|login|signup|u\/)/.test(p)) return 'profile'; return 'home'; }
  var pageHead = function (t, extra) { return '<div class="mb-3 flex items-center justify-between"><h2 class="text-lg font-extrabold">' + t + '</h2>' + (extra || '') + '</div>'; };
  var msg = function (t) { return '<div class="text-sm text-neutral-400">' + t + '</div>'; };
  function thumb(c, cls) { return c.poster ? '<img src="' + esc(c.poster) + '" loading="lazy" alt="" class="' + cls + '">' : '<video src="' + esc(c.url) + '#t=0.1" preload="metadata" muted playsinline class="' + cls + '"></video>'; }
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
    if (!me) return authCta('Messages');
    setPage(pageHead('Messages') + msg('Chargement…'));
    api('GET', '/api/messages').then(function (r) {
      var cs = r.conversations;
      setPage(pageHead('Messages') + (cs.length ? cs.map(function (m) { return '<button data-h="' + esc(m.handle) + '" class="mb-2 flex w-full items-center gap-3 rounded-xl bg-neutral-900 p-3 text-left"><span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400 font-extrabold text-black">' + esc(initials(m.name)) + '</span><span class="min-w-0 flex-1 text-sm"><span class="flex justify-between"><b class="truncate">' + esc(m.name) + '</b><span class="text-xs text-neutral-400">' + ago(m.created_at) + '</span></span><span class="block truncate text-neutral-300">' + (m.mine ? 'Vous : ' : '') + esc(m.body) + '</span></span>' + (m.unread ? '<span class="rounded-full bg-red-500 px-2 text-xs font-bold">' + m.unread + '</span>' : '') + '</button>'; }).join('') : msg('Aucun message. Ouvrez un clip puis utilisez Message pour écrire à un créateur.')));
      page.querySelectorAll('[data-h]').forEach(function (b) { b.onclick = function () { nav('/messages/' + encodeURIComponent(b.dataset.h)); }; });
    }).catch(fail);
  }
  function threadPage(h) {
    if (!me) return authCta('Messages');
    setPage(pageHead('Conversation') + msg('Chargement…'));
    api('GET', '/api/messages?with=' + encodeURIComponent(h)).then(function (r) {
      setPage(pageHead(esc(r.with.name) + ' <span class="text-sm font-normal text-neutral-400">@' + esc(r.with.handle) + '</span>') + '<div id="th" class="mb-3 flex flex-col gap-2 text-sm">' + (r.messages.length ? r.messages.map(bubble).join('') : msg('Aucun message. Écrivez le premier.')) + '</div><form id="th-f" class="sticky bottom-0 flex gap-2 bg-neutral-950 pt-2" action="javascript:void(0)"><input id="th-b" maxlength="1000" autocomplete="off" placeholder="Votre message…" class="' + field + '"><button class="' + btn + '">Envoyer</button></form>');
      page.scrollTop = page.scrollHeight; refreshMe();
      $('th-f').onsubmit = function (e) { e.preventDefault(); var b = $('th-b').value.trim(); if (!b) return; api('POST', '/api/messages', { to: h, body: b }).then(function (m) { var t = $('th'); if (!t.querySelector('.rounded-2xl')) t.innerHTML = ''; t.insertAdjacentHTML('beforeend', bubble({ mine: true, body: m.body })); $('th-b').value = ''; page.scrollTop = page.scrollHeight; }).catch(fail); };
    }).catch(function (e) { setPage(pageHead('Conversation') + msg(esc(e.message))); });
  }

  /* ---- profile (me / others) ---- */
  function statBox(n, l, id) { return '<button ' + (id ? 'data-tabgo="' + id + '"' : '') + ' class="rounded-xl bg-neutral-900 py-2 text-center"><div class="text-xl font-extrabold">' + n + '</div><div class="text-xs text-neutral-400">' + l + '</div></button>'; }
  function profilePage(handle) {
    var mine = !handle || (me && handle === me.handle);
    if (mine && !me) return authCta('Profil');
    var h = mine ? me.handle : handle;
    setPage(pageHead('Profil') + msg('Chargement…'));
    api('GET', '/api/users/' + encodeURIComponent(h)).then(function (u) {
      var tabs = mine ? [['clips', 'Mes clips'], ['saved', 'Enregistrés'], ['followers', 'Abonnés']] : [['clips', 'Clips']];
      setPage(pageHead(mine ? 'Mon profil' : esc(u.name), mine ? '<button id="p-set" aria-label="Paramètres" class="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800"><i data-lucide="settings" class="h-5 w-5"></i></button>' : '') +
        '<div class="mb-4 rounded-2xl bg-neutral-900 p-4"><div class="flex items-center gap-3"><div class="flex h-14 w-14 items-center justify-center rounded-full bg-gold text-lg font-extrabold text-black">' + esc(initials(u.name)) + '</div><div class="min-w-0"><div class="truncate text-lg font-extrabold">' + esc(u.name) + '</div><div class="text-xs text-neutral-400">@' + esc(u.handle) + ' · ' + esc(u.citizenId) + '</div></div></div>' +
        '<div class="mt-4 grid grid-cols-3 gap-2">' + statBox(u.clips, 'Clips', 'clips') + statBox('<span id="p-fol">' + u.followers + '</span>', 'Abonnés', mine ? 'followers' : '') + statBox(u.following, 'Abonnements') + '</div>' +
        (mine ? '<div class="mt-3 flex gap-2"><button id="p-out" class="' + btn2 + ' flex-1">Se déconnecter</button><button id="p-up" class="' + btn + ' flex-1">Importer un clip</button></div>'
          : '<div class="mt-3 flex gap-2"><button id="p-follow" class="' + btn + ' flex-1"></button><button id="p-msg" class="' + btn2 + ' flex-1">Message</button></div>') + '</div>' +
        '<div id="p-tabs" class="mb-3 flex gap-2">' + tabs.map(function (t, k) { return '<button data-t="' + t[0] + '" class="tabbtn flex-1 rounded-full border px-3 py-2 text-sm font-bold ' + (k ? 'border-neutral-700 text-neutral-300' : 'border-amber-400 bg-amber-400 text-black') + '">' + t[1] + '</button>'; }).join('') + '</div><div id="p-body"></div>');
      if (mine) { $('p-set').onclick = function () { nav('/settings'); }; $('p-out').onclick = logout; $('p-up').onclick = openUpload; }
      else {
        var fol = u.following_by_me, fb = $('p-follow');
        var pf = function () { fb.textContent = fol ? 'Abonné ✓' : 'Suivre'; }; pf();
        fb.onclick = guard(function () { var on = !fol; api('PUT', '/api/users/' + encodeURIComponent(u.handle) + '/follow', { on: on }).then(function (r) { fol = on; $('p-fol').textContent = r.followers; setFollowEverywhere(u.handle, on); pf(); }).catch(fail); });
        $('p-msg').onclick = guard(function () { if (!u.allowMessages) return toast('Ce créateur n’accepte pas les messages'); nav('/messages/' + encodeURIComponent(u.handle)); });
      }
      function tab(t) {
        page.querySelectorAll('.tabbtn').forEach(function (b) { var on = b.dataset.t === t; b.className = 'tabbtn flex-1 rounded-full border px-3 py-2 text-sm font-bold ' + (on ? 'border-amber-400 bg-amber-400 text-black' : 'border-neutral-700 text-neutral-300'); });
        var body = $('p-body'); body.innerHTML = msg('Chargement…');
        var url = t === 'clips' ? '/api/users/' + encodeURIComponent(h) + '/clips' : t === 'saved' ? '/api/me/saved' : '/api/users/' + encodeURIComponent(h) + '/followers';
        api('GET', url).then(function (r) {
          if (r.private) { body.innerHTML = msg('Ce profil est privé.'); return; }
          if (t === 'followers') { body.innerHTML = r.followers.length ? r.followers.map(function (f) { return '<button data-u="' + esc(f.handle) + '" class="mb-2 flex w-full items-center gap-3 rounded-xl bg-neutral-900 p-3 text-left text-sm"><span class="flex h-9 w-9 items-center justify-center rounded-full bg-amber-400 font-extrabold text-black">' + esc(initials(f.name)) + '</span><span><b>' + esc(f.name) + '</b><br><span class="text-xs text-neutral-400">@' + esc(f.handle) + '</span></span></button>'; }).join('') : msg('Aucun abonné pour le moment.'); body.querySelectorAll('[data-u]').forEach(function (b) { b.onclick = function () { nav('/u/' + encodeURIComponent(b.dataset.u)); }; }); return; }
          body.innerHTML = r.clips.length ? '<div class="grid grid-cols-3 gap-2">' + r.clips.map(tile).join('') + '</div>' : msg(t === 'saved' ? 'Rien d’enregistré pour le moment. Touchez le marque-page sous un clip.' : (mine ? 'Vous n’avez encore publié aucun clip.' : 'Aucun clip publié.'));
          bindClips(body, r.clips);
        }).catch(function (e) { body.textContent = e.message; });
      }
      page.querySelectorAll('.tabbtn').forEach(function (b) { b.onclick = function () { tab(b.dataset.t); }; });
      page.querySelectorAll('[data-tabgo]').forEach(function (b) { b.onclick = function () { tab(b.dataset.tabgo); }; });
      tab('clips');
    }).catch(function (e) { setPage(pageHead('Profil') + msg(esc(e.message))); });
  }
  function logout() {
    api('POST', '/api/auth/logout').catch(function () { /* cookie cleared anyway */ }).then(function () { me = null; unread = 0; badge(); return reloadFeed(); }).then(function () { nav('/login', { replace: true }); });
  }

  /* ---- auth ---- */
  function authPage(kind) {
    var signup = kind === 'signup', next = safeNext(new URLSearchParams(location.search).get('next'));
    var alt = '/' + (signup ? 'login' : 'signup') + (next ? '?next=' + encodeURIComponent(next) : '');
    setPage(pageHead(signup ? 'Créer un compte' : 'Connexion') + '<form id="au" class="flex flex-col gap-3" action="javascript:void(0)" novalidate>' +
      (signup ? '<label class="text-xs font-bold text-neutral-300">Nom d’utilisateur<input id="au-u" autocomplete="username" autocapitalize="none" maxlength="24" placeholder="ex. mon_nom" class="' + inp + ' mt-1 font-normal"></label>' : '') +
      '<label class="text-xs font-bold text-neutral-300">E-mail<input id="au-e" type="email" autocomplete="email" placeholder="vous@exemple.com" class="' + inp + ' mt-1 font-normal"></label>' +
      '<label class="text-xs font-bold text-neutral-300">Mot de passe<input id="au-p" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" placeholder="' + (signup ? '8 caractères minimum' : 'Votre mot de passe') + '" class="' + inp + ' mt-1 font-normal"></label>' +
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
    if (!me) return authCta('Paramètres');
    var s = me.settings;
    var sw = function (k, t, d) { return '<div class="flex items-center justify-between gap-3 rounded-xl bg-neutral-900 p-3"><div class="text-sm"><b>' + t + '</b><div class="text-xs text-neutral-400">' + d + '</div></div><button role="switch" data-k="' + k + '" aria-checked="' + !!s[k] + '" aria-label="' + t + '" class="relative h-7 w-12 shrink-0 rounded-full ' + (s[k] ? 'bg-amber-400' : 'bg-neutral-700') + '"><span class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ' + (s[k] ? 'left-[22px]' : 'left-0.5') + '"></span></button></div>'; };
    setPage(pageHead('Paramètres') +
      '<h3 class="mb-2 text-xs font-bold uppercase text-neutral-400">Compte</h3><div class="mb-5 flex flex-col gap-2"><div class="rounded-xl bg-neutral-900 p-3 text-sm"><div class="text-xs text-neutral-400">E-mail</div>' + esc(me.email) + '</div><form id="s-name" class="flex gap-2" action="javascript:void(0)"><input id="s-dn" maxlength="40" value="' + esc(me.name) + '" aria-label="Nom affiché" class="' + field + '"><button class="' + btn + '">Enregistrer</button></form></div>' +
      '<h3 class="mb-2 text-xs font-bold uppercase text-neutral-400">Langue</h3><div class="mb-5"><select id="s-lang" aria-label="Langue" class="' + inp + '"><option value="fr" selected>Français</option></select></div>' +
      '<h3 class="mb-2 text-xs font-bold uppercase text-neutral-400">Notifications</h3><div class="mb-5">' + sw('notifications', 'Notifications', 'Pastille de nouveaux messages sur l’onglet Messages') + '</div>' +
      '<h3 class="mb-2 text-xs font-bold uppercase text-neutral-400">Confidentialité</h3><div class="mb-5 flex flex-col gap-2">' + sw('private_profile', 'Profil privé', 'Vos clips n’apparaissent plus dans la recherche ni sur votre profil public') + sw('allow_messages', 'Autoriser les messages', 'Les autres membres peuvent vous écrire') + '</div>' +
      '<h3 class="mb-2 text-xs font-bold uppercase text-neutral-400">Session</h3><button id="s-out" class="' + btn2 + ' mb-5 w-full">Se déconnecter</button>' +
      '<h3 class="mb-2 text-xs font-bold uppercase text-red-400">Zone dangereuse</h3><button id="s-del" class="w-full rounded-full border border-red-500 px-5 py-2.5 text-sm font-bold text-red-400">Supprimer mon compte</button>');
    page.querySelectorAll('[data-k]').forEach(function (b) { b.onclick = function () { var k = b.dataset.k, p = {}; p[k] = !me.settings[k]; api('PATCH', '/api/me', p).then(function (r) { me = r.user; if (k === 'notifications') badge(); settingsPage(); }).catch(fail); }; });
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
    $('b-back').hidden = feedRoute;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === tabOf(p)); });
    $('v-x').hidden = !viewer;
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
    else if (p === '/profile') profilePage();
    else if ((m = /^\/u\/([^/]+)$/.exec(p))) profilePage(decodeURIComponent(m[1]));
    else if (p === '/settings') settingsPage();
    else if (p === '/login' || p === '/signup') { if (me) return nav(safeNext(q.get('next')) || '/profile', { replace: true }); authPage(p.slice(1)); }
    else nav('/', { replace: true });
  }
  function hideModalIfStale() { return false; }

  /* chrome: Home, logo, back, close, bottom nav */
  $('b-home').onclick = function () { nav('/'); };
  $('logo').onclick = function () { nav('/'); };
  $('b-back').onclick = goBack;
  $('v-x').onclick = goBack;
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
