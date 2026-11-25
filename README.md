# Cbot Upeks

Chatbot tanya jawab berbasis Retrieval-Augmented Generation (RAG) dan Visual Document
Understanding (VDU) untuk layanan informasi periklanan dan sirkulasi PT Ujungpandang
Ekspres Harian Bisnis. Tampilannya tayang di <https://higieka.web.id/vdu/>, sedangkan
data, login admin, dan pemrosesan berjalan di Supabase.

## Isi repositori

| Lokasi | Keterangan |
| --- | --- |
| `web/` | Tampilan statis (HTML, CSS, JavaScript tanpa tahap build). Disalin ke folder `vdu/` pada repositori `GieKA21/higieka` |
| `supabase/migrations/` | Skema basis data: tabel, pgvector, RLS, bucket penyimpanan |
| `supabase/functions/tanya` | Chat publik: embedding, pencarian cosine, jawaban GPT-4o-mini (streaming), pencatatan log |
| `supabase/functions/indeks` | Pengindeksan dokumen oleh admin (VDU untuk poster, teks halaman untuk PDF) |
| `supabase/functions/wa` | Webhook Fonnte untuk bot WhatsApp, pengganti `app_wa.py` dan ngrok |
| `skrip/isi_awal.py` | Mengisi Supabase dengan data awal dari `data/` dan `dokumen/` |
| `data/`, `dokumen/` | Korpus, vektor, log, hasil uji 50 kueri, poster, dan PDF |
| `sumber/` | Kode asli aplikasi Streamlit, bot WhatsApp, dan skrip evaluasi |

## Keamanan

- Halaman publik hanya dapat memanggil fungsi `tanya` dan membaca judul dokumen lewat
  view `dokumen_publik`. Tabel lain dilindungi RLS dan hanya terbuka untuk akun dengan
  `app_metadata.role = "admin"`.
- Kunci OpenAI dan token Fonnte disimpan sebagai secret edge function
  (`OPENAI_API_KEY`, `FONNTE_TOKEN`), tidak pernah di repositori atau peramban.
- `web/assets/konfig.js` berisi alamat proyek dan kunci anon, yang memang untuk peramban.
- Berkas `.env` tidak disimpan di repositori; gunakan `.env.example` sebagai acuan.

## Menyiapkan Supabase

```sh
supabase link --project-ref <ref>
supabase db push
supabase secrets set OPENAI_API_KEY=... FONNTE_TOKEN=... WA_WEBHOOK_KUNCI=... ASAL_DIIZINKAN=https://higieka.web.id
supabase functions deploy tanya indeks wa
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ADMIN_EMAIL=... ADMIN_PASSWORD=... python3 skrip/isi_awal.py
```

Setelah itu isi `web/assets/konfig.js`, lalu salin isi `web/` ke `vdu/` di repositori higieka.
Pada dasbor Fonnte, isi alamat webhook dengan `https://<ref>.supabase.co/functions/v1/wa?kunci=<WA_WEBHOOK_KUNCI>`. Tanpa secret `WA_WEBHOOK_KUNCI`, webhook menolak semua permintaan.

## Menjalankan tampilan secara lokal

```sh
cd web && python3 -m http.server 8000
```

## Aplikasi Streamlit lama

```sh
cd sumber
python -m venv env && env\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```
