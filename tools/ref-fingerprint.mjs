// One-off: hash the reference page's words and 2-grams so the repo carries no reference copy.
import { readFileSync, writeFileSync } from 'node:fs';
import { visibleText, words, bigrams, sha } from './lib-text.mjs';
const html = readFileSync(process.argv[2], 'utf8');
const t = visibleText(html);
const w = [...new Set(words(t))].map(sha).sort();
const b = [...bigrams(t)].map(sha).sort();
writeFileSync(new URL('./ref-fingerprint.json', import.meta.url), JSON.stringify({ note: 'sha1/12 of reference words and 2-grams; no source text', words: w, bigrams: b }));
console.log('words', w.length, 'bigrams', b.length);
