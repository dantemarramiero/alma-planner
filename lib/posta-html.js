// HTML scritto nell'editor della Posta (ALM2-68, tavola N): restano solo grassetto, corsivo, sottolineato, elenchi,
// a capo, link (http/mailto) e le @persone; tutto il resto (stili, script, immagini, attributi, eventi) si toglie.
const ALLOWED = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'span']);

function sanitize(html) {
  let out = String(html || '').slice(0, 200000)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript)\b[\s\S]*?<\/(script|style|iframe|object|embed|svg|math|template|noscript)\s*>/gi, '');
  out = out.replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (m, close, tag, attrs) => {
    tag = tag.toLowerCase();
    if (!ALLOWED.has(tag)) return '';
    if (close) return `</${tag}>`;
    if (tag === 'a') {
      const href = ((attrs.match(/href\s*=\s*"([^"]*)"/i) || attrs.match(/href\s*=\s*'([^']*)'/i) || [])[1] || '').trim();
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${href.replace(/"/g, '&quot;')}" style="color:#0563C1">` : '<a>';
    }
    if (tag === 'span' && /class\s*=\s*["'][^"']*\bmention\b/i.test(attrs)) return '<span style="color:#0563C1;font-weight:600">';
    if (tag === 'p' || tag === 'div') return `<${tag} style="margin:0">`;
    return `<${tag}>`;
  });
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222222">${out}</div>`;
}

const plain = html => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

module.exports = { sanitize, plain };
