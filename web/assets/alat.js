const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
/* ---------- Utilitas ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const angka = (x, d = 2) => (x == null || Number.isNaN(x) ? '-' : Number(x).toFixed(d).replace('.', ','));
const rata = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const durasi = (s) => (s < 0.1 ? `${Math.max(1, Math.round(s * 1000))} ms` : `${angka(s)} dtk`);
const waktu = (iso) => (iso || '').slice(0, 16).replace('T', ' ');
const labelTipe = (t) => (t === 'gambar' || t === 'image' ? 'Gambar' : 'PDF');
const el = (tag, attrs = {}, html = '') => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; n.setAttribute(k, v === true ? '' : v); } if (html) n.innerHTML = html; return n; };
const kataUnik = (t) => new Set((String(t).toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []));

function hitungF1(pred, gt) {
  const p = kataUnik(pred), g = kataUnik(gt);
  if (!p.size || !g.size) return 0;
  let tp = 0; for (const w of p) if (g.has(w)) tp++;
  if (!tp) return 0;
  const pr = tp / p.size, rc = tp / g.size;
  return Math.round((2 * pr * rc / (pr + rc)) * 10000) / 100;
}

const barisTabel = (b) => { const s = b.trim(); return s.startsWith('|') && (s.match(/\|/g) || []).length >= 2; };
const pemisahTabel = (b) => { const s = b.trim(); return !!s && s.includes('-') && [...s].every((c) => '|-: '.includes(c)); };
const panjang = (arr) => arr.reduce((n, b) => n + b.length + 1, 0);
/* ---------- Markdown sederhana ---------- */
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)'"])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
function md(src) {
  const L = String(src ?? '').replace(/\r/g, '').split('\n');
  let out = '', para = [], i = 0;
  const tutupPara = () => { if (para.length) { out += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  while (i < L.length) {
    const b = L[i], t = b.trim();
    if (!t) { tutupPara(); i++; continue; }
    if (/^#{1,6}\s/.test(t)) { tutupPara(); const n = t.match(/^#+/)[0].length; out += `<${n <= 3 ? 'h3' : 'h4'}>${inline(t.replace(/^#+\s*/, ''))}</${n <= 3 ? 'h3' : 'h4'}>`; i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(t)) { tutupPara(); out += '<hr>'; i++; continue; }
    if (barisTabel(t)) {
      tutupPara(); const blok = [];
      while (i < L.length && barisTabel(L[i])) blok.push(L[i++].trim());
      const sel = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      let kepala = null, badan = blok;
      if (blok.length > 1 && pemisahTabel(blok[1])) { kepala = sel(blok[0]); badan = blok.slice(2); }
      out += '<table>' + (kepala ? `<thead><tr>${kepala.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : '') +
        '<tbody>' + badan.filter((r) => !pemisahTabel(r)).map((r) => `<tr>${sel(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
      continue;
    }
    const li = t.match(/^([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      tutupPara(); const urut = /\d/.test(li[1]); const items = [];
      while (i < L.length) {
        const m = L[i].trim().match(/^([-*•]|\d+[.)])\s+(.*)$/);
        if (m) { items.push(m[2]); i++; continue; }
        if (L[i].trim() && /^\s{2,}/.test(L[i]) && items.length) { items[items.length - 1] += '\n' + L[i].trim(); i++; continue; }
        break;
      }
      out += `<${urut ? 'ol' : 'ul'}>${items.map((x) => `<li>${x.split('\n').map(inline).join('<br>')}</li>`).join('')}</${urut ? 'ol' : 'ul'}>`;
      continue;
    }
    para.push(t); i++;
  }
  tutupPara();
  return out;
}

export { $, $$, esc, angka, rata, median, durasi, waktu, labelTipe, el, kataUnik, hitungF1, md };
