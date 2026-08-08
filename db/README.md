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
