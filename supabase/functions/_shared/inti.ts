import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const MODEL_EMBED = "text-embedding-3-small";
export const MODEL_CHAT = "gpt-4o-mini";
export const TOP_K = 6;
const MAKS_KARAKTER_CHUNK = 900;
const MIN_KARAKTER_CHUNK = 200;

const ASAL_DIIZINKAN = (Deno.env.get("ASAL_DIIZINKAN") ?? "https://higieka.web.id")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function cors(req: Request): Record<string, string> {
  const asal = req.headers.get("origin") ?? "";
  const lokal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(asal);
  return {
    "Access-Control-Allow-Origin": ASAL_DIIZINKAN.includes(asal) || lokal ? asal : ASAL_DIIZINKAN[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}

export const json = (req: Request, data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

export const layanan = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

export const SYSTEM_PROMPT = `Kamu adalah "Cbot Upeks", chatbot layanan informasi periklanan dan sirkulasi PT Ujungpandang Ekspres Harian Bisnis. Kamu menjawab pertanyaan seputar tarif iklan, syarat administrasi pemasangan iklan, tarif berlangganan maupun penjualan eceran koran (sirkulasi), serta profil perusahaan.

    ATURAN GAYA JAWABAN:
1. Langsung ke inti. Kalimat pertama sudah berisi jawabannya.
2. DILARANG memakai sapaan atau basa-basi pembuka ("Halo", "Terima kasih sudah menghubungi", "Senang bisa membantu") dan DILARANG memakai kalimat penutup berisi tawaran bantuan ("jangan ragu bertanya", "ada lagi yang bisa dibantu").
3. Ringkas: 1 sampai 3 kalimat. Pakai daftar butir hanya jika ada tiga hal atau lebih (misalnya beberapa tarif atau syarat). Tulis angka dan satuan persis seperti di dokumen.
4. Jangan mengulang pertanyaan pengguna dan jangan menambahkan informasi yang tidak ditanyakan. Tanpa emoji.
5. Jika pesan pengguna hanya ucapan terima kasih atau pamit, balas dengan satu kalimat pendek saja (misalnya "Sama-sama.").
6. Hanya jika pesan pengguna berupa sapaan saja atau menanyakan apa yang bisa kamu bantu, jawab dengan satu kalimat perkenalan dan satu kalimat berisi topik yang bisa ditanyakan.
7. Sesuaikan bahasa dan tingkat keformalan dengan pengguna (Indonesia santai, formal, Inggris, Makassar, Bugis). Pahami salah ketik tanpa mengomentarinya.
8. Tulis teks polos tanpa format Markdown selain tanda "-" untuk daftar butir.

    ATURAN DATA & LOGIKA (ANTI-HALUSINASI):
1. Jawab HANYA berdasarkan 'Konteks Dokumen' yang dilampirkan.
2. Kamu DIIZINKAN memahami sinonim (misal: Pemimpin = Direktur, jurnalis = wartawan, langganan = berlangganan/sirkulasi) agar jawaban lebih tepat.
3. DILARANG KERAS mengarang fakta, harga, atau aturan yang tidak ada di dokumen.
4. Jika informasi tidak ada di konteks, katakan dalam satu kalimat bahwa Cbot Upeks belum memiliki informasi itu, tanpa menyebut kata "konteks" atau "dokumen". Jangan mengisinya dengan pengetahuan umum atau definisi dari luar konteks.
5. Jika sesuatu disebut di konteks tetapi nilainya masih kosong (misalnya tarif "Rp 00.000"), sebutkan apa yang memang tertulis (misalnya bahwa itu salah satu kategori iklan) dan katakan bahwa nilainya belum tersedia.`;

export const PROMPT_VDU = `
        Anda adalah sistem Visual Document Understanding (VDU) yang bertugas mengekstrak informasi dari dokumen layanan informasi periklanan, daftar tarif iklan (rate card), syarat administrasi pemasangan, dan tarif sirkulasi/berlangganan media cetak.
        Tugas Anda:
1. Ekstrak seluruh teks dan angka dari gambar ini dengan presisi absolut.
2. Pertahankan kesadaran tata letak (layout-awareness). Jika data berupa tabel atau matriks harga, Anda WAJIB memformatnya menggunakan tabel Markdown agar kolom dan baris tidak rusak atau bergeser.
3. Terapkan zero-hallucination: Jangan mengarang angka atau teks yang tidak ada di dalam gambar.
        `;

export const PESAN_BASIS_KOSONG =
  "Maaf, data tidak ditemukan di dalam dokumen gambar maupun PDF. Basis pengetahuan masih kosong; hubungi admin untuk menambahkan dokumen.";

export async function openai(path: string, body: unknown): Promise<Response> {
  const r = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const teks = await r.text();
    console.error("OpenAI", r.status, teks.slice(0, 300));
    throw new Error(`Layanan OpenAI mengembalikan galat ${r.status}.`);
  }
  return r;
}

export async function embed(input: string[]): Promise<number[][]> {
  const keluar: number[][] = [];
  for (let i = 0; i < input.length; i += 96) {
    const j = await (await openai("embeddings", { model: MODEL_EMBED, input: input.slice(i, i + 96) })).json();
    keluar.push(...j.data.sort((a: { index: number }, b: { index: number }) => a.index - b.index).map((d: { embedding: number[] }) => d.embedding));
  }
  return keluar;
}

export interface Hit {
  peringkat: number; doc_id: string; judul: string; tipe: string; halaman: number | null;
  teks: string; jarak: number; kemiripan: number;
}

export async function cari(db: SupabaseClient, pertanyaan: string): Promise<Hit[]> {
  const [vektor] = await embed([pertanyaan]);
  const { data, error } = await db.rpc("cari_potongan", { kueri: JSON.stringify(vektor), jumlah: TOP_K });
  if (error) throw new Error("Pencarian di basis data gagal.");
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((r: any, i: number) => ({
    peringkat: i + 1, doc_id: r.doc_id, judul: r.judul, tipe: r.tipe, halaman: r.halaman, teks: r.teks,
    jarak: Math.round(r.jarak * 1e4) / 1e4, kemiripan: Math.round(Math.max(0, 1 - r.jarak) * 1e4) / 100,
  }));
}

export const pesanChat = (pertanyaan: string, hits: Hit[]) => [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: `Konteks Dokumen:\n${hits.map((h) => h.teks).join("\n\n")}\n\nPertanyaan: ${pertanyaan}` },
];

export async function catatLog(db: SupabaseClient, e: {
  kanal: string; pertanyaan: string; jawaban: string; total: number; retrieval: number; generasi: number; galat: boolean; hits: Hit[];
}) {
  const { error } = await db.from("log_kueri").insert({
    kanal: e.kanal, pertanyaan: e.pertanyaan, jawaban: e.jawaban.slice(0, 2000),
    latensi_total_s: +e.total.toFixed(3), latensi_retrieval_s: +e.retrieval.toFixed(3), latensi_generasi_s: +e.generasi.toFixed(3),
    galat: e.galat,
    hasil: e.hits.map(({ peringkat, doc_id, judul, tipe, kemiripan, jarak }) => ({ peringkat, doc_id, judul, tipe, kemiripan, jarak })),
  });
  if (error) console.error("log", error.message);
}

/** Jawaban utuh tanpa streaming, dipakai kanal WhatsApp. */
export async function jawab(db: SupabaseClient, pertanyaan: string, kanal: string): Promise<string> {
  const t0 = performance.now();
  let hits: Hit[] = [], jawaban = "", galat = false, tRet = 0, tGen = 0;
  try {
    hits = await cari(db, pertanyaan);
    tRet = (performance.now() - t0) / 1000;
    if (!hits.length) jawaban = PESAN_BASIS_KOSONG;
    else {
      const t1 = performance.now();
      const j = await (await openai("chat/completions", { model: MODEL_CHAT, temperature: 0.3, messages: pesanChat(pertanyaan, hits) })).json();
      jawaban = j.choices?.[0]?.message?.content ?? "";
      tGen = (performance.now() - t1) / 1000;
    }
  } catch (e) {
    galat = true;
    jawaban = `Maaf, terjadi gangguan: ${(e as Error).message}`;
  }
  await catatLog(db, { kanal, pertanyaan, jawaban, total: (performance.now() - t0) / 1000, retrieval: tRet, generasi: tGen, galat, hits });
  return jawaban;
}

/* Pemecah teks, sama dengan rag_engine.pecah_teks */
const barisTabel = (b: string) => { const s = b.trim(); return s.startsWith("|") && (s.match(/\|/g) || []).length >= 2; };
const pemisahTabel = (b: string) => { const s = b.trim(); return !!s && s.includes("-") && [...s].every((c) => "|-: ".includes(c)); };
const panjang = (a: string[]) => a.reduce((n, b) => n + b.length + 1, 0);
function potongBarisPanjang(baris: string, maks: number) {
  const hasil: string[] = []; let kini = "";
  for (const k of baris.split(/(?<=[.!?;])\s+/)) {
    if (kini && kini.length + 1 + k.length > maks) { hasil.push(kini); kini = k; } else kini = (kini + " " + k).trim();
  }
  if (kini) hasil.push(kini);
  return hasil;
}
function pecahTabel(blok: string[], konteks = "") {
  let header: string | null = null, pemisah: string | null = null, data = blok;
  if (blok.length >= 2 && pemisahTabel(blok[1])) { [header, pemisah] = blok; data = blok.slice(2); }
  else if (blok.length && pemisahTabel(blok[0])) data = blok.slice(1);
  const awalan = konteks.trim() ? konteks.trim() + "\n" : "";
  const hasil: string[] = [];
  for (const b of data) {
    if (pemisahTabel(b)) continue;
    const sel = b.trim().replace(/^\||\|$/g, "").split("|").map((s) => s.trim());
    if (!sel.some(Boolean)) continue;
    hasil.push(header ? `${awalan}${header}\n${pemisah}\n${b}` : `${awalan}${b}`);
  }
  if (!hasil.length && header) hasil.push(`${awalan}${header}`);
  return hasil;
}
export function pecahTeks(teks: string, maks = MAKS_KARAKTER_CHUNK, min = MIN_KARAKTER_CHUNK): string[] {
  const baris = String(teks).split(/\r?\n/).map((b) => b.replace(/\s+$/, ""));
  const hasil: string[] = []; let buffer: string[] = [];
  const siram = () => { const isi = buffer.join("\n").trim(); if (isi) hasil.push(isi); buffer = []; };
  let i = 0;
  while (i < baris.length) {
    const b = baris[i];
    if (barisTabel(b)) {
      let konteks = "";
      if (buffer.length && panjang(buffer) <= min) { konteks = buffer.join("\n"); buffer = []; } else siram();
      const blok: string[] = [];
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

const kataUnik = (t: string) => new Set(String(t).toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []);
export function hitungF1(pred: string, gt: string): number {
  const p = kataUnik(pred), g = kataUnik(gt);
  if (!p.size || !g.size) return 0;
  let tp = 0; for (const w of p) if (g.has(w)) tp++;
  if (!tp) return 0;
  const pr = tp / p.size, rc = tp / g.size;
  return Math.round((2 * pr * rc / (pr + rc)) * 10000) / 100;
}

/** Pembatas laju sederhana per alamat IP (per instans fungsi). */
const jendela = new Map<string, number[]>();
export function terlaluSering(req: Request, maks = 12, detik = 60): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "?").split(",")[0].trim();
  const kini = Date.now();
  const daftar = (jendela.get(ip) ?? []).filter((t) => kini - t < detik * 1000);
  daftar.push(kini); jendela.set(ip, daftar);
  if (jendela.size > 5000) jendela.clear();
  return daftar.length > maks;
}
