import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")

if ENCRYPTION_KEY:
    cipher_suite = Fernet(ENCRYPTION_KEY.encode('utf-8'))
else:
    cipher_suite = None
    print("WARNING: ENCRYPTION_KEY not found in environment. OpenAI API keys will not be encrypted.")

def encrypt_api_key(plain_key: str) -> str:
    if not plain_key or not cipher_suite:
        return plain_key
    try:
        return cipher_suite.encrypt(plain_key.encode('utf-8')).decode('utf-8')
    except Exception as e:
        print(f"Encryption error: {e}")
        return plain_key

def decrypt_api_key(cipher_text: str) -> str:
    if not cipher_text or not cipher_suite:
        return cipher_text
    try:
        return cipher_suite.decrypt(cipher_text.encode('utf-8')).decode('utf-8')
    except Exception:
        # If decryption fails (e.g. key was stored prior to encryption or wrong secret), return the raw string
        return cipher_text
