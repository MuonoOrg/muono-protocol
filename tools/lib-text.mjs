import { createHash } from 'node:crypto';
export const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
export const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
export function visibleText(html) {
  const meta = [...html.matchAll(/<(?:title)[^>]*>([\s\S]*?)<\/title>|<meta[^>]+name="description"[^>]+content="([^"]*)"/gi)].map(m => m[1] || m[2]);
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<!--[\s\S]*?-->/gi, ' ');
  const alts = [...body.matchAll(/(?:alt|aria-label|placeholder)="([^"]*)"/gi)].map(m => m[1]);
  return decode([...meta, body.replace(/<[^>]+>/g, ' '), ...alts].join(' \n '));
}
export const words = t => (t.toLowerCase().match(/[a-z][a-z'-]*/g) || []);
export function bigrams(t) {
  const out = new Set();
  // bigrams do not cross sentence or block boundaries
  for (const seg of t.toLowerCase().split(/[.!?:;\n|]+/)) {
    const w = seg.match(/[a-z0-9][a-z0-9'-]*/g) || [];
    for (let i = 0; i + 1 < w.length; i++) out.add(w[i] + ' ' + w[i + 1]);
  }
  return out;
}
