// Pure checkers: each takes a built directory (and the register that produced it) and returns a list of error strings.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { inflateSync } from 'node:zlib';
import { isInert, isSolanaAddress, handle } from './lib-register.mjs';
import { X_PATH, GH_PATH } from './icons.mjs';
import { visibleText, words, bigrams, sha } from './lib-text.mjs';

export const walk = (dir, base = dir) => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p).replace(/\\/g, '/')];
});
const read = (dir, f) => readFileSync(join(dir, f), 'utf8');
const TEXT = new Set(['.html', '.css', '.js', '.json', '.txt', '.svg', '']);

export function parseTags(html) {
  const out = [];
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    out.push({ tag: m[1].toLowerCase(), attrs, index: m.index, raw: m[0] });
  }
  return out;
}

// ---------------------------------------------------------------- structure + register behaviour
export function checkBuild(dir, reg) {
  const e = [];
  const R = Object.fromEntries(reg.records.map(r => [r.id, r]));
  const html = read(dir, 'index.html');
  const tags = parseTags(html);

  // contract slot: exactly one, inside the sticky header, before the layout
  const caTags = tags.filter(t => t.attrs.id === 'ca');
  if (caTags.length !== 1) e.push(`ca: expected exactly one #ca, found ${caTags.length}`);
  const hdrStart = html.indexOf('<header class="stack"'), hdrEnd = html.indexOf('</header>'), layout = html.indexOf('<div class="layout"');
  const caAt = caTags[0]?.index ?? -1;
  if (!(hdrStart >= 0 && caAt > hdrStart && caAt < hdrEnd && hdrEnd < layout)) e.push('ca: slot must sit inside the sticky header, above the page layout');
  const slot = html.slice(caAt, html.indexOf('</header>'));
  const ca = R.ca;
  if (caTags[0] && caTags[0].attrs['data-state'] !== ca.state) e.push(`ca: data-state ${caTags[0].attrs['data-state']} != register ${ca.state}`);
  if (isInert(ca)) {
    if (/data-copy/.test(slot)) e.push('ca: inert slot carries data-copy');
    if (!/<button[^>]*class="ca-copy"[^>]*\bdisabled\b/.test(slot)) e.push('ca: inert copy button must be disabled');
    if (/\bhref=/.test(slot)) e.push('ca: inert slot carries href');
  } else {
    const copies = [...slot.matchAll(/data-copy="([^"]*)"/g)].map(m => m[1]);
    if (copies.length < 1 || copies.some(c => c !== ca.value)) e.push('ca: data-copy must equal the stated value everywhere');
    const text = slot.replace(/<[^>]+>/g, '|');
    if (!text.includes('|' + ca.value + '|')) e.push('ca: full address must be visible in the slot, unabridged');
    if (!/class="ca-copy"[^>]*data-copy/.test(slot) || /class="ca-copy"[^>]*\bdisabled\b/.test(slot)) e.push('ca: stated copy button must be live');
    if (!/role="status"/.test(slot)) e.push('ca: copy feedback region missing');
  }

  // social, top-right, icon only, both always present
  const rs = html.indexOf('<div class="right social"');
  const rsBlock = rs < 0 ? '' : html.slice(rs, html.indexOf('</div>', rs));
  const rsTags = parseTags(rsBlock).filter(t => t.attrs['data-record']);
  if (rsTags.map(t => t.attrs['data-record']).join() !== 'x,github') e.push(`social: top-right must hold x then github, found ${rsTags.map(t => t.attrs['data-record']).join()}`);
  if (!rsBlock.includes(`d="${X_PATH}"`)) e.push('social: official X mark path missing');
  if (!rsBlock.includes(`d="${GH_PATH}"`)) e.push('social: official GitHub Octicon path missing');
  if (/<\/svg>\s*[A-Za-z]/.test(rsBlock.replace(/<\/svg>\s*<\/(a|span)>/g, ''))) e.push('social: icon-only, no text labels');
  const inHeader = html.indexOf('<header class="stack"') < rs && rs < html.indexOf('</header>');
  if (!inHeader) e.push('social: not inside the top bar');

  // register -> markup. Every element that names a record must agree with the record.
  const statedUrls = new Set();
  for (const r of reg.records) if (!isInert(r) && r.url) statedUrls.add(r.url);
  for (const t of tags) {
    const id = t.attrs['data-record'];
    if (!id) continue;
    const r = R[id];
    if (!r) { e.push(`markup names unknown record ${id}`); continue; }
    if (t.attrs['data-state'] && t.attrs['data-state'] !== r.state) e.push(`${id}: ${t.tag} data-state ${t.attrs['data-state']} != ${r.state}`);
    if (isInert(r)) {
      if ('href' in t.attrs) e.push(`${id}: inert element <${t.tag}> has an href`);
      if (t.tag === 'a') e.push(`${id}: inert record rendered as <a>`);
      if (t.tag !== 'div' && t.tag !== 'li' && t.tag !== 'button' && !('aria-disabled' in t.attrs) && !/aria-disabled/.test(t.raw)) e.push(`${id}: inert <${t.tag}> missing aria-disabled`);
    } else if (r.kind === 'link' && t.tag === 'a' && t.attrs.href !== r.url) e.push(`${id}: href ${t.attrs.href} != stored url`);
  }
  // no dates anywhere a visitor can read or hover: markup, attributes, scripts
  const DATE = /\b\d{4}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\bchecked\b|\bupdated\b|\bas of\b/i;
  const dm = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').match(DATE);
  if (dm) e.push(`page shows a date or date wording: "${dm[0]}"`);
  for (const f of ['app.js', 'market.js']) {
    const js = read(dir, f);
    if (/toLocale(?:Date|Time)String|new Date\(|Date\.now|getFullYear|toISOString/.test(js)) e.push(`${f}: reads or formats a date`);
    if (!/prefers-reduced-motion: reduce/.test(js)) e.push(`${f}: must check prefers-reduced-motion`);
  }
  // links: external hrefs only to stated URLs
  for (const t of tags) {
    if (t.tag !== 'a' || !t.attrs.href) continue;
    if (/^https?:/i.test(t.attrs.href)) {
      if (![...statedUrls].some(u => t.attrs.href === u || t.attrs.href === u + '/')) e.push(`link to ${t.attrs.href} is not a stated record`);
      if (t.attrs.target === '_blank' && !/noopener/.test(t.attrs.rel || '')) e.push(`link ${t.attrs.href} missing rel=noopener`);
    }
  }
  // inert hosts never appear anywhere in the page
  for (const id of ['x', 'github']) if (isInert(R[id])) {
    const host = id === 'x' ? /x\.com|twitter\.com/i : /github\.com/i;
    if (host.test(html)) e.push(`${id}: inert record but its host appears in markup`);
  }
  // handle derived from url, never stored
  for (const r of reg.records) if ('handle' in r) e.push(`${r.id}: handle must be derived, not stored`);
  for (const id of ['x', 'github']) if (!isInert(R[id]) && !html.includes(handle(R[id]))) e.push(`${id}: derived handle ${handle(R[id])} not shown`);


  // market panel + ticker: driven by the market record alone. The contract address never gates the feed.
  const panelT = tags.filter(t => t.attrs.id === 'marketPanel'), tickT = tags.filter(t => t.attrs.id === 'marketTicker');
  if (panelT.length !== 1) e.push(`market: expected one #marketPanel, found ${panelT.length}`);
  if (tickT.length !== 1) e.push(`market: expected one #marketTicker, found ${tickT.length}`);
  if (panelT.length === 1 && tickT.length === 1) {
    const mk = R.market, mImg = R.marketimg;
    const mkO = isInert(mk) ? '' : new URL(mk.url).origin, imO = isInert(mImg) ? '' : new URL(mImg.url).origin;
    const p0 = panelT[0], t0 = tickT[0];
    const pHtml = html.slice(p0.index, html.indexOf('</ol>', p0.index));
    const tHtml = html.slice(t0.index, html.indexOf('<div class="scrim"', t0.index));
    for (const [n, t] of [['panel', p0], ['ticker', t0]]) {
      if (t.attrs['data-record'] !== 'market') e.push(`market ${n}: must belong to the market record, found ${t.attrs['data-record']}`);
      if (t.attrs['data-state'] !== mk.state) e.push(`market ${n}: data-state ${t.attrs['data-state']} != market ${mk.state}`);
    }
    if ((pHtml.match(/<li class="m-row/g) || []).length !== 10) e.push('market: panel must hold exactly 10 rows');
    if (!/class="m-status"[^>]*>\s*<span class="dot"/.test(pHtml)) e.push('market: status pill with its dot missing');
    const csp = (read(dir, '_headers').match(/Content-Security-Policy: (.*)/) || [])[1] || '';
    const dirv = n => ((csp.match(new RegExp(n + ' ([^;]*)')) || [])[1] || '').trim();
    if (isInert(mk)) {
      if ('data-endpoint' in p0.attrs || 'data-img-origin' in p0.attrs) e.push('market: inert panel carries an endpoint');
      if (/class="sk[ "]/.test(pHtml + tHtml)) e.push('market: inert render ships skeleton loaders');
      if (!/<ol class="m-rows" aria-hidden="true"/.test(pHtml)) e.push('market: inert rows must be aria-hidden');
      if (/class="t-set"|<button class="t-toggle"/.test(tHtml)) e.push('market: inert ticker must not carry live parts');
      if (/data-copy/.test(pHtml)) e.push('market: inert rows carry data-copy');
      if (dirv('connect-src') !== "'none'") e.push(`csp: inert market must keep connect-src 'none', found ${dirv('connect-src')}`);
      if (/https?:/.test(dirv('img-src'))) e.push('csp: inert market must not allow remote images');
    } else {
      if (p0.attrs['data-endpoint'] !== mkO) e.push(`market: data-endpoint ${p0.attrs['data-endpoint']} != register ${mkO}`);
      if ((p0.attrs['data-img-origin'] || '') !== imO) e.push(`market: data-img-origin ${p0.attrs['data-img-origin']} != register ${imO}`);
      if (!/aria-busy="true"/.test(pHtml) || !/class="sk"/.test(pHtml)) e.push('market: live panel must ship skeleton rows');
      if (!/class="t-toggle"/.test(tHtml) || !/class="sk /.test(tHtml)) e.push('market: live ticker must ship its pause control and skeleton');
      if (dirv('connect-src') !== mkO) e.push(`csp: connect-src ${dirv('connect-src')} != ${mkO}`);
      if (imO && !dirv('img-src').split(/\s+/).includes(imO)) e.push(`csp: img-src lacks ${imO}`);
    }
  }
  for (const f of ['app.js', 'market.js']) {
    const js = read(dir, f);
    if (/https?:\/\/[^\s'"`]/.test(js)) e.push(`${f}: hardcoded URL`);
    if (/dexscreener/i.test(js)) e.push(`${f}: hardcoded market host`);
  }
  if (/\bca\b|data-record="ca"|getAttribute\('data-state'\)\s*!==\s*'stated'.*ca/.test(read(dir, 'market.js').replace(/\/\*[\s\S]*?\*\//g, ''))) e.push('market.js must not look at the contract address');

  // visual layer: hero with depth layers, progress bar, reduced-motion fallback for everything
  const heroT = tags.filter(t => t.attrs.class === 'hero');
  if (heroT.length !== 1) e.push('hero: expected one .hero');
  else {
    const hh = html.slice(heroT[0].index, html.indexOf('</section>', heroT[0].index));
    if ((hh.match(/data-depth="/g) || []).length < 4) e.push('hero: needs at least 4 parallax depth layers');
    if (!/class="hero-mesh"/.test(hh)) e.push('hero: gradient mesh layer missing');
    if (!/<h1 class="page-title"/.test(hh)) e.push('hero: must hold the h1');
  }
  if (!/<div class="progress"[^>]*><span><\/span><\/div>/.test(html)) e.push('scroll progress bar missing');
  const css = read(dir, 'styles.css');
  if (!/prefers-reduced-motion: reduce\)\s*\{[^}]*\}?[\s\S]*\*, \*::before, \*::after \{ animation: none !important; transition: none !important; \}/.test(css)) e.push('reduced-motion block must switch off every animation and transition universally');
  if (!/prefers-reduced-motion[\s\S]*\.sk\b/.test(css)) e.push('reduced-motion block must cover skeleton shimmer');
  for (const kf of ['ping', 'mesh-shift', 'drift-a', 'flash-up', 'marquee', 'shimmer', 'rise']) if (!new RegExp('@keyframes ' + kf + '\\b').test(css)) e.push(`keyframes ${kf} missing`);
  if (!/radial-gradient\(260px circle at var\(--mx/.test(css)) e.push('spotlight gradient missing');

  // CSP-friendliness and structure
  if (/\sstyle="/.test(html)) e.push('inline style attribute present');
  if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) e.push('inline script present');
  if (!/<meta name="viewport"/.test(html)) e.push('viewport meta missing');
  if (!/rel="icon"[^>]*favicon\.svg/.test(html)) e.push('favicon.svg not linked');
  return e;
}

// ---------------------------------------------------------------- assets, css rules
export function checkStatic(dir) {
  const e = [];
  const files = walk(dir);
  const allowed = /^(index\.html|tokens\.css|styles\.css|app\.js|market\.js|favicon\.svg|robots\.txt|_headers|assets\/[\w.-]+\.(png|jpg))$/;
  for (const f of files) if (!allowed.test(f)) e.push(`dist holds unexpected file ${f}`);
  for (const f of ['README.md', 'LICENSE', 'docs', 'tools', 'brand', 'reference', 'package.json']) if (files.some(x => x === f || x.startsWith(f + '/'))) e.push(`repo file ${f} leaked into dist`);
  const css = read(dir, 'styles.css');
  if (!/@media \(prefers-reduced-motion: reduce\)/.test(css)) e.push('prefers-reduced-motion block missing');
  if (!/animation:\s*none/.test(css)) e.push('reduced-motion block must disable animation');
  if (/\d\s*ch\b/.test(css)) e.push('ch unit used');
  if (!/--tap:\s*44px/.test(css)) e.push('--tap: 44px not declared');
  // favicon
  const fav = read(dir, 'favicon.svg');
  if (!/width="32" height="32" viewBox="0 0 32 32"/.test(fav)) e.push('favicon must be 32x32');
  if (fav.includes('<!--') || /--/.test(fav)) e.push('favicon contains a double hyphen or a comment');
  if (!/^<svg [^>]+>(<rect [^>]+\/>)+<\/svg>\s*$/.test(fav)) e.push('favicon is not a plain rect trace');
  for (const m of fav.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)"/g)) if (+m[1] + +m[3] > 32 || +m[2] > 31) e.push('favicon rect outside grid');
  // logos: RGBA, no black halo from naive resize
  for (const f of files.filter(x => /^assets\/logo-\d+\.png$/.test(x))) {
    const b = readFileSync(join(dir, f));
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20), ct = b[25], il = b[28];
    if (ct !== 6 || b[24] !== 8 || il !== 0) { e.push(`${f}: expected 8-bit RGBA non-interlaced`); continue; }
    const px = decodePng(b, w, h);
    let edge = 0, dark = 0;
    for (let i = 0; i < w * h; i++) { const a = px[i * 4 + 3]; if (a > 0 && a < 255) { edge++; if (Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) < 24) dark++; } }
    if (edge > 20 && dark / edge > 0.02) e.push(`${f}: ${(100 * dark / edge).toFixed(1)}% of edge pixels are near-black (non-premultiplied resize)`);
  }
  return e;
}

export function decodePng(b, w, h) {
  let p = 8; const idat = [];
  while (p < b.length) { const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8); if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len)); p += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)); const bpp = 4, stride = w * bpp; const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, up = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += up; else if (ft === 3) v += (a + up) >> 1;
      else if (ft === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? up : c); }
      out[y * stride + x] = v & 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------- palette rule
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[\d.%-]/gi;
const NAMED = /[:\s](?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|cyan|magenta|silver|navy|teal|maroon)\s*[;,)}]/i;
export function checkPalette(dir, tokensPath) {
  const e = [];
  for (const f of walk(dir)) {
    if (f === 'tokens.css' || f === 'favicon.svg' || !TEXT.has(extname(f))) continue;
    const t = read(dir, f).replace(/&#\d+;/g, '');
    const code = f === 'index.html' ? t.replace(/<path [^>]*>/g, '') : t;
    const hits = [...(code.match(HEX) || []), ...(code.match(FN) || [])];
    if (hits.length) e.push(`${f}: colour literal outside tokens.css: ${hits.slice(0, 3).join(' ')}`);
    if (['styles.css', 'app.js'].includes(f) && NAMED.test(code)) e.push(`${f}: named colour keyword`);
  }
  const tok = readFileSync(tokensPath, 'utf8');
  const vars = [...tok.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});\s*\/\*\s*(banner|logo) px \((\d+),(\d+)\)/g)];
  if (vars.length < 8) e.push(`tokens.css: expected provenance comment on every token, found ${vars.length}`);
  if (/--[\w-]+:\s*#[0-9a-f]{6};(?!\s*\/\*\s*(banner|logo) px)/.test(tok)) e.push('tokens.css: a token lacks its provenance comment');
  return e;
}

// ---------------------------------------------------------------- address scanner (shape -> stated registry)
export function checkAddresses(dir, reg) {
  const e = [];
  const stated = new Set(reg.records.filter(r => !isInert(r) && r.kind === 'address').map(r => r.value));
  const SHAPES = [/\b0x[0-9a-fA-F]{40}\b/g, /(?<![A-Za-z0-9_-])[1-9A-HJ-NP-Za-km-z]{32,44}(?![A-Za-z0-9_-])/g];
  for (const f of walk(dir)) {
    if (!TEXT.has(extname(f))) continue;
    const t = read(dir, f);
    for (const re of SHAPES) for (const m of t.matchAll(re)) {
      if (stated.has(m[0])) continue;                       // matches a stated registry record (the CA included)
      if (re === SHAPES[1] && !isSolanaAddress(m[0])) continue; // 32-44 base58 chars that do not decode to 32 bytes are not addresses
      e.push(`${f}: address-shaped string ${m[0].slice(0, 12)}... matches no stated record`);
    }
  }
  return e;
}

// ---------------------------------------------------------------- copy originality vs reference fingerprint
const STOP = new Set(`a an the and or but if of to in on at by for from with as is are was were be been being it its this that these those there their they them he she we you your our us i not no yes do does did done can could will would should may might must has have had so than then too very just also into over under up down out off about after before between each every any all some such own more most other only same both few how when where which who whom what why while until once here again further per via within without across among onto upon`.split(/\s+/));
// Words the brief itself dictates (identifiers, domain, mandated headings). Everything else must be disjoint from the reference.
export const BRIEF_WORDS = new Set(['x', 'github', 'rpc', 'org', 'com', 'json', 'md', 'docs', 'whitepaper', 'contract', 'chain', 'vision', 'roadmap', 'build', 'overview', 'links', 'api']);
export function checkOriginality(texts, fp) {
  const e = [];
  const refWords = new Set(fp.words), refBi = new Set(fp.bigrams);
  for (const [name, t] of Object.entries(texts)) {
    const sharedBi = [...bigrams(t)].filter(b => refBi.has(sha(b)));
    if (sharedBi.length) e.push(`${name}: ${sharedBi.length} shared 2-gram(s): ${sharedBi.slice(0, 8).join(' | ')}`);
    const sharedW = [...new Set(words(t))].filter(w => !STOP.has(w) && !BRIEF_WORDS.has(w) && refWords.has(sha(w)));
    if (sharedW.length) e.push(`${name}: ${sharedW.length} shared word(s): ${sharedW.slice(0, 20).join(', ')}`);
  }
  return e;
}
export { visibleText, STOP };
