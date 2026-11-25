import csv
import time
from rag_engine import tanya_asisten

# Dataset 50 Kueri Uji:
# - 40 Kueri In-Domain (10 per dokumen: kombinasi Bahasa Baku & Logat Makassar)
# - 10 Kueri Out-of-Domain / Jebakan (kombinasi Bahasa Baku & Logat Makassar)
DATASET_UJI = [
    # =========================================================================
    # KELOMPOK 1: Profil Perusahaan (1.png) - 10 Kueri
    # =========================================================================
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Profil Perusahaan",
     "pertanyaan": "Kapan Harian Ujungpandang Ekspres resmi berdiri dan apa badan hukum awalnya?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Profil Perusahaan",
     "pertanyaan": "Sejak kapan mi Upeks bernaung di bawah PT Portal Upeks Indonesia?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Profil Perusahaan",
     "pertanyaan": "Apa slogan atau tagline resmi dari Harian Ujungpandang Ekspres?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Profil Perusahaan",
     "pertanyaan": "Di mana ki alamat kantor redaksinya Ujungpandang Ekspres di Makassar?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Profil Perusahaan",
     "pertanyaan": "Siapa mi yang menjabat sebagai Pemimpin Umum sama Pemimpin Redaksi di Upeks?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Profil Perusahaan",
     "pertanyaan": "Siapa nama Manager Iklan dan Manager Keuangan pada struktur organisasi Upeks?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Profil Perusahaan",
     "pertanyaan": "Berapa nomor telepon atau WhatsApp yang bisa dihubungi kalau mau ki berurusan ke kantor Upeks?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Profil Perusahaan",
     "pertanyaan": "Apa saja alamat email resmi untuk layanan pemasangan iklan di Upeks?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Profil Perusahaan",
     "pertanyaan": "Di mana tempat percetakannya koran Upeks dan berapa nomor teleponnya?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Profil Perusahaan",
     "pertanyaan": "Apa saja akun media sosial resmi milik Ujungpandang Ekspres?"},

    # =========================================================================
    # KELOMPOK 2: Tarif Iklan dan Berlangganan (2.png) - 10 Kueri
    # =========================================================================
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Tarif Iklan dan Berlangganan",
     "pertanyaan": "Berapa mi tarifnya kalau mau ki pasang iklan umum yang berwarna per mm/kolom?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Tarif Iklan dan Berlangganan",
     "pertanyaan": "Berapa tarif pemasangan iklan umum hitam putih (BW) per mm/kolom?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Tarif Iklan dan Berlangganan",
     "pertanyaan": "Kalau iklan mungil yang hitam putih sama berwarna, berapa mi harganya per mm/kolom?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Tarif Iklan dan Berlangganan",
     "pertanyaan": "Berapa biaya pemasangan iklan duka cita baik hitam putih maupun berwarna?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Tarif Iklan dan Berlangganan",
     "pertanyaan": "Berapa tarif iklan advertorial atau seremoni yang berwarna di Upeks?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Tarif Iklan dan Berlangganan",
     "pertanyaan": "Berapa tarif yang tercantum untuk kategori iklan baris pada tabel tarif?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Tarif Iklan dan Berlangganan",
     "pertanyaan": "Kalau mau ki berlangganan koran Upeks di dalam kota Makassar, berapa mi biayanya per bulan?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Tarif Iklan dan Berlangganan",
     "pertanyaan": "Bagaimana ketentuan biaya berlangganan koran untuk pelanggan di luar kota Makassar?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Tarif Iklan dan Berlangganan",
     "pertanyaan": "Berapa mi harga eceran koran Ujungpandang Ekspres per eksemplar?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Tarif Iklan dan Berlangganan",
     "pertanyaan": "Apa saja lima kategori iklan cetak yang tersedia pada daftar tarif Upeks?"},

    # =========================================================================
    # KELOMPOK 3: Persyaratan Administrasi dan Pemasangan (3.png) - 10 Kueri
    # =========================================================================
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Persyaratan Administrasi dan Pemasangan",
     "pertanyaan": "Apa-apa saja syaratnya kalau instansi atau perusahaan mau pasang iklan di Upeks?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Persyaratan Administrasi dan Pemasangan",
     "pertanyaan": "Apa fungsi lampiran Copy NPWP Perusahaan dalam syarat pemasangan iklan korporat?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Persyaratan Administrasi dan Pemasangan",
     "pertanyaan": "Kapan pi paling lambat disetor materi desain iklannya sebelum tanggal terbit?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Persyaratan Administrasi dan Pemasangan",
     "pertanyaan": "Format file dan resolusi minimal apa yang disyaratkan untuk materi final desain iklan?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Persyaratan Administrasi dan Pemasangan",
     "pertanyaan": "Bagaimana sistem pembayarannya kalau pasang iklan, harus lunas di muka ji atau bisa tempo?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Persyaratan Administrasi dan Pemasangan",
     "pertanyaan": "Apa saja empat persyaratan untuk berlangganan koran harian Upeks?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Persyaratan Administrasi dan Pemasangan",
     "pertanyaan": "Identitas diri apa yang dibutuhkan kalau perorangan atau perkantoran mau langganan koran?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Persyaratan Administrasi dan Pemasangan",
     "pertanyaan": "Mengapa pelanggan wajib melampirkan peta denah lokasi atau share location saat berlangganan?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "Persyaratan Administrasi dan Pemasangan",
     "pertanyaan": "Apakah wartawan Upeks di lapangan boleh memungut biaya atau imbalan saat bertugas?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "Persyaratan Administrasi dan Pemasangan",
     "pertanyaan": "Dokumen bukti persetujuan anggaran apa yang wajib dilampirkan klien korporat saat memesan iklan?"},

    # =========================================================================
    # KELOMPOK 4: File Regulasi (SOP TERBARU.pdf) - 10 Kueri
    # =========================================================================
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "File Regulasi",
     "pertanyaan": "Kapan pertama kali Ujungpandang Ekspres hadir sebagai koran sore dan di mana alamat kantor pertamanya?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "File Regulasi",
     "pertanyaan": "Kapan ki Upeks mulai berubah jadi koran pagi dan pindah ke Gedung Graha Pena?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "File Regulasi",
     "pertanyaan": "Prestasi apa yang diraih Upeks pada tender pengumuman iklan lelang Pemprov Sulsel tahun 2007-2009?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "File Regulasi",
     "pertanyaan": "Siapa nama wartawan daerah ta di Kabupaten Gowa sama nomor teleponnya?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "File Regulasi",
     "pertanyaan": "Kalau di Pare-pare sama Bulukumba, siapa mi nama biro pemasarannya Upeks?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "File Regulasi",
     "pertanyaan": "Apakah rincian tarif dasar penayangan iklan yang tercantum sudah termasuk PPN?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "File Regulasi",
     "pertanyaan": "Berapa kali seminggu koran Upeks terbit, berapa jumlah halamannya, dan apa ukuran fisiknya?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "File Regulasi",
     "pertanyaan": "Halaman berapa saja yang dicetak berwarna (Full Color) pada Sesi I dan Sesi II di koran Upeks?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Baku", "target_dokumen": "File Regulasi",
     "pertanyaan": "Siapa nama Fotografer dan Asisten Manager Keuangan yang tercantum dalam struktur redaksi PDF?"},
    {"kategori": "In-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "File Regulasi",
     "pertanyaan": "Siapa nama wartawan Upeks yang bertugas di Kabupaten Sidrap dan Kabupaten Bone?"},

    # =========================================================================
    # KELOMPOK 5: Kueri Jebakan / Out-of-Domain - 10 Kueri
    # =========================================================================
    {"kategori": "Out-of-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "TIDAK_ADA",
     "pertanyaan": "Berapa mi tarif pasang iklan baris di Harian Fajar Makassar?"},
    {"kategori": "Out-of-Domain", "gaya_bahasa": "Baku", "target_dokumen": "TIDAK_ADA",
     "pertanyaan": "Siapa nama Direktur Utama PT Telkom Indonesia saat ini?"},
    {"kategori": "Out-of-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "TIDAK_ADA",
     "pertanyaan": "Ada ji layanan sewa baliho videotron milik Upeks di Jalan AP Pettarani Makassar?"},
    {"kategori": "Out-of-Domain", "gaya_bahasa": "Baku", "target_dokumen": "TIDAK_ADA",
     "pertanyaan": "Berapa harga saham PT Ujungpandang Intermedia Makassar di Bursa Efek Indonesia?"},
    {"kategori": "Out-of-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "TIDAK_ADA",
     "pertanyaan": "Berapa mi gaji pokoknya karyawan bagian percetakan di Ujungpandang Ekspres?"},
    {"kategori": "Out-of-Domain", "gaya_bahasa": "Baku", "target_dokumen": "TIDAK_ADA",
     "pertanyaan": "Berapa tarif pemasangan iklan komersial di stasiun televisi RCTI pada jam tayang utama?"},
    {"kategori": "Out-of-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "TIDAK_ADA",
     "pertanyaan": "Kapan pi jadwal berangkatnya kapal Pelni dari Pelabuhan Soekarno-Hatta ke Surabaya?"},
    {"kategori": "Out-of-Domain", "gaya_bahasa": "Baku", "target_dokumen": "TIDAK_ADA",
     "pertanyaan": "Siapa negara pemenang turnamen Piala Dunia FIFA tahun 2022?"},
    {"kategori": "Out-of-Domain", "gaya_bahasa": "Makassar", "target_dokumen": "TIDAK_ADA",
     "pertanyaan": "Berapa harga tiket pesawat Garuda dari Bandara Sultan Hasanuddin ke Jakarta besok?"},
    {"kategori": "Out-of-Domain", "gaya_bahasa": "Baku", "target_dokumen": "TIDAK_ADA",
     "pertanyaan": "Bagaimana cara menyeduh kopi manual brew V60 dengan rasio 1:15 yang tepat?"}
]


def _ekstrak_daftar_dokumen(detail):
    """Mengekstrak daftar nama dokumen yang ditarik dari struktur dict kembalian tanya_asisten."""
    dokumen_ditarik = []
    if not isinstance(detail, dict):
        return dokumen_ditarik

    # Cari list sumber dokumen di dalam dictionary detail
    kandidat_list = []
    for key in ["sumber", "chunks", "hasil", "dokumen", "referensi", "sources"]:
        if isinstance(detail.get(key), list):
            kandidat_list = detail[key]
            break

    if not kandidat_list:
        for val in detail.values():
            if isinstance(val, list) and val and isinstance(val[0], dict):
                kandidat_list = val
                break

    for item in kandidat_list:
        if isinstance(item, dict):
            nama = (
                item.get("judul")
                or item.get("dokumen")
                or item.get("nama_dokumen")
                or item.get("title")
                or item.get("source")
                or ""
            )
            if nama:
                dokumen_ditarik.append(str(nama))
    return dokumen_ditarik


def jalankan_evaluasi():
    print("Memulai pengujian otomatis 50 kueri (Baku & Logat Makassar)...\n")
    hasil_rekaman = []
    total_rr = 0.0
    jumlah_in_domain = 0
    daftar_latensi = []

    for idx, item in enumerate(DATASET_UJI, start=1):
        q = item["pertanyaan"]
        target = item["target_dokumen"]
        kategori = item["kategori"]
        gaya = item["gaya_bahasa"]

        mulai = time.perf_counter()
        jawaban, detail = tanya_asisten(q, kanal="evaluasi_50")
        selesai = time.perf_counter()
        latensi = round(selesai - mulai, 2)
        daftar_latensi.append(latensi)

        dokumen_ditarik = _ekstrak_daftar_dokumen(detail)

        # Hitung Reciprocal Rank (RR) untuk kueri In-Domain
        rank_ditemukan = 0
        rr = 0.0
        if kategori == "In-Domain":
            jumlah_in_domain += 1
            for r, doc_name in enumerate(dokumen_ditarik, start=1):
                if target.lower() in doc_name.lower():
                    rank_ditemukan = r
                    rr = round(1.0 / r, 4)
                    break
            total_rr += rr

        print(f"[{idx:02d}/50] [{kategori} | {gaya:8s}] {latensi:4.2f}s | Rank: {rank_ditemukan} | {q[:42]}...")

        hasil_rekaman.append({
            "No": idx,
            "Kategori": kategori,
            "Gaya_Bahasa": gaya,
            "Target_Dokumen": target,
            "Pertanyaan": q,
            "Jawaban_AI": str(jawaban).replace("\n", " "),
            "Dokumen_Tarik_Top1": dokumen_ditarik[0] if dokumen_ditarik else "-",
            "Rank_Target": rank_ditemukan if kategori == "In-Domain" else "N/A",
            "Reciprocal_Rank": rr if kategori == "In-Domain" else "N/A",
            "Latensi_Detik": latensi,
            "Status_Halusinasi_Manual": ""
        })

    nama_file_csv = "hasil_evaluasi_50_kueri.csv"
    with open(nama_file_csv, mode="w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=hasil_rekaman[0].keys(), delimiter=";")
        writer.writeheader()
        writer.writerows(hasil_rekaman)

    mrr_akhir = round(total_rr / jumlah_in_domain, 4) if jumlah_in_domain else 0
    latensi_rata = round(sum(daftar_latensi) / len(daftar_latensi), 2)
    latensi_min = min(daftar_latensi)
    latensi_max = max(daftar_latensi)

    print("\n" + "=" * 58)
    print("RINGKASAN HASIL PENGUJIAN OTOMATIS (50 KUERI)")
    print("=" * 58)
    print(f"1. Mean Reciprocal Rank (MRR) [40 In-Domain] : {mrr_akhir}")
    print(f"2. Latensi Rata-rata (Mean)                  : {latensi_rata} detik")
    print(f"3. Latensi Tercepat (Min)                    : {latensi_min} detik")
    print(f"4. Latensi Terlama (Max)                     : {latensi_max} detik")
    print(f"5. File rekap lengkap tersimpan di           : {nama_file_csv}")
    print("=" * 58)


if __name__ == "__main__":
    jalankan_evaluasi()