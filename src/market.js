/* Market panel and ticker. Everything below the pure-logic block runs only in a browser.
   The endpoint and image origin are read from the page (they come from the register at build time);
   this file holds no hostnames and no addresses. When the contract address is absent the page ships
   inert markup and this script does nothing. */
(function (root) {
  'use strict';

  var TOP = 10, PAGE = 30, MAX_ATTEMPTS = 5, CAP_MS = 30000, REFRESH_MS = 60000, TIMEOUT_MS = 10000;
  var ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  var DASH = '—';

  /* ------------------------------------------------------------ pure logic */
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function backoffDelay(attempt, jitter) {
    var j = jitter === undefined ? 0.2 : jitter;
    var base = Math.min(CAP_MS, 1000 * Math.pow(2, attempt));
    return Math.round(base * (1 - j + Math.random() * 2 * j));
  }

  function selectTop(boosts, pairs, limit) {
    var wanted = {};
    (boosts || []).forEach(function (b) {
      if (b && b.chainId === 'solana' && ADDRESS.test(String(b.tokenAddress))) wanted[b.tokenAddress] = true;
    });
    var best = {};
    (pairs || []).forEach(function (p) {
      if (!p || p.chainId !== 'solana' || !p.baseToken) return;
      var a = p.baseToken.address;
      if (!wanted[a]) return;
      var vol = num(p.volume && p.volume.h24);
      if (vol === null) return;
      var item = {
        address: a,
        symbol: String(p.baseToken.symbol || ''),
        name: String(p.baseToken.name || ''),
        price: num(p.priceUsd),
        change: num(p.priceChange && p.priceChange.h24),
        volume: vol,
        liquidity: num(p.liquidity && p.liquidity.usd),
        imageUrl: p.info && typeof p.info.imageUrl === 'string' ? p.info.imageUrl : ''
      };
      var cur = best[a];
      if (!cur || (item.liquidity || 0) > (cur.liquidity || 0)) best[a] = item;
    });
    return Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (x, y) { return y.volume - x.volume; })
      .slice(0, limit || TOP);
  }

  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  async function getJson(fetchFn, url, timeoutMs) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs || TIMEOUT_MS) : null;
    try {
      var res = await fetchFn(url, ctl ? { signal: ctl.signal, headers: { accept: 'application/json' } } : undefined);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { if (timer) clearTimeout(timer); }
  }

  async function loadOnce(o) {
    var base = String(o.base).replace(/\/$/, '');
    var boosts = await getJson(o.fetch, base + '/token-boosts/top/v1');
    if (!Array.isArray(boosts)) throw new Error('unexpected boosts response');
    var seen = {}, addrs = [];
    boosts.forEach(function (b) {
      if (b && b.chainId === 'solana' && ADDRESS.test(String(b.tokenAddress)) && !seen[b.tokenAddress]) { seen[b.tokenAddress] = 1; addrs.push(b.tokenAddress); }
    });
    if (!addrs.length) throw new Error('no Solana entries');
    var pairs = [];
    var groups = chunk(addrs, PAGE);
    for (var i = 0; i < groups.length; i++) {
      var part = await getJson(o.fetch, base + '/tokens/v1/solana/' + groups[i].join(','));
      if (!Array.isArray(part)) throw new Error('unexpected pairs response');
      pairs = pairs.concat(part);
    }
    var top = selectTop(boosts, pairs, TOP);
    if (!top.length) throw new Error('no ranked pairs');
    return top;
  }

  /* exponential backoff: 1s, 2s, 4s, 8s ... capped, MAX_ATTEMPTS tries per cycle */
  async function loadTop(o) {
    var attempts = o.attempts || MAX_ATTEMPTS;
    for (var n = 0; ; n++) {
      try { return await loadOnce(o); }
      catch (e) {
        if (n + 1 >= attempts) throw e;
        var d = backoffDelay(n, o.jitter);
        if (o.onRetry) o.onRetry(n + 1, attempts, d, e);
        await o.sleep(d);
      }
    }
  }

  function fmtUsd(v) {
    if (v === null) return DASH;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(v);
  }
  function fmtPrice(v) {
    if (v === null) return DASH;
    if (v >= 1) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v);
    if (v === 0) return '$0';
    var dec = Math.min(12, 3 - Math.floor(Math.log10(v)));
    return '$' + v.toFixed(dec).replace(/0+$/, '').replace(/\.$/, '');
  }
  function fmtChange(v) {
    if (v === null) return { text: DASH, dir: 'none' };
    var dir = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    var body = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Math.abs(v)) + '%';
    return { text: (v > 0 ? '+' : v < 0 ? '−' : '') + body, dir: dir };
  }
  function letterFor(symbol, name) {
    var m = (String(symbol) + String(name)).match(/[A-Za-z0-9]/);
    return m ? m[0].toUpperCase() : '?';
  }
  function hueFor(address) {
    var h = 0;
    for (var i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
    return h % 4;
  }
  function imageOk(url, origin) {
    if (!url || !origin) return false;
    try { var u = new URL(url); return u.protocol === 'https:' && u.origin === origin; } catch (e) { return false; }
  }

  var api = { backoffDelay: backoffDelay, selectTop: selectTop, loadTop: loadTop, fmtUsd: fmtUsd, fmtPrice: fmtPrice, fmtChange: fmtChange, letterFor: letterFor, hueFor: hueFor, imageOk: imageOk, DASH: DASH };
  root.MuonoMarket = api;

  /* ------------------------------------------------------------ browser only */
  if (typeof document === 'undefined') return;

  var panel = document.getElementById('marketPanel');
  var ticker = document.getElementById('marketTicker');
  /* the feed runs whenever the page ships an endpoint; the contract address plays no part */
  if (!panel || panel.getAttribute('data-state') !== 'stated' || !panel.getAttribute('data-endpoint')) return;

  var reduced = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var base = panel.getAttribute('data-endpoint');
  var imgOrigin = panel.getAttribute('data-img-origin') || '';
  var rows = Array.prototype.slice.call(panel.querySelectorAll('.m-row'));
  var list = panel.querySelector('.m-rows');
  var statusEl = panel.querySelector('.m-status');
  var statusText = panel.querySelector('.m-st-text');
  var liveEl = panel.querySelector('.m-live');
  var retryBtn = panel.querySelector('.m-retry');
  var track = ticker ? ticker.querySelector('.t-track') : null;
  var toggle = ticker ? ticker.querySelector('.t-toggle') : null;
  var timer = null, running = false, everLoaded = false, lastOk = 0;
  var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
  var COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 00-2 2v14h2V3h12zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11z"/></svg>';

  function sleep(ms) { return new Promise(function (r) { timer = setTimeout(r, ms); }); }
  function later(ms, fn) { if (reduced.matches) fn(); else setTimeout(fn, ms); }
  function setStatus(text, kind) { statusText.textContent = text; statusEl.setAttribute('data-kind', kind || ''); }

  function logo(item) {
    var wrap = document.createElement('span');
    wrap.className = 'logo-wrap';
    var tile = function () {
      var t = document.createElement('span');
      t.className = 'tile hue-' + hueFor(item.address);
      t.textContent = letterFor(item.symbol, item.name);
      t.setAttribute('aria-hidden', 'true');
      return t;
    };
    if (imageOk(item.imageUrl, imgOrigin)) {
      var img = document.createElement('img');
      img.alt = '';
      img.width = 36; img.height = 36;
      img.loading = 'lazy'; img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', function () { wrap.textContent = ''; wrap.appendChild(tile()); });
      img.src = item.imageUrl;
      wrap.appendChild(img);
    } else wrap.appendChild(tile());
    return wrap;
  }

  function put(el, text, cls) {
    el.textContent = '';
    var s = document.createElement('span');
    s.className = 'fill' + (cls ? ' ' + cls : '');
    s.textContent = text;
    el.appendChild(s);
    return s;
  }

  /* count-up: ease-out cubic from the previous figure to the new one; a timer guarantees the final text even in a hidden tab */
  function tween(el, from, to, fmt, ms) {
    el._tw = (el._tw || 0) + 1;
    var id = el._tw;
    if (reduced.matches || from === to) { el.textContent = fmt(to); return; }
    var t0 = null;
    el.textContent = fmt(from);
    function step(ts) {
      if (el._tw !== id) return;
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    setTimeout(function () { if (el._tw === id) el.textContent = fmt(to); }, ms + 150);
  }

  function flash(cell, dir) {
    cell.classList.remove('flash-up', 'flash-down');
    void cell.offsetWidth;
    cell.classList.add('flash-' + dir);
    setTimeout(function () { cell.classList.remove('flash-up', 'flash-down'); }, 1000);
  }

  function setNum(row, cls, key, value, fmt, fresh) {
    var cell = row.querySelector('.' + cls);
    var span = cell.querySelector('.fill') || put(cell, '');
    if (value === null) { span.textContent = DASH; row._v[key] = null; return; }
    var prev = row._v[key];
    var from = fresh || prev === null || prev === undefined ? 0 : prev;
    tween(span, from, value, fmt, 800);
    if (!fresh && prev !== null && prev !== undefined && prev !== value && !reduced.matches) flash(cell, value > prev ? 'up' : 'down');
    row._v[key] = value;
    return span;
  }

  function dashRow(row) {
    row.classList.remove('is-skel', 'sk-leaving');
    row.classList.add('is-ready', 'is-dash');
    row._addr = ''; row._v = {};
    row.querySelector('.m-logo').textContent = '';
    put(row.querySelector('.m-sym'), DASH);
    put(row.querySelector('.m-full'), '');
    ['m-price', 'm-chg', 'm-vol', 'm-liq'].forEach(function (c) { put(row.querySelector('.' + c), DASH); });
    var b = row.querySelector('.m-copy');
    b.disabled = true; b.removeAttribute('data-copy'); b.setAttribute('aria-label', 'Copy address unavailable');
  }

  function fillRow(row, item) {
    var fresh = row._addr !== item.address;
    if (fresh) { row._addr = item.address; row._v = {}; }
    row.classList.remove('is-skel', 'is-dash', 'sk-leaving');
    row.classList.add('is-ready');
    if (fresh) {
      var lg = row.querySelector('.m-logo');
      lg.textContent = '';
      lg.appendChild(logo(item));
      put(row.querySelector('.m-sym'), item.symbol || DASH);
      put(row.querySelector('.m-full'), item.name);
    }
    setNum(row, 'm-price', 'price', item.price, fmtPrice, fresh);
    var c = fmtChange(item.change);
    var chgSpan = setNum(row, 'm-chg', 'change', item.change, function (v) { return fmtChange(v).text; }, fresh);
    if (chgSpan) chgSpan.className = 'fill chg-' + c.dir;
    setNum(row, 'm-vol', 'volume', item.volume, fmtUsd, fresh);
    setNum(row, 'm-liq', 'liquidity', item.liquidity, fmtUsd, fresh);
    var b = row.querySelector('.m-copy');
    b.disabled = false;
    b.setAttribute('data-copy', item.address);
    b.setAttribute('aria-label', 'Copy address of ' + (item.symbol || 'token'));
  }

  function tickerItem(item) {
    var el = document.createElement('span');
    el.className = 't-item';
    el.appendChild(logo(item));
    var s = document.createElement('span'); s.className = 't-sym'; s.textContent = item.symbol || DASH;
    var p = document.createElement('span'); p.className = 't-price'; p.textContent = fmtPrice(item.price);
    var c = fmtChange(item.change);
    var ch = document.createElement('span'); ch.className = 't-chg chg-' + c.dir; ch.textContent = c.text;
    el.appendChild(s); el.appendChild(p); el.appendChild(ch);
    return el;
  }

  function paintTicker(items) {
    if (!track) return;
    if (!items.length) {
      track.textContent = ''; track._sig = '';
      var m = document.createElement('span'); m.className = 't-msg'; m.textContent = 'Market feed unavailable ' + DASH;
      track.appendChild(m); ticker.classList.add('is-error'); toggle.disabled = true;
      track.style.removeProperty('--t-dur');
      return;
    }
    var sig = items.map(function (i) { return i.address; }).join();
    ticker.classList.remove('is-error', 'is-skel'); toggle.disabled = false;
    if (track._sig === sig) {
      /* same tokens: update in place so the strip keeps scrolling without a jump */
      Array.prototype.forEach.call(track.querySelectorAll('.t-set'), function (set) {
        Array.prototype.forEach.call(set.children, function (el, i) {
          var it = items[i], c = fmtChange(it.change);
          el.querySelector('.t-price').textContent = fmtPrice(it.price);
          var ch = el.querySelector('.t-chg'); ch.textContent = c.text; ch.className = 't-chg chg-' + c.dir;
        });
      });
      return;
    }
    track._sig = sig;
    track.textContent = '';
    var a = document.createElement('span'); a.className = 't-set';
    items.forEach(function (i) { a.appendChild(tickerItem(i)); });
    var b = a.cloneNode(true); b.setAttribute('aria-hidden', 'true');
    track.appendChild(a); track.appendChild(b);
    var w = a.getBoundingClientRect().width;
    if (w > 0) track.style.setProperty('--t-dur', Math.max(20, Math.round(w / 55)) + 's');
  }

  /* first paint: skeletons leave row by row (fade, then real values rise in); later paints update in place */
  function paintAll(items) {
    var first = !panel._painted;
    panel._painted = true;
    var last = rows.length - 1;
    rows.forEach(function (row, i) {
      var apply = function () {
        if (items[i]) fillRow(row, items[i]); else dashRow(row);
        if (i === last) list.setAttribute('aria-busy', 'false');
      };
      if (first && !reduced.matches) {
        later(i * 70, function () { row.classList.add('sk-leaving'); later(200, apply); });
      } else apply();
    });
    later(first ? 120 : 0, function () { paintTicker(items); });
  }

  async function cycle() {
    if (running) return;
    running = true;
    retryBtn.hidden = true;
    if (!everLoaded) setStatus('Loading market figures…', 'loading');
    try {
      var items = await loadTop({
        fetch: function (u, o) { return root.fetch(u, o); },
        base: base,
        sleep: sleep,
        onRetry: function (n, max, d, e) { setStatus('Source slow (' + e.message + '). Retry ' + n + ' of ' + (max - 1) + ' in ' + Math.round(d / 1000) + 's', 'retry'); }
      });
      everLoaded = true; lastOk = root.performance.now();
      paintAll(items);
      setStatus('Live', 'live');
    } catch (e) {
      if (!everLoaded) {
        paintAll([]);
        setStatus('Market source unreachable (' + e.message + '). No figures shown.', 'error');
      } else setStatus('Refresh failed (' + e.message + '). Showing the last good figures.', 'error');
      retryBtn.hidden = false;
    } finally {
      running = false;
      clearTimeout(timer);
      timer = setTimeout(function () { if (!document.hidden) cycle(); }, REFRESH_MS);
    }
  }

  retryBtn.addEventListener('click', function () { clearTimeout(timer); cycle(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && everLoaded && root.performance.now() - lastOk > REFRESH_MS) { clearTimeout(timer); cycle(); } });

  /* copy one address, per row */
  function copyText(text, done) {
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta); done(ok);
    };
    if (root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  }
  list.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.m-copy') : null;
    if (!b || b.disabled || !b.getAttribute('data-copy')) return;
    var label = b.getAttribute('aria-label');
    copyText(b.getAttribute('data-copy'), function (ok) {
      b.innerHTML = ok ? CHECK : COPY;
      b.classList.toggle('copied', ok);
      liveEl.textContent = ok ? label.replace('Copy', 'Copied') : 'Copy failed. Select the address manually.';
      setTimeout(function () { b.innerHTML = COPY; b.classList.remove('copied'); liveEl.textContent = ''; }, 1600);
    });
  });

  if (toggle) toggle.addEventListener('click', function () {
    var p = ticker.classList.toggle('paused');
    toggle.setAttribute('aria-pressed', String(p));
    toggle.setAttribute('aria-label', p ? 'Resume strip' : 'Pause strip');
  });

  cycle();
})(typeof globalThis !== 'undefined' ? globalThis : this);
