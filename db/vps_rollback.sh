#!/bin/bash
# db/vps_rollback.sh
#
# Jalankan LANGSUNG DI VPS (bukan dari mesin lokal / GitHub Actions) buat
# rollback instan ke release sebelumnya -- geser symlink /var/www/gembel.store,
# reload nginx. Nggak ada rebuild, nggak ada downtime (nginx reload itu
# graceful).
#
# Pakai:
#   ./db/vps_rollback.sh              # interaktif, pilih dari daftar release (terbaru di atas)
#   ./db/vps_rollback.sh --list       # cuma nampilin daftar release + mana yang aktif sekarang
#   ./db/vps_rollback.sh --previous   # langsung rollback ke release sebelum yang aktif sekarang

set -e

RELEASE_ROOT="/var/www/releases"
LIVE_LINK="/var/www/gembel.store"

CURRENT="$(readlink -f "$LIVE_LINK" 2>/dev/null || true)"

mapfile -t releases < <(find "$RELEASE_ROOT" -maxdepth 1 -mindepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)

if [ ${#releases[@]} -eq 0 ]; then
  echo "Nggak ada release di $RELEASE_ROOT" >&2
  exit 1
fi

print_list() {
  local i=1
  for r in "${releases[@]}"; do
    local marker=""
    [ "$r" == "$CURRENT" ] && marker=" (aktif sekarang)"
    printf "  %2d) %s%s\n" "$i" "$(basename "$r")" "$marker"
    i=$((i + 1))
  done
}

if [ "$1" == "--list" ]; then
  echo "=== Release tersedia (terbaru di atas) ==="
  print_list
  exit 0
fi

TARGET=""

if [ "$1" == "--previous" ]; then
  for i in "${!releases[@]}"; do
    if [ "${releases[$i]}" == "$CURRENT" ]; then
      TARGET="${releases[$((i + 1))]:-}"
      break
    fi
  done
  if [ -z "$TARGET" ]; then
    echo "Nggak nemu release sebelum yang aktif sekarang ($CURRENT)." >&2
    exit 1
  fi
else
  echo "=== Release tersedia (terbaru di atas), aktif sekarang: $(basename "${CURRENT:-?}") ==="
  print_list
  read -r -p "Rollback ke nomor berapa? " num
  TARGET="${releases[$((num - 1))]}"
fi

echo "Rollback: $LIVE_LINK -> $TARGET"
read -r -p "Lanjut? [y/N] " reply
if [[ ! "$reply" =~ ^[Yy]$ ]]; then
  echo "Dibatalkan."
  exit 0
fi

ln -sfn "$TARGET" "$LIVE_LINK"
sudo systemctl reload nginx
echo "Selesai. Live sekarang: $(readlink -f "$LIVE_LINK")"
