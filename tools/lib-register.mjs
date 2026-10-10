import { createHash } from 'node:crypto';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const STATES = ['stated', 'absent', 'unconfirmed'];
export const isInert = r => r.state !== 'stated';

export function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c === '1') bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
}
export function b58encode(buf) {
  let n = 0n; for (const b of buf) n = (n << 8n) | BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}
export const isSolanaAddress = s => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && b58decode(s)?.length === 32;

// rule 2: store the URL, derive the handle
export function handle(rec) {
  if (!rec.url) return '';
  const u = new URL(rec.url);
  if (rec.id === 'x' || rec.id === 'github') return '@' + (u.pathname.split('/').filter(Boolean)[0] || '');
  return u.host;
}

export function validate(reg) {
  const errs = [];
  const ids = new Set();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reg.asOf || '')) errs.push('register.asOf must be YYYY-MM-DD');
  for (const r of reg.records) {
    if (ids.has(r.id)) errs.push(`${r.id}: duplicate id`);
    ids.add(r.id);
    if (!STATES.includes(r.state)) errs.push(`${r.id}: state must be one of ${STATES.join('|')}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.asOf || '')) errs.push(`${r.id}: asOf date required`);
    if (isInert(r)) {
      if ('value' in r) errs.push(`${r.id}: inert record must not carry value`);
      if ('url' in r) errs.push(`${r.id}: inert record must not carry url`);
    } else {
      if (!r.source) errs.push(`${r.id}: stated record needs source`);
      if (r.kind === 'link') { try { if (new URL(r.url).protocol !== 'https:') throw 0; } catch { errs.push(`${r.id}: stated link needs https url`); } if ('value' in r) errs.push(`${r.id}: link record stores url only`); }
      if (r.kind === 'address' && !isSolanaAddress(r.value)) errs.push(`${r.id}: stated address is not a valid Solana address`);
      if (r.kind === 'text' && !r.value) errs.push(`${r.id}: stated text needs value`);
    }
  }
  for (const need of ['ca', 'x', 'github', 'chain', 'rpc', 'domain', 'market', 'marketimg']) if (!ids.has(need)) errs.push(`missing record ${need}`);
  return errs;
}

// test fixtures used only by the mutation harness, never by the real build
export function fixtureFor(rec) {
  if (rec.kind === 'address') return { value: b58encode(createHash('sha256').update('muono-fixture-address').digest()), source: 'harness fixture' };
  if (rec.kind === 'link') return { url: rec.id === 'github' ? 'https://github.com/muono-fixture' : rec.id === 'x' ? 'https://x.com/muono_fixture' : 'https://example.org/fixture', source: 'harness fixture' };
  return { value: 'fixture', source: 'harness fixture' };
}
// state-independent: reads the record's current state at call time and flips it
export function flip(reg, id) {
  const copy = JSON.parse(JSON.stringify(reg));
  const r = copy.records.find(x => x.id === id);
  if (isInert(r)) { r.state = 'stated'; Object.assign(r, fixtureFor(r)); }
  else { r.state = 'absent'; delete r.value; delete r.url; delete r.source; delete r.scope; }
  return copy;
}
