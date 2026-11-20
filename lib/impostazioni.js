// Impostazioni uniche (canvas «Alma Space · Impostazioni», 19/11/2026): ruoli e privacy validi per tutto il software.
// - Il ruolo di una persona: quello dato a mano (role_assignments), altrimenti il primo ruolo, in ordine, la cui
//   regola sull'organigramma di Entra vale per lei (qualifica, reparto, responsabile di qualcuno, ospite, tutti).
// - Gli amministratori: ruolo «admin» più chi è in ADMIN_EMAILS su Railway (resta come chiave di riserva, così nessuno
//   si chiude fuori togliendosi il ruolo).
// - La privacy: per ogni ruolo e area un livello (all = tutto, bu = solo la sua BU, own = solo i suoi, none = niente);
//   un'eccezione personale vale più del ruolo. I valori di partenza sono le regole di prima, così niente cambia finché
//   un amministratore non tocca la matrice.
// Tutto sta in memoria (un'istanza sola su Railway): si ricarica a ogni modifica e ogni 5 minuti, così isAdmin(req)
// resta una funzione sincrona come prima.
const { getSetting } = require('./settings');

const LEVELS = { all: 'Tutto', bu: 'Solo la sua BU', own: 'Solo i suoi', none: 'Niente' };

// Le aree che la matrice governa davvero (ognuna ha il suo controllo nel codice: lib/access.js, lib/crm.js,
// lib/energy.js, le guardie di /api/org e /api/mezzi, Impostazioni → Costi AI). I documenti seguono sempre i permessi
// di OneDrive: si vedono nella matrice ma non si cambiano.
const AREAS = [
  { key: 'progetti', label: 'Progetti e ticket', levels: ['all', 'own'], hint: '«Solo i suoi» = dove è responsabile, membro o assegnato. «Tutto» li vede in sola lettura.' },
  { key: 'crm', label: 'CRM, gare e offerte', levels: ['all', 'bu', 'none'], hint: '«Tutto» = come la direzione del CRM. «Sua BU» = le anagrafiche della sua ASA.' },
  { key: 'energy', label: 'Alma Energy', levels: ['all', 'bu', 'none'], hint: '«Sua BU» = solo chi è membro della BU Energy.' },
  { key: 'persone', label: 'Persone e organigramma', levels: ['all', 'none'] },
  { key: 'mezzi', label: 'Mezzi', levels: ['all', 'none'] },
  { key: 'costi_ai', label: 'Costi AI', levels: ['all', 'own'], hint: '«Tutto» apre Impostazioni → Costi AI in sola lettura.' },
  { key: 'documenti', label: 'Documenti OneDrive', levels: ['own'], fixed: true, hint: 'Seguono sempre i permessi di Microsoft: Alma Space non li allarga.' },
];
const AREA_KEYS = AREAS.map(a => a.key);

// Le regole di prima. L'amministratore vede tutto (Energy solo se è della BU, come prima) e la sua riga non si cambia,
// tranne Energy.
const BASE = { progetti: 'own', crm: 'bu', energy: 'bu', persone: 'all', mezzi: 'all', costi_ai: 'own', documenti: 'own' };
const DEFAULT_MATRIX = {
  admin: { progetti: 'all', crm: 'all', energy: 'bu', persone: 'all', mezzi: 'all', costi_ai: 'all', documenti: 'own' },
  direzione: { ...BASE },
  responsabile: { ...BASE },
  amministrazione: { ...BASE },
  collaboratore: { ...BASE },
  ospite: { ...BASE }, // come oggi: chi entra ha le stesse regole di tutti finché un amministratore non decide altro
};
const ADMIN_EDITABLE = new Set(['energy']);
const RULES = { manual: 'Solo a mano', job_title: 'Qualifica contiene', department: 'Reparto contiene', manager: 'Responsabile di qualcuno in Entra', guest: 'Non è nell\'organigramma di Entra', default: 'Tutti gli altri' };

const norm = s => String(s || '').trim().toLowerCase();
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

function createGovernance({ db, adminEmails = [] }) {
  const envAdmins = new Set(adminEmails.map(norm));
  let state = { roles: [], assignments: new Map(), people: new Map(), managers: new Set(), matrix: DEFAULT_MATRIX, exceptions: [] };
  let loadedAt = 0;

  async function reload() {
    const [roles, asg, people, matrix, exc] = await Promise.all([
      db.query('SELECT key, label, rule, rule_value, position, system FROM roles ORDER BY position, label'),
      db.query('SELECT email, role_key FROM role_assignments'),
      db.query('SELECT oid, lower(email) AS email, job_title, department, manager_oid FROM org_people'),
      getSetting(db, 'planet.privacy', null),
      db.query('SELECT email, area, level, until::text AS until FROM privacy_exceptions'),
    ]);
    const managers = new Set(people.rows.map(p => p.manager_oid).filter(Boolean));
    state = {
      roles: roles.rows,
      assignments: new Map(asg.rows.map(r => [norm(r.email), r.role_key])),
      people: new Map(people.rows.filter(p => p.email).map(p => [p.email, p])),
      managers,
      matrix: mergeMatrix(matrix, roles.rows),
      exceptions: exc.rows.map(e => ({ ...e, email: norm(e.email) })),
    };
    loadedAt = Date.now();
    return state;
  }

  // matrice salvata + valori di partenza per i ruoli e le aree che non ci sono ancora
  function mergeMatrix(saved, roles) {
    const out = {};
    for (const r of roles) {
      const base = DEFAULT_MATRIX[r.key] || BASE;
      const row = { ...base, ...(saved?.[r.key] || {}) };
      if (r.key === 'admin') for (const a of AREA_KEYS) if (!ADMIN_EDITABLE.has(a)) row[a] = DEFAULT_MATRIX.admin[a];
      for (const a of AREAS) if (!a.levels.includes(row[a.key])) row[a.key] = a.levels.includes(base[a.key]) ? base[a.key] : a.levels[0];
      out[r.key] = row;
    }
    return out;
  }

  // Il ruolo che vale per una persona e da dove viene: «manual» (dato a mano) o «rule».
  function ruleRole(email) {
    const p = state.people.get(norm(email));
    for (const r of state.roles) {
      const v = norm(r.rule_value);
      if (r.rule === 'manual') continue;
      if (r.rule === 'job_title' && p && v && norm(p.job_title).includes(v)) return r.key;
      if (r.rule === 'department' && p && v && norm(p.department).includes(v)) return r.key;
      if (r.rule === 'manager' && p && state.managers.has(p.oid)) return r.key;
      // «ospite» solo se l'organigramma è stato letto: con org_people vuota tutti sarebbero ospiti
      if (r.rule === 'guest' && !p && state.people.size) return r.key;
      if (r.rule === 'default') return r.key;
    }
    return 'collaboratore';
  }
  function roleOf(email) {
    const e = norm(email);
    const manual = state.assignments.get(e);
    if (manual && state.roles.some(r => r.key === manual)) return { key: manual, source: 'manual' };
    return { key: ruleRole(e), source: 'rule' };
  }
  const isAdminEmail = email => envAdmins.has(norm(email)) || roleOf(email).key === 'admin';
  const isAdmin = req => Boolean(req?.user?.email) && isAdminEmail(req.user.email);

  // Livelli di privacy di una persona: il suo ruolo (amministratore se lo è per ADMIN_EMAILS), poi le eccezioni.
  function levelsFor(email) {
    const e = norm(email);
    const role = envAdmins.has(e) ? 'admin' : roleOf(e).key;
    const out = { ...(state.matrix[role] || BASE) };
    const today = todayIso();
    for (const x of state.exceptions) {
      if (x.email !== e || (x.until && x.until < today)) continue;
      const area = AREAS.find(a => a.key === x.area);
      if (area && !area.fixed && area.levels.includes(x.level)) out[x.area] = x.level;
    }
    return out;
  }

  // Ricarica in sottofondo: ogni 5 minuti, così l'organigramma notturno e le modifiche fatte da un altro processo
  // (test, script) arrivano senza riavviare.
  function start() {
    const t = setInterval(() => reload().catch(err => console.warn('[impostazioni] ricarica non riuscita', err.message)), 5 * 60 * 1000);
    t.unref?.();
  }

  return { reload, start, roleOf, ruleRole, isAdmin, isAdminEmail, levelsFor, envAdmins, get state() { return state; }, get loadedAt() { return loadedAt; } };
}

module.exports = { createGovernance, AREAS, AREA_KEYS, LEVELS, RULES, DEFAULT_MATRIX, ADMIN_EDITABLE };
