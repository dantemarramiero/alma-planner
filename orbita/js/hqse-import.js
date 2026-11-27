// HQSE fase 5 (ALM2-105): Import da Vittoria (tavole 25–27) e Passaggio al portale (tavola 28).
import { h, fill, toast, fmtDate, fmtDateTime, loading } from './ui.js';
import { get, post, put, patch } from './api.js';
import { ic, dots, pill, pageTop, title, card, emptyState, cvModal, seg } from './crm-v2.js';

const top = (eyebrow, light, bold, sub, actions) => pageTop({ eyebrow, heading: title(light, bold), sub, actions });
const fld = (label, control, hint) => h('label.cv-fld', h('span', label), control, hint ? h('span.cv-hint', hint) : null);
const tile = (label, big, sub, acc) => h('div.cv-card.hq-tile', { class: acc ? 'acc' : '' }, h('span.hq-lbl', label), h('span.hq-big', String(big)), h('span.hq-sub', sub));
const num = n => Number(n || 0).toLocaleString('it-IT');
const steps = cur => h('section.cv-card.hq-steps-bar', ['Carica l\'export', 'Abbina', 'Importa', 'Benvenuto'].map((s, i) =>
  h('span.hq-stepi', { class: i + 1 === cur ? 'on' : i + 1 < cur ? 'done' : '' }, h('b', String(i + 1)), s)));
const MATCH = { crm: ['Nel CRM', 'gr'], nuovo: ['Nuova nel CRM', 'line'], dubbio: ['Da guardare', 'am'], storico: ['Solo storico', 'line'] };

// ── Import (tavole 25–27) ───────────────────────────────────────────────────────────────────────
export async function importPage(box, id) {
  const list = await get('/api/hqse/import');
  const cur = id ? list.find(x => x.id === id) : list[0];
  if (!cur) return uploadStep(box, list);
  const o = await get(`/api/hqse/import/${cur.id}`);
  const reload = () => importPage(box, cur.id);
  const p = o.preview;
  const ran = o.import.status === 'importato';
  const s = o.import.summary || {};
  const actions = [
    h('button.btn', { type: 'button', on: { click: () => uploadStep(box, list, true) } }, ic('plus', 16), 'Nuovo import'),
    ran ? h('a.btn.btn-primary', { href: '#/hqse/passaggio' }, 'Avanti: benvenuto') : null,
  ];
  const head = ran
    ? top('Import da Vittoria · passo 3', 'Importati', `${num(s.fornitori)} fornitori`, `Ultimo giro ${fmtDateTime(o.import.run_at)}. Rifare l'import aggiorna, non duplica.`, actions)
    : top('Import da Vittoria · passo 2', 'Abbina', 'a quello che c\'è già', `Pacchetto caricato ${fmtDateTime(o.import.created_at)}. Il CRM resta l'anagrafica unica: si aggiunge solo la qualifica.`, actions);

  // fornitori: filtro e abbinamento a mano
  let filtro = o.match.dubbio ? 'dubbi' : 'tutti';
  const rowsBox = h('div');
  const drawRows = () => {
    const rows = o.suppliers.filter(r => filtro === 'tutti' || (r.match === 'dubbio' && !r.decided));
    fill(rowsBox, rows.length ? h('div.hq-scroll', h('table.hq-t',
      h('thead', h('tr', h('th', 'In Vittoria'), h('th', 'P.IVA'), h('th', 'In Alma'), h('th', 'Perché'))),
      h('tbody', rows.slice(0, 300).map(r => h('tr',
        h('td', h('b', r.name)), h('td.hq-sub', r.vat || '—'),
        h('td', r.match === 'dubbio' && !r.decided && !ran ? chooser(o.import.id, r, reload) : pill(r.match === 'crm' && r.crm_name ? r.crm_name : MATCH[r.match][0], MATCH[r.match][1])),
        h('td.hq-sub', r.decided ? 'abbinato a mano' : r.reason))))))
      : emptyState('check', 'Niente da guardare: tutti i fornitori sono abbinati.'));
  };
  drawRows();

  fill(box,
    head, steps(ran ? 3 : 2),
    ran ? h('section.hq-tiles',
      tile('Fornitori', num(s.fornitori), `${num(s.collegati)} collegati al CRM, ${num(s.nuovi)} nuovi`, true),
      tile('Dipendenti', num(s.dipendenti), s.senza_cf ? `${num(s.senza_cf)} senza codice fiscale: da completare` : 'attivi, nel CRM'),
      tile('Documenti validi', num(s.documenti), s.gia_presenti ? `${num(s.gia_presenti)} già presenti dal giro prima` : 'approvati in Vittoria'),
      tile('Da caricare nel portale', num(s.da_caricare), 'scaduti o mai caricati'))
      : h('section.hq-tiles',
        tile('Fornitori già nel CRM', num(o.match.crm), 'stessa P.IVA: si collegano', true),
        tile('Nuovi nel CRM', num(o.match.nuovo), 'si creano come aziende'),
        tile('Da guardare', num(o.match.dubbio), 'nome diverso o P.IVA mancante'),
        tile('Tipi di documento', `${o.tipi.abbinati} / ${o.tipi.tutti}`, `${o.tipi.tutti - o.tipi.abbinati} da abbinare`)),
    h('div.hq-two',
      card({ title: 'Fornitori', icon: 'building', count: o.suppliers.length, right: seg([['dubbi', 'Da guardare', o.match.dubbio], ['tutti', 'Tutti', o.suppliers.length]], filtro, k => { filtro = k; drawRows(); }, { label: 'Filtro' }) }, rowsBox),
      h('div.hq-col',
        ran ? scartiCard(o, s) : previewCard(p),
        typesCard(o, reload),
        ran ? null : runCard(o, p, reload))));
}

function chooser(importId, r, reload) {
  const sel = h('select.input', { 'aria-label': `Abbina ${r.name}` },
    h('option', { value: '' }, 'Scegli…'),
    r.subject_id ? h('option', { value: `crm:${r.subject_id}` }, `${r.crm_name} (nel CRM)`) : null,
    h('option', { value: 'nuovo' }, 'Nuova azienda nel CRM'),
    h('option', { value: 'salta' }, 'Non importare'));
  sel.addEventListener('change', async () => {
    const v = sel.value;
    if (!v) return;
    try {
      await patch(`/api/hqse/import/${importId}/fornitori/${r.id}`, v === 'nuovo' ? { nuovo: true } : v === 'salta' ? { salta: true } : { subject_id: Number(v.split(':')[1]) });
      toast('Abbinato'); reload();
    } catch (e) { toast(e.message, 'err'); }
  });
  return sel;
}

function previewCard(p) {
  return card({ title: 'Cosa c\'è nel pacchetto', icon: 'file-text' }, h('div.hq-scroll', h('table.hq-t',
    h('thead', h('tr', h('th', 'Cosa'), h('th', 'Nel pacchetto'), h('th', 'Entra'))),
    h('tbody',
      h('tr', h('td', 'Fornitori'), h('td', num(p.fornitori.tutti)), h('td', h('b', num(p.fornitori.entrano)), p.fornitori.storico ? h('span.hq-sub', ` · ${p.fornitori.storico} terminati: solo storico`) : null)),
      h('tr', h('td', 'Dipendenti'), h('td', num(p.dipendenti.tutti)), h('td', h('b', num(p.dipendenti.entrano)), h('span.hq-sub', ' attivi'))),
      h('tr', h('td', 'Documenti'), h('td', num(p.documenti.tutti)), h('td', h('b', num(p.documenti.entrano)), h('span.hq-sub', ' approvati e validi'))),
      h('tr', h('td', 'File'), h('td', num(p.file.indicati)), h('td', h('b', num(p.file.arrivati)), h('span.hq-sub', ' arrivati')))))));
}

function scartiCard(o, s) {
  const sc = Object.entries(s.scarti || {});
  const what = { 'Documento approvato senza file': 'entra «da caricare»: il fornitore lo rimette', 'Data di scadenza mancante': 'entra «da caricare»', 'File illeggibile o vuoto': 'entra «da caricare»', 'Tipo «Non importare»': 'resta solo nell\'archivio di Vittoria', 'Tipo di documento non abbinato': 'abbinalo qui sotto e rifai l\'import', 'Fornitore da abbinare a mano': 'abbinalo e rifai l\'import', 'Dipendente non attivo o non trovato': 'resta in Vittoria' };
  return card({ title: 'Scarti, con il motivo', icon: 'triangle', right: h('a.btn.btn-sm', { href: `/api/hqse/import/${o.import.id}/scarti.csv` }, 'Scarica gli scarti') },
    sc.length ? h('div.hq-scroll', h('table.hq-t', h('thead', h('tr', h('th', 'Cosa'), h('th', 'Quanti'), h('th', 'Cosa succede'))),
      h('tbody', sc.map(([k, n]) => h('tr', h('td', k), h('td', num(n)), h('td.hq-sub', what[k] || '')))))) : emptyState('check', 'Nessuno scarto.'));
}

function typesCard(o, reload) {
  const todo = o.tipi.list.filter(t => !t.doc_type_id && !t.skip);
  const body = h('div', loading());
  get('/api/hqse/import-tipi').then(types => fill(body, todo.length ? h('div.hq-scroll', h('table.hq-t',
    h('thead', h('tr', h('th', 'In Vittoria'), h('th', 'Quanti'), h('th', 'In Alma'))),
    h('tbody', todo.slice(0, 60).map(t => {
      const sel = h('select.input', { 'aria-label': `Tipo per ${t.name}` }, h('option', { value: '' }, 'Scegli…'), h('option', { value: 'skip' }, 'Non importare'),
        ['fornitore', 'risorsa', 'mezzo'].map(sc => h('optgroup', { label: { fornitore: 'Dell\'azienda', risorsa: 'Dei dipendenti', mezzo: 'Dei mezzi' }[sc] }, types.filter(x => x.scope === sc).map(x => h('option', { value: x.id }, x.name)))));
      sel.addEventListener('change', async () => {
        if (!sel.value) return;
        try { await put('/api/hqse/import/tipi', sel.value === 'skip' ? { vittoria_name: t.name, skip: true } : { vittoria_name: t.name, doc_type_id: Number(sel.value) }); toast('Tipo abbinato'); reload(); } catch (e) { toast(e.message, 'err'); }
      });
      return h('tr', h('td', h('b', t.name)), h('td', num(t.n)), h('td', sel));
    })))) : emptyState('check', 'Tutti i tipi di documento sono abbinati.'))).catch(() => fill(body));
  return card({ title: 'Tipi di documento da abbinare', icon: 'list-checks', count: todo.length }, body, h('p.hq-sub', 'L\'abbinamento vale anche per i prossimi import.'));
}

function runCard(o, p, reload) {
  const files = h('input', { type: 'file', multiple: true, 'aria-label': 'File del pacchetto' });
  const prog = h('span.hq-sub');
  files.addEventListener('change', async () => {
    let n = 0;
    for (const f of files.files) {
      prog.textContent = `Carico ${++n} di ${files.files.length}…`;
      const base64 = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = ko; r.readAsDataURL(f); });
      try { await post(`/api/hqse/import/${o.import.id}/file`, { file_key: f.name, nome: f.name, mime: f.type || 'application/octet-stream', base64 }); } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
    }
    toast(`${n} file caricati`); reload();
  });
  const go = prova => async e => {
    const b = e.currentTarget;
    b.disabled = true;
    toast(prova ? 'Prova in corso…' : 'Import in corso: può durare qualche minuto');
    try { const r = await post(`/api/hqse/import/${o.import.id}/esegui`, prova ? { prova } : {}); toast(`Importati ${r.fornitori} fornitori e ${r.documenti} documenti`); reload(); } catch (err) { b.disabled = false; toast(err.message, 'err'); }
  };
  const ready = !o.match.dubbio;
  return card({ title: 'Prima di importare', icon: 'check' },
    h('div.hq-ev', h('span', 'Contratto Si&T: dati di Almacis, export dovuto'), pill('Da verificare', 'am')),
    h('div.hq-ev', h('span', 'Fornitori da guardare'), o.match.dubbio ? pill(`${o.match.dubbio} da abbinare`, 'am') : pill('Fatto', 'gr')),
    h('div.hq-ev', h('span', `File arrivati: ${num(p.file.arrivati)} su ${num(p.file.indicati)}`), h('label.btn.btn-sm.hq-file', files, 'Aggiungi file')),
    prog,
    h('p.hq-sub', 'Si importano solo i documenti approvati e ancora validi, con il loro file. Gli scaduti e i mancanti li carica il fornitore. Nessuna email parte finché non mandi il benvenuto.'),
    h('div.hq-acts', h('button.btn', { type: 'button', on: { click: go(10) } }, 'Prova su 10 fornitori'), h('button.btn.btn-primary', { type: 'button', disabled: !ready, on: { click: go(null) } }, 'Importa tutto')));
}

function uploadStep(box, list, fresh = false) {
  let source = 'export';
  const inputs = { fornitori: null, dipendenti: null, documenti: null };
  const pickers = Object.keys(inputs).map(k => {
    const inp = h('input.input', { type: 'file', accept: '.csv,text/csv', 'aria-label': `${k}.csv` });
    inputs[k] = inp;
    return fld(`${k}.csv`, inp, { fornitori: 'id_vittoria; denominazione; partita_iva; codice_fiscale; email; referente; telefono; citta; stato; categoria', dipendenti: 'id_vittoria; id_fornitore; nome; cognome; codice_fiscale; assunto_il; attivo', documenti: 'id_vittoria; id_fornitore; id_dipendente; documento; stato; data_documento; scadenza; file' }[k]);
  });
  const ok = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    const body = { source };
    for (const [k, inp] of Object.entries(inputs)) body[k] = inp.files[0] ? await inp.files[0].text() : '';
    if (!body.fornitori) return toast('Serve almeno fornitori.csv', 'err');
    ok.disabled = true;
    try { const o = await post('/api/hqse/import', body); toast('Pacchetto caricato'); importPage(box, o.import.id); } catch (e) { ok.disabled = false; toast(e.message, 'err'); }
  } } }, 'Carica e abbina');
  fill(box,
    top('Impostazioni · Import da Vittoria', 'Porta dentro', 'i fornitori di Vittoria', 'Anagrafiche, dipendenti attivi e documenti approvati ancora validi. Gli scaduti e i mancanti li carica il fornitore nel portale.',
      [list.length && fresh ? h('button.btn', { type: 'button', on: { click: () => importPage(box) } }, 'Torna all\'ultimo import') : null]),
    steps(1),
    h('div.hq-two',
      card({ title: 'Da dove arrivano i dati', icon: 'file-text' },
        seg([['export', 'Export di Si&T'], ['api', 'API di Vittoria'], ['script', 'Script']], source, k => { source = k; }, { label: 'Origine' }),
        h('div.hq-form', pickers),
        h('p.hq-sub', 'Il pacchetto è sempre lo stesso, da qualunque parte arrivi: tre file CSV (separati da ; o ,) e i file dei documenti, che si aggiungono al passo dopo. Le intestazioni possono essere anche quelle di Vittoria (Ragione sociale, Partita IVA…).'),
        h('div.hq-acts', ok)),
      card({ title: 'Prima di importare', icon: 'check' },
        h('div.hq-ev', h('span', 'Contratto Si&T: di chi sono i dati, export dovuto'), pill('Da verificare', 'am')),
        h('div.hq-ev', h('span', 'Checklist e tipi di documento in Alma'), pill('Pronti', 'gr')),
        h('div.hq-ev', h('span', 'Una prova su 10 fornitori prima di tutto'), pill('Consigliata', 'line')),
        list.length ? h('div', h('p.hq-sub', 'Import precedenti'), list.map(x => h('a.hq-ev', { href: '#/hqse/import', on: { click: e => { e.preventDefault(); importPage(box, x.id); } } },
          h('span', `${fmtDateTime(x.created_at)} · ${x.counts.fornitori || 0} fornitori`), pill(x.status === 'importato' ? 'Importato' : 'Da importare', x.status === 'importato' ? 'gr' : 'am')))) : null)));
}

// ── Passaggio al portale (tavola 28) ────────────────────────────────────────────────────────────
export async function passaggioPage(box) {
  const b = await get('/api/hqse/benvenuto');
  const t = b.totals;
  const reload = () => passaggioPage(box);
  const pct = t.invitati ? Math.round((t.entrati / t.invitati) * 100) : 0;
  const next = b.waves.find(w => !w.sent_at);
  const newWave = () => {
    let criterio = 'cantieri';
    const when = h('input.input', { type: 'date' });
    const ok = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      ok.disabled = true;
      try { const r = await post('/api/hqse/benvenuto/ondate', { criterio, planned_on: when.value || null }); m.close(); toast(`Ondata con ${r.fornitori} fornitori`); reload(); } catch (e) { ok.disabled = false; toast(e.message, 'err'); }
    } } }, 'Prepara l\'ondata');
    const m = cvModal({
      title: 'Nuova ondata di benvenuto',
      body: h('div.hq-form',
        h('div.cv-fld', h('span', 'Chi'), seg([['cantieri', 'Fornitori dei cantieri aperti'], ['scadenze', 'Documenti in scadenza entro 60 giorni'], ['tutti', 'Tutti gli altri']], criterio, k => { criterio = k; }, { label: 'Chi' })),
        fld('Quando (promemoria)', when),
        h('p.hq-sub', `Fornitori importati ancora senza ondata: ${b.da_assegnare}.`)),
      actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
    });
  };
  const send = w => async e => {
    if (!confirm(`Mandare l'email di benvenuto ai ${w.n} fornitori dell'ondata «${w.name}»?`)) return;
    e.currentTarget.disabled = true;
    try { const r = await post(`/api/hqse/benvenuto/ondate/${w.id}/manda`, {}); toast(`Mandate ${r.email} email${r.senza_email ? `; ${r.senza_email} fornitori senza email del referente` : ''}`); reload(); } catch (err) { toast(err.message, 'err'); }
  };
  const preview = async () => {
    const p = await get('/api/hqse/benvenuto/anteprima');
    if (!p.html) return toast('Nessun fornitore importato', 'err');
    const frame = h('iframe', { title: 'Anteprima dell\'email', style: { width: '100%', height: '460px', border: '1px solid var(--cv-line)', borderRadius: '12px', background: '#fff' } });
    frame.srcdoc = p.html;
    cvModal({ title: `Oggetto: ${p.subject}`, body: h('div', h('p.hq-sub', `Esempio con ${p.supplier}`), frame), actions: [] });
  };
  fill(box,
    top('Impostazioni · Passaggio al portale', 'Benvenuto', 'a ondate', 'Un\'ondata alla volta, così HQSE regge le domande dei fornitori. Il primo accesso è con il link; dopo 30 giorni con il codice via email.',
      [h('button.btn', { type: 'button', on: { click: preview } }, 'Anteprima dell\'email'),
        next ? h('button.btn.btn-primary', { type: 'button', on: { click: send(next) } }, 'Manda la prossima ondata') : h('button.btn.btn-primary', { type: 'button', on: { click: newWave } }, ic('plus', 16), 'Nuova ondata')]),
    steps(4),
    h('section.hq-tiles',
      tile('Invitati', `${num(t.invitati)} / ${num(t.importati)}`, `${b.waves.filter(w => w.sent_at).length} ondate mandate`, true),
      tile('Entrati nel portale', num(t.entrati), t.invitati ? `${pct}% degli invitati` : 'dopo il primo invito'),
      tile('Hanno caricato', num(t.caricato), 'almeno un documento'),
      tile('Mai entrati dopo 7 giorni', num(t.mai_entrati), 'secondo invito in automatico')),
    h('div.hq-two',
      card({ title: 'Ondate', icon: 'send', count: b.waves.length, right: next ? h('button.btn.btn-sm', { type: 'button', on: { click: newWave } }, 'Nuova ondata') : null },
        b.waves.length ? h('div.hq-scroll', h('table.hq-t',
          h('thead', h('tr', h('th', 'Ondata'), h('th', 'Fornitori'), h('th', 'Quando'), h('th', 'Entrati'), h('th', ''))),
          h('tbody', b.waves.map(w => h('tr', h('td', h('b', w.name)), h('td', num(w.n)),
            h('td.hq-sub', w.sent_at ? `mandata ${fmtDateTime(w.sent_at)}` : w.planned_on ? `prevista ${fmtDate(w.planned_on)}` : 'da mandare'),
            h('td', w.sent_at ? pill(`${w.entrati} su ${w.n}`, w.entrati * 2 >= w.n ? 'gr' : 'am') : pill('Da mandare', 'line')),
            h('td', w.sent_at ? null : h('button.btn.btn-sm', { type: 'button', on: { click: send(w) } }, 'Manda')))))))
          : emptyState('send', b.da_assegnare ? 'Prepara la prima ondata: di solito i fornitori dei cantieri aperti.' : 'Prima importa i fornitori da Vittoria.', b.da_assegnare ? h('button.btn.btn-primary', { type: 'button', on: { click: newWave } }, 'Nuova ondata') : h('a.btn', { href: '#/hqse/import' }, 'Vai all\'import'))),
      h('div.hq-col',
        card({ title: 'Doppio binario', icon: 'repeat' },
          h('div.hq-ev', h('span', 'Fornitori nuovi'), h('span.hq-sub', 'solo dal widget di Alma')),
          h('div.hq-ev', h('span', 'Fornitori già in Vittoria'), h('span.hq-sub', 'su Vittoria fino al loro benvenuto')),
          h('div.hq-ev', h('span', 'Reminder delle scadenze'), h('span.hq-sub', 'dal giorno dopo il benvenuto')),
          h('div.hq-ev', h('span', 'Spegnere la qualifica su Vittoria'), pill(b.da_assegnare || next ? 'dopo l\'ultima ondata' : 'si può fare', b.da_assegnare || next ? 'am' : 'gr'))),
        t.senza_email ? card({ title: 'Senza email del referente', icon: 'triangle', count: t.senza_email }, h('p.hq-sub', 'Non ricevono il benvenuto: aggiungi il referente dalla scheda del fornitore con «Invita al portale».'), h('a.btn.btn-sm', { href: '#/hqse/fornitori' }, 'Vai ai fornitori')) : null)));
}
