// Banco di prova di Alma (21/11/2026, board V5-Impostazioni): Impostazioni → Alma → «Esegui».
// Un giro fa le 60 domande di lib/assistente-banco.js ad Alma con la sessione dell'amministratore che lo lancia (stessi
// permessi), tre alla volta, in sottofondo; la pagina legge l'avanzamento. Ogni domanda va in una conversazione sua che
// poi si cancella con le sue proposte (nessuna si conferma) e la sua traccia, così «Risposte» e statistiche restano
// quelle vere; il costo resta in assistant_usage perché è speso davvero.
// La quota per persona al giorno non vale per il banco (un giro costa 1–2 €); quella del mese sì.

const { HttpError } = require('../lib/http');
const BANCO = require('../lib/assistente-banco');

const PARALLEL = 3;

function registerBanco(app, base, { db, chat, getter, ctxOf, adminOnly, settings, configured }) {
  let running = null; // id del giro in corso (un giro alla volta)

  // Un giro rimasto «in corso» da un riavvio del server non finirà più.
  const ready = db.query("UPDATE assistant_bench_runs SET status = 'interrotto', finished_at = now(), error = COALESCE(error, 'Il server si è riavviato durante il giro') WHERE status = 'in_corso'")
    .catch(() => {});

  const view = r => r && ({
    id: r.id, status: r.status, total: r.total, done: r.done, passed: r.passed, skipped: r.skipped, invented: r.invented,
    proposals_ok: r.proposals_ok, proposals_n: r.proposals_n, cost_usd: Number(r.cost_usd) || 0, error: r.error,
    started_at: r.started_at, finished_at: r.finished_at, user_name: r.user_name,
    score: r.total - r.skipped > 0 ? Math.round((1000 * r.passed) / (r.total - r.skipped)) / 10 : null,
  });

  async function oneQuestion(req, port, q) {
    const breq = Object.assign(Object.create(req), { body: { text: q.testo }, bench: true, socket: { localPort: port } });
    const t0 = Date.now();
    let r = null, error = null;
    try { r = await chat(breq); } catch (e) { error = e; }
    const convId = r && r.conversation_id;
    let unverified = 0, cost = 0, kinds = [];
    if (convId) {
      if (r.trace_id) unverified = Number((await db.query('SELECT numbers_unverified FROM assistant_traces WHERE id = $1', [r.trace_id])).rows[0]?.numbers_unverified) || 0;
      cost = Number((await db.query('SELECT COALESCE(SUM(cost_usd), 0) AS c FROM assistant_usage WHERE conversation_id = $1', [convId])).rows[0].c) || 0;
      kinds = (await db.query("SELECT DISTINCT kind FROM assistant_actions WHERE conversation_id = $1 AND status <> 'superata'", [convId])).rows.map(x => x.kind);
      await db.query('DELETE FROM assistant_traces WHERE conversation_id = $1', [convId]);
      await db.query('DELETE FROM assistant_conversations WHERE id = $1', [convId]); // messaggi e proposte vanno via con lei
    }
    const g = BANCO.grade(q.attesi, { reply: r ? r.reply : '', proposte: kinds, non_verificati: unverified, error: error && (error.message || String(error)) });
    return { id: q.id, area: q.area, testo: q.testo, ok: g.ok, note: g.note, risposta: String((r && r.reply) || '').slice(0, 600), invented: unverified,
      proposta: q.attesi.proposta || null, secondi: Math.round((Date.now() - t0) / 100) / 10, cost_usd: cost, stop: error && error.status === 429 ? error.message : null };
  }

  async function runBench(req, runId) {
    const port = req.socket.localPort;
    const details = [];
    const save = async (final = null) => {
      const done = details.filter(d => !d.saltata);
      const props = done.filter(d => d.proposta);
      await db.query(`UPDATE assistant_bench_runs SET done = $2, passed = $3, invented = $4, proposals_ok = $5, proposals_n = $6, cost_usd = $7, details = $8
        ${final ? ", status = $9, finished_at = now(), error = $10" : ''} WHERE id = $1`,
      [runId, details.length, done.filter(d => d.ok).length, done.reduce((a, d) => a + (d.invented || 0), 0), props.filter(d => d.ok).length, props.length,
        done.reduce((a, d) => a + (d.cost_usd || 0), 0), JSON.stringify([...details].sort((a, b) => a.id - b.id)), ...(final ? [final.status, final.error || null] : [])]);
    };
    try {
      const breq = Object.assign(Object.create(req), { bench: true, socket: { localPort: port } });
      const qs = await BANCO.prepare(getter(breq), ctxOf(breq));
      const skipped = qs.filter(x => x.saltata);
      await db.query('UPDATE assistant_bench_runs SET total = $2, skipped = $3 WHERE id = $1', [runId, qs.length, skipped.length]);
      for (const x of skipped) details.push({ id: x.id, area: x.area, saltata: x.saltata });
      const todo = qs.filter(x => !x.saltata);
      let next = 0, stop = null;
      const worker = async () => {
        while (!stop && next < todo.length) {
          const q = todo[next++];
          const d = await oneQuestion(req, port, q);
          if (d.stop) stop = d.stop;
          delete d.stop;
          details.push(d);
          await save();
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      await save(stop ? { status: 'interrotto', error: stop } : { status: 'finito' });
    } catch (e) {
      console.error('[alma banco]', e);
      await save({ status: 'interrotto', error: String(e.message || e).slice(0, 300) }).catch(() => {});
    } finally { running = null; }
  }

  app.get(`${base}/banco`, async (req, res) => {
    adminOnly(req);
    await ready;
    const { rows } = await db.query(`SELECT r.*, u.name AS user_name FROM assistant_bench_runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 10`);
    const last = rows[0] || null;
    const prev = rows.find(r => r.id !== last?.id && r.status === 'finito') || null;
    res.json({ domande: BANCO.QUESTIONS.length, giri: rows.map(view), ultimo: last ? { ...view(last), details: last.details } : null,
      precedente: prev ? { ...view(prev), esiti: Object.fromEntries((prev.details || []).filter(d => !d.saltata).map(d => [d.id, d.ok])) } : null });
  });

  app.post(`${base}/banco/esegui`, async (req, res) => {
    adminOnly(req);
    await ready;
    if (running) throw new HttpError(409, 'C\'è già un giro del banco di prova in corso.');
    if (!configured()) throw new HttpError(503, 'Alma è spenta: manca la chiave OPENAI_API_KEY su Railway.');
    if (!(await settings()).enabled) throw new HttpError(403, 'Alma è spenta. Si accende qui sopra.');
    const { rows: [r] } = await db.query('INSERT INTO assistant_bench_runs (user_id, total) VALUES ($1, $2) RETURNING id', [req.user.id, BANCO.QUESTIONS.length]);
    running = r.id;
    runBench(req, r.id);
    res.status(202).json({ id: r.id });
  });

  return { isRunning: () => running, wait: async () => { while (running) await new Promise(ok => setTimeout(ok, 20)); } }; // wait: solo per i test
}

module.exports = { registerBanco };
