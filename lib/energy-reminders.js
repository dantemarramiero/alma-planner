// Alma Energy: promemoria delle scadenze scritte nelle opportunità (data.scadenze: [{ label, date, done }]).
// Arrivano al responsabile dell'opportunità (o a tutti i membri del modulo se non ce l'ha) a 30, 7, 1 e 0 giorni
// e una volta quando la scadenza è passata; ognuno una volta sola. Solo di giorno, come i promemoria dei mezzi.
const { romeNow } = require('./workdays');

const STEPS = [0, 1, 7, 30];
const itDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });

function createEnergyReminders({ db, notifier }) {
  async function once(key) {
    const { rows } = await db.query('INSERT INTO energy_reminder_log (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [key]);
    return Boolean(rows[0]);
  }

  async function memberIds() {
    const { rows } = await db.query('SELECT u.id FROM energy_members m JOIN users u ON lower(u.email) = m.email');
    return rows.map(r => r.id);
  }

  async function remindDeadlines(now = new Date()) {
    const today = romeNow(now).day;
    const { rows } = await db.query(
      `SELECT o.id, o.title, o.owner_id, s->>'label' AS label, s->>'date' AS date
         FROM energy_opportunities o, jsonb_array_elements(COALESCE(o.data->'scadenze', '[]'::jsonb)) s
        WHERE o.stage NOT IN ('perso', 'target') AND s->>'date' ~ '^\\d{4}-\\d{2}-\\d{2}$'
          AND NOT COALESCE((s->>'done')::boolean, false)`);
    let sent = 0;
    let members = null;
    for (const d of rows) {
      const left = Math.round((Date.parse(`${d.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
      let step = null, text = null;
      if (left < 0) {
        step = 'scaduta';
        text = `«${d.label}» di ${d.title} è scaduta il ${itDate(d.date)}.`;
      } else {
        // la soglia più vicina già raggiunta: chi scrive una scadenza a 5 giorni riceve l'avviso dei 7, non anche quello dei 30
        const n = STEPS.find(s => left <= s);
        if (n === undefined) continue;
        step = String(n);
        text = left === 0 ? `«${d.label}» di ${d.title} scade oggi.`
          : `«${d.label}» di ${d.title} scade il ${itDate(d.date)} (tra ${left} ${left === 1 ? 'giorno' : 'giorni'}).`;
      }
      // la chiave contiene etichetta e data: se si sposta la scadenza, i promemoria ripartono
      const key = `en:${d.id}:${d.label.toLowerCase()}:${d.date}:${step}`;
      if (!(await once(key))) continue;
      const to = d.owner_id ? [d.owner_id] : (members ??= await memberIds());
      await notifier.notify({ userIds: to, actorId: null, kind: 'energy', body: text, link: `/energy/opportunita/${d.id}` });
      sent++;
    }
    return sent;
  }

  let running = false;
  async function tick(now = new Date()) {
    if (running) return;
    running = true;
    try {
      const { minute } = romeNow(now);
      if (minute >= 7 * 60 && minute < 20 * 60) await remindDeadlines(now);
    } catch (err) {
      console.warn('[energy] promemoria non riusciti', err.message);
    } finally {
      running = false;
    }
  }
  function start(intervalMs = 5 * 60 * 1000) {
    setTimeout(() => tick(), 60 * 1000).unref();
    return setInterval(() => tick(), intervalMs).unref();
  }

  return { remindDeadlines, tick, start };
}

module.exports = { createEnergyReminders };
