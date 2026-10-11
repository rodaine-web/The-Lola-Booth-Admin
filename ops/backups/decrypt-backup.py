"""Offline recovery: python decrypt-backup.py PRIVATE_PEM MANIFEST_JSON OUTPUT_DUMP.
Download the matching dump.gcm/key.rsa beside the manifest first. Requires cryptography.
"""
import sys, pathlib, json, hashlib, base64, os
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

os.umask(0o077)
private_path, manifest_path, output_path = map(pathlib.Path, sys.argv[1:])
assert not output_path.exists(), 'Recovery output already exists; choose a fresh path'
manifest=json.loads(manifest_path.read_text())
assert manifest['format']=='lola-postgresql-aes256gcm-rsaoaep-sha256-v1'
private=serialization.load_pem_private_key(private_path.read_bytes(),password=None)
public=private.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
assert hashlib.sha256(public).hexdigest()==manifest['publicKeySha256'], 'Wrong recovery key'
stem=str(manifest_path).removesuffix('.manifest.json')
ciphertext=pathlib.Path(stem+'.dump.gcm').read_bytes()
assert hashlib.sha256(ciphertext).hexdigest()==manifest['ciphertextSha256']
key=private.decrypt(pathlib.Path(stem+'.key.rsa').read_bytes(),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
decryptor=Cipher(algorithms.AES(key),modes.GCM(base64.b64decode(manifest['nonce']),base64.b64decode(manifest['tag']))).decryptor()
decryptor.authenticate_additional_data(manifest['aad'].encode())
plaintext=decryptor.update(ciphertext)+decryptor.finalize()
assert len(plaintext)==manifest['bytes'] and hashlib.sha256(plaintext).hexdigest()==manifest['plaintextSha256']
with output_path.open('xb') as output: output.write(plaintext)
print('Authenticated backup decrypted. Restore into an isolated PostgreSQL 18 database and verify manifest table counts.')
