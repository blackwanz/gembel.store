#!/bin/bash
# db/backup_daily.sh
#
# Cron job harian di VPS: pg_dump database + tar source code, simpan di
# ~/backups/ dengan nama bertanggal, lalu hapus backup yang lebih tua dari
# RETENTION_DAYS. Ini backup independen dari yang dibikin GitHub Actions
# pas promote ke prod (lihat .github/workflows/main.yml) -- tujuannya biar
# tetap ada backup harian walau nggak ada promote hari itu.
#
# Beda dari backup di GitHub Actions: itu jalan di GitHub-hosted runner yang
# sudah ada Docker, jadi pakai `docker run postgres:17 pg_dump`. Di VPS
# Docker belum ke-install, jadi script ini pakai `pg_dump` native dari paket
# postgresql-client -- database-nya sendiri tetap di Supabase (remote), jadi
# nggak butuh server Postgres lokal, cuma butuh client-nya buat konek.
#
# Setup di VPS (satu kali):
#   1) Install pg_dump native (versi client nggak harus persis sama dengan
#      versi server Supabase -- pg_dump kompatibel mundur ke server lebih
#      baru):
#        sudo apt-get update && sudo apt-get install -y postgresql-client
#   2) Taruh SUPABASE_DB_URL di db/.env (lihat db/.env.example), sama
#      seperti yang dipakai db/migrate.sh -- gitignored, gak ke-commit.
#   3) chmod +x db/backup_daily.sh
#   4) Tambahkan ke crontab (jalan tiap hari jam 03:00):
#        crontab -e
#        0 3 * * * /var/www/gembel.store/db/backup_daily.sh >> /home/irwanto/backups/backup.log 2>&1

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$HOME/backups"
RETENTION_DAYS=14

if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
  set +a
fi

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL belum di-set. Taruh di db/.env (lihat db/.env.example).}"
command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump nggak ketemu. Install dulu: sudo apt-get install -y postgresql-client" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
SQL_FILE="$BACKUP_DIR/gembelsql.daily-$STAMP.sql"
SRC_FILE="$BACKUP_DIR/gembelsrc.daily-$STAMP.tar"

echo "=== [$STAMP] Backup harian dimulai ==="

echo "--- Dumping database ---"
pg_dump "$SUPABASE_DB_URL" > "$SQL_FILE"

echo "--- Archiving source code ---"
tar -cf "$SRC_FILE" -C "$PROJECT_DIR" --exclude=./backups --exclude=.git .

echo "--- Menghapus backup harian lebih tua dari $RETENTION_DAYS hari ---"
find "$BACKUP_DIR" -maxdepth 1 -name 'gembelsql.daily-*.sql' -mtime "+$RETENTION_DAYS" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'gembelsrc.daily-*.tar' -mtime "+$RETENTION_DAYS" -print -delete

echo "=== [$STAMP] Backup harian selesai: $SQL_FILE, $SRC_FILE ==="
