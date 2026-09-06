# Database migrations

Version-controlled schema for the Supabase project backing gembel.fun. Requires only Docker (already used by the deploy pipeline) — no local `psql` or Supabase CLI install needed.

## Setup

```bash
export SUPABASE_DB_URL="postgresql://postgres:<password>@<host>:5432/postgres"
```

Use the same connection string as the `SUPABASE_DB_URL` GitHub secret already used for prod backups (`.github/workflows/main.yml`). Get it from Supabase dashboard → Project Settings → Database → Connection string (URI, direct connection, not the pooler).

## Apply pending migrations

```bash
./db/migrate.sh
```

Runs every file in `db/migrations/*.sql` that isn't yet recorded in `public._migrations`, in filename order. Safe to run repeatedly — already-applied files are skipped.

```bash
./db/migrate.sh --status   # just show what's applied vs pending, don't run anything
```

### Or from GitHub Actions

The "Run DB Migrations" workflow (`.github/workflows/migrate.yml`) runs the same script on demand — go to Actions → Run DB Migrations → Run workflow, type `yes` in the confirm field. It's `workflow_dispatch`-only, so it never fires on a push; this is the same effect as running `./db/migrate.sh` locally, just without needing `SUPABASE_DB_URL` on your own machine (it's already stored as a repo secret for the backup step in `main.yml`).

## Deploy & rollback (release folder + symlink)

Prod is a static site, so `.github/workflows/main.yml` deploys by rsyncing each push into a fresh timestamped folder under `/var/www/releases/`, then swapping the `/var/www/gembel.store` symlink to it and reloading nginx. The last 5 releases are kept, so rollback is instant — just re-point the symlink, no rebuild.

**One-time setup on the VPS** (do this before the first deploy from the new workflow runs):

```bash
sudo mkdir -p /var/www/releases

# Preserve whatever's live right now as the first release, then symlink to it
sudo mv /var/www/gembel.store /var/www/releases/manual-$(date +%Y%m%d-%H%M%S)
sudo ln -s /var/www/releases/manual-* /var/www/gembel.store

# The deploy user (VPS_USER secret) needs write access to /var/www/releases
# and permission to re-create the /var/www/gembel.store symlink, plus
# passwordless sudo for `systemctl reload nginx` (same as it already needed
# for the old sed-based nginx switch).
sudo chown -R "$USER" /var/www/releases /var/www/gembel.store
```

**Rollback**, run directly on the VPS:

```bash
./db/vps_rollback.sh            # interactive: pick a release from the list
./db/vps_rollback.sh --list     # show releases + which one is live
./db/vps_rollback.sh --previous # jump straight to the one before the current release
```

## Daily backup on the VPS

Besides the backup GitHub Actions already makes every time `prod` is promoted (see `deploy-prod` in `.github/workflows/main.yml`, which runs on the GitHub-hosted runner using Docker), `db/backup_daily.sh` runs independently on the VPS via cron so there's still a fresh backup on days with no promote. It dumps the database (native `pg_dump`, since Docker isn't installed on the VPS — the database itself is remote on Supabase, so only the client is needed) and tars the source code into `~/backups/`, then deletes daily backups older than 14 days (edit `RETENTION_DAYS` in the script to change that).

Setup (on the VPS, one time):

```bash
# 1. Install the pg_dump client (no local Postgres server or Docker needed)
sudo apt-get update && sudo apt-get install -y postgresql-client

# 2. Put the DB connection string in db/.env (gitignored, same file migrate.sh uses)
cp db/.env.example db/.env
nano db/.env   # fill in SUPABASE_DB_URL

# 3. Make it executable
chmod +x db/backup_daily.sh

# 4. Add to crontab -- runs daily at 03:00
crontab -e
```

Add this line (adjust the path if the live checkout isn't at `/var/www/gembel.store`):

```
0 3 * * * /var/www/gembel.store/db/backup_daily.sh >> /home/irwanto/backups/backup.log 2>&1
```

## One-time data backfill

After `0002_calendar.sql` has been applied and **before** deploying the rewritten `calendar.html`, copy existing users' goals/progress out of the old `user_calendar_data` blob table into the new normalized tables:

```bash
docker run --rm -i postgres:17 psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f db/backfill_calendar.sql
```

Safe to re-run — it skips any user who already has rows in `calendar_goals`.

## Adding a new app's tables

1. Add `db/migrations/000N_<app>.sql` (see `0002_calendar.sql` / `0003_habbit.sql` for the pattern: `user_id uuid references auth.users`, RLS enabled with `auth.uid() = user_id` policies, ends with `insert into public._migrations (filename) values ('000N_<app>.sql') on conflict (filename) do nothing;`, all wrapped in `begin;`/`commit;`).
2. Run `./db/migrate.sh`.
3. Add the app's tile to `assets/apps.config.js`.
