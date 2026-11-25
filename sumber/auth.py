import os
import hmac
import hashlib
import secrets

ITERASI = 200_000

def buat_hash(password, iterasi=ITERASI):
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), iterasi)
    return f"pbkdf2_sha256:{iterasi}:{salt}:{dk.hex()}"

def verifikasi_hash(password, tersimpan):
    try:
        algoritma, iterasi, salt, hash_hex = tersimpan.strip().split(":")
        if algoritma != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterasi))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False

def kredensial_terkonfigurasi():
    return bool(os.getenv("ADMIN_PASSWORD_HASH") or os.getenv("ADMIN_PASSWORD"))

def cek_kredensial(username, password):
    username_benar = os.getenv("ADMIN_USERNAME", "admin")
    cocok_user = hmac.compare_digest((username or "").encode("utf-8"), username_benar.encode("utf-8"))

    hash_tersimpan = os.getenv("ADMIN_PASSWORD_HASH")
    password_polos = os.getenv("ADMIN_PASSWORD")
    if hash_tersimpan:
        cocok_pw = verifikasi_hash(password or "", hash_tersimpan)
    elif password_polos:
        cocok_pw = hmac.compare_digest((password or "").encode("utf-8"), password_polos.encode("utf-8"))
    else:
        cocok_pw = False
    return cocok_user and cocok_pw