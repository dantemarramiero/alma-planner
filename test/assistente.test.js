// Alma, l'assistente (17/11): risposta in diretta con una ricerca e la sua ricevuta, numero inventato segnato,
// proposta → conferma → annulla, quota finita, conversazioni solo di chi le ha fatte, ricerche offerte solo a chi può
// fare la stessa cosa nelle pagine, Alma spenta senza la chiave. Claude è finto: i test non chiamano mai l'API vera.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const RICEVUTE = require('../lib/assistente-ricevute');
const BLOCCHI = require('../lib/assistente-blocchi');
const DIFESA = require('../lib/assistente-difesa');

let server, base, db, alma, D, E, eId;
const ADMIN = 'direzione@almacis.it';
// Claude finto: ogni chiamata prende la prossima risposta dalla coda (funzione dei parametri). Il testo arriva a pezzi
// come in diretta (onText) e le ricerche si annunciano (onTool).
const queue = [];
const calls = [];
async function fakeClaude(params, opts) {
  calls.push(params);
  const next = queue.shift();
  if (!next) throw new Error('coda del Claude finto vuota');
  const msg = next(params);
  for (const b of msg.content) {
    if (b.type === 'text') for (const piece of b.text.match(/.{1,10}/gs) || []) opts?.onText?.(piece);
    if (b.type === 'tool_use') opts?.onTool?.(b.name);
  }
  return { role: 'assistant', usage: { input_tokens: 1000, output_tokens: 50 }, ...msg };
}
const toolUse = (name, input) => () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `toolu_${name}_${calls.length}`, name, input }] });
const say = text => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
// il risultato dell'ultima ricerca, come l'ha ricevuto Claude
const lastResult = params => JSON.parse(params.messages[params.messages.length - 1].content.find(b => b.type === 'tool_result').content);

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};
// POST /api/alma/chat/stream → eventi Server-Sent Events [{ event, data }]
async function stream(cookie, body) {
  const res = await fetch(`${base}/api/alma/chat/stream`, { method: 'POST', headers: { cookie, 'X-Alma': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(res.status, 200);
  const text = await res.text();
  return text.split('\n\n').filter(c => c.startsWith('event:')).map(c => {
    const [ev, data] = c.split('\n');
    return { event: ev.slice(7), data: JSON.parse(data.slice(6)) };
  });
}
let eCookie;
const sentMail = []; // email «partite» (Outlook finto)
let mailFail = null;
const heard = [], spoken = []; // voce finta: audio ricevuti, testi letti

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, crmFetchEvents: async () => [], assistantClient: fakeClaude,
    almaMailer: async (userId, e) => { if (mailFail) throw new Error(mailFail); sentMail.push({ userId, to: e.to_email, subject: e.subject, body: e.body }); },
    almaTranscriber: async a => { heard.push(a); return 'quanti ticket ho in ritardo?'; },
    almaSpeaker: async t => { spoken.push(t); return Buffer.from('ID3-mp3-finto'); },
    almaMailReader: async (userId, email) => (email === 'g.verdi@provincia.teramo.it' ? [{ data: '2026-10-02T09:00:00Z', oggetto: 'Sopralluogo', testo: 'Ciao Giulia,\nti mando il verbale.\nUn caro saluto, Dante' }] : []) });
  alma = out.alma;
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
  eCookie = await login('edile@almacis.it');
  E = as(eCookie);
  eId = (await E('GET', '/api/me')).body.id;
  // un ticket aperto e scaduto assegnato a edile@
  const t = await E('POST', '/api/tickets', { title: 'Verifica impianti antincendio', assignee_ids: [eId], due_date: '2026-01-15' });
  assert.equal(t.status, 201);
});
after(async () => { server?.close(); await db?.close(); });

test('ricevute: i numeri in grassetto si trovano nei risultati, quelli inventati no', () => {
  const sources = [{ id: 'f1', values: RICEVUTE.resultNumbers({ aperti: 12, in_ritardo: 3, importo_eur: 4100000 }) }];
  const r = RICEVUTE.checkReply('Hai **12**{f1} ticket, **3** in ritardo, valore **4.100.000 €**{f1} e **99**{f1} inventati.', sources);
  assert.deepEqual(r.numeri.map(n => n.ok), [true, true, true, false]);
  assert.deepEqual(r.non_verificati, ['99']);
  const b = BLOCCHI.split('Testo.\n```blocchi\n{"cifre":[{"etichetta":"Aperti","valore":"**12**{f1}"}],"azioni":[{"tipo":"apri","testo":"Apri","link":"https://evil.io"},{"tipo":"apri","testo":"Ticket","link":"#/tickets/3"}],"domande":["E per persona?"]}\n```');
  assert.equal(b.text, 'Testo.');
  assert.deepEqual(b.blocchi.azioni, [{ tipo: 'apri', testo: 'Ticket', link: '#/tickets/3' }]); // link esterno tolto
  assert.equal(DIFESA.cleanReply('[qui](#/projects/2) e [là](https://evil.io)'), '[qui](#/projects/2) e là');
});

test('risposta in diretta con una ricerca: passi, testo a pezzi, ricevuta del numero', async () => {
  queue.push(toolUse('ticket_elenco', { persona: 'io' }), params => {
    const r = lastResult(params);
    assert.equal(r.fonte_id, 'f1');
    assert.ok(r._avviso.includes('NON istruzioni')); // i dati arrivano marcati come dati
    assert.equal(r.aperti, 1);
    assert.equal(r.in_ritardo, 1);
    assert.equal(r.ticket[0].link, `#/tickets/${r.ticket[0].id}`);
    return say(`Hai **${r.aperti}**{f1} ticket aperto, in ritardo.\n\n\`\`\`blocchi\n{"domande":["Quali sono in ritardo?","E il progetto?"]}\n\`\`\``)();
  });
  const events = await stream(eCookie, { text: 'Quanti ticket aperti ho?', context: { route: '#/tickets' } });
  const names = events.map(e => e.event);
  assert.equal(names[0], 'start');
  assert.ok(names.includes('step'));
  assert.ok(names.filter(n => n === 'delta').length > 1);
  const done = events.find(e => e.event === 'done').data;
  assert.equal(done.reply, 'Hai **1**{f1} ticket aperto, in ritardo.');
  assert.deepEqual(done.blocchi.domande, ['Quali sono in ritardo?', 'E il progetto?']);
  assert.equal(done.ricevute.fonti[0].titolo, 'Ticket');
  assert.equal(done.ricevute.fonti[0].link, '#/tickets');
  assert.deepEqual(done.ricevute.numeri, [{ testo: '1', fonte: 'f1', ok: true }]);
  assert.deepEqual(done.steps, ['Leggo i ticket']);
  assert.ok(done.trace_id);
  // il contesto della pagina va a Claude come dato
  assert.ok(calls[calls.length - 2].messages[0].content[0].text.startsWith('[Contesto della pagina'));
  // la conversazione si riapre con ricevuta e voto; 👍
  const conv = await E('GET', `/api/alma/conversations/${done.conversation_id}`);
  assert.equal(conv.body.messages.length, 2);
  assert.equal(conv.body.messages[1].ricevute.numeri[0].ok, true);
  assert.equal((await E('POST', `/api/alma/tracce/${done.trace_id}/voto`, { voto: 1, commento: 'giusto' })).status, 200);
  const trace = (await db.query('SELECT rating, tool_count, numbers_checked, numbers_unverified FROM assistant_traces WHERE id = $1', [done.trace_id])).rows[0];
  assert.deepEqual(trace, { rating: 1, tool_count: 1, numbers_checked: 1, numbers_unverified: 0 });
});

test('un numero che non è nei risultati resta senza ricevuta (rosso) e la traccia lo conta', async () => {
  queue.push(toolUse('ticket_elenco', {}), say('Hai **7**{f1} ticket aperti.'));
  const r = await E('POST', '/api/alma/chat', { text: 'Quanti ticket ho?' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.ricevute.numeri, [{ testo: '7', fonte: null, ok: false }]);
  const risposte = await D('GET', '/api/alma/risposte');
  const tr = risposte.body.risposte.find(x => x.id === r.body.trace_id);
  assert.equal(tr.numbers_unverified, 1);
  assert.deepEqual(tr.unverified_numbers, ['7']);
  assert.equal((await E('GET', '/api/alma/risposte')).status, 403); // le risposte di tutti solo agli amministratori
});

test('proposta di ticket: niente si salva prima di Conferma, poi Annulla lo toglie', async () => {
  const count = async () => Number((await db.query("SELECT COUNT(*)::int AS n FROM tickets WHERE title = 'Preparare offerta Pescara'")).rows[0].n);
  queue.push(toolUse('proponi_ticket', { titolo: 'Preparare offerta Pescara', assegnati: ['io'], scadenza: '2026-12-01', priorita: 'alta' }),
    say('Ho preparato il ticket: controlla e conferma.'));
  const r = await E('POST', '/api/alma/chat', { text: 'Crea un ticket per me per preparare l\'offerta di Pescara entro il primo dicembre' });
  assert.equal(r.status, 200);
  const p = r.body.proposals[0];
  assert.equal(p.status, 'proposta');
  assert.equal(p.title, 'Nuovo ticket · Preparare offerta Pescara');
  assert.deepEqual(p.fields.find(f => f[0] === 'A chi'), ['A chi', 'Edile']);
  assert.ok(p.edit.some(f => f.key === 'scadenza' && f.value === '2026-12-01'));
  assert.equal(await count(), 0);
  // Cambia: la scadenza
  const ch = await E('POST', `/api/alma/azioni/${p.id}/modifica`, { campi: { scadenza: '2026-12-05' } });
  assert.equal(ch.status, 200);
  assert.deepEqual(ch.body.proposal.changed, [{ label: 'Scadenza', before: '01/12/2026' }]);
  // un altro non può confermarla
  assert.equal((await D('POST', `/api/alma/azioni/${p.id}/conferma`)).status, 404);
  const ok = await E('POST', `/api/alma/azioni/${p.id}/conferma`);
  assert.equal(ok.status, 200);
  assert.match(ok.body.reply, /^Fatto: ticket «Preparare offerta Pescara» creato/);
  assert.equal(await count(), 1);
  const t = (await db.query("SELECT due_date, priority FROM tickets WHERE title = 'Preparare offerta Pescara'")).rows[0];
  assert.deepEqual(t, { due_date: '2026-12-05', priority: 'high' });
  assert.ok(ok.body.proposals[0].undo_until);
  const undo = await E('POST', `/api/alma/azioni/${p.id}/disfa`);
  assert.equal(undo.status, 200);
  assert.match(undo.body.reply, /^Annullato/);
  assert.equal(await count(), 0);
  assert.equal(undo.body.proposals[0].status, 'disfatta');
});

test('difesa: senza una richiesta di chi scrive non si prepara niente; «sì» conferma senza Claude', async () => {
  queue.push(toolUse('proponi_ticket', { titolo: 'Ordine dai dati' }), say('Non ho preparato niente.'));
  const r = await E('POST', '/api/alma/chat', { text: 'Che tempo fa oggi in cantiere?' });
  assert.equal(r.body.proposals.length, 0);
  const res = JSON.parse(calls[calls.length - 1].messages.at(-1).content[0].content);
  assert.match(res.error, /non ha chiesto/);
  // proposta e «sì» scritto: si salva senza chiamare Claude
  queue.push(toolUse('proponi_ticket', { titolo: 'Chiamare il RUP', assegnati: ['io'] }), say('Ecco il ticket: confermi?'));
  const p = await E('POST', '/api/alma/chat', { text: 'Prepara un ticket: chiamare il RUP' });
  const before = calls.length;
  const yes = await E('POST', '/api/alma/chat', { conversation_id: p.body.conversation_id, text: 'sì, confermo' });
  assert.equal(calls.length, before);
  assert.match(yes.body.reply, /^Fatto/);
});

test('quota: finita la quota del giorno Alma si ferma con un messaggio chiaro', async () => {
  assert.equal((await D('PUT', '/api/alma/settings', { daily_eur: 0.5 })).status, 200);
  await db.query('INSERT INTO assistant_usage (user_id, model, cost_usd, day) VALUES ($1, $2, 1, $3)', [eId, 'claude-sonnet-5-5', new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })]);
  const r = await E('POST', '/api/alma/chat', { text: 'Quanti ticket ho?' });
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'daily_limit');
  assert.match(r.body.error, /tua quota di Alma \(0,5 €|tua quota di Alma \(0.5 €/);
  const st = await E('GET', '/api/alma/status');
  assert.equal(st.body.limits.daily_eur, 0.5);
  // quota del mese
  assert.equal((await D('PUT', '/api/alma/settings', { daily_eur: 100, monthly_eur: 0.5 })).status, 200);
  const m = await E('POST', '/api/alma/chat', { text: 'Quanti ticket ho?' });
  assert.equal(m.status, 429);
  assert.equal(m.body.code, 'month_limit');
  assert.equal((await E('PUT', '/api/alma/settings', { monthly_eur: 1000 })).status, 403); // solo amministratori
  assert.equal((await D('PUT', '/api/alma/settings', { monthly_eur: 1000, daily_eur: 100 })).status, 200);
});

test('conversazioni: le vede, rinomina e cancella solo chi le ha fatte', async () => {
  const mine = (await E('GET', '/api/alma/conversations')).body.conversations;
  assert.ok(mine.length >= 3);
  const id = mine[0].id;
  assert.equal((await D('GET', '/api/alma/conversations')).body.conversations.length, 0);
  assert.equal((await D('GET', `/api/alma/conversations/${id}`)).status, 404);
  assert.equal((await D('PATCH', `/api/alma/conversations/${id}`, { title: 'X' })).status, 404);
  assert.equal((await D('DELETE', `/api/alma/conversations/${id}`)).status, 404);
  queue.push(say('Ciao!'));
  assert.equal((await D('POST', '/api/alma/chat', { conversation_id: id, text: 'ciao' })).status, 404);
  queue.length = 0;
  const tr = (await db.query('SELECT id FROM assistant_traces WHERE conversation_id = $1 LIMIT 1', [id])).rows[0];
  if (tr) assert.equal((await D('POST', `/api/alma/tracce/${tr.id}/voto`, { voto: -1 })).status, 404);
  assert.equal((await E('PATCH', `/api/alma/conversations/${id}`, { title: 'Ticket di prova' })).body.title, 'Ticket di prova');
  assert.equal((await E('DELETE', `/api/alma/conversations/${id}`)).status, 200);
  assert.equal((await E('GET', `/api/alma/conversations/${id}`)).status, 404);
});

test('una ricerca si offre solo a chi può aprire la stessa pagina (Alma Energy)', async () => {
  const tools = async () => (await E('GET', '/api/alma/status')).body.tools;
  assert.ok((await tools()).includes('ticket_elenco'));
  assert.ok(!(await tools()).includes('energia_cruscotto'));
  queue.push(say('Ciao.'));
  await E('POST', '/api/alma/chat', { text: 'ciao' });
  assert.ok(!calls.at(-1).tools.some(t => t.name === 'energia_cruscotto'));
  await db.query("INSERT INTO energy_members (email) VALUES ('edile@almacis.it')");
  assert.ok((await tools()).includes('energia_cruscotto'));
  queue.push(say('Ciao.'));
  await E('POST', '/api/alma/chat', { text: 'ciao di nuovo' });
  assert.ok(calls.at(-1).tools.some(t => t.name === 'energia_cruscotto'));
  // azioni spente in Impostazioni → niente «proponi_…»
  await D('PUT', '/api/alma/settings', { actions: false });
  queue.push(say('Ok.'));
  await E('POST', '/api/alma/chat', { text: 'ok' });
  assert.ok(!calls.at(-1).tools.some(t => t.name.startsWith('proponi_')));
  await D('PUT', '/api/alma/settings', { actions: true });
});

test('regole della direzione: vanno nelle istruzioni di Alma', async () => {
  const r = await D('POST', '/api/alma/regole', { text: 'Quando dico «gare» intendo i segnali dell\'ufficio gare.' });
  assert.equal(r.status, 201);
  assert.equal((await E('POST', '/api/alma/regole', { text: 'x' })).status, 403);
  queue.push(say('Ok.'));
  await E('POST', '/api/alma/chat', { text: 'ok' });
  assert.ok(calls.at(-1).system.some(b => b.text.includes('ufficio gare')));
  assert.equal((await D('DELETE', `/api/alma/regole/${r.body.id}`)).status, 200);
});

test('senza OPENAI_API_KEY Alma è spenta: 503 e il messaggio giusto', async () => {
  alma.setClient(null); // torna il Claude vero, ma la chiave non c'è
  try {
    const st = await E('GET', '/api/alma/status');
    assert.equal(st.body.configured, false);
    const r = await E('POST', '/api/alma/chat', { text: 'ciao' });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'Alma non è ancora attiva.');
    const a = await D('POST', '/api/alma/chat', { text: 'ciao' });
    assert.equal(a.status, 503);
    assert.equal(a.body.error, 'Alma è spenta: manca la chiave OPENAI_API_KEY su Railway.');
  } finally { alma.setClient(fakeClaude); }
});

test('tutte le ricerche rispondono con i dati veri delle API (nessun errore)', async () => {
  const p = await D('POST', '/api/projects', { name: 'Manutenzione UMC Avellino' });
  assert.equal(p.status, 201);
  await D('POST', '/api/tickets', { title: 'Report trimestrale', project_id: p.body.id, due_date: '2026-02-01' });
  await db.query("INSERT INTO crm_subjects (name, kind, roles, asa) VALUES ('Provincia di Pescara', 'ente_pubblico', '{lead}', '{}')");
  const inputs = {
    cerca: { testo: 'Report' }, ticket_elenco: { progetto: 'UMC' }, ticket_dettaglio: { id: 1 }, progetti_elenco: {}, progetto_riepilogo: { progetto: 'UMC Avellino' },
    ore_rda: {}, crm_cerca: { testo: 'Pescara' }, crm_scheda: { azienda: 'Provincia di Pescara' }, crm_settimana: {}, radar_segnali: { vista: 'tutti' },
    vinte_perse: {}, concorrenza: {}, concorrenza_stima: { categoria: 'OG1' }, prima_del_bando: {}, persone: {}, mezzi: {}, energia_cruscotto: {},
  };
  const status = (await D('GET', '/api/alma/status')).body.tools;
  for (const [name, input] of Object.entries(inputs)) {
    if (!status.includes(name)) continue; // energia_cruscotto: la direzione di prova non è nella BU Energy
    let result;
    queue.push(toolUse(name, input), params => { result = lastResult(params); return say('Ok.')(); });
    const r = await D('POST', '/api/alma/chat', { text: `prova ${name}` });
    assert.equal(r.status, 200, name);
    assert.equal(result.error, undefined, `${name}: ${result.error}`);
    assert.ok(result.fonte_id, name);
  }
  // il riepilogo del progetto conta l'attività in ritardo
  queue.push(toolUse('progetto_riepilogo', { progetto: String(p.body.id) }), params => {
    const r = lastResult(params);
    assert.equal(r.attivita_in_ritardo, 1);
    assert.equal(r.ritardi[0].titolo, 'Report trimestrale');
    return say('Ok.')();
  });
  await D('POST', '/api/alma/chat', { text: 'riassumi il progetto' });
});

test('nota CRM con due schede dallo stesso nome: Alma chiede quale, poi conferma e annulla', async () => {
  await db.query("INSERT INTO crm_subjects (name, kind, roles, asa, city) VALUES ('Comune di Ortona', 'ente_pubblico', '{lead}', '{}', 'Ortona'), ('Comune di Ortona Servizi', 'impresa', '{cliente}', '{}', 'Ortona')");
  queue.push(toolUse('proponi_nota_crm', { azienda: 'Ortona', testo: 'Il RUP chiede un sopralluogo a dicembre.', tipo: 'telefonata' }), say('Quale delle due?'));
  const r = await D('POST', '/api/alma/chat', { text: 'Aggiungi una nota su Ortona: il RUP chiede un sopralluogo a dicembre' });
  const p = r.body.proposals[0];
  assert.equal(p.choices.options.length, 2);
  assert.equal((await D('POST', `/api/alma/azioni/${p.id}/conferma`)).status, 409); // prima si sceglie
  const ch = await D('POST', '/api/alma/chat', { conversation_id: r.body.conversation_id, text: 'la prima' }); // senza Claude
  assert.match(ch.body.reply, /^Ok, Comune di Ortona\./);
  const ok = await D('POST', `/api/alma/azioni/${p.id}/conferma`);
  assert.match(ok.body.reply, /nota salvata su «Comune di Ortona»/);
  const n = (await db.query("SELECT COUNT(*)::int AS n FROM crm_notes WHERE body LIKE 'Il RUP chiede%' AND deleted_at IS NULL")).rows[0].n;
  assert.equal(n, 1);
  assert.equal((await D('POST', `/api/alma/azioni/${p.id}/disfa`)).status, 200);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_notes WHERE body LIKE 'Il RUP chiede%' AND deleted_at IS NULL")).rows[0].n, 0);
});

test('biglietti da visita: le foto arrivano al modello e non si salvano; contatto nuovo, azienda nuova, già nel CRM; Conferma su uno, Conferma tutti, Annulla', async () => {
  await db.query("INSERT INTO crm_subjects (name, kind, roles, asa, city) VALUES ('Terna S.p.A.', 'impresa', '{cliente}', '{}', 'Roma')");
  const terna = (await db.query("SELECT id FROM crm_subjects WHERE name = 'Terna S.p.A.'")).rows[0].id;
  const b = await D('POST', '/api/crm/contacts', { first_name: 'Marco', last_name: 'Bianchi', email: 'm.bianchi@snam.it', mobile: '347 551 0021', links: [{ subject_id: terna }] });
  assert.equal(b.status, 201);
  const asa = (await db.query('SELECT key, label FROM crm_asa ORDER BY sort LIMIT 1')).rows[0];
  const img = `data:image/jpeg;base64,${Buffer.from('foto finta del biglietto').toString('base64')}`;
  let images = 0, mark = '';
  queue.push(params => {
    const blocks = params.messages.flatMap(m => (Array.isArray(m.content) ? m.content : []));
    images = blocks.filter(x => x.type === 'image').length;
    mark = blocks.filter(x => x.type === 'text').map(x => x.text).join(' ');
    return { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'tb1', name: 'proponi_biglietto', input: { titolo: 'Ing.', nome: 'Paolo', cognome: 'Neri', azienda: 'Terna S.p.A.', qualifica: 'Responsabile lavori', email: 'paolo.neri@terna.it', cellulare: '+39 335 618 2290', nota: 'Fiera Ecomondo' } },
      { type: 'tool_use', id: 'tb2', name: 'proponi_biglietto', input: { titolo: 'Arch.', nome: 'Sara', cognome: 'Conti', azienda: 'Comune di Lanciano', tipo_ente: 'ente_pubblico', email: 's.conti@comune.lanciano.ch.it', bu: asa.key, incerti: ['email'], nota: 'Fiera Ecomondo' } },
      { type: 'tool_use', id: 'tb3', name: 'proponi_biglietto', input: { nome: 'Marco', cognome: 'Bianchi', azienda: 'Terna S.p.A.', email: 'm.bianchi@snam.it', cellulare: '348 902 7714' } },
    ] };
  }, say('Ho letto 3 biglietti: controlla e conferma.'));
  const r = await D('POST', '/api/alma/chat', { text: 'Fiera Ecomondo', images: [img, img] });
  assert.equal(r.status, 200);
  assert.equal(images, 2); // le foto arrivano al modello
  assert.match(mark, /2 foto allegate/);
  const saved = (await db.query('SELECT content::text AS c FROM assistant_messages WHERE conversation_id = $1', [r.body.conversation_id])).rows.map(x => x.c).join(' ');
  assert.ok(!saved.includes(img.split(',')[1]), 'le foto non si salvano');
  const [neri, conti, bianchi] = r.body.proposals;
  assert.equal(neri.title, 'Nuovo contatto · Ing. Paolo Neri');
  assert.ok(neri.fields.some(([k, v]) => k === 'Azienda' && /Terna S\.p\.A\. \(già nel CRM\)/.test(v)));
  assert.equal(conti.title, 'Nuovo contatto e nuova azienda · Arch. Sara Conti');
  assert.match(conti.warnings.join(' '), /letti male dalla foto: email/);
  assert.equal(bianchi.title, 'Aggiorna · Marco Bianchi');
  assert.ok(bianchi.fields.some(([k, v]) => k === 'Cellulare' && v === '347 551 0021 → 348 902 7714'));
  // Conferma su uno solo: gli altri restano da confermare
  const one = await D('POST', `/api/alma/azioni/${neri.id}/conferma`, { solo: true });
  assert.match(one.body.reply, /Ing\. Paolo Neri aggiunto a «Terna S\.p\.A\.»/);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_contacts WHERE last_name = 'Neri'")).rows[0].n, 1);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_subjects WHERE name = 'Comune di Lanciano'")).rows[0].n, 0);
  // Conferma tutti: azienda nuova come lead nell'ASA scelta + contatto, cellulare aggiornato
  const all = await D('POST', `/api/alma/azioni/${conti.id}/conferma`, {});
  assert.match(all.body.reply, /salvate 2 cose/);
  const lan = (await db.query("SELECT id, roles, asa, kind, owner_id FROM crm_subjects WHERE name = 'Comune di Lanciano'")).rows[0];
  assert.deepEqual([lan.roles, lan.asa, lan.kind], [['lead'], [asa.key], 'ente_pubblico']);
  const sara = (await db.query("SELECT c.email, c.notes, l.subject_id FROM crm_contacts c JOIN crm_contact_links l ON l.contact_id = c.id WHERE c.last_name = 'Conti'")).rows[0];
  assert.equal(sara.subject_id, lan.id);
  assert.match(sara.notes, /Fiera Ecomondo/);
  assert.equal((await db.query("SELECT mobile FROM crm_contacts WHERE last_name = 'Bianchi'")).rows[0].mobile, '348 902 7714');
  // Annulla (entro 10 minuti): torna tutto com'era
  assert.equal((await D('POST', `/api/alma/azioni/${bianchi.id}/disfa`)).status, 200);
  assert.equal((await db.query("SELECT mobile FROM crm_contacts WHERE last_name = 'Bianchi'")).rows[0].mobile, '347 551 0021');
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_subjects WHERE name = 'Comune di Lanciano'")).rows[0].n, 0);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_contacts WHERE last_name IN ('Neri', 'Conti')")).rows[0].n, 0);
});

test('biglietti: foto sbagliate o troppe vengono rifiutate prima di chiamare il modello', async () => {
  const before = calls.length;
  assert.equal((await D('POST', '/api/alma/chat', { text: 'ciao', images: ['data:text/html;base64,PGI+'] })).status, 400);
  const six = Array.from({ length: 6 }, () => 'data:image/png;base64,AAAA');
  assert.equal((await D('POST', '/api/alma/chat', { text: 'ciao', images: six })).status, 400);
  assert.equal(calls.length, before);
});

test('email: tono delle email passate, chi ricontattare, email singola subito, gruppo programmato con una tolta, Cambia, Invia ora, Annulla, errore', async () => {
  const asaKey = (await db.query('SELECT key FROM crm_asa ORDER BY sort LIMIT 1')).rows[0].key;
  await db.query("INSERT INTO crm_subjects (name, kind, roles, asa, city) VALUES ('Provincia di Teramo', 'ente_pubblico', '{cliente}', $1, 'Teramo'), ('ASL Teramo', 'ente_pubblico', '{cliente}', $1, 'Teramo'), ('Comune di Atri', 'ente_pubblico', '{cliente}', $1, 'Atri')", [[asaKey]]);
  const sid = async n => (await db.query('SELECT id FROM crm_subjects WHERE name = $1', [n])).rows[0].id;
  const [pt, asl, atri] = [await sid('Provincia di Teramo'), await sid('ASL Teramo'), await sid('Comune di Atri')];
  const verdi = (await D('POST', '/api/crm/contacts', { title: 'Ing.', first_name: 'Giulia', last_name: 'Verdi', email: 'g.verdi@provincia.teramo.it', links: [{ subject_id: pt }] })).body.id;
  const rossi = (await D('POST', '/api/crm/contacts', { title: 'Dott.', first_name: 'Elena', last_name: 'Rossetti', email: 'e.rossetti@asl.te.it', links: [{ subject_id: asl }] })).body.id;
  const noMail = (await D('POST', '/api/crm/contacts', { first_name: 'Piero', last_name: 'Senzamail', links: [{ subject_id: atri }] })).body.id;

  // tono: inizio e fine delle email passate, come dati
  let tone;
  queue.push(toolUse('email_tono', { contatti: [`c:${verdi}`, 'Rossetti'] }), params => { tone = lastResult(params); return say('Ok.')(); });
  await D('POST', '/api/alma/chat', { text: 'come scrivevo a Giulia Verdi e alla Rossetti?' });
  assert.equal(tone.contatti?.length, 2, JSON.stringify(tone));
  assert.match(JSON.stringify(tone.contatti[0].esempi), /Ciao Giulia/);
  assert.equal(tone.contatti[1].email_passate, 0);

  // chi ricontattare: le schede senza contatti, con il contatto che ha l'email
  let due;
  queue.push(toolUse('crm_da_ricontattare', { ruolo: 'cliente', asa: asaKey, giorni: 90 }), params => { due = lastResult(params); return say('Ok.')(); });
  await D('POST', '/api/alma/chat', { text: 'quali clienti non sentiamo da 3 mesi?' });
  assert.equal(due.aziende.find(a => a.id === pt).contatto.id, verdi);
  assert.equal(due.aziende.find(a => a.id === atri).nota, 'i contatti non hanno email');

  // email singola, subito: niente parte prima della conferma; poi parte, nota sulla scheda
  queue.push(toolUse('proponi_email', { email: [{ destinatario: 'Giulia Verdi', oggetto: 'Sopralluogo scuole', testo: 'Ciao Giulia,\nti propongo martedì.\nUn caro saluto, Dante (Almacis)' }] }), say('Ecco la bozza: confermi?'));
  const r1 = await D('POST', '/api/alma/chat', { text: 'Scrivi a Giulia Verdi per proporre il sopralluogo martedì' });
  const p1 = r1.body.proposals[0];
  assert.equal(p1.title, 'Email · Ing. Giulia Verdi');
  assert.ok(p1.fields.some(([k, v]) => k === 'Quando' && v === 'subito'));
  assert.equal(sentMail.length, 0);
  const ok1 = await D('POST', `/api/alma/azioni/${p1.id}/conferma`, { solo: true });
  assert.match(ok1.body.reply, /email inviata a Ing\. Giulia Verdi/);
  assert.deepEqual(sentMail.map(m => m.to), ['g.verdi@provincia.teramo.it']);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_notes WHERE subject_id = $1 AND title = 'Email inviata: Sopralluogo scuole'", [pt])).rows[0].n, 1);

  // a chi non è nel CRM non si scrive
  let notFound;
  queue.push(toolUse('proponi_email', { email: [{ destinatario: 'Mario Sconosciuto', oggetto: 'Ciao', testo: 'Buongiorno.' }] }), params => { notFound = lastResult(params); return say('Non è nel CRM.')(); });
  await D('POST', '/api/alma/chat', { text: 'Scrivi a Mario Sconosciuto' });
  assert.match(notFound.error, /solo ai contatti del CRM/);

  // gruppo programmato domani alle 08:30: chi non ha email si salta, una si toglie con la spunta
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  queue.push(toolUse('proponi_email', { criterio: 'clienti senza contatti da 90 giorni', quando: `${tomorrow} 08:30`, email: [
    { destinatario: `c:${verdi}`, oggetto: 'Aggiornamento', testo: 'Ciao Giulia, un aggiornamento.' },
    { destinatario: `c:${rossi}`, oggetto: 'Aggiornamento', testo: 'Gentile Dottoressa, un aggiornamento.' },
    { destinatario: `c:${noMail}`, oggetto: 'Aggiornamento', testo: 'Buongiorno.' }] }), say('Ecco le email.'));
  const r2 = await D('POST', '/api/alma/chat', { text: 'Manda un aggiornamento ai clienti che non sentiamo da 3 mesi, domani alle 8:30' });
  let p2 = r2.body.proposals[0];
  assert.equal(p2.title, '2 email personalizzate');
  assert.equal(p2.items.length, 2);
  assert.match(p2.warnings.join(' '), /Non scrivo a: Piero Senzamail \(senza email nel CRM\)/);
  assert.ok(p2.edit.find(f => f.key === 'escludi').hidden);
  p2 = (await D('POST', `/api/alma/azioni/${p2.id}/modifica`, { campi: { escludi: '1' } })).body.proposal;
  assert.equal(p2.title, '1 email personalizzata');
  assert.deepEqual(p2.items.map(x => x.incluso), [false, true]);
  const ok2 = await D('POST', `/api/alma/azioni/${p2.id}/conferma`, {});
  assert.match(ok2.body.reply, /email programmata per .*08:30 \(a Dott\. Elena Rossetti\)/);
  assert.equal(sentMail.length, 1); // non è ancora partita
  const list = (await D('GET', '/api/alma/email')).body;
  assert.equal(list.programmate.length, 1);
  const em = list.programmate[0];
  assert.equal(em.email, 'e.rossetti@asl.te.it');
  // Cambia (oggetto) e Invia ora; solo chi l'ha programmata
  assert.equal((await D('PATCH', `/api/alma/email/${em.id}`, { oggetto: 'Aggiornamento servizi' })).body.oggetto, 'Aggiornamento servizi');
  assert.equal((await E('POST', `/api/alma/email/${em.id}/invia-ora`)).status, 404);
  assert.equal((await D('POST', `/api/alma/email/${em.id}/invia-ora`)).body.stato, 'inviata');
  assert.equal(sentMail[1].subject, 'Aggiornamento servizi');

  // programmata e poi «Annulla il salvataggio»: non parte più
  queue.push(toolUse('proponi_email', { quando: `${tomorrow} 09:00`, email: [{ destinatario: `c:${verdi}`, oggetto: 'Promemoria', testo: 'Ciao Giulia.' }] }), say('Ok.'));
  const r3 = await D('POST', '/api/alma/chat', { text: 'Scrivi a Giulia domani alle 9 per il promemoria' });
  await D('POST', `/api/alma/azioni/${r3.body.proposals[0].id}/conferma`, {});
  assert.equal((await D('POST', `/api/alma/azioni/${r3.body.proposals[0].id}/disfa`)).status, 200);
  assert.equal((await db.query("SELECT status FROM assistant_emails WHERE subject = 'Promemoria'")).rows[0].status, 'annullata');

  // il giro delle programmate: parte all'ora; se Outlook non la prende, errore e avviso nella campanella
  const later = await D('POST', '/api/alma/email', { items: [{ contact_id: verdi, oggetto: 'Dal giro', testo: 'Ciao.' }], send_at: new Date(Date.now() + 3600e3).toISOString() });
  assert.equal(later.body.first, 'programmata');
  await db.query("UPDATE assistant_emails SET send_at = now() - interval '1 minute' WHERE subject = 'Dal giro'");
  mailFail = 'casella non raggiungibile';
  await alma.email.tick();
  mailFail = null;
  const failed = (await db.query("SELECT status, error FROM assistant_emails WHERE subject = 'Dal giro'")).rows[0];
  assert.deepEqual([failed.status, failed.error], ['errore', 'casella non raggiungibile']);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM notifications WHERE body LIKE '%«Dal giro»%non è partita%'")).rows[0].n, 1);
  // l'indirizzo si rilegge sempre dalla scheda del CRM: un indirizzo passato a mano non conta
  const fake = await D('POST', '/api/alma/email', { items: [{ contact_id: verdi, oggetto: 'x', testo: 'y', to_email: 'altro@esterno.com' }] });
  assert.equal(fake.status, 201);
  assert.equal(sentMail[sentMail.length - 1].to, 'g.verdi@provincia.teramo.it');
});

test('voce: la dettatura manda l\'audio e torna il testo; «Ascolta» legge la versione da dire; voce spenta → 403', async () => {
  const st = await D('GET', '/api/alma/status');
  assert.equal(st.body.voce, true);
  const audio = Buffer.from('webm-audio-finto');
  const res = await fetch(`${base}/api/alma/voce/trascrivi?secondi=4`, { method: 'POST', headers: { cookie: eCookie, 'X-Alma': '1', 'Content-Type': 'audio/webm;codecs=opus' }, body: audio });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).text, 'quanti ticket ho in ritardo?');
  assert.equal(heard.at(-1).mime, 'audio/webm');
  assert.equal(heard.at(-1).buffer.toString(), 'webm-audio-finto');
  const bad = await fetch(`${base}/api/alma/voce/trascrivi`, { method: 'POST', headers: { cookie: eCookie, 'X-Alma': '1', 'Content-Type': 'text/plain' }, body: 'ciao' });
  assert.equal(bad.status, 415);
  // «Ascolta»: niente Markdown, fonti, tabelle o blocchi
  const tts = await fetch(`${base}/api/alma/voce/ascolta`, { method: 'POST', headers: { cookie: eCookie, 'X-Alma': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hai **4**{f1} ticket aperti.\n| a | b |\n| 1 | 2 |\n- uno in ritardo\n\n\`\`\`blocchi\n{"domande":["x"]}\n\`\`\`' }) });
  assert.equal(tts.status, 200);
  assert.equal(tts.headers.get('content-type'), 'audio/mpeg');
  assert.equal(spoken.at(-1), 'Hai 4 ticket aperti.. Il dettaglio è nella tabella sullo schermo.. uno in ritardo'.replace(/\.\./g, '.'));
  const used = (await db.query("SELECT COUNT(*)::int AS n FROM assistant_usage WHERE model IN ('gpt-4o-transcribe', 'gpt-4o-mini-tts')")).rows[0].n;
  assert.equal(used, 2);
  // voce spenta dalle impostazioni
  assert.equal((await D('PUT', '/api/alma/settings', { voice: false })).status, 200);
  const off = await fetch(`${base}/api/alma/voce/ascolta`, { method: 'POST', headers: { cookie: eCookie, 'X-Alma': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'ciao' }) });
  assert.equal(off.status, 403);
  assert.equal((await D('GET', '/api/alma/status')).body.voce, false);
  await D('PUT', '/api/alma/settings', { voice: true });
});

test('grafici: il server disegna dai risultati di una ricerca; errori chiari; «in tabella» senza modello; dashboard tenuta, aggiornata, cambiata e tolta', async () => {
  const GRAF = require('../lib/assistente-grafici');
  // build: elenco sbagliato → elenca quelli buoni; torta con troppe voci → barre
  assert.throws(() => GRAF.build({ progetti: [{ nome: 'A', ticket_totali: 2 }] }, { elenco: 'nope', etichetta: 'nome', valori: ['ticket_totali'] }), /progetti \(campi: nome, ticket_totali\)/);
  assert.equal(GRAF.build({ r: Array.from({ length: 8 }, (_, i) => ({ n: 'v' + i, x: i })) }, { elenco: 'r', etichetta: 'n', valori: ['x'], tipo: 'torta' }).tipo, 'barre');
  assert.equal(GRAF.tipoDaTesto('fallo a barre'), 'barre');
  assert.equal(GRAF.tipoDaTesto('mettilo in tabella per favore'), 'tabella');

  for (const name of ['Grafico Uno', 'Grafico Due']) {
    const p = await D('POST', '/api/projects', { name });
    for (let i = 0; i < (name.endsWith('Uno') ? 3 : 1); i++) await D('POST', '/api/tickets', { title: name + ' t' + i, project_id: p.body.id });
  }
  let chartResult;
  queue.push(toolUse('progetti_elenco', { testo: 'Grafico' }), params => {
    const r = lastResult(params);
    return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tg1', name: 'grafico', input: { fonte_id: r.fonte_id, elenco: 'progetti', etichetta: 'nome', valori: ['ticket_totali', 'ticket_aperti'], nomi: ['Ticket', 'Aperti'], tipo: 'barre', titolo: 'Ticket per progetto' } }] };
  }, params => { chartResult = lastResult(params); return say('Grafico Uno ha più ticket.')(); });
  const r = await D('POST', '/api/alma/chat', { text: 'fammi un grafico dei ticket per progetto' });
  assert.equal(r.status, 200);
  assert.equal(chartResult.mostrato, true);
  assert.equal(r.body.charts.length, 1);
  const c = r.body.charts[0];
  assert.equal(c.source, undefined); // la ricerca resta sul server
  assert.deepEqual(c.serie.map(x => x.nome), ['Ticket', 'Aperti']);
  const iUno = c.etichette.indexOf('Grafico Uno');
  assert.equal(c.serie[0].valori[iUno], 3);
  assert.ok(r.body.message_id);
  // un fonte_id inventato non disegna niente
  let bad;
  queue.push(toolUse('grafico', { fonte_id: 'f99', elenco: 'x', etichetta: 'y', valori: ['z'], titolo: 'no' }), params => { bad = lastResult(params); return say('Ok.')(); });
  await D('POST', '/api/alma/chat', { conversation_id: r.body.conversation_id, text: 'e un altro grafico?' });
  assert.match(bad.error, /non è di una ricerca fatta in questa risposta/);
  // «in tabella»: cambia l'ultimo grafico senza chiamare il modello
  const before = calls.length;
  const t = await D('POST', '/api/alma/chat', { conversation_id: r.body.conversation_id, text: 'fallo in tabella' });
  assert.equal(calls.length, before);
  assert.equal(t.body.charts[0].tipo, 'tabella');
  assert.match(t.body.reply, /in tabella/);
  // dashboard: tieni, aggiorna con i dati di oggi, cambia tipo e titolo, togli; solo chi l'ha tenuto
  const add = await D('POST', '/api/alma/dashboard', { message_id: r.body.message_id, chart_id: c.id });
  assert.equal(add.status, 201);
  assert.equal((await E('POST', '/api/alma/dashboard', { message_id: r.body.message_id, chart_id: c.id })).status, 404);
  const pUno = (await db.query("SELECT id FROM projects WHERE name = 'Grafico Uno'")).rows[0].id;
  await D('POST', '/api/tickets', { title: 'Grafico Uno t3', project_id: pUno });
  const up = await D('POST', '/api/alma/dashboard/' + add.body.id + '/aggiorna');
  assert.equal(up.body.errore, undefined);
  assert.equal(up.body.chart.serie[0].valori[up.body.chart.etichette.indexOf('Grafico Uno')], 4);
  assert.equal((await D('PATCH', '/api/alma/dashboard/' + add.body.id, { tipo: 'linee', titolo: 'Ticket dei progetti grafico' })).body.chart.tipo, 'linee');
  assert.equal((await D('GET', '/api/alma/dashboard')).body.grafici[0].titolo, 'Ticket dei progetti grafico');
  assert.equal((await E('DELETE', '/api/alma/dashboard/' + add.body.id)).status, 404);
  assert.equal((await D('DELETE', '/api/alma/dashboard/' + add.body.id)).status, 200);
  assert.equal((await D('GET', '/api/alma/dashboard')).body.grafici.length, 0);
});
