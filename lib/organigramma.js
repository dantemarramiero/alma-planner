// Organigramma a incarichi (come BOSS: ADR-0015 emendamento del 23/10, spec boss/docs/product/organigramma.md), PURO:
// nessun accesso al database. Riceve le righe e restituisce il modello, «chi approva», i «da sistemare», i controlli e
// l'effetto di ogni azione (per l'anteprima e per l'applicazione).
//
// Regole:
// - le frecce uniscono gli incarichi; chi non ricopre incarichi riporta a un incarico (non a una persona);
// - una persona può ricoprire più incarichi, uno è il principale: le sue richieste partono da lì;
// - niente cicli fra incarichi; l'incarico a cui si riporta ha un livello più alto (ordine minore), si possono saltare livelli;
// - chi approva: si sale di incarico in incarico fino al primo che approva, è ricoperto e non è ricoperto dal richiedente;
//   vacanti, incarichi che non approvano o ricoperti dal richiedente si attraversano; il vertice ha le richieste già
//   approvate; un esterno che approva senza account manda la richiesta al personale; senza nessuno: al personale.

const norm = s => String(s || '').trim().toLowerCase();

// state = { aree, livelli, incarichi, entra, persone, accounts }
//   aree: [{id,nome,tipo,ordine,attiva,centro_costo}] · livelli: [{id,nome,ordine,approva,attivo}]
//   incarichi: [{id,nome,area_id,livello_id,riporta_a_id,ricoperto_da,responsabile_area,attivo}]
//   entra: [{oid,name,email,job_title,department}] · persone: [{email,nome,esterno,riporta_a_incarico_id,incarico_principale_id,area_id}]
//   accounts: Set di email che sono entrate in Alma Space
function build(state) {
  const livelli = new Map(state.livelli.map(l => [l.id, l]));
  const aree = new Map(state.aree.map(a => [a.id, a]));
  const incarichi = new Map(state.incarichi.filter(i => i.attivo !== false).map(i => [i.id, { ...i, figli: [], riporti: [] }]));
  const persone = new Map();
  const persona = email => {
    const e = norm(email);
    if (!persone.has(e)) persone.set(e, { email: e, nome: e, esterno: false, inEntra: false, incarichi: [], riporta_a_incarico_id: null, incarico_principale_id: null, area_id: null });
    return persone.get(e);
  };
  for (const p of state.entra) if (p.email) Object.assign(persona(p.email), { nome: p.name || p.email, inEntra: true, jobTitle: p.job_title || null, department: p.department || null, oid: p.oid });
  for (const p of state.persone) {
    const x = persona(p.email);
    if (p.nome && !x.inEntra) x.nome = p.nome;
    Object.assign(x, { esterno: !!p.esterno, riporta_a_incarico_id: p.riporta_a_incarico_id ?? null, incarico_principale_id: p.incarico_principale_id ?? null, area_id: p.area_id ?? null });
  }
  for (const i of incarichi.values()) {
    if (i.riporta_a_id && incarichi.has(i.riporta_a_id)) incarichi.get(i.riporta_a_id).figli.push(i.id);
    if (i.ricoperto_da) persona(i.ricoperto_da).incarichi.push(i.id);
  }
  for (const p of persone.values()) {
    if (p.incarichi.length === 0 && p.riporta_a_incarico_id && incarichi.has(p.riporta_a_incarico_id)) incarichi.get(p.riporta_a_incarico_id).riporti.push(p.email);
    p.account = state.accounts?.has(p.email) || false;
  }
  const ordineDi = id => livelli.get(incarichi.get(id)?.livello_id)?.ordine ?? null;
  const approva = id => !!livelli.get(incarichi.get(id)?.livello_id)?.approva;
  const principaleDi = p => (p.incarichi.includes(p.incarico_principale_id) ? p.incarico_principale_id : p.incarichi.slice().sort((a, b) => (ordineDi(a) ?? 99) - (ordineDi(b) ?? 99) || a - b)[0]) ?? null;
  // vertice: l'incarico senza «riporta a» al livello più alto (a parità, il primo creato)
  const radici = [...incarichi.values()].filter(i => !i.riporta_a_id || !incarichi.has(i.riporta_a_id));
  radici.sort((a, b) => (ordineDi(a.id) ?? 99) - (ordineDi(b.id) ?? 99) || a.id - b.id);
  const vertice = radici[0]?.id ?? null;
  return { livelli, aree, incarichi, persone, ordineDi, approva, principaleDi, radici: radici.map(r => r.id), vertice };
}

// Chi approva le richieste di una persona: { tipo: 'incarico'|'vertice'|'personale', incaricoId?, email?, nome?, motivo? }
function chiApprova(m, email) {
  const p = m.persone.get(norm(email));
  if (!p) return { tipo: 'personale', motivo: 'non è nell\'organigramma' };
  const principale = m.principaleDi(p);
  let cur;
  if (principale) {
    if (principale === m.vertice) return { tipo: 'vertice' };
    cur = m.incarichi.get(principale).riporta_a_id;
  } else cur = p.riporta_a_incarico_id;
  if (!cur || !m.incarichi.has(cur)) return { tipo: 'personale', motivo: principale ? 'il suo incarico non riporta a nessuno' : 'non riporta a nessun incarico' };
  const visti = new Set();
  while (cur && m.incarichi.has(cur) && !visti.has(cur)) {
    visti.add(cur);
    const inc = m.incarichi.get(cur);
    if (m.approva(cur) && inc.ricoperto_da && norm(inc.ricoperto_da) !== p.email) {
      const chi = m.persone.get(norm(inc.ricoperto_da));
      if (chi?.esterno && !chi.account) return { tipo: 'personale', motivo: `${chi.nome} approva ma non ha un account`, incaricoId: cur };
      return { tipo: 'incarico', incaricoId: cur, email: chi?.email, nome: chi?.nome || inc.ricoperto_da };
    }
    cur = inc.riporta_a_id;
  }
  return { tipo: 'personale', motivo: 'salendo non c\'è chi approva' };
}

// Le cose da sistemare, con il motivo: incarichi e persone fuori regola.
function daSistemare(m) {
  const out = [];
  for (const i of m.incarichi.values()) {
    if (!i.livello_id || !m.livelli.has(i.livello_id)) out.push({ tipo: 'incarico', id: i.id, nome: i.nome, motivo: 'senza_livello', testo: 'senza livello' });
    if (i.id !== m.vertice && (!i.riporta_a_id || !m.incarichi.has(i.riporta_a_id))) out.push({ tipo: 'incarico', id: i.id, nome: i.nome, motivo: 'senza_riporto', testo: 'non riporta a nessun incarico' });
    const chi = i.ricoperto_da ? m.persone.get(norm(i.ricoperto_da)) : null;
    if (chi?.esterno && !chi.account && m.approva(i.id)) out.push({ tipo: 'incarico', id: i.id, nome: i.nome, motivo: 'esterno_senza_account', testo: `${chi.nome} approva ma non ha un account`, email: chi.email });
  }
  for (const p of m.persone.values()) {
    if (p.incarichi.length === 0 && (!p.riporta_a_incarico_id || !m.incarichi.has(p.riporta_a_incarico_id)) && (p.inEntra || p.esterno)) {
      out.push({ tipo: 'persona', email: p.email, nome: p.nome, motivo: 'persona_senza_riporto', testo: 'non riporta a nessun incarico' });
    }
  }
  return out;
}

// Persone nel ramo sotto un incarico (incarichi sotto e chi riporta a loro), una volta sola.
function nelRamo(m, id) {
  const visti = new Set();
  const persone = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    if (visti.has(cur)) continue;
    visti.add(cur);
    const inc = m.incarichi.get(cur);
    if (!inc) continue;
    for (const e of inc.riporti) persone.add(e);
    for (const f of inc.figli) {
      const fi = m.incarichi.get(f);
      if (fi?.ricoperto_da) persone.add(norm(fi.ricoperto_da));
      stack.push(f);
    }
  }
  return persone.size;
}

// ── controlli ─────────────────────────────────────────────────────────────────────────────────────────
function erroriIncarico(m, id) {
  const e = [];
  const inc = m.incarichi.get(id);
  if (!inc) return e;
  // ciclo: salendo dal padre non si deve tornare qui
  const visti = new Set([id]);
  let cur = inc.riporta_a_id;
  while (cur) {
    if (visti.has(cur)) { e.push(`«${inc.nome}» finirebbe in un giro: un incarico non può riportare a uno che sta sotto di lui`); break; }
    visti.add(cur);
    cur = m.incarichi.get(cur)?.riporta_a_id;
  }
  // livello stretto con il padre e con i figli
  const mio = m.ordineDi(id);
  const padre = inc.riporta_a_id ? m.ordineDi(inc.riporta_a_id) : null;
  if (mio != null && padre != null && padre >= mio) e.push(`«${inc.nome}» riporta a «${m.incarichi.get(inc.riporta_a_id).nome}», che non sta a un livello più alto`);
  for (const f of inc.figli) {
    const of = m.ordineDi(f);
    if (mio != null && of != null && of <= mio) e.push(`«${m.incarichi.get(f).nome}» riporta qui ma starebbe allo stesso livello o più in alto`);
  }
  return e;
}
function erroriTutti(m) {
  const out = new Set();
  for (const id of m.incarichi.keys()) for (const e of erroriIncarico(m, id)) out.add(e);
  return [...out];
}

// ── azioni ────────────────────────────────────────────────────────────────────────────────────────────
// applica(state, azione) → { state (nuovo), errori, etichetta, oggetto, prima, dopo }. Non tocca lo state ricevuto.
const clone = s => ({ ...s, aree: s.aree.map(x => ({ ...x })), livelli: s.livelli.map(x => ({ ...x })), incarichi: s.incarichi.map(x => ({ ...x })), persone: s.persone.map(x => ({ ...x })) });
function applica(state, a) {
  const s = clone(state);
  const errori = [];
  const inc = id => s.incarichi.find(i => i.id === Number(id) && i.attivo !== false);
  const pers = email => {
    const e = norm(email);
    let p = s.persone.find(x => norm(x.email) === e);
    if (!p) { p = { email: e, nome: null, esterno: false, riporta_a_incarico_id: null, incarico_principale_id: null, area_id: null, _nuova: true }; s.persone.push(p); }
    return p;
  };
  const esiste = email => state.entra.some(p => norm(p.email) === norm(email)) || state.persone.some(p => norm(p.email) === norm(email));
  const nomeInc = id => inc(id)?.nome || '—';
  const m0 = build(state);
  const nomeP = email => m0.persone.get(norm(email))?.nome || email;
  let etichetta = '', oggetto = '', prima = null, dopo = null, touchedInc = null;
  switch (a.azione) {
    case 'creaIncarico': {
      const nome = String(a.nome || '').trim();
      if (!nome) { errori.push('Scrivi il nome dell\'incarico'); break; }
      if (s.incarichi.some(i => i.attivo !== false && norm(i.nome) === norm(nome))) { errori.push(`C'è già un incarico «${nome}»`); break; }
      if (a.ricopertoDaPersonaleId && !esiste(a.ricopertoDaPersonaleId)) { errori.push('Questa persona non è né in Entra né tra gli esterni'); break; }
      const id = Math.max(0, ...s.incarichi.map(i => i.id)) + 1;
      s.incarichi.push({ id, nome, area_id: a.businessUnitId || null, livello_id: a.livelloOrganigrammaId || null, riporta_a_id: a.riportaAIncaricoId || null,
        ricoperto_da: a.ricopertoDaPersonaleId ? norm(a.ricopertoDaPersonaleId) : null, responsabile_area: !!a.responsabileArea, attivo: true, _nuovo: true });
      etichetta = 'Nuovo incarico'; oggetto = nome; touchedInc = id;
      dopo = { riporta_a: a.riportaAIncaricoId ? nomeInc(a.riportaAIncaricoId) : 'vertice', ricoperto_da: a.ricopertoDaPersonaleId ? nomeP(a.ricopertoDaPersonaleId) : 'vacante' };
      break;
    }
    case 'modificaIncarico': {
      const i = inc(a.incaricoId);
      if (!i) { errori.push('Incarico non trovato'); break; }
      prima = { nome: i.nome, area: m0.aree.get(i.area_id)?.nome || '—', responsabile_area: i.responsabile_area };
      if (a.nome !== undefined) {
        const nome = String(a.nome).trim();
        if (!nome) errori.push('Il nome non può restare vuoto');
        else if (s.incarichi.some(x => x.id !== i.id && x.attivo !== false && norm(x.nome) === norm(nome))) errori.push(`C'è già un incarico «${nome}»`);
        else i.nome = nome;
      }
      if (a.businessUnitId !== undefined) i.area_id = a.businessUnitId || null;
      if (a.responsabileArea !== undefined) i.responsabile_area = !!a.responsabileArea;
      dopo = { nome: i.nome, area: m0.aree.get(i.area_id)?.nome || '—', responsabile_area: i.responsabile_area };
      etichetta = 'Incarico modificato'; oggetto = i.nome; touchedInc = i.id;
      break;
    }
    case 'cambiaRicopertoDa': {
      const i = inc(a.incaricoId);
      if (!i) { errori.push('Incarico non trovato'); break; }
      const nuovo = a.ricopertoDaPersonaleId ? norm(a.ricopertoDaPersonaleId) : null;
      if (nuovo && !esiste(nuovo)) { errori.push('Questa persona non è né in Entra né tra gli esterni'); break; }
      prima = { ricoperto_da: i.ricoperto_da ? nomeP(i.ricoperto_da) : 'vacante' };
      i.ricoperto_da = nuovo;
      dopo = { ricoperto_da: nuovo ? nomeP(nuovo) : 'vacante' };
      etichetta = 'Cambiato chi ricopre l\'incarico'; oggetto = i.nome; touchedInc = i.id;
      break;
    }
    case 'cambiaRiportoIncarico': {
      const i = inc(a.incaricoId);
      if (!i) { errori.push('Incarico non trovato'); break; }
      if (a.riportaAIncaricoId && Number(a.riportaAIncaricoId) === i.id) { errori.push('Un incarico non riporta a sé stesso'); break; }
      if (a.riportaAIncaricoId && !inc(a.riportaAIncaricoId)) { errori.push('L\'incarico a cui riportare non c\'è'); break; }
      prima = { riporta_a: i.riporta_a_id ? nomeInc(i.riporta_a_id) : 'nessuno', livello: m0.livelli.get(i.livello_id)?.nome || '—' };
      if (a.riportaAIncaricoId !== undefined) i.riporta_a_id = a.riportaAIncaricoId ? Number(a.riportaAIncaricoId) : null;
      if (a.livelloOrganigrammaId !== undefined) i.livello_id = a.livelloOrganigrammaId ? Number(a.livelloOrganigrammaId) : null;
      dopo = { riporta_a: i.riporta_a_id ? nomeInc(i.riporta_a_id) : 'nessuno', livello: s.livelli.find(l => l.id === i.livello_id)?.nome || '—' };
      etichetta = 'Cambiati riporto e livello'; oggetto = i.nome; touchedInc = i.id;
      break;
    }
    case 'cambiaRiportoPersona': {
      if (!esiste(a.email)) { errori.push('Persona non trovata'); break; }
      if (a.riportaAIncaricoId && !inc(a.riportaAIncaricoId)) { errori.push('L\'incarico a cui riportare non c\'è'); break; }
      const p = pers(a.email);
      prima = { riporta_a: p.riporta_a_incarico_id ? nomeInc(p.riporta_a_incarico_id) : 'nessuno' };
      p.riporta_a_incarico_id = a.riportaAIncaricoId ? Number(a.riportaAIncaricoId) : null;
      dopo = { riporta_a: p.riporta_a_incarico_id ? nomeInc(p.riporta_a_incarico_id) : 'nessuno' };
      etichetta = 'Cambiato a chi riporta'; oggetto = nomeP(a.email);
      break;
    }
    case 'impostaPrincipale': {
      const i = inc(a.incaricoId);
      if (!i || norm(i.ricoperto_da) !== norm(a.email)) { errori.push('La persona non ricopre questo incarico'); break; }
      const p = pers(a.email);
      prima = { principale: p.incarico_principale_id ? nomeInc(p.incarico_principale_id) : '—' };
      p.incarico_principale_id = i.id;
      dopo = { principale: i.nome };
      etichetta = 'Cambiato l\'incarico principale'; oggetto = nomeP(a.email);
      break;
    }
    case 'areaPersona': {
      if (!esiste(a.email)) { errori.push('Persona non trovata'); break; }
      const p = pers(a.email);
      prima = { area: m0.aree.get(p.area_id)?.nome || '—' };
      p.area_id = a.businessUnitId ? Number(a.businessUnitId) : null;
      dopo = { area: s.aree.find(x => x.id === p.area_id)?.nome || '—' };
      etichetta = 'Cambiata l\'area della persona'; oggetto = nomeP(a.email);
      break;
    }
    case 'disattivaIncarico': {
      const i = inc(a.incaricoId);
      if (!i) { errori.push('Incarico non trovato'); break; }
      const figli = s.incarichi.filter(x => x.attivo !== false && x.riporta_a_id === i.id).map(x => x.nome);
      const riporti = s.persone.filter(p => p.riporta_a_incarico_id === i.id).length;
      if (figli.length || riporti) { errori.push(`Prima sposta chi riporta a «${i.nome}»: ${[...figli, riporti ? `${riporti} persone` : null].filter(Boolean).join(', ')}`); break; }
      i.attivo = false;
      etichetta = 'Incarico disattivato'; oggetto = i.nome; prima = { attivo: true }; dopo = { attivo: false };
      break;
    }
    case 'registraEsterno': {
      const email = norm(a.email);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { errori.push('Email non valida'); break; }
      if (esiste(email)) { errori.push('Questa persona c\'è già'); break; }
      const nome = String(a.nome || '').trim();
      if (!nome) { errori.push('Scrivi nome e cognome'); break; }
      s.persone.push({ email, nome, esterno: true, riporta_a_incarico_id: null, incarico_principale_id: null, area_id: null, _nuova: true });
      etichetta = 'Persona esterna aggiunta'; oggetto = nome; dopo = { email, esterno: true };
      break;
    }
    default: errori.push('Azione sconosciuta');
  }
  if (!errori.length && touchedInc) {
    const m1 = build(s);
    errori.push(...erroriIncarico(m1, touchedInc));
    // un cambio di livello tocca anche i figli; un cambio di riporto anche il padre: li ricontrolla erroriIncarico
  }
  return { state: s, errori, etichetta, oggetto, prima, dopo };
}

// Chi cambia approvatore fra due stati: [{email, nome, prima, dopo}]
function differenze(stPrima, stDopo) {
  const a = build(stPrima), b = build(stDopo);
  const descr = (m, r) => (r.tipo === 'incarico' ? `${r.nome} (${m.incarichi.get(r.incaricoId)?.nome || ''})` : r.tipo === 'vertice' ? 'già approvate (vertice)' : `al personale · ${r.motivo}`);
  const out = [];
  const emails = new Set([...a.persone.keys(), ...b.persone.keys()]);
  for (const e of emails) {
    const pa = a.persone.get(e), pb = b.persone.get(e);
    if (!(pa?.inEntra || pa?.esterno || pa?.incarichi.length) && !(pb?.inEntra || pb?.esterno || pb?.incarichi.length)) continue;
    const ra = chiApprova(a, e), rb = chiApprova(b, e);
    const da = descr(a, ra), db = descr(b, rb);
    if (da !== db) out.push({ email: e, nome: (pb || pa).nome, prima: da, dopo: db });
  }
  return out;
}

module.exports = { build, chiApprova, daSistemare, nelRamo, erroriIncarico, erroriTutti, applica, differenze, norm };
