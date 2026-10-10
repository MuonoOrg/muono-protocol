// npm run gates -- exits 0 only if every gate passes, both register branches included.
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from './build.mjs';
import { validate, flip, isInert } from './lib-register.mjs';
import { checkBuild, checkStatic, checkPalette, checkAddresses, checkOriginality, walk, visibleText } from './lib-checks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const SRC = join(ROOT, 'src');
const results = [];
let failed = 0;
function gate(name, errs) {
  const ok = errs.length === 0;
  if (!ok) failed++;
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  for (const m of errs) console.log('      - ' + m);
}
const readReg = () => JSON.parse(readFileSync(join(SRC, 'register.json'), 'utf8'));
const expectFail = (name, errs) => gate(`negative control: ${name} is caught`, errs.length ? [] : ['checker accepted a known-bad input']);
const allChecks = (out, reg) => [...checkBuild(out, reg), ...checkStatic(out), ...checkPalette(out, join(SRC, 'tokens.css')), ...checkAddresses(out, reg)];

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// 1. register rule
const reg = readReg();
gate('register: every record stated|absent|unconfirmed, inert records carry no value or url', validate(reg));
{
  const bad = JSON.parse(JSON.stringify(reg)); bad.records.find(r => r.id === 'x').value = 'x';
  expectFail('inert record carrying a value', validate(bad));
  const bad2 = JSON.parse(JSON.stringify(reg)); bad2.records.find(r => r.id === 'github').url = 'https://github.com/a';
  expectFail('inert record carrying a url', validate(bad2));
  const bad3 = flip(reg, 'ca'); const c = bad3.records.find(r => r.id === 'ca'); if (c.state === 'stated') c.value = '0x' + 'a'.repeat(40);
  expectFail('stated CA that is not a Solana address', validate(bad3));
}

// 2. real build, and dist is current
const real = build({ out: join(TMP, 'real') });
gate('build: structure, register behaviour, assets, palette, address scan (real register)', allChecks(join(TMP, 'real'), real.reg));
{
  const errs = [];
  if (!existsSync(join(ROOT, 'dist'))) errs.push('dist/ missing; run npm run build');
  else {
    const a = walk(join(TMP, 'real')), b = walk(join(ROOT, 'dist'));
    if (a.join() !== b.join()) errs.push('dist file list differs from a fresh build');
    for (const f of a) if (b.includes(f) && !readFileSync(join(TMP, 'real', f)).equals(readFileSync(join(ROOT, 'dist', f)))) errs.push(`dist/${f} is stale`);
  }
  gate('dist/ matches a fresh build', errs);
}

// 3. mutation harness. Anchors are state-independent: flip() reads each record's current state at runtime.
for (const id of ['ca', 'x', 'github', 'market']) {
  const cur = reg.records.find(r => r.id === id).state;
  const mut = flip(reg, id);
  const now = mut.records.find(r => r.id === id).state;
  const out = join(TMP, 'mut-' + id);
  build({ src: tmpSrc(mut, 'mut-' + id), out });
  gate(`mutation ${id}: ${cur} -> ${now} builds and passes every check`, [
    ...(cur === now ? ['flip did not change state'] : []), ...validate(mut), ...allChecks(out, mut),
  ]);
  // and back again: an inert-to-stated flip must return to the shipped dist byte for byte. A stated record flips
  // to inert and back through a fixture value, so it can only be required to pass every check.
  const back = flip(mut, id);
  const out2 = join(TMP, 'back-' + id);
  build({ src: tmpSrc(back, 'back-' + id), out: out2 });
  if (cur !== 'stated') {
    const diff = [];
    for (const f of walk(out2)) if (!readFileSync(join(out2, f)).equals(readFileSync(join(ROOT, 'dist', f)))) diff.push(`${f} differs after round trip`);
    gate(`mutation ${id}: round trip returns to the shipped dist byte for byte`, diff);
  } else gate(`mutation ${id}: flipping back to stated passes every check`, allChecks(out2, back));
  // the contract address never gates the market feed
  if (id === 'ca') {
    const h = f => readFileSync(join(f, 'index.html'), 'utf8').match(/<div class="market[^>]*id="marketPanel"[^>]*>/)[0];
    gate('mutation ca: market panel markup is identical whether the CA is stated or absent', h(join(ROOT, 'dist')) === h(out) ? [] : ['market panel changed with the CA state']);
  }
}
{
  let all = reg;
  for (const id of ['ca', 'x', 'github']) all = flip(all, id);
  const out = join(TMP, 'mut-all');
  build({ src: tmpSrc(all, 'mut-all'), out });
  gate('mutation all three at once: every check passes', allChecks(out, all));
}
function tmpSrc(mutReg, name) {
  const d = join(TMP, 'src-' + name);
  mkdirSync(d, { recursive: true });
  for (const f of ['index.html', 'tokens.css', 'styles.css', 'app.js', 'market.js', 'favicon.svg']) writeFileSync(join(d, f), readFileSync(join(SRC, f)));
  mkdirSync(join(d, 'assets'), { recursive: true });
  for (const f of readdirSync(join(SRC, 'assets'))) writeFileSync(join(d, 'assets', f), readFileSync(join(SRC, 'assets', f)));
  writeFileSync(join(d, 'register.json'), JSON.stringify(mutReg, null, 2));
  return d;
}

// 4. both branches of the gate warning (address scanner)
{
  const stated = flip(reg, 'ca');
  const out = join(TMP, 'scan');
  build({ src: tmpSrc(stated, 'scan'), out });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const hex40 = '0x' + 'ab12'.repeat(10);
  const withHexUnknown = { ...stated };
  gate('scanner: stated CA is exempt and passes', checkAddresses(out, stated));
  writeFileSync(join(out, 'index.html'), html + `<!-- ${hex40} -->`);
  expectFail('unlisted 0x address in page', checkAddresses(out, stated));
  const withHex = JSON.parse(JSON.stringify(stated)); withHex.records.push({ id: 'evm', label: 'EVM', kind: 'address', state: 'stated', value: hex40, source: 'harness', asOf: reg.asOf });
  gate('scanner: 0x hex is not blanket-rejected when it matches a stated record', checkAddresses(out, withHex));
  const real2 = join(TMP, 'real');
  const h2 = readFileSync(join(real2, 'index.html'), 'utf8');
  writeFileSync(join(out, 'index.html'), h2 + '<!-- 4Nd1mxyQQnTfTpQL1sjRGrZgZtkbXE2yE3dsPKtH9n6B -->');
  expectFail('unlisted Solana address when CA is absent', checkAddresses(out, reg));
}

// 5. other negative controls
{
  const out = join(TMP, 'neg');
  build({ src: tmpSrc(reg, 'neg'), out });
  const idx = join(out, 'index.html');
  const html = readFileSync(idx, 'utf8');
  writeFileSync(idx, html.replace(/<span class="social-link is-inert"([^>]*data-record="x")/, '<a href="https://x.com/someone" class="social-link is-inert"$1'));
  expectFail('href on an inert X icon', checkBuild(out, reg));
  writeFileSync(idx, html);
  const css = join(out, 'styles.css'); const c0 = readFileSync(css, 'utf8');
  writeFileSync(css, c0 + '\n.zz { color: #ff0000; }');
  expectFail('hex literal outside tokens.css', checkPalette(out, join(SRC, 'tokens.css')));
  writeFileSync(css, c0 + '\n.zz { width: 40ch; }');
  expectFail('ch unit', checkStatic(out));
  writeFileSync(css, c0);
  writeFileSync(join(out, 'favicon.svg'), readFileSync(join(out, 'favicon.svg'), 'utf8').replace('<rect', '<!-- a--b --><rect'));
  expectFail('double hyphen in favicon', checkStatic(out));
}

// 6. palette provenance: every token is a real pixel in its source file
{
  const py = spawnSync('python', ['-I', join(ROOT, 'tools', 'verify-palette.py')], { encoding: 'utf8' });
  gate('palette: every token equals the real pixel at its recorded coordinate', py.status === 0 ? [] : [(py.stdout + py.stderr).trim() || 'verify-palette.py failed']);
}


// 9. market logic: ranking, filtering, batching, backoff, formatting (pure functions, mocked network, generated addresses)
{
  const vm = await import('node:vm');
  const { createHash } = await import('node:crypto');
  const { b58encode } = await import('./lib-register.mjs');
  const ctx = { console, setTimeout, clearTimeout, URL };
  vm.runInNewContext(readFileSync(join(SRC, 'market.js'), 'utf8'), ctx);
  const M = ctx.MuonoMarket;
  const addr = i => b58encode(createHash('sha256').update('fixture-token-' + i).digest());
  const mkPair = (i, o = {}) => ({ chainId: 'solana', baseToken: { address: addr(i), name: 'T' + i, symbol: 'S' + i }, priceUsd: String(i / 100), priceChange: { h24: i - 5 }, volume: { h24: o.vol ?? i * 1000 }, liquidity: { usd: o.liq ?? 5000 }, info: { imageUrl: '' } });
  const boost = (i, chainId = 'solana') => ({ chainId, tokenAddress: addr(i) });
  const errs = [];
  const want = (cond, msg) => { if (!cond) errs.push(msg); };
  const ids = n => Array.from({ length: n }, (_, k) => k + 1);

  // ranking and filtering
  const boosts = [...ids(14).map(i => boost(i)), boost(3), boost(900, 'ethereum'), { chainId: 'solana', tokenAddress: 'abc' }];
  const pairs = [...ids(14).map(i => mkPair(i)), mkPair(3, { vol: 99999999, liq: 10 }), { ...mkPair(900), chainId: 'ethereum' }, { ...mkPair(901), baseToken: { address: addr(1), symbol: 'Q' }, chainId: 'solana' }, { ...mkPair(5), volume: { h24: null }, baseToken: { address: addr(77), symbol: 'N' } }];
  const top = M.selectTop(boosts, pairs, 10);
  want(top.length === 10, `selectTop returned ${top.length}, wanted 10`);
  want(top.every((t, k) => k === 0 || top[k - 1].volume >= t.volume), 'selectTop not sorted by 24h volume');
  want(top[0].address === addr(14), 'highest-volume token should lead');
  want(new Set(top.map(t => t.address)).size === 10, 'duplicates in result');
  want(!top.some(t => t.address === addr(900) || t.address === addr(77)), 'non-Solana or unlisted token leaked in');
  want(M.selectTop(boosts, pairs, 14).find(t => t.address === addr(3)).volume === 3000, 'pair choice must follow liquidity, not the louder thin pair');
  gate('market: Solana-only filter, dedupe, best-liquidity pair, volume ranking, top 10', errs.splice(0));

  // backoff schedule
  const sched = [0, 1, 2, 3, 4, 5, 9].map(n => M.backoffDelay(n, 0));
  want(sched.join() === '1000,2000,4000,8000,16000,30000,30000', `backoff schedule ${sched.join()}`);
  let inBand = true; for (let k = 0; k < 300; k++) { const d = M.backoffDelay(3, 0.2); if (d < 6400 || d > 9600) inBand = false; }
  want(inBand, 'jitter outside +-20%');
  gate('market: backoff is exponential, capped and jittered', errs.splice(0));

  // network behaviour with a mock
  const BASE = 'https://mock.invalid';
  const mock = (plan) => { const calls = []; const f = async (url) => { calls.push(url); const r = plan(url, calls.length); if (r instanceof Error) throw r; return { ok: r.status === undefined, status: r.status || 200, json: async () => r.body }; }; f.calls = calls; return f; };
  const answer = (n) => (url) => url.includes('/token-boosts/') ? { body: ids(n).map(i => boost(i)) } : { body: url.split('/').pop().split(',').map(a => { const i = ids(n).find(k => addr(k) === a); return mkPair(i); }) };
  {
    const f = mock((u, c) => c <= 2 ? new Error('net') : answer(14)(u)); const waits = [];
    const r = await M.loadTop({ fetch: f, base: BASE, sleep: async d => waits.push(d), jitter: 0 });
    want(r.length === 10, 'recovery should yield 10 rows');
    want(waits.join() === '1000,2000', `retry waits ${waits.join()}`);
    gate('market: transient failures retry with 1s, 2s then succeed', errs.splice(0));
  }
  {
    const f = mock(() => ({ status: 500, body: {} })); const waits = []; let msg = '';
    try { await M.loadTop({ fetch: f, base: BASE, sleep: async d => waits.push(d), jitter: 0 }); } catch (e) { msg = e.message; }
    want(msg === 'HTTP 500', `expected HTTP 500 after exhaustion, got "${msg}"`);
    want(waits.join() === '1000,2000,4000,8000', `exhaustion waits ${waits.join()}`);
    want(f.calls.length === 5, `expected 5 attempts, saw ${f.calls.length}`);
    gate('market: persistent failure gives up after 5 attempts and surfaces the error', errs.splice(0));
  }
  {
    const f = mock(answer(65)); const r = await M.loadTop({ fetch: f, base: BASE, sleep: async () => {}, jitter: 0 });
    const pairCalls = f.calls.filter(u => u.includes('/tokens/v1/solana/'));
    want(pairCalls.length === 3 && pairCalls.map(u => u.split('/').pop().split(',').length).join() === '30,30,5', 'pair requests must be batched 30/30/5');
    want(f.calls.every(u => u.startsWith(BASE + '/')), 'every request must use the injected base');
    want(r.length === 10, 'batched load should still return 10 rows');
    gate('market: addresses are batched 30 per request and every call uses the register endpoint', errs.splice(0));
  }
  {
    const f = mock(() => ({ body: { not: 'an array' } })); let msg = '';
    try { await M.loadTop({ fetch: f, base: BASE, sleep: async () => {}, attempts: 1 }); } catch (e) { msg = e.message; }
    want(/unexpected/.test(msg), `malformed payload should be rejected, got "${msg}"`);
    const g = mock(() => ({ body: [{ chainId: 'base', tokenAddress: addr(1) }] })); msg = '';
    try { await M.loadTop({ fetch: g, base: BASE, sleep: async () => {}, attempts: 1 }); } catch (e) { msg = e.message; }
    want(/no Solana/.test(msg), `feed without Solana entries should be rejected, got "${msg}"`);
    gate('market: malformed or Solana-free payloads are errors, never empty success', errs.splice(0));
  }

  // formatting + fallbacks
  want(M.fmtPrice(0.00001234) === '$0.00001234', `fmtPrice small: ${M.fmtPrice(0.00001234)}`);
  want(M.fmtPrice(1234.5) === '$1,234.50', `fmtPrice large: ${M.fmtPrice(1234.5)}`);
  want(M.fmtPrice(null) === M.DASH && M.fmtUsd(null) === M.DASH && M.fmtChange(null).text === M.DASH, 'missing values must render as a dash');
  want(M.fmtUsd(2841495.82) === '$2.84M', `fmtUsd: ${M.fmtUsd(2841495.82)}`);
  want(M.fmtChange(2088).text === '+2,088%' && M.fmtChange(2088).dir === 'up', 'fmtChange up');
  want(M.fmtChange(-3.456).text === '\u22123.46%' && M.fmtChange(-3.456).dir === 'down', 'fmtChange down');
  want(M.letterFor('', '') === '?' && M.letterFor('qOMPUTE', '') === 'Q' && M.letterFor('', 'ab') === 'A', 'letter tile fallback');
  want(M.hueFor(addr(1)) >= 0 && M.hueFor(addr(1)) < 4, 'tile hue range');
  want(M.imageOk('https://cdn.example/a.png', 'https://cdn.example') && !M.imageOk('https://evil.example/a.png', 'https://cdn.example') && !M.imageOk('http://cdn.example/a.png', 'https://cdn.example') && !M.imageOk('', 'https://cdn.example') && !M.imageOk('https://cdn.example/a.png', ''), 'image origin allow-list');
  gate('market: formatting, dash for missing data, letter-tile fallback, image origin allow-list', errs.splice(0));
}

// 7. copy: zero shared 2-grams / distinctive words with the reference (hashed fingerprint)
{
  const fp = JSON.parse(readFileSync(join(ROOT, 'tools', 'ref-fingerprint.json'), 'utf8'));
  const md = f => readFileSync(join(ROOT, f), 'utf8').replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>|\[\]()-]+/g, ' ').replace(/https?:\S+/g, ' ');
  const texts = { 'dist/index.html': visibleText(readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8')) };
  for (const f of ['README.md', 'docs/whitepaper.md']) if (existsSync(join(ROOT, f))) texts[f] = md(f);
  gate('copy: zero shared 2-grams and zero shared distinctive words with the reference', checkOriginality(texts, fp));
}

// 8. repo hygiene
{
  const errs = [];
  for (const f of [['CLAU', 'DE.md'].join(''), ['.cla', 'ude'].join('')]) if (existsSync(join(ROOT, f))) errs.push(`${f} must not exist`);
  const pat = new RegExp([['cla', 'ude'].join(''), ['anthro', 'pic'].join(''), '\\bA\\.?I\\b', ['artificial', ' intelligence'].join(''), 'generated (by|with)', ['co-', 'authored'].join(''), ['chat', 'gpt'].join('')].join('|'), 'i');
  const skip = new Set(['node_modules', '.tmp', 'brand', 'reference', 'dist-test', '.git']);
  (function scan(d) {
    for (const n of readdirSync(d)) {
      if (skip.has(n)) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) { scan(p); continue; }
      if (!['.md', '.json', '.mjs', '.js', '.css', '.html', '.svg', '.txt', '.py', ''].includes(extname(n)) && n !== 'LICENSE') continue;
      if (n === 'ref-fingerprint.json') continue;
      const t = readFileSync(p, 'utf8');
      const m = t.match(pat);
      if (m) errs.push(`${p.slice(ROOT.length + 1)}: forbidden mention "${m[0]}"`);
    }
  })(ROOT);
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) if (!existsSync(join(ROOT, f))) errs.push(`${f} missing`);
  if (existsSync(join(ROOT, 'LICENSE'))) { const l = readFileSync(join(ROOT, 'LICENSE'), 'utf8'); if (!/^MIT License/.test(l) || !/Copyright \(c\) 2026 Muono/.test(l)) errs.push('LICENSE must be MIT, 2026, Muono'); }
  if (existsSync(join(ROOT, 'README.md'))) { const r = readFileSync(join(ROOT, 'README.md'), 'utf8'); if (/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/.test(r.replace(/https?:\S+/g, '')) || /0x[0-9a-f]{40}/i.test(r)) errs.push('README must not contain an address'); }
  gate('hygiene: no agent config files or folders, no attribution anywhere; README, whitepaper, MIT licence present', errs);
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${results.length - failed}/${results.length} gates passed`);
process.exit(failed ? 1 : 0);
