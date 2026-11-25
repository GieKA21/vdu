const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const API = 'https://api.openai.com/v1/';
const MODEL_EMBED = 'text-embedding-3-small';
const MODEL_CHAT = 'gpt-4o-mini';
const TOP_K = 6;
const MAKS_KARAKTER_CHUNK = 900;
const MIN_KARAKTER_CHUNK = 200;
const TARGET_F1 = 90;
const KUNCI_SESI = 'cbot-upeks-kunci';
const KUNCI_LOG = 'cbot-upeks-log';
const KUNCI_PERCAKAPAN = 'cbot-upeks-percakapan';

const SYSTEM_PROMPT = `Kamu adalah "Cbot Upeks", sistem chatbot layanan informasi periklanan dan sirkulasi yang ramah, sopan, dan interaktif dari PT Ujungpandang Ekspres Harian Bisnis. Tugasmu adalah menjawab pertanyaan seputar tarif iklan, syarat administrasi pemasangan iklan, tarif berlangganan maupun penjualan eceran koran (sirkulasi), serta informasi profil perusahaan.

    ATURAN GAYA BAHASA & INTERAKSI:
1. Jika pengguna menyapa atau bertanya umum (contoh: "info apa yang kamu punya?"), perkenalkan dirimu dengan hangat dan berikan ringkasan singkat informasi layanan periklanan, sirkulasi, serta profil perusahaan yang kamu ketahui.
2. JANGAN menjawab dengan kaku. Gunakan kalimat pembuka dan penutup yang enak dibaca.
3. Mirroring (Bercermin): Sesuaikan nada bicaramu! 
  - Jika gaya gaul (bro, sis, lu, gw), balas dengan santai dan asik.
  - Jika terkesan bapak-bapak/ibu-ibu yang formal, gunakan sapaan sopan (Bapak/Ibu).
  - Jika akrab atau anak muda, sesekali gunakan kata 'besty'.
4. Multibahasa & Typo: Pengguna mungkin salah ketik, menggunakan bahasa Inggris, atau bahasa daerah (Makassar, Bugis). Pahami maksudnya, dan balas dengan gaya/bahasa yang mereka gunakan.

    ATURAN DATA & LOGIKA (ANTI-HALUSINASI):
1. Jawab HANYA berdasarkan 'Konteks Dokumen' yang dilampirkan.
2. Kamu DIIZINKAN memahami sinonim (misal: Pemimpin = Direktur, jurnalis = wartawan, langganan = berlangganan/sirkulasi) agar jawaban lebih tepat.
3. DILARANG KERAS mengarang fakta, harga, atau aturan yang tidak ada di dokumen.
4. Jika informasi benar-benar tidak ada di konteks, sampaikan dengan gaya bahasamu yang ramah bahwa Cbot Upeks belum memiliki informasi tersebut.`;

const PROMPT_VDU = `
        Anda adalah sistem Visual Document Understanding (VDU) yang bertugas mengekstrak informasi dari dokumen layanan informasi periklanan, daftar tarif iklan (rate card), syarat administrasi pemasangan, dan tarif sirkulasi/berlangganan media cetak.
        Tugas Anda:
1. Ekstrak seluruh teks dan angka dari gambar ini dengan presisi absolut.
2. Pertahankan kesadaran tata letak (layout-awareness). Jika data berupa tabel atau matriks harga, Anda WAJIB memformatnya menggunakan tabel Markdown agar kolom dan baris tidak rusak atau bergeser.
3. Terapkan zero-hallucination: Jangan mengarang angka atau teks yang tidak ada di dalam gambar.
        `;

const CONTOH = [
  ['Tarif iklan', 'Berapa tarif iklan umum berwarna per mm/kolom?'],
  ['Syarat pemasangan', 'Apa saja syarat memasang iklan untuk instansi?'],
  ['Langganan koran', 'Berapa harga langganan koran per bulan di Makassar?'],
  ['Struktur redaksi', 'Siapa yang menjabat Manajer Iklan?'],
  ['Materi iklan', 'Kapan paling lambat materi desain iklan diserahkan sebelum terbit?'],
  ['Logat Makassar', 'Berapa mi harga eceran koran Upeks per eksemplar?'],
];

const state = {
  korpus: [], dokumen: [], log: [], uji: [], lokal: [],
  kunci: null, percakapan: [], sibuk: null, indeksBm25: null,
  sudah: {}, batasLog: 30, posterAktif: null,
};

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

function dekodeVektor(b64) {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/* ---------- Pemecah teks (sama dengan rag_engine.pecah_teks) ---------- */
const barisTabel = (b) => { const s = b.trim(); return s.startsWith('|') && (s.match(/\|/g) || []).length >= 2; };
const pemisahTabel = (b) => { const s = b.trim(); return !!s && s.includes('-') && [...s].every((c) => '|-: '.includes(c)); };
const panjang = (arr) => arr.reduce((n, b) => n + b.length + 1, 0);
function potongBarisPanjang(baris, maks) {
  const hasil = []; let kini = '';
  for (const k of baris.split(/(?<=[.!?;])\s+/)) {
    if (kini && kini.length + 1 + k.length > maks) { hasil.push(kini); kini = k; } else kini = (kini + ' ' + k).trim();
  }
  if (kini) hasil.push(kini);
  return hasil;
}
function pecahTabel(blok, konteks = '') {
  let header = null, pemisah = null, data = blok;
  if (blok.length >= 2 && pemisahTabel(blok[1])) { [header, pemisah] = blok; data = blok.slice(2); }
  else if (blok.length && pemisahTabel(blok[0])) data = blok.slice(1);
  const awalan = konteks.trim() ? konteks.trim() + '\n' : '';
  const hasil = [];
  for (const b of data) {
    if (pemisahTabel(b)) continue;
    const sel = b.trim().replace(/^\||\|$/g, '').split('|').map((s) => s.trim());
    if (!sel.some(Boolean)) continue;
    hasil.push(header ? `${awalan}${header}\n${pemisah}\n${b}` : `${awalan}${b}`);
  }
  if (!hasil.length && header) hasil.push(`${awalan}${header}`);
  return hasil;
}
function pecahTeks(teks, maks = MAKS_KARAKTER_CHUNK, min = MIN_KARAKTER_CHUNK) {
  const baris = String(teks).split(/\r?\n/).map((b) => b.replace(/\s+$/, ''));
  const hasil = []; let buffer = [];
  const siram = () => { const isi = buffer.join('\n').trim(); if (isi) hasil.push(isi); buffer = []; };
  let i = 0;
  while (i < baris.length) {
    const b = baris[i];
    if (barisTabel(b)) {
      let konteks = '';
      if (buffer.length && panjang(buffer) <= min) { konteks = buffer.join('\n'); buffer = []; } else siram();
      const blok = [];
      while (i < baris.length && barisTabel(baris[i])) blok.push(baris[i++].trim());
      hasil.push(...pecahTabel(blok, konteks));
      continue;
    }
    if (!b.trim()) { if (panjang(buffer) >= min) siram(); i++; continue; }
    for (const p of (b.length > maks ? potongBarisPanjang(b, maks) : [b])) {
      if (buffer.length && panjang(buffer) + p.length > maks) siram();
      buffer.push(p);
    }
    i++;
  }
  siram();
  return hasil;
}

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
function sorot(node, kata) {
  if (!kata.length) return;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${kata.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const uji = new RegExp(re.source, 'iu');
  const target = []; while (w.nextNode()) if (uji.test(w.currentNode.nodeValue)) target.push(w.currentNode);
  for (const t of target) {
    const span = document.createElement('span');
    span.innerHTML = esc(t.nodeValue).replace(re, '<mark>$1</mark>');
    t.replaceWith(...span.childNodes);
  }
}

/* ---------- Pencarian kata kunci (tanpa kunci API) ---------- */
const STOP = new Set('yang dan di ke dari apa apakah berapa untuk ini itu ada saja mi ji ki pi ta mau kalau sama dengan atau adalah bagaimana siapa kapan mana dimana saya kamu anda bisa juga nya kah lah dong ya the is are of to in a an what how who when where which info informasi tolong mohon minta tanya ingin pak bu kak besty bro sis apa-apa sudah belum masih akan pada oleh dalam sebagai tersebut harus boleh tidak bukan saat hari'.split(' '));
function akar(w) {
  let s = w;
  for (const suf of ['nya', 'kan', 'lah', 'kah', 'an', 'i']) if (s.length - suf.length >= 4 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  for (const pre of ['meng', 'peng', 'mem', 'men', 'pem', 'pen', 'ber', 'ter', 'per', 'me', 'pe', 'di', 'ke', 'se']) if (s.length - pre.length >= 4 && s.startsWith(pre)) { s = s.slice(pre.length); break; }
  return s;
}
const token = (t) => (String(t).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => !STOP.has(w) && (w.length > 1 || /\d/.test(w))).map(akar);
function bangunBm25() {
  const docs = semuaPotongan().map((p) => { const tk = token(p.judul + ' ' + p.teks); const tf = new Map(); for (const w of tk) tf.set(w, (tf.get(w) || 0) + 1); return { p, tf, len: tk.length }; });
  const df = new Map(); for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  state.indeksBm25 = { docs, df, avg: rata(docs.map((d) => d.len)) || 1 };
}
function cariBm25(q) {
  if (!state.indeksBm25) bangunBm25();
  const { docs, df, avg } = state.indeksBm25; const N = docs.length; const qt = [...new Set(token(q))];
  const skor = docs.map((d) => {
    let s = 0;
    for (const w of qt) { const f = d.tf.get(w); if (!f) continue; const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5)); s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / avg)); }
    return { p: d.p, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, TOP_K);
  const maks = skor[0]?.s || 1;
  const kata = [...new Set((String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => !STOP.has(w) && w.length > 2))];
  return { hits: skor.map((x, i) => keHit(i + 1, x.p, x.s / maks, null)), kata };
}

/* ---------- OpenAI ---------- */
async function galatOpenAI(r) {
  let pesan = ''; try { pesan = (await r.json()).error?.message || ''; } catch { /* abaikan */ }
  if (r.status === 401) return new Error('Kunci API ditolak OpenAI. Periksa kembali kuncinya.');
  if (r.status === 429) return new Error('Kuota atau batas permintaan OpenAI sedang habis. Coba lagi sebentar lagi.');
  return new Error(`OpenAI mengembalikan galat ${r.status}${pesan ? ': ' + pesan : ''}.`);
}
async function openai(path, body, signal) {
  let r;
  try {
    r = await fetch(API + path, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.kunci}` }, body: JSON.stringify(body) });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Tidak dapat terhubung ke OpenAI. Periksa koneksi internet.');
  }
  if (!r.ok) throw await galatOpenAI(r);
  return r;
}
async function embed(input, signal) {
  const keluar = [];
  for (let i = 0; i < input.length; i += 96) {
    const j = await (await openai('embeddings', { model: MODEL_EMBED, input: input.slice(i, i + 96) }, signal)).json();
    keluar.push(...j.data.sort((a, b) => a.index - b.index).map((d) => Float32Array.from(d.embedding)));
  }
  return keluar;
}
async function* aliran(r) {
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n).trim(); buf = buf.slice(n + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim(); if (d === '[DONE]') return;
      try { const t = JSON.parse(d).choices?.[0]?.delta?.content; if (t) yield t; } catch { /* potongan tidak utuh */ }
    }
  }
}

/* ---------- Data ---------- */
function semuaPotongan() {
  const lokal = state.lokal.flatMap((d) => d.potongan.map((p, i) => ({ id: `${d.id}::${String(i).padStart(3, '0')}`, doc_id: d.id, judul: d.judul, tipe: d.tipe === 'gambar' ? 'image' : 'pdf document', halaman: p.halaman ?? null, teks: p.teks, v: p.vektor })));
  return [...state.korpus, ...lokal];
}
const semuaDokumen = () => [...state.dokumen, ...state.lokal];
const cariDokumen = (id) => semuaDokumen().find((d) => d.id === id);
function keHit(peringkat, p, mirip, jarak) {
  return { peringkat, doc_id: p.doc_id, judul: p.judul, tipe: p.tipe, halaman: p.halaman, teks: p.teks, kemiripan: Math.round(Math.max(0, mirip) * 10000) / 100, jarak: jarak == null ? null : Math.round(jarak * 10000) / 10000 };
}
async function cariVektor(q, signal) {
  const [qv] = await embed([q], signal);
  return semuaPotongan().filter((p) => p.v).map((p) => ({ p, c: cosine(qv, p.v) })).sort((a, b) => b.c - a.c).slice(0, TOP_K).map((x, i) => keHit(i + 1, x.p, x.c, 1 - x.c));
}

const DB = {
  buka() { return this._db ??= new Promise((ok, gagal) => { const r = indexedDB.open('cbot-upeks', 1); r.onupgradeneeded = () => r.result.createObjectStore('dokumen', { keyPath: 'id' }); r.onsuccess = () => ok(r.result); r.onerror = () => gagal(r.error); }); },
  async aksi(mode, fn) { const db = await this.buka(); return new Promise((ok, gagal) => { const tx = db.transaction('dokumen', mode); const req = fn(tx.objectStore('dokumen')); tx.oncomplete = () => ok(req?.result); tx.onerror = () => gagal(tx.error); }); },
  semua() { return this.aksi('readonly', (s) => s.getAll()); },
  simpan(d) { return this.aksi('readwrite', (s) => s.put(d)); },
  hapus(id) { return this.aksi('readwrite', (s) => s.delete(id)); },
};

const logLokal = () => { try { return JSON.parse(localStorage.getItem(KUNCI_LOG) || '[]'); } catch { return []; } };
function catatLog(entri) {
  const l = logLokal(); l.push(entri);
  try { localStorage.setItem(KUNCI_LOG, JSON.stringify(l.slice(-300))); } catch { /* penyimpanan penuh */ }
  state.sudah.log = false;
}

/* ---------- Kunci ---------- */
function perbaruiLabelKunci() {
  const b = $('#tombol-kunci');
  b.toggleAttribute('data-aktif', !!state.kunci);
  $('#label-kunci').textContent = state.kunci ? 'Mode GPT-4o-mini aktif' : 'Pasang kunci OpenAI';
  const c = $('#catatan-mode');
  c.innerHTML = state.kunci
    ? 'Pencarian semantik dengan text-embedding-3-small dan jawaban dari GPT-4o-mini.'
    : 'Mode tanpa kunci: Cbot menampilkan bagian dokumen yang paling cocok. <button type="button" data-buka-kunci>Pasang kunci OpenAI</button> untuk jawaban yang disusun GPT-4o-mini.';
}
function siapkanKunci() {
  state.kunci = sessionStorage.getItem(KUNCI_SESI) || null;
  const dlg = $('#dialog-kunci'), isian = $('#isian-kunci'), pesan = $('#pesan-kunci');
  const buka = () => { isian.value = state.kunci || ''; $('#ingat-kunci').checked = !!sessionStorage.getItem(KUNCI_SESI); pesan.textContent = ''; dlg.showModal(); isian.focus(); };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-buka-kunci]')) buka(); });
  $('#tombol-kunci').addEventListener('click', buka);
  $('#simpan-kunci').addEventListener('click', async () => {
    const k = isian.value.trim();
    if (!/^sk-[\w-]{20,}$/.test(k)) { pesan.dataset.jenis = 'galat'; pesan.textContent = 'Format kunci tidak dikenali. Kunci OpenAI diawali "sk-".'; return; }
    pesan.dataset.jenis = ''; pesan.textContent = 'Menguji kunci...';
    const lama = state.kunci; state.kunci = k;
    try {
      await embed(['uji']);
      if ($('#ingat-kunci').checked) sessionStorage.setItem(KUNCI_SESI, k); else sessionStorage.removeItem(KUNCI_SESI);
      pesan.dataset.jenis = 'ok'; pesan.textContent = 'Kunci berfungsi.';
      perbaruiLabelKunci(); setTimeout(() => dlg.close(), 500);
    } catch (e) { state.kunci = lama; pesan.dataset.jenis = 'galat'; pesan.textContent = e.message; }
  });
  $('#hapus-kunci').addEventListener('click', () => { state.kunci = null; sessionStorage.removeItem(KUNCI_SESI); isian.value = ''; perbaruiLabelKunci(); pesan.dataset.jenis = 'ok'; pesan.textContent = 'Kunci dilepas dari halaman ini.'; });
  isian.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#simpan-kunci').click(); } });
  perbaruiLabelKunci();
}

/* ---------- Tanya ---------- */
const SAPAAN = /^(halo+|hai+|hi+|hello|hey|p+|ping|assalamu.*|asw|selamat (pagi|siang|sore|malam)|pagi|siang|sore|malam|permisi|tes|test|(info|informasi) apa.*)\W*$/i;
function jawabanLokal(q, hits) {
  if (SAPAAN.test(q.trim()) || /informasi apa|info apa|apa yang (kamu|anda) (punya|tahu)/i.test(q)) {
    return 'Halo! Saya **Cbot Upeks**, asisten layanan informasi PT Ujungpandang Ekspres Harian Bisnis. Saya bisa membantu soal:\n\n- Tarif iklan umum, mungil, duka cita, advertorial, dan iklan baris\n- Syarat administrasi dan tata cara pemasangan iklan\n- Harga langganan dan eceran koran\n- Profil perusahaan, struktur redaksi, serta jaringan wartawan dan biro daerah\n\nSilakan ajukan pertanyaan Anda.';
  }
  if (!hits.length) return 'Maaf, Cbot Upeks belum menemukan informasi tersebut di dokumen. Coba gunakan kata lain, atau pasang kunci OpenAI agar pertanyaan dipahami lebih luas.';
  const pilih = hits.filter((h, i) => i === 0 || (i < 3 && h.kemiripan >= 70));
  return 'Berikut bagian dokumen yang paling sesuai dengan pertanyaan Anda:\n\n' +
    pilih.map((h) => `#### ${h.judul}${h.halaman ? `, halaman ${h.halaman}` : ''}\n${h.teks}`).join('\n\n');
}

function simpanPercakapan() { try { sessionStorage.setItem(KUNCI_PERCAKAPAN, JSON.stringify(state.percakapan.slice(-40))); } catch { /* abaikan */ } }

function gambarPesanUser(teks) {
  const n = el('div', { class: 'pesan pesan--user muncul' });
  n.append(el('div', { class: 'gelembung' })); n.firstChild.textContent = teks;
  $('#percakapan').append(n); return n;
}
function gambarPesanBot() {
  const n = el('div', { class: 'pesan pesan--bot muncul' }, `<div class="pesan__kepala"><b>Cbot Upeks</b><span class="tahap"></span></div><div class="gelembung"><div class="md"><span class="memuat" aria-label="Memproses"><i></i><i></i><i></i></span></div></div><div class="rincian"></div>`);
  $('#percakapan').append(n); return n;
}
function isiPesanBot(n, m, kata = []) {
  const g = $('.gelembung', n); g.toggleAttribute('data-galat', !!m.galat);
  const isi = $('.md', g); isi.innerHTML = m.galat ? `<p>${esc(m.isi)}</p>` : md(m.isi);
  if (m.mode === 'lokal') $$('.md > :not(:first-child)', g).forEach((x) => sorot(x, kata));
  $('.tahap', n).textContent = '';
  const r = $('.rincian', n); r.innerHTML = '';
  if (!m.latensi) return;
  const lat = m.latensi;
  const baris = el('div', { class: 'rincian__baris' },
    `<span class="lencana ${m.mode === 'lokal' ? 'lencana--perunggu' : ''}">${m.mode === 'lokal' ? 'Pencarian kata kunci' : 'GPT-4o-mini'}</span>` +
    `<span>Total <span class="data">${durasi(lat.total)}</span></span><span>Pencarian <span class="data">${durasi(lat.retrieval)}</span></span>` +
    (m.mode === 'lokal' ? '' : `<span>Jawaban <span class="data">${durasi(lat.generasi)}</span></span>`) +
    `<span class="rincian__aksi"><button class="tombol tombol--teks tombol--kecil" type="button" data-salin>Salin</button></span>`);
  $('[data-salin]', baris).addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(m.isi); e.target.textContent = 'Tersalin'; setTimeout(() => (e.target.textContent = 'Salin'), 1500); } catch { e.target.textContent = 'Gagal menyalin'; } });
  r.append(baris);
  if (m.catatan) r.append(el('p', { class: 'catatan-kecil' }, esc(m.catatan)));
  if (m.hits?.length) {
    const s = el('div', { class: 'sumber' });
    for (const h of m.hits) {
      const d = el('details');
      d.innerHTML = `<summary><span class="sumber__no">#${h.peringkat}</span><span class="sumber__judul">${esc(h.judul)} <small>· ${labelTipe(h.tipe)}${h.halaman ? ', hlm. ' + h.halaman : ''}</small></span>` +
        `<span class="meter" title="${m.mode === 'lokal' ? 'Skor relatif terhadap hasil teratas' : 'Kemiripan cosine'}"><span class="meter__isi"><i style="width:${Math.min(100, h.kemiripan)}%"></i></span>${angka(h.kemiripan, 1)}%</span></summary>` +
        `<div class="sumber__teks"><div class="md">${md(h.teks)}</div><button class="tombol tombol--garis tombol--kecil" type="button">Buka dokumen</button></div>`;
      $('button', d).addEventListener('click', () => bukaDokumen(h.doc_id, 'potongan', h.teks));
      s.append(d);
    }
    r.append(el('p', { class: 'catatan-kecil' }, m.mode === 'lokal' ? 'Potongan dokumen yang cocok (skor relatif BM25):' : `Berdasarkan ${m.hits.length} potongan dokumen (cosine similarity):`), s);
  }
}

async function tanya(q) {
  q = q.trim(); if (!q || state.sibuk) return;
  $('#sambutan').hidden = true;
  gambarPesanUser(q);
  state.percakapan.push({ peran: 'user', isi: q });
  const n = gambarPesanBot(); n.scrollIntoView({ block: 'end' });
  const tahap = $('.tahap', n);
  const ctrl = new AbortController(); state.sibuk = ctrl; setTombolKirim(true);
  const t0 = performance.now(); let tRet = 0, tGen = 0; let hits = [], kata = [], isi = '', galat = false, mode = state.kunci ? 'gpt' : 'lokal', catatan = '';
  try {
    if (state.kunci) {
      tahap.textContent = 'Mencari di dokumen...';
      try { hits = await cariVektor(q, ctrl.signal); }
      catch (e) { if (e.name === 'AbortError') throw e; mode = 'lokal'; catatan = `${e.message} Jawaban memakai pencarian kata kunci.`; }
    }
    if (mode === 'lokal') { ({ hits, kata } = cariBm25(q)); }
    tRet = (performance.now() - t0) / 1000;
    if (mode === 'gpt') {
      if (!hits.length) isi = 'Maaf, data tidak ditemukan di dalam dokumen gambar maupun PDF. Basis pengetahuan masih kosong.';
      else {
        tahap.textContent = 'Menyusun jawaban...';
        const t1 = performance.now();
        const konteks = hits.map((h) => h.teks).join('\n\n');
        const r = await openai('chat/completions', { model: MODEL_CHAT, temperature: 0.3, stream: true, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `Konteks Dokumen:\n${konteks}\n\nPertanyaan: ${q}` }] }, ctrl.signal);
        const wadah = $('.md', n); let jadwal = 0;
        for await (const t of aliran(r)) {
          isi += t;
          if (!jadwal) jadwal = requestAnimationFrame(() => { jadwal = 0; wadah.innerHTML = md(isi); wadah.lastElementChild?.classList.add('kursor'); });
        }
        cancelAnimationFrame(jadwal);
        tGen = (performance.now() - t1) / 1000;
      }
    } else isi = jawabanLokal(q, hits);
  } catch (e) {
    galat = true; isi = e.name === 'AbortError' ? (isi ? isi + '\n\n(Jawaban dihentikan.)' : 'Pertanyaan dibatalkan.') : e.message;
    if (e.name === 'AbortError' && isi) galat = false;
  }
  const latensi = { total: (performance.now() - t0) / 1000, retrieval: tRet, generasi: tGen };
  const m = { peran: 'bot', isi, galat, mode, latensi, catatan, hits: hits.map(({ peringkat, doc_id, judul, tipe, halaman, teks, kemiripan }) => ({ peringkat, doc_id, judul, tipe, halaman, teks, kemiripan })), kata };
  isiPesanBot(n, m, kata);
  state.percakapan.push(m); simpanPercakapan();
  catatLog({ waktu: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19), kanal: mode === 'gpt' ? 'peramban' : 'peramban (kata kunci)', pertanyaan: q, jawaban: isi.slice(0, 2000), latensi_total_s: +latensi.total.toFixed(3), latensi_retrieval_s: +tRet.toFixed(3), latensi_generasi_s: +tGen.toFixed(3), galat, hasil: m.hits.map(({ peringkat, doc_id, judul, tipe, kemiripan }) => ({ peringkat, doc_id, judul, tipe, kemiripan })), lokal: true });
  state.sibuk = null; setTombolKirim(false);
}
function setTombolKirim(sibuk) {
  const b = $('#tombol-kirim'); b.textContent = sibuk ? 'Hentikan' : 'Kirim';
  b.classList.toggle('tombol--utama', !sibuk); b.classList.toggle('tombol--garis', sibuk);
}

function siapkanTanya() {
  const wadahContoh = $('#contoh');
  for (const [label, teks] of CONTOH) {
    const b = el('button', { type: 'button' }, `<span>${esc(label)}</span>${esc(teks)}`);
    b.addEventListener('click', () => tanya(teks));
    wadahContoh.append(b);
  }
  const form = $('#form-tanya'), masukan = $('#masukan');
  const ukur = () => { if (CSS.supports('field-sizing', 'content')) return; masukan.style.height = 'auto'; masukan.style.height = Math.min(masukan.scrollHeight, 180) + 'px'; };
  masukan.addEventListener('input', ukur);
  masukan.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.sibuk) { state.sibuk.abort(); return; }
    const q = masukan.value; masukan.value = ''; ukur(); tanya(q);
  });
  $('#tombol-reset').addEventListener('click', () => {
    state.sibuk?.abort(); state.percakapan = []; simpanPercakapan();
    $$('#percakapan .pesan').forEach((x) => x.remove()); $('#sambutan').hidden = false; masukan.focus();
  });
  try { state.percakapan = JSON.parse(sessionStorage.getItem(KUNCI_PERCAKAPAN) || '[]'); } catch { state.percakapan = []; }
  if (state.percakapan.length) {
    $('#sambutan').hidden = true;
    for (const m of state.percakapan) { if (m.peran === 'user') gambarPesanUser(m.isi); else isiPesanBot(gambarPesanBot(), m, m.kata || []); }
  }
}
function gambarRujukan() {
  const ul = $('#daftar-rujukan'); ul.innerHTML = '';
  for (const d of semuaDokumen()) {
    const li = el('li');
    const thumb = d.tipe === 'gambar' ? `<img src="${d.lokal ? d.urlBerkas : esc(d.kecil)}" alt="" width="40" height="52" loading="lazy">` : '<span class="ikon-pdf" aria-hidden="true">PDF</span>';
    li.innerHTML = `<button type="button">${thumb}<span><b>${esc(d.judul)}</b><small>${labelTipe(d.tipe)} · ${jumlahPotongan(d)} potongan${d.lokal ? ' · peramban ini' : ''}</small></span></button>`;
    $('button', li).addEventListener('click', () => bukaDokumen(d.id));
    ul.append(li);
  }
}
const potonganDok = (id) => semuaPotongan().filter((p) => p.doc_id === id);
const jumlahPotongan = (d) => potonganDok(d.id).length;

/* ---------- Pratinjau dokumen ---------- */
function bukaDokumen(id, tabAwal = 'berkas', sorotTeks = '') {
  const d = cariDokumen(id); if (!d) return;
  const dlg = $('#dialog-dokumen');
  $('#judul-pratinjau').textContent = d.judul;
  const tabs = [['berkas', 'Berkas']];
  if (d.ekstraksi) tabs.push(['ekstraksi', d.tipe === 'gambar' ? 'Hasil ekstraksi VDU' : 'Teks PDF']);
  if (d.ground_truth) tabs.push(['gt', 'Ground truth']);
  tabs.push(['potongan', `Potongan teks (${jumlahPotongan(d)})`]);
  const bar = $('#tab-pratinjau'); bar.innerHTML = '';
  const isi = $('#isi-pratinjau');
  const tampil = (k) => {
    $$('button', bar).forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === k));
    isi.innerHTML = '';
    if (k === 'berkas') {
      if (d.tipe === 'gambar') {
        const img = el('img', { src: d.lokal ? d.urlBerkas : d.besar, alt: `Poster ${d.judul}`, title: 'Klik untuk memperbesar' });
        img.addEventListener('click', () => img.toggleAttribute('data-zoom'));
        isi.append(img);
        if (!d.lokal) isi.append(el('p', { class: 'catatan-kecil' }, `<a href="${esc(d.berkas)}" target="_blank" rel="noopener">Buka berkas asli (PNG)</a>`));
      } else {
        const url = d.lokal ? d.urlBerkas : d.berkas;
        isi.append(el('iframe', { src: url, title: `PDF ${d.judul}` }));
        isi.append(el('p', { class: 'catatan-kecil' }, `<a href="${esc(url)}" target="_blank" rel="noopener">Buka PDF di tab baru</a>`));
      }
    } else if (k === 'ekstraksi') { isi.append(el('div', { class: 'md' }, md(d.ekstraksi))); }
    else if (k === 'gt') { const p = el('pre'); p.textContent = d.ground_truth; isi.append(p); }
    else {
      const ol = el('ol', { class: 'daftar-potongan' }); let tuju = null;
      potonganDok(d.id).forEach((p, i) => {
        const li = el('li', {}, `<span class="no">Potongan ${i + 1}${p.halaman ? ` · halaman ${p.halaman}` : ''}</span><div class="md">${md(p.teks)}</div>`);
        if (sorotTeks && p.teks === sorotTeks) { li.style.borderColor = 'var(--teal)'; li.style.background = 'var(--teal-muda)'; tuju = li; }
        ol.append(li);
      });
      isi.append(ol);
      if (tuju) requestAnimationFrame(() => tuju.scrollIntoView({ block: 'center' }));
    }
  };
  for (const [k, label] of tabs) {
    const b = el('button', { type: 'button', role: 'tab', 'data-tab': k }, esc(label));
    b.addEventListener('click', () => tampil(k)); bar.append(b);
  }
  tampil(tabs.some(([k]) => k === tabAwal) ? tabAwal : 'berkas');
  if (!dlg.open) dlg.showModal();
}

/* ---------- Layar Dokumen ---------- */
function gambarDokumen() {
  const docs = semuaDokumen();
  $('#ringkas-dokumen').innerHTML = kartuAngka([
    ['Total dokumen', docs.length], ['Gambar', docs.filter((d) => d.tipe === 'gambar').length], ['PDF', docs.filter((d) => d.tipe === 'pdf').length], ['Potongan teks terindeks', semuaPotongan().length],
  ]);
  const kisi = $('#kisi-dokumen'); kisi.innerHTML = '';
  for (const d of docs) {
    const k = el('article', { class: 'kartu-dok' });
    const gambar = d.tipe === 'gambar' ? `<img src="${d.lokal ? d.urlBerkas : esc(d.kecil)}" alt="" loading="lazy" width="420" height="594">` : '<span class="kartu-dok__pdf">PDF</span>';
    k.innerHTML = `<button class="kartu-dok__gambar" type="button" aria-label="Pratinjau ${esc(d.judul)}">${gambar}</button>
      <div class="kartu-dok__badan"><h2>${esc(d.judul)}</h2>
      <div class="kartu-dok__meta"><span class="lencana">${labelTipe(d.tipe)}</span><span class="lencana">${jumlahPotongan(d)} potongan</span>${d.akurasi_f1 != null ? `<span class="lencana ${d.akurasi_f1 >= TARGET_F1 ? '' : 'lencana--perunggu'}">F1 ${angka(d.akurasi_f1)}%</span>` : ''}${d.lokal ? '<span class="lencana lencana--perunggu">Peramban ini</span>' : ''}</div>
      <p class="catatan-kecil">Diperbarui ${esc(waktu(d.diperbarui))}</p>
      <div class="kartu-dok__aksi"><button class="tombol tombol--garis tombol--kecil" type="button" data-aksi="lihat">Pratinjau</button><button class="tombol tombol--garis tombol--kecil" type="button" data-aksi="tanya">Tanyakan isinya</button>${d.lokal ? '<button class="tombol tombol--teks tombol--kecil" type="button" data-aksi="hapus">Hapus</button>' : ''}</div></div>`;
    $('.kartu-dok__gambar', k).addEventListener('click', () => bukaDokumen(d.id));
    $('[data-aksi=lihat]', k).addEventListener('click', () => bukaDokumen(d.id));
    $('[data-aksi=tanya]', k).addEventListener('click', () => { location.hash = '#tanya'; tanya(`Jelaskan isi dokumen ${d.judul} secara ringkas.`); });
    $('[data-aksi=hapus]', k)?.addEventListener('click', async () => {
      if (!confirm(`Hapus dokumen "${d.judul}" dari peramban ini?`)) return;
      await DB.hapus(d.id); URL.revokeObjectURL(d.urlBerkas); state.lokal = state.lokal.filter((x) => x.id !== d.id); dataBerubah();
    });
    kisi.append(k);
  }
}
const kartuAngka = (arr) => arr.map(([l, v, ket, kelas]) => `<div class="angka"><div class="angka__label">${esc(l)}</div><div class="angka__nilai">${v}</div>${ket ? `<div class="angka__ket ${kelas || ''}">${ket}</div>` : ''}</div>`).join('');

function siapkanTambah() {
  const dlg = $('#dialog-tambah'), form = $('#form-tambah'), berkas = $('#berkas-baru'), pesan = $('#pesan-tambah'), prog = $('#progres-tambah');
  $('#tombol-tambah').addEventListener('click', () => {
    form.reset(); pesan.textContent = ''; prog.hidden = true; aturJenis();
    if (!state.kunci) { pesan.dataset.jenis = 'galat'; pesan.innerHTML = 'Pemrosesan memerlukan kunci OpenAI. <button type="button" class="tombol tombol--teks tombol--kecil" data-buka-kunci>Pasang kunci</button>'; }
    dlg.showModal();
  });
  const aturJenis = () => { const g = form.jenis.value === 'gambar'; berkas.accept = g ? '.png,.jpg,.jpeg' : '.pdf'; $('#baris-gt').hidden = !g; };
  form.addEventListener('change', (e) => { if (e.target.name === 'jenis') { berkas.value = ''; aturJenis(); } });
  $$('[data-tutup]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const set = (t, j = '') => { pesan.dataset.jenis = j; pesan.textContent = t; };
    if (!state.kunci) { set('Pasang kunci OpenAI terlebih dahulu.', 'galat'); return; }
    const f = berkas.files[0], jenis = form.jenis.value, judul = $('#judul-baru').value.trim();
    if (!f || !judul) return;
    if (f.size > 20 * 1024 * 1024) { set('Ukuran berkas melebihi 20 MB.', 'galat'); return; }
    const tombol = $('#kirim-tambah'); tombol.disabled = true; prog.hidden = false; prog.value = 10;
    try {
      let ekstraksi = '', potongan = [];
      if (jenis === 'gambar') {
        set('Membaca gambar dengan GPT-4o-mini Vision...');
        const url = await new Promise((ok, gagal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => gagal(r.error); r.readAsDataURL(f); });
        const j = await (await openai('chat/completions', { model: MODEL_CHAT, max_tokens: 1500, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT_VDU }, { type: 'image_url', image_url: { url } }] }] })).json();
        ekstraksi = j.choices?.[0]?.message?.content?.trim() || '';
        if (!ekstraksi) throw new Error('Ekstraksi VDU tidak menghasilkan teks.');
        potongan = pecahTeks(ekstraksi).map((teks) => ({ teks }));
      } else {
        set('Membaca teks PDF...');
        const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
        const pdf = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise; const halaman = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const tc = await (await pdf.getPage(i)).getTextContent();
          const teks = tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n');
          halaman.push(teks); for (const p of pecahTeks(teks)) potongan.push({ teks: p, halaman: i });
          prog.value = 10 + (30 * i) / pdf.numPages;
        }
        ekstraksi = halaman.map((t, i) => `## Halaman ${i + 1}\n\n${t.trim()}`).join('\n\n');
        if (!potongan.length) throw new Error('PDF tidak memuat teks yang dapat dibaca (kemungkinan hasil pindaian). Unggah halamannya sebagai gambar agar diproses oleh VDU.');
      }
      prog.value = 50; set(`Membuat embedding untuk ${potongan.length} potongan teks...`);
      const vek = await embed(potongan.map((p) => p.teks));
      potongan.forEach((p, i) => (p.vektor = vek[i]));
      const gtF = $('#gt-baru').files[0]; const gt = jenis === 'gambar' && gtF ? await gtF.text() : null;
      const kini = new Date().toISOString().slice(0, 19);
      const d = { id: 'lokal-' + crypto.randomUUID().slice(0, 8), judul, tipe: jenis, nama_berkas: f.name, blob: f, ekstraksi, ground_truth: gt, akurasi_f1: gt ? hitungF1(ekstraksi, gt) : null, potongan, dibuat: kini, diperbarui: kini, status_indeks: 'terindeks' };
      await DB.simpan(d);
      d.lokal = true; d.urlBerkas = URL.createObjectURL(f); state.lokal.push(d);
      prog.value = 100; set(`Dokumen ditambahkan dan diindeks (${potongan.length} potongan teks)${d.akurasi_f1 != null ? `, F1 ${angka(d.akurasi_f1)}%` : ''}.`, 'ok');
      dataBerubah(); setTimeout(() => dlg.close(), 1200);
    } catch (err) { set(err.message || String(err), 'galat'); }
    finally { tombol.disabled = false; }
  });
}

/* ---------- Evaluasi VDU ---------- */
function gambarEvaluasi() {
  const poster = semuaDokumen().filter((d) => d.tipe === 'gambar' && d.ground_truth && d.ekstraksi);
  const nilai = poster.map((d) => d.akurasi_f1 ?? hitungF1(d.ekstraksi, d.ground_truth));
  const r = rata(nilai), lolos = nilai.filter((x) => x >= TARGET_F1).length;
  $('#ringkas-evaluasi').innerHTML = kartuAngka([
    ['Rata-rata F1', `${angka(r)}<small>%</small>`, `${r >= TARGET_F1 ? '+' : ''}${angka(r - TARGET_F1)} poin dari target ${TARGET_F1}%`, r >= TARGET_F1 ? 'naik' : 'turun'],
    ['Poster dievaluasi', poster.length],
    ['Memenuhi target', `${lolos}<small> dari ${poster.length}</small>`],
  ]);
  $('#batang-f1').innerHTML = poster.map((d, i) => `<div class="batang__baris"><span class="batang__label">${esc(d.judul)}</span><span class="batang__jalur" role="img" aria-label="F1 ${angka(nilai[i])} persen"><span class="batang__isi" style="width:${nilai[i]}%" ${nilai[i] < TARGET_F1 ? 'data-bawah' : ''}></span><span class="batang__target" style="left:${TARGET_F1}%"></span></span><span class="batang__nilai">${angka(nilai[i])}%</span></div>`).join('');
  const seg = $('#pilih-poster'); seg.innerHTML = '';
  if (!poster.find((d) => d.id === state.posterAktif)) state.posterAktif = poster[0]?.id;
  for (const d of poster) {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(d.id === state.posterAktif) }, esc(d.judul));
    b.addEventListener('click', () => { state.posterAktif = d.id; gambarEvaluasi(); });
    seg.append(b);
  }
  const d = poster.find((x) => x.id === state.posterAktif); const wadah = $('#banding');
  if (!d) { wadah.innerHTML = '<p>Belum ada poster dengan ground truth.</p>'; return; }
  const P = kataUnik(d.ekstraksi), G = kataUnik(d.ground_truth);
  const tandai = (teks, lawan, kelas) => esc(teks).replace(/[\p{L}\p{N}_]+/gu, (w) => (lawan.has(w.toLowerCase()) ? w : `<mark class="${kelas}">${w}</mark>`));
  const hilang = [...G].filter((w) => !P.has(w)).length, lebih = [...P].filter((w) => !G.has(w)).length, cocok = G.size - hilang;
  wadah.innerHTML = `<p class="ringkas-selisih">Kata unik cocok: <b>${cocok}</b> dari ${G.size} pada ground truth dan ${P.size} pada hasil ekstraksi. Terlewat ${hilang} kata, berlebih ${lebih} kata. F1 ${angka(hitungF1(d.ekstraksi, d.ground_truth))}%.</p>
    <div class="banding__kolom"><h3>Ground truth</h3><p class="ket">Kata yang ditandai tidak ditemukan pada hasil VDU.</p><pre>${tandai(d.ground_truth, P, 'hilang')}</pre></div>
    <div class="banding__kolom"><h3>Hasil ekstraksi VDU</h3><p class="ket">Kata yang ditandai tidak ada pada ground truth.</p><pre>${tandai(d.ekstraksi, G, 'lebih')}</pre></div>`;
  wadah.toggleAttribute('data-tanpa-hilang', !$('#tanda-hilang').checked);
  wadah.toggleAttribute('data-tanpa-lebih', !$('#tanda-lebih').checked);
}

/* ---------- Uji 50 kueri ---------- */
function gambarUji() {
  const rows = state.uji.map((r) => ({ ...r, rank: parseInt(r.Rank_Target, 10) || 0, lat: parseFloat(r.Latensi_Detik) || 0 }));
  const ind = rows.filter((r) => r.Kategori === 'In-Domain'), ood = rows.filter((r) => r.Kategori !== 'In-Domain');
  const stat = (arr) => ({ n: arr.length, top1: arr.filter((r) => r.rank === 1).length, recall: arr.filter((r) => r.rank > 0).length, mrr: rata(arr.map((r) => (r.rank > 0 ? 1 / r.rank : 0))) });
  const s = stat(ind); const patuh = rows.filter((r) => r.Status_Halusinasi_Manual.startsWith('Patuh')).length;
  const tolak = ood.filter((r) => /Penolakan/.test(r.Status_Halusinasi_Manual)).length;
  $('#ringkas-uji').innerHTML = kartuAngka([
    ['MRR (40 kueri in-domain)', angka(s.mrr, 4), `Top-1 ${s.top1}/${s.n} · Recall@6 ${s.recall}/${s.n}`],
    ['Bebas halusinasi', `${angka((patuh / rows.length) * 100)}<small>%</small>`, `${patuh} dari ${rows.length} jawaban patuh`],
    ['Penolakan aman', `${tolak}<small>/${ood.length}</small>`, 'Kueri jebakan di luar domain'],
    ['Latensi rata-rata', `${angka(rata(rows.map((r) => r.lat)))}<small> dtk</small>`, `Median ${angka(median(rows.map((r) => r.lat)))} dtk · maks ${angka(Math.max(...rows.map((r) => r.lat)))} dtk`],
  ]);
  const tabel = (kunci) => {
    const grup = [...new Set(ind.map((r) => r[kunci]))];
    return `<div class="tabel-wadah"><table class="tabel"><thead><tr><th>${kunci === 'Target_Dokumen' ? 'Dokumen' : 'Gaya bahasa'}</th><th class="data">Top-1</th><th class="data">Recall@6</th><th class="data">MRR</th></tr></thead><tbody>${grup.map((g) => { const x = stat(ind.filter((r) => r[kunci] === g)); return `<tr><td>${esc(g)}</td><td class="data">${x.top1}/${x.n}</td><td class="data">${x.recall}/${x.n}</td><td class="data">${angka(x.mrr, 4)}</td></tr>`; }).join('')}</tbody></table></div>`;
  };
  $('#tabel-per-dokumen').innerHTML = tabel('Target_Dokumen');
  $('#tabel-per-gaya').innerHTML = tabel('Gaya_Bahasa');
  saringUji();
}
function saringUji() {
  const q = $('#cari-uji').value.trim().toLowerCase(), kat = $('#saring-kategori').value, gaya = $('#saring-gaya').value;
  const rows = state.uji.filter((r) => (!kat || r.Kategori === kat) && (!gaya || r.Gaya_Bahasa === gaya) && (!q || (r.Pertanyaan + ' ' + r.Jawaban_AI).toLowerCase().includes(q)));
  $('#jumlah-uji').textContent = `Menampilkan ${rows.length} dari ${state.uji.length} kueri.`;
  $('#daftar-uji').innerHTML = rows.map((r) => {
    const halu = r.Status_Halusinasi_Manual.startsWith('Halusinasi');
    return `<li><details><summary><span class="no">${esc(r.No)}</span><span class="tanya-teks">${esc(r.Pertanyaan)}</span><span class="lencana-baris"><span class="lencana">${esc(r.Kategori)}</span><span class="lencana">${esc(r.Gaya_Bahasa)}</span><span class="lencana ${halu ? 'lencana--bata' : ''}">${esc(r.Status_Halusinasi_Manual.replace(/^Patuh \((.*)\)$/, '$1'))}</span></span></summary>
      <div class="detail-isi"><div class="md">${md(r.Jawaban_AI)}</div><dl><dt>Target dokumen</dt><dd>${esc(r.Target_Dokumen)}</dd><dt>Peringkat target</dt><dd>${esc(r.Rank_Target)}</dd><dt>Reciprocal rank</dt><dd>${esc(r.Reciprocal_Rank)}</dd><dt>Latensi</dt><dd>${esc(angka(parseFloat(r.Latensi_Detik)))} dtk</dd></dl></div></details></li>`;
  }).join('');
}

/* ---------- Log ---------- */
const semuaLog = () => [...state.log, ...logLokal()];
function gambarLog() {
  const data = semuaLog(); const lat = data.map((d) => d.latensi_total_s || 0);
  $('#ringkas-log').innerHTML = kartuAngka([
    ['Jumlah kueri', data.length], ['Rata-rata waktu respons', `${angka(rata(lat))}<small> dtk</small>`], ['Median waktu respons', `${angka(median(lat))}<small> dtk</small>`], ['Kueri galat', data.filter((d) => d.galat).length],
  ]);
  const kanal = [...new Set(data.map((d) => d.kanal))];
  $('#tabel-kanal').innerHTML = `<div class="tabel-wadah"><table class="tabel"><thead><tr><th>Kanal</th><th class="data">Kueri</th><th class="data">Rata-rata</th><th class="data">Median</th></tr></thead><tbody>${kanal.map((k) => { const l = data.filter((d) => d.kanal === k).map((d) => d.latensi_total_s || 0); return `<tr><td>${esc(k)}</td><td class="data">${l.length}</td><td class="data">${angka(rata(l))} dtk</td><td class="data">${angka(median(l))} dtk</td></tr>`; }).join('')}</tbody></table></div>`;
  const sel = $('#saring-kanal'); const pilih = sel.value;
  sel.innerHTML = '<option value="">Semua kanal</option>' + kanal.map((k) => `<option ${k === pilih ? 'selected' : ''}>${esc(k)}</option>`).join('');
  // histogram
  const batas = [1, 2, 3, 4, 5, 6, 8, 10, Infinity];
  const label = ['<1', '1–2', '2–3', '3–4', '4–5', '5–6', '6–8', '8–10', '≥10'];
  const jml = batas.map(() => 0); for (const x of lat) jml[batas.findIndex((b) => x < b)]++;
  const W = 460, H = 200, pad = 26, bw = (W - pad) / batas.length, maks = Math.max(...jml, 1);
  $('#sebaran').innerHTML = `<svg viewBox="0 0 ${W} ${H + 34}" role="img" aria-label="Histogram waktu respons dalam detik">${jml.map((n, i) => { const h = (n / maks) * (H - 20); const x = pad + i * bw + 4; return `<rect x="${x}" y="${H - h}" width="${bw - 8}" height="${h}" rx="3" fill="${i < 4 ? '#2B6663' : '#B9772B'}"><title>${label[i]} detik: ${n} kueri</title></rect><text class="sumbu" x="${x + (bw - 8) / 2}" y="${H - h - 5}" text-anchor="middle">${n || ''}</text><text class="sumbu" x="${x + (bw - 8) / 2}" y="${H + 14}" text-anchor="middle">${label[i]}</text>`; }).join('')}<line x1="${pad}" x2="${W}" y1="${H}" y2="${H}" stroke="#D9E2E0"/><text class="sumbu" x="${W / 2}" y="${H + 30}" text-anchor="middle">waktu respons (detik)</text></svg>`;
  const lokal = logLokal().length; const c = $('#catatan-log-lokal');
  c.hidden = !lokal; c.innerHTML = lokal ? `${lokal} kueri tercatat dari peramban ini dan hanya tersimpan di sini. <button type="button" class="tombol tombol--teks tombol--kecil" id="hapus-log-lokal">Hapus log peramban ini</button>` : '';
  $('#hapus-log-lokal')?.addEventListener('click', () => { localStorage.removeItem(KUNCI_LOG); gambarLog(); });
  saringLog();
}
function saringLog() {
  const q = $('#cari-log').value.trim().toLowerCase(), k = $('#saring-kanal').value;
  const data = semuaLog().map((d, i) => ({ ...d, i })).filter((d) => (!k || d.kanal === k) && (!q || d.pertanyaan.toLowerCase().includes(q))).reverse();
  $('#jumlah-log').textContent = `Menampilkan ${Math.min(state.batasLog, data.length)} dari ${data.length} kueri, terbaru di atas.`;
  $('#daftar-log').innerHTML = data.slice(0, state.batasLog).map((d) => `<li><details><summary><span class="no">${d.i + 1}</span><span class="tanya-teks">${esc(d.pertanyaan)}</span><span class="lencana-baris"><span class="lencana">${esc(d.kanal)}</span><span class="lencana ${d.galat ? 'lencana--bata' : ''}">${angka(d.latensi_total_s)} dtk</span></span></summary>
    <div class="detail-isi"><div class="md">${md(d.jawaban)}</div><dl><dt>Waktu</dt><dd>${esc(waktu(d.waktu))}</dd><dt>Pencarian</dt><dd>${angka(d.latensi_retrieval_s)} dtk</dd><dt>Penyusunan jawaban</dt><dd>${angka(d.latensi_generasi_s)} dtk</dd>${(d.hasil || []).slice(0, 3).map((h) => `<dt>Sumber #${h.peringkat}</dt><dd>${esc(h.judul)} (${angka(h.kemiripan)}%)</dd>`).join('')}</dl></div></details></li>`).join('');
  $('#muat-log').hidden = data.length <= state.batasLog;
}
function unduhLog() {
  const kol = ['waktu', 'kanal', 'pertanyaan', 'jawaban', 'latensi_total_s', 'latensi_retrieval_s', 'latensi_generasi_s', 'galat', 'sumber_teratas', 'kemiripan_teratas'];
  const sel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const baris = semuaLog().map((d) => kol.map((k) => sel(k === 'sumber_teratas' ? d.hasil?.[0]?.judul : k === 'kemiripan_teratas' ? d.hasil?.[0]?.kemiripan : d[k])).join(','));
  const blob = new Blob(['\ufeff' + [kol.join(','), ...baris].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'log_kueri.csv' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Navigasi ---------- */
const RENDER = { dokumen: gambarDokumen, evaluasi: gambarEvaluasi, uji: gambarUji, log: gambarLog };
function tampilLayar(fokus) {
  const nama = (location.hash.slice(1) || 'tanya'); const ada = $(`[data-layar="${nama}"]`) ? nama : 'tanya';
  $$('[data-layar]').forEach((s) => (s.hidden = s.dataset.layar !== ada));
  $$('[data-menu]').forEach((a) => (a.dataset.menu === ada ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (RENDER[ada] && !state.sudah[ada]) { RENDER[ada](); state.sudah[ada] = true; }
  document.title = `${{ tanya: 'Tanya', dokumen: 'Dokumen', evaluasi: 'Evaluasi VDU', uji: 'Uji 50 kueri', log: 'Log kueri' }[ada]} · Cbot Upeks`;
  if (fokus) { const h = $(`[data-layar="${ada}"] h1`); if (ada === 'tanya') $('#masukan').focus({ preventScroll: true }); else { h.tabIndex = -1; h.focus({ preventScroll: true }); } window.scrollTo(0, 0); }
}
function dataBerubah() { state.indeksBm25 = null; state.sudah = {}; gambarRujukan(); tampilLayar(false); }

async function mulai() {
  siapkanKunci(); siapkanTambah();
  const ambil = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
  try {
    const [korpus, dokumen, log, uji] = await Promise.all([ambil('data/korpus.json'), ambil('data/dokumen.json'), ambil('data/log.json'), ambil('data/evaluasi-50-kueri.json')]);
    state.korpus = korpus.potongan.map((p) => ({ ...p, v: dekodeVektor(p.vektor), vektor: undefined }));
    state.dokumen = dokumen.map((d) => ({ ...d, kecil: d.berkas.replace(/\.png$/, '-kecil.jpg'), besar: d.berkas.replace(/\.png$/, '.jpg') }));
    state.log = log; state.uji = uji;
  } catch (e) {
    $('#percakapan').prepend(el('p', { class: 'pesan-dialog', 'data-jenis': 'galat' }, `Data gagal dimuat (${esc(e.message)}). Muat ulang halaman.`));
  }
  try { state.lokal = (await DB.semua()).map((d) => ({ ...d, lokal: true, urlBerkas: URL.createObjectURL(d.blob) })); } catch { state.lokal = []; }
  siapkanTanya(); gambarRujukan();
  $('#cari-uji').addEventListener('input', saringUji); $('#saring-kategori').addEventListener('change', saringUji); $('#saring-gaya').addEventListener('change', saringUji);
  $('#cari-log').addEventListener('input', () => { state.batasLog = 30; saringLog(); }); $('#saring-kanal').addEventListener('change', () => { state.batasLog = 30; saringLog(); });
  $('#muat-log').addEventListener('click', () => { state.batasLog += 30; saringLog(); });
  $('#unduh-log').addEventListener('click', unduhLog);
  $('#tanda-hilang').addEventListener('change', (e) => $('#banding').toggleAttribute('data-tanpa-hilang', !e.target.checked));
  $('#tanda-lebih').addEventListener('change', (e) => $('#banding').toggleAttribute('data-tanpa-lebih', !e.target.checked));
  $('#dialog-dokumen').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  window.addEventListener('hashchange', () => tampilLayar(true));
  tampilLayar(false);
}
mulai();
