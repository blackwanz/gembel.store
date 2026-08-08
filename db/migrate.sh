#!/bin/bash
# db/migrate.sh
#
# Menjalankan semua file di db/migrations/*.sql yang belum tercatat di
# tabel public._migrations, secara berurutan (urut nama file). Pakai image
# postgres:17 yang sama seperti langkah backup di .github/workflows/main.yml,
# jadi nggak butuh psql/Supabase CLI terinstall lokal -- cuma Docker.
#
# Pakai:
#   export SUPABASE_DB_URL="postgresql://user:pass@host:5432/postgres"
#   ./db/migrate.sh            # apply semua migrasi yang belum jalan
#   ./db/migrate.sh --status   # cuma nampilin migrasi mana yang udah/belum jalan, gak apply apa-apa

set -e

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL belum di-set. Contoh: export SUPABASE_DB_URL='postgresql://user:pass@host:5432/postgres'}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"
LOCK_KEY=847362910  # arbitrary fixed advisory-lock key, unique to this script

psql_run() {
  docker run --rm -i postgres:17 psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 "$@"
}

echo "=== db/migrate.sh: memeriksa migrasi ==="

# 0001_init.sql (create table if not exists + insert ... on conflict do
# nothing) is idempotent by design, so it's always safe to run first,
# unconditionally -- this guarantees _migrations exists before we query it.
psql_run -f "$MIGRATIONS_DIR/0001_init.sql" > /dev/null

APPLIED="$(psql_run -Atqc "select filename from public._migrations order by filename;")"

STATUS_ONLY=false
if [ "$1" == "--status" ]; then STATUS_ONLY=true; fi

PENDING=()
for file in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$file")"
  if grep -qx "$name" <<< "$APPLIED"; then
    echo "  [sudah jalan] $name"
  else
    echo "  [belum jalan] $name"
    PENDING+=("$file")
  fi
done

if [ "$STATUS_ONLY" == true ]; then
  exit 0
fi

if [ ${#PENDING[@]} -eq 0 ]; then
  echo "=== Semua migrasi sudah jalan, nggak ada yang perlu di-apply. ==="
  exit 0
fi

echo "=== Menjalankan ${#PENDING[@]} migrasi baru ==="
for file in "${PENDING[@]}"; do
  name="$(basename "$file")"
  echo "--- Applying $name ---"
  # Advisory lock dipegang sepanjang satu koneksi psql ini (mulai dari
  # sebelum file-nya sendiri buka transaksi 'begin;', sampai setelah
  # 'commit;'-nya), jadi dua proses migrate.sh yang jalan bareng nggak akan
  # nge-apply file yang sama secara bersamaan.
  (
    echo "select pg_advisory_lock($LOCK_KEY);"
    cat "$file"
    echo "select pg_advisory_unlock($LOCK_KEY);"
  ) | psql_run
  echo "--- $name selesai ---"
done

echo "=== Semua migrasi selesai di-apply. ==="
