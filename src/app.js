(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var mqMobile = window.matchMedia('(max-width: 860px)');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* sticky stack height drives sidebar offset and anchor offsets */
  var stack = $('#stack');
  function setStack() { document.documentElement.style.setProperty('--stack-h', stack.offsetHeight + 'px'); }
  setStack();
  if ('ResizeObserver' in window) new ResizeObserver(setStack).observe(stack);
  window.addEventListener('resize', setStack);

  /* nav tree */
  $$('.nav-tree .twisty').forEach(function (t) {
    if (t.classList.contains('leaf')) return;
    t.addEventListener('click', function () {
      var node = t.closest('.node');
      var open = node.classList.toggle('open');
      t.setAttribute('aria-expanded', String(open));
    });
  });

  /* drawer */
  var sidebar = $('#sidebar'), scrim = $('#scrim'), toggle = $('#menuToggle');
  function drawer(open) {
    sidebar.classList.toggle('open', open);
    scrim.classList.toggle('show', open);
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', function () { drawer(!sidebar.classList.contains('open')); });
  scrim.addEventListener('click', function () { drawer(false); });
  $$('.nav-tree a, .toc-macro a').forEach(function (a) {
    a.addEventListener('click', function () { if (mqMobile.matches) drawer(false); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') drawer(false); });

  /* contract slot: copy with visible + announced feedback */
  var ca = $('#ca');
  if (ca && ca.getAttribute('data-state') === 'stated') {
    var toast = $('.ca-toast', ca), label = $('.ca-copy span', ca), timer;
    var done = function (ok) {
      ca.classList.toggle('copied', ok);
      label.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      toast.textContent = ok ? 'Address copied' : 'Select the address and copy it';
      clearTimeout(timer);
      timer = setTimeout(function () { ca.classList.remove('copied'); label.textContent = 'Copy'; toast.textContent = ''; }, 1600);
    };
    var fallback = function (text) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta); done(ok);
    };
    $$('[data-copy]', ca).forEach(function (el) {
      el.addEventListener('click', function () {
        var text = el.getAttribute('data-copy');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(text); });
        else fallback(text);
      });
    });
  }

  /* toc scroll-spy */
  var tocLinks = $$('.toc-macro a');
  var heads = tocLinks.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }).filter(Boolean);
  if ('IntersectionObserver' in window && heads.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        tocLinks.forEach(function (a) { a.classList.toggle('spy', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-140px 0px -70% 0px' });
    heads.forEach(function (h) { io.observe(h); });
  }

  /* on-page search over headings */
  var input = $('#topSearch'), panel = $('#searchResults'), box = $('#search'), stoggle = $('#searchToggle');
  var index = $$('.content h2, .content h3').map(function (h) {
    var text = [], n = h.nextElementSibling;
    while (n && !/^H[23]$/.test(n.tagName)) { text.push(n.textContent); n = n.nextElementSibling; }
    return { id: h.id, title: h.textContent, body: text.join(' ').replace(/\s+/g, ' ') };
  }).filter(function (i) { return i.id; });
  var items = [], active = -1;
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function close() { panel.hidden = true; panel.innerHTML = ''; items = []; active = -1; }
  function render(q) {
    var term = q.toLowerCase();
    var hits = index.filter(function (i) { return (i.title + ' ' + i.body).toLowerCase().indexOf(term) > -1; }).slice(0, 6);
    panel.innerHTML = '';
    items = [];
    if (!hits.length) { panel.innerHTML = '<div class="search-empty">No matches</div>'; panel.hidden = false; return; }
    var ul = document.createElement('ul'); ul.className = 'search-list';
    hits.forEach(function (h) {
      var at = h.body.toLowerCase().indexOf(term);
      var ex = at < 0 ? h.body.slice(0, 90) : h.body.slice(Math.max(0, at - 30), at + 70);
      var li = document.createElement('li');
      var a = document.createElement('a'); a.className = 'search-result-link'; a.href = '#' + h.id;
      a.innerHTML = '<span class="search-result-title">' + esc(h.title) + '</span><span class="search-result-excerpt">' + esc(ex).replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), function (m) { return '<mark>' + m + '</mark>'; }) + '</span>';
      a.addEventListener('click', function () { close(); box.classList.remove('open'); });
      li.appendChild(a); ul.appendChild(li); items.push(a);
    });
    panel.appendChild(ul); panel.hidden = false;
  }
  function setActive(i) {
    if (!items.length) return;
    active = (i + items.length) % items.length;
    items.forEach(function (a, k) { a.classList.toggle('active', k === active); });
  }
  input.addEventListener('input', function () { var q = input.value.trim(); if (!q) close(); else render(q); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); items[active].click(); }
    else if (e.key === 'Escape') { close(); box.classList.remove('open'); stoggle.setAttribute('aria-expanded', 'false'); input.blur(); }
  });
  stoggle.addEventListener('click', function () {
    var open = box.classList.toggle('open');
    stoggle.setAttribute('aria-expanded', String(open));
    if (open) input.focus(); else close();
  });
  document.addEventListener('click', function (e) { if (!panel.hidden && !e.target.closest('.search')) close(); });

  /* ------------------------------------------------------------ motion
     Everything below is skipped when the visitor prefers reduced motion: content shows at once,
     nothing is hidden waiting for an animation, nothing moves. */
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* scroll progress (a position readout, not an animation) */
  var bar = $('.progress span');
  var raf = 0;
  function progress() {
    raf = 0;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (bar) bar.style.setProperty('--p', max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)).toFixed(4) : '0');
  }
  function queueProgress() { if (!raf) raf = requestAnimationFrame(progress); }
  window.addEventListener('scroll', queueProgress, { passive: true });
  window.addEventListener('resize', queueProgress);
  progress();

  /* spotlight: pointer position feeds a radial highlight on cards, tiles, panels and rows */
  var SPOT = '.doc-card, .stat, .qs-body, .panel, .toc-macro, .m-row';
  var spotRaf = 0, spotEvt = null;
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    spotEvt = e;
    if (spotRaf) return;
    spotRaf = requestAnimationFrame(function () {
      spotRaf = 0;
      var t = spotEvt.target.closest ? spotEvt.target.closest(SPOT) : null;
      if (!t) return;
      var r = t.getBoundingClientRect();
      t.style.setProperty('--mx', (spotEvt.clientX - r.left).toFixed(0) + 'px');
      t.style.setProperty('--my', (spotEvt.clientY - r.top).toFixed(0) + 'px');
    });
  }, { passive: true });

  if (reduced.matches || !('animate' in Element.prototype)) return;

  /* spring physics: a damped spring (stiffness 170, damping 14, mass 1) sampled into keyframes */
  function spring() {
    var k = 170, c = 14, m = 1, w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m)), wd = w0 * Math.sqrt(1 - z * z);
    var T = 4.6 / (z * w0), N = 36, out = [];
    for (var i = 0; i <= N; i++) {
      var t = (i / N) * T;
      out.push({ offset: i / N, p: 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)) });
    }
    return { frames: out, ms: Math.round(T * 1000) };
  }
  var SP = spring();
  function enter(el, delay) {
    el.classList.add('in');
    var frames = SP.frames.map(function (f) {
      return { offset: f.offset, opacity: Math.min(1, Math.max(0, f.p * 1.5)), transform: 'translate3d(0,' + (30 * (1 - f.p)).toFixed(2) + 'px,0) scale(' + (0.955 + 0.045 * f.p).toFixed(4) + ')' };
    });
    el.animate(frames, { duration: SP.ms, delay: delay, easing: 'linear', fill: 'backwards' });
  }

  /* scroll reveal with stagger: items that arrive together enter 70ms apart */
  var REVEAL = '.content > h2, .content > h3, .content > p, .content > .panel, .toc-macro, .stat, .qs-step, .doc-card, .market, .link-list li, .hero';
  var targets = $$(REVEAL);
  if ('IntersectionObserver' in window && targets.length) {
    document.documentElement.classList.add('js-reveal');
    var seen = new IntersectionObserver(function (entries) {
      var n = 0;
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        seen.unobserve(en.target);
        enter(en.target, Math.min(n, 7) * 70);
        n++;
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach(function (t) { seen.observe(t); });
    /* safety net: never leave content hidden */
    setTimeout(function () { targets.forEach(function (t) { t.classList.add('in'); }); }, 4000);
  }

  /* hero parallax: layers drift against pointer and scroll by depth */
  var hero = $('.hero');
  if (hero) {
    var layers = $$('[data-depth]', hero), mx = 0, my = 0, pRaf = 0, inView = true;
    var paint = function () {
      pRaf = 0;
      var sy = window.scrollY;
      layers.forEach(function (l) {
        var d = parseFloat(l.getAttribute('data-depth'));
        l.style.setProperty('--px', (mx * d * -48).toFixed(1) + 'px');
        l.style.setProperty('--py', (my * d * -36 + sy * d * 0.4).toFixed(1) + 'px');
      });
    };
    var queue = function () { if (!pRaf && inView) pRaf = requestAnimationFrame(paint); };
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      mx = (e.clientX - r.left) / r.width - 0.5;
      my = (e.clientY - r.top) / r.height - 0.5;
      queue();
    }, { passive: true });
    hero.addEventListener('pointerleave', function () { mx = 0; my = 0; queue(); });
    window.addEventListener('scroll', queue, { passive: true });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { inView = es[0].isIntersecting; }).observe(hero);
    paint();
  }
})();
