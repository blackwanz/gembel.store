#!/bin/bash

# Hentikan skrip jika ada error
set -e

# Ambil pesan commit dari argumen pertama ($1), jika kosong pakai default
COMMIT_MSG="${1:-auto: update on uat}"

echo "=== Memulai proses push dan promote dari UAT ==="

# 1. Pastikan di branch uat dan push perubahan terbaru
git add .
git commit -m "$COMMIT_MSG" || echo "Tidak ada perubahan baru untuk di-commit"
git push origin uat

# 2. Pindah ke PROD dan merge dari uat
echo "=== Merging UAT ke PROD ==="
git checkout prod
git pull origin prod
git merge uat --no-ff -m "merge: promote uat to prod [msg: $COMMIT_MSG]"
git push origin prod

# 3. Kembali ke branch uat
git checkout uat

echo "=== Selesai! UAT berhasil dipromote ke PROD ==="
