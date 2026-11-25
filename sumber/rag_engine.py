"""
Mesin RAG (Retrieval-Augmented Generation) Cbot Upeks
Sistem Chatbot Question Answering untuk Layanan Informasi Periklanan dan Sirkulasi
PT Ujungpandang Ekspres Harian Bisnis.
"""
import os
import re
import json
import time
from datetime import datetime
from dotenv import load_dotenv

from langchain_community.vectorstores import Chroma
from langchain_community.document_loaders import PyPDFLoader
from openai import OpenAI
from langchain_openai import OpenAIEmbeddings

from vdu_extractor import extract_text_from_image

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.path.join(BASE_DIR, "vector_db")
# Nama koleksi vektor dipertahankan agar tetap terhubung dengan indeks ChromaDB yang sudah ada
COLLECTION_NAME = "upeks_sop_v2"
LOG_PATH = os.path.join(BASE_DIR, "data", "log_eksperimen.jsonl")

TOP_K = 6
MAKS_KARAKTER_CHUNK = 900
MIN_KARAKTER_CHUNK = 200

embeddings = OpenAIEmbeddings(model="text-embedding-3-small", api_key=os.getenv("OPENAI_API_KEY"))
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT = """Kamu adalah "Cbot Upeks", sistem chatbot layanan informasi periklanan dan sirkulasi yang ramah, sopan, dan interaktif dari PT Ujungpandang Ekspres Harian Bisnis. Tugasmu adalah menjawab pertanyaan seputar tarif iklan, syarat administrasi pemasangan iklan, tarif berlangganan maupun penjualan eceran koran (sirkulasi), serta informasi profil perusahaan.

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
4. Jika informasi benar-benar tidak ada di konteks, sampaikan dengan gaya bahasamu yang ramah bahwa Cbot Upeks belum memiliki informasi tersebut."""

PESAN_BASIS_KOSONG = (
    "Maaf, data tidak ditemukan di dalam dokumen gambar maupun PDF. "
    "Basis pengetahuan masih kosong; hubungi admin untuk menambahkan dokumen."
)

def _dapatkan_db():
    return Chroma(
        collection_name=COLLECTION_NAME,
        persist_directory=DB_DIR,
        embedding_function=embeddings,
        collection_metadata={"hnsw:space": "cosine"},
    )

def jumlah_vektor():
    try:
        return len(_dapatkan_db().get().get("ids", []))
    except Exception:
        return 0

def hapus_vektor(doc_id):
    db = _dapatkan_db()
    ids = db.get(where={"doc_id": doc_id}).get("ids", [])
    if ids:
        db.delete(ids=ids)
    return len(ids)

def ubah_judul_vektor(doc_id, judul):
    db = _dapatkan_db()
    data = db.get(where={"doc_id": doc_id}, include=["metadatas"])
    ids = data.get("ids", [])
    if not ids:
        return 0
    metadatas = [{**(m or {}), "judul": judul} for m in data.get("metadatas", [])]
    db._collection.update(ids=ids, metadatas=metadatas)
    return len(ids)

def _adalah_baris_tabel(baris):
    s = baris.strip()
    return s.startswith("|") and s.count("|") >= 2

def _adalah_pemisah_tabel(baris):
    s = baris.strip()
    return bool(s) and "-" in s and set(s) <= set("|-: ")

def _panjang(daftar_baris):
    return sum(len(b) + 1 for b in daftar_baris)

def _potong_baris_panjang(baris, maks):
    kalimat = re.split(r"(?<=[.!?;])\s+", baris)
    hasil, sekarang = [], ""
    for k in kalimat:
        if sekarang and len(sekarang) + 1 + len(k) > maks:
            hasil.append(sekarang)
            sekarang = k
        else:
            sekarang = (sekarang + " " + k).strip()
    if sekarang:
        hasil.append(sekarang)
    return hasil

def _pecah_tabel(blok, konteks=""):
    header = pemisah = None
    data = blok
    if len(blok) >= 2 and _adalah_pemisah_tabel(blok[1]):
        header, pemisah, data = blok[0], blok[1], blok[2:]
    elif blok and _adalah_pemisah_tabel(blok[0]):
        data = blok[1:]
    awalan = (konteks.strip() + "\n") if konteks.strip() else ""
    hasil = []
    for baris in data:
        if _adalah_pemisah_tabel(baris):
            continue
        sel = [s.strip() for s in baris.strip().strip("|").split("|")]
        if not any(sel):
            continue
        if header:
            hasil.append(f"{awalan}{header}\n{pemisah}\n{baris}")
        else:
            hasil.append(f"{awalan}{baris}")
    if not hasil and header:
        hasil.append(f"{awalan}{header}")
    return hasil

def pecah_teks(teks, maks_karakter=MAKS_KARAKTER_CHUNK, min_karakter=MIN_KARAKTER_CHUNK):
    baris = [b.rstrip() for b in str(teks).splitlines()]
    hasil, buffer = [], []
    def siram():
        nonlocal buffer
        isi = "\n".join(buffer).strip()
        if isi:
            hasil.append(isi)
        buffer = []
    i, n = 0, len(baris)
    while i < n:
        b = baris[i]
        if _adalah_baris_tabel(b):
            konteks = ""
            if buffer and _panjang(buffer) <= min_karakter:
                konteks = "\n".join(buffer)
                buffer = []
            else:
                siram()
            blok = []
            while i < n and _adalah_baris_tabel(baris[i]):
                blok.append(baris[i].strip())
                i += 1
            hasil.extend(_pecah_tabel(blok, konteks))
            continue
        if not b.strip():
            if _panjang(buffer) >= min_karakter:
                siram()
            i += 1
            continue
        potongan_baris = _potong_baris_panjang(b, maks_karakter) if len(b) > maks_karakter else [b]
        for potongan in potongan_baris:
            if buffer and _panjang(buffer) + len(potongan) > maks_karakter:
                siram()
            buffer.append(potongan)
        i += 1
    siram()
    return hasil

def _vdu_gagal(teks):
    t = (teks or "").strip()
    return (not t) or t.startswith("Error:") or t.startswith("Terjadi kesalahan")

def _simpan_chunks(doc_id, chunks, metadatas):
    hapus_vektor(doc_id)
    if not chunks:
        return 0
    ids = [f"{doc_id}::{i:03d}" for i in range(len(chunks))]
    _dapatkan_db().add_texts(texts=chunks, metadatas=metadatas, ids=ids)
    return len(chunks)

def indeks_gambar(doc_id, path_gambar, judul, sumber=None):
    teks = extract_text_from_image(path_gambar)
    if _vdu_gagal(teks):
        raise RuntimeError(teks or "Ekstraksi VDU tidak menghasilkan teks.")
    chunks = pecah_teks(teks)
    if not chunks:
        raise RuntimeError("Hasil ekstraksi VDU tidak dapat dipecah menjadi potongan teks.")
    metadatas = [
        {"doc_id": doc_id, "judul": judul, "source": sumber or path_gambar, "type": "image", "chunk": i}
        for i in range(len(chunks))
    ]
    jumlah = _simpan_chunks(doc_id, chunks, metadatas)
    return jumlah, teks

def indeks_pdf(doc_id, path_pdf, judul, sumber=None):
    halaman = PyPDFLoader(path_pdf).load()
    chunks, metadatas = [], []
    for h in halaman:
        nomor = int(h.metadata.get("page", 0)) + 1
        for potongan in pecah_teks(h.page_content):
            metadatas.append(
                {
                    "doc_id": doc_id, "judul": judul, "source": sumber or path_pdf,
                    "type": "pdf document", "halaman": nomor, "chunk": len(chunks),
                }
            )
            chunks.append(potongan)
    if not chunks:
        raise RuntimeError(
            "PDF tidak memuat teks yang dapat dibaca (kemungkinan hasil pindaian). "
            "Unggah halamannya sebagai gambar agar diproses oleh VDU."
        )
    return _simpan_chunks(doc_id, chunks, metadatas)

def hitung_akurasi_f1(teks_prediksi, teks_gt):
    pred_words = set(re.findall(r'\w+', str(teks_prediksi).lower()))
    gt_words = set(re.findall(r'\w+', str(teks_gt).lower()))
    if not pred_words or not gt_words:
        return 0.0
    tp = len(pred_words.intersection(gt_words))
    fp = len(pred_words) - tp
    fn = len(gt_words) - tp
    if tp == 0:
        return 0.0
    precision = tp / (tp + fp)
    recall = tp / (tp + fn)
    f1_score = 2 * (precision * recall) / (precision + recall)
    return round(f1_score * 100, 2)

def analisis_selisih_kata(teks_prediksi, teks_gt):
    pred = set(re.findall(r'\w+', str(teks_prediksi).lower()))
    gt = set(re.findall(r'\w+', str(teks_gt).lower()))
    return {
        "hilang": sorted(gt - pred),
        "berlebih": sorted(pred - gt),
        "cocok": len(pred & gt),
        "total_gt": len(gt),
        "total_prediksi": len(pred),
    }

def catat_log(detail):
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        entri = {
            "waktu": datetime.now().isoformat(timespec="seconds"),
            "kanal": detail.get("kanal", "web"),
            "pertanyaan": detail.get("pertanyaan", ""),
            "jawaban": str(detail.get("jawaban", ""))[:2000],
            "latensi_total_s": detail["latensi"]["total"],
            "latensi_retrieval_s": detail["latensi"]["retrieval"],
            "latensi_generasi_s": detail["latensi"]["generasi"],
            "galat": bool(detail.get("galat", False)),
            "hasil": [
                {k: h.get(k) for k in ("peringkat", "doc_id", "judul", "tipe", "kemiripan", "jarak")}
                for h in detail.get("hits", [])
            ],
        }
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entri, ensure_ascii=False) + "\n")
    except Exception:
        pass

def baca_log():
    if not os.path.exists(LOG_PATH):
        return []
    hasil = []
    with open(LOG_PATH, "r", encoding="utf-8") as f:
        for baris in f:
            baris = baris.strip()
            if not baris:
                continue
            try:
                hasil.append(json.loads(baris))
            except json.JSONDecodeError:
                continue
    return hasil

def hapus_log():
    if os.path.exists(LOG_PATH):
        os.remove(LOG_PATH)

def _ke_hit(peringkat, doc, skor):
    meta = doc.metadata or {}
    jarak = float(skor)
    kemiripan = max(0.0, 1.0 - jarak)
    return {
        "peringkat": peringkat,
        "doc_id": meta.get("doc_id"),
        "judul": meta.get("judul") or meta.get("source", "Tidak diketahui"),
        "sumber": meta.get("source", "Tidak diketahui"),
        "tipe": meta.get("type", "Tidak diketahui"),
        "jarak": round(jarak, 4),
        "kemiripan": round(kemiripan * 100, 2),
        "teks": doc.page_content,
    }

def tanya_asisten_detail(pertanyaan, kanal="web", simpan_log=True):
    pertanyaan = (pertanyaan or "").strip()
    mulai = time.perf_counter()
    galat = False
    hasil = []
    jawaban = ""
    t_generasi = 0.0

    try:
        hasil = _dapatkan_db().similarity_search_with_score(pertanyaan, k=TOP_K)
    except Exception as e:
        galat = True
        jawaban = f"Terjadi kesalahan saat mencari di basis data: {str(e)}"
    t_retrieval = time.perf_counter() - mulai

    if not galat:
        if not hasil:
            jawaban = PESAN_BASIS_KOSONG
        else:
            gabungan_konteks = "\n\n".join([doc.page_content for doc, score in hasil])
            user_prompt = f"Konteks Dokumen:\n{gabungan_konteks}\n\nPertanyaan: {pertanyaan}"
            mulai_gen = time.perf_counter()
            try:
                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.3,
                )
                jawaban = response.choices[0].message.content
            except Exception as e:
                galat = True
                jawaban = f"Terjadi kesalahan pada API OpenAI: {str(e)}"
            t_generasi = time.perf_counter() - mulai_gen

    total = time.perf_counter() - mulai
    detail = {
        "jawaban": jawaban,
        "galat": galat,
        "kanal": kanal,
        "pertanyaan": pertanyaan,
        "hasil": hasil,
        "hits": [_ke_hit(i + 1, doc, skor) for i, (doc, skor) in enumerate(hasil)],
        "latensi": {
            "total": round(total, 3),
            "retrieval": round(t_retrieval, 3),
            "generasi": round(t_generasi, 3),
        },
    }
    if simpan_log:
        catat_log(detail)
    return detail

def tanya_asisten(pertanyaan, kanal="web"):
    detail = tanya_asisten_detail(pertanyaan, kanal=kanal)
    return detail["jawaban"], detail["hasil"]