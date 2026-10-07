// Accesso al database: Postgres (DATABASE_URL, su Railway) oppure PGlite in locale e nei test.
// Entrambi espongono query(sql, params) → { rows }, exec(sql) per più istruzioni e tx(fn) per le transazioni.
const fs = require('fs');
const path = require('path');

async function createDb({ url, dataDir } = {}) {
  if (url) {
    const { Pool, types } = require('pg');
    types.setTypeParser(1082, s => s); // DATE come 'YYYY-MM-DD', non come Date a mezzanotte locale
    const pool = new Pool({
      connectionString: url,
      ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX || 10),
    });
    return {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params),
      exec: sql => pool.query(sql),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (sql, params) => client.query(sql, params) });
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  let PGlite, types;
  try {
    ({ PGlite, types } = await import('@electric-sql/pglite'));
  } catch {
    throw new Error('DATABASE_URL non impostata e PGlite non installato: in produzione collega il Postgres di Railway.');
  }
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite({ dataDir, parsers: { [types.DATE]: s => s } });
  return {
    kind: 'pglite',
    query: (sql, params) => pg.query(sql, params),
    exec: sql => pg.exec(sql),
    tx: fn => pg.transaction(t => fn({ query: (sql, params) => t.query(sql, params) })),
    close: () => pg.close(),
  };
}

// Applica in ordine i file migrations/NNN_*.sql non ancora eseguiti, ognuno nella sua transazione.
async function migrate(db, dir = path.join(__dirname, '..', 'migrations')) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  const files = fs.readdirSync(dir).filter(f => /^\d+_[\w-]+\.sql$/.test(f)).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations (name) VALUES ('${file}');\nCOMMIT;`);
    console.log(`[db] migrazione applicata: ${file}`);
  }
}

module.exports = { createDb, migrate };
