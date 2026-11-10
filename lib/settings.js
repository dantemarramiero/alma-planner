// Impostazioni di Alma Planet in una sola tabella (settings), con il modulo davanti alla chiave:
// «software.it_department», «energy.screening», «planet.<chiave>»… Il valore è JSON.

async function getSetting(db, key, fallback = null) {
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : fallback;
}

// Tutte le impostazioni di un modulo, con chi le ha cambiate e quando; le chiavi senza il prefisso.
async function getSettings(db, module, keys) {
  const { rows } = await db.query(
    `SELECT substr(s.key, length($1) + 2) AS key, s.value, s.updated_at, u.name AS updated_by_name
       FROM settings s LEFT JOIN users u ON u.id = s.updated_by
      WHERE s.key = ANY($2::text[])`, [module, keys.map(k => `${module}.${k}`)]);
  return rows;
}

async function saveSetting(q, key, value, userId = null) {
  await q.query(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId]);
}

// Registro «già mandato» (send_log): true la prima volta per quella chiave, false se c'era già.
// Prefissi: «ticket:» solleciti, «fleet:» promemoria dei mezzi, «energy:» promemoria di Alma Energy.
async function markSent(db, key) {
  const { rows } = await db.query('INSERT INTO send_log (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [key]);
  return rows.length > 0;
}

module.exports = { getSetting, getSettings, saveSetting, markSent };
