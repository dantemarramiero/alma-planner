// Alma HR, Fase 2 (canvas «Alma HR», pagina «Fase 2 · organigramma», 21/11/2026): logica pura.
// Regola di Dante: in Alma organigramma e persone sono solo da vedere, il data entry si fa su BOSS.
// - Scenari: le modifiche si applicano in ordine a una copia degli incarichi; l'organigramma vero non cambia mai.
// - Numeri dell'organigramma (persone, vacanti, senza ruolo, span, grade medio).
// - Eventi: cosa è cambiato fra due copie di BOSS.
// - Collegamento con Alma Strategy: per un ruolo scritto in Strategy, il ruolo HR più simile.
const { norm } = require('./hr');

const round1 = n => Math.round(n * 10) / 10;


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
      ev.push(i.ricoperto_da ? { tipo: 'ricoperto', boss_id: id, oggetto: i.nome } : { tipo: 'vacante', boss_id: id, oggetto: i.nome, azione: 'aprire la richiesta di personale' });
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

module.exports = { orgStats, diffOrg, suggestHrRole };
