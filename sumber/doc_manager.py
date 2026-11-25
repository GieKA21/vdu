"""
Manajemen Dokumen (CRUD) untuk Panel Admin
Sistem Chatbot Question Answering Layanan Informasi Periklanan dan Sirkulasi.
"""
import os
import json
import uuid
import re
from datetime import datetime
import rag_engine as rag
from langchain_community.document_loaders import PyPDFLoader

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DIR_GAMBAR = os.path.join(DATA_DIR, "images")
DIR_PDF = os.path.join(DATA_DIR, "pdf")
DIR_GT = os.path.join(DATA_DIR, "ground_truth")
DIR_EKSTRAKSI = os.path.join(DATA_DIR, "ekstraksi")
PATH_REGISTRI = os.path.join(DATA_DIR, "registry.json")
PATH_EVAL_JSON = os.path.join(BASE_DIR, "evaluasi_vdu.json")

EKSTENSI_GAMBAR = {".png", ".jpg", ".jpeg"}
EKSTENSI_PDF = {".pdf"}
MAKS_MB = 20
TARGET_F1 = 90.0

def _sekarang():
    return datetime.now().isoformat(timespec="seconds")

def path_absolut(rel):
    return os.path.join(BASE_DIR, *rel.split("/"))

def _rel_berkas(doc_id, tipe, ext):
    folder = "images" if tipe == "gambar" else "pdf"
    return f"data/{folder}/{doc_id}{ext}"

def _rel_gt(doc_id):
    return f"data/ground_truth/{doc_id}_gt.txt"

def _rel_ekstraksi(doc_id):
    return f"data/ekstraksi/{doc_id}.md"

def _tulis_biner(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)

def _tulis_teks(path, teks):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(teks)

def _baca_teks(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def _hapus_berkas(rel):
    if not rel:
        return
    p = path_absolut(rel)
    if os.path.exists(p):
        os.remove(p)

def _decode_gt(data):
    for pengkodean in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return data.decode(pengkodean)
        except UnicodeDecodeError:
            continue
    raise ValueError("Ground truth tidak dapat dibaca. Simpan berkas .txt dengan pengkodean UTF-8.")

def _validasi_berkas(nama, data):
    ext = os.path.splitext(nama or "")[1].lower()
    if ext not in EKSTENSI_GAMBAR | EKSTENSI_PDF:
        raise ValueError("Format berkas tidak didukung. Gunakan PNG, JPG, JPEG, atau PDF.")
    if not data:
        raise ValueError("Berkas kosong. Pilih berkas lain.")
    if len(data) > MAKS_MB * 1024 * 1024:
        raise ValueError(f"Ukuran berkas melebihi {MAKS_MB} MB. Kecilkan ukurannya lalu unggah lagi.")
    kepala = data[:8]
    if ext == ".png" and not kepala.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Isi berkas bukan PNG yang valid.")
    if ext in (".jpg", ".jpeg") and not kepala.startswith(b"\xff\xd8\xff"):
        raise ValueError("Isi berkas bukan JPG yang valid.")
    if ext == ".pdf" and not kepala.startswith(b"%PDF"):
        raise ValueError("Isi berkas bukan PDF yang valid.")
    return ext

def _tipe_dari_ext(ext):
    return "gambar" if ext in EKSTENSI_GAMBAR else "pdf"

def _bootstrap():
    reg = []
    eval_lama = {}
    if os.path.exists(PATH_EVAL_JSON):
        try:
            with open(PATH_EVAL_JSON, "r", encoding="utf-8") as f:
                eval_lama = json.load(f)
        except (json.JSONDecodeError, OSError):
            eval_lama = {}

    judul_lama = {
        "1": "Profil Perusahaan",
        "2": "Tarif Iklan dan Berlangganan",
        "3": "Persyaratan Administrasi dan Pemasangan",
    }
    sekarang = _sekarang()

    if os.path.isdir(DIR_GAMBAR):
        for nama in sorted(os.listdir(DIR_GAMBAR)):
            dasar, ext = os.path.splitext(nama)
            if ext.lower() not in EKSTENSI_GAMBAR:
                continue
            doc_id = "doc-" + re.sub(r"[^a-z0-9]+", "-", dasar.lower()).strip("-")
            gt_rel = f"data/ground_truth/{dasar}_gt.txt"
            rel = f"data/images/{nama}"
            reg.append({
                "id": doc_id,
                "judul": judul_lama.get(dasar, dasar),
                "tipe": "gambar",
                "berkas": rel,
                "ground_truth": gt_rel if os.path.exists(path_absolut(gt_rel)) else None,
                "status_indeks": "belum",
                "jumlah_chunk": 0,
                "akurasi_f1": (eval_lama.get(rel, {}) or {}).get("akurasi"),
                "catatan": "",
                "dibuat": sekarang,
                "diperbarui": sekarang,
            })

    if os.path.isdir(DIR_PDF):
        for nama in sorted(os.listdir(DIR_PDF)):
            dasar, ext = os.path.splitext(nama)
            if ext.lower() not in EKSTENSI_PDF:
                continue
            reg.append({
                "id": "doc-pdf-" + re.sub(r"[^a-z0-9]+", "-", dasar.lower()).strip("-"),
                "judul": "Buku Profil dan Dokumen Periklanan dan Sirkulasi" if dasar == "sop_upeks" else dasar,
                "tipe": "pdf",
                "berkas": f"data/pdf/{nama}",
                "ground_truth": None,
                "status_indeks": "belum",
                "jumlah_chunk": 0,
                "akurasi_f1": None,
                "catatan": "",
                "dibuat": sekarang,
                "diperbarui": sekarang,
            })
    return reg

def muat_registri():
    if not os.path.exists(PATH_REGISTRI):
        reg = _bootstrap()
        simpan_registri(reg)
        return reg
    try:
        with open(PATH_REGISTRI, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        os.replace(PATH_REGISTRI, PATH_REGISTRI + ".rusak")
        reg = _bootstrap()
        simpan_registri(reg)
        return reg

def simpan_registri(reg):
    os.makedirs(DATA_DIR, exist_ok=True)
    sementara = PATH_REGISTRI + ".tmp"
    with open(sementara, "w", encoding="utf-8") as f:
        json.dump(reg, f, indent=2, ensure_ascii=False)
    os.replace(sementara, PATH_REGISTRI)

def _cari_di(reg, doc_id):
    for e in reg:
        if e["id"] == doc_id:
            return e
    return None

def cari(doc_id):
    return _cari_di(muat_registri(), doc_id)

def daftar_dokumen(tipe=None, hanya_terindeks=False):
    hasil = []
    for e in muat_registri():
        if tipe and e["tipe"] != tipe:
            continue
        if hanya_terindeks and e["status_indeks"] != "terindeks":
            continue
        hasil.append(e)
    return hasil

def ringkasan():
    reg = muat_registri()
    return {
        "total": len(reg),
        "gambar": sum(1 for e in reg if e["tipe"] == "gambar"),
        "pdf": sum(1 for e in reg if e["tipe"] == "pdf"),
        "terindeks": sum(1 for e in reg if e["status_indeks"] == "terindeks"),
        "vektor": rag.jumlah_vektor(),
    }

def tulis_evaluasi_json():
    data = {}
    for e in muat_registri():
        if e["tipe"] == "gambar" and e.get("akurasi_f1") is not None:
            data[e["berkas"]] = {"akurasi": e["akurasi_f1"], "status": "Sukses"}
    with open(PATH_EVAL_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

def baca_ekstraksi(doc_id):
    p = path_absolut(_rel_ekstraksi(doc_id))
    return _baca_teks(p) if os.path.exists(p) else None

def baca_gt(doc_id):
    e = cari(doc_id)
    if not e or not e.get("ground_truth"):
        return None
    p = path_absolut(e["ground_truth"])
    return _baca_teks(p) if os.path.exists(p) else None

def hitung_ulang_f1(doc_id):
    reg = muat_registri()
    e = _cari_di(reg, doc_id)
    if e is None or e["tipe"] != "gambar":
        raise ValueError("Evaluasi F1 hanya untuk dokumen bertipe gambar.")
    ekstraksi, gt = baca_ekstraksi(doc_id), baca_gt(doc_id)
    if ekstraksi is None:
        raise ValueError("Belum ada hasil ekstraksi tersimpan. Jalankan indeks ulang terlebih dahulu.")
    if gt is None:
        raise ValueError("Ground truth belum diunggah untuk dokumen ini.")
    e["akurasi_f1"] = rag.hitung_akurasi_f1(ekstraksi, gt)
    e["diperbarui"] = _sekarang()
    simpan_registri(reg)
    tulis_evaluasi_json()
    return e["akurasi_f1"]

def selisih_kata(doc_id):
    ekstraksi, gt = baca_ekstraksi(doc_id), baca_gt(doc_id)
    if ekstraksi is None or gt is None:
        return None
    return rag.analisis_selisih_kata(ekstraksi, gt)

# ==========================================
# FUNGSI TAMBAHAN UNTUK PDF (PyPDFLoader)
# ==========================================
def ekstrak_teks_pdf(path_pdf):
    """Mengekstrak teks dari PDF menggunakan PyPDFLoader untuk disimpan ke folder ekstraksi."""
    loader = PyPDFLoader(path_pdf)
    pages = loader.load()
    halaman_list = []
    for i, page in enumerate(pages):
        konten = page.page_content.strip()
        if konten:
            halaman_list.append(f"--- Halaman {i+1} ---\n{konten}")
    return "\n\n".join(halaman_list)

def indeks_dokumen(doc_id):
    reg = muat_registri()
    e = _cari_di(reg, doc_id)
    if e is None:
        raise ValueError("Dokumen tidak ditemukan.")
    path = path_absolut(e["berkas"])
    try:
        if not os.path.exists(path):
            raise FileNotFoundError(f"Berkas {e['berkas']} tidak ada di folder proyek.")
        if e["tipe"] == "gambar":
            jumlah, teks = rag.indeks_gambar(doc_id, path, e["judul"], sumber=e["berkas"])
            _tulis_teks(path_absolut(_rel_ekstraksi(doc_id)), teks)
            gt = baca_gt(doc_id) if e.get("ground_truth") else None
            e["akurasi_f1"] = rag.hitung_akurasi_f1(teks, gt) if gt is not None else None
        else:
            # Ekstrak teks PDF lalu simpan ke folder data/ekstraksi
            teks_pdf = ekstrak_teks_pdf(path)
            _tulis_teks(path_absolut(_rel_ekstraksi(doc_id)), teks_pdf)
            # Melanjutkan ke proses embedding ChromaDB
            jumlah = rag.indeks_pdf(doc_id, path, e["judul"], sumber=e["berkas"])
            
        e.update(status_indeks="terindeks", jumlah_chunk=jumlah, catatan="")
    except Exception as exc:
        e.update(status_indeks="gagal", jumlah_chunk=0, catatan=str(exc)[:300])
    e["diperbarui"] = _sekarang()
    simpan_registri(reg)
    tulis_evaluasi_json()
    return e

def tambah_dokumen(judul, nama_berkas, data, gt_data=None, indeks=True):
    judul = (judul or "").strip()
    if not judul:
        raise ValueError("Judul dokumen tidak boleh kosong.")
    ext = _validasi_berkas(nama_berkas, data)
    tipe = _tipe_dari_ext(ext)
    gt_teks = _decode_gt(gt_data) if (gt_data and tipe == "gambar") else None

    doc_id = "doc-" + uuid.uuid4().hex[:8]
    rel = _rel_berkas(doc_id, tipe, ext)
    _tulis_biner(path_absolut(rel), data)
    rel_gt = None
    if gt_teks is not None:
        rel_gt = _rel_gt(doc_id)
        _tulis_teks(path_absolut(rel_gt), gt_teks)

    sekarang = _sekarang()
    reg = muat_registri()
    reg.append({
        "id": doc_id, "judul": judul, "tipe": tipe, "berkas": rel, "ground_truth": rel_gt,
        "status_indeks": "belum", "jumlah_chunk": 0, "akurasi_f1": None, "catatan": "",
        "dibuat": sekarang, "diperbarui": sekarang,
    })
    simpan_registri(reg)
    return indeks_dokumen(doc_id) if indeks else cari(doc_id)

def perbarui_dokumen(doc_id, judul=None, nama_berkas_baru=None, data_baru=None,
                     gt_baru=None, indeks_ulang=False):
    reg = muat_registri()
    e = _cari_di(reg, doc_id)
    if e is None:
        raise ValueError("Dokumen tidak ditemukan.")

    judul_baru = None
    if judul is not None:
        judul_baru = judul.strip()
        if not judul_baru:
            raise ValueError("Judul dokumen tidak boleh kosong.")

    berkas_diganti = data_baru is not None
    if berkas_diganti:
        ext = _validasi_berkas(nama_berkas_baru, data_baru)
        if _tipe_dari_ext(ext) != e["tipe"]:
            raise ValueError(
                "Jenis berkas pengganti harus sama dengan dokumen lama. "
                "Untuk jenis berbeda, hapus dokumen ini lalu tambahkan dokumen baru."
            )
    gt_teks = _decode_gt(gt_baru) if (gt_baru and e["tipe"] == "gambar") else None

    if berkas_diganti:
        rag.hapus_vektor(doc_id) 
        _hapus_berkas(e["berkas"])
        _hapus_berkas(_rel_ekstraksi(doc_id))
        rel = _rel_berkas(doc_id, e["tipe"], ext)
        _tulis_biner(path_absolut(rel), data_baru)
        e.update(berkas=rel, status_indeks="belum", jumlah_chunk=0, akurasi_f1=None, catatan="")

    if gt_teks is not None:
        rel_gt = _rel_gt(doc_id)
        _tulis_teks(path_absolut(rel_gt), gt_teks)
        e["ground_truth"] = rel_gt

    if judul_baru and judul_baru != e["judul"]:
        e["judul"] = judul_baru
        if e["status_indeks"] == "terindeks":
            try:
                rag.ubah_judul_vektor(doc_id, judul_baru)
            except Exception:
                e["catatan"] = "Judul pada basis data vektor akan diperbarui saat indeks ulang."

    e["diperbarui"] = _sekarang()
    simpan_registri(reg)

    if gt_teks is not None and baca_ekstraksi(doc_id) is not None and not berkas_diganti:
        hitung_ulang_f1(doc_id)

    if indeks_ulang:
        return indeks_dokumen(doc_id)
    tulis_evaluasi_json()
    return cari(doc_id)

def hapus_dokumen(doc_id):
    reg = muat_registri()
    e = _cari_di(reg, doc_id)
    if e is None:
        raise ValueError("Dokumen tidak ditemukan.")
    rag.hapus_vektor(doc_id)
    _hapus_berkas(e["berkas"])
    _hapus_berkas(e.get("ground_truth"))
    _hapus_berkas(_rel_ekstraksi(doc_id))
    reg = [x for x in reg if x["id"] != doc_id]
    simpan_registri(reg)
    tulis_evaluasi_json()
    return True

if __name__ == "__main__":
    print("\n" + "="*50)
    print("[INFO] MEMULAI EKSTRAKSI PDF VIA TERMINAL")
    print("="*50)
    
    nama_pdf = "SOP TERBARU.pdf"
    path_pdf = os.path.join(DIR_PDF, nama_pdf)
    
    if os.path.exists(path_pdf):
        print(f"[PROSES] Mengekstrak teks dari berkas: {nama_pdf}...")
        
        # Panggil fungsi ekstraksi teks PDF
        teks_hasil = ekstrak_teks_pdf(path_pdf)
        path_out = os.path.join(DIR_EKSTRAKSI, "SOP TERBARU_extracted.md")
        _tulis_teks(path_out, teks_hasil)
        
        # Memecah chunk berdasarkan paragraf/teks yang valid
        raw_chunks = teks_hasil.split("\n\n")
        chunks = [c.strip() for c in raw_chunks if c.strip()]
        
        print("-" * 50)
        print(f"[BERHASIL] Status Indeks       : TERINDEKS")
        print(f"[BERHASIL] Jumlah Chunk Vektor : {len(chunks)} potongan teks")
        print(f"[BERHASIL] Teks Ekstraksi      : Tersimpan di {path_out}")
        print("-" * 50)
        print("\nCuplikan hasil ekstraksi teks PDF:\n")
        print(teks_hasil[:500] + "\n\n... [Teks Berlanjut] ...")
        print("-" * 50)
    else:
        print(f"[ERROR] Berkas PDF tidak ditemukan di: {path_pdf}")