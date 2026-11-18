// Alma: proposte da confermare, «Cambia», scelta tra omonimi e «Annulla» (porting delle bozze di Bacco).
// - Più cose insieme: le proposte «proponi_…» della stessa risposta hanno lo stesso batch_id e arrivano in una sola scheda.
// - Cambia: request = i dati chiesti da Alma. Il pulsante Cambia (POST /azioni/:id/modifica, solo i campi di EDIT) o la
//   correzione scritta («la scadenza è lunedì» → strumento modifica_proposta) rifanno l'anteprima sulla stessa proposta.
// - Omonimi: se preview() lancia un errore con .choices la proposta nasce come scelta «Quale …?»; non si conferma finché
//   l'utente non sceglie (tocco, «la seconda», strumento scegli_opzione). Alma non sceglie mai da sola.
// - Annulla: per UNDO_MS dal salvataggio quello che Alma ha salvato si toglie davvero, con le API di sempre.
// Niente viene scritto senza una conferma: propose/edit/choose leggono soltanto.

const { splitName } = require('./crm-nomi');
const UNDO_MS = 10 * 60 * 1000;
const MAX_GROUP = 5;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Campi che il pulsante Cambia rende modificabili (chiave dell'input dello strumento, etichetta, tipo).
const EDIT = {
  proponi_ticket: [{ key: 'titolo', label: 'Ticket', type: 'text' }, { key: 'assegnati', label: 'A chi', type: 'people' }, { key: 'progetto', label: 'Progetto', type: 'text' },
    { key: 'scadenza', label: 'Scadenza', type: 'date' }, { key: 'priorita', label: 'Priorità', type: 'enum', options: ['bassa', 'normale', 'alta', 'urgente'] },
    { key: 'descrizione', label: 'Dettagli', type: 'textarea' }],
  proponi_nota_crm: [{ key: 'testo', label: 'Nota', type: 'textarea' }, { key: 'titolo', label: 'Titolo', type: 'text' },
    { key: 'tipo', label: 'Tipo', type: 'enum', options: ['nota', 'telefonata', 'riunione', 'decisione'] }, { key: 'data', label: 'Data', type: 'date' }],
  proponi_passo: [{ key: 'cosa', label: 'Cosa', type: 'text' }, { key: 'entro', label: 'Entro', type: 'date' }, { key: 'chi', label: 'Chi', type: 'text' },
    { key: 'canale', label: 'Canale', type: 'enum', options: ['telefonata', 'email', 'incontro', 'sopralluogo', 'altro'] }],
  // contatto facile (v8): il nome detto tutto insieme si mostra già diviso, per correggerlo con un tocco
  proponi_contatto_crm: [{ key: 'titolo', label: 'Titolo', type: 'text', get: r => splitName(r.nome_completo).title }, { key: 'nome', label: 'Nome', type: 'text', get: r => (r.cognome ? '' : splitName(r.nome_completo).first) },
    { key: 'cognome', label: 'Cognome', type: 'text', get: r => splitName(r.nome_completo).last }, { key: 'azienda', label: 'Azienda', type: 'text' },
    { key: 'qualifica', label: 'Qualifica', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }, { key: 'cellulare', label: 'Cellulare', type: 'text' }, { key: 'telefono', label: 'Telefono', type: 'text' },
    { key: 'nota', label: 'Nota', type: 'textarea' }, { key: 'bu', label: 'ASA della nuova azienda', type: 'text' }],
  proponi_biglietto: [{ key: 'titolo', label: 'Titolo', type: 'text' }, { key: 'nome', label: 'Nome', type: 'text' }, { key: 'cognome', label: 'Cognome', type: 'text' },
    { key: 'azienda', label: 'Azienda', type: 'text' }, { key: 'qualifica', label: 'Qualifica', type: 'text' }, { key: 'email', label: 'Email', type: 'text' },
    { key: 'cellulare', label: 'Cellulare', type: 'text' }, { key: 'telefono', label: 'Telefono', type: 'text' }, { key: 'nota', label: 'Nota', type: 'textarea' }],
  // email: oggetto e testo si cambiano qui solo per l'email singola; «escludi» lo usano le spunte del gruppo (nascosto nel modulo)
  proponi_email: [{ key: 'oggetto', label: 'Oggetto', type: 'text', get: r => r.email?.[0]?.oggetto }, { key: 'testo', label: 'Testo', type: 'textarea', get: r => r.email?.[0]?.testo },
    { key: 'quando', label: 'Quando (AAAA-MM-GG HH:MM, vuoto = subito)', type: 'text' }, { key: 'escludi', label: 'Togli', type: 'array', hidden: true }],
};

// «la seconda», «2», «quella di Pescara» → indice dell'opzione, oppure null se non è chiaro.
const ORD = { prima: 1, primo: 1, uno: 1, seconda: 2, secondo: 2, due: 2, terza: 3, terzo: 3, tre: 3, quarta: 4, quarto: 4, quattro: 4, quinta: 5, quinto: 5, cinque: 5, sesta: 6, sesto: 6 };
function pickFrom(text, options) {
  const words = norm(text).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || words.length > 8) return null;
  const n = words.map(w => (/^\d$/.test(w) ? Number(w) : ORD[w])).find(Boolean);
  if (n && options[n - 1]) return n - 1;
  const hits = new Set();
  for (const w of words.filter(x => x.length >= 4)) {
    const idx = options.map((o, i) => (norm(`${o.label} ${o.sub || ''}`).split(/[^a-z0-9]+/).includes(w) ? i : -1)).filter(i => i >= 0);
    if (idx.length === 1) hits.add(idx[0]);
  }
  return hits.size === 1 ? [...hits][0] : null;
}
const UNDO_TEXT = /^\s*(annulla|disfa|cancella|torna indietro)(\s+(tutto|tutte|quello|quella|quelle|quanto fatto|il salvataggio|l'ultim[ao]|l'ultima cosa))?[\s.!]*$/i;

module.exports = function bozze({ db, ACTIONS, HttpError, getter, caller, ctxOf, audit, proposalView, proposalExpired, execRow, note }) {
  const rowById = async id => (await db.query('SELECT * FROM assistant_actions WHERE id = $1', [Number(id)])).rows[0];
  const groupRows = async row => (row.batch_id ? (await db.query('SELECT * FROM assistant_actions WHERE batch_id = $1 ORDER BY id', [row.batch_id])).rows : [row]);
  const views = async rows => (await Promise.all(rows.map(async r => proposalView(await rowById(r.id))))).filter(Boolean);
  const actionOf = row => ACTIONS.find(a => a.name === row.kind);
  const pendingChoice = row => !!(row.preview || {}).choices;
  // Una scheda modificata o scelta è di nuovo «quella della risposta subito prima»: le si rinnova l'ora.
  const touch = row => db.query("UPDATE assistant_actions SET created_at = now() WHERE status = 'proposta' AND (id = $1 OR (batch_id IS NOT NULL AND batch_id = $2))", [row.id, row.batch_id || -1]);

  // Campi in più per la chat (proposalView): gruppo, campi modificabili, scelta, cambiati, annulla.
  function extras(row) {
    const p = row.preview || {}, req = row.request, res = row.result;
    const open = row.status === 'proposta';
    const until = row.status === 'fatta' && !row.undone_at && res && res.undo && row.done_at ? new Date(row.done_at).getTime() + UNDO_MS : 0;
    const show = (f, v) => (v == null ? '' : f.type === 'people' && Array.isArray(v) ? v.join(', ') : String(v));
    return {
      batch: row.batch_id || null,
      ...(row.undone_at ? { status: 'disfatta', undone_at: row.undone_at } : {}),
      edit: open && req && !p.choices ? (EDIT[row.kind] || []).map(({ get, ...f }) => ({ ...f, value: show(f, req[f.key] ?? (get ? get(req) : undefined)) })) : [],
      ...(p.items ? { items: p.items } : {}),
      choices: open && p.choices ? { question: p.choices.question, options: p.choices.options.map(o => ({ label: o.label, sub: o.sub || '' })) } : null,
      changed: open ? p.changed || [] : [],
      undo_until: until > Date.now() ? new Date(until).toISOString() : null,
      undo_error: row.undo_error || null,
    };
  }
  async function toChoice(row, input, e, chosen = null) {
    const c = e.choices;
    await db.query('UPDATE assistant_actions SET input = $2, preview = $3, request = $4 WHERE id = $1', [row.id, '{}',
      JSON.stringify({ title: c.question, fields: [], warnings: [], choices: { question: c.question, options: c.options }, ...(chosen ? { chosen } : {}) }), JSON.stringify(input)]);
    await touch(row);
    return rowById(row.id);
  }

  // Prepara una proposta (niente scrittura). group = { id, size } condiviso dalle proposte della stessa risposta.
  async function propose(req, convId, action, input, group = null) {
    let pv = null, choices = null;
    try { pv = await action.preview(input || {}, getter(req), ctxOf(req)); } catch (e) {
      if (!e.choices) return { out: { error: e.message || 'Proposta non valida.' } };
      choices = e.choices;
    }
    if (group && group.size >= MAX_GROUP) return { out: { error: `Al massimo ${MAX_GROUP} cose in una scheda: fai confermare queste, poi prepara le altre.` } };
    // Una risposta nuova sostituisce le proposte ancora aperte delle risposte di prima (non quelle del suo gruppo).
    await db.query("UPDATE assistant_actions SET status = 'superata', done_at = now() WHERE conversation_id = $1 AND status = 'proposta' AND (batch_id IS NULL OR batch_id <> $2)",
      [convId, group && group.id ? group.id : -1]);
    const preview = choices ? { title: choices.question, fields: [], warnings: [], choices } : { title: pv.title, fields: pv.fields, warnings: pv.warnings, ...(pv.items ? { items: pv.items } : {}) };
    const { rows: [r] } = await db.query(`INSERT INTO assistant_actions (conversation_id, user_id, kind, input, preview, status, batch_id, request)
      VALUES ($1, $2, $3, $4, $5, 'proposta', $6, $7) RETURNING id`, [convId, req.user.id, action.name, JSON.stringify(choices ? {} : pv.data || {}), JSON.stringify(preview),
      group && group.id ? group.id : null, JSON.stringify(input || {})]);
    const id = r.id;
    if (group) {
      if (!group.id) { group.id = id; await db.query('UPDATE assistant_actions SET batch_id = $1 WHERE id = $1', [id]); }
      group.size = (group.size || 0) + 1;
    }
    if (choices) {
      return { id, out: { proposta_id: id, stato: 'serve la scelta dell\'utente', domanda: choices.question,
        opzioni: choices.options.map((o, i) => `${i + 1}) ${o.label}${o.sub ? ` · ${o.sub}` : ''}`),
        istruzioni: 'L\'utente vede le opzioni e tocca quella giusta, oppure la scrive («la seconda»). Chiedi quale in una frase: NON scegliere tu. Se te lo scrive usa «scegli_opzione».' } };
    }
    return { id, out: { proposta_id: id, stato: 'in attesa della conferma dell\'utente', scheda: { titolo: pv.title, campi: pv.fields, avvisi: pv.warnings },
      istruzioni: `L'utente vede questa scheda con Conferma, Cambia e Annulla (può anche rispondere «sì» o «no»).${group && group.size > 1 ? ' Le proposte di questa risposta stanno in una sola scheda.' : ''} Non dire che è fatto: riassumi in una frase e, se ci sono avvisi, dilli.` } };
  }

  // Valori dal pulsante Cambia (stringhe) → input dello strumento.
  function cleanPatch(row, campi, onlyEditable) {
    const action = actionOf(row);
    const types = Object.fromEntries((EDIT[row.kind] || []).map(f => [f.key, f.type]));
    const allowed = onlyEditable ? Object.keys(types) : Object.keys(action?.input_schema?.properties || {});
    const out = {};
    for (const [k, raw] of Object.entries(campi && typeof campi === 'object' ? campi : {})) {
      if (!allowed.includes(k)) continue;
      const type = types[k] || action.input_schema.properties[k]?.type;
      let v = raw;
      if (typeof v === 'string') v = v.trim();
      if (v === '' || v == null) { out[k] = undefined; continue; }
      if (type === 'people' || type === 'array') v = Array.isArray(v) ? v.map(String) : String(v).split(/\s*(?:,|;|\be\b)\s*/i).map(s => s.trim()).filter(Boolean);
      else if (type === 'integer' || type === 'number') { v = Number(v); if (!Number.isFinite(v)) throw new HttpError(400, `«${k}» deve essere un numero.`); }
      else if (typeof v !== 'string') v = String(v);
      if (typeof v === 'string') v = v.slice(0, 4000);
      out[k] = v;
    }
    if (!Object.keys(out).length) throw new HttpError(400, 'Niente da cambiare.');
    return out;
  }

  async function ownOpen(req, id, convId = null) {
    const row = await rowById(id);
    if (!row || row.user_id !== req.user.id || (convId && row.conversation_id !== convId)) throw new HttpError(404, 'Proposta non trovata.');
    if (row.status !== 'proposta') throw new HttpError(409, row.status === 'fatta' ? 'Già fatto.' : 'Questa proposta non è più valida: chiedi ad Alma di rifarla.');
    if (proposalExpired(row)) throw new HttpError(409, 'Questa proposta è scaduta: chiedi ad Alma di rifarla.');
    return row;
  }

  async function edit(req, row, campi, onlyEditable = true) {
    if (pendingChoice(row)) throw new HttpError(409, 'Prima scegli quale.');
    const base = row.request;
    if (!base) throw new HttpError(409, 'Questa proposta non si può cambiare: chiedi ad Alma di rifarla.');
    const input = { ...base, ...cleanPatch(row, campi, onlyEditable) };
    for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k];
    let pv;
    try { pv = await actionOf(row).preview(input, getter(req), ctxOf(req)); } catch (e) {
      if (e.choices) return toChoice(row, input, e);
      throw new HttpError(400, e.message || 'Dati non validi.');
    }
    const old = row.preview || {};
    const before = new Map((old.fields || []).map(([k, v]) => [k, v]));
    const prev = new Map((old.changed || []).map(c => [c.label, c.before]));
    const changed = pv.fields.map(([k, v]) => {
      const orig = prev.has(k) ? prev.get(k) : before.get(k);
      return orig !== undefined && orig !== v ? { label: k, before: orig } : null;
    }).filter(Boolean);
    await db.query('UPDATE assistant_actions SET input = $2, preview = $3, request = $4 WHERE id = $1',
      [row.id, JSON.stringify(pv.data || {}), JSON.stringify({ title: pv.title, fields: pv.fields, warnings: pv.warnings, changed, ...(pv.items ? { items: pv.items } : {}) }), JSON.stringify(input)]);
    await touch(row);
    return rowById(row.id);
  }

  async function choose(req, row, index) {
    const p = row.preview || {};
    if (!p.choices) throw new HttpError(409, 'Qui non c\'è niente da scegliere.');
    const o = p.choices.options[Number(index)];
    if (!o) throw new HttpError(400, 'Scelta non valida.');
    const input = { ...(row.request || {}), ...o.input };
    let pv;
    try { pv = await actionOf(row).preview(input, getter(req), ctxOf(req)); } catch (e) {
      if (e.choices) return toChoice(row, input, e, o.label); // dopo la persona, il progetto (più scelte in fila)
      throw new HttpError(400, e.message || 'Dati non validi.');
    }
    await db.query('UPDATE assistant_actions SET input = $2, preview = $3, request = $4 WHERE id = $1',
      [row.id, JSON.stringify(pv.data || {}), JSON.stringify({ title: pv.title, fields: pv.fields, warnings: pv.warnings, chosen: o.label, ...(pv.items ? { items: pv.items } : {}) }), JSON.stringify(input)]);
    await touch(row);
    return rowById(row.id);
  }

  // Conferma (o annulla) le voci aperte di un gruppo: okIds = quelle scelte; le altre si annullano.
  async function settleGroup(req, rows, okIds) {
    const open = rows.filter(r => r.status === 'proposta');
    if (!open.length) throw new HttpError(409, 'Questa scheda non è più aperta.');
    const ok = new Set(okIds == null ? open.map(r => r.id) : okIds.map(Number));
    if (open.some(r => ok.has(r.id) && pendingChoice(r))) throw new HttpError(409, 'Prima scegli quale, poi conferma.');
    for (const r of open) {
      if (proposalExpired(r) && ok.has(r.id)) throw new HttpError(409, 'Questa scheda è scaduta: chiedi ad Alma di rifarla.');
    }
    for (const r of open) await execRow(req, r, ok.has(r.id));
    const after = await Promise.all(open.map(r => rowById(r.id)));
    const done = after.filter(r => r.status === 'fatta'), failed = after.filter(r => r.status === 'errore');
    const line = r => `${r.result.message}${r.result.link ? ` [Apri](${r.result.link})` : ''}`;
    let reply;
    if (!ok.size || (!done.length && !failed.length)) reply = 'Va bene, non ho salvato niente.';
    else if (after.length === 1) reply = done.length ? `Fatto: ${line(done[0])}.` : `Non è stato salvato: ${failed[0].error}`;
    else reply = `${done.length ? `Fatto: ${done.length === 1 ? 'salvata 1 cosa' : `salvate ${done.length} cose`}` : 'Niente salvato'}${failed.length ? `, ${failed.length} non salvate` : ''}.\n`
      + [...done.map(r => `- ${line(r)}`), ...failed.map(r => `- Non salvato (${(r.preview || {}).title}): ${r.error}`)].join('\n');
    await note(open[0].conversation_id, `[Sistema] L'utente ha ${ok.size ? `confermato le proposte ${[...ok].join(', ')}` : 'annullato la scheda'}. Esito: ${reply}`, reply);
    return { reply, proposals: await views(rows) };
  }

  // Annulla quello che Alma ha appena salvato (entro UNDO_MS).
  async function undoRows(req, rows) {
    const todo = rows.filter(r => r.status === 'fatta' && !r.undone_at && actionOf(r)?.undo && (r.result || {}).undo);
    if (!todo.length) throw new HttpError(409, 'Qui non c\'è niente da annullare.');
    const tooOld = r => Date.now() - new Date(r.done_at).getTime() > UNDO_MS;
    if (todo.every(tooOld)) throw new HttpError(409, 'Sono passati più di 10 minuti: toglilo dalla sua pagina.');
    const ok = [], ko = [];
    for (const r of todo) {
      if (tooOld(r)) { ko.push(`${(r.preview || {}).title}: passati più di 10 minuti`); continue; }
      try {
        await actionOf(r).undo(r.result.undo, caller(req));
        await db.query('UPDATE assistant_actions SET undone_at = now(), undo_error = NULL WHERE id = $1', [r.id]);
        audit?.log(req.user.id, 'alma.annullata', { action: r.id, kind: r.kind });
        ok.push(r);
      } catch (e) {
        await db.query('UPDATE assistant_actions SET undo_error = $2 WHERE id = $1', [r.id, String(e.message || e)]);
        ko.push(`${(r.preview || {}).title}: ${e.message}`);
      }
    }
    const reply = `${ok.length ? `Annullato: ${ok.length === 1 ? 'ho tolto quello che avevo salvato' : `ho tolto le ${ok.length} cose che avevo salvato`}.` : 'Non ho annullato niente.'}${ko.length ? ` Non annullato: ${ko.join('; ')}.` : ''}`;
    await note(todo[0].conversation_id, `[Sistema] L'utente ha annullato dopo il salvataggio le proposte ${todo.map(r => r.id).join(', ')}. Esito: ${reply}`, reply);
    return { reply, proposals: await views(rows) };
  }
  async function lastUndoable(convId) {
    const { rows: [r] } = await db.query("SELECT * FROM assistant_actions WHERE conversation_id = $1 AND status = 'fatta' AND undone_at IS NULL ORDER BY done_at DESC, id DESC LIMIT 1", [convId]);
    return r && Date.now() - new Date(r.done_at).getTime() <= UNDO_MS ? (await groupRows(r)).filter(x => x.status === 'fatta') : null;
  }

  // Risposte brevi senza chiamare Claude: «sì»/«no» su tutta la scheda, «la seconda» su una scelta, «annulla» dopo il
  // salvataggio. null = non è una risposta breve.
  async function quick(req, convId, open, text, { YES, NO }) {
    if (open) {
      const rows = (await groupRows(open)).filter(r => r.status === 'proposta');
      const choosing = rows.find(pendingChoice);
      if (choosing) {
        const i = pickFrom(text, choosing.preview.choices.options);
        if (i != null) {
          const r = await choose(req, choosing, i);
          const reply = r.preview.choices ? r.preview.choices.question : `Ok, ${r.preview.chosen}. Ecco la proposta: confermi?`;
          await note(convId, `[Sistema] L'utente ha scelto l'opzione ${i + 1} della proposta ${r.id}.`, reply);
          return { reply, proposals: await views(await groupRows(r)) };
        }
        if (YES.test(text)) {
          const reply = `Prima dimmi quale: ${choosing.preview.choices.question}`;
          await note(convId, "[Sistema] L'utente ha detto sì, ma deve ancora scegliere tra gli omonimi.", reply);
          await touch(choosing);
          return { reply, proposals: await views(await groupRows(open)) };
        }
      }
      if (YES.test(text) || NO.test(text)) return settleGroup(req, await groupRows(open), YES.test(text) ? null : []);
      return null;
    }
    if (UNDO_TEXT.test(text)) { const rows = await lastUndoable(convId); if (rows) return undoRows(req, rows); }
    return null;
  }

  // Strumenti per Claude: correggere una proposta aperta e scegliere tra omonimi.
  const TOOLS = [
    { name: 'modifica_proposta', label: 'Cambio la proposta', bozza: true,
      description: 'Cambia uno o più campi di una proposta ancora aperta, quando l\'utente corregge («la scadenza è lunedì», «assegnalo a Giulia», «priorità alta»). campi = i nomi dei parametri dello strumento «proponi_…» che l\'aveva preparata, con i valori nuovi (date AAAA-MM-GG). Non scrive niente: la scheda si aggiorna e serve ancora la conferma.',
      input_schema: { type: 'object', additionalProperties: false, properties: { proposta_id: { type: 'integer', description: 'Id della proposta (se manca: l\'ultima aperta).' }, campi: { type: 'object', description: 'Campi da cambiare.' } }, required: ['campi'] } },
    { name: 'scegli_opzione', label: 'Scelta tra omonimi', bozza: true,
      description: 'Registra la scelta dell\'utente tra gli omonimi di una proposta («la seconda», «quella di Pescara»). Solo con quello che ha detto l\'utente: non scegliere mai tu.',
      input_schema: { type: 'object', additionalProperties: false, properties: { proposta_id: { type: 'integer', description: 'Id della proposta (se manca: l\'ultima aperta).' }, numero: { type: 'integer', description: 'Numero dell\'opzione, da 1.' } }, required: ['numero'] } },
  ];
  async function runTool(req, convId, name, input = {}) {
    try {
      const openRows = (await db.query("SELECT * FROM assistant_actions WHERE conversation_id = $1 AND status = 'proposta' ORDER BY id DESC", [convId])).rows;
      const target = input.proposta_id ? await rowById(input.proposta_id) : name === 'scegli_opzione' ? openRows.find(pendingChoice) || openRows[0] : openRows[0];
      if (!target) return { out: { error: 'Non c\'è nessuna proposta aperta.' } };
      const row = await ownOpen(req, target.id, convId);
      const r = name === 'modifica_proposta' ? await edit(req, row, input.campi, false) : await choose(req, row, Number(input.numero) - 1);
      const v = await proposalView(r);
      return { proposals: [v], out: { proposta_id: r.id, stato: 'in attesa della conferma dell\'utente', scheda: { titolo: v.title, campi: v.fields, avvisi: v.warnings },
        cambiati: (v.changed || []).map(c => c.label), istruzioni: 'La scheda è aggiornata. Dì in una frase cosa è cambiato e chiedi conferma: non è ancora salvato.' } };
    } catch (e) { return { out: { error: e.message || 'Non riuscito.' } }; }
  }

  function routes(app, base, { enabledCheck, guard }) {
    const own = async req => {
      const row = await rowById(req.params.id);
      if (!row || row.user_id !== req.user.id) throw new HttpError(404, 'Proposta non trovata.');
      return row;
    };
    const ownGroup = async req => {
      const { rows } = await db.query('SELECT * FROM assistant_actions WHERE batch_id = $1 ORDER BY id', [Number(req.params.batch)]);
      if (!rows.length || rows.some(x => x.user_id !== req.user.id)) throw new HttpError(404, 'Scheda non trovata.');
      return rows;
    };
    const json = fn => async (req, res) => { await guard(req); res.json(await fn(req)); };
    app.post(`${base}/azioni/:id/modifica`, json(async req => ({ proposal: await proposalView(await edit(req, await ownOpen(req, req.params.id), req.body?.campi, true)) })));
    app.post(`${base}/azioni/:id/scegli`, json(async req => {
      const row = await choose(req, await ownOpen(req, req.params.id), Number(req.body?.indice));
      const reply = row.preview.choices ? row.preview.choices.question : `Ok, ${row.preview.chosen}. Ecco la proposta: confermi?`;
      await note(row.conversation_id, `[Sistema] L'utente ha scelto «${row.preview.chosen}» per la proposta ${row.id}.`, reply);
      return { reply, proposals: await views(await groupRows(row)) };
    }));
    // { solo: true }: solo questa proposta (Conferma/Salta su un biglietto); senza, tutta la scheda («Conferma tutti»).
    const rowsOf = async req => { const row = await own(req); return req.body?.solo ? [row] : groupRows(row); };
    app.post(`${base}/azioni/:id/conferma`, json(async req => { await enabledCheck(); return settleGroup(req, await rowsOf(req), null); }));
    app.post(`${base}/azioni/:id/annulla`, json(async req => settleGroup(req, await rowsOf(req), [])));
    app.post(`${base}/azioni/:id/disfa`, json(async req => undoRows(req, await groupRows(await own(req)))));
  }

  return { UNDO_MS, MAX_GROUP, EDIT, extras, propose, edit, choose, settleGroup, undoRows, quick, TOOLS, runTool, groupRows, routes, pickFrom };
};
module.exports.pickFrom = pickFrom;
module.exports.UNDO_MS = UNDO_MS;
