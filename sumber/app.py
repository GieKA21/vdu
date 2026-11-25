"""
Cbot Upeks: Sistem Chatbot Question Answering untuk Layanan Informasi Periklanan dan Sirkulasi
PT Ujungpandang Ekspres Harian Bisnis (halaman chatbot publik dan Panel Admin wajib login).
"""
import os
import time
import pandas as pd
import streamlit as st

import auth
import doc_manager as dm
import rag_engine as rag

st.set_page_config(
    page_title="Cbot Upeks – Layanan Informasi Periklanan & Sirkulasi",
    page_icon="📰",
    layout="wide",
    initial_sidebar_state="expanded",
)

CSS = """
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap');
:root { --teal:#2B6663; --teal-dark:#1C4A48; --ink:#1E2B2A; --muted:#5C6F6D; --bronze:#B9772B; --line:#D9E2E0; }
.stApp, .stApp p, .stApp label, .stApp li, .stApp input, .stApp textarea, .stApp button, .stApp td, .stApp th {
    font-family: 'IBM Plex Sans', system-ui, 'Segoe UI', sans-serif;
}
.stApp h1, .stApp h2, .stApp h3, .masthead-judul, [data-testid="stMetricValue"] {
    font-family: 'Newsreader', Georgia, serif; color: var(--teal-dark); letter-spacing: -0.01em;
}
.block-container, [data-testid="stMainBlockContainer"] { padding-top: 2rem; max-width: 1180px; }
.masthead-judul { font-size: 2.1rem; font-weight: 600; line-height: 1.15; }
.masthead-sub { color: var(--muted); font-size: 0.98rem; margin-top: 0.25rem; max-width: 65ch; }
.garis-perunggu { height: 2px; background: var(--bronze); margin: 0.75rem 0 1.25rem 0; }
.sidebar-judul { font-family: 'Newsreader', Georgia, serif; font-size: 1.25rem; font-weight: 600; color: var(--teal-dark); margin-bottom: 0.5rem; }
[data-testid="stForm"] { border: 1px solid var(--line); border-radius: 10px; background: #fff; }
[data-testid="stMetric"] { border: 1px solid var(--line); border-radius: 10px; padding: 0.75rem 1rem; background: #fff; }
[data-testid="stChatMessage"] { border: 1px solid var(--line); border-radius: 10px; background: #fff; }
[data-testid="stSidebar"] { border-right: 1px solid var(--line); }
.stButton > button { border-radius: 6px; font-weight: 500; }
footer { visibility: hidden; }
"""

CONTOH_PERTANYAAN = [
    "Berapa tarif iklan umum berwarna per mm/kolom?",
    "Apa saja syarat memasang iklan untuk instansi?",
    "Berapa harga langganan koran per bulan di Makassar?",
    "Siapa yang menjabat Manajer Iklan?",
]
STATUS = {"terindeks": "Terindeks", "belum": "Belum diindeks", "gagal": "Gagal"}

def angka(x, desimal=2):
    return f"{x:.{desimal}f}".replace(".", ",")

def label_tipe(e):
    return "Gambar" if e["tipe"] == "gambar" else "PDF"

def fmt_waktu(iso):
    return (iso or "")[:16].replace("T", " ")

def inisialisasi_state():
    st.session_state.setdefault("halaman", "chat")
    st.session_state.setdefault("admin_ok", False)
    st.session_state.setdefault("riwayat", [])
    st.session_state.setdefault("gagal_login", 0)
    st.session_state.setdefault("kunci_hingga", 0.0)

def pindah(halaman):
    st.session_state["halaman"] = halaman

def keluar_admin():
    st.session_state["admin_ok"] = False
    st.session_state["halaman"] = "chat"

def antrekan(teks):
    st.session_state["antrean"] = teks

def reset_percakapan():
    st.session_state["riwayat"] = []

def flash(jenis, teks):
    st.session_state["flash"] = (jenis, teks)

def tampil_flash():
    pesan = st.session_state.pop("flash", None)
    if pesan:
        {"success": st.success, "error": st.error, "warning": st.warning, "info": st.info}[pesan[0]](pesan[1])

def masthead(judul, sub):
    st.markdown(
        f'<div class="masthead-judul">{judul}</div><div class="masthead-sub">{sub}</div>',
        unsafe_allow_html=True,
    )

def sidebar_chat():
    with st.sidebar:
        st.markdown('<div class="sidebar-judul">Dokumen rujukan</div>', unsafe_allow_html=True)
        dokumen = dm.daftar_dokumen(hanya_terindeks=True)
        if dokumen:
            for e in dokumen:
                st.markdown(f"**{e['judul']}**  \n{label_tipe(e)}")
        else:
            st.info("Belum ada dokumen yang diindeks. Hubungi admin untuk menambahkannya.")
        st.button("Mulai percakapan baru", on_click=reset_percakapan, key="btn_reset")
        st.caption("Jawaban hanya bersumber dari dokumen di atas.")

def tampil_detail(detail):
    if detail.get("galat") or not detail.get("hits"):
        return
    lat = detail["latensi"]
    st.caption(
        f"Dijawab dalam {angka(lat['total'], 1)} detik berdasarkan {len(detail['hits'])} potongan dokumen."
    )
    with st.expander("Rincian pencarian dan waktu respons"):
        k1, k2, k3 = st.columns(3)
        k1.metric("Total waktu", f"{angka(lat['total'])} dtk")
        k2.metric("Pencarian dokumen", f"{angka(lat['retrieval'])} dtk")
        k3.metric("Penyusunan jawaban", f"{angka(lat['generasi'])} dtk")
        tabel = pd.DataFrame([
            {
                "Peringkat": h["peringkat"],
                "Dokumen": h["judul"],
                "Jenis": "Gambar" if h["tipe"] == "image" else "PDF",
                "Kemiripan (%)": h["kemiripan"],
                "Jarak cosine": h["jarak"],
            }
            for h in detail["hits"]
        ])
        st.dataframe(tabel, hide_index=True)
        st.caption(
            "Kemiripan dihitung dengan cosine similarity. Semakin tinggi persentasenya, "
            "semakin dekat isi potongan dokumen dengan pertanyaan."
        )
        for h in detail["hits"][:3]:
            st.markdown(f"**Peringkat {h['peringkat']}: {h['judul']}**")
            st.code(h["teks"][:900], language=None)

def halaman_chat():
    sidebar_chat()
    kiri, kanan = st.columns([5, 1])
    with kiri:
        masthead(
            "Cbot Upeks",
            "Sistem Chatbot Question Answering untuk Layanan Informasi Periklanan dan Sirkulasi PT Ujungpandang Ekspres Harian Bisnis.",
        )
    with kanan:
        st.button("Panel admin", on_click=pindah, args=("login",), key="btn_ke_admin")
    st.markdown('<div class="garis-perunggu"></div>', unsafe_allow_html=True)

    pertanyaan = st.chat_input("Tulis pertanyaan Anda seputar tarif iklan, syarat pemasangan, atau langganan koran...")
    if not pertanyaan:
        pertanyaan = st.session_state.pop("antrean", None)

    if not st.session_state["riwayat"] and not pertanyaan:
        st.markdown("Mulai dengan salah satu pertanyaan di bawah, atau tulis pertanyaan Anda sendiri.")
        kolom = st.columns(2)
        for i, contoh in enumerate(CONTOH_PERTANYAAN):
            kolom[i % 2].button(contoh, key=f"contoh_{i}", on_click=antrekan, args=(contoh,))

    for pesan in st.session_state["riwayat"]:
        with st.chat_message(pesan["peran"]):
            if pesan.get("galat"):
                st.warning(pesan["isi"])
            else:
                st.markdown(pesan["isi"])
            if pesan["peran"] == "assistant":
                tampil_detail(pesan["detail"])

    if pertanyaan:
        with st.chat_message("user"):
            st.markdown(pertanyaan)
        with st.chat_message("assistant"):
            with st.spinner("Mencari jawaban di dokumen..."):
                d = rag.tanya_asisten_detail(pertanyaan, kanal="web")
            if d["galat"]:
                st.warning(d["jawaban"])
            else:
                st.markdown(d["jawaban"])
            ringkas = {"galat": d["galat"], "latensi": d["latensi"], "hits": d["hits"]}
            tampil_detail(ringkas)
        st.session_state["riwayat"].append({"peran": "user", "isi": pertanyaan})
        st.session_state["riwayat"].append(
            {"peran": "assistant", "isi": d["jawaban"], "galat": d["galat"], "detail": ringkas}
        )

def halaman_login():
    _, tengah, _ = st.columns([1, 1.2, 1])
    with tengah:
        masthead("Masuk panel admin", "Khusus pengelola dokumen. Pengguna umum cukup memakai halaman chatbot.")
        st.markdown('<div class="garis-perunggu"></div>', unsafe_allow_html=True)

        if not auth.kredensial_terkonfigurasi():
            st.error(
                "Kredensial admin belum diatur. Tambahkan ADMIN_USERNAME dan ADMIN_PASSWORD_HASH "
                "di file .env, lalu jalankan ulang aplikasi."
            )
            st.button("Kembali ke chatbot", on_click=pindah, args=("chat",), key="btn_kembali_login")
            return

        with st.form("form_login"):
            username = st.text_input("Username")
            password = st.text_input("Password", type="password")
            kirim = st.form_submit_button("Masuk", type="primary")
        st.button("Kembali ke chatbot", on_click=pindah, args=("chat",), key="btn_kembali_login")

        if kirim:
            sisa = int(st.session_state["kunci_hingga"] - time.time())
            if sisa > 0:
                st.error(f"Terlalu banyak percobaan gagal. Coba lagi dalam {sisa} detik.")
            elif auth.cek_kredensial(username, password):
                st.session_state["admin_ok"] = True
                st.session_state["halaman"] = "admin"
                st.session_state["gagal_login"] = 0
                st.rerun()
            else:
                st.session_state["gagal_login"] += 1
                if st.session_state["gagal_login"] >= 5:
                    st.session_state["kunci_hingga"] = time.time() + 60
                    st.session_state["gagal_login"] = 0
                st.error("Username atau password salah. Periksa kembali, lalu coba lagi.")

def indeks_massal(daftar):
    if not daftar:
        flash("info", "Tidak ada dokumen yang perlu diproses.")
        st.rerun()
    bar = st.progress(0.0, text="Memulai pengindeksan...")
    gagal = 0
    for i, e in enumerate(daftar, start=1):
        bar.progress((i - 1) / len(daftar), text=f"Memproses {i} dari {len(daftar)}: {e['judul']}")
        hasil = dm.indeks_dokumen(e["id"])
        if hasil["status_indeks"] != "terindeks":
            gagal += 1
    bar.progress(1.0, text="Selesai")
    if gagal:
        flash("warning", f"{len(daftar) - gagal} dokumen terindeks, {gagal} gagal. Lihat kolom catatan di tiap dokumen.")
    else:
        flash("success", f"{len(daftar)} dokumen berhasil diindeks.")
    st.rerun()

def tabel_dokumen(dokumen):
    return pd.DataFrame([
        {
            "Judul": e["judul"],
            "Jenis": label_tipe(e),
            "Berkas": os.path.basename(e["berkas"]),
            "Status": STATUS.get(e["status_indeks"], e["status_indeks"]),
            "Potongan teks": e.get("jumlah_chunk", 0),
            "F1 (%)": e.get("akurasi_f1"),
            "Diperbarui": fmt_waktu(e.get("diperbarui")),
        }
        for e in dokumen
    ])

def formulir_tambah(dokumen):
    with st.expander("Tambah dokumen", expanded=not dokumen):
        # Pemilihan jenis dokumen di luar form agar tampilan dinamis
        jenis_pilihan = st.radio(
            "Pilih Kategori Dokumen",
            [
                "Dokumen Gambar / Poster Tarif (VDU + Ground Truth)",
                "Dokumen Regulasi / Panduan Layanan Periklanan dan Sirkulasi (PDF)",
            ],
            horizontal=True
        )
        
        with st.form("form_tambah", clear_on_submit=True):
            judul = st.text_input(
                "Judul dokumen",
                placeholder="Contoh: Tarif Iklan 2026 atau Panduan Layanan Periklanan dan Sirkulasi",
            )
            
            gt_data = None
            if "Gambar" in jenis_pilihan:
                berkas = st.file_uploader("Pilih berkas gambar poster", type=["png", "jpg", "jpeg"])
                gt = st.file_uploader("Pilih berkas Ground Truth (.txt untuk uji F1-Score)", type=["txt"])
            else:
                berkas = st.file_uploader("Pilih berkas dokumen regulasi", type=["pdf"])
                gt = None
                
            indeks = st.checkbox("Indeks setelah diunggah ke sistem", value=True)
            kirim = st.form_submit_button("Tambah dokumen", type="primary")
            
        if kirim:
            if not judul.strip():
                st.error("Isi judul dokumen terlebih dahulu.")
            elif berkas is None:
                st.error("Pilih berkas yang akan diunggah.")
            else:
                try:
                    with st.spinner("Memproses dokumen dan membangun indeks vektor..."):
                        e = dm.tambah_dokumen(
                            judul, berkas.name, berkas.getvalue(),
                            gt.getvalue() if gt is not None else None, indeks,
                        )
                    if e["status_indeks"] == "terindeks":
                        flash("success", f"Dokumen “{e['judul']}” berhasil ditambahkan dan diindeks ({e['jumlah_chunk']} potongan teks).")
                    elif e["status_indeks"] == "gagal":
                        flash("warning", f"Dokumen “{e['judul']}” tersimpan, tetapi pengindeksan gagal: {e['catatan']}")
                    else:
                        flash("success", f"Dokumen “{e['judul']}” berhasil ditambahkan.")
                    st.rerun()
                except ValueError as err:
                    st.error(str(err))

def kelola_dokumen(dokumen):
    st.subheader("Kelola dokumen")
    pilihan = {e["id"]: e for e in dokumen}
    ids = list(pilihan)
    if st.session_state.get("pilih_dokumen") not in ids:
        st.session_state.pop("pilih_dokumen", None)
    doc_id = st.selectbox(
        "Pilih dokumen", ids,
        format_func=lambda i: f"{pilihan[i]['judul']} ({label_tipe(pilihan[i])})",
        key="pilih_dokumen",
    )
    e = pilihan[doc_id]
    st.caption(
        f"Status: {STATUS.get(e['status_indeks'], e['status_indeks'])}. "
        f"Potongan teks: {e.get('jumlah_chunk', 0)}. Diperbarui: {fmt_waktu(e.get('diperbarui'))}."
    )
    if e.get("catatan"):
        st.warning(e["catatan"])

    tindakan = st.radio("Tindakan", ["Pratinjau", "Perbarui", "Hapus"], horizontal=True, key=f"tindakan_{doc_id}")

    if tindakan == "Pratinjau":
        path = dm.path_absolut(e["berkas"])
        if not os.path.exists(path):
            st.error("Berkas tidak ditemukan di folder data. Hapus dokumen ini atau unggah ulang berkasnya.")
        elif e["tipe"] == "gambar":
            st.image(path, caption=e["judul"])
        else:
            st.write(f"Berkas PDF, ukuran {angka(os.path.getsize(path) / 1024, 1)} KB.")
            with open(path, "rb") as f:
                st.download_button(
                    "Unduh PDF", f.read(), file_name=os.path.basename(path),
                    mime="application/pdf", key=f"unduh_{doc_id}",
                )
    elif tindakan == "Perbarui":
        gambar = e["tipe"] == "gambar"
        with st.form(f"form_perbarui_{doc_id}", clear_on_submit=True):
            judul_baru = st.text_input("Judul dokumen", value=e["judul"])
            berkas_baru = st.file_uploader("Ganti berkas (opsional)", type=["png", "jpg", "jpeg"] if gambar else ["pdf"])
            gt_baru = st.file_uploader("Ganti ground truth (opsional, .txt)", type=["txt"]) if gambar else None
            indeks_ulang = st.checkbox("Indeks ulang setelah berkas diganti", value=True)
            simpan = st.form_submit_button("Simpan perubahan", type="primary")
        if simpan:
            try:
                with st.spinner("Menyimpan perubahan..."):
                    hasil = dm.perbarui_dokumen(
                        doc_id,
                        judul=judul_baru,
                        nama_berkas_baru=berkas_baru.name if berkas_baru is not None else None,
                        data_baru=berkas_baru.getvalue() if berkas_baru is not None else None,
                        gt_baru=gt_baru.getvalue() if gt_baru is not None else None,
                        indeks_ulang=indeks_ulang and berkas_baru is not None,
                    )
                if hasil["status_indeks"] == "gagal":
                    flash("warning", f"Perubahan disimpan, tetapi pengindeksan gagal: {hasil['catatan']}")
                else:
                    flash("success", f"Perubahan pada “{hasil['judul']}” disimpan.")
                st.rerun()
            except ValueError as err:
                st.error(str(err))
        if st.button("Indeks ulang sekarang", key=f"reindeks_{doc_id}"):
            with st.spinner("Mengindeks ulang dokumen..."):
                hasil = dm.indeks_dokumen(doc_id)
            if hasil["status_indeks"] == "terindeks":
                flash("success", f"“{hasil['judul']}” diindeks ulang ({hasil['jumlah_chunk']} potongan teks).")
            else:
                flash("warning", f"Pengindeksan gagal: {hasil['catatan']}")
            st.rerun()
    else:
        st.warning("Dokumen, berkas, ground truth, hasil ekstraksi, dan seluruh potongan teksnya di basis data vektor akan dihapus permanen.")
        yakin = st.checkbox("Saya mengerti, hapus dokumen ini", key=f"yakin_hapus_{doc_id}")
        if st.button("Hapus dokumen", disabled=not yakin, key=f"hapus_{doc_id}"):
            dm.hapus_dokumen(doc_id)
            flash("success", f"Dokumen “{e['judul']}” dihapus.")
            st.rerun()

def tab_dokumen():
    dokumen = dm.daftar_dokumen()
    ring = dm.ringkasan()
    k1, k2, k3, k4 = st.columns(4)
    k1.metric("Total dokumen", ring["total"])
    k2.metric("Gambar", ring["gambar"])
    k3.metric("PDF", ring["pdf"])
    k4.metric("Potongan teks terindeks", ring["vektor"])

    st.subheader("Daftar dokumen")
    if dokumen:
        st.dataframe(tabel_dokumen(dokumen), hide_index=True)
    else:
        st.info("Belum ada dokumen. Tambahkan poster atau PDF melalui formulir di bawah.")

    formulir_tambah(dokumen)
    if dokumen:
        kelola_dokumen(dokumen)
        with st.expander("Pemeliharaan indeks"):
            st.caption("Mengindeks gambar memanggil GPT-4o-mini Vision, sehingga memakan waktu dan biaya API.")
            p1, p2 = st.columns(2)
            if p1.button("Indeks dokumen yang belum terindeks", key="btn_idx_belum"):
                indeks_massal([e for e in dokumen if e["status_indeks"] != "terindeks"])
            if p2.button("Bangun ulang semua indeks", key="btn_idx_semua"):
                indeks_massal(dokumen)

def tab_evaluasi():
    gambar = dm.daftar_dokumen("gambar")
    pdf_docs = dm.daftar_dokumen("pdf")
    semua_dok = gambar + pdf_docs
    
    if not semua_dok:
        st.info("Belum ada dokumen gambar atau PDF. Tambahkan berkas di tab Dokumen.")
        return
        
    bernilai = [e for e in gambar if e.get("akurasi_f1") is not None]

    k1, k2, k3 = st.columns(3)
    k1.metric("Poster dievaluasi", f"{len(bernilai)} dari {len(gambar)}")
    if bernilai:
        rata = sum(e["akurasi_f1"] for e in bernilai) / len(bernilai)
        k2.metric(
            "Rata-rata F1", f"{angka(rata)}%",
            delta=f"{angka(rata - dm.TARGET_F1)} poin dari target {int(dm.TARGET_F1)}%",
        )
        lolos = sum(1 for e in bernilai if e["akurasi_f1"] >= dm.TARGET_F1)
        k3.metric("Memenuhi target", f"{lolos} dari {len(bernilai)}")
    else:
        k2.metric("Rata-rata F1", "-")
        k3.metric("Memenuhi target", "-")
        st.info("Belum ada nilai F1. Unggah ground truth lalu indeks dokumennya.")

    if bernilai:
        df = pd.DataFrame([{"Dokumen": e["judul"], "F1 (%)": e["akurasi_f1"]} for e in bernilai])
        st.bar_chart(df.set_index("Dokumen"))
        st.dataframe(
            pd.DataFrame([
                {
                    "Dokumen": e["judul"],
                    "F1 (%)": e["akurasi_f1"],
                    "Terhadap target": "Memenuhi" if e["akurasi_f1"] >= dm.TARGET_F1 else "Di bawah target",
                    "Status indeks": STATUS.get(e["status_indeks"], e["status_indeks"]),
                }
                for e in bernilai
            ]),
            hide_index=True,
        )

    st.subheader("Periksa hasil ekstraksi (Gambar & PDF)")
    pilihan = {e["id"]: e for e in semua_dok}
    ids = list(pilihan)
    if st.session_state.get("pilih_eval") not in ids:
        st.session_state.pop("pilih_eval", None)
    doc_id = st.selectbox("Pilih dokumen untuk dipratinjau", ids, format_func=lambda i: f"{pilihan[i]['judul']} ({label_tipe(pilihan[i])})", key="pilih_eval")

    ekstraksi, gt = dm.baca_ekstraksi(doc_id), dm.baca_gt(doc_id)
    if ekstraksi is None:
        st.info("Hasil ekstraksi belum tersimpan. Jalankan indeks ulang dari tab Dokumen.")
    else:
        kiri, kanan = st.columns(2)
        kiri.text_area(
            f"Hasil ekstraksi ({pilihan[doc_id]['tipe'].upper()})", ekstraksi, height=320, disabled=True,
            key=f"ekst_{doc_id}_{abs(hash(ekstraksi)) % 10**8}",
        )
        if pilihan[doc_id]['tipe'] == 'gambar':
            if gt is None:
                kanan.info("Ground truth belum diunggah untuk poster ini.")
            else:
                kanan.text_area(
                    "Ground truth", gt, height=320, disabled=True,
                    key=f"gt_{doc_id}_{abs(hash(gt)) % 10**8}",
                )
            selisih = dm.selisih_kata(doc_id)
            if selisih:
                with st.expander("Analisis selisih kata"):
                    st.write(
                        f"Kata unik cocok: {selisih['cocok']} dari {selisih['total_gt']} pada ground truth "
                        f"dan {selisih['total_prediksi']} pada hasil ekstraksi."
                    )
                    st.markdown(f"**Ada di ground truth, tidak ada di hasil VDU ({len(selisih['hilang'])} kata)**")
                    st.write(", ".join(selisih["hilang"][:300]) or "Tidak ada.")
                    st.markdown(f"**Ada di hasil VDU, tidak ada di ground truth ({len(selisih['berlebih'])} kata)**")
                    st.write(", ".join(selisih["berlebih"][:300]) or "Tidak ada.")
        else:
            kanan.info("Dokumen PDF tidak memerlukan Ground Truth untuk evaluasi F1-Score.")

    b1, b2 = st.columns(2)
    if pilihan[doc_id]['tipe'] == 'gambar' and b1.button("Hitung ulang F1 dari ekstraksi tersimpan", key="btn_hitung_f1"):
        try:
            nilai = dm.hitung_ulang_f1(doc_id)
            flash("success", f"F1 dihitung ulang: {angka(nilai)}%.")
        except ValueError as err:
            flash("error", str(err))
        st.rerun()
    if b2.button("Ekstrak ulang dan indeks ulang", key="btn_ekstrak_ulang"):
        with st.spinner("Memanggil ekstraktor dan mengindeks ulang..."):
            hasil = dm.indeks_dokumen(doc_id)
        if hasil["status_indeks"] == "terindeks":
            flash("success", "Ekstraksi dan pengindeksan ulang selesai.")
        else:
            flash("warning", f"Pengindeksan gagal: {hasil['catatan']}")
        st.rerun()

def tab_log():
    data = rag.baca_log()
    if not data:
        st.info("Belum ada kueri yang tercatat. Log terisi otomatis saat chatbot dipakai.")
        return
    df = pd.DataFrame(data)
    df["Sumber teratas"] = df["hasil"].apply(lambda h: h[0]["judul"] if h else "-")
    df["Kemiripan teratas (%)"] = df["hasil"].apply(lambda h: h[0]["kemiripan"] if h else None)

    k1, k2, k3 = st.columns(3)
    k1.metric("Jumlah kueri", len(df))
    k2.metric("Rata-rata waktu respons", f"{angka(df['latensi_total_s'].mean())} dtk")
    k3.metric("Median waktu respons", f"{angka(df['latensi_total_s'].median())} dtk")

    st.subheader("Waktu respons per kanal")
    per_kanal = df.groupby("kanal")["latensi_total_s"].agg(["count", "mean", "median"]).round(2).reset_index()
    per_kanal.columns = ["Kanal", "Jumlah kueri", "Rata-rata (dtk)", "Median (dtk)"]
    st.dataframe(per_kanal, hide_index=True)

    st.subheader("Kueri terbaru")
    tampil = df[[
        "waktu", "kanal", "pertanyaan", "latensi_total_s", "latensi_retrieval_s",
        "latensi_generasi_s", "Sumber teratas", "Kemiripan teratas (%)",
    ]].iloc[::-1].head(200)
    tampil.columns = [
        "Waktu", "Kanal", "Pertanyaan", "Total (dtk)", "Pencarian (dtk)",
        "Jawaban (dtk)", "Sumber teratas", "Kemiripan teratas (%)",
    ]
    st.dataframe(tampil, hide_index=True)

    st.download_button(
        "Unduh log (CSV)",
        df.drop(columns=["hasil"]).to_csv(index=False).encode("utf-8-sig"),
        file_name="log_kueri.csv", mime="text/csv", key="unduh_log",
    )
    yakin = st.checkbox("Saya mengerti, hapus seluruh log kueri", key="yakin_hapus_log")
    if st.button("Hapus log kueri", disabled=not yakin, key="btn_hapus_log"):
        rag.hapus_log()
        flash("success", "Seluruh log kueri dihapus.")
        st.rerun()

def halaman_admin():
    kiri, k1, k2 = st.columns([4, 1.2, 0.8])
    with kiri:
        masthead("Panel administrasi", "Kelola dokumen rujukan, pantau akurasi ekstraksi VDU, dan tinjau log kueri.")
    with k1:
        st.button("Kembali ke chatbot", on_click=pindah, args=("chat",), key="btn_admin_ke_chat")
    with k2:
        st.button("Keluar", on_click=keluar_admin, key="btn_keluar")
    st.markdown('<div class="garis-perunggu"></div>', unsafe_allow_html=True)

    tampil_flash()
    tab1, tab2, tab3 = st.tabs(["Dokumen", "Evaluasi VDU & PDF", "Log kueri"])
    with tab1:
        tab_dokumen()
    with tab2:
        tab_evaluasi()
    with tab3:
        tab_log()

def main():
    inisialisasi_state()
    st.markdown(f"<style>{CSS}</style>", unsafe_allow_html=True)

    halaman = st.session_state["halaman"]
    if halaman == "admin" and not st.session_state["admin_ok"]:
        halaman = "login"
    if halaman == "login" and st.session_state["admin_ok"]:
        halaman = "admin"

    if halaman == "chat":
        halaman_chat()
    elif halaman == "login":
        halaman_login()
    else:
        halaman_admin()

main()