#!/bin/bash

# Hentikan skrip jika ada error
set -e

# Ambil pesan commit dari argumen pertama ($1), jika kosong pakai default
COMMIT_MSG="${1:-auto: update on dev}"

echo "=== Memulai proses push dan promote dari DEV ==="

# 1. Pastikan di branch dev dan push perubahan terbaru
git checkout dev
git add .
git commit -m "$COMMIT_MSG" || echo "Tidak ada perubahan baru untuk di-commit"
git push origin dev

# 2. Pindah ke UAT dan merge dari dev
echo "=== Merging DEV ke UAT ==="
git pull origin uat
git merge dev --no-ff -m "merge: promote dev to uat [msg: $COMMIT_MSG]"
git push origin uat

# 3. Kembali ke branch dev
git checkout dev

echo "=== Selesai! DEV berhasil dipromote ke UAT ==="
