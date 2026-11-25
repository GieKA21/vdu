"""Mengisi proyek Supabase dengan data awal Cbot Upeks.

Variabel lingkungan: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, dan (opsional untuk
membuat akun admin) ADMIN_EMAIL serta ADMIN_PASSWORD. Aman dijalankan ulang.
"""
import base64, json, mimetypes, os, struct, sys
from pathlib import Path
import requests

AKAR = Path(__file__).resolve().parent.parent
URL = os.environ["SUPABASE_URL"].rstrip("/")
KUNCI = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KUNCI, "Authorization": f"Bearer {KUNCI}"}


def baca(nama):
    return json.loads((AKAR / "data" / nama).read_text(encoding="utf-8"))


def upsert(tabel, baris, konflik):
    for i in range(0, len(baris), 200):
        r = requests.post(f"{URL}/rest/v1/{tabel}?on_conflict={konflik}", json=baris[i:i + 200],
                          headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"}, timeout=120)
        if not r.ok:
            sys.exit(f"{tabel}: {r.status_code} {r.text[:300]}")
    print(f"{tabel}: {len(baris)} baris")


def unggah(jalur, berkas):
    tipe = mimetypes.guess_type(berkas.name)[0] or "application/octet-stream"
    r = requests.post(f"{URL}/storage/v1/object/dokumen/{jalur}", data=berkas.read_bytes(),
                      headers={**H, "Content-Type": tipe, "x-upsert": "true"}, timeout=300)
    if not r.ok:
        sys.exit(f"unggah {jalur}: {r.status_code} {r.text[:300]}")


dokumen = baca("dokumen.json")
for d in dokumen:
    asal = AKAR / d["berkas"]
    unggah(asal.name, asal)
    kecil = asal.with_name(f"{d['id']}-kecil.jpg")
    if kecil.exists():
        unggah(f"kecil/{d['id']}.jpg", kecil)
print(f"penyimpanan: {len(dokumen)} dokumen")

upsert("dokumen", [{
    "id": d["id"], "judul": d["judul"], "tipe": d["tipe"], "berkas": Path(d["berkas"]).name,
    "ekstraksi": d["ekstraksi"], "ground_truth": d["ground_truth"], "akurasi_f1": d["akurasi_f1"],
    "status_indeks": d["status_indeks"], "catatan": d.get("catatan") or "",
    "dibuat": d["dibuat"] + "+08:00", "diperbarui": d["diperbarui"] + "+08:00",
} for d in dokumen], "id")

potongan = baca("korpus.json")["potongan"]
upsert("potongan", [{
    "id": p["id"], "doc_id": p["doc_id"], "urutan": int(p["id"].split("::")[1]), "halaman": p["halaman"], "teks": p["teks"],
    "embedding": json.dumps([round(x, 7) for x in struct.unpack("1536f", base64.b64decode(p["vektor"]))]),
} for p in potongan], "id")

r = requests.get(f"{URL}/rest/v1/log_kueri?select=id&limit=1", headers=H, timeout=60)
if r.ok and not r.json():
    upsert("log_kueri", [{
        "waktu": e["waktu"] + "+08:00", "kanal": e["kanal"], "pertanyaan": e["pertanyaan"], "jawaban": e["jawaban"],
        "latensi_total_s": e["latensi_total_s"], "latensi_retrieval_s": e["latensi_retrieval_s"],
        "latensi_generasi_s": e["latensi_generasi_s"], "galat": e["galat"], "hasil": e["hasil"],
    } for e in baca("log.json")], "id")
else:
    print("log_kueri: sudah berisi, dilewati")

upsert("uji_kueri", [{
    "no": int(u["No"]), "kategori": u["Kategori"], "gaya_bahasa": u["Gaya_Bahasa"], "target_dokumen": u["Target_Dokumen"],
    "pertanyaan": u["Pertanyaan"], "jawaban_ai": u["Jawaban_AI"],
    "rank_target": int(u["Rank_Target"]) if u["Rank_Target"].isdigit() else None,
    "latensi_detik": float(u["Latensi_Detik"]), "status": u["Status_Halusinasi_Manual"],
} for u in baca("evaluasi-50-kueri.json")], "no")

if os.environ.get("ADMIN_EMAIL") and os.environ.get("ADMIN_PASSWORD"):
    r = requests.post(f"{URL}/auth/v1/admin/users", headers=H, timeout=60, json={
        "email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"],
        "email_confirm": True, "app_metadata": {"role": "admin"},
    })
    print("akun admin:", "dibuat" if r.ok else f"{r.status_code} {r.text[:200]}")
