import getpass
from auth import buat_hash

def main():
    password = getpass.getpass("Password admin baru: ")
    ulang = getpass.getpass("Ulangi password: ")
    if password != ulang:
        print("Password tidak sama. Jalankan ulang skrip ini.")
        return
    if len(password) < 8:
        print("Password minimal 8 karakter. Jalankan ulang skrip ini.")
        return
    print("\nTambahkan baris berikut ke file .env:\n")
    print(f"ADMIN_PASSWORD_HASH={buat_hash(password)}")

if __name__ == "__main__":
    main()