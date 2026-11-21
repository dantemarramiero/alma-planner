// Alma HR, Fase 2 (canvas «Alma HR», pagina «Fase 2 · organigramma», 21/11/2026): logica pura.
// Regola di Dante: in Alma organigramma e persone sono solo da vedere, il data entry si fa su BOSS.
// - Scenari: le modifiche si applicano in ordine a una copia degli incarichi; l'organigramma vero non cambia mai.
// - Passi da fare su BOSS per realizzare uno scenario.
// - Numeri dell'organigramma (persone, vacanti, senza ruolo, span, grade medio).
// - Eventi: cosa è cambiato fra due copie di BOSS.
// - Collegamento con Alma Strategy: per un ruolo scritto in Strategy, il ruolo HR più simile.
const { norm } = require('./hr');

const round1 = n => Math.round(n * 10) / 10;

//   { tipo: 'nuovo', tmp: 'n1', nome, area_id, riporta_a_id, role_id } · { tipo: 'riporto', incarico_id, riporta_a_id }
//   { tipo: 'ruolo', incarico_id, role_id } · { tipo: 'disattiva', incarico_id }
function applyScenario(incarichi, changes = []) {
  const list = incarichi.map(i => ({ ...i }));
  const byId = id => list.find(i => String(i.id) === String(id));
  const errors = [];
  changes.forEach((c, n) => {
    if (c.tipo === 'nuovo') {
      if (!c.nome) { errors.push(`Passo ${n + 1}: manca il nome`); return; }
      list.push({ id: c.tmp || `n${n}`, nome: c.nome, area_id: c.area_id ?? null, riporta_a_id: c.riporta_a_id ?? null, role_id: c.role_id ?? null, persona: null, nuovo: true, cambiato: true });
      return;
    }
    const i = byId(c.incarico_id);
    if (!i) { errors.push(`Passo ${n + 1}: incarico non trovato`); return; }
    if (c.tipo === 'riporto') {
      let cur = c.riporta_a_id;
      const seen = new Set();
      while (cur != null) {
        if (String(cur) === String(i.id)) { errors.push(`Passo ${n + 1}: «${i.nome}» finirebbe per riportare a sé stesso`); return; }
        if (seen.has(String(cur))) break;
        seen.add(String(cur));
        cur = byId(cur)?.riporta_a_id ?? null;
      }
      i.riporta_a_id = c.riporta_a_id ?? null;
      i.cambiato = true;
    } else if (c.tipo === 'ruolo') { i.role_id = c.role_id ?? null; i.cambiato = true; }
    else if (c.tipo === 'disattiva') { i.disattivato = true; i.cambiato = true; }
  });
  return { incarichi: list.filter(i => !i.disattivato), disattivati: list.filter(i => i.disattivato), errors };
}

// I passi da fare su BOSS, in ordine: prima si creano gli incarichi, poi riporti e disattivazioni.
// I cambi di ruolo del mansionario non riguardano BOSS: si fanno in Alma HR.
function bossSteps(incarichi, changes = []) {
  const name = id => incarichi.find(i => String(i.id) === String(id))?.nome || changes.find(c => c.tmp === id)?.nome || 'incarico';
  const out = [];
  for (const c of changes.filter(x => x.tipo === 'nuovo')) out.push(`Crea l'incarico «${c.nome}»${c.riporta_a_id != null ? ` sotto «${name(c.riporta_a_id)}»` : ''} (vacante)`);
  for (const c of changes.filter(x => x.tipo === 'riporto')) out.push(`Sposta «${name(c.incarico_id)}» sotto «${c.riporta_a_id != null ? name(c.riporta_a_id) : 'nessuno: diventa il vertice'}»`);
  for (const c of changes.filter(x => x.tipo === 'disattiva')) out.push(`Disattiva l'incarico «${name(c.incarico_id)}»`);
  return out;
}

function orgStats(incarichi, roleGrade = () => null) {
  const capi = new Map();
  for (const i of incarichi) if (i.riporta_a_id != null) capi.set(String(i.riporta_a_id), (capi.get(String(i.riporta_a_id)) || 0) + 1);
  const grades = incarichi.map(i => roleGrade(i.role_id)).filter(Boolean);
  return {
    incarichi: incarichi.length, persone: incarichi.filter(i => i.persona).length, vacanti: incarichi.filter(i => !i.persona).length,
    senza_ruolo: incarichi.filter(i => !i.role_id).length,
    span: capi.size ? round1([...capi.values()].reduce((a, b) => a + b, 0) / capi.size) : 0,
    grade_medio: grades.length ? round1(grades.reduce((a, b) => a + b, 0) / grades.length) : null,
  };
}

// before/after: { incarichi: [{ boss_id, nome, riporta_a, ricoperto_da }], persone: [{ key, nome, cognome, ral }] }
function diffOrg(before, after) {
  const ev = [];
  const b = new Map(before.incarichi.map(i => [i.boss_id, i]));
  const a = new Map(after.incarichi.map(i => [i.boss_id, i]));
  for (const [id, i] of a) {
    const o = b.get(id);
    if (!o) { ev.push({ tipo: 'incarico_nuovo', boss_id: id, oggetto: i.nome, azione: 'scegliere il ruolo del mansionario' }); continue; }
    if (String(o.riporta_a ?? '') !== String(i.riporta_a ?? '')) ev.push({ tipo: 'riporto', boss_id: id, oggetto: i.nome });
    if ((o.ricoperto_da || '') !== (i.ricoperto_da || '')) {
      ev.push(i.ricoperto_da ? { tipo: 'ricoperto', boss_id: id, oggetto: i.nome } : { tipo: 'vacante', boss_id: id, oggetto: i.nome, azione: 'richiesta di personale (Fase 3)' });
    }
  }
  for (const [id, o] of b) if (!a.has(id)) ev.push({ tipo: 'incarico_disattivato', boss_id: id, oggetto: o.nome });
  const pb = new Map(before.persone.map(p => [p.key, p]));
  const pa = new Map(after.persone.map(p => [p.key, p]));
  for (const [k, p] of pa) {
    const o = pb.get(k);
    if (!o) ev.push({ tipo: 'persona_entrata', person_key: k, oggetto: `${p.nome} ${p.cognome}`.trim(), azione: 'ruolo del mansionario e onboarding (Fase 4)' });
    else if (o.ral && p.ral && Number(o.ral) !== Number(p.ral)) ev.push({ tipo: 'ral', person_key: k, oggetto: `${p.nome} ${p.cognome}`.trim() });
  }
  for (const [k, o] of pb) if (!pa.has(k)) ev.push({ tipo: 'persona_uscita', person_key: k, oggetto: `${o.nome} ${o.cognome}`.trim() });
  return ev;
}

const STOP = new Set(['di', 'del', 'della', 'e', 'a', 'in', 'the', 'of']);
const words = t => norm(t).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
const ALIAS = [
  [/\bcio\b|\bcfo\b|\bcto\b|\bchro\b|direttor/, 'direttore di funzione'],
  [/responsabil.*(acquist|ufficio|\bit\b|\bhr\b|qhse|personale|gare|amministrazione)/, 'responsabile di funzione'],
  [/addett|impiegat|amministrativ|segreteri/, 'impiegato'],
  [/buyer|specialist|analyst|controller|developer|sviluppat|architect/, 'specialist di funzione'],
  [/progettist|\bbim\b|\bmep\b/, 'progettista'],
  [/gestore di commessa|project manager|\bpm\b/, 'project manager'],
  [/assistente (di )?commessa/, 'assistente di commessa'],
  [/capo cantiere|capo squadr/, 'capo cantiere / tecnico esperto'],
];
function suggestHrRole(title, roles) {
  const t = norm(title);
  const alias = ALIAS.find(([re]) => re.test(t))?.[1];
  const tw = new Set([...words(t), ...(alias ? words(alias) : [])]);
  let best = null;
  let score = 0;
  for (const r of roles) {
    const rw = words(`${r.hr_name} ${r.hr_level || ''}`);
    const common = rw.filter(w => tw.has(w)).length;
    if (!common) continue;
    const sc = common / rw.length + (alias && norm(r.hr_name) === alias ? 1 : 0) + (norm(r.hr_level) === 'intermedio' || !r.hr_level ? 0.05 : 0);
    if (sc > score) { score = sc; best = r; }
  }
  return best;
}

module.exports = { applyScenario, bossSteps, orgStats, diffOrg, suggestHrRole };
