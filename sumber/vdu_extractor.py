"""
Modul Ekstraksi Visual Document Understanding (VDU) menggunakan GPT-4o-mini Vision
untuk Dokumen Layanan Informasi Periklanan dan Sirkulasi.
"""
import os
import base64
from openai import OpenAI
from dotenv import load_dotenv

# Memuat variabel lingkungan dari file .env
load_dotenv()

# Inisialisasi Klien OpenAI menggunakan API Key
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def extract_text_from_image(image_path):
    """
    Fungsi utama VDU menggunakan API OpenAI (GPT-4o-mini)
    """
    if not os.path.exists(image_path):
        return f"Error: Gambar tidak ditemukan di {image_path}"

    try:
        # Membaca gambar dan mengonversinya ke format Base64
        with open(image_path, "rb") as image_file:
            base64_image = base64.b64encode(image_file.read()).decode('utf-8')
        
        # Prompt ketat untuk VDU
        prompt_text = """
        Anda adalah sistem Visual Document Understanding (VDU) yang bertugas mengekstrak informasi dari dokumen layanan informasi periklanan, daftar tarif iklan (rate card), syarat administrasi pemasangan, dan tarif sirkulasi/berlangganan media cetak.
        Tugas Anda:
1. Ekstrak seluruh teks dan angka dari gambar ini dengan presisi absolut.
2. Pertahankan kesadaran tata letak (layout-awareness). Jika data berupa tabel atau matriks harga, Anda WAJIB memformatnya menggunakan tabel Markdown agar kolom dan baris tidak rusak atau bergeser.
3. Terapkan zero-hallucination: Jangan mengarang angka atau teks yang tidak ada di dalam gambar.
        """
        
        # Mengirim gambar dan prompt menggunakan model gpt-4o-mini
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text", 
                            "text": prompt_text
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=1500,
            temperature=0.0
        )
        
        return response.choices[0].message.content
        
    except Exception as e:
        return f"Terjadi kesalahan saat memproses API OpenAI: {str(e)}"

# ==========================================
# BLOK PENGUJIAN LOKAL
# ==========================================
if __name__ == "__main__":
    daftar_gambar = [
        "data/images/1.png",
        "data/images/2.png",
        "data/images/3.png"
    ]
    
    for target_gambar in daftar_gambar:
        print(f"\nMemulai ekstraksi VDU, model GPT-4o-mini sedang membaca gambar {target_gambar}...")
        hasil_ekstraksi = extract_text_from_image(target_gambar)
        
        print(f"\n=== HASIL EKSTRAKSI TATA LETAK: {target_gambar} ===")
        print(hasil_ekstraksi)
        print("========================================================\n")