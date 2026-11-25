import { $, $$, esc, angka, rata, median, durasi, labelTipe, el, kataUnik, hitungF1, md } from './alat.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './konfig.js';

const TARGET_F1 = 90;
const KUNCI_PERCAKAPAN = 'cbot-upeks-percakapan';
const KUNCI_RIWAYAT = 'cbot-upeks-riwayat';
const KUNCI_SAMPING = 'cbot-upeks-samping-tutup';
const BATAS_RIWAYAT = 30;
const SARAN = ['Tarif iklan umum berwarna', 'Syarat pasang iklan instansi', 'Harga langganan koran', 'Batas kirim materi iklan'];
const WARNA_KANAL = { web: '#F08A24', whatsapp: '#17A673', evaluasi_50: '#7C8BB0' };
const NAMA_KANAL = { web: 'Web', whatsapp: 'WhatsApp', evaluasi_50: 'Uji 50 kueri' };
const app = $('#app');
const ikon = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const tgl = (iso) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const kanal = (k) => NAMA_KANAL[k] || k;

/* ---------- Supabase ---------- */
let klien;
async function sb() {
  if (!SUPABASE_URL) throw new Error('Supabase belum dikonfigurasi.');
  if (!klien) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm');
    klien = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return klien;
}
const kepalaPublik = () => ({ apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` });

/* ---------- Umum: roti, dialog, transisi ---------- */
let waktuRoti;
function roti(teks) {
  const r = $('#roti'); r.textContent = teks; r.toggleAttribute('data-tampil', true);
  clearTimeout(waktuRoti); waktuRoti = setTimeout(() => r.removeAttribute('data-tampil'), 3200);
}

const dlg = $('#dialog');
let bisaTransisiDisplay;
function dukungKeluarLapisanAtas() {
  if (bisaTransisiDisplay === undefined) {
    bisaTransisiDisplay = false;
    if (CSS.supports?.('transition-behavior', 'allow-discrete')) {
      const p = document.createElement('div');
      p.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
      document.body.append(p); getComputedStyle(p).display; p.style.display = 'none';
      bisaTransisiDisplay = getComputedStyle(p).display === 'block'; p.remove();
    }
  }
  return CSS.supports?.('overlay', 'auto') && bisaTransisiDisplay;
}
async function tutupDialog() {
  if (!dlg.open) return;
  if (!dukungKeluarLapisanAtas()) {
    dlg.setAttribute('data-closing', '');
    const anim = dlg.getAnimations({ subtree: true });
    if (anim.length) await Promise.race([Promise.allSettled(anim.map((a) => a.finished)), new Promise((r) => setTimeout(r, 600))]);
    dlg.removeAttribute('data-closing');
  }
  dlg.close();
}
function bukaDialog(judul, isi) {
  $('#dialog-judul').textContent = judul;
  const w = $('#dialog-isi'); w.replaceChildren(...[].concat(isi)); w.scrollTop = 0;
  if (!dlg.open) dlg.showModal();
  return w;
}
dlg.addEventListener('cancel', (e) => { e.preventDefault(); tutupDialog(); });
dlg.addEventListener('click', (e) => {
  if (e.target.closest('[data-tutup]')) return tutupDialog();
  if ('closedBy' in HTMLDialogElement.prototype || e.target !== dlg) return;
  const r = dlg.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) tutupDialog();
});

function transisi(ubah, fokus) {
  const selesai = () => fokus?.()?.focus({ preventScroll: true });
  if (!document.startViewTransition) { ubah(); selesai(); return; }
  document.startViewTransition(ubah).finished.finally(selesai);
}

/* ---------- Chat ---------- */
const chat = { id: null, pesan: [], sibuk: null };
let riwayat = [];
try { riwayat = JSON.parse(localStorage.getItem(KUNCI_RIWAYAT) || '[]'); } catch { /* abaikan */ }
try {
  const aktif = riwayat.find((p) => p.id === sessionStorage.getItem(KUNCI_PERCAKAPAN));
  if (aktif) { chat.id = aktif.id; chat.pesan = [...aktif.pesan]; }
} catch { /* abaikan */ }
function simpanChat() {
  if (!chat.pesan.length) return;
  let p = riwayat.find((x) => x.id === chat.id);
  if (!p) { chat.id = crypto.randomUUID(); p = { id: chat.id, judul: chat.pesan[0].isi.slice(0, 80) }; }
  p.pesan = chat.pesan.slice(-40); p.waktu = Date.now();
  riwayat = [p, ...riwayat.filter((x) => x !== p)].slice(0, BATAS_RIWAYAT);
  simpanRiwayat();
}
function simpanRiwayat() {
  try { localStorage.setItem(KUNCI_RIWAYAT, JSON.stringify(riwayat)); sessionStorage.setItem(KUNCI_PERCAKAPAN, chat.id ?? ''); } catch { /* penuh */ }
  gambarRiwayat();
}
const aturKosong = () => app.toggleAttribute('data-kosong', !chat.pesan.length && !chat.sibuk);
function bukaPercakapan(p) {
  chat.sibuk?.abort(); chat.sibuk = null; aturTombolKirim(false);
  chat.id = p?.id ?? null; chat.pesan = p ? [...p.pesan] : [];
  try { sessionStorage.setItem(KUNCI_PERCAKAPAN, chat.id ?? ''); } catch { /* abaikan */ }
  laci.tutup();
  transisi(() => {
    $('#pesan-daftar').replaceChildren();
    for (const m of chat.pesan) m.peran === 'user' ? gambarUser(m.isi) : gambarBot(m);
    aturKosong(); gambarRiwayat(); window.scrollTo(0, document.body.scrollHeight);
  }, () => $('#masukan'));
}
const hariIni = (t) => new Date(t).toDateString() === new Date().toDateString();
function gambarRiwayat() {
  const ul = $('#riwayat-daftar');
  if (!riwayat.length) { ul.innerHTML = '<li class="laci__kosong">Belum ada percakapan</li>'; return; }
  ul.replaceChildren(...riwayat.map((p) => {
    const li = el('li', { 'data-aktif': p.id === chat.id });
    const buka = el('button', { type: 'button', class: 'laci__butir' }, `<span>${esc(p.judul)}</span><small>${hariIni(p.waktu) ? new Date(p.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : new Date(p.waktu).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</small>`);
    if (p.id === chat.id) buka.setAttribute('aria-current', 'true');
    buka.addEventListener('click', () => bukaPercakapan(p));
    const hapus = el('button', { type: 'button', class: 'ikon-tombol', 'aria-label': `Hapus percakapan: ${p.judul}` }, ikon('hapus'));
    hapus.addEventListener('click', () => {
      riwayat = riwayat.filter((x) => x !== p);
      if (p.id === chat.id) bukaPercakapan(null);
      simpanRiwayat(); roti('Percakapan dihapus');
      ($('.laci__butir', ul) ?? $('#tombol-reset')).focus();
    });
    li.append(buka, hapus); return li;
  }));
}

/* Laci riwayat: bilah samping di layar lebar, laci geser di layar sempit. */
const laci = (() => {
  const kotak = $('#riwayat'), gulir = $('.laci__gulir', kotak), lembar = $('.laci__lembar', kotak), pembuka = $('#riwayat-buka');
  const sempit = matchMedia('(width < 60rem)');
  const terbuka = () => kotak.hasAttribute('aria-modal');
  const lainnya = () => $$('.chat > :not(.laci)');
  function aturMode() {
    if (sempit.matches) {
      kotak.setAttribute('popover', 'manual'); kotak.setAttribute('role', 'dialog'); kotak.setAttribute('aria-labelledby', 'riwayat-judul');
      pembuka.setAttribute('aria-expanded', 'false');
    } else {
      if (terbuka()) selesaiTutup(false);
      for (const a of ['popover', 'role', 'aria-labelledby']) kotak.removeAttribute(a);
      pembuka.setAttribute('aria-expanded', String(!app.hasAttribute('data-riwayat-tutup')));
    }
  }
  async function buka() {
    kotak.showPopover();
    for (const n of lainnya()) n.inert = true;
    kotak.setAttribute('aria-modal', 'true');
    if (!CSS.supports('scroll-initial-target', 'nearest')) {
      gulir.scrollTo({ left: gulir.offsetWidth, behavior: 'instant' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    gulir.scrollTo({ left: 0, behavior: 'auto' });
  }
  function tutup() { if (terbuka()) gulir.scrollTo({ left: gulir.offsetWidth, behavior: 'auto' }); }
  function selesaiTutup(fokus = true) {
    if (!terbuka()) return;
    kotak.hidePopover();
    for (const n of lainnya()) n.inert = false;
    kotak.removeAttribute('aria-modal');
    pembuka.setAttribute('aria-expanded', 'false');
    if (fokus && (kotak.contains(document.activeElement) || document.activeElement === document.body)) pembuka.focus();
  }
  const ambang = 1 / window.innerWidth;
  new IntersectionObserver((entri) => {
    if (!sempit.matches) return;
    const e = entri.at(-1);
    if (e.intersectionRatio < ambang) selesaiTutup();
    if (e.intersectionRatio === 1) pembuka.setAttribute('aria-expanded', 'true');
  }, { root: kotak, threshold: [ambang, 1] }).observe(lembar);
  if (!CSS.supports('animation-timeline: scroll()')) gulir.addEventListener('scroll', () => kotak.style.setProperty('--laci-latar', 1 - gulir.scrollLeft / lembar.offsetWidth));
  pembuka.addEventListener('click', () => {
    if (sempit.matches) return buka();
    const tutupSamping = app.toggleAttribute('data-riwayat-tutup');
    pembuka.setAttribute('aria-expanded', String(!tutupSamping));
    try { localStorage.setItem(KUNCI_SAMPING, tutupSamping ? '1' : ''); } catch { /* abaikan */ }
  });
  $('#riwayat-tutup').addEventListener('click', tutup);
  kotak.addEventListener('click', (e) => { if (terbuka() && !lembar.contains(e.target)) tutup(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && terbuka()) tutup(); });
  try { app.toggleAttribute('data-riwayat-tutup', localStorage.getItem(KUNCI_SAMPING) === '1'); } catch { /* abaikan */ }
  sempit.addEventListener('change', aturMode); aturMode();
  return { tutup, paksaTutup: () => selesaiTutup(false) };
})();

function gambarUser(teks) { const n = el('div', { class: 'pesan pesan--user' }); n.textContent = teks; $('#pesan-daftar').append(n); return n; }
function gambarBot(m) {
  const n = el('article', { class: 'pesan pesan--bot' }, '<div class="md"><span class="mengetik" role="img" aria-label="Menyusun jawaban"><i></i><i></i><i></i></span></div>');
  $('#pesan-daftar').append(n);
  if (m) isiBot(n, m);
  return n;
}
function isiBot(n, m) {
  n.toggleAttribute('data-galat', !!m.galat);
  $('.md', n).innerHTML = m.galat ? `<p>${esc(m.isi)}</p>` : md(m.isi);
  $('.pesan__kaki', n)?.remove();
  if (m.galat) return;
  const kaki = el('div', { class: 'pesan__kaki' });
  const unik = []; for (const h of m.sumber || []) if (!unik.some((u) => u.doc_id === h.doc_id)) unik.push(h);
  for (const h of unik.slice(0, 3)) {
    const b = el('button', { class: 'sumber-chip', type: 'button' }, `<b>${h.peringkat}</b><span>${esc(h.judul)}</span>`);
    b.addEventListener('click', () => bukaSumber(m.sumber, h));
    kaki.append(b);
  }
  const meta = el('span', { class: 'pesan__meta' }, `${m.latensi ? durasi(m.latensi.total) : ''}<button class="ikon-tombol" type="button" aria-label="Salin jawaban">${ikon('salin')}</button>`);
  $('button', meta).addEventListener('click', async () => { try { await navigator.clipboard.writeText(m.isi); roti('Jawaban disalin'); } catch { roti('Tidak dapat menyalin'); } });
  kaki.append(meta); n.append(kaki);
}
function bukaSumber(semua, pilih) {
  const ol = el('ol', { class: 'potongan' });
  for (const h of semua) {
    const li = el('li', { 'data-sorot': h === pilih }, `<small>${esc(h.judul)}${h.halaman ? `, halaman ${h.halaman}` : ''} · kemiripan ${angka(h.kemiripan, 1)}%</small><div class="md">${md(h.teks)}</div>`);
    ol.append(li);
  }
  bukaDialog('Sumber jawaban', ol);
  requestAnimationFrame(() => $('[data-sorot]', ol)?.scrollIntoView({ block: 'nearest' }));
}

async function* sse(r) {
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) return;
    buf += dec.decode(value, { stream: true }); let n;
    while ((n = buf.indexOf('\n\n')) >= 0) {
      const blok = buf.slice(0, n); buf = buf.slice(n + 2);
      const ev = blok.match(/^event: (.*)$/m)?.[1], data = blok.match(/^data: (.*)$/m)?.[1];
      if (ev && data) { try { yield [ev, JSON.parse(data)]; } catch { /* potongan rusak */ } }
    }
  }
}

async function tanya(q) {
  q = q.trim(); if (!q || chat.sibuk) return;
  const ctrl = new AbortController(); chat.sibuk = ctrl;
  const mulai = () => { aturKosong(); gambarUser(q); };
  if (!chat.pesan.length && document.startViewTransition) await document.startViewTransition(mulai).updateCallbackDone; else mulai();
  const milik = chat.pesan; milik.push({ peran: 'user', isi: q }); simpanChat(); const id = chat.id;
  const n = gambarBot(); n.scrollIntoView({ block: 'end', behavior: 'smooth' });
  aturTombolKirim(true);
  const m = { peran: 'bot', isi: '', sumber: [], galat: false, latensi: null };
  try {
    if (!SUPABASE_URL) throw new Error('Layanan belum dikonfigurasi.');
    const r = await fetch(`${SUPABASE_URL}/functions/v1/tanya`, { method: 'POST', signal: ctrl.signal, headers: { ...kepalaPublik(), 'Content-Type': 'application/json' }, body: JSON.stringify({ pertanyaan: q }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).galat || `Layanan sedang bermasalah (${r.status}).`);
    const wadah = $('.md', n); let jadwal = 0;
    for await (const [ev, data] of sse(r)) {
      if (ev === 'sumber') m.sumber = data;
      else if (ev === 'teks') { m.isi += data; if (!jadwal) jadwal = requestAnimationFrame(() => { jadwal = 0; wadah.innerHTML = md(m.isi); }); }
      else if (ev === 'galat') { m.galat = true; m.isi = data; }
      else if (ev === 'selesai') m.latensi = data.latensi;
    }
    cancelAnimationFrame(jadwal);
  } catch (e) {
    if (e.name === 'AbortError') { if (!m.isi) { m.galat = true; m.isi = 'Dibatalkan.'; } }
    else { m.galat = true; m.isi = e instanceof TypeError ? 'Tidak dapat terhubung. Periksa koneksi internet, lalu coba lagi.' : e.message; }
  }
  isiBot(n, m); milik.push(m);
  if (chat.pesan === milik) simpanChat();
  else { const p = riwayat.find((x) => x.id === id); if (p) { p.pesan = milik.slice(-40); simpanRiwayat(); } }
  if (chat.sibuk === ctrl) { chat.sibuk = null; aturTombolKirim(false); aturKosong(); }
}
function aturTombolKirim(sibuk) {
  const b = $('#tombol-kirim'); b.setAttribute('aria-label', sibuk ? 'Hentikan' : 'Kirim');
  $('use', b).setAttribute('href', sibuk ? '#i-henti' : '#i-kirim');
}

function siapkanChat() {
  const form = $('#form-tanya'), masukan = $('#masukan');
  for (const s of SARAN) { const b = el('button', { type: 'button' }, esc(s)); b.addEventListener('click', () => tanya(s)); $('#saran').append(b); }
  masukan.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (e.isComposing || e.keyCode === 229) return;
    form.requestSubmit();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chat.sibuk) return chat.sibuk.abort();
    const q = masukan.value; masukan.value = ''; tanya(q);
  });
  $('#tombol-reset').addEventListener('click', () => bukaPercakapan(null));
  for (const m of chat.pesan) m.peran === 'user' ? gambarUser(m.isi) : gambarBot(m);
  aturKosong(); gambarRiwayat();
  if (SUPABASE_URL) fetch(`${SUPABASE_URL}/rest/v1/dokumen_publik?select=judul`, { headers: kepalaPublik() })
    .then((r) => (r.ok ? r.json() : [])).then((d) => { if (d.length) $('#rujukan-ringkas').textContent = `Dijawab dari ${d.length} dokumen resmi Upeks`; }).catch(() => {});
}

/* ---------- Sesi admin ---------- */
const admin = { sesi: null, data: null, memuat: null, poster: null, batasLog: 30 };
const adalahAdmin = (s) => s?.user?.app_metadata?.role === 'admin';
async function sesiAdmin() {
  if (admin.sesi) return admin.sesi;
  try { const { data } = await (await sb()).auth.getSession(); admin.sesi = adalahAdmin(data.session) ? data.session : null; } catch { admin.sesi = null; }
  return admin.sesi;
}
function siapkanMasuk() {
  const form = $('#form-masuk'), pesan = $('#pesan-masuk'), sandi = $('#current-password'), lihat = $('#lihat-sandi');
  lihat.addEventListener('click', () => {
    const tampil = sandi.type === 'password'; sandi.type = tampil ? 'text' : 'password';
    lihat.setAttribute('aria-pressed', String(tampil)); lihat.setAttribute('aria-label', tampil ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); pesan.textContent = '';
    const tombol = $('#kirim-masuk'); tombol.disabled = true; tombol.textContent = 'Memeriksa…';
    try {
      const s = await sb();
      const { data, error } = await s.auth.signInWithPassword({ email: form.email.value.trim(), password: sandi.value });
      if (error) throw new Error(error.status === 400 ? 'Email atau kata sandi salah.' : error.status === 429 ? 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' : 'Tidak dapat masuk. Periksa koneksi, lalu coba lagi.');
      if (!adalahAdmin(data.session)) { await s.auth.signOut(); throw new Error('Akun ini bukan admin.'); }
      admin.sesi = data.session; form.reset(); location.hash = '#/admin';
    } catch (err) { pesan.textContent = err.message; sandi.focus(); sandi.select(); }
    finally { tombol.disabled = false; tombol.textContent = 'Masuk'; }
  });
}
async function keluar() {
  try { await (await sb()).auth.signOut(); } catch { /* tetap keluar secara lokal */ }
  admin.sesi = null; admin.data = null; location.hash = '#/';
}

/* ---------- Data admin ---------- */
async function muatData(paksa = false) {
  if (admin.data && !paksa) return admin.data;
  return admin.memuat ??= (async () => {
    try {
      const s = await sb();
      const ambil = async (q) => { const { data, error } = await q; if (error) throw new Error('Data gagal dimuat. Muat ulang halaman.'); return data; };
      const [dokumen, potongan, log, uji] = await Promise.all([
        ambil(s.from('dokumen').select('*').order('dibuat')),
        ambil(s.from('potongan').select('id,doc_id,urutan,halaman,teks').order('urutan')),
        (async () => {
          const semua = [];
          for (let dari = 0; ; dari += 1000) {
            const bagian = await ambil(s.from('log_kueri').select('*').order('waktu', { ascending: false }).order('id').range(dari, dari + 999));
            semua.push(...bagian);
            if (bagian.length < 1000) return semua;
          }
        })(),
        ambil(s.from('uji_kueri').select('*').order('no')),
      ]);
      const gambar = dokumen.filter((d) => d.tipe === 'gambar');
      if (gambar.length) {
        const { data: tanda } = await s.storage.from('dokumen').createSignedUrls(gambar.map((d) => `kecil/${d.id}.jpg`), 3600);
        gambar.forEach((d, i) => (d.kecil = tanda?.[i]?.signedUrl || null));
      }
      for (const d of dokumen) d.potongan = potongan.filter((p) => p.doc_id === d.id);
      return (admin.data = { dokumen, log, uji });
    } finally { admin.memuat = null; }
  })();
}
const kartuAngka = (arr) => `<dl class="kisi kisi--4">${arr.map(([l, v, ket, nada]) => `<div class="angka"><dt>${esc(l)}</dt><dd>${v}</dd>${ket ? `<p ${nada ? `data-nada="${nada}"` : ''}>${ket}</p>` : ''}</div>`).join('')}</dl>`;
const statUji = (arr) => ({ n: arr.length, top1: arr.filter((r) => r.rank_target === 1).length, recall: arr.filter((r) => r.rank_target > 0).length, mrr: rata(arr.map((r) => (r.rank_target > 0 ? 1 / r.rank_target : 0))) });
const f1Poster = (d) => d.dokumen.filter((x) => x.tipe === 'gambar' && x.akurasi_f1 != null);

/* ---------- Halaman: Ringkasan ---------- */
function halRingkasan(d, w) {
  const poster = f1Poster(d), f1 = rata(poster.map((p) => +p.akurasi_f1));
  const ind = d.uji.filter((r) => r.kategori === 'In-Domain'), s = statUji(ind);
  const patuh = d.uji.filter((r) => r.status.startsWith('Patuh')).length;
  const lat = d.log.map((l) => +l.latensi_total_s);
  w.innerHTML = kartuAngka([
    ['Dokumen terindeks', d.dokumen.filter((x) => x.status_indeks === 'terindeks').length, `${d.dokumen.reduce((n, x) => n + x.potongan.length, 0)} potongan teks`],
    ['F1 ekstraksi VDU', poster.length ? `${angka(f1, 1)}<small>%</small>` : '–', poster.length ? `${f1 >= TARGET_F1 ? 'Di atas' : 'Di bawah'} target ${TARGET_F1}%` : '', f1 >= TARGET_F1 ? 'baik' : 'buruk'],
    ['MRR penarikan', d.uji.length ? angka(s.mrr, 2) : '–', d.uji.length ? `${angka((patuh / d.uji.length) * 100, 0)}% jawaban bebas halusinasi` : ''],
    ['Waktu respons median', lat.length ? `${angka(median(lat), 1)}<small>dtk</small>` : '–', `${d.log.length} kueri tercatat`],
  ]) + `<div class="kisi kisi--2"><section class="panel"><h2>Kueri per hari</h2><div class="grafik" id="g-harian"></div></section>
    <section class="panel"><h2>F1 per poster</h2><div class="batang" id="g-f1"></div></section></div>
    <section class="panel"><div class="panel__kepala"><h2>Kueri terbaru</h2><a class="tautan" href="#/admin/log">Semua log</a></div><div class="tabel-gulir" id="t-baru"></div></section>`;
  grafikHarian(d.log, $('#g-harian', w)); batangF1(poster, $('#g-f1', w));
  $('#t-baru', w).innerHTML = d.log.length ? `<table class="tabel"><tbody>${d.log.slice(0, 6).map((l) => `<tr><td>${esc(l.pertanyaan.slice(0, 90))}</td><td><span class="lencana">${esc(kanal(l.kanal))}</span></td><td class="n">${angka(+l.latensi_total_s, 1)} dtk</td></tr>`).join('')}</tbody></table>` : '<p class="kosong">Belum ada kueri.</p>';
}
function grafikHarian(log, w) {
  const hari = new Map();
  for (const l of log) { const k = l.waktu.slice(0, 10); const o = hari.get(k) || {}; o[l.kanal] = (o[l.kanal] || 0) + 1; hari.set(k, o); }
  const kunci = [...hari.keys()].sort().slice(-14); if (!kunci.length) { w.innerHTML = '<p class="kosong">Belum ada kueri.</p>'; return; }
  const kanalAda = [...new Set(log.map((l) => l.kanal))];
  const W = 520, H = 190, bw = W / kunci.length, maks = Math.max(...kunci.map((k) => Object.values(hari.get(k)).reduce((a, b) => a + b, 0)));
  let svg = `<svg viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="Jumlah kueri per hari menurut kanal">`;
  kunci.forEach((k, i) => {
    let y = H; const total = Object.values(hari.get(k)).reduce((a, b) => a + b, 0);
    for (const kn of kanalAda) { const n = hari.get(k)[kn] || 0; if (!n) continue; const h = (n / maks) * (H - 22); y -= h; svg += `<rect x="${i * bw + bw * 0.18}" y="${y}" width="${bw * 0.64}" height="${Math.max(h - 1.5, 1)}" rx="3" fill="${WARNA_KANAL[kn] || '#7C8BB0'}"><title>${k} · ${kanal(kn)}: ${n}</title></rect>`; }
    svg += `<text x="${i * bw + bw / 2}" y="${y - 6}" text-anchor="middle">${total}</text><text x="${i * bw + bw / 2}" y="${H + 16}" text-anchor="middle">${+k.slice(8)}/${+k.slice(5, 7)}</text>`;
  });
  w.innerHTML = svg + '</svg>' + `<div class="legenda">${kanalAda.map((k) => `<span><i style="background:${WARNA_KANAL[k] || '#7C8BB0'}"></i>${esc(kanal(k))}</span>`).join('')}</div>`;
}
function batangF1(poster, w) {
  w.innerHTML = poster.length ? poster.map((p) => `<div class="batang__baris"><span>${esc(p.judul)}</span><b>${angka(+p.akurasi_f1, 1)}%</b><div class="batang__jalur" role="img" aria-label="F1 ${angka(+p.akurasi_f1, 1)} persen, target ${TARGET_F1} persen"><i style="width:${p.akurasi_f1}%" ${p.akurasi_f1 < TARGET_F1 ? 'data-bawah' : ''}></i><u style="left:${TARGET_F1}%"></u></div></div>`).join('') : '<p class="kosong">Belum ada poster dengan ground truth.</p>';
}

/* ---------- Halaman: Dokumen ---------- */
function halDokumen(d, w, aksi) {
  const tambah = el('button', { class: 'tombol tombol--utama', type: 'button' }, `${ikon('baru')}Tambah dokumen`);
  tambah.addEventListener('click', dialogTambah); aksi.append(tambah);
  if (!d.dokumen.length) { w.innerHTML = '<p class="kosong">Belum ada dokumen. Tambahkan poster atau PDF untuk mulai.</p>'; return; }
  const kisi = el('div', { class: 'dok-kisi' });
  for (const x of d.dokumen) {
    const b = el('button', { class: 'dok-kartu', type: 'button' }, `<span class="dok-kartu__gambar">${x.kecil ? `<img src="${esc(x.kecil)}" alt="" loading="lazy">` : 'PDF'}</span><span class="dok-kartu__teks"><strong>${esc(x.judul)}</strong><span><span class="lencana">${labelTipe(x.tipe)}</span><span class="lencana">${x.potongan.length} potongan</span>${x.akurasi_f1 != null ? `<span class="lencana" data-nada="${x.akurasi_f1 >= TARGET_F1 ? 'baik' : 'aksen'}">F1 ${angka(+x.akurasi_f1, 1)}%</span>` : ''}${x.status_indeks !== 'terindeks' ? `<span class="lencana" data-nada="buruk">${x.status_indeks === 'gagal' ? 'Gagal diindeks' : 'Belum diindeks'}</span>` : ''}</span></span>`);
    b.addEventListener('click', () => dialogDokumen(x));
    kisi.append(b);
  }
  w.append(kisi);
}
async function bacaPdf(blob) {
  const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer(), isEvalSupported: false }).promise; const halaman = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    halaman.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n'));
  }
  return halaman;
}
async function buatKecil(berkas) {
  const bmp = await createImageBitmap(berkas); const w = 420, h = Math.round((bmp.height * w) / bmp.width);
  const c = new OffscreenCanvas(w, h); c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}
async function indeks(x, berkas) {
  const s = await sb(); let halaman;
  if (x.tipe === 'pdf') {
    if (!berkas) { const { data, error } = await s.storage.from('dokumen').download(x.berkas); if (error) throw new Error('Berkas PDF tidak ditemukan.'); berkas = data; }
    halaman = await bacaPdf(berkas);
  }
  const { data, error } = await s.functions.invoke('indeks', { body: { id: x.id, halaman } });
  if (error) { let pesan = 'Pengindeksan gagal.'; try { pesan = (await error.context.json()).galat || pesan; } catch { /* pakai pesan umum */ } throw new Error(pesan); }
  return data;
}
function dialogTambah() {
  const f = el('form', { class: 'kisi' }, `
    <fieldset><legend>Jenis</legend><div class="pilihan"><label><input type="radio" name="tipe" value="gambar" checked>Poster</label><label><input type="radio" name="tipe" value="pdf">PDF</label></div></fieldset>
    <div class="isian"><label for="t-judul">Judul</label><input id="t-judul" name="judul" required maxlength="120" autocomplete="off"></div>
    <div class="isian"><label for="t-berkas">Berkas</label><input id="t-berkas" name="berkas" type="file" accept=".png,.jpg,.jpeg" required></div>
    <div class="isian" id="t-baris-gt"><label for="t-gt">Ground truth (.txt, opsional)</label><input id="t-gt" name="gt" type="file" accept=".txt"></div>
    <progress max="100" value="0" hidden></progress><p class="pesan-form" role="alert"></p>
    <div class="lembar__aksi"><button class="tombol tombol--garis" type="button" data-tutup>Batal</button><button class="tombol tombol--utama" type="submit">Simpan dan indeks</button></div>`);
  const pesan = $('.pesan-form', f), prog = $('progress', f);
  f.addEventListener('change', (e) => { if (e.target.name !== 'tipe') return; const g = f.tipe.value === 'gambar'; f.berkas.accept = g ? '.png,.jpg,.jpeg' : '.pdf'; f.berkas.value = ''; $('#t-baris-gt', f).hidden = !g; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); pesan.textContent = '';
    const berkas = f.berkas.files[0], tipe = f.tipe.value;
    if (berkas.size > 20 * 1024 * 1024) { pesan.textContent = 'Ukuran berkas melebihi 20 MB.'; return; }
    const tombol = $('[type=submit]', f); tombol.disabled = true; prog.hidden = false; prog.value = 15;
    const id = 'doc-' + crypto.randomUUID().slice(0, 8), jalur = `${id}.${berkas.name.split('.').pop().toLowerCase()}`;
    try {
      const s = await sb();
      const { error: e1 } = await s.storage.from('dokumen').upload(jalur, berkas, { contentType: berkas.type });
      if (e1) throw new Error('Berkas gagal diunggah.');
      if (tipe === 'gambar') await s.storage.from('dokumen').upload(`kecil/${id}.jpg`, await buatKecil(berkas), { contentType: 'image/jpeg' });
      prog.value = 40;
      const gt = tipe === 'gambar' && f.gt.files[0] ? await f.gt.files[0].text() : null;
      const baris = { id, judul: f.judul.value.trim(), tipe, berkas: jalur, ground_truth: gt };
      const { error: e2 } = await s.from('dokumen').insert(baris);
      if (e2) throw new Error('Dokumen gagal disimpan.');
      prog.value = 60;
      const h = await indeks(baris, berkas);
      prog.value = 100; await tutupDialog(); roti(`Dokumen diindeks, ${h.jumlah_potongan} potongan`);
    } catch (err) { pesan.textContent = err.message; }
    finally { tombol.disabled = false; await segarkan(); }
  });
  bukaDialog('Tambah dokumen', f); f.judul.focus();
}
function dialogDokumen(x) {
  const seg = el('div', { class: 'segmen' }), isi = el('div', { class: 'kisi' });
  const tab = [['berkas', 'Berkas'], x.ekstraksi && ['ekstraksi', 'Ekstraksi'], ['potongan', `Potongan (${x.potongan.length})`], ['ubah', 'Ubah']].filter(Boolean);
  const tampil = async (k) => {
    $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
    isi.replaceChildren();
    if (k === 'berkas') {
      isi.append(el('div', { class: 'kerangka' }));
      const { data } = await (await sb()).storage.from('dokumen').createSignedUrl(x.berkas, 600);
      isi.replaceChildren(data?.signedUrl ? (x.tipe === 'gambar' ? el('img', { src: data.signedUrl, alt: `Poster ${x.judul}` }) : el('iframe', { src: data.signedUrl, title: `PDF ${x.judul}` })) : el('p', { class: 'kosong' }, 'Berkas tidak ditemukan.'));
      isi.className = 'lembar__isi'; isi.style.padding = '0';
    } else if (k === 'ekstraksi') isi.append(el('div', { class: 'md' }, md(x.ekstraksi)));
    else if (k === 'potongan') isi.append(el('ol', { class: 'potongan' }, x.potongan.map((p, i) => `<li><small>Potongan ${i + 1}${p.halaman ? `, halaman ${p.halaman}` : ''}</small><div class="md">${md(p.teks)}</div></li>`).join('')));
    else isi.append(formUbah(x));
  };
  for (const [k, label] of tab) { const b = el('button', { type: 'button', 'data-k': k }, esc(label)); b.addEventListener('click', () => tampil(k)); seg.append(b); }
  bukaDialog(x.judul, [seg, isi]); tampil('berkas');
}
function formUbah(x) {
  const f = el('form', { class: 'kisi' }, `
    <div class="isian"><label for="u-judul">Judul</label><input id="u-judul" name="judul" required maxlength="120" autocomplete="off"></div>
    ${x.tipe === 'gambar' ? '<div class="isian"><label for="u-gt">Ground truth</label><textarea id="u-gt" name="gt" rows="6"></textarea></div>' : ''}
    <p class="pesan-form" role="alert">${esc(x.catatan || '')}</p>
    <div class="lembar__aksi"><button class="tombol tombol--bahaya" type="button" data-a="hapus">${ikon('hapus')}Hapus</button><button class="tombol tombol--garis" type="button" data-a="indeks">${ikon('muat')}Indeks ulang</button><button class="tombol tombol--utama" type="submit">Simpan</button></div>`);
  f.judul.value = x.judul; if (f.gt) f.gt.value = x.ground_truth || '';
  const pesan = $('.pesan-form', f);
  const jalankan = async (tombol, fn, sukses) => {
    pesan.textContent = ''; $$('button', f).forEach((b) => (b.disabled = true));
    try { await fn(); await tutupDialog(); roti(sukses); await segarkan(); }
    catch (err) { pesan.textContent = err.message; $$('button', f).forEach((b) => (b.disabled = false)); }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); jalankan(e.submitter, async () => {
    const gt = f.gt ? f.gt.value.trim() || null : null;
    const ubah = { judul: f.judul.value.trim(), ground_truth: gt, diperbarui: new Date().toISOString() };
    if (x.tipe === 'gambar') ubah.akurasi_f1 = gt && x.ekstraksi ? hitungF1(x.ekstraksi, gt) : null;
    const { error } = await (await sb()).from('dokumen').update(ubah).eq('id', x.id);
    if (error) throw new Error('Perubahan gagal disimpan.');
  }, 'Perubahan disimpan'); });
  $('[data-a=indeks]', f).addEventListener('click', (e) => jalankan(e.currentTarget, () => indeks(x), 'Dokumen diindeks ulang'));
  let yakin = false;
  $('[data-a=hapus]', f).addEventListener('click', (e) => {
    if (!yakin) { yakin = true; e.currentTarget.lastChild.textContent = 'Hapus permanen?'; return; }
    jalankan(e.currentTarget, async () => {
      const s = await sb();
      const { error } = await s.from('dokumen').delete().eq('id', x.id);
      if (error) throw new Error('Dokumen gagal dihapus.');
      await s.storage.from('dokumen').remove([x.berkas, `kecil/${x.id}.jpg`]);
    }, 'Dokumen dihapus');
  });
  return f;
}

/* ---------- Halaman: Evaluasi ---------- */
function halEvaluasi(d, w) {
  const poster = d.dokumen.filter((x) => x.tipe === 'gambar' && x.ground_truth && x.ekstraksi);
  if (!poster.length) { w.innerHTML = '<p class="kosong">Belum ada poster dengan ground truth. Tambahkan ground truth di menu Dokumen.</p>'; return; }
  const nilai = poster.map((p) => +p.akurasi_f1), r = rata(nilai);
  if (!poster.some((p) => p.id === admin.poster)) admin.poster = poster[0].id;
  w.innerHTML = kartuAngka([
    ['Rata-rata F1', `${angka(r, 2)}<small>%</small>`, `${r >= TARGET_F1 ? '+' : ''}${angka(r - TARGET_F1, 2)} poin dari target`, r >= TARGET_F1 ? 'baik' : 'buruk'],
    ['Memenuhi target', `${nilai.filter((n) => n >= TARGET_F1).length}<small>dari ${poster.length}</small>`],
  ]) + `<section class="panel"><h2>F1 per poster</h2><div class="batang" id="e-f1"></div></section>
    <section class="panel"><div class="panel__kepala"><h2>Selisih kata</h2><div class="segmen" id="e-pilih"></div></div><div class="banding" id="e-banding"></div></section>`;
  batangF1(poster, $('#e-f1', w));
  const gambar = () => {
    const x = poster.find((p) => p.id === admin.poster), P = kataUnik(x.ekstraksi), G = kataUnik(x.ground_truth);
    const tandai = (t, lawan, kelas) => esc(t).replace(/[\p{L}\p{N}_]+/gu, (k) => (lawan.has(k.toLowerCase()) ? k : `<mark class="${kelas}">${k}</mark>`));
    const hilang = [...G].filter((k) => !P.has(k)).length, lebih = [...P].filter((k) => !G.has(k)).length;
    $('#e-banding', w).innerHTML = `<div><h3>Ground truth <span class="lencana" data-nada="aksen">${hilang} kata terlewat</span></h3><pre>${tandai(x.ground_truth, P, 'hilang')}</pre></div><div><h3>Hasil VDU <span class="lencana" data-nada="baik">${lebih} kata tambahan</span></h3><pre>${tandai(x.ekstraksi, G, 'lebih')}</pre></div>`;
    $$('#e-pilih button', w).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === admin.poster)));
  };
  for (const p of poster) { const b = el('button', { type: 'button', 'data-id': p.id }, esc(p.judul)); b.addEventListener('click', () => { admin.poster = p.id; gambar(); }); $('#e-pilih', w).append(b); }
  gambar();
}

/* ---------- Halaman: Uji ---------- */
function halUji(d, w) {
  if (!d.uji.length) { w.innerHTML = '<p class="kosong">Belum ada hasil uji.</p>'; return; }
  const ind = d.uji.filter((r) => r.kategori === 'In-Domain'), ood = d.uji.filter((r) => r.kategori !== 'In-Domain'), s = statUji(ind);
  const patuh = d.uji.filter((r) => r.status.startsWith('Patuh')).length, lat = d.uji.map((r) => +r.latensi_detik);
  const tabel = (kunci, judul) => `<section class="panel"><h2>${judul}</h2><div class="tabel-gulir"><table class="tabel"><thead><tr><th></th><th class="n">Top-1</th><th class="n">Recall@6</th><th class="n">MRR</th></tr></thead><tbody>${[...new Set(ind.map((r) => r[kunci]))].map((g) => { const x = statUji(ind.filter((r) => r[kunci] === g)); return `<tr><td>${esc(g)}</td><td class="n">${x.top1}/${x.n}</td><td class="n">${x.recall}/${x.n}</td><td class="n">${angka(x.mrr, 2)}</td></tr>`; }).join('')}</tbody></table></div></section>`;
  w.innerHTML = kartuAngka([
    ['MRR', angka(s.mrr, 4), `Top-1 ${s.top1}/${s.n}, Recall@6 ${s.recall}/${s.n}`],
    ['Bebas halusinasi', `${angka((patuh / d.uji.length) * 100, 0)}<small>%</small>`, `${patuh} dari ${d.uji.length} jawaban`],
    ['Kueri jebakan ditolak', `${ood.filter((r) => /Penolakan/.test(r.status)).length}<small>dari ${ood.length}</small>`],
    ['Latensi rata-rata', `${angka(rata(lat), 2)}<small>dtk</small>`, `Median ${angka(median(lat), 2)} dtk`],
  ]) + `<div class="kisi kisi--2">${tabel('target_dokumen', 'Per dokumen')}${tabel('gaya_bahasa', 'Per gaya bahasa')}</div>
    <section class="panel"><div class="panel__kepala"><h2>Kueri</h2><div class="saring"><input type="search" id="u-cari" placeholder="Cari" aria-label="Cari kueri"><select id="u-kat" aria-label="Kategori"><option value="">Semua kategori</option><option>In-Domain</option><option>Out-of-Domain</option></select><select id="u-gaya" aria-label="Gaya bahasa"><option value="">Semua gaya</option><option>Baku</option><option>Makassar</option></select></div></div><p class="jumlah" id="u-jumlah"></p><ol class="daftar" id="u-daftar"></ol></section>`;
  const saring = () => {
    const q = $('#u-cari', w).value.trim().toLowerCase(), kat = $('#u-kat', w).value, gaya = $('#u-gaya', w).value;
    const rows = d.uji.filter((r) => (!kat || r.kategori === kat) && (!gaya || r.gaya_bahasa === gaya) && (!q || `${r.pertanyaan} ${r.jawaban_ai}`.toLowerCase().includes(q)));
    $('#u-jumlah', w).textContent = `${rows.length} dari ${d.uji.length} kueri`;
    $('#u-daftar', w).innerHTML = rows.map((r) => `<li><details><summary><span>${esc(r.pertanyaan)}</span><span><span class="lencana">${esc(r.gaya_bahasa)}</span><span class="lencana" data-nada="${r.status.startsWith('Halusinasi') ? 'buruk' : r.kategori === 'In-Domain' ? 'baik' : 'aksen'}">${esc(r.status.replace(/^\w+ \((.*)\)$/, '$1'))}</span></span></summary><div class="daftar__isi"><div class="md">${md(r.jawaban_ai)}</div><p class="rinci"><span>Target <b>${esc(r.target_dokumen === 'TIDAK_ADA' ? 'di luar dokumen' : r.target_dokumen)}</b></span>${r.rank_target ? `<span>Peringkat <b>${r.rank_target}</b></span>` : ''}<span>Latensi <b>${angka(+r.latensi_detik, 2)} dtk</b></span></p></div></details></li>`).join('') || '<li class="kosong">Tidak ada kueri yang cocok.</li>';
  };
  $('#u-cari', w).addEventListener('input', saring); $('#u-kat', w).addEventListener('change', saring); $('#u-gaya', w).addEventListener('change', saring); saring();
}

/* ---------- Halaman: Log ---------- */
function halLog(d, w, aksi) {
  const unduh = el('button', { class: 'tombol tombol--garis', type: 'button' }, `${ikon('unduh')}Unduh CSV`);
  unduh.addEventListener('click', () => unduhLog(d.log)); aksi.append(unduh);
  if (!d.log.length) { w.innerHTML = '<p class="kosong">Belum ada kueri. Log terisi saat chatbot dipakai.</p>'; return; }
  const lat = d.log.map((l) => +l.latensi_total_s), kanalAda = [...new Set(d.log.map((l) => l.kanal))];
  w.innerHTML = kartuAngka([
    ['Kueri', d.log.length], ['Rata-rata', `${angka(rata(lat), 2)}<small>dtk</small>`], ['Median', `${angka(median(lat), 2)}<small>dtk</small>`], ['Galat', d.log.filter((l) => l.galat).length],
  ]) + `<div class="kisi kisi--2"><section class="panel"><h2>Per kanal</h2><div class="tabel-gulir"><table class="tabel"><thead><tr><th></th><th class="n">Kueri</th><th class="n">Rata-rata</th><th class="n">Median</th></tr></thead><tbody>${kanalAda.map((k) => { const l = d.log.filter((x) => x.kanal === k).map((x) => +x.latensi_total_s); return `<tr><td>${esc(kanal(k))}</td><td class="n">${l.length}</td><td class="n">${angka(rata(l), 2)} dtk</td><td class="n">${angka(median(l), 2)} dtk</td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="panel"><h2>Sebaran waktu respons</h2><div class="grafik" id="l-sebaran"></div></section></div>
    <section class="panel"><div class="panel__kepala"><h2>Kueri</h2><div class="saring"><input type="search" id="l-cari" placeholder="Cari" aria-label="Cari log"><select id="l-kanal" aria-label="Kanal"><option value="">Semua kanal</option>${kanalAda.map((k) => `<option value="${esc(k)}">${esc(kanal(k))}</option>`).join('')}</select></div></div><p class="jumlah" id="l-jumlah"></p><ol class="daftar" id="l-daftar"></ol><button class="tombol tombol--garis" type="button" id="l-lagi" hidden>Tampilkan lebih banyak</button></section>`;
  const batas = [1, 2, 3, 4, 5, 6, 8, 10, Infinity], label = ['<1', '1–2', '2–3', '3–4', '4–5', '5–6', '6–8', '8–10', '≥10'], jml = batas.map(() => 0);
  for (const x of lat) jml[batas.findIndex((b) => x < b)]++;
  const W = 520, H = 190, bw = W / batas.length, maks = Math.max(...jml, 1);
  $('#l-sebaran', w).innerHTML = `<svg viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="Histogram waktu respons dalam detik">${jml.map((n, i) => { const h = (n / maks) * (H - 22); return `<rect x="${i * bw + bw * 0.14}" y="${H - h}" width="${bw * 0.72}" height="${Math.max(h, 1)}" rx="3" fill="${i < 4 ? '#17A673' : '#F08A24'}"><title>${label[i]} detik: ${n} kueri</title></rect><text x="${i * bw + bw / 2}" y="${H - h - 6}" text-anchor="middle">${n || ''}</text><text x="${i * bw + bw / 2}" y="${H + 16}" text-anchor="middle">${label[i]}</text>`; }).join('')}</svg>`;
  admin.batasLog = 30;
  const saring = () => {
    const q = $('#l-cari', w).value.trim().toLowerCase(), k = $('#l-kanal', w).value;
    const rows = d.log.filter((l) => (!k || l.kanal === k) && (!q || l.pertanyaan.toLowerCase().includes(q)));
    $('#l-jumlah', w).textContent = `${Math.min(admin.batasLog, rows.length)} dari ${rows.length} kueri`;
    $('#l-daftar', w).innerHTML = rows.slice(0, admin.batasLog).map((l) => `<li><details><summary><span>${esc(l.pertanyaan)}</span><span><span class="lencana">${esc(kanal(l.kanal))}</span><span class="lencana" ${l.galat ? 'data-nada="buruk"' : ''}>${angka(+l.latensi_total_s, 1)} dtk</span></span></summary><div class="daftar__isi"><div class="md">${md(l.jawaban)}</div><p class="rinci"><span>${esc(tgl(l.waktu))}</span><span>Pencarian <b>${angka(+l.latensi_retrieval_s, 2)} dtk</b></span><span>Jawaban <b>${angka(+l.latensi_generasi_s, 2)} dtk</b></span>${l.hasil?.[0] ? `<span>Sumber teratas <b>${esc(l.hasil[0].judul)} (${angka(l.hasil[0].kemiripan, 0)}%)</b></span>` : ''}</p></div></details></li>`).join('') || '<li class="kosong">Tidak ada kueri yang cocok.</li>';
    $('#l-lagi', w).hidden = rows.length <= admin.batasLog;
  };
  $('#l-cari', w).addEventListener('input', () => { admin.batasLog = 30; saring(); }); $('#l-kanal', w).addEventListener('change', () => { admin.batasLog = 30; saring(); });
  $('#l-lagi', w).addEventListener('click', () => { admin.batasLog += 30; saring(); }); saring();
}
function unduhLog(log) {
  const kol = ['waktu', 'kanal', 'pertanyaan', 'jawaban', 'latensi_total_s', 'latensi_retrieval_s', 'latensi_generasi_s', 'galat'];
  // Awalan apostrof mencegah isi chat dijalankan sebagai rumus oleh aplikasi lembar kerja.
  const sel = (v) => { const t = String(v ?? ''); return `"${(typeof v === 'string' && /^[=+\-@\t\r]/.test(t) ? "'" + t : t).replace(/"/g, '""')}"`; };
  const blob = new Blob(['\ufeff' + [kol.join(','), ...log.map((l) => kol.map((k) => sel(l[k])).join(','))].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'log_kueri.csv' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Halaman: Akun ---------- */
function halAkun(d, w) {
  w.innerHTML = `<div class="kisi kisi--2"><section class="panel"><h2>Akun</h2><p><strong>${esc(admin.sesi.user.email)}</strong></p><div class="lembar__aksi" style="justify-content:flex-start"><a class="tombol tombol--garis" href="#/">${ikon('chat')}Buka chat</a><button class="tombol tombol--garis" type="button" id="a-keluar">${ikon('keluar')}Keluar</button></div></section>
    <section class="panel"><h2>Ganti kata sandi</h2><form class="kisi" id="a-form"><input type="text" name="username" autocomplete="username" value="${esc(admin.sesi.user.email)}" hidden><div class="isian"><label for="new-password">Kata sandi baru</label><input type="password" id="new-password" name="sandi" autocomplete="new-password" minlength="10" required></div><p class="pesan-form" role="alert"></p><button class="tombol tombol--utama" type="submit" style="justify-self:start">Simpan kata sandi</button></form></section></div>
    <section class="panel"><h2>Webhook WhatsApp (Fonnte)</h2><p><code style="overflow-wrap:anywhere">${esc(SUPABASE_URL)}/functions/v1/wa?kunci=KUNCI</code></p><p class="jumlah">Ganti KUNCI dengan nilai secret WA_WEBHOOK_KUNCI.</p><button class="tombol tombol--garis tombol--kecil" type="button" id="a-salin">${ikon('salin')}Salin alamat</button></section>`;
  $('#a-keluar', w).addEventListener('click', keluar);
  $('#a-salin', w).addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${SUPABASE_URL}/functions/v1/wa?kunci=KUNCI`); roti('Alamat disalin'); } catch { roti('Tidak dapat menyalin'); } });
  const f = $('#a-form', w), pesan = $('.pesan-form', f);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); pesan.textContent = ''; pesan.removeAttribute('data-ok');
    const { error } = await (await sb()).auth.updateUser({ password: f.sandi.value });
    if (error) pesan.textContent = 'Kata sandi gagal diganti. Gunakan minimal 10 karakter yang berbeda dari sebelumnya.';
    else { pesan.dataset.ok = ''; pesan.textContent = 'Kata sandi diganti.'; f.reset(); }
  });
}

/* ---------- Rute ---------- */
const HALAMAN = { ringkasan: ['Ringkasan', halRingkasan], dokumen: ['Dokumen', halDokumen], evaluasi: ['Evaluasi VDU', halEvaluasi], uji: ['Uji 50 kueri', halUji], log: ['Log kueri', halLog], akun: ['Akun', halAkun] };
let halamanAktif = 'ringkasan';
async function gambarAdmin(nama, paksa = false) {
  halamanAktif = nama; const [judul, fn] = HALAMAN[nama];
  const w = $('#halaman-admin'), aksi = $('#aksi-admin');
  $('#judul-admin').textContent = judul; document.title = `${judul} · Cbot Upeks`;
  $$('[data-menu]').forEach((a) => (a.dataset.menu === nama ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  aksi.replaceChildren();
  if (!admin.data || paksa) w.innerHTML = '<div class="kisi kisi--4"><div class="kerangka"></div><div class="kerangka"></div><div class="kerangka"></div><div class="kerangka"></div></div><div class="kerangka" style="min-height:16rem;margin-top:1rem"></div>';
  try {
    const d = await muatData(paksa);
    if (halamanAktif !== nama) return;
    w.replaceChildren(); aksi.replaceChildren(); fn(d, w, aksi);
  } catch (e) {
    w.innerHTML = `<div class="kosong"><p>${esc(e.message)}</p><button class="tombol tombol--garis" type="button">Coba lagi</button></div>`;
    $('button', w).addEventListener('click', () => gambarAdmin(nama, true));
  }
}
const segarkan = () => gambarAdmin(halamanAktif, true);

async function rute(awal = false) {
  const jalur = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let tampilan = 'chat', hal = null;
  if (jalur[0] === 'masuk') tampilan = (await sesiAdmin()) ? (location.replace('#/admin'), null) : 'masuk';
  else if (jalur[0] === 'admin') {
    if (!(await sesiAdmin())) { location.replace('#/masuk'); return; }
    tampilan = 'admin'; hal = HALAMAN[jalur[1]] ? jalur[1] : 'ringkasan';
  }
  if (!tampilan) return;
  const ubah = () => {
    $$('[data-tampilan]').forEach((n) => (n.hidden = n.dataset.tampilan !== tampilan));
    app.dataset.rute = tampilan;
    if (tampilan === 'chat') document.title = 'Cbot Upeks'; else if (tampilan === 'masuk') document.title = 'Masuk · Cbot Upeks';
    if (hal) gambarAdmin(hal);
    window.scrollTo(0, 0);
  };
  const fokus = () => (tampilan === 'chat' ? $('#masukan') : tampilan === 'masuk' ? $('#email') : $('#judul-admin'));
  if (awal) { ubah(); if (tampilan !== 'admin') fokus().focus({ preventScroll: true }); } else transisi(ubah, fokus);
}

siapkanChat(); siapkanMasuk();
$('#tombol-keluar').addEventListener('click', keluar);
window.addEventListener('hashchange', () => { if (dlg.open) dlg.close(); rute(); });
rute(true);
