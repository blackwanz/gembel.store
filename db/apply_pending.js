// db/apply_pending.js
//
// Node stand-in for db/migrate.sh when Docker isn't installed (uses the vendored `pg` package).
// Applies every db/migrations/*.sql not yet recorded in public._migrations, in filename order,
// each in its own transaction.
//
// Also handles files that were applied by hand long ago but never recorded (0002-0010): their
// tables already exist, so re-running them failed on "policy ... already exists". Every
// `create policy X on T` gets a `drop policy if exists X on T` in front; everything else in those
// files is already if-not-exists / on-conflict-do-nothing.
//
//   node db/apply_pending.js --dry   # run everything, then ROLLBACK -- shows what would fail
//   node db/apply_pending.js         # apply for real, stops at the first failure
//
// Reads SUPABASE_DB_URL from the environment or db/.env.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DIR = path.join(__dirname, 'migrations');
const DRY = process.argv.includes('--dry');

function dbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const env = path.join(__dirname, '.env');
  const m = fs.existsSync(env) && fs.readFileSync(env, 'utf8').match(/^\s*SUPABASE_DB_URL\s*=\s*(.*)$/m);
  if (!m) { console.error('SUPABASE_DB_URL belum di-set (export, atau isi db/.env).'); process.exit(1); }
  return m[1].trim();
}

function prep(sql) {
  return sql
    .replace(/^\s*begin\s*;\s*$/gim, '')
    .replace(/^\s*commit\s*;\s*$/gim, '')
    .replace(/create policy\s+("?\w+"?)\s+on\s+([\w."]+)/gi, (m, p, t) => `drop policy if exists ${p} on ${t};\n${m}`);
}

(async () => {
  const c = new Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  let failed = false;
  try {
    await c.query(fs.readFileSync(path.join(DIR, '0001_init.sql'), 'utf8'));
    const applied = new Set((await c.query('select filename from public._migrations')).rows.map(r => r.filename));
    const pending = fs.readdirSync(DIR).filter(f => f.endsWith('.sql') && !applied.has(f)).sort();
    if (!pending.length) { console.log('Semua migrasi sudah jalan.'); return; }
    for (const f of pending) {
      await c.query('begin');
      try {
        await c.query(prep(fs.readFileSync(path.join(DIR, f), 'utf8')));
        await c.query('insert into public._migrations (filename) values ($1) on conflict (filename) do nothing', [f]);
        await c.query(DRY ? 'rollback' : 'commit');
        console.log(DRY ? '  OK (dry)' : '  APPLIED ', f);
      } catch (e) {
        await c.query('rollback');
        console.log('  FAIL    ', f, '->', e.message);
        failed = true;
        if (!DRY) break;
      }
    }
  } finally {
    await c.end();
  }
  if (failed) process.exit(1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
