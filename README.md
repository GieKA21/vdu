# Cbot Upeks

Sistem chatbot *question answering* berbasis Retrieval-Augmented Generation (RAG) dan
Visual Document Understanding (VDU) untuk layanan informasi periklanan dan sirkulasi
PT Ujungpandang Ekspres Harian Bisnis. Versi web statis ini tayang di
<https://higieka.web.id/vdu/>.

## Isi repositori

| Lokasi | Keterangan |
| --- | --- |
| `index.html`, `assets/` | Aplikasi web statis (HTML, CSS, dan JavaScript tanpa tahap build) |
| `data/korpus.json` | 44 potongan teks beserta vektor `text-embedding-3-small` yang diekspor dari koleksi ChromaDB `upeks_sop_v2` |
| `data/dokumen.json` | Registri dokumen, hasil ekstraksi VDU, dan ground truth |
| `data/log.json` | Log kueri dari aplikasi Streamlit dan bot WhatsApp |
| `data/evaluasi-50-kueri.json` | Hasil uji 50 kueri (`hasil_evaluasi_50_kueri.csv`) |
| `dokumen/` | Poster (PNG asli dan JPG terkompresi) serta PDF regulasi |
| `sumber/` | Kode asli aplikasi Streamlit, bot WhatsApp, dan skrip evaluasi |

## Cara kerja versi web

- Tanpa kunci API, pertanyaan dicocokkan dengan pencarian kata kunci BM25 dan Cbot
  menampilkan potongan dokumen yang paling sesuai.
- Dengan kunci OpenAI milik pengunjung, pertanyaan diubah menjadi embedding
  `text-embedding-3-small`, dicari dengan *cosine similarity* terhadap enam potongan
  teratas, lalu dijawab oleh `gpt-4o-mini` dengan *system prompt* yang sama seperti
  `sumber/rag_engine.py`. Kunci hanya disimpan di memori halaman, atau di
  `sessionStorage` bila pengunjung memilih untuk mengingatnya selama tab terbuka.
- Dokumen baru dapat ditambahkan dari menu Dokumen. Poster diekstrak dengan
  GPT-4o-mini Vision, PDF dibaca dengan pdf.js, lalu dipecah dengan aturan yang sama
  seperti `pecah_teks` dan disimpan di IndexedDB peramban pengunjung.
- Log kueri dari peramban disimpan di `localStorage` dan tidak dikirim ke peladen.

## Menjalankan aplikasi Streamlit dan bot WhatsApp

GitHub Pages hanya menyajikan berkas statis, sehingga Panel Admin Streamlit dan bot
WhatsApp tetap dijalankan dari komputer sendiri:

```sh
cd sumber
python -m venv env && env\Scripts\activate   # Windows
pip install streamlit pandas python-dotenv openai langchain-openai langchain-community chromadb pypdf flask requests
streamlit run app.py          # chatbot web dan Panel Admin
python app_wa.py              # webhook Fonnte, buka ke internet dengan ngrok http 5000
```

Buat berkas `sumber/.env` berisi `OPENAI_API_KEY`, `FONNTE_TOKEN`, `ADMIN_USERNAME`, dan
`ADMIN_PASSWORD_HASH` (dibuat dengan `python buat_hash_password.py`). Berkas `.env`
tidak disimpan di repositori.

## Menjalankan versi web secara lokal

```sh
python3 -m http.server 8000
```

Lalu buka <http://localhost:8000/>.
