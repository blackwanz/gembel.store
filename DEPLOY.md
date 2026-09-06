# Deploy, Backup & Rollback

Ringkasan alur end-to-end. Detail teknis tiap script ada di [db/README.md](db/README.md).

## 1. Promote ke prod (yang biasa kamu jalankan)

```bash
./pushprod.sh "pesan commit"
```

Ini commit & push ke `uat`, merge ke `prod`, push ke `prod`. Push ke `prod` itu yang men-trigger semuanya di bawah — otomatis, gak ada command tambahan yang perlu dijalankan.

## 2. Yang otomatis jalan tiap promote (GitHub Actions)

Push ke branch `prod` men-trigger `.github/workflows/main.yml` (job `deploy-prod`), urutannya:

1. **Backup dulu** — `pg_dump` database + `tar` source code (versi *sebelum* perubahan baru ini masuk), dikirim ke VPS di `/home/irwanto/backups/`. File-nya: `gembelsql.v<tanggal>-<hash>.sql` dan `gembelsrc.v<tanggal>-<hash>.tar`.
2. **Deploy** — kode baru di-rsync ke folder baru `/var/www/releases/<timestamp>/`, lalu symlink `/var/www/gembel.store` digeser ke situ, nginx di-reload.
3. **Bersih-bersih** — release lama dihapus, disisakan 5 yang terakhir.

Kamu nggak perlu jalanin `pg_dump` manual buat ini — **selama promote-nya lewat push ke `prod`, backup selalu otomatis jalan duluan sebelum kode baru live.**

## 3. Backup manual / on-demand (command, di luar siklus promote)

Kalau mau backup DB kapan aja tanpa nunggu promote (misal sebelum jalanin migration manual atau eksperimen data):

```bash
# Dari laptop / mesin manapun yang ada Docker
export SUPABASE_DB_URL="postgresql://...."
docker run --rm postgres:17 pg_dump "$SUPABASE_DB_URL" > backup-manual-$(date +%Y%m%d-%H%M%S).sql
```

```bash
# Di VPS (native pg_dump, gak pakai Docker)
pg_dump "$SUPABASE_DB_URL" > backup-manual-$(date +%Y%m%d-%H%M%S).sql
```

## 4. Backup harian otomatis (independen dari promote)

Kalau suatu hari nggak ada promote sama sekali, tetap ada backup — `db/backup_daily.sh` jalan via cron di VPS tiap jam 03:00, sekali setup gak perlu disentuh lagi. Setup & detail: [db/README.md § Daily backup on the VPS](db/README.md).

## 5. Rollback (kalau salah promote)

Langsung di VPS, gak perlu rebuild/redeploy apa pun — tinggal geser symlink balik ke release sebelumnya:

```bash
./db/vps_rollback.sh            # interaktif, pilih dari daftar
./db/vps_rollback.sh --previous # langsung ke release sebelum yang aktif
./db/vps_rollback.sh --list     # cuma lihat daftar release, gak ngapa-ngapain
```

## 6. Restore dari backup file (kalau butuh data lama / kode lama)

```bash
./db/restore.sh --latest --db       # restore database dari backup DB paling baru
./db/restore.sh --latest --source   # extract source code paling baru ke folder baru
./db/restore.sh                     # interaktif, pilih dari daftar backup
```

Detail & peringatan (restore DB itu destructive, extract source **tidak** langsung menimpa live folder): [db/README.md](db/README.md).

## Ringkasan: apa yang otomatis, apa yang manual

| Kejadian | Otomatis? | Trigger |
|---|---|---|
| Backup DB + source sebelum deploy | ✅ Otomatis | Push ke branch `prod` (`pushprod.sh`) |
| Deploy ke release folder + symlink swap | ✅ Otomatis | Push ke branch `prod` |
| Backup harian | ✅ Otomatis (setelah setup cron sekali) | Cron VPS jam 03:00 |
| Backup on-demand | ❌ Manual | Command `pg_dump` di atas |
| Rollback | ❌ Manual (harus kamu putuskan) | `db/vps_rollback.sh` di VPS |
| Restore dari file backup | ❌ Manual (harus kamu putuskan) | `db/restore.sh` |
