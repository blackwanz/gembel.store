#!/bin/bash
# db/restore.sh
#
# Restore dari backup yang dibikin db/backup_daily.sh (gembelsql.daily-*.sql /
# gembelsrc.daily-*.tar) atau dari backup deploy-prod (gembelsql.v*.sql /
# gembelsrc.v*.tar, lihat .github/workflows/main.yml). Semua backup dianggap
# ada di ~/backups (bisa diubah lewat --dir).
#
# Pakai interaktif (nanya apa yang mau di-restore, lalu pilih dari daftar
# backup, urut dari yang paling baru):
#   ./db/restore.sh
#
# Pakai cepat -- langsung ambil backup paling baru tanpa milih dari daftar:
#   ./db/restore.sh --latest --db          # restore database paling baru
#   ./db/restore.sh --latest --source      # restore source code paling baru
#   ./db/restore.sh --latest --all         # restore keduanya
#
# Opsi lain:
#   --dir <path>      Folder tempat backup disimpan (default: ~/backups)
#   --out <path>      Folder tujuan extract source code (default: ./restore_<timestamp>)
#   --yes             Skip konfirmasi (buat non-interaktif / dipanggil dari script lain)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
  set +a
fi

BACKUP_DIR="$HOME/backups"
OUT_DIR=""
MODE=""          # db | source | all
LATEST=false
ASSUME_YES=false

while [ $# -gt 0 ]; do
  case "$1" in
    --latest) LATEST=true ;;
    --db) MODE="db" ;;
    --source) MODE="source" ;;
    --all) MODE="all" ;;
    --dir) BACKUP_DIR="$2"; shift ;;
    --out) OUT_DIR="$2"; shift ;;
    --yes) ASSUME_YES=true ;;
    *) echo "Argumen nggak dikenal: $1"; exit 1 ;;
  esac
  shift
done

confirm() {
  if [ "$ASSUME_YES" == true ]; then return 0; fi
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

# --- 1. Pilih mode kalau belum ditentukan lewat flag ---
if [ -z "$MODE" ]; then
  echo "Mau restore apa?"
  echo "  1) Database saja"
  echo "  2) Source code saja"
  echo "  3) Database + source code"
  read -r -p "Pilih [1-3]: " choice
  case "$choice" in
    1) MODE="db" ;;
    2) MODE="source" ;;
    3) MODE="all" ;;
    *) echo "Pilihan tidak valid."; exit 1 ;;
  esac
fi

# --- 2. Cari daftar backup, urut dari yang paling baru (by mtime) ---
pick_file() {
  local pattern="$1"
  local label="$2"
  local files
  mapfile -t files < <(find "$BACKUP_DIR" -maxdepth 1 -name "$pattern" -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)

  if [ ${#files[@]} -eq 0 ]; then
    echo "Nggak ada file backup $label di $BACKUP_DIR (pola: $pattern)" >&2
    exit 1
  fi

  if [ "$LATEST" == true ]; then
    echo "${files[0]}"
    return
  fi

  echo "=== Backup $label tersedia (paling baru di atas) ===" >&2
  local i=1
  for f in "${files[@]}"; do
    printf "  %2d) %s  (%s)\n" "$i" "$(basename "$f")" "$(date -r "$f" '+%Y-%m-%d %H:%M')" >&2
    i=$((i + 1))
  done
  read -r -p "Pilih nomor [1 = paling baru]: " num
  num="${num:-1}"
  echo "${files[$((num - 1))]}"
}

# --- 3. Restore database ---
restore_db() {
  local sql_file
  sql_file="$(pick_file 'gembelsql.*' database)"
  echo "--- Database dipilih: $(basename "$sql_file") ---"

  : "${SUPABASE_DB_URL:?SUPABASE_DB_URL belum di-set. Taruh di db/.env (lihat db/.env.example).}"

  echo "PERINGATAN: ini akan menjalankan ulang SQL dari backup ke database yang"
  echo "ditunjuk SUPABASE_DB_URL saat ini. Kalau database tujuan sudah ada isinya"
  echo "dan bentrok (misal primary key sama), restore ini bisa gagal di tengah"
  echo "jalan atau duplikat data -- idealnya restore ke database kosong/baru."
  if ! confirm "Lanjut restore database dari $(basename "$sql_file")?"; then
    echo "Dibatalkan."
    return
  fi

  docker run --rm -i postgres:17 psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 < "$sql_file"
  echo "--- Database selesai di-restore ---"
}

# --- 4. Restore source code ---
restore_source() {
  local src_file
  src_file="$(pick_file 'gembelsrc.*' 'source code')"
  echo "--- Source dipilih: $(basename "$src_file") ---"

  local target="${OUT_DIR:-./restore_$(date +%Y%m%d-%H%M%S)}"
  if ! confirm "Extract $(basename "$src_file") ke folder baru '$target'? (nggak akan menimpa apa pun secara langsung)"; then
    echo "Dibatalkan."
    return
  fi

  mkdir -p "$target"
  tar -xf "$src_file" -C "$target"
  echo "--- Source selesai di-extract ke: $target ---"
  echo "    Review dulu isinya, baru copy manual ke /var/www/gembelfun kalau sudah yakin."
}

case "$MODE" in
  db) restore_db ;;
  source) restore_source ;;
  all) restore_db; restore_source ;;
esac
