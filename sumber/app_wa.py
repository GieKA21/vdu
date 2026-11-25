import os
import requests
from flask import Flask, request, jsonify
from dotenv import load_dotenv

from rag_engine import tanya_asisten

load_dotenv()

app = Flask(__name__)

# Token sekarang dibaca dari .env (lebih aman)
FONNTE_TOKEN = os.getenv("FONNTE_TOKEN")

def kirim_pesan_fonnte(nomor_tujuan, teks_pesan):
    url = "https://api.fonnte.com/send"
    headers = {"Authorization": FONNTE_TOKEN}
    payload = {"target": nomor_tujuan, "message": teks_pesan}
    try:
        requests.post(url, headers=headers, data=payload)
    except Exception as e:
        print("Gagal kirim:", e)

@app.route('/webhook', methods=['POST', 'GET'])
def webhook_fonnte():
    # 1. Tangani ketukan pintu (verifikasi GET) dari Fonnte
    if request.method == 'GET':
        return jsonify({"status": "Webhook aktif dan siap!"}), 200

    # 2. Tangani pesan WhatsApp masuk (POST)
    try:
        data = request.json if request.is_json else request.form
        pengirim = data.get('sender')
        pesan_masuk = data.get('message')
        
        if not pengirim or not pesan_masuk:
            return jsonify({"status": "diabaikan"}), 200

        print(f"[Pesan Masuk] {pengirim}: {pesan_masuk}")
        
        # Masuk ke otak RAG dengan penanda kanal WhatsApp
        jawaban_ai, _ = tanya_asisten(pesan_masuk, kanal="whatsapp")
        
        # Balas ke WA
        kirim_pesan_fonnte(pengirim, jawaban_ai)
        print(f"[Pesan Keluar] Sukses dikirim ke {pengirim}")
        
        return jsonify({"status": "sukses"}), 200
    except Exception as e:
        print("Error Webhook:", e)
        return jsonify({"status": "error"}), 500

if __name__ == '__main__':
    app.run(port=5000)