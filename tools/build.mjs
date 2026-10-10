// Static build: src/ + register.json -> dist/. No dependencies.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validate, isInert, handle } from './lib-register.mjs';
import { xSvg, ghSvg } from './icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 00-2 2v14h2V3h12zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11z"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6z"/></svg>';

const ICONS = {
  x: xSvg('mark x-icon'),
  github: ghSvg('mark gh-icon'),
};
const wordFor = r => ({ absent: 'not announced yet', unconfirmed: 'unconfirmed' }[r.state]);
const inertNote = r => wordFor(r);

export function build({ src = join(ROOT, 'src'), out = join(ROOT, 'dist') } = {}) {
  const reg = JSON.parse(readFileSync(join(src, 'register.json'), 'utf8'));
  const errs = validate(reg);
  if (errs.length) throw new Error('register invalid:\n  ' + errs.join('\n  '));
  const R = Object.fromEntries(reg.records.map(r => [r.id, r]));

  // ---- social (top-right): one markup path for both states, icon only, never an href unless stated
  const social = (id, cls) => {
    const r = R[id];
    const label = r.label;
    if (isInert(r)) {
      return `<span class="${cls} is-inert" role="img" aria-disabled="true" data-record="${id}" data-state="${r.state}" aria-label="${esc(label)}, ${esc(inertNote(r))}" title="${esc(label)} · ${esc(inertNote(r))}">${ICONS[id]}</span>`;
    }
    return `<a class="${cls}" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" data-record="${id}" data-state="stated" aria-label="${esc(label)} ${esc(handle(r))}" title="${esc(label)} ${esc(handle(r))}">${ICONS[id]}</a>`;
  };
  const socialHtml = social('x', 'social-link') + social('github', 'social-link');
  const footerSocial = ['x', 'github'].map(id => `<li>${social(id, 'social-link')}</li>`).join('');

  // ---- contract address slot
  const ca = R.ca;
  const caHtml = isInert(ca)
    ? `<div class="ca" id="ca" data-record="ca" data-state="${ca.state}">
    <div class="ca-inner">
      <span class="ca-label">Contract address</span>
      <span class="ca-value is-inert">${esc(wordFor(ca))}</span>
      <button class="ca-copy" type="button" disabled aria-disabled="true">${COPY_ICON}<span>Copy</span></button>
    </div>
  </div>`
    : `<div class="ca" id="ca" data-record="ca" data-state="stated">
    <div class="ca-inner">
      <span class="ca-label">Contract address</span>
      <span class="ca-hint">tap to copy</span>
      <button class="ca-value" type="button" data-copy="${esc(ca.value)}" aria-label="Copy contract address ${esc(ca.value)}">${esc(ca.value)}</button>
      <button class="ca-copy" type="button" data-copy="${esc(ca.value)}">${COPY_ICON}<span>Copy</span></button>
      <span class="ca-toast" role="status" aria-live="polite"></span>
    </div>
  </div>`;


  // ---- market panel + ticker: driven by the market record alone; the contract address plays no part
  const live = !isInert(R.market);
  const mkOrigin = live ? new URL(R.market.url).origin : '';
  const imgOrigin = live && !isInert(R.marketimg) ? new URL(R.marketimg.url).origin : '';
  const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="p-bars" d="M6 5h4v14H6zm8 0h4v14h-4z"/><path class="p-play" d="M8 5v14l11-7z"/></svg>';
  const cell = (cls, label) => `<span class="m-cell ${cls}" data-label="${label}">${live ? '<span class="sk"></span>' : '<span class="dash" aria-hidden="true"></span>'}</span>`;
  const mrow = i => `<li class="m-row${live ? ' is-skel' : ''}"><span class="m-rank">${i + 1}</span><span class="m-token"><span class="m-logo">${live ? '<span class="sk sk-logo"></span>' : '<span class="tile tile-dim" aria-hidden="true"></span>'}</span><span class="m-id"><span class="m-sym">${live ? '<span class="sk"></span>' : '<span class="dash" aria-hidden="true"></span>'}</span><span class="m-full"></span></span></span>${cell('m-price', 'Price')}${cell('m-chg', '24h')}${cell('m-vol', 'Volume')}${cell('m-liq', 'Liquidity')}<span class="m-act"><button class="m-copy" type="button" disabled aria-label="Copy address unavailable"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 00-2 2v14h2V3h12zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11z"/></svg></button></span></li>`;
  const marketHtml = `<div class="market${live ? '' : ' is-inert'}" id="marketPanel" role="region" aria-label="Market grid" data-record="market" data-state="${R.market.state}"${live ? ` data-endpoint="${esc(mkOrigin)}"${imgOrigin ? ` data-img-origin="${esc(imgOrigin)}"` : ''}` : ''}>
    <div class="m-head"><span class="m-title">Top Solana pairs by 24h volume</span><span class="m-status" role="status" aria-live="polite" data-kind=""><span class="dot" aria-hidden="true"></span><span class="m-st-text">${live ? 'Loading market figures…' : 'Market feed pending'}</span></span><button class="m-retry" type="button" hidden>Retry</button></div>
    <div class="m-cols" aria-hidden="true"><span>#</span><span>Token</span><span>Price</span><span>24h</span><span>Volume</span><span>Liquidity</span><span></span></div>
    <ol class="m-rows"${live ? ' aria-busy="true"' : ' aria-hidden="true"'}>${Array.from({ length: 10 }, (_, i) => mrow(i)).join('')}</ol>
    <p class="m-foot">${live ? `Feed: ${esc(handle(R.market))}. ` : ''}These figures describe other assets, never Muono.</p>
    <span class="m-live sr" role="status" aria-live="polite"></span>
  </div>`;
  const tickerHtml = live
    ? `<div class="ticker is-skel" id="marketTicker" role="region" aria-label="Price strip" data-record="market" data-state="stated"><button class="t-toggle" type="button" aria-pressed="false" aria-label="Pause strip">${PAUSE}</button><div class="t-view"><div class="t-track">${'<span class="t-item"><span class="sk sk-logo"></span><span class="sk sk-bar"></span></span>'.repeat(8)}</div></div></div>`
    : `<div class="ticker is-inert" id="marketTicker" role="region" aria-label="Price strip" data-record="market" data-state="${R.market.state}"><div class="t-view"><div class="t-track"><span class="t-msg">Price strip pending</span></div></div></div>`;
  const marketIntro = live
    ? 'Ten Solana pairs, ranked by trading volume over the past day, drawn from a public market feed and refreshed every minute. Each one has its own team and none is Muono.'
    : 'Prices, volume and liquidity covering the busiest Solana pairs appear here once the market feed is switched on. Until then each figure stays a dash and nothing is fetched.';

  // ---- sidebar
  const row = (label, href, id) => {
    const r = id ? R[id] : null;
    if (r && isInert(r)) return `<li class="node"><div class="nav-row"><span class="twisty leaf"></span><span class="nav-link is-inert" aria-disabled="true" data-record="${id}" data-state="${r.state}" title="${esc(inertNote(r))}"><span class="label">${esc(label)}</span><span class="tag">pending</span></span></div></li>`;
    return `<li class="node"><div class="nav-row"><span class="twisty leaf"></span><a class="nav-link" href="${esc(href)}"${href.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}><span class="label">${esc(label)}</span></a></div></li>`;
  };
  const group = (label, href, kids) => `<li class="node open"><div class="nav-row"><button class="twisty" type="button" aria-label="Expand ${esc(label)}" aria-expanded="true">${CHEV}</button><a class="nav-link" href="${href}"><span class="label">${esc(label)}</span></a></div><ul class="children">${kids}</ul></li>`;
  const nav =
    `<li class="node active"><div class="nav-row"><span class="twisty leaf"></span><a class="nav-link" href="#top"><span class="label">Top</span></a></div></li>` +
    group('Begin', '#overview', row('About Muono', '#overview') + row('Facts at a glance', '#facts') + row('Market pulse', '#market') + row('Walkthrough', '#walkthrough')) +
    group('Records', '#facts', row('Chain', '#facts') + row('Contract address', '#ca', 'ca') + row('RPC endpoint', R.rpc.url || '#facts', 'rpc') + row('X', R.x.url || '#', 'x') + row('GitHub', R.github.url || '#', 'github')) +
    group('Notes', '#log', row('Status log', '#log') + row('Notice', '#notice') + row('Contact', '#contact'));

  // ---- lead sentence is computed so it can never contradict the register
  const external = reg.records.filter(r => ['ca', 'x', 'github'].includes(r.id));
  const waiting = external.filter(isInert);
  const lead = waiting.length === 0
    ? `Every public record is confirmed. Addresses and accounts here are copied straight from the register.`
    : `${waiting.length} of ${external.length} public records (${waiting.map(r => r.label).join(', ')}) ${waiting.length === 1 ? 'remains' : 'remain'} pending. Their slots stay dimmed until the team confirms them.`;

  // ---- tiles
  const tile = (r, valueHtml) => `<div class="stat${isInert(r) ? ' is-inert' : ''}" data-record="${r.id}" data-state="${r.state}"><span class="stat-label">${esc(r.label)}</span><span class="stat-value">${valueHtml}</span><span class="stat-meta">${isInert(r) ? esc(inertNote(r)) : esc(r.source + (r.scope ? ' · ' + r.scope : ''))}</span></div>`;
  const dash = '<span class="dash" aria-hidden="true"></span><span class="sr">pending</span>';
  const facts = [
    tile(R.chain, esc(R.chain.value)),
    tile(R.ca, isInert(R.ca) ? dash : `<span class="mono wrap">${esc(R.ca.value)}</span>`),
    tile(R.rpc, `<a href="${esc(R.rpc.url)}" target="_blank" rel="noopener noreferrer">${esc(handle(R.rpc))}</a>`),
    tile(R.domain, `<a href="${esc(R.domain.url)}">${esc(handle(R.domain))}</a>`),
    tile(R.x, isInert(R.x) ? dash : `<a href="${esc(R.x.url)}" target="_blank" rel="noopener noreferrer">${esc(handle(R.x))}</a>`),
    tile(R.github, isInert(R.github) ? dash : `<a href="${esc(R.github.url)}" target="_blank" rel="noopener noreferrer">${esc(handle(R.github))}</a>`),
  ].join('');

  // ---- chips
  const chip = (id, label) => {
    const r = R[id];
    return isInert(r)
      ? `<span class="qs-chip is-inert" aria-disabled="true" data-record="${id}" data-state="${r.state}" title="${esc(inertNote(r))}">${esc(label)} · pending</span>`
      : `<a class="qs-chip" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" data-record="${id}" data-state="stated">${esc(label)}</a>`;
  };

  // ---- log
  const log = [`<li>Reference desk published.</li>`]
    .concat(reg.records.map(r => isInert(r)
      ? `<li class="is-inert" data-record="${r.id}" data-state="${r.state}">${esc(r.label)}: ${esc(wordFor(r))}.</li>`
      : `<li data-record="${r.id}" data-state="stated">${esc(r.label)}: stated (${esc(r.source)}${r.scope ? ', ' + esc(r.scope) : ''}).</li>`)).join('');

  // ---- cards
  const IC = {
    about: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 110 14 7 7 0 010-14zm0 3a4 4 0 100 8 4 4 0 000-8z"/>',
    facts: '<path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>',
    path: '<path d="M6 3a3 3 0 012.83 2H15a4 4 0 010 8H9a2 2 0 000 4h6.17A3 3 0 1118 19.83V20H9a4 4 0 010-8h6a2 2 0 000-4H8.83A3 3 0 116 3z"/>',
    log: '<path d="M4 4h16v4H4zm0 6h16v4H4zm0 6h10v4H4z"/>',
    notice: '<path d="M12 2L1 21h22zm1 15h-2v-2h2zm0-4h-2V9h2z"/>',
    chart: '<path d="M3 3h2v16h16v2H3zm4 9h3v6H7zm5-5h3v11h-3zm5 3h3v8h-3z"/>',
    mail: '<path d="M2 5h20v14H2zm2 2v.5l8 5 8-5V7zm16 3.8l-8 5-8-5V17h16z"/>',
  };
  const card = (href, ic, title, text) => `<a class="doc-card" href="${href}"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[ic]}</svg></span><span class="tx"><h3>${esc(title)}</h3><p>${esc(text)}</p></span></a>`;
  const cards = [
    card('#overview', 'about', 'About', 'About Muono and how this page works.'),
    card('#facts', 'facts', 'Facts', 'Chain, address, accounts and endpoints.'),
    card('#market', 'chart', 'Market', 'Prices, volume and liquidity, live.'),
    card('#walkthrough', 'path', 'Walkthrough', 'A brief path from curiosity to staying current.'),
    card('#log', 'log', 'Status log', 'One line per record.'),
    card('#notice', 'notice', 'Notice', 'Risk, in plain words.'),
    card('#contact', 'mail', 'Contact', 'Where official channels will appear.'),
  ].join('');

  const domainUrl = R.domain.url.replace(/\/$/, '');
  const paperChip = isInert(R.github)
    ? `<span class="qs-chip is-inert" aria-disabled="true" data-record="github" data-state="${R.github.state}" title="${esc(inertNote(R.github))}">Whitepaper · waiting on repository</span>`
    : `<a class="qs-chip" href="${esc(R.github.url)}" target="_blank" rel="noopener noreferrer" data-record="github" data-state="stated">Visit the repository</a>`;

  const map = {
    domain_url: esc(domainUrl), social: socialHtml, ca: caHtml, nav, lead: esc(lead), facts, cards, log, market: marketHtml, ticker: tickerHtml, market_intro: esc(marketIntro),
    chip_rpc: chip('rpc', 'Public RPC endpoint'), chip_x: chip('x', 'X'), chip_github: chip('github', 'GitHub'), chip_paper: paperChip,
    footer_domain: `<a href="${esc(R.domain.url)}">${esc(handle(R.domain))}</a>`, footer_social: footerSocial,
  };
  let html = readFileSync(join(src, 'index.html'), 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in map)) throw new Error('unknown template marker ' + k);
    return map[k];
  });

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'index.html'), html);
  for (const f of ['tokens.css', 'styles.css', 'app.js', 'market.js', 'favicon.svg']) cpSync(join(src, f), join(out, f));
  cpSync(join(src, 'assets'), join(out, 'assets'), { recursive: true });
  writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n`);
  writeFileSync(join(out, '_headers'), `/*\n  Content-Security-Policy: default-src 'self'; img-src 'self' data:${live ? ' ' + imgOrigin : ''}; style-src 'self'; script-src 'self'; connect-src ${live ? mkOrigin : "'none'"}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`);
  return { reg, out };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { out } = build();
  console.log('built ->', out);
}
